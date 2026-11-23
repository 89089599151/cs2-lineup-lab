import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertAtlasQuality, isFloorCandidate, FLOOR_ALIGNED, UNKNOWN_SURFACE, WRONG_LEVEL } from '../geometry-guard.js';

const mockAtlas = { map: 'de_mirage', build: '2000948', rows: [[], [], []] };

test('atlas quality fails closed on mismatched rows or map build', () => {
  assert.throws(() => assertAtlasQuality(mockAtlas, Uint8Array.from([0, 1])));
  assert.throws(() => assertAtlasQuality({ ...mockAtlas, build: 'future' }, Uint8Array.from([0, 1, 2])));
  assert.throws(() => assertAtlasQuality(mockAtlas, Uint8Array.from([0, 1, 9])));
});

test('only a floor-aligned endpoint is a simulated search candidate', () => {
  const q = assertAtlasQuality(mockAtlas, Uint8Array.from([UNKNOWN_SURFACE, FLOOR_ALIGNED, WRONG_LEVEL]));
  assert.equal(isFloorCandidate(q, 0), false);
  assert.equal(isFloorCandidate(q, 1), true);
  assert.equal(isFloorCandidate(q, 2), false);
  assert.equal(isFloorCandidate(q, -1), false);
});

test('Mirage quality asset is 1 byte per atlas row and rejects wrong levels', () => {
  const buf = readFileSync(new URL('../assets/mirage-atlas-quality.bin', import.meta.url));
  assert.equal(buf.length, 143779);
  assert.ok(buf.includes(FLOOR_ALIGNED));
  assert.ok(buf.includes(WRONG_LEVEL));
  assert.ok(buf.includes(UNKNOWN_SURFACE));
  assert.equal(buf[3], FLOOR_ALIGNED); // Valve-authored T spawn jump trajectory, bounces > 4
});
