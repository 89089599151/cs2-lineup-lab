import test from 'node:test';
import assert from 'node:assert/strict';
import { lineups } from '../lineups.js';
import { isPublicLineup } from '../catalog-search.js';
import { mirageLiveChecks } from '../data/mirage-live-checks.js';

test('every public smoke is backed by a native CS2 practice observation', () => {
  const publicSmokes = lineups.filter(lineup => lineup.type === 'smoke' && isPublicLineup(lineup));
  assert.ok(publicSmokes.length > 0);
  assert.deepEqual(publicSmokes.map(lineup => lineup.id).sort(), Object.keys(mirageLiveChecks).sort());

  for (const lineup of publicSmokes) {
    assert.equal(lineup.verification, 'in-game');
    assert.match(lineup.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(lineup.gameBuild, /^\d+$/);
    assert.equal(lineup.evidence.method, 'cs2-practice-annotation');
    assert.ok(lineup.evidence.attempts > 0);
    assert.equal(lineup.evidence.attempts, lineup.evidence.destinations.length);
    assert.deepEqual(lineup.landing, lineup.evidence.destinations.at(-1));
    for (const position of lineup.evidence.destinations) {
      assert.equal(position.length, 3);
      assert.ok(position.every(Number.isFinite));
    }
  }
});
