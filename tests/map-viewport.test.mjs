
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMapViewport, MIRAGE_RADAR, radarToWorld, worldToRadar,
} from '../map-viewport.js';

class Radar extends EventTarget {
  constructor({ width = 900, height = 790 } = {}) {
    super();
    this.rect = { left: 120, top: 40, width, height };
    this.style = {};
    this.captured = new Set();
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setAttribute(name, value) {
    assert.equal(name, 'viewBox');
    this.box = value.split(' ').map(Number);
  }

  getScreenCTM() {
    const [x, y, width, height] = this.box;
    const { left, top } = this.rect;
    const scale = Math.min(this.rect.width / width, this.rect.height / height);
    const offsetX = left + (this.rect.width - width * scale) / 2;
    const offsetY = top + (this.rect.height - height * scale) / 2;
    return {
      inverse: () => ({
        a: 1 / scale,
        b: 0,
        c: 0,
        d: 1 / scale,
        e: x - offsetX / scale,
        f: y - offsetY / scale,
      }),
    };
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
  }

  emit(type, fields = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    this.dispatchEvent(event);
    return event;
  }

  pointer(type, clientX, clientY, { pointerId = 1, pointerType = 'mouse' } = {}) {
    return this.emit(type, { pointerId, pointerType, button: 0, clientX, clientY, detail: 1 });
  }
}

function nearlyEqual(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7,
    `index ${index}: expected ${expected[index]}, received ${value}`));
}

test('Mirage overview uses the installed origin, pixel pitch, and north-up orientation', () => {
  assert.equal(MIRAGE_RADAR.width, 1024);
  assert.equal(MIRAGE_RADAR.height, 1024);
  assert.deepEqual(worldToRadar([-3230, 1713]), [0, 0]);
  assert.deepEqual(worldToRadar([1890, -3407]), [1024, 1024]);
  const officialStart = [1422.953491, -55.96875];
  nearlyEqual(worldToRadar(officialStart), [930.5906982, 353.79375]);
  nearlyEqual(radarToWorld(worldToRadar(officialStart)), officialStart);
});

test('wheel zoom holds the radar coordinate under the mouse', () => {
  const radar = new Radar();
  const states = [];
  const viewport = createMapViewport(radar, { onChange: (state) => states.push(state) });
  assert.deepEqual(radar.box, [83, 111, 900, 790]);
  const pointer = [490, 411];
  const before = viewport.screenToRadar(...pointer);
  const wheel = radar.emit('wheel', { clientX: pointer[0], clientY: pointer[1], deltaY: -120, deltaMode: 0 });
  assert.equal(wheel.defaultPrevented, true);
  assert.ok(states.at(-1).scale > 1);
  nearlyEqual(viewport.screenToRadar(...pointer), before);
  for (let i = 0; i < 30; i += 1) radar.emit('wheel', { clientX: pointer[0], clientY: pointer[1], deltaY: -120, deltaMode: 0 });
  assert.equal(states.at(-1).scale, 4);
  assert.equal(states.at(-1).canZoomIn, false);
  viewport.destroy();
});

test('map centering preserves scale and reset restores the exact initial frame', () => {
  const radar = new Radar();
  let state;
  const viewport = createMapViewport(radar, { onChange: (next) => { state = next; } });
  viewport.zoomIn();
  const firstScale = state.scale;
  viewport.center([450, 475]);
  nearlyEqual(viewport.screenToRadar(570, 435), [450, 475]);
  assert.equal(state.scale, firstScale);
  assert.equal(state.canReset, true);
  viewport.reset();
  assert.deepEqual(radar.box, [83, 111, 900, 790]);
  assert.equal(state.canReset, false);
  assert.equal(state.canZoomOut, false);
  viewport.destroy();
});

test('drag follows the pointer and cancels only the click produced by the gesture', () => {
  const radar = new Radar();
  const viewport = createMapViewport(radar);
  viewport.zoomIn();

  radar.pointer('pointerdown', 540, 420);
  radar.pointer('pointermove', 542, 422);
  assert.equal(radar.captured.size, 0);
  radar.pointer('pointerup', 542, 422);
  assert.equal(radar.pointer('click', 542, 422).defaultPrevented, false);

  const dragged = viewport.screenToRadar(540, 420);
  radar.pointer('pointerdown', 540, 420);
  radar.pointer('pointermove', 567, 433);
  assert.equal(radar.captured.has(1), true);
  nearlyEqual(viewport.screenToRadar(567, 433), dragged);
  radar.pointer('pointerup', 567, 433);
  assert.equal(radar.emit('click', { detail: 0 }).defaultPrevented, false);
  assert.equal(radar.pointer('click', 567, 433).defaultPrevented, true);

  radar.pointer('pointerdown', 567, 433);
  radar.pointer('pointerup', 567, 433);
  assert.equal(radar.pointer('click', 567, 433).defaultPrevented, false);
  viewport.destroy();
});

test('two-finger pinch holds the midpoint and allows a subsequent tap', () => {
  const radar = new Radar();
  const viewport = createMapViewport(radar);
  const touch = (type, x, id) => radar.pointer(type, x, 430, { pointerId: id, pointerType: 'touch' });
  const before = viewport.screenToRadar(570, 430);

  touch('pointerdown', 510, 11);
  touch('pointerdown', 630, 12);
  touch('pointermove', 480, 11);
  touch('pointermove', 660, 12);
  assert.equal(radar.box[2], 600);
  nearlyEqual(viewport.screenToRadar(570, 430), before);
  touch('pointerup', 480, 11);
  touch('pointerup', 660, 12);
  assert.equal(touch('click', 660, 12).defaultPrevented, true);

  touch('pointerdown', 660, 13);
  touch('pointerup', 660, 13);
  assert.equal(touch('click', 660, 13).defaultPrevented, false);
  viewport.destroy();
});

test('screen conversion excludes letterbox margins', () => {
  const radar = new Radar({ width: 1200 });
  const viewport = createMapViewport(radar);
  assert.equal(viewport.screenToRadar(121, 435), null);
  nearlyEqual(viewport.screenToRadar(720, 435), [533, 506]);
  viewport.destroy();
});
