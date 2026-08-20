#!/usr/bin/env python3
"""Build the Cadence jazz-standards catalog with measure-aware harmony.

The supplied Real Book establishes the title scope.  Its pages are compressed
bitonal scans, so title metadata is read from the publisher's matching product
page and chords are matched to structured, machine-readable chart sources.

Each outer ``bars`` entry is one printed measure.  A string means one chord
for the complete bar, a string array divides the bar evenly, and an object can
carry exact beat durations when the source explicitly encodes them.

Run from the repository root:

  python3 scripts/build-standards-data.py \
    --song-list-html tmp/pdfs/hal-realbook.html \
    --chromatone-html tmp/pdfs/chromatone.html \
    --ireal-json tmp/pdfs/realbook-ireal.json \
    --jazz-standards-dir tmp/JazzStandards/JazzStandards \
    --output app/standards.ts \
    --report tmp/pdfs/standards-match-report.json
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


class FirstSongListParser(HTMLParser):
    """Extract only the first publisher song-list container."""

    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.finished = False
        self.in_item = False
        self.buffer: list[str] = []
        self.items: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div" and attributes.get("id") == "songListcontainer" and not self.finished:
            self.depth = 1
        elif self.depth and tag == "div":
            self.depth += 1
        if self.depth and tag == "li":
            self.in_item = True
            self.buffer = []

    def handle_endtag(self, tag: str) -> None:
        if self.depth and tag == "li" and self.in_item:
            title = html.unescape("".join(self.buffer)).strip()
            if title:
                self.items.append(title)
            self.in_item = False
        if self.depth and tag == "div":
            self.depth -= 1
            if self.depth == 0:
                self.finished = True

    def handle_data(self, data: str) -> None:
        if self.in_item:
            self.buffer.append(data)


def catalog_titles(path: Path) -> list[str]:
    parser = FirstSongListParser()
    parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
    if not parser.items:
        raise RuntimeError(f"No publisher song list found in {path}")
    return parser.items


def ascii_fold(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    )


def normalize_title(value: str) -> str:
    value = ascii_fold(html.unescape(value)).lower()
    value = value.replace("&", " and ").replace("'til", " till ")
    value = value.replace("'n", " and ")
    value = re.sub(r"\bpart\s+(?:one|1)\b", "", value)
    value = re.sub(r"\b(?:theme|song)\s+from\b", "", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def title_variants(value: str) -> set[str]:
    variants = {normalize_title(value)}
    # Publisher subtitles are often an alternate title used by chart sources.
    for parenthetical in re.findall(r"\(([^)]+)\)", value):
        variants.add(normalize_title(parenthetical))
    variants.add(normalize_title(re.sub(r"\s*\([^)]*\)\s*", " ", value)))
    if "," in value:
        head, tail = value.rsplit(",", 1)
        if normalize_title(tail) in {"the", "a", "an"}:
            variants.add(normalize_title(f"{tail} {head}"))
    # Ignore a leading article as a secondary, lower-specificity spelling.
    for candidate in tuple(variants):
        variants.add(re.sub(r"^(?:the|a|an) ", "", candidate))
    return {candidate for candidate in variants if candidate}


def title_score(left: str, right: str) -> float:
    left_variants = title_variants(left)
    right_variants = title_variants(right)
    if left_variants & right_variants:
        return 1.0
    best = 0.0
    for a in left_variants:
        a_tokens = set(a.split())
        for b in right_variants:
            b_tokens = set(b.split())
            sequence = difflib.SequenceMatcher(None, a, b).ratio()
            union = a_tokens | b_tokens
            token_score = len(a_tokens & b_tokens) / len(union) if union else 0.0
            best = max(best, sequence, 0.55 * sequence + 0.45 * token_score)
    return best


def decode_js_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except json.JSONDecodeError:
        return value.replace(r'\"', '"').replace(r"\\", "\\")


CHROMATONE_CHART = re.compile(
    r'\{filename:"(?P<filename>(?:\\.|[^"])*)",'
    r'Title:"(?P<title>(?:\\.|[^"])*)",'
    r'ComposedBy:"(?P<composer>(?:\\.|[^"])*)",'
    r'DBKeySig:"(?P<key>(?:\\.|[^"])*)",'
    r'TimeSig:\[(?P<timesig>[^\]]*)\],'
    r'Bars:"(?P<barcount>[^"]*)",'
    r'chords:\[(?P<chords>.*?)\]\}',
    re.DOTALL,
)


@dataclass
class SourceChart:
    source: str
    source_title: str
    composer: str
    key: str
    style: str
    time_signature: tuple[int, int]
    bars: list[Any]


NO_CHORD = re.compile(r"^(?:N\.?C\.?|N/?C)(?:x\d+)?$", re.IGNORECASE)
ROOT = re.compile(r"^([A-Ga-g])([#b♯♭]?)(.*)$")
PITCH_SPELLING = {
    "C": "C", "C#": "C♯", "Cb": "C♭",
    "D": "D", "D#": "D♯", "Db": "D♭",
    "E": "E", "E#": "E♯", "Eb": "E♭",
    "F": "F", "F#": "F♯", "Fb": "F♭",
    "G": "G", "G#": "G♯", "Gb": "G♭",
    "A": "A", "A#": "A♯", "Ab": "A♭",
    "B": "B", "B#": "B♯", "Bb": "B♭",
}


def normalize_pitch_name(value: str) -> str:
    value = value.strip().replace("♯", "#").replace("♭", "b")
    match = re.match(r"^([A-Ga-g])([#b]?)(.*)$", value)
    if not match:
        return value
    spelling = match.group(1).upper() + match.group(2)
    return PITCH_SPELLING.get(spelling, spelling) + match.group(3)


def normalize_chord_root(value: str) -> str:
    match = ROOT.match(value)
    if not match:
        return value
    spelling = match.group(1).upper() + match.group(2).replace("♯", "#").replace("♭", "b")
    return PITCH_SPELLING.get(spelling, spelling) + match.group(3)


def normalize_chord(token: str) -> str | None:
    token = html.unescape(token).strip().strip("|")
    if not token or NO_CHORD.match(token) or token in {"%", "/"}:
        return None
    token = token.replace("Δ", "maj").replace("^", "maj")
    token = token.replace("ø", "m7b5").replace("°", "o")
    token = token.replace("♯", "#").replace("♭", "b")
    token = re.sub(r"\s+", "", token)
    # Normalize each side of a slash chord independently.
    head, separator, bass = token.partition("/")
    head = normalize_chord_root(head)
    root = re.match(r"^([A-G](?:♯|♭)?)(.*)$", head)
    if not root:
        return None
    pitch, suffix = root.groups()
    suffix = re.sub(r"^-", "m", suffix)
    suffix = re.sub(r"^(?:h7|m7b5)", "m7♭5", suffix, flags=re.IGNORECASE)
    suffix = re.sub(r"^(?:o7|07)", "dim7", suffix, flags=re.IGNORECASE)
    suffix = re.sub(r"^o", "dim", suffix, flags=re.IGNORECASE)
    suffix = re.sub(r"^\+", "aug", suffix)
    suffix = suffix.replace("b", "♭").replace("#", "♯")
    # "69" is a sixth chord with an added ninth; retain the audible ninth.
    suffix = re.sub(r"^69", "6/9", suffix)
    result = pitch + suffix
    if separator:
        normalized_bass = normalize_pitch_name(bass)
        result += "/" + normalized_bass
    return result


def carry_no_chord(bars: Iterable[list[str]], fallback: str) -> list[Any]:
    result: list[Any] = []
    prior = fallback
    for bar in bars:
        chords = [chord for chord in bar if chord]
        if not chords:
            chords = [prior]
        prior = chords[-1]
        result.append(chords[0] if len(chords) == 1 else chords)
    return result


def load_chromatone(path: Path) -> list[SourceChart]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    charts: list[SourceChart] = []
    for match in CHROMATONE_CHART.finditer(text):
        rows = json.loads("[" + match.group("chords") + "]")
        raw_bars = [bar for row in rows for bar in row]
        key = normalize_pitch_name(decode_js_string(match.group("key")))
        normalized = [
            [chord for token in str(bar).split() if (chord := normalize_chord(token))]
            for bar in raw_bars
        ]
        time_values = [int(value.strip()) for value in match.group("timesig").split(",") if value.strip().isdigit()]
        time_signature = tuple(time_values[:2]) if len(time_values) >= 2 else (4, 4)
        charts.append(
            SourceChart(
                source="chromatone",
                source_title=decode_js_string(match.group("title")),
                composer=decode_js_string(match.group("composer")),
                key=key,
                style="Lead-sheet form",
                time_signature=(int(time_signature[0]), int(time_signature[1])),
                bars=carry_no_chord(normalized, key),
            )
        )
    if not charts:
        raise RuntimeError(f"No structured charts found in {path}")
    return charts


def parse_time_signature(value: str) -> tuple[int, int]:
    match = re.search(r"(\d+)\s*/\s*(\d+)", value or "")
    return (int(match.group(1)), int(match.group(2))) if match else (4, 4)


def mike_bar(raw_bar: str, beats_per_bar: float, prior: str) -> tuple[Any, str]:
    slots = [part.strip() for part in raw_bar.split(",")]
    normalized = [normalize_chord(slot) if slot else None for slot in slots]
    if not slots:
        return prior, prior
    # Empty comma slots extend the chord sounding immediately before them.
    active = prior
    ordered: list[str] = []
    slot_counts: list[int] = []
    for chord in normalized:
        if chord:
            active = chord
            if not ordered or ordered[-1] != chord:
                ordered.append(chord)
                slot_counts.append(1)
            else:
                slot_counts[-1] += 1
        elif ordered:
            slot_counts[-1] += 1
        else:
            ordered.append(active)
            slot_counts.append(1)
    if not ordered:
        ordered = [prior]
        slot_counts = [max(1, len(slots))]
    current = ordered[-1]
    if len(ordered) == 1:
        return ordered[0], current
    durations = [round(beats_per_bar * count / max(1, len(slots)), 4) for count in slot_counts]
    return {"chords": ordered, "durations": durations}, current


def mike_segment(raw: str, beats_per_bar: float, prior: str) -> tuple[list[Any], str]:
    bars: list[Any] = []
    for raw_bar in raw.split("|"):
        if not raw_bar.strip():
            continue
        bar, prior = mike_bar(raw_bar, beats_per_bar, prior)
        bars.append(bar)
    return bars, prior


def load_mike(path: Path) -> list[SourceChart]:
    charts: list[SourceChart] = []
    for chart_path in sorted(path.glob("*.json")):
        try:
            raw = json.loads(chart_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        time_signature = parse_time_signature(str(raw.get("TimeSignature", "4/4")))
        beats_per_bar = time_signature[0] * 4 / time_signature[1]
        key = normalize_pitch_name(str(raw.get("Key", "C")))
        prior = key
        bars: list[Any] = []
        for section in raw.get("Sections", []):
            main_raw = str(section.get("MainSegment", {}).get("Chords", ""))
            main, main_prior = mike_segment(main_raw, beats_per_bar, prior)
            endings = section.get("Endings") or []
            if endings:
                for ending in endings:
                    bars.extend(main)
                    ending_bars, ending_prior = mike_segment(str(ending.get("Chords", "")), beats_per_bar, main_prior)
                    bars.extend(ending_bars)
                    prior = ending_prior
            else:
                repetitions = 1 + int(section.get("Repeats", 0) or 0)
                for _ in range(repetitions):
                    bars.extend(main)
                prior = main_prior
        if not bars:
            continue
        charts.append(
            SourceChart(
                source="jazz-standards",
                source_title=str(raw.get("Title", chart_path.stem)),
                composer=str(raw.get("Composer", "")),
                key=key,
                style=str(raw.get("Rhythm", "Standard")),
                time_signature=time_signature,
                bars=bars,
            )
        )
    if not charts:
        raise RuntimeError(f"No JSON charts found in {path}")
    return charts


def normalize_source_bars(raw_bars: list[Any], key: str) -> list[Any]:
    bars: list[Any] = []
    prior = key
    for raw_bar in raw_bars:
        if isinstance(raw_bar, str):
            chord = normalize_chord(raw_bar) or prior
            bars.append(chord)
            prior = chord
        elif isinstance(raw_bar, list):
            chords = [chord for item in raw_bar if (chord := normalize_chord(str(item)))]
            if not chords:
                chords = [prior]
            bars.append(chords[0] if len(chords) == 1 else chords)
            prior = chords[-1]
        elif isinstance(raw_bar, dict):
            raw_chords = raw_bar.get("chords", [])
            if isinstance(raw_chords, str):
                raw_chords = [raw_chords]
            chords = [chord for item in raw_chords if (chord := normalize_chord(str(item)))]
            if not chords:
                chords = [prior]
            bar = dict(raw_bar)
            bar["chords"] = chords
            bars.append(bar)
            prior = chords[-1]
    return bars


def load_ireal(path: Path) -> list[SourceChart]:
    raw_charts = json.loads(path.read_text(encoding="utf-8"))
    charts: list[SourceChart] = []
    for raw in raw_charts:
        key = normalize_pitch_name(str(raw.get("key", "C")))
        signature = raw.get("timeSignature", [4, 4])
        if not isinstance(signature, list) or len(signature) < 2:
            signature = [4, 4]
        bars = normalize_source_bars(raw.get("bars", []), key)
        if not bars:
            continue
        charts.append(SourceChart(
            source="ireal-real-book",
            source_title=str(raw.get("title", "")),
            composer=str(raw.get("composer", "")),
            key=key,
            style=str(raw.get("style", "Standard")),
            time_signature=(int(signature[0]), int(signature[1])),
            bars=bars,
        ))
    return charts


# Explicit aliases are spelling/alternate-title equivalences only.  They never
# attach generic harmony to a title and are reported as aliases in the output.
ALIASES: dict[str, str] = {
    "500 Miles High": "Five Hundred Miles High",
    "African Flower (Petite Fleur Africaine)": "African Flower",
    "Água De Beber (Water To Drink)": "Agua de Beber",
    "Birdlike": "Byrd Like",
    "Can't Help Lovin' Dat Man": "Can't Help Lovin' Dat Man Of Mine",
    "Come Sunday": "Come Sunday (Black, Brown and Beige)",
    "Corcovado (Quiet Nights Of Quiet Stars)": "Corcovado",
    "I Got It Bad And That Ain't Good": "I Got It Bad",
    "In The Wee Small Hours Of The Morning": "In The Wee Small Hours",
    "Lazy River": "Up A Lazy River",
    "Quiet Nights Of Quiet Stars (Corcovado)": "Corcovado",
    "Straight No Chaser": "Straight Straight No Chaser",
    "Unquity Road": "Ubiquity Road",
    "Waltz For Debby": "Waltz For Debbie",
    "Tame Thy Pen": "Tamethy Pen",
}

# These similar-looking titles are different compositions.  They must never be
# accepted through fuzzy matching merely because the names overlap.
FUZZY_BLOCKLIST = {
    "Broad Way Blues",
    "Chelsea Bells",
    "Indian Lady",
    "The Sphinx",
}


def build_title_index(charts: list[SourceChart]) -> dict[str, list[SourceChart]]:
    index: dict[str, list[SourceChart]] = {}
    for chart in charts:
        for variant in title_variants(chart.source_title):
            index.setdefault(variant, []).append(chart)
    return index


def best_source(
    title: str,
    charts: list[SourceChart],
    title_index: dict[str, list[SourceChart]],
) -> tuple[SourceChart | None, float, str]:
    alias = ALIASES.get(title)
    if alias:
        exact = title_index.get(normalize_title(alias), [])
        if exact:
            selected = sorted(exact, key=lambda chart: (chart.source != "chromatone", -len(chart.bars)))[0]
            return selected, 1.0, "alias"
    exact_map: dict[int, SourceChart] = {}
    for variant in title_variants(title):
        for chart in title_index.get(variant, []):
            exact_map[id(chart)] = chart
    exact = list(exact_map.values())
    if exact:
        exact.sort(key=lambda chart: (chart.source != "chromatone", -len(chart.bars)))
        return exact[0], 1.0, "exact"
    if title in FUZZY_BLOCKLIST:
        return None, 0.0, "unresolved"
    ranked = sorted(
        ((title_score(title, chart.source_title), chart) for chart in charts),
        key=lambda item: (item[0], item[1].source == "chromatone", len(item[1].bars)),
        reverse=True,
    )
    if ranked and ranked[0][0] >= 0.88:
        return ranked[0][1], ranked[0][0], "fuzzy"
    return None, ranked[0][0] if ranked else 0.0, "unresolved"


def ts_value(value: Any, indent: int = 0) -> str:
    padding = " " * indent
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, list):
        if not value:
            return "[]"
        inline = "[" + ", ".join(ts_value(item) for item in value) + "]"
        if len(inline) <= 112 and not any(isinstance(item, dict) for item in value):
            return inline
        lines = ["["]
        lines.extend(f"{' ' * (indent + 2)}{ts_value(item, indent + 2)}," for item in value)
        lines.append(padding + "]")
        return "\n".join(lines)
    if isinstance(value, dict):
        parts = [f"{key}: {ts_value(item, indent + 2)}" for key, item in value.items()]
        inline = "{ " + ", ".join(parts) + " }"
        if len(inline) <= 112:
            return inline
        lines = ["{"]
        lines.extend(f"{' ' * (indent + 2)}{part}," for part in parts)
        lines.append(padding + "}")
        return "\n".join(lines)
    raise TypeError(type(value))


def write_typescript(path: Path, records: list[dict[str, Any]]) -> None:
    lines = [
        "// Generated by scripts/build-standards-data.py. Do not hand-edit.",
        "// The outer bars array preserves printed measures and repeated measures.",
        "",
        "export type StandardMeasure =",
        "  | string",
        "  | string[]",
        "  | { chords: string[]; durations: number[]; beats?: number };",
        "",
        "export type StandardChart = {",
        "  name: string;",
        "  key: string;",
        "  composer: string;",
        "  style: string;",
        "  timeSignature: [number, number];",
        "  bars: StandardMeasure[];",
        '  source: "chromatone" | "jazz-standards" | "ireal-real-book" | "manual-transcription" | "harmonic-reduction";',
        '  matchStatus: "exact" | "alias" | "fuzzy" | "manual" | "reduction";',
        "  sourceTitle: string;",
        "  note?: string;",
        "};",
        "",
        "export const STANDARDS: StandardChart[] = [",
    ]
    for record in records:
        lines.append("  {")
        for key, value in record.items():
            rendered = ts_value(value, 4).replace("\n", "\n  ")
            lines.append(f"    {key}: {rendered},")
        lines.append("  },")
    lines.append("];")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--song-list-html", type=Path, required=True)
    parser.add_argument("--chromatone-html", type=Path, required=True)
    parser.add_argument("--ireal-json", type=Path)
    parser.add_argument("--jazz-standards-dir", type=Path, required=True)
    parser.add_argument("--manual", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args()

    titles = catalog_titles(arguments.song_list_html)
    charts = load_chromatone(arguments.chromatone_html) + load_mike(arguments.jazz_standards_dir)
    if arguments.ireal_json and arguments.ireal_json.exists():
        charts += load_ireal(arguments.ireal_json)
    title_index = build_title_index(charts)
    manual_by_title: dict[str, dict[str, Any]] = {}
    if arguments.manual and arguments.manual.exists():
        manual = json.loads(arguments.manual.read_text(encoding="utf-8"))
        manual_by_title = {item["name"]: item for item in manual}

    records: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    for title in titles:
        if title in manual_by_title:
            raw = manual_by_title[title]
            manual_bars: list[Any] = []
            prior = normalize_pitch_name(raw["key"].split()[0])
            for bar in raw["bars"]:
                if isinstance(bar, str):
                    chord = normalize_chord(bar) or prior
                    manual_bars.append(chord)
                    prior = chord
                elif isinstance(bar, list):
                    chords = [chord for item in bar if (chord := normalize_chord(str(item)))]
                    if not chords:
                        chords = [prior]
                    manual_bars.append(chords[0] if len(chords) == 1 else chords)
                    prior = chords[-1]
                elif isinstance(bar, dict):
                    chords = [chord for item in bar.get("chords", []) if (chord := normalize_chord(str(item)))]
                    if not chords:
                        chords = [prior]
                    normalized_bar = dict(bar)
                    normalized_bar["chords"] = chords
                    manual_bars.append(normalized_bar)
                    prior = chords[-1]
            source = raw.get("source", "manual-transcription")
            match_status = raw.get("matchStatus", "reduction" if source == "harmonic-reduction" else "manual")
            record = {
                "name": title,
                "key": normalize_pitch_name(raw["key"]),
                "composer": raw.get("composer", ""),
                "style": raw.get("style", "Standard"),
                "timeSignature": raw.get("timeSignature", [4, 4]),
                "bars": manual_bars,
                "source": source,
                "matchStatus": match_status,
                "sourceTitle": raw.get("sourceTitle", title),
            }
            if raw.get("note"):
                record["note"] = raw["note"]
            records.append(record)
            report.append({"name": title, "status": match_status, "source": source, "bars": len(manual_bars), "note": raw.get("note")})
            continue
        chart, score, status = best_source(title, charts, title_index)
        if chart is None:
            report.append({"name": title, "status": "unresolved", "score": round(score, 4)})
            continue
        record = {
            "name": title,
            "key": chart.key,
            "composer": chart.composer,
            "style": chart.style,
            "timeSignature": list(chart.time_signature),
            "bars": chart.bars,
            "source": chart.source,
            "matchStatus": status,
            "sourceTitle": chart.source_title,
        }
        records.append(record)
        report.append(
            {
                "name": title,
                "status": status,
                "score": round(score, 4),
                "source": chart.source,
                "sourceTitle": chart.source_title,
                "bars": len(chart.bars),
            }
        )

    write_typescript(arguments.output, records)
    if arguments.report:
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unresolved = [item for item in report if item["status"] == "unresolved"]
    counts: dict[str, int] = {}
    for item in report:
        label = f'{item["status"]}:{item.get("source", "none")}'
        counts[label] = counts.get(label, 0) + 1
    print(json.dumps({"titles": len(titles), "written": len(records), "counts": counts, "unresolved": [item["name"] for item in unresolved]}, ensure_ascii=False, indent=2))
    if unresolved:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
