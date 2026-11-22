import { lineups } from './lineups.js';

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

let visible = [];
let selectedId = '';
let zoomIndex = 0;
let toastTimer;

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
    return (!typeFilter.value || lineup.type === typeFilter.value)
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

  if (!visible.some((lineup) => lineup.id === selectedId)) {
    selectedId = visible[0]?.id ?? '';
  }

  const currentLink = location.hash.slice(1);
  if (byId.has(currentLink) && currentLink !== selectedId) {
    history.replaceState(null, '', lineupUrl(selectedId));
  }

  get('result-count').textContent = String(visible.length);
  get('list-empty').hidden = visible.length > 0;
  list.innerHTML = visible.map((lineup) => `
    <li>
      <button type="button" class="lineup-row" data-id="${safe(lineup.id)}">
        ${grenadeIcon(lineup.type)}
        <span class="row-content">
          <span class="row-title">${safe(lineup.name)}</span>
          <span class="row-meta">${safe(lineup.from)} · ${safe(techniques[lineup.technique].label)}</span>
        </span>
        <span class="row-arrow" aria-hidden="true">›</span>
      </button>
    </li>
  `).join('');
  markers.innerHTML = visible.map((lineup) => {
    const [x, y] = toRadar(lineup.position);
    return `
      <g class="radar-marker" data-id="${safe(lineup.id)}" transform="translate(${x} ${y})"
         role="button" tabindex="0" aria-label="${safe(`${lineup.name}, ${lineup.from}`)}">
        <title>${safe(`${lineup.name}, ${lineup.from}`)}</title>
        <circle r="22" fill="transparent"></circle>
        <circle class="marker-focus" r="17" fill="none"></circle>
        <circle class="marker-ring" r="12"></circle>
        <circle class="marker-dot" r="3.4"></circle>
      </g>`;
  }).join('');

  renderSelection();
}

function toRadar([x, y]) {
  return [(x + 3230) / 5, (1713 - y) / 5];
}

function renderSelection() {
  const lineup = byId.get(selectedId);
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

  updateZoom();
  if (!lineup) {
    detail.innerHTML = '<p class="detail-empty">Измени фильтры и выбери раскид из списка.</p>';
    return;
  }

  const time = formatFlightTime(lineup.flightTime);
  const target = lineup.landing ? lineup.target : `${lineup.target} (зона)`;
  detail.innerHTML = `
    <div class="detail-type">${grenadeIcon(lineup.type)} ${safe(grenadeTypes[lineup.type].label)}</div>
    <h3 class="detail-title">${safe(lineup.name)}</h3>
    <p class="detail-from">${safe(lineup.from)} → ${safe(target)}</p>
    <p class="technique">${safe(techniques[lineup.technique].label)}</p>
    <p class="instructions">${safe(lineup.instructions)}</p>
    <dl class="data-list">
      <div><dt>Старт X / Y / Z</dt><dd class="coordinates">${safe(displayVector(lineup.position))}</dd></div>
      <div><dt>Прицел: pitch / yaw</dt><dd class="coordinates">${safe(displayVector(lineup.angles.slice(0, 2)))}</dd></div>
      <div><dt>Время полёта</dt><dd>${time}</dd></div>
    </dl>
    <label class="sr-only" for="command">Команда для консоли CS2</label>
    <textarea class="command" id="command" readonly spellcheck="false" rows="3">${safe(practiceCommand(lineup))}</textarea>
    <button class="action" type="button" data-action="copy-command">${icon('<rect x="8" y="7" width="11" height="13" rx="2"/><path d="M15 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>')} Скопировать команду</button>
    <button class="action secondary" type="button" data-action="copy-link">${icon('<path d="m10 13 4-4m-6 1-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-6 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>')} Ссылка на раскид</button>
    <a class="source" href="${safe(lineup.sourceUrl)}" target="_blank" rel="noopener noreferrer">Источник · ${safe(lineup.sourceLabel)}</a>
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
  url.hash = lineupId;
  return url;
}

function readLink() {
  const lineupId = location.hash.slice(1);
  if (!byId.has(lineupId)) return;
  if (visible.some((lineup) => lineup.id === lineupId)) {
    selectLineup(lineupId);
    return;
  }
  query.value = '';
  typeFilter.value = '';
  techniqueFilter.value = '';
  selectedId = lineupId;
  updateCatalog();
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
  const lineup = byId.get(selectedId);
  const origin = lineup && toRadar(lineup.position);
  const target = lineup && (lineup.landing ?? noLandingZones[lineup.target]);
  const end = target ? toRadar(target) : origin;
  const centerX = origin ? (origin[0] + end[0]) / 2 : startBox.x + startBox.width / 2;
  const centerY = origin ? (origin[1] + end[1]) / 2 : startBox.y + startBox.height / 2;
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
  updateCatalog();
  query.focus();
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
  const lineup = byId.get(selectedId);
  if (!lineup || !action) return;
  if (action === 'copy-command') {
    copyText(practiceCommand(lineup), 'Команда скопирована', get('command'));
  } else {
    copyText(lineupUrl(lineup.id).href, 'Ссылка скопирована');
  }
});
window.addEventListener('hashchange', readLink);

const initialId = location.hash.slice(1);
if (byId.has(initialId)) selectedId = initialId;
updateCatalog();
