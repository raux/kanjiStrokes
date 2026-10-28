// Ink Dungeon floor generation: seeded PRNG and run layout.
// Pure module: no DOM, no network, no storage.

export const MODE_BY_DEPTH = ["copy", "trace", "cued", "free", "free"];
export const NORMALS_PER_FLOOR = 5;

const MODE_ORDER = ["copy", "trace", "cued", "free"];

export function harderMode(mode) {
  const index = MODE_ORDER.indexOf(mode);
  if (index === -1) throw new RangeError(`unknown mode: ${mode}`);
  return MODE_ORDER[Math.min(index + 1, MODE_ORDER.length - 1)];
}

// Small, dependency-free deterministic PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailySeed(date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return hashSeed(`ink-dungeon:${day}`);
}

function samplePool(pool, count, rng) {
  const copy = [...pool];
  const out = [];
  while (out.length < count && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

export function validatePools(pools) {
  const errors = [];
  if (!pools || pools.version !== 1 || !Array.isArray(pools.floors)) {
    return ["pools must be { version: 1, floors: [...] }"];
  }
  if (pools.floors.length !== 5) errors.push(`expected 5 floors, found ${pools.floors.length}`);
  pools.floors.forEach((floor, index) => {
    const label = `floor ${index + 1}`;
    if (floor.depth !== index + 1) errors.push(`${label}: depth mismatch`);
    if (!floor.name || !floor.glyph) errors.push(`${label}: missing name/glyph`);
    if (!MODE_ORDER.includes(floor.mode)) errors.push(`${label}: bad mode ${floor.mode}`);
    if (!Array.isArray(floor.pool) || floor.pool.length < 1) errors.push(`${label}: empty pool`);
    const chars = new Set();
    for (const entry of floor.pool || []) {
      if (!entry.char || !entry.reading || !entry.meaning) errors.push(`${label}: incomplete entry ${JSON.stringify(entry)}`);
      if (chars.has(entry.char)) errors.push(`${label}: duplicate ${entry.char}`);
      chars.add(entry.char);
    }
    for (const elite of floor.elites || []) {
      if (!elite.word || !elite.reading || !elite.meaning || !Array.isArray(elite.chars) || elite.chars.length < 2) {
        errors.push(`${label}: malformed elite ${JSON.stringify(elite)}`);
        continue;
      }
      for (const ch of elite.chars) {
        if (!chars.has(ch)) errors.push(`${label}: elite character ${ch} is not in the floor pool`);
      }
    }
    if (!Array.isArray(floor.elites) || !floor.elites.length) errors.push(`${label}: needs at least one elite`);
  });
  const boss = pools.boss;
  if (!boss || !boss.word || !boss.reading || !boss.meaning || !Array.isArray(boss.chars) || boss.chars.length < 2) {
    errors.push("missing or malformed boss");
  }
  return errors;
}

function entryFor(floor, char) {
  return floor.pool.find(entry => entry.char === char) || null;
}

// Build a deterministic run layout from a 32-bit seed and validated pools.
export function generateRun(seed, pools) {
  const problems = validatePools(pools);
  if (problems.length) throw new Error(`invalid pools: ${problems[0]}`);
  const rng = mulberry32(seed >>> 0);
  const floors = pools.floors.map(floor => {
    const normals = samplePool(floor.pool, NORMALS_PER_FLOOR, rng).map(entry => ({
      kind: "normal",
      mode: floor.mode,
      char: entry.char,
      reading: entry.reading,
      meaning: entry.meaning,
    }));
    const elite = floor.elites[Math.floor(rng() * floor.elites.length)];
    const encounters = [...normals, {
      kind: "elite",
      mode: floor.mode,
      word: elite.word,
      reading: elite.reading,
      meaning: elite.meaning,
      chars: elite.chars.map(char => {
        const entry = entryFor(floor, char);
        return { char, reading: entry.reading, meaning: entry.meaning };
      }),
    }];
    if (floor.depth === 5) {
      const boss = pools.boss;
      encounters.push({
        kind: "boss",
        mode: "free",
        meaningOnly: true,
        word: boss.word,
        reading: boss.reading,
        meaning: boss.meaning,
        chars: boss.chars.map(entry => ({ ...entry })),
      });
    }
    return {
      depth: floor.depth,
      name: floor.name,
      glyph: floor.glyph,
      mode: floor.mode,
      bundledOnly: Boolean(floor.bundledOnly),
      encounters,
    };
  });
  return { seed: seed >>> 0, floors };
}
