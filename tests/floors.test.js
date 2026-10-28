import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  mulberry32,
  hashSeed,
  dailySeed,
  harderMode,
  generateRun,
  validatePools,
  NORMALS_PER_FLOOR,
  MODE_BY_DEPTH,
} from "../game/floors.js";

const pools = JSON.parse(await readFile(new URL("../data/pools.json", import.meta.url), "utf8"));

test("pools.json passes validation", () => {
  assert.deepEqual(validatePools(pools), []);
});

test("validatePools reports structural problems", () => {
  assert.ok(validatePools(null).length);
  assert.ok(validatePools({ version: 1, floors: [] }).length);
  const broken = structuredClone(pools);
  broken.floors[0].elites[0].chars.push("龍"); // not in pool
  assert.ok(validatePools(broken).some(message => message.includes("龍")));
});

test("floor 1 uses bundled characters only", () => {
  const bundled = new Set([..."木憂響曖昧繊細鬱"]);
  assert.equal(pools.floors[0].bundledOnly, true);
  for (const entry of pools.floors[0].pool) assert.ok(bundled.has(entry.char), entry.char);
  for (const elite of pools.floors[0].elites) for (const ch of elite.chars) assert.ok(bundled.has(ch), ch);
});

test("boss word is fully bundled so floor 5's boss works offline", () => {
  const bundled = new Set([..."木憂響曖昧繊細鬱"]);
  for (const entry of pools.boss.chars) assert.ok(bundled.has(entry.char), entry.char);
});

test("mulberry32 is deterministic and in [0, 1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test("hashSeed and dailySeed are stable", () => {
  assert.equal(hashSeed("abc"), hashSeed("abc"));
  assert.notEqual(hashSeed("abc"), hashSeed("abd"));
  const date = new Date(2026, 9, 28);
  assert.equal(dailySeed(date), dailySeed(new Date(2026, 9, 28, 23, 59)));
  assert.notEqual(dailySeed(date), dailySeed(new Date(2026, 9, 29)));
});

test("harderMode climbs the recall ladder and saturates", () => {
  assert.equal(harderMode("copy"), "trace");
  assert.equal(harderMode("trace"), "cued");
  assert.equal(harderMode("cued"), "free");
  assert.equal(harderMode("free"), "free");
  assert.throws(() => harderMode("boss"), RangeError);
});

test("same seed generates the identical run", () => {
  const a = generateRun(12345, pools);
  const b = generateRun(12345, pools);
  assert.deepEqual(a, b);
});

test("different seeds generate different runs", () => {
  const a = JSON.stringify(generateRun(1, pools));
  const b = JSON.stringify(generateRun(2, pools));
  assert.notEqual(a, b);
});

test("run layout follows floor rules", () => {
  const run = generateRun(777, pools);
  assert.equal(run.floors.length, 5);
  run.floors.forEach((floor, index) => {
    assert.equal(floor.depth, index + 1);
    assert.equal(floor.mode, MODE_BY_DEPTH[index]);
    const normals = floor.encounters.filter(e => e.kind === "normal");
    const elites = floor.encounters.filter(e => e.kind === "elite");
    const bosses = floor.encounters.filter(e => e.kind === "boss");
    assert.equal(normals.length, Math.min(NORMALS_PER_FLOOR, pools.floors[index].pool.length));
    assert.equal(elites.length, 1);
    assert.equal(bosses.length, index === 4 ? 1 : 0);
    const chars = normals.map(e => e.char);
    assert.equal(new Set(chars).size, chars.length, "no duplicate normals");
    for (const encounter of normals) {
      assert.ok(encounter.reading && encounter.meaning, `entry data for ${encounter.char}`);
    }
    for (const elite of elites) {
      assert.ok(elite.chars.length >= 2);
      for (const entry of elite.chars) assert.ok(entry.reading && entry.meaning);
    }
  });
  const boss = run.floors[4].encounters.at(-1);
  assert.equal(boss.kind, "boss");
  assert.equal(boss.meaningOnly, true);
  assert.equal(boss.mode, "free");
});

test("generateRun rejects invalid pools", () => {
  assert.throws(() => generateRun(1, { version: 2 }), /invalid pools/);
});
