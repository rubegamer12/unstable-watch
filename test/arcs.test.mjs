import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyArcTitle } from '../src/arcs.mjs';

test('normalizes common creator playlist names into shared arc folders', () => {
  assert.deepEqual(classifyArcTitle('Unstable SMP - Mafia Arc'), { key: 'mafia', name: 'Mafia' });
  assert.deepEqual(classifyArcTitle('Cave Kingdom Arc | Wemmbu POV'), { key: 'cindercrest', name: 'Cindercrest' });
  assert.deepEqual(classifyArcTitle('Power VS Skill - Unstable Universe'), { key: 'power-vs-skill', name: 'Power vs Skill' });
  assert.deepEqual(classifyArcTitle('The NULL Arc Playlist'), { key: 'null', name: 'NULL' });
});

test('keeps unknown arc playlist names usable instead of dropping them', () => {
  const result = classifyArcTitle('Unstable SMP - Seven Kingdoms Arc');
  assert.ok(result.key);
  assert.ok(result.name);
});
