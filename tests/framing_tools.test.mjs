// world-ten-hour round 1 (PLAN task C) — framing tool core tests. Drives the
// REAL module (src/framingTools.js) with positives and loud-failure negatives:
// foreign dataset / non-finite numbers / fov range / name length / store
// corruption must throw or be skipped with a reason, never silently applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_KEY, SCHEMA_VERSION, FOV_MIN, FOV_MAX, FramingError,
  validateView, decodeStore, loadViews, addView, mergeViews, removeView, findView, makeViewId,
} from '../src/framingTools.js';

const DS = 'fangbang-temple-v7';
const good = (over = {}) => ({
  schemaVersion: SCHEMA_VERSION, dataset: DS, name: '西口暮色',
  position: [124.6, 1.6, 27.65], target: [-127.8, 4.5, 27.06], fovDeg: 55,
  display: { clay: false }, createdAt: 1729500000000, ...over,
});

test('framing: validateView normalizes a good view and keeps the numbers', () => {
  const v = validateView(good(), DS);
  assert.equal(v.name, '西口暮色');
  assert.deepEqual(v.position, [124.6, 1.6, 27.65]);
  assert.equal(v.fovDeg, 55);
  assert.equal(v.display.clay, false);
  assert.equal(v.id, null);           // ids are minted by addView, not trusted
  assert.equal(v.dataset, DS);
});

test('framing: validateView rejects foreign dataset, bad numbers, bad fov, bad name', () => {
  assert.throws(() => validateView(good({ dataset: 'other-world' }), DS), FramingError);
  assert.throws(() => validateView(good({ dataset: null }), DS), FramingError);
  assert.throws(() => validateView(good({ position: [1, 2] }), DS), /position/);
  assert.throws(() => validateView(good({ position: [1, Number.NaN, 3] }), DS), /position/);
  assert.throws(() => validateView(good({ target: ['a', 2, 3] }), DS), /target/);
  assert.throws(() => validateView(good({ target: Infinity }), DS), /target/);
  assert.throws(() => validateView(good({ fovDeg: FOV_MIN - 1 }), DS), /fovDeg/);
  assert.throws(() => validateView(good({ fovDeg: FOV_MAX + 1 }), DS), /fovDeg/);
  assert.throws(() => validateView(good({ fovDeg: '55' }), DS), /fovDeg/);
  assert.throws(() => validateView(good({ name: '   ' }), DS), /机位名/);
  assert.throws(() => validateView(good({ name: '长'.repeat(41) }), DS), /机位名/);
  assert.throws(() => validateView(good({ schemaVersion: 2 }), DS), /schemaVersion/);
  assert.throws(() => validateView(good({ display: { clay: 'yes' } }), DS), /clay/);
  assert.throws(() => validateView('nope', DS), /对象/);
  // boundaries are valid
  assert.equal(validateView(good({ fovDeg: FOV_MIN }), DS).fovDeg, FOV_MIN);
  assert.equal(validateView(good({ fovDeg: FOV_MAX }), DS).fovDeg, FOV_MAX);
});

test('framing: decodeStore accepts envelope or bare view, rejects corrupt payloads', () => {
  const env = JSON.stringify({ storeVersion: SCHEMA_VERSION, views: [good(), good({ name: 'b' })] });
  assert.equal(decodeStore(env).length, 2);
  assert.equal(decodeStore(JSON.stringify(good())).length, 1, 'bare view is accepted for import');
  assert.throws(() => decodeStore('{not json'), FramingError);
  assert.throws(() => decodeStore(JSON.stringify({ nope: 1 })), FramingError);
  assert.throws(() => decodeStore(JSON.stringify([1, 2])), FramingError);
  assert.throws(() => decodeStore('null'), FramingError);
});

test('framing: loadViews skips bad entries WITH reasons and keeps good ones', () => {
  const raws = [good(), good({ name: '坏数据集', dataset: 'elsewhere' }), good({ position: [1], name: '坏坐标' }), good({ name: '另一机位' })];
  const { views, errors } = loadViews(raws, DS);
  assert.equal(views.length, 2);
  assert.equal(errors.length, 2);
  assert.ok(errors[0].error.includes('数据集'), errors[0].error);
  assert.ok(errors[1].error.includes('position'), errors[1].error);
  assert.equal(errors[1].name, '坏坐标', 'entry name carried for the report');
});

test('framing: addView is additive — collisions get （2） suffixes, ids are minted', () => {
  const a = { ...validateView(good(), DS), id: makeViewId() };
  const { views: v1, view: stored1 } = addView([], a);
  assert.equal(v1.length, 1);
  assert.ok(stored1.id.startsWith('ft-'));
  const { views: v2, view: stored2 } = addView(v1, { ...validateView(good(), DS), id: null });
  assert.equal(v2.length, 2);
  assert.equal(stored2.name, '西口暮色（2）', 'collision renamed, never overwritten');
  const { view: stored3 } = addView(v2, { ...validateView(good(), DS), id: null });
  assert.equal(stored3.name, '西口暮色（3）');
});

test('framing: mergeViews is additive and reports skips; the original list is untouched', () => {
  const existing = [{ ...validateView(good(), DS), id: 'ft-orig' }];
  const payload = decodeStore(JSON.stringify({
    views: [good({ name: '新机位' }), good({ name: '西口暮色' }), good({ fovDeg: 999 }), good({ dataset: 'x', name: '外星' })],
  }));
  const { views, added, errors } = mergeViews(existing, payload, DS);
  assert.equal(existing.length, 1, 'input array not mutated');
  assert.equal(views.length, 3);
  assert.equal(added.length, 2);
  assert.equal(errors.length, 2);
  assert.ok(views.find((v) => v.id === 'ft-orig'), 'existing view kept verbatim');
  assert.ok(views.find((v) => v.name === '西口暮色（2）'), 'collision suffixed');
});

test('framing: removeView/findView are exact and loud about misses', () => {
  const views = [{ ...validateView(good(), DS), id: 'ft-a' }, { ...validateView(good({ name: 'b' }), DS), id: 'ft-b' }];
  const next = removeView(views, 'ft-a');
  assert.deepEqual(next.map((v) => v.id), ['ft-b']);
  assert.equal(views.length, 2, 'input untouched');
  assert.throws(() => removeView(views, 'ft-nope'), FramingError);
  assert.equal(findView(views, 'ft-b').name, 'b');
  assert.throws(() => findView(views, 'ft-nope'), FramingError);
});

test('framing: no user secrets in a serialized store', () => {
  const v = validateView(good(), DS);
  const text = JSON.stringify({ storeVersion: SCHEMA_VERSION, views: [v] });
  for (const banned = ['token', 'password', 'localStorage', 'cookie', 'navigator']; banned.length;) {
    const word = banned.pop();
    assert.ok(!text.toLowerCase().includes(word), `store must not contain ${word}`);
  }
  assert.ok(text.includes('position') && text.includes('fovDeg') && text.includes(DS));
  assert.ok(typeof STORE_KEY === 'string' && STORE_KEY.startsWith('pawborough.'));
});
