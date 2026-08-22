"""Private, short-lived audio analysis worker for Faithful Keys.

This service is intentionally separate from the GitHub Pages client. It accepts
only a pre-authorized, already-uploaded object reference from an authenticated
orchestrator; it never fetches YouTube media and never returns audio or stems.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_PITCH_CLASSES = {"C": 0, "B♯": 0, "C♯": 1, "D♭": 1, "D": 2, "D♯": 3, "E♭": 3, "E": 4, "F♭": 4, "E♯": 5, "F": 5, "F♯": 6, "G♭": 6, "G": 7, "G♯": 8, "A♭": 8, "A": 9, "A♯": 10, "B♭": 10, "B": 11, "C♭": 11}
_PREFERRED_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]


def normalize_chord_symbol(symbol: str) -> str:
    """Translate common recognizer labels into the editable chart notation.

    The recognizer may emit Harte-style labels such as ``C:maj`` or ``D:min7``.
    This deliberately changes syntax only—not a written root's enharmonic name.
    """
    value = symbol.strip().replace("#", "♯").replace("b", "♭")
    if not value or value in {"N", "X", "?"}:
        return "?"
    match = re.match(r"^([A-G](?:[♯♭])?)(?::)?(.*)$", value)
    if not match:
        return value
    root, quality = match.groups()
    quality = quality.strip().lower().replace("(", "").replace(")", "")
    aliases = {
        "": "", "maj": "", "major": "", "min": "m", "minor": "m",
        "maj7": "maj7", "major7": "maj7", "min7": "m7", "minor7": "m7",
        "7": "7", "dom7": "7", "dim": "dim", "dim7": "dim7",
        "hdim7": "m7♭5", "min7b5": "m7♭5", "min7♭5": "m7♭5", "sus4": "sus4", "sus2": "sus2",
    }
    return f"{root}{aliases.get(quality, quality.replace('b', '♭').replace('#', '♯'))}"


def infer_key(events: list[dict[str, Any]]) -> dict[str, str]:
    """Provide a conservative key suggestion from recognized chord roots.

    This is intentionally a suggestion, not a claim of certain harmonic
    analysis. The UI keeps the key editable for modal, borrowed, and ambiguous
    recordings.
    """
    parsed: list[tuple[int, bool]] = []
    for event in events:
        symbol = normalize_chord_symbol(str(event.get("chordSymbol") or ""))
        match = re.match(r"^([A-G](?:[♯♭])?)(.*)$", symbol)
        if not match or match.group(1) not in _PITCH_CLASSES:
            continue
        parsed.append((_PITCH_CLASSES[match.group(1)], match.group(2).startswith("m") and not match.group(2).startswith("maj")))
    if not parsed:
        return {"key": "C", "mode": "major"}
    major_scale = {0, 2, 4, 5, 7, 9, 11}
    minor_scale = {0, 2, 3, 5, 7, 8, 10}
    final_root = parsed[-1][0]
    candidates: list[tuple[float, int, str]] = []
    for tonic in range(12):
        for mode, intervals in (("major", major_scale), ("minor", minor_scale)):
            scale = {(tonic + interval) % 12 for interval in intervals}
            score = sum(1.0 for root, _ in parsed if root in scale)
            score += 2.5 if final_root == tonic else 0
            score += 0.4 * sum(1 for root, is_minor in parsed if root == tonic and (is_minor == (mode == "minor")))
            candidates.append((score, tonic, mode))
    _, tonic, mode = max(candidates, key=lambda item: item[0])
    return {"key": _PREFERRED_NAMES[tonic], "mode": mode}


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
        chord = normalize_chord_symbol(" ".join(fields[2:]).strip())
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

    model = os.environ.get("UVR_INSTRUMENTAL_MODEL", "UVR-MDX-NET-Inst_HQ_3.onnx")
    model_directory = os.environ.get("UVR_MODEL_DIRECTORY", "/opt/models/uvr")
    separator = Separator(output_dir=str(work_dir), output_format="WAV", model_file_dir=model_directory)
    separator.load_model(model_filename=model)
    generated = [work_dir / name for name in separator.separate(str(source))]
    instrumental = next((item for item in generated if "instrumental" in item.name.lower()), None)
    if not instrumental or not instrumental.exists():
        raise RuntimeError("Instrumental separation did not create an approved instrumental stem.")
    return instrumental


def recognize_chords(instrumental: Path, work_dir: Path) -> list[dict[str, Any]]:
    """Run a locally installed ChordMini-compatible recognizer on the music stem."""
    chordmini_home = Path(os.environ.get("CHORD_RECOGNIZER_HOME", "/opt/chordmini")).expanduser()
    checkpoint = os.environ.get("CHORD_RECOGNIZER_CHECKPOINT", str(chordmini_home / "checkpoints/2e1d_model_best.pth"))
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
    timeout_seconds = int(os.environ.get("CHORD_RECOGNIZER_TIMEOUT_SECONDS", "1200"))
    subprocess.run(command, cwd=chordmini_home, check=True, timeout=timeout_seconds, capture_output=True, text=True)
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
        key = infer_key(events)
        return {
            "jobId": request.job_id,
            "title": request.title or "Untitled song",
            "bpm": grid["bpm"],
            "beatTimes": grid["beatTimes"],
            "timeSignature": "4/4",
            "key": key["key"],
            "mode": key["mode"],
            "confidence": "medium",
            "events": events,
            "processing": {"vocalRemoval": "completed", "sourceRetained": False},
        }
