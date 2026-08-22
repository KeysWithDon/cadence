"""Private, short-lived audio analysis worker for Faithful Keys.

This service is intentionally separate from the GitHub Pages client. It accepts
only a pre-authorized, already-uploaded object reference from an authenticated
orchestrator; it never fetches YouTube media and never returns audio or stems.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AnalysisInput:
    job_id: str
    user_id: str
    source_path: Path
    title: str


def _parse_lab(path: Path) -> list[dict[str, Any]]:
    """Read timestamped chord labels without fabricating uncertain harmony."""
    events: list[dict[str, Any]] = []
    for row in path.read_text(encoding="utf-8").splitlines():
        fields = row.split()
        if len(fields) < 3:
            continue
        try:
            start, end = float(fields[0]), float(fields[1])
        except ValueError:
            continue
        chord = " ".join(fields[2:]).strip()
        if chord and chord not in {"N", "X"}:
            events.append({"startTime": start, "endTime": end, "chordSymbol": chord, "confidence": "medium"})
    return events


def separate_to_instrumental(source: Path, work_dir: Path) -> Path:
    """Run a configured UVR-family instrumental model as a private intermediary.

    Operators supply an approved model artifact through UVR_INSTRUMENTAL_MODEL.
    This function returns only the instrumental path internally; the caller must
    delete all generated files in ``work_dir`` once analysis completes.
    """
    from audio_separator.separator import Separator  # Imported only in GPU worker.

    model = os.environ.get("UVR_INSTRUMENTAL_MODEL")
    if not model:
        raise RuntimeError("UVR_INSTRUMENTAL_MODEL must name an approved instrumental model artifact.")
    separator = Separator(output_dir=str(work_dir), output_format="WAV")
    separator.load_model(model_filename=model)
    generated = [work_dir / name for name in separator.separate(str(source))]
    instrumental = next((item for item in generated if "instrumental" in item.name.lower()), None)
    if not instrumental or not instrumental.exists():
        raise RuntimeError("Instrumental separation did not create an approved instrumental stem.")
    return instrumental


def recognize_chords(instrumental: Path, work_dir: Path) -> list[dict[str, Any]]:
    """Run a locally installed ChordMini-compatible recognizer on the music stem."""
    chordmini_home = Path(os.environ.get("CHORD_RECOGNIZER_HOME", "")).expanduser()
    checkpoint = os.environ.get("CHORD_RECOGNIZER_CHECKPOINT", "")
    if not chordmini_home.is_dir() or not checkpoint:
        raise RuntimeError("A chord recognizer home and approved checkpoint are required.")
    output_dir = work_dir / "recognition"
    output_dir.mkdir()
    command = [
        os.environ.get("PYTHON", "python3"), "src/evaluation/test.py",
        "--model_type", os.environ.get("CHORD_RECOGNIZER_MODEL", "ChordNet"),
        "--checkpoint", checkpoint,
        "--config", os.environ.get("CHORD_RECOGNIZER_CONFIG", "config/ChordMini.yaml"),
        "--audio_dir", str(instrumental), "--save_dir", str(output_dir),
        "--use_overlap", "--use_gaussian", "--kernel_size", "9",
        "--vote_aggregation", "logit", "--min_segment_duration", "0.5", "--smooth_predictions",
    ]
    subprocess.run(command, cwd=chordmini_home, check=True, timeout=20 * 60, capture_output=True, text=True)
    candidates = list(output_dir.rglob("*.lab"))
    if not candidates:
        raise RuntimeError("Chord recognition completed without a timestamped chord chart.")
    return _parse_lab(candidates[0])


def beat_grid(instrumental: Path) -> dict[str, Any]:
    """Estimate beats from the instrumental stem only."""
    import librosa

    audio, sample_rate = librosa.load(str(instrumental), sr=None, mono=True)
    tempo, frames = librosa.beat.beat_track(y=audio, sr=sample_rate)
    beat_times = librosa.frames_to_time(frames, sr=sample_rate).tolist()
    tempo_value = float(tempo[0]) if hasattr(tempo, "__len__") else float(tempo)
    return {"bpm": round(tempo_value, 1), "beatTimes": [round(float(item), 4) for item in beat_times]}


def review_harmony(candidates: list[dict[str, Any]], key_hint: str | None) -> list[dict[str, Any]]:
    """Optional constrained reviewer hook.

    A deployed reviewer may choose between candidate symbols using timing and
    harmonic context. It receives no source/stem media and must return JSON
    decisions only; chain-of-thought, lyrics, and raw provider text are never
    persisted or surfaced.
    """
    # The deterministic baseline deliberately preserves recognizer output. An
    # authenticated implementation can replace this with a structured JSON API.
    _ = key_hint
    return candidates


def run_analysis(request: AnalysisInput) -> dict[str, Any]:
    """Return chart metadata only and erase the source-copy/stems on every path."""
    if not request.source_path.is_file():
        raise ValueError("The secure source object is unavailable.")
    with tempfile.TemporaryDirectory(prefix=f"faithful-keys-{request.job_id}-") as temp:
        work_dir = Path(temp)
        # Copy into an isolated per-job directory; never write input/stems to a
        # shared output path or return them in this API response.
        source = work_dir / f"source{request.source_path.suffix.lower()}"
        shutil.copy2(request.source_path, source)
        instrumental = separate_to_instrumental(source, work_dir)
        grid = beat_grid(instrumental)
        raw_events = recognize_chords(instrumental, work_dir)
        events = review_harmony(raw_events, key_hint=None)
        return {
            "jobId": request.job_id,
            "title": request.title or "Untitled song",
            "bpm": grid["bpm"],
            "beatTimes": grid["beatTimes"],
            "timeSignature": "4/4",
            "confidence": "medium",
            "events": events,
            "processing": {"vocalRemoval": "completed", "sourceRetained": False},
        }
