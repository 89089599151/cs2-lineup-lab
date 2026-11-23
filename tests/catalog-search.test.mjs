import test from 'node:test';
import assert from 'node:assert/strict';
import { lineups } from '../lineups.js';
import { isPlayableMiragePoint, isPublicLineup, mirageTargets, nearbyTarget, queryVerifiedSmokes, walkableHeightsAt } from '../catalog-search.js';

const window = lineups.find((lineup) => lineup.id === 'mirage-window-smoke-from-cart8');
const verified = { ...window, id: 'verified' };
const sourced = { ...verified, id: 'sourced', verification: 'source-verified' };
const simulated = { ...verified, id: 'simulated', simulated: true };
const unchecked = { ...verified, id: 'unchecked', verification: undefined };
const options = { radius: 112, height: null, team: 'T', technique: '' };
const target = { ...options, mode: 'target', point: [-1163, -635] };
const start = { ...options, mode: 'start', point: [verified.position[0] + 20, verified.position[1]] };

test('recognizes the Window anchor without treating the whole map as Window', () => {
  assert.equal(nearbyTarget(target.point).id, 'window');
  assert.equal(nearbyTarget([-2000, 1200]), null);
});

test('a Mirage point requires an occupied VPK-derived navigation cell', () => {
  assert.equal(isPlayableMiragePoint([1279, -15]), true);
  assert.equal(isPlayableMiragePoint([1279, -15, -168]), true);
  for (const { id, point } of mirageTargets) assert.equal(isPlayableMiragePoint(point), true, id);

  assert.equal(isPlayableMiragePoint([0, 0]), false, 'blank space inside the original radar rectangle');
  assert.equal(isPlayableMiragePoint([770, -287]), false, 'enclosed area without a playable surface');
  assert.equal(isPlayableMiragePoint([1620, -2750]), false, 'outside the navigation bounds');
  assert.equal(isPlayableMiragePoint([NaN, -15]), false);
  assert.equal(isPlayableMiragePoint([1279, Infinity]), false);
  assert.equal(isPlayableMiragePoint(['1279', '-15']), false);
  assert.equal(isPlayableMiragePoint(null), false);
});

test('public smoke requires matching build, game evidence and a playable landing', () => {
  const flash = { ...sourced, type: 'flash' };
  const missingEvidence = { ...verified, evidence: undefined };
  const older = { ...verified, gameBuild: '0' };
  assert.deepEqual([verified, sourced, simulated, unchecked, missingEvidence, older, flash].filter(isPublicLineup),
    [verified, flash]);
});

test('start results snap to actual verified origins and keep nearby confirmed variants sorted', () => {
  const [x, y, z] = verified.position;
  const farther = { ...verified, id: 'farther', position: [x + 120, y, z] };
  const distant = { ...verified, id: 'distant', position: [x + 160, y, z] };
  const result = queryVerifiedSmokes([distant, sourced, simulated, farther, verified], start);
  assert.deepEqual(result.matches.map(({ id, score }) => [id, Math.round(score)]), [['verified', 20], ['farther', 100]]);
  assert.deepEqual(result.nearest, verified.position);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...start, team: 'CT' }).matches, []);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...start, technique: 'jump' }).matches, []);
});

test('target results require a measured effect within the selected radius and level', () => {
  assert.deepEqual(queryVerifiedSmokes([sourced, simulated, verified], target).matches.map(({ id }) => id), ['verified']);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...target, radius: 20 }).matches, []);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...target, height: -256 }).matches, []);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...target, height: nearbyTarget(target.point).z }).matches.map(({ id }) => id), ['verified']);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...target, point: [60, -2000] }).matches, []);
});

test('two playable levels at the same XY require an explicit choice', () => {
  const point = [-1040, -144];
  const [lowerZ, upperZ] = walkableHeightsAt(point);
  const lower = { ...verified, id: 'lower', landing: [...point, lowerZ] };
  const upper = { ...verified, id: 'upper', landing: [...point, upperZ] };
  const query = { ...target, point };
  const result = queryVerifiedSmokes([lower, upper], query);
  assert.equal(result.needsHeight, true);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(queryVerifiedSmokes([lower, upper], { ...query, height: result.heights[0] })
    .matches.map(({ id }) => id), ['lower']);
});

test('missing measured coordinates block catalogue and both map searches', () => {
  const records = [{ ...verified, landing: null }, { ...verified, position: undefined }];
  assert.deepEqual(records.filter(isPublicLineup), []);
  assert.deepEqual(queryVerifiedSmokes(records, start).matches, []);
  assert.deepEqual(queryVerifiedSmokes(records, target).matches, []);
});

test('B Apartments roof is rejected even in range of the named target on the radar', () => {
  const roof = {
    ...verified,
    id: 'sim-26117',
    target: 'B Apartments',
    position: [-1686.625, -1147.745, -188],
    landing: [-1686.6, 845.6, 298],
  };
  assert.deepEqual(walkableHeightsAt(roof.landing), [-40]);
  assert.equal(isPublicLineup(roof), false);
  assert.deepEqual(queryVerifiedSmokes([roof], { ...target, point: [-1748, 784] }).matches, []);
  assert.deepEqual(queryVerifiedSmokes([roof], { ...start, point: roof.position }).matches, []);
});

test('Jungle roof is rejected above the connector even under the same radar pixel', () => {
  const roof = {
    ...verified,
    id: 'sim-327',
    target: 'Connector',
    position: [1422.8, 36.437, -167.969],
    landing: [-695.1, -1186.3, 114],
  };
  assert.deepEqual(walkableHeightsAt(roof.landing), [-168]);
  assert.equal(isPublicLineup(roof), false);
  assert.deepEqual(queryVerifiedSmokes([roof], { ...target, point: roof.landing }).matches, []);
  assert.deepEqual(queryVerifiedSmokes([roof], { ...start, point: roof.position }).matches, []);
});

test('two close floors retain their own heights and the matching result', () => {
  const point = [-2416, -112];
  const [lowerZ, upperZ] = walkableHeightsAt(point);
  const lower = { ...verified, id: 'lower', landing: [...point, lowerZ] };
  const upper = { ...verified, id: 'upper', landing: [...point, upperZ] };
  assert.deepEqual([lowerZ, upperZ], [-160, -112]);
  assert.deepEqual(queryVerifiedSmokes([lower, upper], { ...target, point }).heights, [-160, -112]);
  assert.deepEqual(queryVerifiedSmokes([lower, upper], { ...target, point, height: upperZ })
    .matches.map(({ id }) => id), ['upper']);
});