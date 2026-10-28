// Ink Dungeon browser UI. Wires the pure modules (scorer, floors, engine,
// bestiary) to the DOM: pointer capture, KanjiVG loading, screens, HUD,
// floor aesthetics, and the practice-store bridge.
"use strict";

import { scoreStroke } from "./scorer.js";
import { generateRun, hashSeed, dailySeed, mulberry32 } from "./floors.js";
import {
  createRun, currentFloor, currentEncounter, currentCharacter,
  beginCharacter, applyStroke, retreat, revealGuide, payForReplay,
  RELICS,
} from "./engine.js";
import { createBestiary, rememberInPracticeStore } from "./bestiary.js";

const DATA_REVISION = "70a0b7ae0c18ceb5cb358274b029cce0234a43bc";
const DATA_URL = `https://raw.githubusercontent.com/KanjiVG/kanjivg/${DATA_REVISION}/kanji/`;
const SVG_NS = "http://www.w3.org/2000/svg";
const BUNDLED = new Set([..."木憂響曖昧繊細鬱"]);
const SHEET_INSET = 0.08;        // guide SVG inset fraction; keep in sync with layout
const REF_SAMPLE = 32;
const TRACE_GUIDE_MS = 2200;
const REVEAL_MS = 2600;

const $ = selector => document.querySelector(selector);
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const bestiary = createBestiary(window.localStorage);

let pools = null;
let state = null;
let strokeCache = new Map();     // char -> { ds: [path strings], refs: [[{x,y}]] }
let refStrokes = [];             // sampled reference strokes for current char
let drawnIndex = 0;
let activeStroke = null;
let strokeStart = 0;
let pointerId = null;
let inputLocked = true;
let guideTimer = 0;
let fallbackNoticeShown = false;

/* ---------- small helpers ---------- */

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function setStatus(text) {
  $("#game-status").textContent = text;
}

function show(screen) {
  for (const id of ["#screen-start", "#screen-run", "#screen-end"]) $(id).hidden = id !== screen;
}

/* ---------- KanjiVG loading & sampling ---------- */

function parseStrokePaths(source) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("stroke data unreadable");
  const group = [...doc.querySelectorAll("g")].find(node => node.id.startsWith("kvg:StrokePaths_"));
  const ds = group ? [...group.querySelectorAll("path")].map(path => path.getAttribute("d")) : [];
  if (!ds.length || ds.some(d => !d)) throw new Error("no stroke paths");
  return ds;
}

// Sample a KanjiVG path into normalized sheet coordinates (0..1 with inset).
function samplePath(d) {
  const svg = svgElement("svg", { viewBox: "0 0 109 109" });
  svg.style.position = "absolute";
  svg.style.left = "-9999px";
  svg.style.width = "109px";
  svg.style.height = "109px";
  const path = svgElement("path", { d });
  svg.append(path);
  document.body.append(svg);
  const length = path.getTotalLength();
  const points = [];
  for (let i = 0; i < REF_SAMPLE; i += 1) {
    const point = path.getPointAtLength((length * i) / (REF_SAMPLE - 1));
    points.push({
      x: SHEET_INSET + (point.x / 109) * (1 - 2 * SHEET_INSET),
      y: SHEET_INSET + (point.y / 109) * (1 - 2 * SHEET_INSET),
    });
  }
  svg.remove();
  return points;
}

async function loadCharacter(char) {
  if (strokeCache.has(char)) return strokeCache.get(char);
  const code = char.codePointAt(0).toString(16).padStart(5, "0");
  const url = BUNDLED.has(char) ? `./data/${code}.svg` : `${DATA_URL}${code}.svg`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`stroke data unavailable for ${char} (${response.status})`);
  const ds = parseStrokePaths(await response.text());
  const entry = { ds, refs: ds.map(samplePath) };
  strokeCache.set(char, entry);
  return entry;
}

// Substitute an unreachable character with a bundled one so the run survives offline.
function bundledFallback() {
  const pool = pools.floors[0].pool;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- canvas ---------- */

const sheet = $("#game-sheet");
const canvas = $("#game-canvas");
const context = canvas.getContext("2d");

function resizeCanvas() {
  const bounds = sheet.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * ratio));
  canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}

function clearCanvas() {
  const bounds = sheet.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
}

const landedStrokes = [];

function paintStroke(points, colour, width = 5, alpha = 1) {
  if (points.length < 2) return;
  const bounds = sheet.getBoundingClientRect();
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) => {
    const x = point.x * bounds.width;
    const y = point.y * bounds.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
}

function inkColour() {
  return getComputedStyle(document.body).getPropertyValue("--ink").trim() || "#343c35";
}

function accentColour() {
  return getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#a64f3c";
}

function redraw() {
  clearCanvas();
  for (const stroke of landedStrokes) paintStroke(stroke, inkColour());
  if (activeStroke) paintStroke(activeStroke, accentColour());
}

// A missed stroke bleeds like ink on wet paper, then fades.
function paintBleed(points) {
  paintStroke(points, accentColour(), 9, 0.35);
  if (!motion.matches) setTimeout(redraw, 650);
  else redraw();
}

/* ---------- pointer capture ---------- */

function pointFor(event) {
  const bounds = sheet.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    elapsedMs: Math.max(0, performance.now() - strokeStart),
  };
}

canvas.addEventListener("pointerdown", event => {
  if (inputLocked || pointerId !== null) return;
  pointerId = event.pointerId;
  strokeStart = performance.now();
  activeStroke = [pointFor(event)];
  canvas.setPointerCapture(pointerId);
  event.preventDefault();
});

canvas.addEventListener("pointermove", event => {
  if (event.pointerId !== pointerId || !activeStroke) return;
  activeStroke.push(pointFor(event));
  redraw();
  event.preventDefault();
});

function endStroke(event) {
  if (event.pointerId !== pointerId || !activeStroke) return;
  activeStroke.push(pointFor(event));
  const stroke = activeStroke;
  activeStroke = null;
  pointerId = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  event.preventDefault();
  if (stroke.length < 2) { redraw(); return; }
  judgeStroke(stroke);
}

canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
window.addEventListener("resize", resizeCanvas);

/* ---------- guide ---------- */

function setGuide(ds) {
  $("#guide-strokes").replaceChildren(...ds.map(d => svgElement("path", { d, fill: "none", "stroke-width": "3.1", "stroke-linecap": "round", "stroke-linejoin": "round" })));
}

function showGuide(temporarilyMs = 0) {
  clearTimeout(guideTimer);
  $("#game-guide").classList.remove("is-hidden");
  if (temporarilyMs > 0) {
    guideTimer = setTimeout(() => $("#game-guide").classList.add("is-hidden"), temporarilyMs);
  }
}

function hideGuide() {
  clearTimeout(guideTimer);
  $("#game-guide").classList.add("is-hidden");
}

async function animateReference() {
  const paths = [...$("#guide-strokes").querySelectorAll("path")];
  showGuide();
  if (motion.matches) {
    setTimeout(() => applyGuideForMode(), REVEAL_MS);
    return;
  }
  for (const path of paths) {
    path.classList.add("ref-animating");
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
    await new Promise(resolve => {
      const start = performance.now();
      const duration = Math.max(350, Math.min(900, length * 14));
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        path.style.strokeDashoffset = length * (1 - t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    path.classList.remove("ref-animating");
    path.style.strokeDasharray = "";
    path.style.strokeDashoffset = "";
  }
  applyGuideForMode();
}

function applyGuideForMode() {
  const encounter = currentEncounter(state);
  if (!encounter) return;
  if (encounter.mode === "copy") showGuide();
  else if (encounter.mode === "trace") {
    if (motion.matches) showGuide(); // hidden at first stroke instead of fading
    else showGuide(TRACE_GUIDE_MS);
  } else hideGuide();
}

/* ---------- HUD & aesthetics ---------- */

function renderRail() {
  const rail = $("#floor-rail");
  rail.replaceChildren(...state.floors.map((floor, index) => {
    const marker = document.createElement("div");
    marker.className = "rail-marker";
    marker.dataset.state = floor.cleared ? "cleared" : index === state.floorIndex ? "current" : "pending";
    const name = document.createElement("span");
    name.className = "floor-name";
    name.lang = "ja";
    name.textContent = floor.glyph;
    marker.append(name);
    marker.title = `Floor ${floor.depth} · ${floor.name}`;
    if (floor.cleared) {
      const stamp = document.createElement("span");
      stamp.className = "stamp";
      stamp.lang = "ja";
      stamp.textContent = "済";
      marker.append(stamp);
    }
    return marker;
  }));
}

function renderOfuda() {
  const floor = currentFloor(state);
  if (!floor) return;
  $("#ofuda-row").replaceChildren(...floor.encounters.map((encounter, index) => {
    const card = document.createElement("div");
    card.className = "ofuda";
    if (encounter.kind === "ghost") card.classList.add("is-ghost");
    if (encounter.kind === "elite" || encounter.kind === "boss") card.classList.add("is-word");
    card.dataset.state = encounter.defeated ? "defeated" : encounter.failed ? "failed" : index === state.encounterIndex ? "current" : "pending";
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.lang = "ja";
    const hidden = !encounter.defeated && !encounter.failed && (encounter.mode === "cued" || encounter.mode === "free") && index >= state.encounterIndex;
    glyph.textContent = hidden ? "？" : (encounter.word || encounter.char);
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = encounter.kind === "boss" ? "BOSS" : encounter.kind === "elite" ? "ELITE" : encounter.kind === "ghost" ? "GHOST" : "";
    card.append(glyph, count);
    return card;
  }));
}

function renderHud() {
  const floor = currentFloor(state);
  $("#hud-floor-name").textContent = floor ? `${floor.depth} · ${floor.name} ${floor.glyph}` : "—";
  $("#hud-hp").textContent = "●".repeat(state.hp) + "○".repeat(Math.max(0, state.balance.maxHp - state.hp));
  $("#hud-ink-count").textContent = `${state.ink} / ${state.balance.maxInk}`;
  const fraction = state.ink / state.balance.maxInk;
  const level = $("#ink-level");
  level.setAttribute("height", String(32 * fraction));
  level.setAttribute("y", String(36 - 32 * fraction));
  $("#hud-relics").textContent = state.relics.length ? state.relics.map(id => RELICS[id].name).join(" · ") : "none yet";
  $("#hud-seed").textContent = String(state.seed);
  document.body.dataset.depth = String(floor ? floor.depth : 0);
  $("#backdrop-glyph").textContent = floor ? floor.glyph : "";
}

function renderEncounterBrief() {
  const encounter = currentEncounter(state);
  const character = currentCharacter(state);
  if (!encounter || !character) return;
  const kindLabel = { normal: "ENCOUNTER", ghost: "GHOST · RETURNED HARDER", elite: "ELITE · WORD", boss: "BOSS · FROM MEANING ALONE" }[encounter.kind];
  $("#enc-kind").textContent = `${kindLabel} · ${encounter.mode.toUpperCase()}`;
  const showChar = encounter.mode === "copy" || encounter.mode === "trace";
  if (encounter.word) {
    const written = encounter.chars.map((entry, index) =>
      index < encounter.charIndex ? entry.char : showChar ? entry.char : "〓").join("");
    $("#enc-prompt").textContent = written;
  } else {
    $("#enc-prompt").textContent = showChar ? character.char : "〓";
  }
  $("#enc-reading").textContent = encounter.meaningOnly ? "" : (encounter.mode === "free" ? "" : (encounter.word ? encounter.reading : character.reading));
  $("#enc-meaning").textContent = encounter.word ? encounter.meaning : character.meaning;
  $("#enc-strokes").textContent = refStrokes.length
    ? `strokes ${"—".repeat(Math.max(0, refStrokes.length - drawnIndex))}${"✓".repeat(drawnIndex)} (${drawnIndex}/${refStrokes.length})`
    : "";
}

function renderAll() {
  renderRail();
  renderOfuda();
  renderHud();
  renderEncounterBrief();
}

/* ---------- encounter flow ---------- */

async function startCharacter() {
  const character = currentCharacter(state);
  if (!character) return;
  inputLocked = true;
  landedStrokes.length = 0;
  drawnIndex = 0;
  refStrokes = [];
  setGuide([]);
  redraw();
  setStatus(`Preparing ${"〓"}…`);
  let entry;
  try {
    entry = await loadCharacter(character.char);
  } catch {
    // Swap in a bundled fallback so the run survives offline.
    const fallback = bundledFallback();
    const encounter = currentEncounter(state);
    if (!encounter.word) {
      encounter.char = fallback.char;
      encounter.reading = fallback.reading;
      encounter.meaning = fallback.meaning;
    } else {
      encounter.chars[encounter.charIndex] = { ...fallback };
    }
    if (!fallbackNoticeShown) {
      fallbackNoticeShown = true;
      setStatus(`Stroke data could not be fetched — a familiar kanji steps in. (Offline floors use bundled characters.)`);
    }
    entry = await loadCharacter(fallback.char);
  }
  refStrokes = entry.refs;
  setGuide(entry.ds);
  beginCharacter(state, refStrokes.length);
  applyGuideForMode();
  renderAll();
  inputLocked = false;
  const encounter = currentEncounter(state);
  const label = encounter.word ? `character ${encounter.charIndex + 1} of ${encounter.chars.length}` : "the kanji";
  setStatus(`Write ${label} — ${refStrokes.length} strokes. ${encounter.mode === "copy" ? "Follow the guide." : encounter.mode === "trace" ? "The guide is fading." : "From memory."}`);
}

function judgeStroke(stroke) {
  if (inputLocked || state.status !== "playing") return;
  const encounter = currentEncounter(state);
  const mode = encounter.mode;
  let verdict;
  if (drawnIndex >= refStrokes.length) {
    verdict = "miss";
  } else {
    verdict = scoreStroke(stroke, refStrokes[drawnIndex], mode).verdict;
  }
  const event = applyStroke(state, verdict);

  if (event.forgiven) {
    paintBleed(stroke);
    setStatus("Forgiven — the Second Stroke relic absorbs the miss. Try that stroke again.");
    renderHud();
    return;
  }
  if (verdict === "miss") {
    paintBleed(stroke);
    if (event.encounterFailed) {
      handleEncounterEnd(false, encounter);
      return;
    }
    const left = state.balance.missLimit - encounter.misses;
    setStatus(`The stroke bleeds wide. ${left} ${left === 1 ? "miss" : "misses"} before it slips away.`);
    renderHud();
    return;
  }

  landedStrokes.push(stroke);
  if (event.damage >= 1) drawnIndex += 1;
  else {
    setStatus("The ink runs thin — the stroke lands softly. (Dry brush: half damage.)");
  }
  // Dry-brush edge: all reference strokes written but the character survives.
  if (drawnIndex >= refStrokes.length && !event.charDefeated && !event.encounterDefeated) {
    drawnIndex = 0;
    landedStrokes.length = 0;
    redraw();
    setStatus("The thin ink did not take. Write it once more.");
  }
  redraw();
  renderHud();
  renderEncounterBrief();

  if (event.encounterDefeated) {
    handleEncounterEnd(true, encounter, event);
  } else if (event.charDefeated) {
    bestiary.recordEncounter({ char: currentCharacterBefore(encounter), mode, won: true });
    setStatus("First character secured. The next rises.");
    startCharacter();
  } else if (verdict === "graze") {
    setStatus("It lands, roughly — double ink. Steady the hand.");
  } else if (event.damage >= 1) {
    setStatus(`Stroke ${drawnIndex} of ${refStrokes.length} lands.`);
  }
}

// After charIndex advanced, the defeated char is the previous one.
function currentCharacterBefore(encounter) {
  if (!encounter.word) return encounter.char;
  return encounter.chars[Math.max(0, encounter.charIndex - 1)].char;
}

function handleEncounterEnd(won, encounter, event = null) {
  inputLocked = true;
  const mode = encounter.mode;
  const chars = encounter.word ? encounter.chars.map(entry => entry.char) : [encounter.char];
  if (won) {
    bestiary.recordEncounter({ char: chars[chars.length - 1], mode, won: true });
    const name = encounter.word || encounter.char;
    let message = `${name} is defeated.`;
    if (event && event.relicEarned) message += ` Relic earned: ${RELICS[event.relicEarned].name}.`;
    if (encounter.kind === "ghost") message += " The ghost rests.";
    setStatus(message);
    if ((mode === "cued" || mode === "free") && !encounter.word) {
      offerRemember(encounter.char);
    }
  } else {
    for (const char of chars) bestiary.recordEncounter({ char, mode, won: false });
    setStatus(`${encounter.word || encounter.char} slips away — it will return as a ghost, harder. Resolve falls.`);
  }
  renderAll();
  if (state.status !== "playing") {
    setTimeout(endRun, motion.matches ? 400 : 1400);
  } else {
    setTimeout(() => { $("#btn-remember").hidden = true; startCharacter(); }, motion.matches ? 400 : 1400);
  }
}

function offerRemember(char) {
  const button = $("#btn-remember");
  button.hidden = false;
  button.textContent = `Remember ${char} for tomorrow's review`;
  button.onclick = () => {
    const ok = rememberInPracticeStore(window.localStorage, char);
    button.hidden = true;
    setStatus(ok ? `${char} will wait in the practice panel tomorrow.` : "This browser could not save the review choice.");
  };
}

/* ---------- controls ---------- */

$("#btn-reveal").addEventListener("click", () => {
  if (state.status !== "playing") return;
  const result = revealGuide(state);
  if (!result) { setStatus("Not enough ink to reveal the guide."); return; }
  showGuide(REVEAL_MS);
  renderHud();
  setStatus(result.viaRelic ? "The Calligrapher's Brush reveals the way — no ink spent." : `The guide surfaces briefly. (-${result.inkCost} ink)`);
});

$("#btn-replay-ref").addEventListener("click", () => {
  if (state.status !== "playing" || inputLocked) return;
  const result = payForReplay(state);
  if (!result) { setStatus("Not enough ink to watch the strokes."); return; }
  renderHud();
  setStatus(`Watch closely. (-${result.inkCost} ink)`);
  animateReference();
});

$("#btn-retreat").addEventListener("click", () => {
  if (state.status !== "playing" || inputLocked) return;
  const encounter = currentEncounter(state);
  retreat(state);
  inputLocked = true;
  handleRetreatAftermath(encounter);
});

function handleRetreatAftermath(encounter) {
  for (const char of (encounter.word ? encounter.chars.map(e => e.char) : [encounter.char])) {
    bestiary.recordEncounter({ char, mode: encounter.mode, won: false });
  }
  setStatus(`You step back from ${encounter.word || encounter.char}. It will haunt a deeper floor.`);
  renderAll();
  if (state.status !== "playing") setTimeout(endRun, motion.matches ? 400 : 1200);
  else setTimeout(() => startCharacter(), motion.matches ? 400 : 1200);
}

/* ---------- run lifecycle ---------- */

function endRun() {
  const victory = state.status === "victory";
  bestiary.recordRun({
    victory,
    depthReached: Math.min(5, state.floorIndex + (victory ? 0 : 1)),
    relics: state.relics,
  });
  document.body.dataset.depth = victory ? "5" : document.body.dataset.depth;
  $("#end-title").textContent = victory ? "The gold screen opens" : "The ink closes in";
  $("#end-note").textContent = victory
    ? "Five floors, written by hand. 日々精進 — may the characters stay with you."
    : "Every ghost you met is a kanji worth a quiet moment in the practice panel.";
  const s = state.summary;
  const entries = [
    ["Floors", `${Math.min(5, state.floorIndex + (victory ? 0 : 1))} / 5`],
    ["Strokes written", s.strokesWritten],
    ["Hits", s.hits], ["Grazes", s.grazes], ["Misses", s.misses],
    ["Ink spent", s.inkSpent],
    ["Kanji defeated", s.encountersWon],
    ["Ghosts cleared", s.ghostsCleared],
    ["Relics", s.relicsEarned],
  ];
  $("#end-summary").replaceChildren(...entries.map(([label, value]) => {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    wrap.append(dt, dd);
    return wrap;
  }));
  show("#screen-end");
}

async function startRun(seed) {
  try {
    if (!pools) {
      const response = await fetch("./data/pools.json");
      if (!response.ok) throw new Error(`pools.json ${response.status}`);
      pools = await response.json();
    }
  } catch {
    $("#start-error").textContent = "The floor pools could not be loaded. Serve the site over HTTP and try again.";
    return;
  }
  state = createRun(generateRun(seed, pools));
  fallbackNoticeShown = false;
  show("#screen-run");
  resizeCanvas();
  renderAll();
  await startCharacter();
}

function renderBestiary() {
  const data = bestiary.data;
  const chars = Object.entries(data.characters).filter(([, entry]) => entry.defeats > 0);
  $("#bestiary-summary").textContent = data.runs === 0
    ? "No descents yet."
    : `${data.runs} descent${data.runs === 1 ? "" : "s"} · ${data.victories} victor${data.victories === 1 ? "y" : "ies"} · deepest floor ${data.bestDepth} · ${chars.length} kanji defeated`;
  $("#bestiary-list").replaceChildren(...chars.slice(0, 80).map(([char, entry]) => {
    const item = document.createElement("li");
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.lang = "ja";
    glyph.textContent = char;
    const detail = document.createElement("span");
    detail.textContent = `×${entry.defeats}`;
    const mode = document.createElement("span");
    mode.textContent = entry.bestMode || "";
    if (entry.bestMode === "free") mode.className = "best-free";
    item.append(glyph, detail, mode);
    return item;
  }));
  $("#btn-clear-dungeon").disabled = data.runs === 0 && chars.length === 0;
}

/* ---------- start screen wiring ---------- */

$("#seed-input").value = String(dailySeed());
$("#btn-daily").addEventListener("click", () => { $("#seed-input").value = String(dailySeed()); });
$("#btn-random").addEventListener("click", () => { $("#seed-input").value = String(Math.floor(mulberry32(Date.now() >>> 0)() * 0xffffffff) >>> 0); });
$("#btn-start").addEventListener("click", () => {
  const raw = $("#seed-input").value.trim();
  const seed = /^\d+$/.test(raw) ? Number(raw) >>> 0 : hashSeed(raw || String(Date.now()));
  $("#start-error").textContent = "";
  startRun(seed);
});
$("#btn-clear-dungeon").addEventListener("click", () => {
  if (!window.confirm("Clear the bestiary and all dungeon records? Practice-panel data is not affected. This cannot be undone.")) return;
  bestiary.clear();
  renderBestiary();
});
$("#btn-new-run").addEventListener("click", () => {
  document.body.dataset.depth = "0";
  renderBestiary();
  show("#screen-start");
});

renderBestiary();
show("#screen-start");
