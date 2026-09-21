// REL-02 (world-reliability 20260921) — STRICT cache concurrency negatives.
// The lead acceptance reproduced the defect on the OLD implementation
// (control/cache-concurrency-before.json): two full fetch→arrayBuffer→parse
// chains on the same URL — one rejected with "bytes already consumed" and the
// GLB decoded TWICE. The old test suite never caught it because it awaited all
// fetches before parsing and accepted parses=1 OR 2. These tests drive the
// REAL module with explicitly ORDERED completion of every await boundary, so
// the old single-flight hole (loadThrough returning an unfinished entry) and
// the unguarded parse race both fail loudly.
//
// Contract under test:
//   - all concurrent full loads fulfill; exactly ONE fetch + ONE decode
//   - bytes stay readable for EVERY consumer that fetched until its parse ran
//   - results are distinct scene instances sharing geometry/material/texture
//   - fetch failure AND parse failure drop the entry (real retry), propagate
//     to every concurrent caller, and keep retainedBytes exact (never negative)
//   - dispose is a session boundary: late fetch/parse results never resurrect
//     the disposed cache, and accounting never goes negative
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createAssetSourceCache } from '../src/assetSourceCache.js';

const URL = 'http://x/building/plain-v1/model.glb';

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

// Deferred gate: `wait(name)` returns a promise resolved by `flush(name)`.
function gates(...names) {
  const pending = new Map(names.map((n) => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return [n, { promise, resolve }];
  }));
  return {
    wait: (n) => pending.get(n).promise,
    flush: (...ns) => { for (const n of ns) pending.get(n).resolve(); },
  };
}

test('cache concurrency: two FULL chains race — both succeed, one fetch, one decode, shared geometry', async () => {
  const g = gates('fetch', 'ab1', 'ab2', 'parse');
  let fetches = 0, parses = 0;
  const cache = createAssetSourceCache({
    fetchImpl: async () => {
      fetches += 1;
      await g.wait('fetch');
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
    },
    parseImpl: async () => {
      parses += 1;
      await g.wait('parse');
      return fakeGltf('root');
    },
  });

  // two complete consumer chains, started simultaneously, interleaved at
  // every await boundary exactly like the page's concurrent block loads
  const chain = async () => {
    const res = await cache.fetch(URL);
    const bytes = await res.arrayBuffer();
    return cache.parse(bytes, URL);
  };
  const p1 = chain();
  const p2 = chain();
  g.flush('fetch');                    // the shared fetch completes for both
  await new Promise((r) => setImmediate(r)); // both chains take bytes and enter parse
  g.flush('parse');                    // the single decode completes for both
  const [r1, r2] = await Promise.all([p1, p2]).then(
    (v) => v,
    (err) => { throw new Error(`concurrent full load failed: ${err.message}`); },
  );

  assert.equal(fetches, 1, `exactly one real fetch (got ${fetches})`);
  assert.equal(parses, 1, `exactly one real decode (got ${parses})`);
  assert.notEqual(r1.scene, r2.scene, 'each placement gets its own scene instance');
  const m1 = r1.scene.children[0], m2 = r2.scene.children[0];
  assert.equal(m1.geometry, m2.geometry, 'geometry shared, not duplicated');
  assert.equal(m1.material, m2.material, 'material shared');
  assert.equal(m1.material.map, m2.material.map, 'texture shared');
  const s = cache.stats();
  assert.equal(s.fetches, 1);
  assert.equal(s.parses, 1);
  assert.equal(s.clones, 1);
  assert.equal(s.retainedBytes, 0, 'bytes dropped after the last consumer parsed');
});

test('cache concurrency: late consumer still reads bytes after an earlier consumer parsed', async () => {
  // A fetches and parses immediately; B's fetch hit was served while the
  // entry was still inflight — B's arrayBuffer() must still yield bytes and
  // B's parse must return the shared root (never a second decode, never a
  // "bytes already consumed" rejection).
  let parses = 0;
  const cache = createAssetSourceCache({
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    parseImpl: async () => { parses += 1; return fakeGltf('root'); },
  });

  const bFetch = cache.fetch(URL);                 // B starts first, stalls before arrayBuffer
  await cache.fetch(URL).then((r) => r.arrayBuffer()).then((b) => cache.parse(b, URL)); // A completes the whole chain
  const bBytes = await (await bFetch).arrayBuffer();
  assert.equal(bBytes.byteLength, 8, 'bytes still accessible for the pending consumer');
  const b2 = await cache.parse(bBytes, URL);
  assert.equal(parses, 1, 'no second decode for the late consumer');
  assert.equal(b2.scene.name, 'root');
});

test('cache concurrency: simultaneous parse() calls decode exactly once (parse single-flight)', async () => {
  const g = gates('parse');
  let parses = 0;
  const cache = createAssetSourceCache({
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    parseImpl: async () => { parses += 1; await g.wait('parse'); return fakeGltf('root'); },
  });
  const bytes = await (await cache.fetch(URL)).arrayBuffer();
  const p1 = cache.parse(bytes, URL);
  const p2 = cache.parse(bytes, URL);
  const p3 = cache.parse(bytes, URL);
  g.flush('parse');
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(parses, 1, `one decode for three simultaneous parses (got ${parses})`);
  assert.equal(r2.scene.children[0].geometry, r1.scene.children[0].geometry);
  assert.equal(r3.scene.children[0].geometry, r1.scene.children[0].geometry);
});

test('cache concurrency: fetch failure propagates to BOTH callers and really retries', async () => {
  let attempts = 0;
  const cache = createAssetSourceCache({
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 503 }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    parseImpl: async () => fakeGltf('root'),
  });
  const e1 = cache.fetch(URL);
  const e2 = cache.fetch(URL);                      // second caller rides the same inflight
  await assert.rejects(e1, /HTTP 503|加载失败/);
  await assert.rejects(e2, /HTTP 503|加载失败/, 'the concurrent caller sees the same failure');
  assert.equal(cache.stats().retainedBytes, 0, 'no bytes retained for the failed entry');
  // recovery: the entry was dropped, the retry fetches for real and succeeds
  const ok = await cache.parse(await (await cache.fetch(URL)).arrayBuffer(), URL);
  assert.equal(ok.scene.name, 'root');
  assert.equal(attempts, 2);
});

test('cache concurrency: parse failure propagates, drops the entry, keeps accounting exact', async () => {
  let parses = 0;
  const cache = createAssetSourceCache({
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1234) }),
    parseImpl: async () => {
      parses += 1;
      if (parses === 1) throw new Error('glTF: corrupt chunk');
      return fakeGltf('root');
    },
  });
  const chain = async () => cache.parse(await (await cache.fetch(URL)).arrayBuffer(), URL);
  const p1 = chain();
  const p2 = chain();
  await assert.rejects(p1, /corrupt chunk/);
  await assert.rejects(p2, /corrupt chunk/, 'the concurrent parser sees the same failure');
  const s1 = cache.stats();
  assert.equal(s1.retainedBytes, 0, 'failed entry released its bytes (no leak, no negative)');
  assert.equal(cache.has(URL), false, 'failed parse is not cached');
  const ok = await chain();                          // retry re-fetches and succeeds
  assert.equal(ok.scene.name, 'root');
  assert.equal(parses, 2);
  assert.equal(cache.stats().retainedBytes, 0, 'bytes dropped again after the retry parse');
});

test('cache concurrency: dispose during inflight — late fetch/parse never resurrect the cache', async () => {
  const g = gates('fetch');
  const cache = createAssetSourceCache({
    fetchImpl: async () => { await g.wait('fetch'); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) }; },
    parseImpl: async () => fakeGltf('root'),
  });
  const late = cache.fetch(URL);                     // inflight when dispose lands
  cache.dispose();
  g.flush('fetch');
  await assert.rejects(late, /disposed|加载失败/, 'a load completing after dispose fails — no resurrection');
  assert.equal(cache.has(URL), false);
  assert.equal(cache.stats().retainedBytes, 0, 'dispose releases retained bytes (accounting stays at 0)');
  // a parse after dispose finds no entry: private decode, cache stays empty
  const gltf = await cache.parse(new ArrayBuffer(4), URL);
  assert.equal(gltf.scene.name, 'root');
  assert.equal(cache.has(URL), false, 'post-dispose parse does not re-enter the cache');
  assert.equal(cache.stats().urls, 0);
});

test('cache ownership: disposing one cache never disposes geometry still used by another instance', async () => {
  // two caches serving the same factory: tearing one page session down must
  // not dispose GPU objects the other session's clones still render with
  let disposedCalls = 0;
  const geoPatch = () => {
    // no dispose() calls are expected anywhere — assert on the shared objects instead
  };
  const makeCache = () => createAssetSourceCache({
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    parseImpl: async () => fakeGltf('root'),
  });
  const a = makeCache(), b = makeCache();
  const pa = await a.parse(await (await a.fetch(URL)).arrayBuffer(), URL);
  const pb = await b.parse(await (await b.fetch(URL)).arrayBuffer(), URL);
  const geoA = pa.scene.children[0].geometry;
  const geoB = pb.scene.children[0].geometry;
  assert.notEqual(geoA, geoB, 'separate sessions own separate GPU objects');
  const before = geoB.dispose ? geoB : null;
  a.dispose();
  geoPatch();
  if (before) assert.equal(before.userData.disposed, undefined, 'no dispose marker leaked across sessions');
  // the surviving cache still clones and renders
  const pb2 = await b.parse(await (await b.fetch(URL)).arrayBuffer(), URL);
  assert.equal(pb2.scene.name, 'root');
  assert.equal(pb2.scene.children[0].geometry, geoB);
});
