
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicLineup, nearbyTarget, queryVerifiedSmokes } from '../catalog-search.js';

const verified = {
  id: 'verified', type: 'smoke', verification: 'in-game', side: 'T', technique: 'runjump',
  target: 'Window', position: [1200, -200, -168], landing: [-1163, -635, -165],
};
const sourced = { ...verified, id: 'sourced', verification: 'source-verified' };
const simulated = { ...verified, id: 'simulated', simulated: true };
const unchecked = { ...verified, id: 'unchecked', verification: undefined };
const target = { mode: 'target', point: [-1163, -635], radius: 112, height: null, team: 'T', technique: '' };
const start = { mode: 'start', point: [1220, -200], height: null, team: 'T', technique: '' };

test('recognizes the Window anchor without treating the whole map as Window', () => {
  assert.equal(nearbyTarget(target.point).id, 'window');
  assert.equal(nearbyTarget([-2000, 1200]), null);
});

test('public lineup gate keeps non-smokes and excludes every unverified or simulated smoke', () => {
  const confirmedFlash = { ...sourced, type: 'flash' };
  assert.deepEqual(
    [verified, sourced, simulated, unchecked, confirmedFlash].filter(isPublicLineup),
    [verified, confirmedFlash],
  );
});

test('start results snap to actual verified origins and keep nearby confirmed variants sorted', () => {
  const farther = { ...verified, id: 'farther', position: [1320, -200, -168] };
  const distant = { ...verified, id: 'distant', position: [1360, -200, -168] };
  const result = queryVerifiedSmokes([distant, sourced, simulated, farther, verified], start);
  assert.deepEqual(result.matches.map(({ id, score }) => [id, score]), [['verified', 20], ['farther', 100]]);
  assert.deepEqual(result.nearest, verified.position);
  assert.equal(result.nearestDistance, 20);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...start, team: 'CT' }).matches, []);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...start, technique: 'jump' }).matches, []);
});

test('target results require a measured effect within the actual radius', () => {
  const nearer = { ...verified, id: 'nearer', landing: [-1160, -635, -169] };
  const outside = { ...verified, id: 'outside', landing: [-1280, -635, -140] };
  const unknown = { ...verified, id: 'unknown', landing: null };
  const result = queryVerifiedSmokes([outside, unknown, sourced, simulated, nearer, verified], target);
  assert.deepEqual(result.matches.map(({ id, score }) => [id, score]), [['verified', 0], ['nearer', 3]]);
  assert.deepEqual(queryVerifiedSmokes([verified], { ...target, point: [60, -2000] }).matches, []);
});

test('height choices correspond to the active end of the real throw', () => {
  const otherFloor = {
    ...verified, id: 'other-floor', position: [1200, -200, -99], landing: [-1163, -635, -252],
  };
  assert.deepEqual(queryVerifiedSmokes([verified, otherFloor], start).heights, [-192, -128]);
  assert.deepEqual(queryVerifiedSmokes([verified, otherFloor], target).heights, [-256, -192]);
  assert.deepEqual(queryVerifiedSmokes([verified, otherFloor], { ...target, height: -256 }).matches.map(({ id }) => id),
    ['other-floor']);
});

test('smokes without measured start or effect coordinates stay out of both map searches', () => {
  const records = [{ ...verified, landing: null }, { ...verified, position: undefined }];
  assert.equal(queryVerifiedSmokes(records, start).nearest, null);
  assert.deepEqual(queryVerifiedSmokes(records, start).matches, []);
  assert.deepEqual(queryVerifiedSmokes(records, target).matches, []);
});
