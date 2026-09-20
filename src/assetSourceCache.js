// Shared asset source cache (world-ten-hour 20260921, PLAN task D) — the
// fetch/parse layer for block asset GLBs. Measured before (load-measure/before):
// the autoApply asset blocks re-FETCH and re-PARSE the same GLB once per
// placement (plain-v1 ×4, curio-a ×4, pharmacy_shop ×3 … ≈ 39 MB of the
// 95.8 MB per load, plus ~10 redundant GLTF decodes and duplicate GPU
// resources). This module makes each unique GLB be fetched and decoded exactly
// once and hands out `root.clone(true)` per placement — clones SHARE geometry,
// materials and textures (identical bytes + identical sampler/UV/color space,
// the reuse the plan allows), so GPU memory and parse time are paid once.
//
// Ownership / lifecycle (plan D rules):
//   - the cache is owned by the page session that created it; entries are
//     private to it and die with the page (retry = fresh page = fresh cache)
//   - single-flight per URL: concurrent loads share one fetch/parse
//   - a failed fetch/parse is NOT cached — the next attempt retries for real
//   - bytes are retained only until the first parse; later fetch-hits hand out
//     an empty buffer that the paired parse() ignores (root already stored)
//   - clones share GPU objects with the cached root; a revoked block's
//     resource disposal frees them and three.js transparently re-uploads on
//     the next use of any surviving clone (correct, small hitch on revoke)
// DOM-free and renderer-free: node tests drive it with fake fetch/parse.
const isGlbUrl = (u) => /\.glb($|[?#])/i.test(String(u));
const shortUrl = (u) => {
  try { return new URL(u, location.href).pathname.split('/').slice(-2).join('/'); }
  catch { return String(u).slice(-60); }
};

export function createAssetSourceCache({ fetchImpl, parseImpl } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('assetSourceCache: fetchImpl required');
  if (typeof parseImpl !== 'function') throw new Error('assetSourceCache: parseImpl required');
  const entries = new Map();       // url -> { bytes: ArrayBuffer|null, root: Object3D|null, inflight: Promise|null }
  const stats = { urls: 0, fetches: 0, parses: 0, clones: 0, retainedBytes: 0 };

  const key = (u) => String(u);

  async function loadThrough(url) {
    let e = entries.get(key(url));
    if (e) return e;
    e = { bytes: null, root: null, inflight: null };
    entries.set(key(url), e);
    e.inflight = (async () => {
      const res = await fetchImpl(url, { cache: 'no-cache' });
      if (!res?.ok) throw new Error(`assetSourceCache: ${url} HTTP ${res?.status ?? '??'}`);
      const bytes = await res.arrayBuffer();
      stats.fetches += 1;
      e.bytes = bytes;
      stats.retainedBytes += bytes.byteLength;
      return e;
    })();
    // a failed load must not poison the cache: drop the entry so the next
    // attempt really re-fetches (plan D: failures are never cached). The
    // rethrow names the URL — the fatal panel must be able to say WHICH
    // resource failed (plan E: visible state carries the reason).
    return e.inflight.catch((err) => {
      if (entries.get(key(url)) === e) entries.delete(key(url));
      err.message = `资源 ${shortUrl(url)} 加载失败：${err.message}`;
      throw err;
    });
  }

  return {
    // fetch-shaped replacement for the asset factory. Non-GLB urls (collision
    // sidecar JSON) pass through untouched. GLB hits after the first parse
    // return ok with an EMPTY buffer — parse() below serves the clone.
    async fetch(url, init) {
      if (!isGlbUrl(url)) return fetchImpl(url, init);
      const e = await loadThrough(url);
      if (e.root) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
      return {
        ok: true, status: 200,
        arrayBuffer: async () => {
          if (!e.bytes) throw new Error(`assetSourceCache: ${url} bytes already consumed`);
          return e.bytes;
        },
      };
    },

    // parseAsync-shaped replacement: the first call decodes and keeps
    // gltf.scene as the shared root, every later call returns a fresh
    // { scene: root.clone(true) } — the factory only consumes model.scene.
    async parse(buf, url) {
      const e = entries.get(key(url));
      if (!e) {
        // no fetch went through the cache for this url — decode privately and
        // do NOT cache (bytes came from outside this cache's accounting)
        stats.parses += 1;
        return parseImpl(buf, url);
      }
      if (!e.root) {
        stats.parses += 1;
        const gltf = await parseImpl(buf, url);
        e.root = gltf.scene;
        if (e.bytes) { stats.retainedBytes -= e.bytes.byteLength; e.bytes = null; }
        stats.urls += 1;
        return gltf;
      }
      stats.clones += 1;
      return { scene: e.root.clone(true) };
    },

    // true when this url has a decoded root (evidence/inspection helper)
    has(url) { return !!entries.get(key(url))?.root; },
    stats() { return { ...stats }; },
    // release private references (page teardown); GPU objects owned by the
    // scene die with the renderer/context, shared clones stay renderable
    dispose() { entries.clear(); },
  };
}
