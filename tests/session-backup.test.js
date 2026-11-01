import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('const SESSION_BACKUP_FORMAT =');
const end = source.indexOf('$("#session-export").addEventListener', start);
const context = { SESSIONS_MAX: 20, SESSION_NAME_MAX: 40, MAX_CHARACTERS: 20,
  sessionValidCharacter: item => typeof item === 'string' && [...item].length === 1 && (/\p{Unified_Ideograph}/u.test(item) || item === '々') };
vm.runInNewContext(source.slice(start, end), context);
const merge = (existing, lists) => context.mergeSessionBackup(existing, { format: 'kanjiStrokes.saved-lists', version: 1, lists });
const entry = (name, characters) => ({ name, characters, createdAt: '2026-01-01T00:00:00Z' });

test('merges valid lists without mutating existing lists', () => {
  const existing = [{ id: 'old', ...entry('Old', ['木']) }];
  const result = merge(existing, [entry('New', ['学', '生'])]);
  assert.equal(result.added, 1);
  assert.equal(existing.length, 1);
  assert.equal(result.merged[0].id, 'old');
  assert.deepEqual(Array.from(result.merged[1].characters), ['学', '生']);
});

test('rejects wrong format and skips duplicates and invalid entries', () => {
  assert.throws(() => context.mergeSessionBackup([], { version: 1, lists: [] }), /supported/);
  const result = merge([{ id: 'old', ...entry('Old', ['木']) }], [entry('Duplicate', ['木']), entry('Bad', ['abc']), entry('Repeated', ['学', '学'])]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.invalid, 2);
  assert.equal(result.added, 0);
});

test('preserves existing lists when the 20-list limit is reached', () => {
  const existing = Array.from({ length: 20 }, (_, i) => ({ id: String(i), ...entry(String(i), [String.fromCodePoint(0x4e00 + i)]) }));
  const result = merge(existing, [entry('Extra', ['語'])]);
  assert.equal(result.full, 1);
  assert.equal(result.merged.length, 20);
  assert.equal(result.merged[0].id, '0');
});
