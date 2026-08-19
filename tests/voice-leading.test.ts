import assert from "node:assert/strict";
import test from "node:test";
import { parseChordSymbol, voiceLeadProgression } from "../app/voice-leading";

const pc = (midi: number) => ((midi % 12) + 12) % 12;

test("ii-V-I holds guide tones and resolves the dominant third and seventh", () => {
  const [ii, dominant, tonic] = voiceLeadProgression(["Dm7", "G7", "Cmaj7"], { style: "jazz" });
  assert.ok(ii.upperVoices.some((note) => dominant.upperVoices.includes(note) && pc(note) === 5), "F should remain common from ii to V");
  assert.ok(ii.upperVoices.some((note, index) => pc(note) === 0 && dominant.upperVoices[index] === note - 1), "C should move to B");
  assert.ok(dominant.upperVoices.some((note, index) => pc(note) === 11 && tonic.upperVoices[index] === note + 1), "B should resolve to C");
  assert.ok(dominant.upperVoices.some((note, index) => pc(note) === 5 && tonic.upperVoices[index] === note - 1), "F should resolve to E");
});

test("secondary and altered dominants resolve every active guide tone", () => {
  const [a7, dm] = voiceLeadProgression(["A7", "Dm7"], { style: "gospel" });
  assert.ok(a7.upperVoices.some((note, index) => pc(note) === 1 && dm.upperVoices[index] === note + 1), "C sharp should resolve to D");
  assert.ok(a7.upperVoices.some((note, index) => pc(note) === 7 && dm.upperVoices[index] === note - 2), "G should resolve to F");

  const [altered, c] = voiceLeadProgression(["G7b9", "Cmaj7"], { style: "gospel" });
  assert.ok(altered.upperVoices.some((note, index) => pc(note) === 8 && c.upperVoices[index] === note - 1), "A flat should resolve to G");
  assert.equal(c.diagnostics.resolutions.length, 3);
});

test("slash bass is hard constrained and the bass line remains melodic", () => {
  const events = voiceLeadProgression(["C", "G/B", "Am7", "Fmaj7"], { style: "ccm" });
  assert.deepEqual(events.map((event) => event.bass), [48, 47, 45, 41]);
  assert.equal(pc(events[1].bass), 11);
  assert.ok(events.every((event) => event.bass < event.upperVoices[0]));
});

test("written 13ths sound the guide tones and all stacked extensions", () => {
  const [g13] = voiceLeadProgression(["G13"], { style: "jazz" });
  const sounded = new Set(g13.upperVoices.map(pc));
  for (const required of [11, 5, 9, 0, 4]) assert.ok(sounded.has(required), `missing pitch class ${required}`);
  assert.equal(g13.upperVoices.length, 5);
});

test("repeated chords vary gently without register drift", () => {
  const events = voiceLeadProgression(Array.from({ length: 8 }, () => "Cmaj7"));
  assert.ok(events.some((event, index) => index > 0 && event.upperVoices.join(",") !== events[index - 1].upperVoices.join(",")));
  assert.ok(events.every((event) => event.upperVoices[0] >= 48 && event.upperVoices.at(-1)! <= 76));
  assert.ok(Math.max(...events.map((event) => event.upperVoices.at(-1)!)) - Math.min(...events.map((event) => event.upperVoices.at(-1)!)) <= 4);
});

test("a substitution causes the destination to be voiced again in context", () => {
  const original = voiceLeadProgression(["Cmaj7", "Fmaj7", "Dm7", "G7"]);
  const substituted = voiceLeadProgression(["Cmaj7", "Fmaj7", "Bm7", "E7", "G7"]);
  assert.notDeepEqual(original[3].upperVoices, substituted[4].upperVoices);
  assert.equal(substituted[4].diagnostics.upperMovement.length, 4);
});

test("parser distinguishes add, sus, altered fifth, and minor-major symbols", () => {
  const add9 = parseChordSymbol("Cadd9");
  assert.ok(add9.roles.some((role) => role.interval === 2));
  assert.ok(!add9.roles.some((role) => role.interval === 10));
  assert.ok(parseChordSymbol("Esus2").roles.some((role) => role.interval === 2 && role.required));
  assert.ok(parseChordSymbol("Cmaj7#5").roles.some((role) => role.interval === 8 && role.required));
  assert.equal(parseChordSymbol("Fm/maj7").quality, "minor-major");
});

