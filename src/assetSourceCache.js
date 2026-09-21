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
// Ownership / lifecycle (plan D rules, hardened by REL-02 20260921):
//   - the cache is owned by the page session that created it; entries are
//     private to it and die with the page (retry = fresh page = fresh cache)
//   - single-flight per URL at BOTH layers: concurrent `fetch()` calls await
//     the SAME inflight chain (an unfinished entry is never handed back), and
//     concurrent `parse()` calls share one decode promise — the lead-verified
//     "bytes already consumed" + double-decode race cannot recur
//   - bytes stay readable for EVERY consumer that fetched until its parse ran
//     (per-consumer pending count); later fetch-hits after the decode hand out
//     an empty buffer that the paired parse() ignores (root already stored)
//   - a failed fetch OR parse is NOT cached — the entry is dropped so the next
//     attempt retries for real, every concurrent caller sees the rejection,
//     and retainedBytes stays exact (never negative, never leaks)
//   - dispose() is a session/generation boundary: chains completing after it
//     fail or decode privately and never re-enter the disposed cache
//   - clones share GPU objects with the cached root; a revoked block's
//     resource disposal frees them and three.js transparently re-uploads on
//     the next use of any surviving clone (correct, small hitch on revoke).
//     dispose() only drops JS references — it never calls dispose() on shared
//     geometry/materials, so another session's instances are never orphaned
// DOM-free and renderer-free: node tests drive it with fake fetch/parse.
const isGlbUrl = (u) => /\.glb($|[?#])/i.test(String(u));
const shortUrl = (u) => {
  try { return new URL(u, location.href).pathname.split('/').slice(-2).join('/'); }
  catch { return String(u).slice(-60); }
};

export function createAssetSourceCache({ fetchImpl, parseImpl } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('assetSourceCache: fetchImpl required');
  if (typeof parseImpl !== 'function') throw new Error('assetSourceCache: parseImpl required');
  const entries = new Map();       // url -> entry
  const stats = { urls: 0, fetches: 0, parses: 0, clones: 0, retainedBytes: 0 };
  let disposed = false;

  const key = (u) => String(u);

  // release an entry's bytes and remove it from the map — only while it is
  // still the live entry for this url (a disposed/failed generation never
  // touches its successor). Accounting is adjusted here and nowhere else.
  function dropEntry(e, url) {
    if (entries.get(key(url)) !== e) return;
    if (e.bytes) { stats.retainedBytes -= e.bytes.byteLength; e.bytes = null; }
    e.root = null;
    e.pending = 0;
    entries.delete(key(url));
  }

  // THE single-flight chain for one url: the first caller creates it, every
  // later caller awaits the SAME promise — an entry whose fetch is still in
  // flight is never handed back unfinished (the REL-02 root cause).
  function loadThrough(url) {
    const existing = entries.get(key(url));
    if (existing) return existing.inflight;
    const e = { bytes: null, root: null, pending: 0, inflight: null, parseInflight: null };
    const raw = (async () => {
      const res = await fetchImpl(url, { cache: 'no-cache' });
      if (!res?.ok) throw new Error(`assetSourceCache: ${url} HTTP ${res?.status ?? '??'}`);
      const bytes = await res.arrayBuffer();
      if (disposed) throw new Error('assetSourceCache: session disposed during load');
      stats.fetches += 1;
      e.bytes = bytes;
      stats.retainedBytes += bytes.byteLength;
      return e;
    })();
    // a failed load must not poison the cache: drop the entry so the next
    // attempt really re-fetches (plan D: failures are never cached). The
    // rethrow names the URL — the fatal panel must be able to say WHICH
    // resource failed (plan E: visible state carries the reason).
    e.inflight = raw.catch((err) => {
      dropEntry(e, url);
      if (!disposed) err.message = `资源 ${shortUrl(url)} 加载失败：${err.message}`;
      throw err;
    });
    e.inflight.catch(() => {}); // the stored copy stays handled; every consumer awaits it directly
    entries.set(key(url), e);
    return e.inflight;
  }

  return {
    // fetch-shaped replacement for the asset factory. Non-GLB urls (collision
    // sidecar JSON) pass through untouched. GLB hits after the first parse
    // return ok with an EMPTY buffer — parse() below serves the clone.
    async fetch(url, init) {
      if (!isGlbUrl(url)) return fetchImpl(url, init);
      if (disposed) throw new Error('assetSourceCache: session disposed');
      const e = await loadThrough(url);
      if (e.root) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
      // this consumer will still need the bytes: hold them until its parse.
      // The closure keeps returning them even if a sibling consumer decoded
      // meanwhile — the root exists then, and this parse() call takes the
      // clone path without needing the buffer anyway.
      e.pending += 1;
      return {
        ok: true, status: 200,
        arrayBuffer: async () => {
          if (disposed) throw new Error('assetSourceCache: session disposed');
          if (!e.bytes) throw new Error(`assetSourceCache: ${url} bytes unavailable`);
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
      if (e.root) {
        stats.clones += 1;
        return { scene: e.root.clone(true) };
      }
      let owner = false;
      if (!e.parseInflight) {
        owner = true;
        stats.parses += 1; // counted per real decode, exactly once per single-flight
        const decode = (async () => {
          // decode from the cache's own fetch (authoritative bytes); a caller
          // that raced past its arrayBuffer still gets the shared result
          const src = (e.bytes && e.bytes.byteLength > 0) ? e.bytes : buf;
          const gltf = await parseImpl(src, url);
          if (disposed || entries.get(key(url)) !== e) return gltf; // late result never resurrects
          e.root = gltf.scene;
          stats.urls += 1;
          return gltf;
        })();
        // a failed parse is not cached either: the entry drops (bytes leave
        // the accounting exactly once) and the next attempt re-fetches
        e.parseInflight = decode.catch((err) => {
          dropEntry(e, url);
          throw err;
        });
        e.parseInflight.catch(() => {});
      }
      const gltf = await e.parseInflight;
      if (owner) {
        // the decode's own gltf goes ONLY to its caller: every other
        // placement gets a clone — a scene object can never end up under
        // two parents (the factory attaches model.scene to its holder)
        if (e.pending > 0) e.pending -= 1;
        if (e.pending <= 0 && e.bytes) {
          stats.retainedBytes -= e.bytes.byteLength;
          e.bytes = null;
        }
        return gltf;
      }
      stats.clones += 1;
      if (e.pending > 0) e.pending -= 1;
      if (e.root && e.pending <= 0 && e.bytes) {
        stats.retainedBytes -= e.bytes.byteLength;
        e.bytes = null;
      }
      return { scene: gltf.scene.clone(true) };
    },

    // true when this url has a decoded root (evidence/inspection helper)
    has(url) { return !!entries.get(key(url))?.root; },
    stats() { return { ...stats }; },
    // release private references (page teardown); GPU objects owned by the
    // scene die with the renderer/context, shared clones stay renderable.
    // Session boundary: inflight chains completing after this point never
    // write back into the cleared map (disposed guard on every late write).
    dispose() {
      disposed = true;
      for (const e of entries.values()) {
        if (e.bytes) { stats.retainedBytes -= e.bytes.byteLength; e.bytes = null; }
        e.root = null;
        e.pending = 0;
      }
      entries.clear();
    },
  };
}
