import { lineups } from './lineups.js';
import { difficultyLabels, isPublicLineup, mirageTargets, nearbyTarget, queryVerifiedSmokes, START_SNAP_RADIUS, verificationLabels } from './catalog-search.js';
import { createMapViewport, MIRAGE_RADAR, radarToWorld, worldToRadar } from './map-viewport.js';
import { practiceCommand } from './practice-command.js';

const grenadeTypes = {
  smoke: { label: 'Дым', icon: '<path d="M8 9h8v11H8zM10 9V6h4v3m-2-3V4h5m-8 9h6m-6 3h6"/>' },
  flash: { label: 'Флешка', icon: '<path d="m13.5 3-7 10H11l-.5 8 7-11H13z"/>' },
  molotov: { label: 'Молотов', icon: '<path d="M12 3c1 4-3 5-3 8-1-1-1.5-2-1.5-3C5.5 10 5 12 5 14a7 7 0 0 0 14 0c0-2.5-1-4.5-2.5-6 .1 2-1 3.5-2 4C15 8 14 5 12 3Z"/>' },
  he: { label: 'Осколочная', icon: '<path d="M9 9h6l3 4v5l-3 2H9l-3-2v-5zm1 0V6h4v3M12 6V4h5M6 15h12m-6-6v11"/>' },
};

const techniques = {
  stand: { label: 'С места', order: 0 },
  jump: { label: 'В прыжке', order: 1 },
  step: { label: 'С шагом', order: 2 },
  run: { label: 'С разбега', order: 3 },
  walk: { label: 'На тихом ходу', order: 3 },
  crouch: { label: 'В приседе', order: 3 },
  runjump: { label: 'Прыжок с разбега', order: 4 },
  walkjump: { label: 'Прыжок с тихого хода', order: 4 },
  crouchwalkjump: { label: 'Прыжок после шага в приседе', order: 5 },
};

const radarBounds = { x: 83, y: 111, width: 900, height: 790 };
const pageSize = 30;
const noLandingZones = {
  Window: [-1163, -635],
  CT: [-881, -2456],
  Ninja: [-360, -2370],
  'Top Mid': [475, -900],
  Jungle: [-850, -1537.5],
  'B Apartments': [-1748, 784],
};

const publicLineups = lineups.filter(isPublicLineup);
const byId = new Map(publicLineups.map((lineup) => [lineup.id, lineup]));
const get = (id) => document.getElementById(id);
const query = get('query');
const typeFilter = get('type-filter');
const techniqueFilter = get('technique-filter');
const sortOrder = get('sort-order');
const list = get('lineup-list');
const radar = get('radar');
const markers = get('radar-markers');
const selection = get('radar-selection');
const detail = get('detail');
const detailPanel = detail.closest('.detail-panel');
const mapCommand = get('map-command');
const compactLayout = window.matchMedia('(max-width: 730px)');
const difficultyFilter = get('difficulty-filter');
const verificationFilter = get('verification-filter');
const quickTargets = get('quick-targets');
const toast = get('toast');
const teamFilter = get('team-filter');
const rangeControl = get('target-range');
const heightControl = get('point-height');
const throwControl = get('point-throw');
const modes = {
  start: {
    title: 'Точки приземления',
    instruction: 'Выбери старт на карте',
    empty: 'Нет проверенных смоков рядом с этим стартом. Выбери другую точку или смени сторону.',
  },
  target: {
    title: 'Позиции броска',
    instruction: 'Выбери цель на карте',
    empty: 'Нет проверенных смоков в этом радиусе. Увеличь радиус или смени сторону.',
  },
  catalog: {
    title: 'Библиотека',
    instruction: 'Стартовые позиции',
    empty: 'Нет проверенных смоков с этими фильтрами.',
  },
};

let visible = [];
let selectedId = '';
let resultPage = 0;
let toastTimer;
let mode = 'catalog';
let point = null;
let height = null;
let pointResults = null;

const mapViewport = createMapViewport(radar, {
  overviewImage: radar.querySelector('image'),
  onChange: ({ scale, canZoomOut, canZoomIn, canReset }) => {
    get('zoom-out').disabled = !canZoomOut;
    get('zoom-in').disabled = !canZoomIn;
    get('zoom-reset').disabled = !canReset;
    get('zoom-reset').textContent = `${scale.toLocaleString('ru', { maximumFractionDigits: 2 })}×`;
  },
});

quickTargets.innerHTML = mirageTargets.map(({ id, label }) =>
  `<button type="button" data-target="${id}" aria-pressed="false">${label}</button>`).join('');

function safe(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function icon(paths) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function grenadeIcon(type) {
  return `<span class="grenade-icon" data-type="${type}">${icon(grenadeTypes[type].icon)}</span>`;
}

function updateCatalog() {
  const smokeOnly = typeFilter.value === 'smoke';
  verificationFilter.closest('label').hidden = smokeOnly;
  if (smokeOnly) verificationFilter.value = '';
  const extraFilters = [difficultyFilter.value, verificationFilter.value, sortOrder.value !== 'recommended'].filter(Boolean).length;
  const extraFilterCount = get('extra-filter-count');
  extraFilterCount.hidden = extraFilters === 0;
  extraFilterCount.textContent = extraFilters;
  const searchTerms = query.value.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
  visible = publicLineups.filter((lineup) => {
    const terms = [lineup.name, lineup.from, lineup.target, lineup.category, lineup.aimCue,
      grenadeTypes[lineup.type].label, techniques[lineup.technique]?.label]
      .join(' ').toLocaleLowerCase('ru');
    return (!teamFilter.value || lineup.side === teamFilter.value)
      && (!difficultyFilter.value || lineup.difficulty === difficultyFilter.value)
      && (!verificationFilter.value || verificationOf(lineup) === verificationFilter.value)
      && (!typeFilter.value || lineup.type === typeFilter.value)
      && (!techniqueFilter.value || lineup.technique === techniqueFilter.value)
      && searchTerms.every((word) => terms.includes(word));
  });

  const difficulty = { easy: 0, medium: 1, hard: 2 };
  const rank = (lineup) => difficulty[lineup.difficulty] ?? techniques[lineup.technique]?.order ?? 5;
  const byEase = (left, right) => rank(left) - rank(right);
  visible.sort((left, right) => {
    if (sortOrder.value === 'flight') {
      const timeOrder = (left.flightTime ?? Number.MAX_VALUE) - (right.flightTime ?? Number.MAX_VALUE);
      return timeOrder || byEase(left, right);
    }
    return byEase(left, right);
  });

  const currentLink = location.hash.slice(1);
  if (!visible.some((lineup) => lineup.id === selectedId)) selectedId = visible[0]?.id ?? '';
  if (byId.has(currentLink) && currentLink !== selectedId) {
    history.replaceState(null, '', lineupUrl(selectedId));
  }

  renderResults();
}

function verificationOf(lineup) {
  return lineup.verification ?? 'source-verified';
}

function selectedLineup() {
  return visible.find((lineup) => lineup.id === selectedId);
}

function renderResults() {
  const isCatalog = mode === 'catalog';
  if (!visible.some((lineup) => lineup.id === selectedId)) selectedId = visible[0]?.id ?? '';
  get('result-count').textContent = String(visible.length);
  get('result-count').hidden = !isCatalog && !point;
  get('list-empty').hidden = visible.length > 0 || (!isCatalog && !point);
  get('reset-filters').hidden = !isCatalog;
  get('empty-message').textContent = isCatalog && typeFilter.value !== 'smoke'
    ? 'Таких раскидок пока нет.'
    : pointResults?.needsHeight ? 'Выбери высоту, чтобы различить уровни карты.'
      : pointResults?.hasWalkableTarget === false ? 'На выбранной точке нет игрового прохода.'
        : modes[mode].empty;
  const selectedIndex = visible.findIndex((lineup) => lineup.id === selectedId);
  resultPage = Math.max(0, Math.floor(selectedIndex / pageSize));
  renderResultPage();
  renderMarkers(isCatalog);
  renderSelection();
}

function renderResultPage() {
  const start = resultPage * pageSize;
  const page = visible.slice(start, start + pageSize);
  list.innerHTML = page.map((lineup) => `
    <li>
      <button type="button" class="lineup-row" data-id="${safe(lineup.id)}"${lineup.id === selectedId ? ' aria-current="true"' : ''}>
        ${grenadeIcon(lineup.type)}
        <span class="row-content">
          <span class="row-title">${safe(lineup.name)}</span>
          <span class="row-meta">${safe(resultMeta(lineup))}</span>
        </span>
        ${lineup.flightTime === undefined ? '' : `<span class="row-time">${safe(formatFlightTime(lineup.flightTime))}</span>`}
      </button>
    </li>
  `).join('');
  list.scrollTop = 0;
  get('results-pages').hidden = visible.length <= pageSize;
  get('previous-results').disabled = start === 0;
  get('next-results').disabled = start + page.length >= visible.length;
  get('page-range').textContent = page.length ? `${start + 1}–${start + page.length} из ${visible.length}` : '';
}

function renderMarkers(isCatalog) {
  const positions = new Map();
  visible.forEach((lineup) => {
    const position = mode === 'start' ? lineup.landing : lineup.position;
    if (!position) return;
    const [x, y] = worldToRadar(position);
    const key = `${Math.round(x)} ${Math.round(y)}`;
    if (!positions.has(key) || lineup.id === selectedId) positions.set(key, { x, y, lineup });
  });
  markers.innerHTML = [...positions.values()].map(({ x, y, lineup }) => {
    const size = isCatalog ? 10 : 7;
    const text = `${mode === 'start' ? 'Цель' : 'Старт'} · ${lineup.name}`;
    const active = lineup.id === selectedId;
    return `
      <g class="radar-marker${mode === 'start' ? ' result-target' : ''}" data-id="${safe(lineup.id)}" transform="translate(${x} ${y})"
         role="button" tabindex="${active ? '0' : '-1'}" aria-pressed="${active}" aria-label="${safe(text)}">
        <title>${safe(text)}</title>
        <circle r="${size + 7}" fill="transparent"></circle>
        <circle class="marker-focus" r="${size + 4}" fill="none"></circle>
        <circle class="marker-ring" r="${size}"></circle>
        <circle class="marker-dot" r="${isCatalog ? 3 : 2}"></circle>
      </g>`;
  }).join('');
}

function resultMeta(lineup) {
  const technique = techniques[lineup.technique]?.label ?? 'Техника в источнике';
  const about = `${lineup.from} · ${technique}`;
  if (!Number.isFinite(lineup.score) || lineup.score < 1) return about;
  const endpoint = mode === 'target' ? 'цели' : 'точки';
  return `${about} · ${Math.round(lineup.score)} ед. от ${endpoint}`;
}

function renderSelection() {
  const lineup = selectedLineup();
  list.querySelectorAll('button').forEach((button) => {
    if (button.dataset.id === selectedId) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  markers.querySelectorAll('.radar-marker').forEach((marker) => {
    const active = marker.dataset.id === selectedId;
    marker.setAttribute('aria-pressed', String(active));
    marker.setAttribute('tabindex', active ? '0' : '-1');
  });

  const landing = lineup && (lineup.landing ?? (lineup.type === 'smoke' ? null : noLandingZones[lineup.target]));
  selection.innerHTML = '';
  if (lineup?.position && landing) {
    const [x1, y1] = worldToRadar(lineup.position);
    const [x2, y2] = worldToRadar(landing);
    selection.innerHTML = `
      <path class="connection" marker-end="url(#flight-arrow)" d="M${x1} ${y1}L${x2} ${y2}"></path>
      <circle class="origin-point" cx="${x1}" cy="${y1}" r="8"></circle>
      <circle class="target-halo" cx="${x2}" cy="${y2}" r="19"></circle>
      <rect class="target-diamond" x="${x2 - 7}" y="${y2 - 7}" width="14" height="14" rx="1" transform="rotate(45 ${x2} ${y2})"></rect>`;
  }

  get('legend-note').textContent = lineup?.position && landing ? 'Пунктир показывает направление' : '';
  renderPin();
  detailPanel.hidden = !lineup;
  mapCommand.hidden = !lineup;
  if (!lineup) {
    detail.replaceChildren();
    return;
  }

  const command = practiceCommand(lineup);
  const technique = techniques[lineup.technique]?.label ?? 'Техника в источнике';
  const target = lineup.landing ? lineup.target : `${lineup.target} (зона)`;
  const direction = `${lineup.from} → ${target} · ${technique}`;
  const status = verificationLabels[verificationOf(lineup)];
  const source = `<a href="${safe(lineup.sourceUrl)}" target="_blank" rel="noopener noreferrer">${safe(lineup.sourceLabel)}</a>`;
  const checkedAt = lineup.verifiedAt ?? lineup.sourceCheckedAt;
  const sourceDate = checkedAt
    ? ` · <time datetime="${safe(checkedAt)}">${safe(checkedAt.split('-').reverse().join('.'))}</time>`
    : '';
  const build = lineup.verification === 'in-game' && lineup.gameBuild ? ` · сборка ${safe(lineup.gameBuild)}` : '';
  const copyIcon = icon('<rect x="8" y="7" width="11" height="13" rx="2"/><path d="M15 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>');
  const linkIcon = icon('<path d="m10 13 4-4m-6 1-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-6 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>');
  detail.innerHTML = `
    <div class="shot-head">${grenadeIcon(lineup.type)}<div>
      <h3 class="detail-title">${safe(lineup.name)}</h3>
      <p class="detail-from">${safe(direction)}</p>
    </div></div>
    <p class="instructions">${safe(lineup.instructions)}</p>
    ${lineup.aimCue ? `<p class="instructions"><strong>Ориентир</strong> ${safe(lineup.aimCue)}</p>` : ''}
    ${lineup.difficulty ? `<p class="instructions">${safe(difficultyLabels[lineup.difficulty])}${lineup.side ? ` · ${safe(lineup.side)}` : ''}</p>` : ''}
    ${command ? `<label class="sr-only" for="command">Команда для консоли CS2</label>
      <textarea class="command" id="command" readonly spellcheck="false" rows="3">${safe(command)}</textarea>`
      : '<p class="instructions">Для этой раскидки пока нет точных данных для команды.</p>'}
    <div class="shot-actions">
      ${command ? `<button class="action" type="button" data-action="copy-command">${copyIcon} Копировать команду</button>` : ''}
      <button class="action secondary" type="button" data-action="copy-link" aria-label="Ссылка на раскид">${linkIcon} Ссылка</button>
    </div>
    ${lineup.position || lineup.landing || lineup.angles || lineup.flightTime !== undefined ? `<details class="shot-data">
      <summary>Координаты и углы</summary>
      <dl class="data-list">
        ${lineup.position ? `<div><dt>Старт X / Y / Z</dt><dd class="coordinates">${safe(displayVector(lineup.position))}</dd></div>` : ''}
        ${lineup.landing ? `<div><dt>Раскрытие X / Y / Z</dt><dd class="coordinates">${safe(displayVector(lineup.landing))}</dd></div>` : ''}
        ${lineup.angles ? `<div><dt>Углы pitch / yaw</dt><dd class="coordinates">${safe(displayVector(lineup.angles.slice(0, 2)))}</dd></div>` : ''}
        ${lineup.flightTime === undefined ? '' : `<div><dt>Полёт</dt><dd>${safe(formatFlightTime(lineup.flightTime))}</dd></div>`}
      </dl>
    </details>` : ''}
    <p class="shot-source">${safe(status)} · ${source}${sourceDate}${build}</p>
  `;
}

function displayVector(values) {
  return values.map((value) => value.toFixed(2)).join(' / ');
}

function formatFlightTime(time) {
  return time === undefined ? 'Нет замера' : `${time.toLocaleString('ru')} с`;
}

function lineupUrl(lineupId) {
  const url = new URL(location.href);
  if (mode === 'catalog') {
    url.hash = lineupId || 'catalog';
    return url;
  }
  const params = new URLSearchParams({ mode });
  if (point) {
    params.set('x', point[0]);
    params.set('y', point[1]);
  }
  if (lineupId) params.set('shot', lineupId);
  if (teamFilter.value) params.set('side', teamFilter.value);
  if (height !== null) params.set('z', height);
  if (mode === 'target') params.set('radius', rangeControl.value);
  if (throwControl.value) params.set('throw', throwControl.value);
  url.hash = params.toString();
  return url;
}

function readLink() {
  const fragment = location.hash.slice(1);
  const params = new URLSearchParams(fragment);
  const routeMode = params.get('mode');
  selectedId = '';
  point = null;
  height = null;
  teamFilter.value = '';
  throwControl.value = '';
  rangeControl.value = '112';

  const oldShot = /^(mirage|sim)-[a-z0-9-]+$/i.test(fragment) && !byId.has(fragment);
  if (fragment === 'catalog' || byId.has(fragment) || oldShot) {
    difficultyFilter.value = '';
    verificationFilter.value = '';
    query.value = '';
    typeFilter.value = byId.get(fragment)?.type ?? 'smoke';
    techniqueFilter.value = '';
    selectedId = byId.has(fragment) ? fragment : '';
    changeMode('catalog', oldShot);
    if (oldShot) notify('Эта раскидка сейчас недоступна.');
    return;
  }

  if (routeMode === 'start' || routeMode === 'target') {
    const x = Number(params.get('x'));
    const y = Number(params.get('y'));
    if (params.has('x') && params.has('y') && onMap([x, y])) point = [x, y];
    if (params.has('z') && Number.isFinite(Number(params.get('z')))) height = Number(params.get('z'));
    const team = params.get('side');
    if (team === 'T' || team === 'CT') teamFilter.value = team;
    const radius = params.get('radius');
    if (['64', '112', '180'].includes(radius)) rangeControl.value = radius;
    const kind = params.get('throw');
    if (Object.hasOwn(techniques, kind)) throwControl.value = kind;
    const linkedShot = params.get('shot');
    selectedId = byId.has(linkedShot) ? linkedShot : '';
    changeMode(routeMode, Boolean(linkedShot && !selectedId));
    if (linkedShot && !byId.has(linkedShot)) notify('Эта раскидка сейчас недоступна.');
    return;
  }
  changeMode('catalog');
}

function onMap(position) {
  const [x, y] = worldToRadar(position);
  return x >= radarBounds.x && x <= radarBounds.x + radarBounds.width
    && y >= radarBounds.y && y <= radarBounds.y + radarBounds.height;
}

function renderPin() {
  const layer = get('radar-query');
  if (!point || mode === 'catalog') {
    layer.innerHTML = '';
    return;
  }
  const [x, y] = worldToRadar(point);
  const radius = (mode === 'target' ? Number(rangeControl.value) : START_SNAP_RADIUS) / MIRAGE_RADAR.unitsPerPixel;
  const icon = mode === 'target' ? 'M-7 0H7M0-7V7' : 'M0 -6 6 0 0 6 -6 0Z';
  layer.innerHTML = `<g class="query-pin" transform="translate(${x} ${y})">
    <circle class="query-range" r="${radius}"></circle>
    <circle class="query-circle" r="10"></circle>
    <path class="query-cross" d="${icon}"></path>
  </g>`;
  if (mode === 'start' && pointResults?.nearest && pointResults.nearestDistance >= 8) {
    const [nx, ny] = worldToRadar(pointResults.nearest);
    layer.innerHTML += `<path class="query-snap" d="M${x} ${y}L${nx} ${ny}"></path>
      <circle class="query-snapped" cx="${nx}" cy="${ny}" r="6"></circle>`;
  }
}

function renderMode() {
  const isCatalog = mode === 'catalog';
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  const named = mode === 'target' ? nearbyTarget(point) : null;
  get('map-instruction').textContent = named ? `Цель на карте — ${named.label}` : modes[mode].instruction;
  quickTargets.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.target === named?.id));
  });
  get('catalog-title').textContent = named ? `Смоки · ${named.label}` : modes[mode].title;
  get('catalog-controls').hidden = !isCatalog;
  get('point-controls').hidden = isCatalog;
  get('point-info').hidden = !point;
  get('target-range-control').hidden = mode !== 'target';
  get('point-results-controls').hidden = !point;
  get('floor-control').hidden = !pointResults || (pointResults.heights.length < 2 && height === null);
  radar.classList.toggle('clickable-radar', !isCatalog);
  if (isCatalog) return;

  let hint = '';
  if (mode === 'start' && pointResults?.nearest) {
    const [x, y, z] = pointResults.nearest.map(Math.round);
    hint = `Ближайший проверенный старт ${x} / ${y} / ${z} · ${Math.round(pointResults.nearestDistance)} ед. от точки`;
  }
  get('point-hint').textContent = hint;
  get('point-hint').hidden = !hint;
  if (point) get('point-coordinates').textContent = `${mode === 'start' ? 'Старт' : 'Цель'} ${point[0]} / ${point[1]}`;

  const allHeights = new Set(pointResults?.heights ?? []);
  if (height !== null) allHeights.add(height);
  heightControl.innerHTML = '<option value="">Выбрать уровень</option>'
    + [...allHeights].map((entry) => `<option value="${entry}">Около Z ${entry}</option>`).join('');
  heightControl.value = height === null ? '' : String(height);
}

function updatePointSearch({ updateAddress = false } = {}) {
  const options = {
    mode, point, height,
    team: teamFilter.value,
    radius: Number(rangeControl.value),
    technique: throwControl.value,
  };
  pointResults = point ? queryVerifiedSmokes(publicLineups, options) : null;
  visible = pointResults?.matches ?? [];
  renderMode();
  renderResults();
  if (updateAddress) history.replaceState(null, '', lineupUrl(''));
}

function changeMode(nextMode, updateAddress = false) {
  mode = nextMode;
  if (mode === 'catalog') {
    renderMode();
    updateCatalog();
    if (updateAddress) history.replaceState(null, '', lineupUrl(''));
    return;
  }
  updatePointSearch({ updateAddress });
}

function selectLineup(lineupId, updateAddress = false) {
  const index = visible.findIndex((lineup) => lineup.id === lineupId);
  if (index < 0) return;
  if (selectedId !== lineupId) {
    selectedId = lineupId;
    const page = Math.floor(index / pageSize);
    if (resultPage !== page) {
      resultPage = page;
      renderResultPage();
    }
    if (!markers.querySelector(`[data-id="${CSS.escape(lineupId)}"]`)) renderMarkers(mode === 'catalog');
    renderSelection();
  }
  if (updateAddress) history.replaceState(null, '', lineupUrl(selectedId));
}

function mapFocus() {
  const lineup = selectedLineup();
  if (point && mode !== 'catalog') return worldToRadar(point);
  if (lineup?.position) return worldToRadar(lineup.position);
  return undefined;
}

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 3600);
}

async function copyText(text, success, field) {
  try {
    await navigator.clipboard.writeText(text);
    notify(success);
  } catch {
    if (field) {
      field.focus();
      field.select();
      notify('Команда выделена. Нажми Ctrl+C или «Копировать».');
      return;
    }
    window.prompt('Скопируй ссылку на раскидку', text);
  }
}

query.addEventListener('input', updateCatalog);
[typeFilter, techniqueFilter, difficultyFilter, verificationFilter, sortOrder].forEach((control) => control.addEventListener('change', updateCatalog));
get('reset-filters').addEventListener('click', () => {
  query.value = '';
  typeFilter.value = 'smoke';
  techniqueFilter.value = '';
  teamFilter.value = '';
  difficultyFilter.value = '';
  verificationFilter.value = '';
  sortOrder.value = 'recommended';
  updateCatalog();
  query.focus();
});

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    const nextMode = button.dataset.mode;
    if (nextMode !== mode) {
      selectedId = '';
      height = null;
      changeMode(nextMode, true);
    }
    if (compactLayout.matches) {
      const panel = nextMode === 'catalog' ? list.closest('.catalog') : radar.closest('.map-panel');
      panel.scrollIntoView({ block: 'start' });
    }
  });
});

teamFilter.addEventListener('change', () => {
  if (mode === 'catalog') updateCatalog();
  else updatePointSearch({ updateAddress: true });
});
rangeControl.addEventListener('change', () => updatePointSearch({ updateAddress: true }));
throwControl.addEventListener('change', () => updatePointSearch({ updateAddress: true }));
heightControl.addEventListener('change', () => {
  height = heightControl.value === '' ? null : Number(heightControl.value);
  updatePointSearch({ updateAddress: true });
});
get('clear-point').addEventListener('click', () => {
  point = null;
  height = null;
  updatePointSearch({ updateAddress: true });
});

radar.addEventListener('click', (event) => {
  if (mode === 'catalog' || event.target.closest('[data-id]')) return;
  const pixels = mapViewport.screenToRadar(event.clientX, event.clientY);
  if (pixels) selectPoint(radarToWorld(pixels).map(Math.round));
});

quickTargets.addEventListener('click', (event) => {
  const id = event.target.closest('[data-target]')?.dataset.target;
  const target = mirageTargets.find((entry) => entry.id === id);
  if (!target) return;
  mode = 'target';
  selectPoint(target.point);
});

function selectPoint(picked) {
  if (!onMap(picked)) {
    notify('Эта точка за пределами схемы Mirage.');
    return;
  }
  point = picked;
  selectedId = '';
  height = null;
  get('manual-x').value = picked[0];
  get('manual-y').value = picked[1];
  updatePointSearch({ updateAddress: true });
}

get('point-form').addEventListener('submit', (event) => {
  event.preventDefault();
  selectPoint([get('manual-x').valueAsNumber, get('manual-y').valueAsNumber]);
});

list.addEventListener('click', (event) => {
  const item = event.target.closest('[data-id]');
  if (item) selectLineup(item.dataset.id, true);
});
markers.addEventListener('click', (event) => {
  const marker = event.target.closest('[data-id]');
  if (marker) selectLineup(marker.dataset.id, true);
});
markers.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const marker = event.target.closest('[data-id]');
  if (!marker) return;
  event.preventDefault();
  selectLineup(marker.dataset.id, true);
});

get('zoom-in').addEventListener('click', () => mapViewport.zoomIn());
get('zoom-out').addEventListener('click', () => mapViewport.zoomOut());
get('zoom-reset').addEventListener('click', () => mapViewport.reset());
get('center-map').addEventListener('click', () => {
  mapViewport.center(mapFocus());
  get('center-map').closest('details').open = false;
});
get('overview-file').addEventListener('change', async (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    await mapViewport.setOverview(file);
    get('restore-overview').hidden = false;
    notify('Радар загружен');
  } catch {
    notify('Выбери обзор Mirage 1024 × 1024 в PNG, JPEG или WebP.');
  }
  get('overview-file').value = '';
});
get('restore-overview').addEventListener('click', () => {
  mapViewport.resetOverview();
  get('restore-overview').hidden = true;
});
get('previous-results').addEventListener('click', () => {
  resultPage -= 1;
  renderResultPage();
});
get('next-results').addEventListener('click', () => {
  resultPage += 1;
  renderResultPage();
});
get('open-help').addEventListener('click', () => get('help-dialog').showModal());
mapCommand.addEventListener('click', () => {
  detail.focus({ preventScroll: true });
  detail.scrollIntoView({ block: 'start' });
});

detail.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const lineup = selectedLineup();
  if (!lineup || !action) return;
  if (action === 'copy-command') {
    const command = practiceCommand(lineup);
    if (command) copyText(command, 'Команда скопирована', get('command'));
  } else {
    copyText(lineupUrl(lineup.id).href, 'Ссылка скопирована');
  }
});
window.addEventListener('hashchange', readLink);

readLink();
