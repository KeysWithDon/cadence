"""Authenticated private worker API for Faithful Keys audio analysis.

The request contains a storage object key, not an audio URL.  This process is
the only component that uses the Supabase secret key; that key must never be
placed in a Vite variable or returned to the browser.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from analysis_service import AnalysisInput, run_analysis

app = FastAPI(title="Faithful Keys private analysis worker", docs_url=None, redoc_url=None)
BUCKET = "faithful-keys-sources"
MAX_SOURCE_BYTES = 100 * 1024 * 1024


class JobRequest(BaseModel):
    jobId: str = Field(min_length=1)
    userId: str = Field(min_length=1)
    chartId: str = Field(min_length=1)
    sourceObjectKey: str = Field(min_length=1)


def settings() -> tuple[str, str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SECRET_KEY", "")
    token = os.environ.get("ANALYSIS_WORKER_TOKEN", "")
    if not url or not secret or not token:
        raise RuntimeError("SUPABASE_URL, SUPABASE_SECRET_KEY, and ANALYSIS_WORKER_TOKEN are required.")
    return url, secret, token


def service_headers(secret: str) -> dict[str, str]:
    return {"apikey": secret, "authorization": f"Bearer {secret}", "content-type": "application/json"}


async def update_job(client: httpx.AsyncClient, url: str, secret: str, job_id: str, values: dict[str, Any]) -> None:
    response = await client.patch(f"{url}/rest/v1/analysis_jobs?id=eq.{quote(job_id, safe='')}", headers={**service_headers(secret), "prefer": "return=minimal"}, json=values)
    response.raise_for_status()


async def fetch_chart(client: httpx.AsyncClient, url: str, secret: str, chart_id: str) -> dict[str, Any]:
    response = await client.get(f"{url}/rest/v1/song_charts?id=eq.{quote(chart_id, safe='')}&select=chart", headers=service_headers(secret))
    response.raise_for_status()
    rows = response.json()
    if not rows: raise RuntimeError("The private chart record is unavailable.")
    return rows[0]["chart"]


async def verify_job(client: httpx.AsyncClient, url: str, secret: str, request: JobRequest) -> None:
    """Defence in depth: do not trust an object key solely because it was posted."""
    params = f"id=eq.{quote(request.jobId, safe='')}&owner_id=eq.{quote(request.userId, safe='')}&chart_id=eq.{quote(request.chartId, safe='')}&source_object_key=eq.{quote(request.sourceObjectKey, safe='')}&select=id"
    response = await client.get(f"{url}/rest/v1/analysis_jobs?{params}", headers=service_headers(secret))
    response.raise_for_status()
    if not response.json():
        raise RuntimeError("The private job does not authorize this source object.")


def event_id(index: int) -> str: return f"recognized-{index + 1}"


def chart_with_results(chart: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Map time-stamped candidates into editable 4/4 review measures.

    The recognizer output is intentionally kept as medium-confidence candidates;
    the user remains able to correct every label.
    """
    beats = result.get("beatTimes", [])
    numerator = 4
    events = result.get("events", [])
    duration = max([float(item.get("endTime", 0)) for item in events] or [0])
    measure_count = max(4, (len(beats) + numerator - 1) // numerator)
    measures = []
    for index in range(measure_count):
        start = float(beats[index * numerator]) if index * numerator < len(beats) else index * numerator * 60 / max(result.get("bpm") or 72, 30)
        measures.append({"number": index + 1, "startTime": start, "beats": numerator, "chordEvents": []})
    for index, item in enumerate(events):
        start = float(item.get("startTime", 0))
        closest = min(range(len(beats)), key=lambda beat_index: abs(beats[beat_index] - start)) if beats else round(start * max(result.get("bpm") or 72, 30) / 60)
        measure_index, beat = divmod(max(0, closest), numerator)
        if measure_index >= len(measures): continue
        symbol = str(item.get("chordSymbol") or "?")
        measures[measure_index]["chordEvents"].append({"id": event_id(index), "chordSymbol": symbol, "nashvilleNumber": "?", "startTime": start, "endTime": float(item.get("endTime", start)), "measureNumber": measure_index + 1, "beat": beat + 1, "confidence": "medium", "userEdited": False, "confirmed": False})
    section = {"id": "recognized-section", "name": "Recognized progression", "order": 1, "startTime": 0, "endTime": duration, "confidence": "medium", "measures": measures}
    return {**chart, "key": result.get("key") or chart.get("key") or "C", "mode": result.get("mode") or chart.get("mode") or "major", "bpm": result.get("bpm"), "timeSignature": "4/4", "confidence": "medium", "durationSeconds": duration or None, "sections": [section], "updatedAt": datetime.now(timezone.utc).isoformat()}


async def store_chart(client: httpx.AsyncClient, url: str, secret: str, chart_id: str, chart: dict[str, Any]) -> None:
    response = await client.patch(f"{url}/rest/v1/song_charts?id=eq.{quote(chart_id, safe='')}", headers={**service_headers(secret), "prefer": "return=minimal"}, json={"chart": chart, "updated_at": chart["updatedAt"]})
    response.raise_for_status()


async def remove_source(client: httpx.AsyncClient, url: str, secret: str, key: str) -> None:
    # Storage bulk delete accepts object names. Failure to clean up is recorded
    # by the caller rather than silently retaining a source file.
    response = await client.delete(f"{url}/storage/v1/object/{BUCKET}", headers=service_headers(secret), json={"prefixes": [key]})
    response.raise_for_status()


async def process(request: JobRequest) -> None:
    url, secret, _ = settings()
    async with httpx.AsyncClient(timeout=httpx.Timeout(60 * 30)) as client:
        try:
            await verify_job(client, url, secret, request)
            await update_job(client, url, secret, request.jobId, {"status": "processing", "progress": 15, "error": None})
            object_url = f"{url}/storage/v1/object/{BUCKET}/{quote(request.sourceObjectKey, safe='/')}"
            audio = await client.get(object_url, headers=service_headers(secret))
            audio.raise_for_status()
            content_length = int(audio.headers.get("content-length") or 0)
            if content_length > MAX_SOURCE_BYTES or len(audio.content) > MAX_SOURCE_BYTES:
                raise RuntimeError("The private source exceeds the allowed analysis size.")
            if not audio.content:
                raise RuntimeError("The private source is empty.")
            await update_job(client, url, secret, request.jobId, {"status": "processing", "progress": 30})
            with tempfile.TemporaryDirectory(prefix=f"faithful-keys-download-{request.jobId}-") as directory:
                suffix = Path(request.sourceObjectKey).suffix or ".audio"
                source = Path(directory) / f"source{suffix}"
                source.write_bytes(audio.content)
                chart = await fetch_chart(client, url, secret, request.chartId)
                result = await asyncio.to_thread(run_analysis, AnalysisInput(job_id=request.jobId, user_id=request.userId, source_path=source, title=str(chart.get("title") or "Untitled song")))
                await update_job(client, url, secret, request.jobId, {"status": "processing", "progress": 85})
                await store_chart(client, url, secret, request.chartId, chart_with_results(chart, result))
            await remove_source(client, url, secret, request.sourceObjectKey)
            await update_job(client, url, secret, request.jobId, {"status": "completed", "progress": 100, "completed_at": datetime.now(timezone.utc).isoformat(), "error": None})
        except Exception as error:  # Job errors are safe status text, never raw audio/model data.
            try:
                await update_job(client, url, secret, request.jobId, {"status": "failed", "progress": 0, "error": "Private analysis could not complete. Check the permitted audio file and try again.", "completed_at": datetime.now(timezone.utc).isoformat()})
            finally:
                try: await remove_source(client, url, secret, request.sourceObjectKey)
                except Exception: pass
            print(f"analysis failed for {request.jobId}: {type(error).__name__}")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
async def queue_job(request: JobRequest, tasks: BackgroundTasks, authorization: str | None = Header(default=None)) -> dict[str, str]:
    _, _, expected_token = settings()
    if authorization != f"Bearer {expected_token}": raise HTTPException(status_code=401, detail="Unauthorized worker request.")
    if not request.sourceObjectKey.startswith(f"{request.userId}/"):
        raise HTTPException(status_code=403, detail="Invalid private object scope.")
    tasks.add_task(process, request)
    return {"status": "accepted", "jobId": request.jobId}
