import { nearbyTarget, smokeRecipeKey, walkableHeightsAt } from './catalog-search.js?v=3';
import { mirageWalkableHeights } from './data/mirage-walkable-heights.js';

const idPrefix = `calc-${mirageWalkableHeights.gameBuild}-`;
const solverUrl = 'https://github.com/NC1107/cs2-smoke-solver';
const buttons = new Map([[1, 'ЛКМ'], [0.5, 'ЛКМ + ПКМ'], [0, 'ПКМ']]);
const movements = {
  stand: 'оставаясь на месте',
  jump: 'сразу после прыжка с места',
  step: 'после одного шага вперёд',
  run: 'на бегу вперёд',
  runjump: 'в начале прыжка с разбега',
  walk: 'на тихом ходу вперёд',
  walkjump: 'в начале прыжка с тихого хода',
  crouch: 'стоя на месте в приседе',
  crouchwalkjump: 'в начале прыжка после шага в приседе',
};

export function isCalculatedSmokeId(id) {
  return typeof id === 'string' && id.startsWith(idPrefix)
    && /^[-a-z0-9_]{10,100}$/.test(id.slice(idPrefix.length));
}

export async function loadCalculatedSmokes() {
  const response = await fetch(new URL('./assets/mirage-calculated.json', import.meta.url));
  if (!response.ok) throw new Error('Не удалось загрузить расчёты Mirage.');
  return decodeCalculatedSmokes(await response.json());
}

function playablePlacement(point) {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
    && walkableHeightsAt(point).some((floor) => Math.abs(floor - point[2]) <= 24);
}

function labelPoint([x, y]) {
  return `${Math.round(x)} / ${Math.round(y)}`;
}

export function decodeCalculatedSmokes(asset) {
  const { map, gameBuild, metadata, origins, teams, kinds, rows } = asset;
  if (map !== mirageWalkableHeights.map || String(gameBuild) !== mirageWalkableHeights.gameBuild
    || metadata?.vpkSha256 !== mirageWalkableHeights.vpkSha256
    || metadata?.navSha256 !== mirageWalkableHeights.navSha256
    || ![origins, teams, kinds, rows].every(Array.isArray) || origins.length !== teams.length) {
    throw new Error('Расчёты не совпадают с версией карты Mirage.');
  }

  const validOrigins = origins.map(playablePlacement);
  return rows.flatMap(([origin, pitch, yaw, kind, strength, x, y, z, flightTime, bounces]) => {
    const landing = [x, y, z];
    const technique = kinds[kind];
    const side = teams[origin];
    if (!validOrigins[origin] || !['T', 'CT'].includes(side) || !Object.hasOwn(movements, technique)
      || !buttons.has(strength) || ![pitch, yaw, flightTime].every(Number.isFinite)
      || Math.abs(pitch) > 90 || flightTime <= 0 || !playablePlacement(landing)) return [];

    const position = origins[origin];
    const named = nearbyTarget(landing);
    const targetId = named && (!Number.isFinite(named.z) || Math.abs(named.z - z) <= 48) ? named.id : null;
    const target = targetId ? named.label : labelPoint(landing);
    const angles = [pitch, yaw, 0];
    return [{
      id: `${idPrefix}${smokeRecipeKey({ position, angles, technique, strength })}`,
      type: 'smoke', map, gameBuild: String(gameBuild), position, landing,
      name: `Смок · ${target}`, from: labelPoint(position), target, targetId, side, technique, strength,
      angles, flightTime, bounces,
      instructions: `Зажми ${buttons.get(strength)} и отпусти ${movements[technique]}.`,
      verification: 'geometry-calculated', sourceLabel: 'CS2 Smoke Solver', sourceUrl: solverUrl,
    }];
  });
}
