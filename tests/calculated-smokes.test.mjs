import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCalculatedSmokes, isCalculatedSmokeId } from '../calculated-smokes.js';
import { queryMirageSmokes, walkableHeightsAt } from '../catalog-search.js';
import { lineups } from '../lineups.js';
import { practiceCommand } from '../practice-command.js';

const start = { mode: 'start', point: [1279, -15], team: 'T' };
const window = { mode: 'target', point: [-1163, -635], radius: 112 };
const asset = JSON.parse(readFileSync(new URL('../assets/mirage-calculated.json', import.meta.url)));
const calculated = decodeCalculatedSmokes(asset);

test('the reported T Spawn point returns playable, shareable calculated throws', () => {
  const options = queryMirageSmokes(lineups, calculated, start);
  assert.equal(options.needsHeight, false);
  assert.ok(options.matches.length > 0);
  assert.ok(options.matches.every((shot) => shot.side === 'T' && shot.verification === 'geometry-calculated'));
  assert.ok(options.matches.some((shot) => shot.targetId === 'topmid' && shot.position[0] === 1279 && shot.position[1] === -15));
  const shot = options.matches[0];
  assert.ok(isCalculatedSmokeId(shot.id));
  assert.match(practiceCommand(shot), /setpos .*; noclip 0; setang .*; give weapon_smokegrenade$/);
  assert.equal(queryMirageSmokes(lineups, calculated, { ...start, team: 'CT' }).matches.length, 0);
  assert.equal(queryMirageSmokes(lineups, calculated, { ...start, height: -168 }).matches.length, options.matches.length);
});

test('reverse search includes the native Window measurement and calculated starting positions', () => {
  const { matches } = queryMirageSmokes(lineups, calculated, window);
  assert.equal(matches[0]?.id, 'mirage-window-smoke-from-cart8');
  assert.ok(matches.some((shot) => shot.verification === 'geometry-calculated'));
  assert.ok(matches.every((shot) => Math.abs(shot.landing[2] + 165.96875) <= 48));
});

test('calculated share IDs do not change with row order', () => {
  const reordered = decodeCalculatedSmokes({ ...asset, rows: asset.rows.slice().reverse() });
  assert.equal(new Set(calculated.map((shot) => shot.id)).size, calculated.length);
  assert.deepEqual(reordered.map((shot) => shot.id), calculated.map((shot) => shot.id).reverse());
});

test('the calculated asset cannot reintroduce the two reported rooftop throws', () => {
  const knownFailures = [
    { position: [-1686.625, -1147.745, -188], angles: [-50, 90], landing: [-1686.6, 845.6, 298] },
    { position: [1422.8, 36.437, -167.969], angles: [-30, -150], landing: [-695.1, -1186.3, 114] },
  ];
  for (const failure of knownFailures) {
    assert.ok(walkableHeightsAt(failure.landing).every((floor) => Math.abs(floor - failure.landing[2]) > 200));
    assert.equal(calculated.some(({ position, angles }) => position.every((value, idx) => Math.abs(value - failure.position[idx]) < 2)
      && failure.angles.every((value, idx) => Math.abs(value - angles[idx]) < 0.25)), false);
  }
});
