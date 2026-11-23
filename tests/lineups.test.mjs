import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lineups } from '../lineups.js';

const techniques = new Set(['stand', 'jump', 'step', 'run', 'walk', 'crouch', 'runjump', 'walkjump', 'crouchwalkjump']);
const categories = new Set(['instant', 'execute', 'defense', 'retake', 'one-way', 'choke', 'fake', 'pro']);
const states = new Set(['in-game', 'source-verified', 'unconfirmed']);
const isVector = (sequence) => Array.isArray(sequence) && sequence.length === 3 && sequence.every(Number.isFinite);

test('catalog recipes have a unique identity, complete provenance and valid practice input', () => {
  const ids = new Set();
  const poses = new Set();

  for (const recipe of lineups) {
    const { id, map, name, from, target, type, technique, strength, angles, position, landing } = recipe;
    assert.match(id, /^mirage-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!ids.has(id), `duplicate id ${id}`);
    ids.add(id);
    assert.equal(map, 'de_mirage');
    assert.ok([name, from, target, recipe.instructions, recipe.movement, recipe.aimCue, recipe.situation, recipe.sourceLabel]
      .every((field) => typeof field === 'string' && field.trim()), id);
    assert.ok(['smoke', 'flash', 'molotov', 'he'].includes(type), id);
    assert.ok(techniques.has(technique), id);
    assert.ok(categories.has(recipe.category), id);
    assert.ok(['T', 'CT'].includes(recipe.side), id);
    assert.ok(['easy', 'medium', 'hard'].includes(recipe.difficulty), id);
    assert.ok(states.has(recipe.verification), id);
    assert.match(recipe.sourceCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new URL(recipe.sourceUrl).protocol, 'https:');
    assert.ok([0, 0.5, 1].includes(strength), id);

    if (recipe.verification === 'in-game') {
      assert.match(recipe.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(recipe.gameBuild, id);
    }

    if (position === null || angles === null) {
      assert.equal(recipe.verification, 'unconfirmed');
      assert.equal(position, null);
      assert.equal(angles, null);
      continue;
    }

    assert.equal(recipe.positionConvention, 'feet', id);
    assert.ok(isVector(position), id);
    assert.ok(isVector(angles), id);
    assert.ok(Math.abs(angles[0]) <= 89 && Math.abs(angles[1]) <= 180 && angles[2] === 0, id);
    assert.ok(landing === null || isVector(landing), id);
    const pose = JSON.stringify([map, type, position, angles, technique, strength]);
    assert.ok(!poses.has(pose), `duplicate throw ${id}`);
    poses.add(pose);
    assert.ok(recipe.flightTime === undefined || (recipe.flightTime > 0 && recipe.flightTime !== 9.999), id);

    if (recipe.sourcePositionConvention === 'eye') {
      assert.ok(isVector(recipe.sourcePosition), id);
      assert.deepEqual(recipe.sourcePosition.slice(0, 2), position.slice(0, 2), id);
      assert.ok(Math.abs(recipe.sourcePosition[2] - position[2] - 64) < 0.00002, id);
    }
  }
});

test('five Mirage instant Window starts have sourced launch poses and exact reported effect coordinates', () => {
  const instants = lineups.filter(({ category, target }) => category === 'instant' && target === 'Window');
  const starts = new Map([
    [1, [1296, -352]],
    [2, [1216, -211]],
    [3, [1216, -115]],
    [4, [1216, -16]],
    [5, [1296, 32]],
  ]);
  assert.equal(instants.length, 10);
  for (const [spawn, expected] of starts) {
    const variants = instants.filter((entry) => entry.spawn === spawn);
    assert.ok(variants.some(({ landing }) => isVector(landing)), `spawn ${spawn}`);
    for (const entry of variants) {
      assert.equal(entry.side, 'T');
      assert.equal(entry.technique, 'runjump');
      assert.equal(entry.strength, 1);
      assert.deepEqual(entry.position.slice(0, 2).map(Math.round), expected);
    }
  }
});
