import { mirageWalkableHeights } from './data/mirage-walkable-heights.js';

// Locations use real effect coordinates or the installed map's place markers.
export const mirageTargets = [
  { id: 'window', label: 'Окно', target: 'Window', point: [-1163, -635], z: -165.96875 },
  { id: 'connector', label: 'Коннектор', target: 'Connector', point: [-621, -897], z: -245.96875 },
  { id: 'topmid', label: 'Топ-мид', target: 'Top Mid', point: [475, -900] },
  { id: 'short', label: 'Шорт', target: 'Short', point: [-1219, 231], z: -167.07593 },
  { id: 'ct', label: 'КТ', target: 'CT', point: [-881, -2456], z: -108.840164 },
  { id: 'ramp', label: 'Яма', target: 'T Ramp', point: [374, -1517], z: -202.25638 },
  { id: 'apartments', label: 'Ковры B', target: 'B Apartments', point: [-1748, 784], z: -45.96875 },
];

export const difficultyLabels = { easy: 'Простой', medium: 'Средний', hard: 'Сложный' };
export const verificationLabels = {
  'in-game': 'Проверено в CS2',
  'geometry-calculated': 'Рассчитано по геометрии карты',
  'source-verified': 'По источнику',
  unconfirmed: 'Нужна проверка',
};

export const START_SNAP_RADIUS = 128;
const MAX_VERTICAL_DISTANCE = 48;
const planeDistance = ([x, y], [otherX, otherY]) => Math.hypot(x - otherX, y - otherY);
const isPoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

export function nearbyTarget(point) {
  if (!point) return null;
  return mirageTargets.find((target) => planeDistance(point, target.point) <= 96) ?? null;
}

export function walkableHeightsAt([x, y]) {
  const { cellSize, cells } = mirageWalkableHeights;
  return cells[`${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`] ?? [];
}

export function isPlayableMiragePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    && walkableHeightsAt(point).length > 0;
}

export function isPublicLineup(lineup) {
  if (lineup.simulated) return false;
  if (lineup.type !== 'smoke') return true;
  return lineup.verification === 'in-game'
    && lineup.map === mirageWalkableHeights.map
    && lineup.gameBuild === mirageWalkableHeights.gameBuild
    && Boolean(lineup.verifiedAt)
    && lineup.evidence?.method === 'cs2-practice-annotation'
    && isPoint(lineup.position) && isPoint(lineup.landing)
    && walkableHeightsAt(lineup.landing).some((floor) => Math.abs(lineup.landing[2] - floor) <= MAX_VERTICAL_DISTANCE);
}

function targetLevels(point) {
  const named = mirageTargets.find((target) => target.point[0] === point[0] && target.point[1] === point[1]);
  return Number.isFinite(named?.z) ? [named.z] : walkableHeightsAt(point);
}

function closestLevel(z, levels) {
  return levels.reduce((closest, level) =>
    Math.abs(z - level) < Math.abs(z - closest) ? level : closest, Infinity);
}

export function smokeRecipeKey({ position, angles, technique, strength = 1 }) {
  const pose = [...position, ...angles.slice(0, 2)].map((value) => Math.round(value * 1000).toString(36));
  return [...pose, technique, strength * 2].join('_');
}

export function queryVerifiedSmokes(lineups, options) {
  return queryMirageSmokes(lineups, [], options);
}

export function queryMirageSmokes(lineups, calculated, { mode, point, team, technique, radius = 112, height = null }) {
  const fromStart = mode === 'start';
  const levels = fromStart ? walkableHeightsAt(point) : targetLevels(point);
  const maxDistance = fromStart ? START_SNAP_RADIUS : radius;

  const verified = lineups.filter((lineup) => lineup.type === 'smoke' && isPublicLineup(lineup));
  const nearby = [...verified, ...calculated].filter((lineup) =>
    (!team || lineup.side === team)
    && (!technique || lineup.technique === technique)
  ).map((lineup) => {
    const location = fromStart ? lineup.position : lineup.landing;
    const level = closestLevel(location[2], levels);
    return { lineup, level, z: location[2], score: planeDistance(point, location) };
  }).filter(({ level, z, score }) => score <= maxDistance && Math.abs(level - z) <= MAX_VERTICAL_DISTANCE)
    .sort((left, right) => left.score - right.score || (left.lineup.flightTime ?? Infinity) - (right.lineup.flightTime ?? Infinity));

  const heights = [...new Set(levels)].sort((left, right) => left - right);
  const closest = height === null ? Infinity : closestLevel(height, heights);
  const selectedHeight = height !== null && Math.abs(closest - height) <= 32 ? closest : null;
  const needsHeight = selectedHeight === null && heights.length > 1 && nearby.length > 0;
  const onLevel = needsHeight || (height !== null && selectedHeight === null) ? []
    : nearby.filter(({ level }) => selectedHeight === null || level === selectedHeight);
  const knownRecipes = new Set(verified.filter((lineup) => Array.isArray(lineup.angles)).map(smokeRecipeKey));
  const confirmed = [];
  const generated = new Map();
  for (const { lineup, score } of onLevel) {
    if (lineup.verification === 'in-game') {
      confirmed.push({ ...lineup, score });
      continue;
    }
    if (knownRecipes.has(smokeRecipeKey(lineup))) continue;
    const [x, y] = lineup.landing;
    const landingZone = lineup.targetId ?? [Math.floor(x / 88), Math.floor(y / 88), closestLevel(lineup.landing[2], walkableHeightsAt(lineup.landing))].join(':');
    const place = fromStart ? landingZone : lineup.position.join(':');
    const key = [place, lineup.technique, lineup.strength].join(':');
    if (!generated.has(key)) generated.set(key, { ...lineup, score });
  }

  const candidates = [...generated.values()];
  // Prioritize recognizable targets when browsing outcomes from a starting point.
  if (fromStart) candidates.sort((left, right) => Number(Boolean(right.targetId)) - Number(Boolean(left.targetId)));

  return {
    matches: [...confirmed, ...candidates],
    heights,
    selectedHeight,
    needsHeight,
    hasWalkableTarget: fromStart || levels.length > 0,
    nearest: fromStart ? onLevel[0]?.lineup.position ?? null : null,
    nearestDistance: fromStart ? onLevel[0]?.score ?? Infinity : Infinity,
  };
}
