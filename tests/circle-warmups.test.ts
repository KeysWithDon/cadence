import assert from "node:assert/strict";
import test from "node:test";
import {
  CIRCLE_APPROACH_OPTIONS,
  buildCircleWarmup,
  circleApproachChords,
  circleDestinations,
  type CircleApproach,
} from "../app/circle-warmups.ts";

test("fourths and fifths visit all twelve roots and return home", () => {
  assert.deepEqual(
    circleDestinations("C", "fourths"),
    ["C", "F", "B♭", "E♭", "A♭", "D♭", "G♭", "B", "E", "A", "D", "G", "C"],
  );
  assert.deepEqual(
    circleDestinations("C", "fifths"),
    ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F", "C"],
  );

  const fromFlat = circleDestinations("B♭", "fourths");
  assert.equal(fromFlat.length, 13);
  assert.equal(new Set(fromFlat.slice(0, 12)).size, 12);
  assert.equal(fromFlat[0], "B♭");
  assert.equal(fromFlat.at(-1), "B♭");
});

test("every advertised substitution builds the expected route to C", () => {
  const expected: Record<CircleApproach, string[]> = {
    direct: [],
    "v-of-target": ["G7"],
    "ii-v": ["Dm7", "G7"],
    "iii-vi": ["Em7", "A7"],
    "vii-dim7": ["Bdim7"],
    "tritone-dominant": ["D♭7"],
    "backdoor-ii-v": ["Fm7", "B♭7"],
    "tritone-ii-v": ["A♭m7", "D♭7"],
    "iv-iv-minor": ["Fmaj7", "Fm7"],
    "gospel-chromatic-pull": ["A7", "A♭7", "G7"],
  };

  assert.equal(CIRCLE_APPROACH_OPTIONS.length, Object.keys(expected).length);
  for (const option of CIRCLE_APPROACH_OPTIONS) {
    assert.deepEqual(circleApproachChords("C", option.id), expected[option.id], option.label);
  }
});

test("circle approaches inherit each destination's written spelling",()=>{
  assert.deepEqual(circleApproachChords("D♭","ii-v"),["E♭m7","A♭7"]);
  assert.deepEqual(circleApproachChords("C♯","ii-v"),["D♯m7","G♯7"]);
});

test("ii-V is inserted before each destination with explicit teaching metadata", () => {
  const events = buildCircleWarmup({ startNote: "C", direction: "fourths", approach: "ii-v" });
  const targets = events.filter((event) => event.role === "target");
  const approaches = events.filter((event) => event.role === "approach");

  assert.equal(targets.length, 13);
  assert.equal(approaches.length, 24);
  assert.deepEqual(events.slice(0, 4).map((event) => event.chord), ["Cmaj7", "Gm7", "C7", "Fmaj7"]);
  assert.deepEqual(events.slice(-3).map((event) => event.chord), ["Dm7", "G7", "Cmaj7"]);
  assert.ok(approaches.every((event) => event.duration === 0.5));
  assert.ok(targets.every((event) => event.duration === 1));
  assert.deepEqual(
    events.filter((event) => event.legIndex === 1).map(({ role, legIndex, destinationNote, approachStep, approachStepCount }) => ({ role, legIndex, destinationNote, approachStep, approachStepCount })),
    [
      { role: "approach", legIndex: 1, destinationNote: "F", approachStep: 0, approachStepCount: 2 },
      { role: "approach", legIndex: 1, destinationNote: "F", approachStep: 1, approachStepCount: 2 },
      { role: "target", legIndex: 1, destinationNote: "F", approachStep: undefined, approachStepCount: undefined },
    ],
  );
});

test("direct mode contains only the thirteen targets and supports target quality", () => {
  const events = buildCircleWarmup({
    startNote: "E♭",
    direction: "fifths",
    approach: "direct",
    targetQuality: "dominant7",
  });
  assert.equal(events.length, 13);
  assert.ok(events.every((event) => event.role === "target" && event.duration === 1));
  assert.equal(events[0].chord, "E♭7");
  assert.equal(events.at(-1)?.chord, "E♭7");
  assert.deepEqual(events.map((event) => event.legIndex), Array.from({ length: 13 }, (_, index) => index));
});
