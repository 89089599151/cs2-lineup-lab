import test from 'node:test';
import assert from 'node:assert/strict';
import { librarySmokesForTarget, nearbyTarget } from '../catalog-search.js';

const instant = { type: 'smoke', side: 'T', technique: 'runjump', target: 'Window' };
const otherFloor = { ...instant, landing: [-1077, -633, -219] };
const starter = { point: [-1077, -633], radius: 112, height: null, team: 'T', technique: '' };

test('recognizes the Window anchor without treating the whole map as Window', () => {
  assert.equal(nearbyTarget(starter.point).id, 'window');
  assert.equal(nearbyTarget([-2000, 1200]), null);
});

test('returns the source-known named smoke and respects side and movement', () => {
  assert.deepEqual(librarySmokesForTarget([instant], starter), [instant]);
  assert.deepEqual(librarySmokesForTarget([instant], { ...starter, team: 'CT' }), []);
  assert.deepEqual(librarySmokesForTarget([instant], { ...starter, technique: 'jump' }), []);
});

test('a selected floor excludes unknown or different heights', () => {
  assert.deepEqual(librarySmokesForTarget([instant, otherFloor], { ...starter, height: -256 }), []);
  assert.deepEqual(librarySmokesForTarget([instant, otherFloor], { ...starter, height: -192 }), [otherFloor]);
});

test('arbitrary points require a measured landing inside the radius', () => {
  const related = { ...instant, landing: [42, -1990, -125] };
  assert.deepEqual(librarySmokesForTarget([instant, related], { ...starter, point: [60, -2000] }), [related]);
});

test('known effects outside the exact radius are not returned as named-zone matches', () => {
  const outside = { ...instant, landing: [-1200, -633, -140] };
  assert.deepEqual(librarySmokesForTarget([outside], starter), []);
});
