import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateRun } from "../game/floors.js";
import {
  createRun,
  currentFloor,
  currentEncounter,
  currentCharacter,
  beginCharacter,
  applyStroke,
  retreat,
  revealGuide,
  payForReplay,
  hasRelic,
  BALANCE,
  RELICS,
  ELITE_RELIC_BY_DEPTH,
} from "../game/engine.js";

const pools = JSON.parse(await readFile(new URL("../data/pools.json", import.meta.url), "utf8"));

function newRun(seed = 99) {
  return createRun(generateRun(seed, pools));
}

// Write a character until it is defeated (hits may do half damage when dry).
function defeatCurrentCharacter(state, strokes = 4) {
  beginCharacter(state, strokes);
  let event = null;
  let guard = 0;
  do {
    event = applyStroke(state, "hit");
    guard += 1;
  } while (!event.charDefeated && state.status === "playing" && guard < 50);
  return event;
}

function defeatCurrentEncounter(state) {
  let event;
  do {
    event = defeatCurrentCharacter(state);
  } while (!event.encounterDefeated && state.status === "playing");
  return event;
}

test("a fresh run starts on floor 1 with full resources", () => {
  const state = newRun();
  assert.equal(state.status, "playing");
  assert.equal(state.hp, BALANCE.maxHp);
  assert.equal(state.ink, BALANCE.maxInk);
  assert.equal(currentFloor(state).depth, 1);
  assert.ok(currentEncounter(state));
  assert.ok(currentCharacter(state).char);
});

test("hits damage the enemy by stroke and spend ink", () => {
  const state = newRun();
  beginCharacter(state, 3);
  const event = applyStroke(state, "hit");
  assert.equal(event.damage, 1);
  assert.equal(event.inkCost, BALANCE.inkCost.hit);
  assert.equal(currentEncounter(state).remaining, 2);
  assert.equal(state.ink, BALANCE.maxInk - 1);
});

test("grazes land but cost double ink; misses cost ink and count", () => {
  const state = newRun();
  beginCharacter(state, 5);
  const graze = applyStroke(state, "graze");
  assert.equal(graze.damage, 1);
  assert.equal(graze.inkCost, BALANCE.inkCost.graze);
  const miss = applyStroke(state, "miss");
  assert.equal(miss.damage, 0);
  assert.equal(miss.inkCost, BALANCE.inkCost.miss);
  assert.equal(currentEncounter(state).misses, 1);
});

test("defeating a normal encounter advances to the next", () => {
  const state = newRun();
  const before = currentEncounter(state).char;
  const event = defeatCurrentCharacter(state, 2);
  assert.equal(event.encounterDefeated, true);
  assert.notEqual(currentEncounter(state).char, before);
  assert.equal(state.summary.encountersWon, 1);
});

test("reaching the miss limit fails the encounter, costs HP, queues a ghost", () => {
  const state = newRun();
  const failedChar = currentEncounter(state).char;
  const failedMode = currentEncounter(state).mode;
  beginCharacter(state, 9);
  applyStroke(state, "miss");
  applyStroke(state, "miss");
  const event = applyStroke(state, "miss");
  assert.equal(event.encounterFailed, true);
  assert.equal(state.hp, BALANCE.maxHp - BALANCE.normalHpPenalty);
  assert.equal(state.pendingGhosts.length, 1);
  assert.equal(state.pendingGhosts[0].char, failedChar);
  assert.equal(state.pendingGhosts[0].kind, "ghost");
  assert.notEqual(state.pendingGhosts[0].mode, failedMode, "ghost returns one mode harder");
});

test("retreat fails the encounter without writing", () => {
  const state = newRun();
  retreat(state);
  assert.equal(state.summary.encountersFailed, 1);
  assert.equal(state.hp, BALANCE.maxHp - BALANCE.normalHpPenalty);
});

test("ghosts ambush at the head of the next floor", () => {
  const state = newRun();
  const floor = currentFloor(state);
  const ghostChar = currentEncounter(state).char;
  retreat(state); // queue ghost
  while (state.floorIndex === 0 && state.status === "playing") defeatCurrentEncounter(state);
  assert.equal(state.floorIndex, 1);
  const first = currentEncounter(state);
  assert.equal(first.kind, "ghost");
  assert.equal(first.char, ghostChar);
  assert.equal(floor.cleared, true);
});

test("clearing a floor refills ink partially, capped at max", () => {
  const state = newRun();
  while (state.floorIndex === 0 && state.status === "playing") defeatCurrentEncounter(state);
  assert.equal(state.floorIndex, 1);
  assert.ok(state.ink <= BALANCE.maxInk);
  assert.ok(state.ink > 0);
});

test("running dry halves damage instead of blocking input", () => {
  const state = newRun();
  state.ink = 0;
  beginCharacter(state, 2);
  const event = applyStroke(state, "hit");
  assert.equal(event.dry, true);
  assert.equal(event.damage, BALANCE.dryDamage);
  assert.equal(currentEncounter(state).remaining, 1.5);
  assert.equal(state.ink, 0, "cannot go negative");
});

test("HP reaching zero defeats the run", () => {
  const state = newRun();
  state.hp = 1;
  retreat(state);
  assert.equal(state.status, "defeat");
  assert.throws(() => applyStroke(state, "hit"), /defeat/);
  assert.throws(() => retreat(state), /defeat/);
});

test("elite words are written one character at a time", () => {
  const state = newRun();
  const floor = currentFloor(state);
  // Walk to the elite.
  while (currentEncounter(state).kind !== "elite") defeatCurrentEncounter(state);
  const elite = currentEncounter(state);
  const firstChar = currentCharacter(state).char;
  assert.equal(firstChar, elite.chars[0].char);
  const event = defeatCurrentCharacter(state, 3);
  assert.equal(event.charDefeated, true);
  assert.equal(event.encounterDefeated, false);
  assert.equal(currentCharacter(state).char, elite.chars[1].char);
  assert.equal(currentEncounter(state).remaining, null, "UI must beginCharacter again");
  const last = defeatCurrentCharacter(state, 3);
  assert.equal(last.encounterDefeated, true);
  assert.equal(floor.encounters.includes(elite), true);
});

test("failing an elite costs extra HP and queues remaining characters as ghosts", () => {
  const state = newRun();
  while (currentEncounter(state).kind !== "elite") defeatCurrentEncounter(state);
  const elite = currentEncounter(state);
  beginCharacter(state, 6);
  applyStroke(state, "miss");
  applyStroke(state, "miss");
  applyStroke(state, "miss");
  assert.equal(state.hp, BALANCE.maxHp - BALANCE.eliteHpPenalty);
  // The elite ends the floor, so its ghosts have already ambushed floor 2.
  assert.equal(state.floorIndex, 1);
  const ghosts = currentFloor(state).encounters.filter(e => e.kind === "ghost");
  assert.equal(ghosts.length, elite.chars.length);
  assert.deepEqual(ghosts.map(g => g.char), elite.chars.map(c => c.char));
  assert.equal(state.pendingGhosts.length, 0, "ghosts were delivered, not left pending");
});

test("the first elite defeat grants the depth's relic", () => {
  const state = newRun();
  while (currentEncounter(state).kind !== "elite") defeatCurrentEncounter(state);
  const event = defeatCurrentEncounter(state);
  assert.equal(event.relicEarned, ELITE_RELIC_BY_DEPTH[0]);
  assert.ok(hasRelic(state, ELITE_RELIC_BY_DEPTH[0]));
  assert.equal(state.summary.relicsEarned, 1);
});

test("second-stroke relic forgives the first miss per encounter", () => {
  const state = newRun();
  state.relics.push("second-stroke");
  beginCharacter(state, 4);
  const first = applyStroke(state, "miss");
  assert.equal(first.forgiven, true);
  assert.equal(first.inkCost, 0);
  assert.equal(currentEncounter(state).misses, 0);
  const second = applyStroke(state, "miss");
  assert.equal(second.forgiven, false);
  assert.equal(currentEncounter(state).misses, 1);
});

test("brush relic grants one free guide reveal per floor", () => {
  const state = newRun();
  state.relics.push("brush");
  const free = revealGuide(state);
  assert.deepEqual(free, { inkCost: 0, viaRelic: true });
  const paid = revealGuide(state);
  assert.equal(paid.viaRelic, false);
  assert.equal(paid.inkCost, BALANCE.revealInkCost);
});

test("guide reveal without relic costs ink and fails when too dry", () => {
  const state = newRun();
  const result = revealGuide(state);
  assert.equal(result.inkCost, BALANCE.revealInkCost);
  state.ink = BALANCE.revealInkCost - 1;
  assert.equal(revealGuide(state), null);
});

test("still-water relic halves replay cost", () => {
  const state = newRun();
  assert.equal(payForReplay(state).inkCost, BALANCE.replayInkCost);
  state.relics.push("still-water");
  assert.equal(payForReplay(state).inkCost, Math.ceil(BALANCE.replayInkCost / 2));
});

test("a full perfect run ends in victory at the boss", () => {
  const state = newRun();
  let guard = 0;
  while (state.status === "playing" && guard < 200) {
    defeatCurrentEncounter(state);
    guard += 1;
  }
  assert.equal(state.status, "victory");
  assert.equal(state.floorIndex, state.floors.length);
  assert.ok(state.summary.encountersWon >= 5 * 6 + 1, "all floors plus boss");
  assert.equal(state.summary.encountersFailed, 0);
});

test("relic metadata exists for every grantable relic", () => {
  for (const id of ELITE_RELIC_BY_DEPTH) {
    if (id !== null) assert.ok(RELICS[id], id);
  }
});
