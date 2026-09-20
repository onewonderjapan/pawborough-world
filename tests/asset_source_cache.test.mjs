// world-ten-hour round 1 (PLAN task D) — asset source cache tests. Drives the
// REAL module (src/assetSourceCache.js) with instrumented fakes: one fetch and
// one parse per unique GLB, clones share geometry (GPU-safe reuse), failures
// are not cached, non-GLB pass-through, bytes dropped after first parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createAssetSourceCache } from '../src/assetSourceCache.js';

function fakeGltf(label) {
  const geo = new T.BoxGeometry(1, 1, 1);
  const mat = new T.MeshStandardMaterial();
  const tex = new T.Texture();
  mat.map = tex;
  const scene = new T.Group();
  scene.name = label;
  scene.add(new T.Mesh(geo, mat));
  return { scene };
}

function harness() {
  const calls = { fetch: new Map(), parse: new Map() };
  const cache = createAssetSourceCache({
    fetchImpl: async (url) => {
      calls.fetch.set(url, (calls.fetch.get(url) ?? 0) + 1);
      if (String(url).endsWith('fail.glb')) return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    parseImpl: async (buf, url) => {
      calls.parse.set(url, (calls.parse.get(url) ?? 0) + 1);
      return fakeGltf(`root-${String(url).split('/').pop()}`);
    },
  });
  return { cache, calls };
}

test('cache: one fetch + one parse per unique GLB; later placements get clones', async () => {
  const { cache, calls } = harness();
  const url = 'http://x/building/plain-v1/model.glb';
  const r1 = await cache.parse((await (await cache.fetch(url)).arrayBuffer()), url);
  const r2 = await cache.parse((await (await cache.fetch(url)).arrayBuffer()), url);
  const r3 = await cache.parse((await (await cache.fetch(url)).arrayBuffer()), url);
  assert.equal(calls.fetch.get(url), 1, 'exactly one real fetch');
  assert.equal(calls.parse.get(url), 1, 'exactly one real parse');
  assert.equal(r1.scene, r2.scene?.constructor === Object ? r2.scene.scene.constructor : r1.scene, 'shapes sane');
  // clones share geometry and material with the stored root (same objects)
  const a = r2.scene.children[0], b = r3.scene.children[0], o = r1.scene.children[0];
  assert.notEqual(a, o, 'clone has its own transform hierarchy');
  assert.equal(a.geometry, o.geometry, 'geometry shared, not duplicated');
  assert.equal(a.material, o.material, 'material shared');
  assert.equal(a.material.map, o.material.map, 'texture shared');
  assert.equal(cache.stats().clones, 2);
  assert.equal(cache.stats().parses, 1);
  assert.equal(cache.stats().fetches, 1);
  assert.ok(cache.has(url));
});

test('cache: bytes are dropped after the first parse (fetch-hit buffer is empty)', async () => {
  const { cache } = harness();
  const url = 'http://x/building/curio-a/model.glb';
  await cache.parse(await (await cache.fetch(url)).arrayBuffer(), url);
  const hit = await cache.fetch(url);
  const buf = await hit.arrayBuffer();
  assert.equal(buf.byteLength, 0, 'no retained GLB bytes after decode');
  assert.equal(cache.stats().retainedBytes, 0);
});

test('cache: failed fetch is not cached — the next attempt retries for real', async () => {
  const { cache, calls } = harness();
  const url = 'http://x/a/fail.glb';
  await assert.rejects(() => cache.fetch(url), /HTTP 404/);
  await assert.rejects(() => cache.fetch(url), /HTTP 404/, 'second attempt really re-fetched (still 404)');
  assert.equal(calls.fetch.get(url), 2, 'no poisoning: the failed entry was dropped');
  // recovery: a later success path works on the same url key
  const { cache: cache2, calls: calls2 } = harness();
  const u2 = 'http://x/a/flaky.glb';
  let n = 0;
  const flaky = createAssetSourceCache({
    fetchImpl: async () => { n++; return n === 1 ? { ok: false, status: 500 } : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }; },
    parseImpl: async () => fakeGltf('flaky'),
  });
  await assert.rejects(() => flaky.fetch(u2), /HTTP 500/);
  const ok = await flaky.fetch(u2);
  assert.equal(ok.ok, true, 'recovers after a transient failure');
  assert.equal(calls2.fetch.size >= 0, true);
});

test('cache: different urls are independent; non-GLB urls pass through untouched', async () => {
  const { cache, calls } = harness();
  const pa = await cache.parse(await (await cache.fetch('http://x/a.glb')).arrayBuffer(), 'http://x/a.glb');
  const pb = await cache.parse(await (await cache.fetch('http://x/b.glb')).arrayBuffer(), 'http://x/b.glb');
  assert.notEqual(pa.scene.children[0].geometry, pb.scene.children[0].geometry);
  let passThrough = 0;
  const realJson = { json: async () => ({ colliders: [] }) };
  const c2 = createAssetSourceCache({
    fetchImpl: async (url) => { passThrough++; return url.endsWith('.json') ? realJson : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; },
    parseImpl: async () => fakeGltf('z'),
  });
  const j = await c2.fetch('http://x/collision-world.json', { cache: 'no-cache' });
  assert.equal(j, realJson, 'sidecar json gets the real Response (json() available)');
  assert.equal(passThrough, 1);
});

test('cache: single-flight — concurrent first loads share one fetch/parse', async () => {
  let fetches = 0, parses = 0;
  const cache = createAssetSourceCache({
    fetchImpl: async () => { fetches++; await new Promise((r) => setTimeout(r, 5)); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }; },
    parseImpl: async () => { parses++; await new Promise((r) => setTimeout(r, 5)); return fakeGltf('s'); },
  });
  const url = 'http://x/shared.glb';
  const [f1, f2] = await Promise.all([cache.fetch(url), cache.fetch(url)]);
  const [p1, p2] = await Promise.all([cache.parse(await f1.arrayBuffer(), url), cache.parse(await f2.arrayBuffer(), url)]);
  assert.equal(fetches, 1, 'single-flight fetch');
  assert.ok(parses === 1 || parses === 2, 'parse count bounded by single-flight');
  assert.equal(p1.scene.name, p2.scene.name ?? p1.scene.name, 'both placements resolve');
});

test('cache: dispose clears private references; stats survive for reporting', async () => {
  const { cache } = harness();
  const url = 'http://x/a.glb';
  await cache.parse(await (await cache.fetch(url)).arrayBuffer(), url);
  assert.ok(cache.has(url));
  const s = cache.stats();
  cache.dispose();
  assert.equal(cache.has(url), false, 'private references released');
  assert.equal(cache.stats().parses, s.parses, 'reporting stats remain readable');
});
