
export const MIRAGE_RADAR = Object.freeze({
  originX: -3230,
  originY: 1713,
  unitsPerPixel: 5,
  width: 1024,
  height: 1024,
});

const INITIAL_BOX = Object.freeze({ x: 83, y: 111, width: 900, height: 790 });
const IMAGE_BOX = Object.freeze({ x: 0, y: 0, width: MIRAGE_RADAR.width, height: MIRAGE_RADAR.height });
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const STEP = 1.25;
const DRAG_DISTANCE = 5;
const CLICK_TIMEOUT = 450;
const EPSILON = 1e-7;

export function worldToRadar([x, y], overview = MIRAGE_RADAR) {
  return [
    (x - overview.originX) / overview.unitsPerPixel,
    (overview.originY - y) / overview.unitsPerPixel,
  ];
}

export function radarToWorld([x, y], overview = MIRAGE_RADAR) {
  return [
    overview.originX + x * overview.unitsPerPixel,
    overview.originY - y * overview.unitsPerPixel,
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function centerOf({ x, y, width, height }) {
  return [x + width / 2, y + height / 2];
}

function midpoint([ax, ay], [bx, by]) {
  return [(ax + bx) / 2, (ay + by) / 2];
}

function distance([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by);
}

function sameFrame(a, b) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
    && Math.abs(a.width - b.width) < EPSILON && Math.abs(a.height - b.height) < EPSILON;
}

export function createMapViewport(svg, {
  initialBox = INITIAL_BOX,
  bounds = IMAGE_BOX,
  overviewImage,
  onChange = () => {},
} = {}) {
  let frame = { ...initialBox };
  let scale = MIN_SCALE;
  let suppressUntil = 0;
  let pinchFrame = null;
  const pointers = new Map();
  const movedPointers = new Map();
  const defaultImage = overviewImage?.getAttribute('href');
  let overviewUrl;
  let overviewRevision = 0;
  const originalTouchAction = svg.style.touchAction;
  svg.style.touchAction = 'none';

  function draw() {
    const { x, y, width, height } = frame;
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    onChange({
      scale,
      canZoomIn: scale < MAX_SCALE - EPSILON,
      canZoomOut: scale > MIN_SCALE + EPSILON,
      canReset: !sameFrame(frame, initialBox),
    });
  }

  function move(x, y, nextScale) {
    const width = initialBox.width / nextScale;
    const height = initialBox.height / nextScale;
    const next = {
      x: clamp(x, bounds.x, bounds.x + bounds.width - width),
      y: clamp(y, bounds.y, bounds.y + bounds.height - height),
      width,
      height,
    };
    if (sameFrame(frame, next)) return;
    frame = next;
    scale = nextScale;
    draw();
  }

  function localPoint(clientX, clientY) {
    const screen = svg.getScreenCTM()?.inverse();
    if (!screen) return null;
    const x = screen.a * clientX + screen.c * clientY + screen.e;
    const y = screen.b * clientX + screen.d * clientY + screen.f;
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  function screenToRadar(clientX, clientY) {
    const point = localPoint(clientX, clientY);
    if (!point) return null;
    const [x, y] = point;
    if (x < frame.x - EPSILON || x > frame.x + frame.width + EPSILON
      || y < frame.y - EPSILON || y > frame.y + frame.height + EPSILON) return null;
    return point;
  }

  function transform(factor, from, to = from) {
    const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = scale / nextScale;
    move(from[0] - (to[0] - frame.x) * ratio, from[1] - (to[1] - frame.y) * ratio, nextScale);
  }

  function zoomIn(anchor = centerOf(frame)) {
    transform(STEP, anchor);
  }

  function zoomOut(anchor = centerOf(frame)) {
    transform(1 / STEP, anchor);
  }

  function center([x, y] = centerOf(initialBox)) {
    move(x - frame.width / 2, y - frame.height / 2, scale);
  }

  function reset() {
    move(initialBox.x, initialBox.y, MIN_SCALE);
  }

  function wheel(event) {
    const anchor = screenToRadar(event.clientX, event.clientY);
    if (!anchor || !event.deltaY) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16
      : event.deltaMode === 2 ? svg.getBoundingClientRect().height : 1;
    const delta = clamp(event.deltaY * unit, -320, 320);
    transform(Math.exp(-delta * 0.0018), anchor);
  }

  function zoomKey(event) {
    if (event.target !== svg) return;
    const delta = 54 / scale;
    switch (event.key) {
      case '+': case '=': zoomIn(); break;
      case '-': zoomOut(); break;
      case 'Home': reset(); break;
      case 'ArrowLeft': move(frame.x - delta, frame.y, scale); break;
      case 'ArrowRight': move(frame.x + delta, frame.y, scale); break;
      case 'ArrowUp': move(frame.x, frame.y - delta, scale); break;
      case 'ArrowDown': move(frame.x, frame.y + delta, scale); break;
      default: return;
    }
    event.preventDefault();
  }

  function readPinch() {
    const [first, second] = Array.from(pointers.values(), (pointer) => pointer.current);
    return { center: midpoint(first, second), distance: distance(first, second) };
  }

  function pointerDown(event) {
    if (event.button !== 0 || pointers.size >= 2 || !screenToRadar(event.clientX, event.clientY)) return;
    if (!pointers.size) movedPointers.clear();
    const current = [event.clientX, event.clientY];
    pointers.set(event.pointerId, { current, applied: current, moved: false });
    if (pointers.size === 2) {
      for (const pointer of pointers.values()) pointer.applied = pointer.current;
      pinchFrame = readPinch();
    }
  }

  function beginMovement() {
    for (const [id, pointer] of pointers) {
      if (pointer.moved) continue;
      pointer.moved = true;
      try {
        svg.setPointerCapture(id);
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    }
  }

  function pointerMove(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.current = [event.clientX, event.clientY];
    if (!pointer.moved && distance(pointer.applied, pointer.current) < DRAG_DISTANCE) return;
    beginMovement();
    if (pinchFrame) {
      const pinch = readPinch();
      const from = localPoint(...pinchFrame.center);
      const to = localPoint(...pinch.center);
      if (from && to) {
        const factor = Math.max(1, pinch.distance) / Math.max(1, pinchFrame.distance);
        transform(factor, from, to);
      }
      pinchFrame = pinch;
      return;
    }
    const from = localPoint(...pointer.applied);
    const to = localPoint(...pointer.current);
    if (from && to) transform(1, from, to);
    pointer.applied = pointer.current;
  }

  function pointerEnd(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointers.delete(event.pointerId);
    pinchFrame = null;
    if (!pointer.moved) return;
    suppressUntil = performance.now() + CLICK_TIMEOUT;
    movedPointers.set(event.pointerId, pointer.current);
    for (const remaining of pointers.values()) remaining.applied = remaining.current;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }

  function pointerLeave(event) {
    if (event.pointerType === 'mouse' && !svg.hasPointerCapture(event.pointerId)) pointerEnd(event);
  }

  function guardClick(event) {
    if (event.detail === 0 || performance.now() > suppressUntil || !movedPointers.size) return;
    const pointerId = event.pointerId;
    const moved = movedPointers.has(pointerId)
      || [...movedPointers.values()].some((point) => distance(point, [event.clientX, event.clientY]) < 12);
    if (!moved) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (movedPointers.has(pointerId)) movedPointers.delete(pointerId);
    else movedPointers.clear();
  }

  async function setOverview(file) {
    if (!overviewImage) return false;
    const revision = ++overviewRevision;
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('Выбери обзор Mirage в формате PNG, JPEG или WebP.');
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        if (revision !== overviewRevision) return false;
        throw new Error('Не удалось прочитать изображение радара.');
      }
      if (revision !== overviewRevision) return false;
      if (image.naturalWidth !== MIRAGE_RADAR.width || image.naturalHeight !== MIRAGE_RADAR.height) {
        throw new Error('Для точного совмещения нужен исходный обзор Mirage размером 1024 × 1024.');
      }
      overviewImage.setAttribute('href', url);
      if (overviewUrl) URL.revokeObjectURL(overviewUrl);
      overviewUrl = url;
      return true;
    } finally {
      if (overviewUrl !== url) URL.revokeObjectURL(url);
    }
  }

  function resetOverview() {
    overviewRevision += 1;
    if (!overviewUrl) return;
    if (defaultImage) overviewImage.setAttribute('href', defaultImage);
    else overviewImage.removeAttribute('href');
    URL.revokeObjectURL(overviewUrl);
    overviewUrl = undefined;
  }

  const handlers = [
    ['wheel', wheel, { passive: false }],
    ['keydown', zoomKey],
    ['pointerdown', pointerDown],
    ['pointermove', pointerMove],
    ['pointerup', pointerEnd],
    ['pointercancel', pointerEnd],
    ['lostpointercapture', pointerEnd],
    ['pointerleave', pointerLeave],
    ['click', guardClick, true],
  ];
  for (const args of handlers) svg.addEventListener(...args);
  draw();

  function destroy() {
    for (const args of handlers) svg.removeEventListener(...args);
    for (const id of pointers.keys()) {
      if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
    }
    pointers.clear();
    movedPointers.clear();
    svg.style.touchAction = originalTouchAction;
    resetOverview();
  }

  return { zoomIn, zoomOut, center, reset, screenToRadar, setOverview, resetOverview, destroy };
}
