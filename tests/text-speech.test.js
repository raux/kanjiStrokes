import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness({ available = true, voices = [{ lang: 'ja-JP', name: 'Japanese' }] } = {}) {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = src.indexOf('const speech = window.speechSynthesis;');
  const end = src.indexOf('// Text analysis runs in a worker;', start);
  const nodes = Object.fromEntries(['#speech-play', '#speech-pause', '#speech-stop', '#speech-status', '#text-input'].map(id => [id, {
    disabled: false, textContent: '', value: '', handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
  }]));
  const engine = { calls: [], getVoices: () => voices, speak(u) { this.calls.push('speak'); this.utterance = u; }, pause() { this.calls.push('pause'); }, resume() { this.calls.push('resume'); }, cancel() { this.calls.push('cancel'); } };
  class Utterance { constructor(text) { this.text = text; } }
  const context = { window: { speechSynthesis: available ? engine : undefined }, $: id => nodes[id], SpeechSynthesisUtterance: Utterance };
  vm.runInNewContext(src.slice(start, end), context);
  return { nodes, engine };
}

test('plays Japanese voice, pauses, resumes and stops', () => {
  const { nodes, engine } = harness();
  nodes['#text-input'].value = '日本語を聞きます。';
  nodes['#speech-play'].handlers.click();
  assert.equal(engine.utterance.text, '日本語を聞きます。');
  assert.equal(engine.utterance.lang, 'ja-JP');
  assert.equal(nodes['#speech-pause'].disabled, false);
  nodes['#speech-pause'].handlers.click();
  assert.equal(nodes['#speech-pause'].textContent, 'Resume');
  nodes['#speech-pause'].handlers.click();
  nodes['#speech-stop'].handlers.click();
  assert.deepEqual(engine.calls, ['speak', 'pause', 'resume', 'cancel']);
  assert.equal(nodes['#speech-stop'].disabled, true);
});

test('reports missing voice and unsupported browsers', () => {
  const noVoice = harness({ voices: [{ lang: 'en-US' }] });
  noVoice.nodes['#text-input'].value = 'こんにちは';
  noVoice.nodes['#speech-play'].handlers.click();
  assert.match(noVoice.nodes['#speech-status'].textContent, /No Japanese voice/);
  assert.equal(noVoice.engine.calls.length, 0);
  const unsupported = harness({ available: false });
  assert.equal(unsupported.nodes['#speech-play'].disabled, true);
  assert.match(unsupported.nodes['#speech-status'].textContent, /not supported/);
});

test('an old utterance ending cannot stop a newer one', () => {
  const { nodes, engine } = harness();
  nodes['#text-input'].value = 'こんにちは';
  nodes['#speech-play'].handlers.click();
  const old = engine.utterance;
  nodes['#speech-play'].handlers.click();
  old.onend();
  assert.equal(nodes['#speech-stop'].disabled, false);
});
