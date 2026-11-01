import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSavedRun, generateRun, NORMALS_PER_FLOOR } from '../game/floors.js';
import { createRun, currentCharacter, beginCharacter, applyStroke } from '../game/engine.js';

const pools = JSON.parse(readFileSync(new URL('../data/pools.json', import.meta.url), 'utf8'));

test('saved run is deterministic and draws only saved characters', () => {
  const entries = [{ char: '学', reading: 'がく', meaning: 'study' }, { char: '生', reading: '', meaning: '' }];
  const run = generateSavedRun(123, pools, entries);
  assert.deepEqual(run, generateSavedRun(123, pools, entries));
  assert.equal(run.floors.length, 5);
  for (const floor of run.floors) {
    assert.equal(floor.encounters.length, NORMALS_PER_FLOOR);
    assert.ok(floor.encounters.every(entry => entry.kind === 'normal' && ['学', '生'].includes(entry.char)));
  }
  assert.ok(generateRun(123, pools).floors[4].encounters.some(entry => entry.kind === 'boss'));
});

test('one-character list repeats and can complete a run', () => {
  const run = createRun(generateSavedRun(9, pools, [{ char: '木', meaning: 'tree', reading: 'き' }]));
  for (let i = 0; i < 25; i++) {
    assert.equal(currentCharacter(run).char, '木');
    beginCharacter(run, 1);
    applyStroke(run, 'hit');
  }
  assert.equal(run.status, 'victory');
});

test('rejects empty, oversized and invalid saved lists', () => {
  for (const entries of [[], Array(21).fill({ char: '木' }), [{ char: 'abc' }]]) {
    assert.throws(() => generateSavedRun(1, pools, entries), /Saved list/);
  }
});
