import assert from 'node:assert/strict';
import test from 'node:test';
import { practiceCommand } from '../practice-command.js';

const windowSmoke = {
  type: 'smoke',
  position: [1422.953491, -55.96875, -167.96875],
  angles: [-20.407055, -168.492462, 0],
};

test('places the player above the floor and sets the view after disabling flight', () => {
  assert.equal(
    practiceCommand(windowSmoke),
    'sv_cheats 1; setpos 1422.953491 -55.96875 -166.96875; noclip 0; '
      + 'setang -20.407055 -168.492462 0; give weapon_smokegrenade',
  );
});

test('keeps angle roll neutral and accepts pitch and yaw without roll', () => {
  assert.match(
    practiceCommand({ ...windowSmoke, angles: [-0, 270] }),
    /; setang 0 -90 0; /,
  );
  assert.match(
    practiceCommand({ ...windowSmoke, angles: [-30, 179.9, 45] }),
    /; setang -30 179\.9 0; /,
  );
});

test('limits each supported grenade to its built-in item and force-off movement mode', () => {
  const items = {
    smoke: 'weapon_smokegrenade',
    flash: 'weapon_flashbang',
    he: 'weapon_hegrenade',
    molotov: 'weapon_molotov',
  };
  for (const [type, item] of Object.entries(items)) {
    const commands = practiceCommand({ ...windowSmoke, type }).split('; ');
    assert.equal(commands.length, 5);
    assert.equal(commands[2], 'noclip 0');
    assert.equal(commands[4], 'give ' + item);
    assert.ok(commands.every(command => !/^set(?:pos|ang)_exact\b/.test(command)));
  }
});

test('rejects missing coordinates, non-finite numbers, and injected command text', () => {
  for (const badLineup of [
    null,
    {},
    { ...windowSmoke, verification: 'unconfirmed' },
    { ...windowSmoke, position: null },
    { ...windowSmoke, position: [1, 2] },
    { ...windowSmoke, position: Array(3) },
    { ...windowSmoke, position: [1, 2, Infinity] },
    { ...windowSmoke, position: [1, 2, NaN] },
    { ...windowSmoke, position: [1, 2, 1e100] },
    { ...windowSmoke, position: ['1; noclip', 2, 3] },
    { ...windowSmoke, angles: [1, '"\nnoclip 1'] },
    { ...windowSmoke, angles: [1, 2, Infinity] },
    { ...windowSmoke, angles: [-91, 2] },
    { ...windowSmoke, type: 'constructor' },
    { ...windowSmoke, type: 'smoke; noclip 1' },
  ]) {
    assert.equal(practiceCommand(badLineup), '');
  }
});
