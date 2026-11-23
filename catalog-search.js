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

export function librarySmokesForTarget(lineups, { point, team, technique, radius, height }) {
  const target = nearbyTarget(point);
  return lineups.filter((lineup) => {
    if (lineup.type !== 'smoke' || (team && lineup.side !== team)
      || (technique && lineup.technique !== technique)) return false;

    if (lineup.landing) {
      const sameHeight = height === null || Math.round(lineup.landing[2] / 64) * 64 === height;
      return sameHeight && planeDistance(point, lineup.landing) <= radius;
    }

    // A source can confirm the named target while omitting its exact landing.
    return height === null && Boolean(target) && lineup.target === target.target;
  });
}
