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
study($("#characters").value);
