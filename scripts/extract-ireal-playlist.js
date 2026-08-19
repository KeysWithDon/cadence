#!/usr/bin/env node
/**
 * Convert an iReal Pro playlist into measure-aware JSON for
 * build-standards-data.py.
 *
 * The parser module is deliberately supplied as an argument so the extractor
 * can use the maintained MIT-licensed daumling/ireal-renderer implementation
 * without vendoring it into the application bundle:
 *
 *   node scripts/extract-ireal-playlist.js \
 *     tmp/pdfs/realbook-ireal.html \
 *     tmp/ireal-renderer/src/ireal-renderer.js \
 *     tmp/pdfs/realbook-ireal.json
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const [inputPath, parserPath, outputPath] = process.argv.slice(2);
if (!inputPath || !parserPath || !outputPath) {
  console.error("usage: extract-ireal-playlist.js PLAYLIST_HTML PARSER_MODULE OUTPUT_JSON");
  process.exit(2);
}

const { Playlist, iRealRenderer } = require(path.resolve(parserPath));
const playlist = new Playlist(fs.readFileSync(inputPath, "utf8"));
const renderer = new iRealRenderer();

function decodeEntities(value) {
  return value
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&");
}

function timeSignature(annotation) {
  const match = /^T(\d+)$/.exec(annotation || "");
  if (!match) return null;
  if (match[1] === "12") return [12, 8];
  if (match[1].length !== 2) return null;
  const numerator = Number(match[1][0]);
  const denominator = Number(match[1][1]);
  return numerator > 0 && denominator > 0 ? [numerator, denominator] : null;
}

function beatsFor(signature) {
  return signature[0] * 4 / signature[1];
}

function chordName(chord) {
  if (!chord) return null;
  if (["x", "r", "p", "n"].includes(chord.note)) return chord.note;
  const modifiers = String(chord.modifiers || "").replace(/\*.*?\*/g, "");
  const bass = chord.over ? `/${chord.over.note}${chord.over.modifiers || ""}` : "";
  return `${chord.note}${modifiers}${bass}`;
}

function cloneBar(bar) {
  return JSON.parse(JSON.stringify(bar));
}

function measureGroups(cells) {
  const groups = [];
  let current = [];
  const leftBar = /[([{]/;
  const rightBar = /[)\]}Z]/;
  for (const cell of cells) {
    if (current.length && leftBar.test(cell.bars || "")) {
      groups.push(current);
      current = [];
    }
    current.push(cell);
    if (rightBar.test(cell.bars || "")) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function compactEvents(events, beats) {
  const chords = [];
  const durations = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const nextPosition = events[index + 1]?.position ?? 1;
    const duration = Math.max(0, (nextPosition - event.position) * beats);
    if (duration <= 0) continue;
    if (chords[chords.length - 1] === event.chord) {
      durations[durations.length - 1] += duration;
    } else {
      chords.push(event.chord);
      durations.push(duration);
    }
  }
  if (!chords.length) return null;
  if (chords.length === 1) return chords[0];
  const equal = durations.every((duration) => Math.abs(duration - durations[0]) < 0.0001);
  if (equal) return chords;
  return {
    chords,
    durations: durations.map((duration) => Number(duration.toFixed(4))),
  };
}

function parseSong(song) {
  renderer.parse(song);
  const groups = measureGroups(song.cells);
  let signature = [4, 4];
  for (const group of groups) {
    const found = group.flatMap((cell) => cell.annots || []).map(timeSignature).find(Boolean);
    if (found) {
      signature = found;
      break;
    }
  }
  const primarySignature = signature;
  let activeChord = null;
  let pendingDoubleRepeat = null;
  const bars = [];

  for (const group of groups) {
    const nextSignature = group.flatMap((cell) => cell.annots || []).map(timeSignature).find(Boolean);
    if (nextSignature) signature = nextSignature;
    const hasBoundary = group.some((cell) => [...(cell.bars || "")].some((mark) => "()[]{}Z".includes(mark)));
    const tokens = group.map((cell) => chordName(cell.chord));
    const meaningful = tokens.filter(Boolean);

    // Row padding has neither a barline nor a chord and is not a musical bar.
    if (!hasBoundary && !meaningful.length) continue;

    if (pendingDoubleRepeat && !meaningful.length) {
      bars.push(cloneBar(pendingDoubleRepeat));
      activeChord = Array.isArray(pendingDoubleRepeat)
        ? pendingDoubleRepeat[pendingDoubleRepeat.length - 1]
        : typeof pendingDoubleRepeat === "string"
          ? pendingDoubleRepeat
          : pendingDoubleRepeat.chords[pendingDoubleRepeat.chords.length - 1];
      pendingDoubleRepeat = null;
      continue;
    }

    if (meaningful.includes("r")) {
      if (bars.length >= 2) {
        const first = cloneBar(bars[bars.length - 2]);
        const second = cloneBar(bars[bars.length - 1]);
        bars.push(first);
        pendingDoubleRepeat = second;
      }
      continue;
    }

    if (meaningful.includes("x")) {
      if (bars.length) bars.push(cloneBar(bars[bars.length - 1]));
      continue;
    }

    const cellCount = Math.max(1, group.length);
    const events = [];
    for (let cellIndex = 0; cellIndex < group.length; cellIndex += 1) {
      const token = tokens[cellIndex];
      if (!token || token === "p") continue;
      if (token === "n") {
        events.push({ position: cellIndex / cellCount, chord: "N.C." });
        activeChord = "N.C.";
        continue;
      }
      events.push({ position: cellIndex / cellCount, chord: token });
      activeChord = token;
    }

    if (!events.length && activeChord) {
      events.push({ position: 0, chord: activeChord });
    } else if (events.length && events[0].position > 0 && activeChord && activeChord !== events[0].chord) {
      events.unshift({ position: 0, chord: activeChord });
    }
    if (!events.length) continue;

    const beats = beatsFor(signature);
    const bar = compactEvents(events, beats);
    if (!bar) continue;
    if (signature[0] !== primarySignature[0] || signature[1] !== primarySignature[1]) {
      if (typeof bar === "string") {
        bars.push({ chords: [bar], durations: [beats], beats });
      } else if (Array.isArray(bar)) {
        bars.push({ chords: bar, durations: bar.map(() => beats / bar.length), beats });
      } else {
        bars.push({ ...bar, beats });
      }
    } else {
      bars.push(bar);
    }
  }

  return {
    title: decodeEntities(song.title),
    composer: decodeEntities(song.composer || ""),
    key: song.key,
    style: decodeEntities(song.style || "Standard"),
    timeSignature: primarySignature,
    bars,
  };
}

const charts = playlist.songs.map(parseSong).filter((chart) => chart.title && chart.bars.length);
fs.writeFileSync(outputPath, `${JSON.stringify(charts, null, 2)}\n`);
console.log(JSON.stringify({ playlist: playlist.name, charts: charts.length, output: outputPath }));
