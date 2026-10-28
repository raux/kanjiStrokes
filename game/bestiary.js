// Ink Dungeon bestiary: persistent meta-progression.
// Storage is injectable (anything with getItem/setItem/removeItem) so the
// module is testable in Node. The browser passes window.localStorage.
//
// Stored under its own versioned key, fully independent of the practice
// panel's kanjiStrokes.practice.v1 data.

export const BESTIARY_KEY = "kanjiStrokes.dungeon.v1";
export const MAX_BESTIARY_CHARACTERS = 400;

const MODES = ["copy", "trace", "cued", "free"];
const MODE_RANK = { copy: 0, trace: 1, cued: 2, free: 3 };

function emptyData() {
  return { version: 1, bestDepth: 0, victories: 0, runs: 0, relics: [], characters: {} };
}

function sanitiseEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return {
    encounters: Number.isInteger(entry.encounters) && entry.encounters >= 0 ? entry.encounters : 0,
    defeats: Number.isInteger(entry.defeats) && entry.defeats >= 0 ? entry.defeats : 0,
    bestMode: MODES.includes(entry.bestMode) ? entry.bestMode : null,
    lastSeen: typeof entry.lastSeen === "string" && !Number.isNaN(Date.parse(entry.lastSeen)) ? entry.lastSeen : null,
  };
}

export function createBestiary(storage) {
  if (!storage || typeof storage.getItem !== "function") throw new TypeError("bestiary needs a storage object");

  let data = load();

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(BESTIARY_KEY));
      if (!parsed || parsed.version !== 1 || typeof parsed.characters !== "object" || !parsed.characters) return emptyData();
      const characters = {};
      for (const [char, entry] of Object.entries(parsed.characters).slice(0, MAX_BESTIARY_CHARACTERS)) {
        const clean = sanitiseEntry(entry);
        if (clean) characters[char] = clean;
      }
      return {
        version: 1,
        bestDepth: Number.isInteger(parsed.bestDepth) ? Math.max(0, Math.min(5, parsed.bestDepth)) : 0,
        victories: Number.isInteger(parsed.victories) && parsed.victories >= 0 ? parsed.victories : 0,
        runs: Number.isInteger(parsed.runs) && parsed.runs >= 0 ? parsed.runs : 0,
        relics: Array.isArray(parsed.relics) ? parsed.relics.filter(id => typeof id === "string").slice(0, 10) : [],
        characters,
      };
    } catch {
      return emptyData();
    }
  }

  function save() {
    try {
      storage.setItem(BESTIARY_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  return {
    get data() {
      return data;
    },
    recordEncounter({ char, mode, won }) {
      if (typeof char !== "string" || !char) throw new RangeError("char required");
      if (!MODES.includes(mode)) throw new RangeError(`unknown mode: ${mode}`);
      if (!data.characters[char]) {
        if (Object.keys(data.characters).length >= MAX_BESTIARY_CHARACTERS) return false;
        data.characters[char] = { encounters: 0, defeats: 0, bestMode: null, lastSeen: null };
      }
      const entry = data.characters[char];
      entry.encounters += 1;
      entry.lastSeen = new Date().toISOString();
      if (won) {
        entry.defeats += 1;
        if (entry.bestMode === null || MODE_RANK[mode] > MODE_RANK[entry.bestMode]) entry.bestMode = mode;
      }
      return save();
    },
    recordRun({ victory, depthReached, relics }) {
      data.runs += 1;
      if (victory) data.victories += 1;
      if (Number.isInteger(depthReached)) data.bestDepth = Math.max(data.bestDepth, Math.min(5, depthReached));
      for (const id of relics || []) {
        if (typeof id === "string" && !data.relics.includes(id)) data.relics.push(id);
      }
      return save();
    },
    entry(char) {
      return data.characters[char] || null;
    },
    clear() {
      data = emptyData();
      try {
        storage.removeItem(BESTIARY_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// Bridge: mark a defeated kanji as "remembered" in the practice panel's own
// store, writing exactly the shape app.js writes and preserving existing data.
export const PRACTICE_KEY = "kanjiStrokes.practice.v1";
export const PRACTICE_REVIEW_MS = 24 * 60 * 60 * 1000;

export function rememberInPracticeStore(storage, char, now = Date.now()) {
  if (!storage || typeof storage.getItem !== "function") throw new TypeError("storage required");
  if (typeof char !== "string" || !char) throw new RangeError("char required");
  let store;
  try {
    const parsed = JSON.parse(storage.getItem(PRACTICE_KEY));
    store = parsed && parsed.version === 1 && parsed.characters && typeof parsed.characters === "object"
      ? parsed
      : { version: 1, characters: {} };
  } catch {
    store = { version: 1, characters: {} };
  }
  const existing = store.characters[char];
  store.characters[char] = {
    remembered: true,
    nextReviewAt: new Date(now + PRACTICE_REVIEW_MS).toISOString(),
    attempts: existing && Array.isArray(existing.attempts) ? existing.attempts : [],
  };
  try {
    storage.setItem(PRACTICE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
