import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resample,
  scoreStroke,
  scoreAttempt,
  angleDifference,
  THRESHOLDS,
  MODES,
} from "../game/scorer.js";

function line(x1, y1, x2, y2, n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    x: x1 + ((x2 - x1) * i) / (n - 1),
    y: y1 + ((y2 - y1) * i) / (n - 1),
  }));
}

function jitter(points, amount, seedStep = 0.37) {
  return points.map((p, i) => ({
    x: p.x + Math.sin(i * seedStep) * amount,
    y: p.y + Math.cos(i * seedStep) * amount,
  }));
}

// A reference "character": horizontal top stroke, vertical center stroke.
const reference = [line(0.2, 0.3, 0.8, 0.3), line(0.5, 0.15, 0.5, 0.85)];

test("resample produces exactly n points preserving endpoints", () => {
  const out = resample(line(0, 0, 1, 1, 5), 32);
  assert.equal(out.length, 32);
  assert.deepEqual(out[0], { x: 0, y: 0 });
  assert.deepEqual(out[31], { x: 1, y: 1 });
});

test("resample spaces points evenly by arc length", () => {
  const out = resample(line(0, 0, 1, 0, 3), 11);
  for (let i = 0; i < out.length; i += 1) {
    assert.ok(Math.abs(out[i].x - i / 10) < 1e-9, `point ${i} at ${out[i].x}`);
    assert.equal(out[i].y, 0);
  }
});

test("resample rejects degenerate input", () => {
  assert.throws(() => resample([{ x: 0, y: 0 }]), RangeError);
  assert.throws(() => resample(line(0, 0, 1, 1), 1), RangeError);
});

test("resample of a zero-length path repeats the point", () => {
  const out = resample([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }], 4);
  assert.equal(out.length, 4);
  for (const p of out) assert.deepEqual(p, { x: 0.5, y: 0.5 });
});

test("angleDifference wraps correctly", () => {
  assert.equal(angleDifference(170, -170), 20);
  assert.equal(angleDifference(0, 180), 180);
  assert.equal(angleDifference(45, 45), 0);
});

test("exact tracing scores a hit in every mode", () => {
  for (const mode of MODES) {
    const { verdict } = scoreStroke(reference[0], reference[0], mode);
    assert.equal(verdict, "hit", `mode ${mode}`);
  }
});

test("lightly imprecise writing still hits", () => {
  const drawn = jitter(reference[0], 0.015);
  assert.equal(scoreStroke(drawn, reference[0], "copy").verdict, "hit");
});

test("moderately sloppy writing grazes in copy mode", () => {
  const drawn = line(0.285, 0.385, 0.885, 0.385); // whole stroke offset by ~0.12
  const { verdict } = scoreStroke(drawn, reference[0], "copy");
  assert.equal(verdict, "graze");
});

test("the same sloppy stroke hits under lenient free-recall thresholds", () => {
  const drawn = line(0.285, 0.385, 0.885, 0.385);
  assert.equal(scoreStroke(drawn, reference[0], "free").verdict, "hit");
});

test("reversed stroke direction is a miss", () => {
  const drawn = line(0.8, 0.3, 0.2, 0.3); // right-to-left
  assert.equal(scoreStroke(drawn, reference[0], "copy").verdict, "miss");
});

test("a stroke drawn across the sheet from the target is a miss", () => {
  const drawn = line(0.2, 0.8, 0.8, 0.8);
  assert.equal(scoreStroke(drawn, reference[0], "copy").verdict, "miss");
});

test("a too-short gesture is a miss with a reason", () => {
  const result = scoreStroke([{ x: 0.5, y: 0.5 }], reference[0], "copy");
  assert.equal(result.verdict, "miss");
  assert.equal(result.reason, "too-short");
});

test("unknown mode throws", () => {
  assert.throws(() => scoreStroke(reference[0], reference[0], "boss"), RangeError);
});

test("scoreAttempt judges strokes in canonical order", () => {
  const swapped = [reference[1], reference[0]];
  const result = scoreAttempt(swapped, reference, "copy");
  assert.equal(result.misses, 2, "out-of-order writing scores as misses");
  const correct = scoreAttempt(reference, reference, "copy");
  assert.equal(correct.hits, 2);
  assert.equal(correct.strokeCountMatch, true);
});

test("scoreAttempt flags extra and missing strokes", () => {
  const extra = scoreAttempt([...reference, line(0.1, 0.1, 0.2, 0.2)], reference, "copy");
  assert.equal(extra.strokes[2].reason, "extra-stroke");
  assert.equal(extra.strokeCountMatch, false);
  const missing = scoreAttempt([reference[0]], reference, "copy");
  assert.equal(missing.strokes.length, 1);
  assert.equal(missing.strokeCountMatch, false);
});

test("thresholds tighten monotonically from free to copy", () => {
  for (const key of ["start", "end", "mean", "angle"]) {
    assert.ok(THRESHOLDS.copy[key] <= THRESHOLDS.trace[key]);
    assert.ok(THRESHOLDS.trace[key] <= THRESHOLDS.cued[key]);
    assert.ok(THRESHOLDS.cued[key] <= THRESHOLDS.free[key]);
  }
});
