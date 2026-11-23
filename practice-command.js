const grenadeItems = new Map([
  ['smoke', 'weapon_smokegrenade'],
  ['flash', 'weapon_flashbang'],
  ['molotov', 'weapon_molotov'],
  ['he', 'weapon_hegrenade'],
]);

const floorClearance = 1;

function consoleNumber(value) {
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}

export function practiceCommand(lineup) {
  const { position, angles, type, verification } = lineup ?? {};
  const item = grenadeItems.get(type);
  if (verification === 'unconfirmed' || !item || !Array.isArray(position) || position.length !== 3
    || !Array.isArray(angles) || angles.length < 2 || angles.length > 3) {
    return '';
  }

  const [x, y, z] = position;
  const [pitch, yaw, roll = 0] = angles;
  if (![x, y, z].every(value => Number.isFinite(value) && Math.abs(value) <= 32768)
    || ![pitch, yaw, roll].every(Number.isFinite) || Math.abs(pitch) > 90) {
    return '';
  }

  const turn = yaw % 360;
  const viewYaw = turn > 180 ? turn - 360 : turn < -180 ? turn + 360 : turn;
  const origin = [x, y, z + floorClearance].map(consoleNumber).join(' ');
  const view = [pitch, viewYaw, 0].map(consoleNumber).join(' ');
  // The exact teleport can enable noclip when the player hull intersects the map.
  return [
    'sv_cheats 1',
    'setpos ' + origin,
    'noclip 0',
    'setang ' + view,
    'give ' + item,
  ].join('; ');
}
