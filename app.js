import { lineups } from './lineups.js';
import { loadFlightPath, loadSmokeAtlas, querySmoke, sideAt, strengthLabel } from './smoke-search.js';

const grenadeTypes = {
  smoke: { label: 'Дым', item: 'weapon_smokegrenade', icon: '<path d="M8 9h8v11H8zM10 9V6h4v3m-2-3V4h5m-8 9h6m-6 3h6"/>' },
  flash: { label: 'Флешка', item: 'weapon_flashbang', icon: '<path d="m13.5 3-7 10H11l-.5 8 7-11H13z"/>' },
  molotov: { label: 'Молотов', item: 'weapon_molotov', icon: '<path d="M12 3c1 4-3 5-3 8-1-1-1.5-2-1.5-3C5.5 10 5 12 5 14a7 7 0 0 0 14 0c0-2.5-1-4.5-2.5-6 .1 2-1 3.5-2 4C15 8 14 5 12 3Z"/>' },
  he: { label: 'Осколочная', item: 'weapon_hegrenade', icon: '<path d="M9 9h6l3 4v5l-3 2H9l-3-2v-5zm1 0V6h4v3M12 6V4h5M6 15h12m-6-6v11"/>' },
};

const techniques = {
  stand: { label: 'С места', order: 0 },
  jump: { label: 'В прыжке', order: 1 },
  step: { label: 'С шагом / разбегом', order: 2 },
};

const startBox = { x: 83, y: 111, width: 900, height: 790 };
const zoomLevels = [1, 1.25, 1.6, 2];
const noLandingZones = {
  Window: [-1077, -633],
  CT: [-881, -2456],
  Ninja: [-360, -2370],
};

const byId = new Map(lineups.map((lineup) => [lineup.id, lineup]));
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
const toast = get('toast');
const teamFilter = get('team-filter');
const rangeControl = get('target-range');
const heightControl = get('point-height');
const throwControl = get('point-throw');
const modes = {
  start: { title: 'Куда долетит смок', hint: 'Кликни по позиции, с которой хочешь кинуть.' },
  target: { title: 'Откуда кинуть смок', hint: 'Кликни по месту, куда должен долететь смок.' },
  catalog: { title: 'Раскидки' },
};

let visible = [];
let selectedId = '';
let zoomIndex = 0;
let toastTimer;
let mode = 'start';
let point = null;
let height = null;
let pointPhase = 'idle';
let pointResults = null;
let requestVersion = 0;

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
  const searchTerms = query.value.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
  visible = lineups.filter((lineup) => {
    const terms = [lineup.name, lineup.from, lineup.target, grenadeTypes[lineup.type].label, techniques[lineup.technique].label]
      .join(' ').toLocaleLowerCase('ru');
    return (!teamFilter.value || sideAt(lineup.position) === teamFilter.value)
      && (!typeFilter.value || lineup.type === typeFilter.value)
      && (!techniqueFilter.value || lineup.technique === techniqueFilter.value)
      && searchTerms.every((word) => terms.includes(word));
  });

  const byEase = (left, right) => techniques[left.technique].order - techniques[right.technique].order;
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

function selectedLineup() {
  return visible.find((lineup) => lineup.id === selectedId);
}

function renderResults() {
  const isCatalog = mode === 'catalog';
  if (!visible.some((lineup) => lineup.id === selectedId)) selectedId = visible[0]?.id ?? '';
  get('result-count').textContent = String(visible.length);
  get('result-count').hidden = !isCatalog && pointPhase !== 'ready';
  get('list-empty').hidden = visible.length > 0 || (!isCatalog && pointPhase !== 'ready');
  get('reset-filters').hidden = !isCatalog;
  get('empty-message').textContent = isCatalog
    ? 'Таких раскидок пока нет.'
    : 'В расчёте нет совпадений. Попробуй соседнюю точку, другую сторону или больший допуск.';
  list.innerHTML = visible.map((lineup) => `
    <li>
      <button type="button" class="lineup-row" data-id="${safe(lineup.id)}">
        ${grenadeIcon(lineup.type)}
        <span class="row-content">
          <span class="row-title">${safe(lineup.name)}</span>
          <span class="row-meta">${safe(lineup.simulated ? resultMeta(lineup) : `${lineup.from} · ${techniques[lineup.technique].label}`)}</span>
        </span>
        <span class="row-arrow" aria-hidden="true">›</span>
      </button>
    </li>
  `).join('');
  markers.innerHTML = visible.map((lineup) => {
    const [x, y] = toRadar(mode === 'start' ? lineup.landing : lineup.position);
    const markerSize = isCatalog ? 12 : 7;
    return `
      <g class="radar-marker${mode === 'start' ? ' result-target' : ''}" data-id="${safe(lineup.id)}" transform="translate(${x} ${y})"
         role="button" tabindex="0" aria-label="${safe(`${lineup.name}, ${lineup.from}`)}">
        <title>${safe(`${lineup.name}, ${lineup.from}`)}</title>
        <circle r="${markerSize + 7}" fill="transparent"></circle>
        <circle class="marker-focus" r="${markerSize + 4}" fill="none"></circle>
        <circle class="marker-ring" r="${markerSize}"></circle>
        <circle class="marker-dot" r="${isCatalog ? 3.4 : 2}"></circle>
      </g>`;
  }).join('');

  renderSelection();
}

function resultMeta(lineup) {
  const distance = mode === 'target' ? ` · ${Math.round(lineup.score)} ед. от цели` : '';
  return `${lineup.team} · ${techniques[lineup.technique].label} · ${strengthLabel(lineup.strength)}${distance}`;
}

function toRadar([x, y]) {
  return [(x + 3230) / 5, (1713 - y) / 5];
}

function renderSelection() {
  const lineup = selectedLineup();
  list.querySelectorAll('button').forEach((button) => {
    if (button.dataset.id === selectedId) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  markers.querySelectorAll('.radar-marker').forEach((marker) => {
    marker.setAttribute('aria-pressed', String(marker.dataset.id === selectedId));
  });

  const landing = lineup && (lineup.landing ?? noLandingZones[lineup.target]);
  selection.innerHTML = '';
  if (lineup && landing) {
    const [x1, y1] = toRadar(lineup.position);
    const [x2, y2] = toRadar(landing);
    selection.innerHTML = `
      <path class="connection" d="M${x1} ${y1}L${x2} ${y2}"></path>
      <circle class="target-halo" cx="${x2}" cy="${y2}" r="19"></circle>
      <rect class="target-diamond" x="${x2 - 7}" y="${y2 - 7}" width="14" height="14" rx="1" transform="rotate(45 ${x2} ${y2})"></rect>`;
  }

  if (lineup?.simulated) {
    const pathElement = selection.querySelector('.connection');
    get('legend-note').textContent = 'Линия соединяет старт и остановку смока';
    loadFlightPath(lineup).then((path) => {
      if (!pathElement?.isConnected || path.length < 2) return;
      pathElement.setAttribute('d', path.map((point, index) => {
        const [x, y] = toRadar(point);
        return `${index ? 'L' : 'M'}${x} ${y}`;
      }).join(' '));
      pathElement.classList.add('sim-flight');
      get('legend-note').textContent = 'Линия — расчётная траектория смока';
    }).catch(() => {
      // Keep the schematic connector if the separate trajectory file is unavailable.
    });
  }

  renderPin();
  updateZoom();
  if (!lineup) {
    detail.innerHTML = mode === 'catalog'
      ? '<p class="detail-empty">Измени фильтры и выбери раскид из списка.</p>'
      : '<p class="detail-empty">Здесь появятся координаты, прицел и команда для тренировки, когда выберешь бросок.</p>';
    return;
  }

  const time = formatFlightTime(lineup.flightTime);
  const target = lineup.landing ? lineup.target : `${lineup.target} (зона)`;
  detail.innerHTML = `
    <div class="detail-type">${grenadeIcon(lineup.type)} ${safe(grenadeTypes[lineup.type].label)}</div>
    <h3 class="detail-title">${safe(lineup.name)}</h3>
    <p class="detail-from">${safe(lineup.from)} → ${safe(target)}</p>
    <div class="shot-tags"><p class="technique">${safe(techniques[lineup.technique].label)}</p>${lineup.simulated
      ? `<p class="technique">${safe(lineup.team)}</p><p class="technique model-tag">Расчёт</p>` : ''}</div>
    <p class="instructions">${safe(lineup.instructions)}</p>
    <dl class="data-list">
      <div><dt>Старт X / Y / Z</dt><dd class="coordinates">${safe(displayVector(lineup.position))}</dd></div>
      <div><dt>Углы pitch / yaw</dt><dd class="coordinates">${safe(displayVector(lineup.angles.slice(0, 2)))}</dd></div>
      <div><dt>Время полёта</dt><dd>${time}</dd></div>
      ${lineup.simulated ? `<div><dt>Отскоки</dt><dd>${safe(lineup.bounces)}</dd></div>` : ''}
    </dl>
    <label class="sr-only" for="command">Команда для консоли CS2</label>
    <textarea class="command" id="command" readonly spellcheck="false" rows="3">${safe(practiceCommand(lineup))}</textarea>
    <button class="action" type="button" data-action="copy-command">${icon('<rect x="8" y="7" width="11" height="13" rx="2"/><path d="M15 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>')} Скопировать команду</button>
    <button class="action secondary" type="button" data-action="copy-link">${icon('<path d="m10 13 4-4m-6 1-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-6 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>')} Ссылка на раскид</button>
    ${lineup.simulated ? '<p class="simulation-note">Точка остановки смока рассчитана по геометрии Mirage. Проверь бросок в тренировке.</p>' : ''}
    <a class="source" href="${safe(lineup.sourceUrl)}" target="_blank" rel="noopener noreferrer">${lineup.simulated ? 'Модель' : 'Источник'} · ${safe(lineup.sourceLabel)}</a>
  `;
}

function displayVector(values) {
  return values.map((value) => value.toFixed(2)).join(' / ');
}

function formatFlightTime(time) {
  return time === undefined ? 'Нет замера' : `${time.toLocaleString('ru')} с`;
}

function practiceCommand(lineup) {
  const item = grenadeTypes[lineup.type].item;
  return `sv_cheats 1; setpos_exact ${lineup.position.join(' ')}; setang_exact ${lineup.angles.join(' ')}; give ${item}`;
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

  if (fragment === 'catalog' || byId.has(fragment)) {
    query.value = '';
    typeFilter.value = '';
    techniqueFilter.value = '';
    selectedId = byId.has(fragment) ? fragment : '';
    changeMode('catalog');
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
    selectedId = params.get('shot') ?? '';
    changeMode(routeMode);
    return;
  }
  changeMode('start');
}

function onMap(position) {
  const [x, y] = toRadar(position);
  return x >= startBox.x && x <= startBox.x + startBox.width
    && y >= startBox.y && y <= startBox.y + startBox.height;
}

function renderPin() {
  const layer = get('radar-query');
  if (!point || mode === 'catalog') {
    layer.innerHTML = '';
    return;
  }
  const [x, y] = toRadar(point);
  const radius = mode === 'target' ? Number(rangeControl.value) / 5 : 17;
  const icon = mode === 'target' ? 'M-7 0H7M0-7V7' : 'M0 -6 6 0 0 6 -6 0Z';
  layer.innerHTML = `<g class="query-pin" transform="translate(${x} ${y})">
    <circle class="query-range" r="${radius}"></circle>
    <circle class="query-circle" r="10"></circle>
    <path class="query-cross" d="${icon}"></path>
  </g>`;
  if (mode === 'start' && pointResults?.nearest && pointResults.nearestDistance >= 8) {
    const [nx, ny] = toRadar(pointResults.nearest);
    layer.innerHTML += `<path class="query-snap" d="M${x} ${y}L${nx} ${ny}"></path>
      <circle class="query-snapped" cx="${nx}" cy="${ny}" r="6"></circle>`;
  }
}

function renderMode() {
  const isCatalog = mode === 'catalog';
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  get('catalog-title').textContent = modes[mode].title;
  get('catalog-controls').hidden = !isCatalog;
  get('point-controls').hidden = isCatalog;
  get('point-info').hidden = !point;
  get('target-range-control').hidden = mode !== 'target';
  get('point-results-controls').hidden = pointPhase !== 'ready';
  get('floor-control').hidden = !pointResults || pointResults.heights.length < 2;
  get('legend-note').textContent = isCatalog ? 'Линия связывает точки на схеме' : 'Синий круг — выбранная точка';
  radar.classList.toggle('clickable-radar', !isCatalog);
  if (isCatalog) return;

  let hint = modes[mode].hint;
  if (pointPhase === 'loading') hint = 'Загружаю расчёты Mirage…';
  if (pointPhase === 'error') hint = 'Расчёты не загрузились. Кликни по карте, чтобы повторить.';
  if (pointPhase === 'ready' && mode === 'start' && !pointResults.nearest) {
    hint = 'Рядом нет рассчитанного старта для этой стороны.';
  } else if (pointPhase === 'ready') {
    if (mode === 'start') {
      const [x, y, z] = pointResults.nearest.map(Math.round);
      hint = `Старт расчёта ${x} / ${y} / ${z}. До выбранной точки ${Math.round(pointResults.nearestDistance)} ед.`;
    } else {
      hint = `Показываю старты, откуда смок останавливается в пределах ${rangeControl.value} ед. от цели.`;
    }
  }
  get('point-hint').textContent = hint;
  if (point) get('point-coordinates').textContent = `${mode === 'start' ? 'Старт' : 'Цель'} ${point[0]} / ${point[1]}`;

  const allHeights = [...(pointResults?.heights ?? [])];
  const defaultHeight = mode === 'start' ? 'Ближайшая' : 'Любая';
  heightControl.innerHTML = `<option value="">${defaultHeight}</option>`
    + allHeights.map((entry) => `<option value="${entry}">Около Z ${entry}</option>`).join('');
  heightControl.value = allHeights.includes(height) ? String(height) : '';
}

async function updatePointSearch({ updateAddress = false } = {}) {
  const version = ++requestVersion;
  pointResults = null;
  pointPhase = point ? 'loading' : 'idle';
  visible = [];
  renderMode();
  if (!point) {
    renderResults();
    if (updateAddress) history.replaceState(null, '', lineupUrl(''));
    return;
  }
  // Keep a linked selection while the index loads.
  const linkedShot = selectedId;
  renderResults();
  selectedId = linkedShot;
  if (updateAddress) history.replaceState(null, '', lineupUrl(''));
  try {
    const atlas = await loadSmokeAtlas();
    if (version !== requestVersion) return;
    pointResults = querySmoke(atlas, {
      mode, point, height,
      team: teamFilter.value,
      radius: Number(rangeControl.value),
      technique: throwControl.value,
    });
    visible = pointResults.matches;
    pointPhase = 'ready';
  } catch {
    if (version !== requestVersion) return;
    pointPhase = 'error';
  }
  renderMode();
  renderResults();
}

function changeMode(nextMode, updateAddress = false) {
  mode = nextMode;
  requestVersion += 1;
  if (mode === 'catalog') {
    renderMode();
    updateCatalog();
    if (updateAddress) history.replaceState(null, '', lineupUrl(''));
    return;
  }
  updatePointSearch({ updateAddress });
}

function selectLineup(lineupId, updateAddress = false) {
  if (!visible.some((lineup) => lineup.id === lineupId)) return;
  if (selectedId !== lineupId) {
    selectedId = lineupId;
    renderSelection();
  }
  if (updateAddress) history.replaceState(null, '', lineupUrl(selectedId));
}

function updateZoom() {
  const scale = zoomLevels[zoomIndex];
  const width = startBox.width / scale;
  const height = startBox.height / scale;
  const lineup = selectedLineup();
  const origin = lineup && toRadar(lineup.position);
  const target = lineup && (lineup.landing ?? noLandingZones[lineup.target]);
  const end = target ? toRadar(target) : origin;
  const center = mode !== 'catalog' && point ? toRadar(point)
    : origin ? [(origin[0] + end[0]) / 2, (origin[1] + end[1]) / 2]
      : [startBox.x + startBox.width / 2, startBox.y + startBox.height / 2];
  const [centerX, centerY] = center;
  const x = Math.max(startBox.x, Math.min(centerX - width / 2, startBox.x + startBox.width - width));
  const y = Math.max(startBox.y, Math.min(centerY - height / 2, startBox.y + startBox.height - height));
  radar.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  get('zoom-out').disabled = zoomIndex === 0;
  get('zoom-in').disabled = zoomIndex === zoomLevels.length - 1;
  get('zoom-reset').disabled = zoomIndex === 0;
  get('zoom-reset').textContent = `${String(scale).replace('.', ',')}×`;
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
[typeFilter, techniqueFilter, sortOrder].forEach((control) => control.addEventListener('change', updateCatalog));
get('reset-filters').addEventListener('click', () => {
  query.value = '';
  typeFilter.value = '';
  techniqueFilter.value = '';
  teamFilter.value = '';
  updateCatalog();
  query.focus();
});

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.mode === mode) return;
    selectedId = '';
    height = null;
    changeMode(button.dataset.mode, true);
  });
});

teamFilter.addEventListener('change', () => {
  if (mode === 'catalog') updateCatalog();
  else {
    height = null;
    updatePointSearch({ updateAddress: true });
  }
});
rangeControl.addEventListener('change', () => {
  height = null;
  updatePointSearch({ updateAddress: true });
});
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
  const screenMatrix = radar.getScreenCTM();
  if (!screenMatrix) return;
  const pixels = new DOMPoint(event.clientX, event.clientY).matrixTransform(screenMatrix.inverse());
  const picked = [Math.round(pixels.x * 5 - 3230), Math.round(1713 - pixels.y * 5)];
  selectPoint(picked);
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

get('zoom-in').addEventListener('click', () => { zoomIndex += 1; updateZoom(); });
get('zoom-out').addEventListener('click', () => { zoomIndex -= 1; updateZoom(); });
get('zoom-reset').addEventListener('click', () => { zoomIndex = 0; updateZoom(); });
get('open-help').addEventListener('click', () => get('help-dialog').showModal());

detail.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const lineup = selectedLineup();
  if (!lineup || !action) return;
  if (action === 'copy-command') {
    copyText(practiceCommand(lineup), 'Команда скопирована', get('command'));
  } else {
    copyText(lineupUrl(lineup.id).href, 'Ссылка скопирована');
  }
});
window.addEventListener('hashchange', readLink);

readLink();
