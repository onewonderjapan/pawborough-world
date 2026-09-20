// Player-experience batch A regression #1 — the fangbang canvas must render
// at the container's REAL CSS size (drawingBuffer = CSS x pixelRatio), never
// the untouched three.js 300x150 default stretched by CSS. Drives the
// production fit module (src/player/canvasFit.js) with fake renderer/camera
// objects: behavior test, no page-string matching.
//
// Run: node --test tests/fangbang_canvas_fit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePixelRatio, computeCanvasFit, applyCanvasFit } from '../src/player/canvasFit.js';

const fakeRenderer = () => {
  const r = { size: null, ratio: null,
    setSize(w, h, updateStyle) { r.size = [w, h]; r.updateStyle = updateStyle; },
    setPixelRatio(p) { r.ratio = p; } };
  return r;
};
const fakeCamera = () => {
  const c = { aspect: null, updated: 0,
    updateProjectionMatrix() { c.updated += 1; } };
  return c;
};

test('pixel ratio: default 1, clamped to [1, 1.5]', () => {
  assert.equal(resolvePixelRatio(null), 1);
  assert.equal(resolvePixelRatio(undefined), 1);
  assert.equal(resolvePixelRatio('1'), 1);
  assert.equal(resolvePixelRatio('1.25'), 1.25);
  assert.equal(resolvePixelRatio('1.5'), 1.5);
  assert.equal(resolvePixelRatio('2'), 1.5, 'DPR cap 1.5');
  assert.equal(resolvePixelRatio('3'), 1.5, 'DPR cap 1.5');
  assert.equal(resolvePixelRatio('0.5'), 1, 'never render below CSS resolution');
  assert.equal(resolvePixelRatio('abc'), 1, 'garbage -> default 1');
  assert.equal(resolvePixelRatio('-4'), 1);
});

test('fit: drawingBuffer equals CSS size x ratio (the 300x150 bug cannot recur)', () => {
  const wide = computeCanvasFit(1280, 502, 1);
  assert.deepEqual(wide.buffer, [1280, 502]);
  assert.equal(wide.aspect, 1280 / 502);

  const narrow = computeCanvasFit(390, 109, 1.5);
  assert.deepEqual(narrow.buffer, [585, 163.5].map(Math.round));
  assert.equal(narrow.aspect, 390 / 109);
});

test('fit: degenerate container dims are rejected, not zeroed', () => {
  assert.equal(computeCanvasFit(0, 400, 1), null);
  assert.equal(computeCanvasFit(400, 0, 1), null);
  assert.equal(computeCanvasFit(-10, 400, 1), null);
});

test('applyCanvasFit drives renderer.setSize + camera.aspect together', () => {
  const r = fakeRenderer(), c = fakeCamera();
  const applied = applyCanvasFit(r, c, 1280, 502, 1);
  assert.equal(applied, true);
  assert.deepEqual(r.size, [1280, 502]);
  assert.equal(r.ratio, 1);
  assert.equal(r.updateStyle, false, 'CSS owns the layout; renderer owns the buffer');
  assert.equal(c.aspect, 1280 / 502);
  assert.ok(c.updated >= 1, 'projection updated');

  // a panel toggle changing the container re-fits and re-aspects
  applyCanvasFit(r, c, 1100, 502, 1);
  assert.deepEqual(r.size, [1100, 502]);
  assert.equal(c.aspect, 1100 / 502);

  // degenerate mid-layout measurement must NOT shrink the buffer to 0
  const kept = applyCanvasFit(r, c, 0, 0, 1);
  assert.equal(kept, false);
  assert.deepEqual(r.size, [1100, 502], 'previous fit retained');
});
