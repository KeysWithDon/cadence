import assert from "node:assert/strict";
import test from "node:test";
import { parseLeadSheet } from "../app/chart-reader.ts";

test("chart reader preserves written enharmonic spellings from a lead sheet", () => {
  const chart = parseLeadSheet("C♯maj7 | D♯m7 E♯m7 | F♯maj7 G♯7\nA♭maj7 | B♭m7 Cm7 | D♭maj7 E♭7");
  assert.deepEqual(chart.chords, ["C♯maj7", "D♯m7", "E♯m7", "F♯maj7", "G♯7", "A♭maj7", "B♭m7", "Cm7", "D♭maj7", "E♭7"]);
});

test("chart reader ignores lyric lines and accepts common ASCII chord notation", () => {
  const chart = parseLeadSheet("Can you hear the song\nCmaj7  Dm7  G7  Cmaj7\nDb7 | Cmaj7");
  assert.deepEqual(chart.chords, ["Cmaj7", "Dm7", "G7", "Cmaj7", "D♭7", "Cmaj7"]);
});
