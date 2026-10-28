"use strict";

const DATA_REVISION = "70a0b7ae0c18ceb5cb358274b029cce0234a43bc";
const DATA_URL = `https://raw.githubusercontent.com/KanjiVG/kanjivg/${DATA_REVISION}/kanji/`;
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_CHARACTERS = 20;
const bundledCharacters = new Set([..."木憂響曖昧繊細鬱"]);
const vocabulary = {
  "木": { meaning: "tree; wood", reading: "き · もく · ぼく" },
  "憂": { meaning: "melancholy; worry", reading: "ゆう · うれえる · うれい" },
  "響": { meaning: "resonance; echo", reading: "きょう · ひびく" },
  "曖": { meaning: "unclear; obscure", reading: "あい" },
  "昧": { meaning: "obscure; indistinct", reading: "まい" },
  "繊": { meaning: "fine; slender", reading: "せん" },
  "細": { meaning: "delicate; thin", reading: "さい · ほそい · こまかい" },
  "鬱": { meaning: "gloom; melancholy", reading: "うつ" },
};
const $ = selector => document.querySelector(selector);
const canvas = $("#canvas");
const ink = $("#ink-strokes");
const ghosts = $("#ghost-strokes");
const numbers = $("#stroke-numbers");
const brush = $("#brush");
const status = $("#status");
const playButton = $("#play");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const cache = new Map();
let paths = [];
let lengths = [];
let completed = 0;
let fraction = 0;
let playing = false;
let frameId = 0;
let lastTime = null;
let pauseRemaining = 0;
let loadController = null;
let selectedCharacter = "";

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function updateControls() {
  $("#play-icon").textContent = playing ? "Ⅱ" : "▶";
  $("#play-label").textContent = playing ? "Pause" : completed === paths.length && paths.length ? "Replay" : "Play strokes";
  $("#progress-count").textContent = paths.length ? `${completed} / ${paths.length}` : "—";
  $("#progress-track > span").style.width = paths.length ? `${(completed + fraction) / paths.length * 100}%` : "0%";
  for (const button of [playButton, $("#restart"), $("#step")]) button.disabled = !paths.length;
  $("#step").disabled = !paths.length || completed === paths.length;
}

function stop() {
  playing = false;
  cancelAnimationFrame(frameId);
  lastTime = null;
  brush.setAttribute("opacity", "0");
  updateControls();
}

function reset() {
  stop();
  completed = 0;
  fraction = 0;
  pauseRemaining = 0;
  paths.forEach((path, index) => {
    path.style.strokeDashoffset = lengths[index];
    path.classList.remove("active");
  });
  status.textContent = "Take a breath. Follow the first stroke.";
  updateControls();
}

function finishStroke() {
  paths[completed].style.strokeDashoffset = "0";
  paths[completed].classList.remove("active");
  completed++;
  fraction = 0;
  brush.setAttribute("opacity", "0");
  status.textContent = completed === paths.length ? "A little more familiar. Make it yours." : `Stroke ${completed} of ${paths.length} complete.`;
  updateControls();
}

function animate(now) {
  if (!playing) return;
  const elapsed = lastTime === null ? 0 : Math.min(now - lastTime, 80);
  lastTime = now;
  if (pauseRemaining > 0) {
    pauseRemaining -= elapsed;
  } else {
    const path = paths[completed];
    const pace = Number($("#speed").value);
    const duration = Math.max(450, Math.min(1250, lengths[completed] * 16)) * pace;
    fraction = motion.matches ? 1 : Math.min(1, fraction + elapsed / duration);
    path.classList.add("active");
    path.style.strokeDashoffset = lengths[completed] * (1 - fraction);
    const point = path.getPointAtLength(lengths[completed] * fraction);
    brush.setAttribute("cx", point.x);
    brush.setAttribute("cy", point.y);
    brush.setAttribute("opacity", motion.matches ? "0" : "1");
    const message = `Following stroke ${completed + 1} of ${paths.length}…`;
    if (status.textContent !== message) status.textContent = message;
    if (fraction === 1) {
      finishStroke();
      if (completed === paths.length) {
        stop();
        return;
      }
      pauseRemaining = 450 * pace;
    }
    updateControls();
  }
  frameId = requestAnimationFrame(animate);
}

function play() {
  if (!paths.length) return;
  if (playing) {
    stop();
    status.textContent = `Paused at stroke ${Math.min(completed + 1, paths.length)} of ${paths.length}.`;
    return;
  }
  if (completed === paths.length) reset();
  playing = true;
  lastTime = null;
  updateControls();
  frameId = requestAnimationFrame(animate);
}

function parseStrokes(source) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("The stroke data could not be read.");
  const group = [...doc.querySelectorAll("g")].find(node => node.id.startsWith("kvg:StrokePaths_"));
  const data = group ? [...group.querySelectorAll("path")].map(path => path.getAttribute("d")) : [];
  if (!data.length || data.some(d => !d)) throw new Error("No stroke paths were found for this character.");
  // Only copy path geometry and number positions, never external SVG markup.
  const numberGroup = [...doc.querySelectorAll("g")].find(node => node.id.startsWith("kvg:StrokeNumbers_"));
  const labels = numberGroup ? [...numberGroup.querySelectorAll("text")].map(node => ({
    transform: node.getAttribute("transform") || "",
    x: node.getAttribute("x") || "0",
    y: node.getAttribute("y") || "0",
  })) : [];
  return { data, labels };
}

async function getStrokes(character, signal) {
  if (cache.has(character)) return cache.get(character);
  const code = character.codePointAt(0).toString(16).padStart(5, "0");
  const url = bundledCharacters.has(character) ? `./data/${code}.svg` : `${DATA_URL}${code}.svg`;
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Couldn’t load the stroke data. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Stroke data isn’t available for ${character}. Try another kanji.`);
    throw new Error(`The stroke-data service returned ${response.status}. Please try again.`);
  }
  const result = parseStrokes(await response.text());
  cache.set(character, result);
  return result;
}

async function selectCharacter(character) {
  if (loadController) loadController.abort();
  loadController = new AbortController();
  const controller = loadController;
  selectedCharacter = character;
  stop();
  paths = [];
  lengths = [];
  completed = 0;
  fraction = 0;
  ink.replaceChildren();
  ghosts.replaceChildren();
  numbers.replaceChildren();
  const entry = vocabulary[character];
  $("#current-character").textContent = character;
  $("#character-meaning").textContent = entry ? entry.meaning : "your kanji practice";
  $("#character-reading").textContent = entry ? entry.reading : "Focus on the shape, direction, and order.";
  canvas.setAttribute("aria-label", `Stroke order for ${character}`);
  document.title = `${character} — Kanji Strokes`;
  practiceSetCharacter(character);
  $("#stroke-count").textContent = "Loading…";
  $("#loading-message").textContent = "Preparing your practice…";
  $("#loading-message").hidden = false;
  $("#retry").hidden = true;
  status.textContent = "Getting the ink ready.";
  document.querySelectorAll(".character-chip").forEach(button => button.setAttribute("aria-pressed", String(button.textContent === character)));
  updateControls();
  const timeout = setTimeout(() => controller.abort("timeout"), 15000);
  try {
    const { data, labels } = await getStrokes(character, controller.signal);
    if (controller.signal.aborted) return;
    data.forEach((d, index) => {
      ghosts.append(svgElement("path", { d }));
      const path = svgElement("path", { d });
      ink.append(path);
      paths.push(path);
      const length = path.getTotalLength();
      lengths.push(length);
      path.style.strokeDasharray = length;
      const point = path.getPointAtLength(0);
      const label = labels[index] || { x: Math.max(3, point.x - 4), y: Math.max(5, point.y - 3) };
      const number = svgElement("text", label);
      number.textContent = index + 1;
      numbers.append(number);
    });
    $("#loading-message").hidden = true;
    $("#stroke-count").textContent = `${paths.length} strokes`;
    practiceSetGuide(data);
    reset();
    // Reduced-motion users choose when to advance; no automatic playback.
    if (!motion.matches) play();
  } catch (error) {
    if (controller !== loadController) return;
    if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
    paths = [];
    lengths = [];
    ink.replaceChildren();
    ghosts.replaceChildren();
    numbers.replaceChildren();
    $("#loading-message").textContent = controller.signal.reason === "timeout" ? "Loading took too long. Check your connection and try again." : error.message;
    $("#loading-message").hidden = false;
    $("#stroke-count").textContent = "Unavailable";
    $("#retry").hidden = false;
    status.textContent = "No stroke data loaded. Retry or choose another character.";
    updateControls();
  } finally {
    clearTimeout(timeout);
  }
}

function study(value) {
  const characters = [...new Set([...value].filter(character => /\p{Unified_Ideograph}/u.test(character) || character === "々"))];
  const error = $("#input-error");
  if (!characters.length) {
    error.textContent = "Enter at least one kanji, such as 木 or 勉強.";
    return;
  }
  if (characters.length > MAX_CHARACTERS) {
    error.textContent = `Please study up to ${MAX_CHARACTERS} different kanji at a time.`;
    return;
  }
  error.textContent = "";
  historyRecord(characters);
  $("#character-list").replaceChildren(...characters.map(character => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-chip";
    button.lang = "ja";
    button.textContent = character;
    button.setAttribute("aria-label", `Study ${character}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectCharacter(character));
    return button;
  }));
  selectCharacter(characters[0]);
}

/* ---------- Studied-kanji history: remember what was pasted, revisit any time ---------- */

const HISTORY_KEY = "kanjiStrokes.history.v1";
const HISTORY_MAX = 60;

function historyLoad() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(item => typeof item === "string" && [...item].length === 1 && (/\p{Unified_Ideograph}/u.test(item) || item === "々")))].slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

let historyList = historyLoad();

function historySave() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyList));
  } catch {
    /* History still works for this page; storage is unavailable. */
  }
}

function historyRender() {
  const container = $("#history-list");
  container.replaceChildren(...historyList.map(character => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-chip";
    button.lang = "ja";
    button.textContent = character;
    button.setAttribute("aria-label", `Practice ${character} again`);
    button.setAttribute("aria-pressed", String(character === selectedCharacter));
    button.addEventListener("click", () => selectCharacter(character));
    return button;
  }));
  $("#history-empty").hidden = historyList.length > 0;
  $("#history-clear").hidden = !historyList.length;
}

function historyRecord(characters) {
  historyList = [...new Set([...characters, ...historyList])].slice(0, HISTORY_MAX);
  historySave();
  historyRender();
}

$("#history-clear").addEventListener("click", () => {
  if (!window.confirm("Clear your list of studied kanji? Saved practice attempts are kept.")) return;
  historyList = [];
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* Cleared on this page even if storage could not be updated. */
  }
  historyRender();
});

historyRender();

$("#character-form").addEventListener("submit", event => {
  event.preventDefault();
  study($("#characters").value.trim());
});
document.querySelectorAll(".preset").forEach(button => button.addEventListener("click", () => {
  $("#characters").value = button.dataset.word;
  study(button.dataset.word);
}));
playButton.addEventListener("click", play);
$("#restart").addEventListener("click", () => { reset(); play(); });
$("#step").addEventListener("click", () => {
  stop();
  pauseRemaining = 0;
  if (completed < paths.length) finishStroke();
});
$("#retry").addEventListener("click", () => selectCharacter(selectedCharacter));
$("#show-guides").addEventListener("change", event => { $("#guidelines").toggleAttribute("hidden", !event.target.checked); });
$("#show-numbers").addEventListener("change", event => { numbers.toggleAttribute("hidden", !event.target.checked); });
function updateMotionPreference() {
  $("#motion-note").hidden = !motion.matches;
  if (motion.matches && playing) {
    stop();
    status.textContent = "Motion reduced. Play or advance one stroke at a time.";
  }
}
motion.addEventListener("change", updateMotionPreference);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) {
    stop();
    status.textContent = "Paused. Continue when you’re ready.";
  }
});
updateMotionPreference();

/* ---------- Local handwriting practice: capture, replay, remember ---------- */

const PRACTICE_KEY = "kanjiStrokes.practice.v1";
const PRACTICE_MAX_ATTEMPTS = 20;
const PRACTICE_MAX_STROKES = 40;
const PRACTICE_MAX_POINTS = 1200;
const PRACTICE_REVIEW_MS = 24 * 60 * 60 * 1000;
const PRACTICE_MIN_DISTANCE = 0.002;
const PRACTICE_MIN_INTERVAL_MS = 8;

const practiceSheet = $("#practice-sheet");
const practiceCanvas = $("#practice-canvas");
const practiceContext = practiceCanvas.getContext("2d");
const practiceStatus = $("#practice-status");
const practiceGuide = $("#practice-guide-strokes");

let practiceStore = practiceLoadStore();
let practiceCharacter = "";
let practiceAttempt = null;
let practiceStroke = null;
let practiceStrokeStart = 0;
let practicePointerId = null;
let practiceFinished = false;
let practiceSelectedId = null;
let practiceReplayFrame = 0;

function practiceFinite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function practiceClamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function practiceSanitiseAttempt(attempt) {
  if (!attempt || typeof attempt.id !== "string" || typeof attempt.createdAt !== "string" || !Array.isArray(attempt.strokes)) return null;
  const strokes = attempt.strokes.slice(0, PRACTICE_MAX_STROKES).map(stroke => {
    if (!stroke || !practiceFinite(stroke.startedAtMs) || !Array.isArray(stroke.points)) return null;
    const points = stroke.points.slice(0, PRACTICE_MAX_POINTS).map(point => {
      if (!point || !practiceFinite(point.x) || !practiceFinite(point.y) || !practiceFinite(point.elapsedMs)) return null;
      return {
        x: practiceClamp(point.x, 0, 1),
        y: practiceClamp(point.y, 0, 1),
        elapsedMs: Math.max(0, point.elapsedMs),
        pressure: practiceFinite(point.pressure) ? practiceClamp(point.pressure, 0, 1) : null,
      };
    }).filter(Boolean);
    return points.length > 1 ? { startedAtMs: Math.max(0, stroke.startedAtMs), points } : null;
  }).filter(Boolean);
  if (!strokes.length) return null;
  return { id: attempt.id, createdAt: attempt.createdAt, completed: true, strokes };
}

function practiceLoadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRACTICE_KEY));
    if (!parsed || parsed.version !== 1 || typeof parsed.characters !== "object" || !parsed.characters) return { version: 1, characters: {} };
    const characters = {};
    for (const [character, data] of Object.entries(parsed.characters)) {
      if (!data || typeof data !== "object") continue;
      characters[character] = {
        remembered: Boolean(data.remembered),
        nextReviewAt: typeof data.nextReviewAt === "string" && !Number.isNaN(Date.parse(data.nextReviewAt)) ? data.nextReviewAt : null,
        attempts: Array.isArray(data.attempts) ? data.attempts.map(practiceSanitiseAttempt).filter(Boolean).slice(0, PRACTICE_MAX_ATTEMPTS) : [],
      };
    }
    return { version: 1, characters };
  } catch {
    return { version: 1, characters: {} };
  }
}

function practiceSaveStore() {
  try {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(practiceStore));
    return true;
  } catch {
    practiceStatus.textContent = "This browser could not save practice data. Your current work stays on this page only.";
    return false;
  }
}

function practiceData(character) {
  if (!practiceStore.characters[character]) practiceStore.characters[character] = { remembered: false, nextReviewAt: null, attempts: [] };
  return practiceStore.characters[character];
}

function practiceResizeCanvas() {
  const bounds = practiceSheet.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  practiceCanvas.width = Math.max(1, Math.round(bounds.width * ratio));
  practiceCanvas.height = Math.max(1, Math.round(bounds.height * ratio));
  practiceContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  practiceRedraw();
}

function practiceClear() {
  const bounds = practiceSheet.getBoundingClientRect();
  practiceContext.clearRect(0, 0, bounds.width, bounds.height);
}

function practiceDrawStroke(stroke, maxElapsed, colour) {
  const usable = stroke.points.filter(point => point.elapsedMs <= maxElapsed);
  if (usable.length < 2) return;
  const bounds = practiceSheet.getBoundingClientRect();
  practiceContext.strokeStyle = colour;
  practiceContext.lineWidth = 5;
  practiceContext.lineCap = "round";
  practiceContext.lineJoin = "round";
  practiceContext.beginPath();
  usable.forEach((point, index) => {
    const x = point.x * bounds.width;
    const y = point.y * bounds.height;
    if (index === 0) practiceContext.moveTo(x, y);
    else practiceContext.lineTo(x, y);
  });
  practiceContext.stroke();
}

function practiceRedraw() {
  practiceClear();
  if (practiceAttempt) practiceAttempt.strokes.forEach(stroke => practiceDrawStroke(stroke, Infinity, "#364033"));
  if (practiceStroke) practiceDrawStroke(practiceStroke, Infinity, "#a64f3c");
}

function practiceSetGuide(data) {
  practiceGuide.replaceChildren(...data.map(d => svgElement("path", { d })));
}

function practicePoint(event) {
  const bounds = practiceSheet.getBoundingClientRect();
  return {
    x: practiceClamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    y: practiceClamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    elapsedMs: Math.max(0, performance.now() - practiceStrokeStart),
    pressure: event.pointerType !== "mouse" && practiceFinite(event.pressure) ? event.pressure : null,
  };
}

function practiceKeepPoint(previous, next) {
  if (!previous) return true;
  return Math.hypot(previous.x - next.x, previous.y - next.y) >= PRACTICE_MIN_DISTANCE || next.elapsedMs - previous.elapsedMs >= PRACTICE_MIN_INTERVAL_MS;
}

function practiceCancelReplay() {
  cancelAnimationFrame(practiceReplayFrame);
  practiceReplayFrame = 0;
  $("#practice-replay").disabled = !practiceSelectedId;
}

function practiceResetAttempt(message) {
  practiceCancelReplay();
  practiceAttempt = null;
  practiceStroke = null;
  practicePointerId = null;
  practiceFinished = false;
  $("#practice-finish").disabled = true;
  $("#practice-save-row").hidden = true;
  practiceClear();
  if (message) practiceStatus.textContent = message;
}

function practiceAttemptDate(attempt) {
  const date = new Date(attempt.createdAt);
  return Number.isNaN(date.getTime()) ? "Saved attempt" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function practiceRenderAttempts() {
  const data = practiceData(practiceCharacter);
  const list = $("#practice-attempts");
  list.replaceChildren();
  if (!data.attempts.length) {
    practiceSelectedId = null;
    const item = document.createElement("li");
    item.textContent = "No saved attempts for this kanji yet.";
    list.append(item);
  } else {
    if (!data.attempts.some(attempt => attempt.id === practiceSelectedId)) practiceSelectedId = data.attempts[0].id;
    data.attempts.forEach((attempt, index) => {
      const item = document.createElement("li");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "practice-attempt";
      radio.id = `practice-attempt-${index}`;
      radio.checked = attempt.id === practiceSelectedId;
      radio.addEventListener("change", () => { practiceSelectedId = attempt.id; });
      const label = document.createElement("label");
      label.htmlFor = radio.id;
      label.textContent = `${practiceAttemptDate(attempt)} · ${attempt.strokes.length} stroke${attempt.strokes.length === 1 ? "" : "s"}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => practiceDeleteAttempt(attempt.id));
      item.append(radio, label, remove);
      list.append(item);
    });
  }
  $("#practice-replay").disabled = !practiceSelectedId;
  const anyData = Object.values(practiceStore.characters).some(entry => entry.attempts.length || entry.remembered);
  $("#practice-clear").disabled = !anyData;
}

function practiceRenderReview() {
  const data = practiceData(practiceCharacter);
  $("#practice-remember").textContent = data.remembered ? `Stop remembering ${practiceCharacter}` : `Remember ${practiceCharacter}`;
  const note = $("#practice-review-note");
  const due = Object.entries(practiceStore.characters)
    .filter(([, entry]) => entry.remembered && entry.nextReviewAt && Date.parse(entry.nextReviewAt) <= Date.now())
    .map(([character]) => character);
  const parts = [];
  if (due.length) parts.push(`Ready for a quiet review: ${due.join(" · ")}`);
  else if (data.remembered && data.nextReviewAt) parts.push(`Next review of ${practiceCharacter}: ${new Date(data.nextReviewAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`);
  note.hidden = !parts.length;
  note.textContent = parts.join(" — ");
}

function practiceSetCharacter(character) {
  if (practiceCharacter === character) return;
  practiceCharacter = character;
  $("#practice-character").textContent = character;
  practiceCanvas.setAttribute("aria-label", `Writing area for practicing ${character}`);
  practiceSetGuide([]);
  practiceResetAttempt("Draw each stroke when you are ready.");
  practiceSelectedId = null;
  practiceRenderAttempts();
  practiceRenderReview();
}

function practiceEndStroke(event) {
  if (event.pointerId !== practicePointerId || !practiceStroke) return;
  const point = practicePoint(event);
  const previous = practiceStroke.points[practiceStroke.points.length - 1];
  if (practiceStroke.points.length < PRACTICE_MAX_POINTS && practiceKeepPoint(previous, point)) practiceStroke.points.push(point);
  if (practiceStroke.points.length > 1 && practiceAttempt.strokes.length < PRACTICE_MAX_STROKES) {
    practiceAttempt.strokes.push(practiceStroke);
    practiceStatus.textContent = `Stroke ${practiceAttempt.strokes.length} recorded.`;
    $("#practice-finish").disabled = false;
  } else {
    practiceStatus.textContent = "That gesture was too short. Try the stroke again.";
  }
  practiceStroke = null;
  practicePointerId = null;
  if (practiceCanvas.hasPointerCapture(event.pointerId)) practiceCanvas.releasePointerCapture(event.pointerId);
  practiceRedraw();
  event.preventDefault();
}

practiceCanvas.addEventListener("pointerdown", event => {
  if (practiceFinished || practicePointerId !== null) return;
  practiceCancelReplay();
  if (!practiceAttempt) {
    practiceAttempt = {
      id: `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      completed: true,
      startedAt: performance.now(),
      strokes: [],
    };
  }
  practicePointerId = event.pointerId;
  practiceStrokeStart = performance.now();
  practiceStroke = { startedAtMs: practiceStrokeStart - practiceAttempt.startedAt, points: [] };
  practiceStroke.points.push(practicePoint(event));
  practiceCanvas.setPointerCapture(practicePointerId);
  practiceStatus.textContent = "Recording stroke…";
  event.preventDefault();
});

practiceCanvas.addEventListener("pointermove", event => {
  if (event.pointerId !== practicePointerId || !practiceStroke) return;
  const point = practicePoint(event);
  const previous = practiceStroke.points[practiceStroke.points.length - 1];
  if (practiceStroke.points.length < PRACTICE_MAX_POINTS && practiceKeepPoint(previous, point)) {
    practiceStroke.points.push(point);
    practiceRedraw();
  }
  event.preventDefault();
});

practiceCanvas.addEventListener("pointerup", practiceEndStroke);
practiceCanvas.addEventListener("pointercancel", practiceEndStroke);

$("#practice-restart").addEventListener("click", () => practiceResetAttempt("Attempt cleared. Draw each stroke when you are ready."));

$("#practice-finish").addEventListener("click", () => {
  if (!practiceAttempt || !practiceAttempt.strokes.length || practiceStroke) return;
  practiceFinished = true;
  $("#practice-finish").disabled = true;
  $("#practice-save-row").hidden = false;
  practiceStatus.textContent = `${practiceAttempt.strokes.length} stroke${practiceAttempt.strokes.length === 1 ? "" : "s"} ready to save or discard.`;
});

$("#practice-save").addEventListener("click", () => {
  if (!practiceAttempt || !practiceFinished) return;
  const clean = practiceSanitiseAttempt(practiceAttempt);
  if (!clean) {
    practiceStatus.textContent = "This attempt could not be saved. Please try again.";
    return;
  }
  const data = practiceData(practiceCharacter);
  data.attempts.unshift(clean);
  data.attempts = data.attempts.slice(0, PRACTICE_MAX_ATTEMPTS);
  if (data.remembered) data.nextReviewAt = new Date(Date.now() + PRACTICE_REVIEW_MS).toISOString();
  practiceSelectedId = clean.id;
  const persisted = practiceSaveStore();
  practiceResetAttempt(persisted ? "Attempt saved locally. You can replay it here." : "Attempt kept on this page, but it could not be saved locally.");
  practiceRenderAttempts();
  practiceRenderReview();
});

$("#practice-discard").addEventListener("click", () => practiceResetAttempt("Unsaved attempt discarded."));

$("#practice-replay").addEventListener("click", () => {
  const attempt = practiceData(practiceCharacter).attempts.find(item => item.id === practiceSelectedId);
  if (!attempt) return;
  practiceCancelReplay();
  practiceResetAttempt("Replaying your attempt…");
  const speed = Number($("#practice-speed").value) || 1;
  const duration = Math.max(...attempt.strokes.map(stroke => stroke.startedAtMs + stroke.points[stroke.points.length - 1].elapsedMs));
  const started = performance.now();
  $("#practice-replay").disabled = true;
  const frame = now => {
    const elapsed = (now - started) * speed;
    practiceClear();
    attempt.strokes.forEach(stroke => {
      const local = elapsed - stroke.startedAtMs;
      if (local >= 0) practiceDrawStroke(stroke, local, "#a64f3c");
    });
    if (elapsed < duration) practiceReplayFrame = requestAnimationFrame(frame);
    else {
      practiceReplayFrame = 0;
      $("#practice-replay").disabled = false;
      practiceStatus.textContent = "Replay complete.";
    }
  };
  practiceReplayFrame = requestAnimationFrame(frame);
});

function practiceDeleteAttempt(id) {
  const data = practiceData(practiceCharacter);
  const attempt = data.attempts.find(item => item.id === id);
  if (!attempt || !window.confirm(`Delete the saved attempt from ${practiceAttemptDate(attempt)}? This cannot be undone.`)) return;
  practiceCancelReplay();
  data.attempts = data.attempts.filter(item => item.id !== id);
  if (practiceSelectedId === id) practiceSelectedId = data.attempts[0] ? data.attempts[0].id : null;
  const persisted = practiceSaveStore();
  practiceRenderAttempts();
  practiceStatus.textContent = persisted ? "Saved attempt deleted." : "The attempt was removed from this page but browser storage could not be updated.";
}

$("#practice-clear").addEventListener("click", () => {
  if (!window.confirm("Clear every saved attempt and review setting for all kanji? This cannot be undone.")) return;
  practiceCancelReplay();
  practiceStore = { version: 1, characters: {} };
  practiceSelectedId = null;
  let persisted = true;
  try {
    localStorage.removeItem(PRACTICE_KEY);
  } catch {
    persisted = false;
  }
  practiceRenderAttempts();
  practiceRenderReview();
  practiceStatus.textContent = persisted ? "All local practice data was cleared." : "Data was cleared from this page but browser storage could not be updated.";
});

$("#practice-remember").addEventListener("click", () => {
  const data = practiceData(practiceCharacter);
  data.remembered = !data.remembered;
  data.nextReviewAt = data.remembered ? new Date(Date.now() + PRACTICE_REVIEW_MS).toISOString() : null;
  const persisted = practiceSaveStore();
  practiceRenderAttempts();
  practiceRenderReview();
  practiceStatus.textContent = persisted
    ? (data.remembered ? `${practiceCharacter} will return for a quiet review tomorrow.` : `${practiceCharacter} was removed from your review list.`)
    : "The review choice is active on this page but could not be saved in this browser.";
});

window.addEventListener("resize", practiceResizeCanvas);
practiceResizeCanvas();

study($("#characters").value);
