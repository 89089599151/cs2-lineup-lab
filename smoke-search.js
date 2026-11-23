import { assertAtlasQuality, isFloorCandidate } from './geometry-guard.js';
const atlasPath = './assets/mirage-smokes.json.gz';
const landingCell = 140;
const destinationGroup = 96;
const verticalStep = 64;
const smokeSolverUrl = 'https://github.com/NC1107/cs2-smoke-solver';

// The selected team describes which spawn is closer to the throw position.
const teamSpawns = { T: [1258.35294, -149.23529], CT: [-1754.0625, -1893.875] };

let atlasRequest;
let pathIndexRequest;
let fullPathPack;
const pathGroups = new Map();

const distance = (point, other) => Math.hypot(point[0] - other[0], point[1] - other[1]);

function gridKey(column, row) {
  return `${column}:${row}`;
}

export function sideAt(position) {
  return distance(position, teamSpawns.T) <= distance(position, teamSpawns.CT) ? 'T' : 'CT';
}

export function loadSmokeAtlas() {
  atlasRequest ??= fetch(atlasPath).then(async (response) => {
    if (!response.ok || !response.body) throw new Error('Не удалось загрузить расчёты Mirage.');
    const jsonStream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const atlas = await new Response(jsonStream).json();
    if (atlas.map !== 'de_mirage' || !atlas.origins.length || !atlas.rows.length || atlas.teams?.length !== atlas.origins.length) {
      throw new Error('Нет данных о бросках Mirage.');
    }
    const qualityResponse = await fetch('./assets/mirage-atlas-quality.bin');
    if (!qualityResponse.ok) throw new Error('Проверка поверхности Mirage недоступна.');
    const quality = assertAtlasQuality(atlas, new Uint8Array(await qualityResponse.arrayBuffer()));
    const outcomes = atlas.origins.map(() => []);
    const targetGrid = new Map();
    atlas.rows.forEach((row, index) => {
      const [originIndex, , , , , x, y] = row;
      const key = gridKey(Math.floor(x / landingCell), Math.floor(y / landingCell));
      // Store all outcome indexes so flight paths retain their original row alignment.
      // Only floor-aligned candidates can enter the target search index.
      if (isFloorCandidate(quality, index)) {
        if (!targetGrid.has(key)) targetGrid.set(key, []);
        targetGrid.get(key).push(index);
      }
      outcomes[originIndex].push(index);
    });
    return { ...atlas, outcomes, targetGrid, quality };
  }).catch((error) => {
    atlasRequest = undefined;
    throw error;
  });
  return atlasRequest;
}

function targetIndex(atlas, point, radius) {
  const matches = [];
  for (let x = Math.floor((point[0] - radius) / landingCell); x <= Math.floor((point[0] + radius) / landingCell); x++) {
    for (let y = Math.floor((point[1] - radius) / landingCell); y <= Math.floor((point[1] + radius) / landingCell); y++) {
      matches.push(...(atlas.targetGrid.get(gridKey(x, y)) ?? []));
    }
  }
  return matches;
}

function heightTier(height) {
  return Math.round(height / verticalStep) * verticalStep;
}

function planeLabel([x, y]) {
  return `${Math.round(x)} / ${Math.round(y)}`;
}

export function strengthLabel(strength) {
  if (strength === 0) return 'ПКМ';
  if (strength < 1) return 'ЛКМ + ПКМ';
  return 'ЛКМ';
}

function describeThrow(technique, strength) {
  const buttons = strengthLabel(strength);
  if (technique === 'jump') return `Зажми ${buttons}, подпрыгни и отпусти кнопки в начале прыжка.`;
  if (technique === 'step') return `Зажми ${buttons}, начни движение вперёд и отпусти кнопки на шаге.`;
  return `Удерживай ${buttons} и отпусти, оставаясь на месте.`;
}

function asLineup(atlas, index, mode, score) {
  const [origin, pitch, yaw, kind, strength, x, y, z, time, bounces] = atlas.rows[index];
  const position = atlas.origins[origin];
  const landing = [x, y, z];
  const technique = atlas.kinds[kind];
  return {
    id: `sim-${index}`,
    map: atlas.map,
    name: mode === 'start' ? `Смок к ${planeLabel(landing)}` : `Старт ${planeLabel(position)}`,
    from: planeLabel(position),
    target: planeLabel(landing),
    type: 'smoke',
    technique,
    position,
    angles: [pitch, yaw, 0],
    landing,
    flightTime: time,
    bounces,
    pathGroup: origin,
    pathRow: atlas.outcomes[origin].indexOf(index),
    strength,
    team: atlas.teams[origin],
    score,
    simulated: true,
    simulationStatus: 'floor-aligned-unverified',
    instructionsNote: 'Симуляция: совпадает с уровнем пола по NAV; траектория и раскрытие дыма в CS2 не подтверждены.',
    instructions: describeThrow(technique, strength),
    sourceLabel: 'CS2 Smoke Solver',
    sourceUrl: smokeSolverUrl,
  };
}

export function querySmoke(atlas, { mode, point, team, radius, height, technique }) {
  const group = new Map();
  let nearest = null;
  let nearestDistance = Infinity;
  let indexes;
  let heights = [];

  if (mode === 'start') {
    const candidates = atlas.origins.map((position, index) => ({
      position, index, distance: distance(position, point),
    })).filter(({ position, index, distance }) => distance <= atlas.sampleStep * 1.25
      && (!team || atlas.teams[index] === team)
      && atlas.outcomes[index].length);

    candidates.sort((left, right) => left.distance - right.distance);
    if (candidates.length) {
      const available = candidates.filter((candidate) => candidate.distance <= candidates[0].distance + 44);
      heights = [...new Set(available.map(({ position }) => heightTier(position[2])))];
      const winner = available.find(({ position }) => heightTier(position[2]) === height) ?? available[0];
      nearest = winner.position;
      nearestDistance = winner.distance;
      indexes = atlas.outcomes[winner.index];
    } else {
      indexes = [];
    }
  } else {
    indexes = targetIndex(atlas, point, radius);
  }

  const targetHeights = new Set();
  indexes.forEach((index) => {
    if (!isFloorCandidate(atlas.quality, index)) return;
    const [origin, , , kind, strength, x, y, z, time] = atlas.rows[index];
    if (team && atlas.teams[origin] !== team) return;
    if (technique && atlas.kinds[kind] !== technique) return;

    const tier = heightTier(z);
    let key;
    let score;
    if (mode === 'target') {
      score = distance(point, [x, y]);
      if (score > radius) return;
      targetHeights.add(tier);
      if (height !== null && height !== tier) return;
      key = `${origin}:${kind}:${strength}`;
    } else {
      score = time;
      key = `${Math.floor(x / destinationGroup)}:${Math.floor(y / destinationGroup)}:${tier}:${kind}:${strength}`;
    }
    const current = group.get(key);
    if (!current || score < current.score || (score === current.score && time < current.time)) {
      group.set(key, { index, score, time });
    }
  });

  if (mode === 'target') heights = [...targetHeights];
  heights.sort((left, right) => right - left);
  const matches = [...group.values()].sort((left, right) => left.score - right.score || left.time - right.time);
  return {
    matches: matches.map(({ index, score }) => asLineup(atlas, index, mode, score)),
    heights,
    nearest,
    nearestDistance,
  };
}
async function loadPathGroup(group) {
  pathIndexRequest ??= fetch('./assets/smoke-paths-index.json').then((response) => {
    if (!response.ok) throw new Error('Flight path index unavailable');
    return response.json();
  }).catch((error) => {
    pathIndexRequest = undefined;
    throw error;
  });

  const { groups } = await pathIndexRequest;
  const [start, size, rows] = groups[group];
  const end = start + size;
  let stream;
  if (fullPathPack) {
    stream = new Blob([(await fullPathPack).slice(start, end)]).stream();
  } else {
    const response = await fetch('./assets/smoke-paths.gzpack', { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (response.status === 206) {
      stream = response.body;
    } else if (response.status === 200) {
      fullPathPack ??= response.arrayBuffer().catch((error) => {
        fullPathPack = undefined;
        throw error;
      });
      stream = new Blob([(await fullPathPack).slice(start, end)]).stream();
    } else {
      throw new Error('Flight path unavailable');
    }
  }

  const binary = await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const view = new DataView(binary);
  if (view.getUint16(0, true) !== rows) throw new Error('Invalid flight path group');
  const offsets = [];
  let offset = 2;
  for (let row = 0; row < rows; row++) {
    offsets.push(offset);
    offset += 1 + view.getUint8(offset) * 6;
  }
  return { view, offsets };
}

export async function loadFlightPath(lineup) {
  const group = lineup.pathGroup;
  if (!pathGroups.has(group)) {
    pathGroups.set(group, loadPathGroup(group).catch((error) => {
      pathGroups.delete(group);
      throw error;
    }));
  }
  const { view, offsets } = await pathGroups.get(group);
  const start = offsets[lineup.pathRow];
  const size = view.getUint8(start);
  return Array.from({ length: size }, (_, point) => {
    const offset = start + 1 + point * 6;
    return [view.getInt16(offset, true), view.getInt16(offset + 2, true), view.getInt16(offset + 4, true)];
  });
}
