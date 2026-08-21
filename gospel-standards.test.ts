import assert from "node:assert/strict";
import test from "node:test";
import { GOSPEL_STANDARDS } from "../app/gospel-standards.ts";
import { standardTimeline } from "../app/standard-timeline.ts";

test("gospel fake-book studies retain the C-major easy-chart format", () => {
  assert.ok(GOSPEL_STANDARDS.length >= 100);
  assert.ok(GOSPEL_STANDARDS.some(chart => chart.name === "Amazing Grace"));
  assert.ok(GOSPEL_STANDARDS.some(chart => chart.name === "Victory in Jesus"));
  for (const chart of GOSPEL_STANDARDS) {
    assert.equal(chart.key, "C");
    assert.ok(standardTimeline(chart).length > 0);
  }
});
