import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBestiary,
  rememberInPracticeStore,
  BESTIARY_KEY,
  PRACTICE_KEY,
  MAX_BESTIARY_CHARACTERS,
} from "../game/bestiary.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

test("bestiary starts empty and records encounters", () => {
  const storage = fakeStorage();
  const bestiary = createBestiary(storage);
  assert.equal(bestiary.entry("木"), null);
  assert.equal(bestiary.recordEncounter({ char: "木", mode: "copy", won: true }), true);
  const entry = bestiary.entry("木");
  assert.equal(entry.encounters, 1);
  assert.equal(entry.defeats, 1);
  assert.equal(entry.bestMode, "copy");
  assert.ok(entry.lastSeen);
});

test("bestMode only improves toward free recall", () => {
  const bestiary = createBestiary(fakeStorage());
  bestiary.recordEncounter({ char: "木", mode: "cued", won: true });
  bestiary.recordEncounter({ char: "木", mode: "copy", won: true });
  assert.equal(bestiary.entry("木").bestMode, "cued");
  bestiary.recordEncounter({ char: "木", mode: "free", won: true });
  assert.equal(bestiary.entry("木").bestMode, "free");
  bestiary.recordEncounter({ char: "木", mode: "copy", won: false });
  assert.equal(bestiary.entry("木").bestMode, "free", "losses never raise bestMode");
  assert.equal(bestiary.entry("木").encounters, 4);
  assert.equal(bestiary.entry("木").defeats, 3);
});

test("data persists through storage and reloads", () => {
  const storage = fakeStorage();
  const first = createBestiary(storage);
  first.recordEncounter({ char: "憂", mode: "trace", won: true });
  first.recordRun({ victory: true, depthReached: 5, relics: ["brush"] });
  const second = createBestiary(storage);
  assert.equal(second.entry("憂").defeats, 1);
  assert.equal(second.data.bestDepth, 5);
  assert.equal(second.data.victories, 1);
  assert.equal(second.data.runs, 1);
  assert.deepEqual(second.data.relics, ["brush"]);
});

test("malformed stored data is discarded safely", () => {
  for (const bad of ["not json", "null", JSON.stringify({ version: 9 }), JSON.stringify({ version: 1, characters: "x" })]) {
    const bestiary = createBestiary(fakeStorage({ [BESTIARY_KEY]: bad }));
    assert.equal(bestiary.data.runs, 0);
    assert.deepEqual(bestiary.data.characters, {});
  }
});

test("partially invalid entries are sanitised on load", () => {
  const stored = JSON.stringify({
    version: 1,
    bestDepth: 99,
    victories: -3,
    runs: 2,
    relics: ["brush", 5, null],
    characters: {
      "木": { encounters: 2, defeats: 1, bestMode: "cued", lastSeen: "2026-10-01T00:00:00.000Z" },
      "憂": { encounters: "many", defeats: -1, bestMode: "boss", lastSeen: "nope" },
    },
  });
  const bestiary = createBestiary(fakeStorage({ [BESTIARY_KEY]: stored }));
  assert.equal(bestiary.data.bestDepth, 5, "clamped");
  assert.equal(bestiary.data.victories, 0, "negative discarded");
  assert.deepEqual(bestiary.data.relics, ["brush"]);
  assert.equal(bestiary.entry("木").bestMode, "cued");
  const repaired = bestiary.entry("憂");
  assert.deepEqual(repaired, { encounters: 0, defeats: 0, bestMode: null, lastSeen: null });
});

test("bestiary caps the number of tracked characters", () => {
  const bestiary = createBestiary(fakeStorage());
  for (let i = 0; i < MAX_BESTIARY_CHARACTERS; i += 1) {
    bestiary.recordEncounter({ char: String.fromCodePoint(0x4e00 + i), mode: "copy", won: false });
  }
  assert.equal(bestiary.recordEncounter({ char: "鬱", mode: "copy", won: true }), false);
  assert.equal(bestiary.entry("鬱"), null);
});

test("clear removes only the bestiary key", () => {
  const storage = fakeStorage({ [PRACTICE_KEY]: JSON.stringify({ version: 1, characters: {} }) });
  const bestiary = createBestiary(storage);
  bestiary.recordEncounter({ char: "木", mode: "copy", won: true });
  assert.ok(storage.dump()[BESTIARY_KEY]);
  bestiary.clear();
  assert.equal(storage.dump()[BESTIARY_KEY], undefined);
  assert.ok(storage.dump()[PRACTICE_KEY], "practice data untouched");
  assert.equal(bestiary.entry("木"), null);
});

test("rejects invalid inputs", () => {
  const bestiary = createBestiary(fakeStorage());
  assert.throws(() => bestiary.recordEncounter({ char: "", mode: "copy", won: true }), RangeError);
  assert.throws(() => bestiary.recordEncounter({ char: "木", mode: "boss", won: true }), RangeError);
  assert.throws(() => createBestiary(null), TypeError);
});

test("practice bridge writes the practice panel's exact shape", () => {
  const storage = fakeStorage();
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  assert.equal(rememberInPracticeStore(storage, "木", now), true);
  const store = JSON.parse(storage.dump()[PRACTICE_KEY]);
  assert.equal(store.version, 1);
  assert.deepEqual(store.characters["木"], {
    remembered: true,
    nextReviewAt: "2026-10-29T12:00:00.000Z",
    attempts: [],
  });
});

test("practice bridge preserves existing attempts and other characters", () => {
  const existing = {
    version: 1,
    characters: {
      "木": { remembered: false, nextReviewAt: null, attempts: [{ id: "a1", createdAt: "2026-10-01T00:00:00.000Z", completed: true, strokes: [] }] },
      "水": { remembered: true, nextReviewAt: "2026-11-01T00:00:00.000Z", attempts: [] },
    },
  };
  const storage = fakeStorage({ [PRACTICE_KEY]: JSON.stringify(existing) });
  rememberInPracticeStore(storage, "木", Date.parse("2026-10-28T00:00:00.000Z"));
  const store = JSON.parse(storage.dump()[PRACTICE_KEY]);
  assert.equal(store.characters["木"].remembered, true);
  assert.equal(store.characters["木"].attempts.length, 1, "attempts preserved");
  assert.deepEqual(store.characters["水"], existing.characters["水"], "other characters untouched");
});

test("practice bridge survives malformed practice data without destroying the key shape", () => {
  const storage = fakeStorage({ [PRACTICE_KEY]: "corrupted{{{" });
  assert.equal(rememberInPracticeStore(storage, "木"), true);
  const store = JSON.parse(storage.dump()[PRACTICE_KEY]);
  assert.equal(store.version, 1);
  assert.equal(store.characters["木"].remembered, true);
});
