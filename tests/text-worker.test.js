import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function analyze(text, tokens, dictionary = {}) {
  const source = readFileSync(new URL('../text-worker.js', import.meta.url), 'utf8');
  let result;
  const context = {
    importScripts() {},
    XMLHttpRequest: class { open() {} },
    kuromoji: { builder: () => ({ build: callback => callback(null, { tokenize: () => tokens }) }) },
    fetch: async () => ({ ok: true, json: async () => dictionary }),
    self: { postMessage: message => { result = message; } },
  };
  vm.runInNewContext(source, context);
  await context.self.onmessage({ data: { id: 7, text } });
  return result;
}

test('repairs kuromoji dictionary URLs without rewriting unrelated requests', () => {
  const source = readFileSync(new URL('../text-worker.js', import.meta.url), 'utf8');
  class FakeXHR { open(method, url) { this.url = url; } }
  const context = { XMLHttpRequest: FakeXHR, self: {} };
  vm.runInNewContext(source, context);
  const request = new FakeXHR();
  request.open('GET', 'https:/cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/base.dat.gz');
  assert.equal(request.url, 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/base.dat.gz');
  request.open('GET', 'https://example.com/test');
  assert.equal(request.url, 'https://example.com/test');
});

test('ranks kanji by count with competition ties and first-appearance order', async () => {
  const result = await analyze('学校学生日', [], { '学': { meanings: ['study'], readings_on: ['ガク'] } });
  assert.deepEqual(Array.from(result.ranking, x => [x.character, x.count, x.rank]), [
    ['学', 2, 1], ['校', 1, 2], ['生', 1, 2], ['日', 1, 2],
  ]);
  assert.equal(result.ranking[0].reading, 'がく');
  assert.equal(result.ranking[0].meaning, 'study');
});

test('converts contextual readings and marks unknown kanji', async () => {
  const result = await analyze('学生と未知', [
    { surface_form: '学生', reading: 'ガクセイ', word_type: 'KNOWN' },
    { surface_form: 'と', reading: 'ト', word_type: 'KNOWN' },
    { surface_form: '未知', reading: '*', word_type: 'UNKNOWN' },
  ]);
  assert.equal(result.tokens[0].reading, 'がくせい');
  assert.equal(result.tokens[2].unknown, true);
  assert.equal(result.id, 7);
});
