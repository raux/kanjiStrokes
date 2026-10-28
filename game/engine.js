// Ink Dungeon run engine: a pure state machine.
// No DOM, no network, no storage. The browser UI feeds it stroke verdicts from
// the scorer and stroke counts from loaded KanjiVG data.

import { harderMode } from "./floors.js";

export const BALANCE = {
  maxHp: 5,
  maxInk: 80,
  floorInkRefill: 40,
  missLimit: 3,
  normalHpPenalty: 1,
  eliteHpPenalty: 2,
  revealInkCost: 6,
  replayInkCost: 4,
  inkCost: { hit: 1, graze: 2, miss: 2 },
  dryDamage: 0.5,
};

export const RELICS = {
  brush: {
    id: "brush",
    name: "Calligrapher's Brush",
    text: "Reveal the ghost guide once per floor at no ink cost.",
  },
  "still-water": {
    id: "still-water",
    name: "Still Water",
    text: "Reference replay costs half ink.",
  },
  "second-stroke": {
    id: "second-stroke",
    name: "Second Stroke",
    text: "The first missed stroke of each encounter is forgiven.",
  },
};

// Relic granted by the elite of each depth, in order.
export const ELITE_RELIC_BY_DEPTH = ["brush", "still-water", "second-stroke", null, null];

function freshEncounterRuntime(encounter) {
  return {
    ...encounter,
    charIndex: 0,
    misses: 0,
    forgivenUsed: false,
    remaining: null,
    defeated: false,
    failed: false,
  };
}

export function createRun(layout, balance = BALANCE) {
  return {
    seed: layout.seed,
    balance,
    floors: layout.floors.map(floor => ({
      ...floor,
      cleared: false,
      encounters: floor.encounters.map(freshEncounterRuntime),
    })),
    floorIndex: 0,
    encounterIndex: 0,
    hp: balance.maxHp,
    ink: balance.maxInk,
    pendingGhosts: [],
    relics: [],
    revealUsedThisFloor: false,
    status: "playing",
    summary: {
      strokesWritten: 0,
      inkSpent: 0,
      hits: 0,
      grazes: 0,
      misses: 0,
      encountersWon: 0,
      encountersFailed: 0,
      ghostsCleared: 0,
      relicsEarned: 0,
    },
  };
}

export function currentFloor(state) {
  return state.floors[state.floorIndex] || null;
}

export function currentEncounter(state) {
  const floor = currentFloor(state);
  return floor ? floor.encounters[state.encounterIndex] || null : null;
}

// The character being written right now (elite/boss words go one char at a time).
export function currentCharacter(state) {
  const encounter = currentEncounter(state);
  if (!encounter) return null;
  if (encounter.kind === "normal" || encounter.kind === "ghost") {
    return { char: encounter.char, reading: encounter.reading, meaning: encounter.meaning };
  }
  return encounter.chars[encounter.charIndex] || null;
}

export function hasRelic(state, id) {
  return state.relics.includes(id);
}

// Called by the UI once stroke data for the current character has loaded.
export function beginCharacter(state, strokeCount) {
  const encounter = currentEncounter(state);
  if (!encounter || state.status !== "playing") throw new Error("no active encounter");
  if (!Number.isInteger(strokeCount) || strokeCount < 1) throw new RangeError("strokeCount must be a positive integer");
  encounter.remaining = strokeCount;
  encounter.strokesTotal = strokeCount;
  return state;
}

function spendInk(state, amount) {
  const spent = Math.min(state.ink, amount);
  state.ink -= spent;
  state.summary.inkSpent += spent;
}

function grantRelic(state, id) {
  if (id && RELICS[id] && !hasRelic(state, id)) {
    state.relics.push(id);
    state.summary.relicsEarned += 1;
    return id;
  }
  return null;
}

function queueGhosts(state, encounter) {
  const mode = harderMode(encounter.mode);
  const chars = encounter.kind === "normal" || encounter.kind === "ghost"
    ? [{ char: encounter.char, reading: encounter.reading, meaning: encounter.meaning }]
    : encounter.chars.slice(encounter.charIndex);
  for (const entry of chars) {
    state.pendingGhosts.push({ kind: "ghost", mode, ...entry });
  }
}

function advance(state) {
  const floor = currentFloor(state);
  if (state.encounterIndex < floor.encounters.length - 1) {
    state.encounterIndex += 1;
    return;
  }
  floor.cleared = true;
  state.floorIndex += 1;
  state.encounterIndex = 0;
  state.revealUsedThisFloor = false;
  if (state.floorIndex >= state.floors.length) {
    state.status = "victory";
    return;
  }
  // Ghosts ambush at the head of the next floor, hardest first.
  const next = state.floors[state.floorIndex];
  if (state.pendingGhosts.length) {
    next.encounters = [...state.pendingGhosts.map(freshEncounterRuntime), ...next.encounters];
    state.pendingGhosts = [];
  }
  state.ink = Math.min(state.balance.maxInk, state.ink + state.balance.floorInkRefill);
}

function failEncounter(state, encounter) {
  encounter.failed = true;
  state.summary.encountersFailed += 1;
  queueGhosts(state, encounter);
  const penalty = encounter.kind === "elite" || encounter.kind === "boss"
    ? state.balance.eliteHpPenalty
    : state.balance.normalHpPenalty;
  state.hp = Math.max(0, state.hp - penalty);
  if (state.hp <= 0) {
    state.status = "defeat";
    return;
  }
  advance(state);
}

function winEncounter(state, encounter) {
  encounter.defeated = true;
  state.summary.encountersWon += 1;
  if (encounter.kind === "ghost") state.summary.ghostsCleared += 1;
  let relic = null;
  if (encounter.kind === "elite") {
    relic = grantRelic(state, ELITE_RELIC_BY_DEPTH[currentFloor(state).depth - 1]);
  }
  advance(state);
  return relic;
}

// Apply one scored stroke to the current encounter.
// Returns an event object describing what happened for the UI.
export function applyStroke(state, verdict) {
  if (state.status !== "playing") throw new Error(`run is ${state.status}`);
  const encounter = currentEncounter(state);
  if (!encounter || encounter.remaining === null) throw new Error("beginCharacter must run first");
  if (!["hit", "graze", "miss"].includes(verdict)) throw new RangeError(`unknown verdict: ${verdict}`);

  const event = {
    verdict,
    damage: 0,
    inkCost: 0,
    dry: state.ink <= 0,
    forgiven: false,
    charDefeated: false,
    encounterDefeated: false,
    encounterFailed: false,
    relicEarned: null,
  };
  state.summary.strokesWritten += 1;
  state.summary[verdict === "hit" ? "hits" : verdict === "graze" ? "grazes" : "misses"] += 1;

  if (verdict === "miss") {
    if (hasRelic(state, "second-stroke") && !encounter.forgivenUsed) {
      encounter.forgivenUsed = true;
      event.forgiven = true;
      return event;
    }
    event.inkCost = state.balance.inkCost.miss;
    spendInk(state, event.inkCost);
    encounter.misses += 1;
    if (encounter.misses >= state.balance.missLimit) {
      event.encounterFailed = true;
      failEncounter(state, encounter);
    }
    return event;
  }

  event.inkCost = state.balance.inkCost[verdict];
  event.damage = event.dry ? state.balance.dryDamage : 1;
  spendInk(state, event.inkCost);
  encounter.remaining = Math.max(0, encounter.remaining - event.damage);

  if (encounter.remaining <= 0) {
    event.charDefeated = true;
    const isWord = encounter.kind === "elite" || encounter.kind === "boss";
    if (isWord && encounter.charIndex < encounter.chars.length - 1) {
      encounter.charIndex += 1;
      encounter.remaining = null; // UI calls beginCharacter for the next character
      encounter.misses = 0;
      encounter.forgivenUsed = false;
    } else {
      event.encounterDefeated = true;
      event.relicEarned = winEncounter(state, encounter);
    }
  }
  return event;
}

// The learner may retreat from an encounter instead of writing on.
export function retreat(state) {
  if (state.status !== "playing") throw new Error(`run is ${state.status}`);
  const encounter = currentEncounter(state);
  if (!encounter) throw new Error("no active encounter");
  failEncounter(state, encounter);
  return state;
}

// Reveal the ghost guide mid-encounter. Free once per floor with the brush relic.
export function revealGuide(state) {
  if (state.status !== "playing") throw new Error(`run is ${state.status}`);
  if (hasRelic(state, "brush") && !state.revealUsedThisFloor) {
    state.revealUsedThisFloor = true;
    return { inkCost: 0, viaRelic: true };
  }
  const cost = state.balance.revealInkCost;
  if (state.ink < cost) return null;
  spendInk(state, cost);
  return { inkCost: cost, viaRelic: false };
}

// Watch the reference animation mid-encounter.
export function payForReplay(state) {
  if (state.status !== "playing") throw new Error(`run is ${state.status}`);
  const base = state.balance.replayInkCost;
  const cost = hasRelic(state, "still-water") ? Math.ceil(base / 2) : base;
  if (state.ink < cost) return null;
  spendInk(state, cost);
  return { inkCost: cost };
}
