// H2 + closeout (20260919): regenerate ONE dataset's review-manifest.cm.json
// from its CURRENT review-manifest.json. tools/build_compressed_dist.mjs
// compresses every world/** GLB in one pass and is the tool that produced the
// committed *.cm.glb assets — but a dataset whose original manifest moved on
// (fangbang-temple-v4 gained the tree, east shops, props across later batches)
// ends up with a STALE cm manifest that would fail the page's integrity
// checks under the now-default compressed state. This tool re-derives the
// cm manifest in place.
//
// Closeout selection gate: a .cm.glb sibling is only repointed when the
// provenance registry (artifacts/world-closeout/cm-provenance.json) records
// it verified AND its recorded sourceSha256 equals the CURRENT original's
// sha256 — so an old variant built from retired source bytes can never be
// selected again (the westshops-strips incident). Anything unverified keeps
// its original bytes and the fallback reason is recorded in
// compressedVariant.fallbacks. No GLB is compressed or written here.
//
// Run: node tools/make_cm_manifest.mjs --dataset fangbang-temple-v4
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const REGISTRY_PATH = resolve(root, 'artifacts/world-closeout/cm-provenance.json');

let registry = { entries: {} };
try { registry = JSON.parse(await readFile(REGISTRY_PATH, 'utf8')); } catch {
  console.error(`provenance registry missing at ${REGISTRY_PATH} — run tools/closeout_cm_install.mjs first; refusing to repoint unverified variants`);
  process.exit(1);
}

const argIdx = process.argv.indexOf('--dataset');
const dataset = argIdx > -1 ? process.argv[argIdx + 1] : null;
if (!dataset) { console.error('usage: node tools/make_cm_manifest.mjs --dataset <id>'); process.exit(1); }

const srcPath = resolve(root, `world/${dataset}/review-manifest.json`);
const outPath = resolve(root, `world/${dataset}/review-manifest.cm.json`);
const tree = JSON.parse(await readFile(srcPath, 'utf8'));

// collect paths first, then rewrite (two passes so repoint decisions are uniform)
function collectPaths(node, out = []) {
  if (Array.isArray(node)) { for (const x of node) collectPaths(x, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && v.endsWith('.glb') && !v.endsWith('.cm.glb')) {
        // *previousFile fields are provenance notes pointing at RETIRED assets
        // — no page fetches them, leave the note byte-identical
        if (/previousfile$/i.test(k)) continue;
        out.push({ node, key: k, value: v });
      } else collectPaths(v, out);
    }
  }
  return out;
}
const glbFields = collectPaths(tree);
const fallbacks = [];
let repointed = 0, kept = 0;
for (const { node, key, value } of glbFields) {
  const cmCandidate = value.replace(/\.glb$/, '.cm.glb');
  const cmAbs = resolve(root, cmCandidate);
  const rel = value.replace(/^\.\//, '');
  let usable = false, reason = null;
  try {
    await access(cmAbs, constants.F_OK);
    const reg = registry.entries[rel];
    if (!reg) reason = 'no provenance registry entry (cm sibling unverified)';
    else if (!reg.verified) reason = `registry marks cm not verified (${reg.failDetail ?? 'failed tolerance'})`;
    else {
      const origBytes = await readFile(resolve(root, rel));
      if (reg.sourceSha256 !== sha(origBytes)) reason = `registry sourceSha256 ${reg.sourceSha256.slice(0, 12)} != current original ${sha(origBytes).slice(0, 12)} (retired variant)`;
      else {
        const cmBytes = await readFile(cmAbs);
        if (reg.outputSha256 && reg.outputSha256 !== sha(cmBytes)) reason = `registry outputSha256 does not match on-disk cm (cm file drifted)`;
        else usable = true;
      }
    }
  } catch { reason = 'no compressed sibling on disk'; }
  if (usable) {
    const b = await readFile(cmAbs);
    node[key] = './' + cmCandidate.replace(/^\.\//, '');
    if ('bytes' in node) node.bytes = b.byteLength;
    if ('sha256' in node) node.sha256 = sha(b);
    repointed += 1;
  } else {
    kept += 1; // stays original — honest fallback
    if (reason && !fallbacks.some((f) => f.path === value && f.reason === reason)) {
      fallbacks.push({ path: value, reason });
    }
  }
}

// gltfpack -kn expands shared texture objects (one per primitive) — mirror the
// WorldLoader image-sharing-ceiling adjustment build_compressed_dist.mjs makes
if (tree.sceneImages?.count) {
  tree.sceneImages = {
    ...tree.sceneImages,
    count: tree.sceneImages.count * 2,
    note: 'doubled for the compressed variant: gltfpack -kn expands shared texture objects (one per primitive)',
  };
}
tree.compressedVariant = {
  note: 'regenerated by tools/make_cm_manifest.mjs from the current review-manifest.json: every .glb field with an on-disk .cm.glb sibling repointed with true bytes/sha256; others stay original',
  selection: 'a sibling is selected only when artifacts/world-closeout/cm-provenance.json records it verified against the CURRENT original sha256 (decode-equivalence or exact-source); retired/unverified variants are never selected',
  gltfpack: 'meshopt + KHR_mesh_quantization (-cc -kn); textures untouched',
  fallbacks,
};
await writeFile(outPath, JSON.stringify(tree, null, 2) + '\n');
console.log(`CM_MANIFEST_READY world/${dataset}/review-manifest.cm.json repointed=${repointed} keptOriginal=${kept} fallbackReasons=${fallbacks.length}`);
