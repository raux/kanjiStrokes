import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function deckHarness() {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = source.indexOf('const tarotCards =');
  const end = source.indexOf('playButton.addEventListener', start);
  const selectors = ['#tarot-source', '#tarot-card', '#tarot-study', '#tarot-draw', '#tarot-draw small', '#tarot-word', '#tarot-meaning', '#tarot-reading', '#tarot-message', '#characters'];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, {
    value: '', textContent: '', hidden: false, handlers: {},
    addEventListener(event, fn) { this.handlers[event] = fn; },
    replaceChildren(...children) { this.children = children; },
  }]));
  nodes['#tarot-source'].value = 'builtin';
  const lists = [{ id: 'saved-1', name: 'My kanji', characters: ['学', '生'] }];
  let studied;
  const context = {
    $: selector => nodes[selector], sessionsList: lists,
    document: { createElement: () => ({ value: '', textContent: '' }) },
    lookupMeaning: async word => ({ meaning: `Meaning ${word}`, reading: 'がく' }),
    study: word => { studied = word; },
    sessionsRender() {}, Math,
  };
  vm.runInNewContext(source.slice(start, end), context);
  return { nodes, context, lists, studied: () => studied };
}

test('saved-list deck draws only list members and studies the revealed kanji', async () => {
  const { nodes, context, studied } = deckHarness();
  context.syncTarotSources();
  assert.deepEqual(Array.from(nodes['#tarot-source'].children, option => option.value), ['builtin', 'saved-1']);
  nodes['#tarot-source'].value = 'saved-1';
  nodes['#tarot-source'].handlers.change();
  await nodes['#tarot-draw'].handlers.click();
  const first = nodes['#tarot-word'].textContent;
  assert.ok(['学', '生'].includes(first));
  assert.equal(nodes['#tarot-meaning'].textContent, `Meaning ${first}`);
  nodes['#tarot-study'].handlers.click();
  assert.equal(studied(), first);
  await nodes['#tarot-draw'].handlers.click();
  assert.notEqual(nodes['#tarot-word'].textContent, first);
});

test('deleting selected saved list returns to built-in deck', () => {
  const { nodes, context, lists } = deckHarness();
  context.syncTarotSources();
  nodes['#tarot-source'].value = 'saved-1';
  lists.splice(0);
  context.syncTarotSources();
  assert.equal(nodes['#tarot-source'].value, 'builtin');
  assert.equal(nodes['#tarot-card'].hidden, true);
});
