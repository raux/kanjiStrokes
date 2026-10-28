// Ink Dungeon stroke scorer.
// Pure module: no DOM, no network, no storage. Works on normalized 0..1 point
// arrays so it can be tested in Node and reused by the browser UI, which is
// responsible for sampling KanjiVG reference paths into point arrays.
//
// Verdicts are heuristic game feedback ("the stroke landed"), never an
// authoritative judgment of calligraphy.

export const RESAMPLE_POINTS = 32;

// Thresholds are data, not code, so they can be tuned per recall mode.
// Distances are in normalized sheet units (0..1); angles in degrees.
// Deeper recall modes are judged more leniently on shape: writing from
// memory earns slack, but stroke count/order is still enforced upstream.
export const THRESHOLDS = {
  copy:  { start: 0.12, end: 0.12, mean: 0.085, angle: 35, grazeFactor: 1.6 },
  trace: { start: 0.13, end: 0.13, mean: 0.095, angle: 40, grazeFactor: 1.6 },
  cued:  { start: 0.16, end: 0.16, mean: 0.12,  angle: 50, grazeFactor: 1.7 },
  free:  { start: 0.20, end: 0.20, mean: 0.15,  angle: 60, grazeFactor: 1.8 },
};

export const MODES = Object.keys(THRESHOLDS);

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

// Arc-length resampling to n points. Accepts >= 2 input points.
export function resample(points, n = RESAMPLE_POINTS) {
  if (!Array.isArray(points) || points.length < 2) throw new RangeError("resample needs at least 2 points");
  if (!Number.isInteger(n) || n < 2) throw new RangeError("resample target must be an integer >= 2");
  const total = pathLength(points);
  if (total === 0) return Array.from({ length: n }, () => ({ x: points[0].x, y: points[0].y }));
  const step = total / (n - 1);
  const out = [{ x: points[0].x, y: points[0].y }];
  let segmentIndex = 1;
  let travelled = 0;
  let previous = points[0];
  for (let target = step; out.length < n - 1; target += step) {
    while (segmentIndex < points.length) {
      const segment = distance(previous, points[segmentIndex]);
      if (travelled + segment >= target || segmentIndex === points.length - 1) {
        const remaining = target - travelled;
        const t = segment === 0 ? 0 : Math.min(1, remaining / segment);
        out.push({
          x: previous.x + (points[segmentIndex].x - previous.x) * t,
          y: previous.y + (points[segmentIndex].y - previous.y) * t,
        });
        break;
      }
      travelled += segment;
      previous = points[segmentIndex];
      segmentIndex += 1;
    }
  }
  out.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return out;
}

function angleOf(points) {
  const a = points[0];
  const b = points[points.length - 1];
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

export function angleDifference(a, b) {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

// Compare one drawn stroke against one reference stroke.
// Both are arrays of {x, y} in normalized 0..1 sheet space.
export function scoreStroke(drawn, reference, mode = "copy") {
  const limits = THRESHOLDS[mode];
  if (!limits) throw new RangeError(`unknown mode: ${mode}`);
  if (!Array.isArray(drawn) || drawn.length < 2) {
    return { verdict: "miss", reason: "too-short", metrics: null };
  }
  const d = resample(drawn);
  const r = resample(reference);
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) sum += distance(d[i], r[i]);
  const metrics = {
    start: distance(d[0], r[0]),
    end: distance(d[d.length - 1], r[r.length - 1]),
    mean: sum / d.length,
    angle: angleDifference(angleOf(d), angleOf(r)),
  };
  const within = factor =>
    metrics.start <= limits.start * factor &&
    metrics.end <= limits.end * factor &&
    metrics.mean <= limits.mean * factor &&
    metrics.angle <= limits.angle * Math.min(factor, 1.4);
  let verdict = "miss";
  if (within(1)) verdict = "hit";
  else if (within(limits.grazeFactor)) verdict = "graze";
  return { verdict, reason: null, metrics };
}

// Score a whole attempt in canonical order: drawn stroke i vs reference i.
// Out-of-order writing therefore scores as misses (v1 policy).
export function scoreAttempt(drawnStrokes, referenceStrokes, mode = "copy") {
  const results = [];
  const count = Math.min(drawnStrokes.length, referenceStrokes.length);
  for (let i = 0; i < count; i += 1) {
    results.push(scoreStroke(drawnStrokes[i], referenceStrokes[i], mode));
  }
  for (let i = count; i < drawnStrokes.length; i += 1) {
    results.push({ verdict: "miss", reason: "extra-stroke", metrics: null });
  }
  const tally = { hit: 0, graze: 0, miss: 0 };
  for (const result of results) tally[result.verdict] += 1;
  return {
    strokes: results,
    hits: tally.hit,
    grazes: tally.graze,
    misses: tally.miss,
    drawnCount: drawnStrokes.length,
    referenceCount: referenceStrokes.length,
    strokeCountMatch: drawnStrokes.length === referenceStrokes.length,
  };
}
