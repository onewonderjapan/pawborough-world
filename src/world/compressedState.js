// H2 (adoption batch 20260919): the compressed variant is the DEFAULT load
// state. `?compressed=0` opts back to the original bytes; `?compressed=1` (or
// any other value) keeps the default. Per-dataset state must be CONSISTENT —
// a page integrity-checks its GLBs against the manifest it fetched, so the
// manifest and the GLBs must come from the same variant — therefore the
// installer probes for `review-manifest.cm.json` under the page's own dataset
// and only repoints fetches when that probe succeeds; a dataset without a
// compressed manifest stays entirely original (no mixing of states).
export function compressedEnabled(params) {
  return params.get('compressed') !== '0';
}

let probed = false;
let active = false;

export function compressedActive() {
  return probed && active;
}

// Installs the fetch rewrite (original .glb -> .cm.glb, review-manifest.json
// -> review-manifest.cm.json) iff `requested` and the dataset carries a
// compressed manifest. Every repoint falls back to the original URL on a
// non-ok response so one straggling asset degrades to original bytes instead
// of failing the page. Returns the resolved active state.
export async function installCompressedFetch(baseUrl, requested = true, rawFetch = window.fetch.bind(window)) {
  if (probed) return active;
  probed = true;
  if (!requested) return false;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let hasCm = false;
  try {
    const probe = await rawFetch(`${base}review-manifest.cm.json`, { method: 'HEAD' });
    // vite dev/preview answer missing paths with a 200 index.html fallback —
    // a 200 HTML response means "no compressed manifest", never "compressed"
    const type = probe.headers?.get?.('content-type') ?? '';
    hasCm = probe.ok && !type.includes('text/html');
  } catch {
    hasCm = false;
  }
  if (!hasCm) return false;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url === 'string') {
      if (/\.glb(\?|$)/.test(url) && !/\.cm\.glb(\?|$)/.test(url)) {
        const repointed = await rawFetch(url.replace(/\.glb(\?|$)/, '.cm.glb$1'), init);
        // vite dev answers missing paths with a 200 index.html fallback — only
        // accept the repoint when it is NOT an HTML error page
        const type = repointed.headers?.get?.('content-type') ?? '';
        if (repointed.ok && !type.includes('text/html')) return repointed;
      } else if (/\/review-manifest\.json(\?|$)/.test(url)) {
        const repointed = await rawFetch(url.replace(/\/review-manifest\.json(\?|$)/, '/review-manifest.cm.json$1'), init);
        const type = repointed.headers?.get?.('content-type') ?? '';
        if (repointed.ok && !type.includes('text/html')) return repointed;
      }
    }
    return rawFetch(input, init);
  };
  active = true;
  return true;
}
