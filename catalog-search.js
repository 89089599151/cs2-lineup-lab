// Target anchors use recorded effects from Valve and CS2Util guides. Top Mid uses the game place center.
export const mirageTargets = [
  { id: 'window', label: 'Окно', target: 'Window', point: [-1163, -635] },
  { id: 'connector', label: 'Коннектор', target: 'Connector', point: [-621, -897] },
  { id: 'topmid', label: 'Топ-мид', target: 'Top Mid', point: [475, -900] },
  { id: 'short', label: 'Шорт', target: 'Short', point: [-1219, 231] },
  { id: 'ct', label: 'КТ', target: 'CT', point: [-881, -2456] },
  { id: 'ramp', label: 'Яма', target: 'T Ramp', point: [374, -1517] },
  { id: 'apartments', label: 'Ковры B', target: 'B Apartments', point: [-1748, 784] },
];

export const difficultyLabels = { easy: 'Простой', medium: 'Средний', hard: 'Сложный' };
export const verificationLabels = {
  'in-game': 'Проверено в CS2',
  'source-verified': 'По источнику',
  unconfirmed: 'Нужна проверка',
};

const planeDistance = ([x, y], [otherX, otherY]) => Math.hypot(x - otherX, y - otherY);

export function nearbyTarget(point) {
  if (!point) return null;
  return mirageTargets.find((target) => planeDistance(point, target.point) <= 96) ?? null;
}


export const START_SNAP_RADIUS = 128;

const isPoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const layer = (z) => Math.round(z / 64) * 64;

export function isPublicLineup(lineup) {
  return !lineup.simulated && (lineup.type !== 'smoke' || lineup.verification === 'in-game');
}

export function queryVerifiedSmokes(lineups, { mode, point, team, technique, radius = 112, height = null }) {
  const fromStart = mode === 'start';
  const end = fromStart ? 'position' : 'landing';
  const maxDistance = fromStart ? START_SNAP_RADIUS : radius;
  const nearby = lineups.filter((lineup) =>
    lineup.type === 'smoke' && isPublicLineup(lineup)
    && isPoint(lineup.position) && isPoint(lineup.landing)
    && (!team || lineup.side === team)
    && (!technique || lineup.technique === technique)
  ).map((lineup) => ({ ...lineup, score: planeDistance(point, lineup[end]) }))
    .filter((lineup) => lineup.score <= maxDistance)
    .sort((a, b) => a.score - b.score);

  const heights = [...new Set(nearby.map((lineup) => layer(lineup[end][2])))].sort((a, b) => a - b);
  const matches = height === null ? nearby : nearby.filter((lineup) => layer(lineup[end][2]) === height);
  const nearest = fromStart ? matches[0] : undefined;

  return {
    matches,
    heights,
    nearest: nearest?.position ?? null,
    nearestDistance: nearest?.score ?? Infinity,
  };
}
