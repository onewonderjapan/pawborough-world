// N step 1 — dependency-closure analysis for the closeout compression batch.
// Reads the ACTUAL manifests + blocks (not filename guesses) of the three
// work-order datasets (fangbang-temple-v4, temple-axis-v3, street-props) plus
// street-sidefaces (consumed by the v4 page with ?skins=1), and classifies
// every referenced original GLB:
//
//   hasCm         — a .cm.glb sibling exists with a valid glTF magic
//   missingCm     — no sibling; a compression candidate (only actionable when
//                   the dataset is inside this batch's allowedChanges dirs)
//   missingOrig   — the referenced ORIGINAL is not even on disk (closure break)
//
// Output: artifacts/world-closeout/n-closure.json
// Run: node tools/closeout_cm_closure.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GLTF_MAGIC = Buffer.from([0x67, 0x6c, 0x54, 0x46]); // 'glTF'

// datasets allowedChanges grants NEW derived cm assets/manifests in this batch
const ALLOWED_CM_DIRS = ['world/fangbang-temple-v4', 'world/temple-axis-v3', 'world/street-props'];
const allowedFor = (rel) => ALLOWED_CM_DIRS.some((d) => rel === d || rel.startsWith(d + '/'));

// every JSON a consumer of these datasets actually fetches
const SOURCES = [
  { dataset: 'fangbang-temple-v4', files: ['review-manifest.json', 'blocks.json'] },
  { dataset: 'fangbang-temple-v3', files: ['review-manifest.json'] },
  { dataset: 'temple-axis-v3', files: ['review-manifest.json'] },
  { dataset: 'street-props', files: ['review-manifest.json'] },
  { dataset: 'street-sidefaces', files: ['review-manifest.json'] },
];

function collectGlbRefs(node, out = [], seen = new Set()) {
  if (Array.isArray(node)) { for (const x of node) collectGlbRefs(x, out, seen); return out; }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) {
      if (typeof v === 'string' && v.endsWith('.glb') && !v.endsWith('.cm.glb')) {
        if (!seen.has(v)) { seen.add(v); out.push(v); }
      } else collectGlbRefs(v, out, seen);
    }
  }
  return out;
}

const isGlb = async (p) => {
  try { return (await readFile(p)).subarray(0, 4).equals(GLTF_MAGIC); } catch { return false; }
};

const items = [];
for (const src of SOURCES) {
  for (const file of src.files) {
    const raw = JSON.parse(await readFile(resolve(root, 'world', src.dataset, file), 'utf8'));
    for (const ref of collectGlbRefs(raw)) {
      const rel = ref.replace(/^\.\//, '');
      const origAbs = resolve(root, rel);
      let orig = null;
      try {
        const b = await readFile(origAbs);
        orig = { bytes: b.byteLength, sha256: sha(b), magicOk: b.subarray(0, 4).equals(GLTF_MAGIC) };
      } catch { /* missing */ }
      const cmRel = rel.replace(/\.glb$/, '.cm.glb');
      const cmOk = await isGlb(resolve(root, cmRel));
      items.push({
        dataset: src.dataset, from: file, ref,
        originalRel: rel, original: orig,
        cmRel, cmValidSibling: cmOk,
        state: !orig ? 'missingOrig' : (cmOk ? 'hasCm' : 'missingCm'),
        newCmAllowedInThisBatch: allowedFor(rel),
      });
    }
  }
}

// dedupe across sources (same file referenced by manifest + blocks)
const byKey = new Map();
for (const it of items) {
  const k = it.originalRel;
  if (!byKey.has(k)) byKey.set(k, { ...it, referencedBy: [`${it.dataset}/${it.from}`] });
  else byKey.get(k).referencedBy.push(`${it.dataset}/${it.from}`);
}
const unique = [...byKey.values()].map(({ dataset, from, ...rest }) => rest).sort((a, b) => a.originalRel.localeCompare(b.originalRel));

const summary = {
  total: unique.length,
  missingOrig: unique.filter((i) => i.state === 'missingOrig').length,
  hasCm: unique.filter((i) => i.state === 'hasCm').length,
  missingCm: unique.filter((i) => i.state === 'missingCm').length,
  missingCm_buildable: unique.filter((i) => i.state === 'missingCm' && i.newCmAllowedInThisBatch).length,
  missingCm_policyOriginal: unique.filter((i) => i.state === 'missingCm' && !i.newCmAllowedInThisBatch)
    .map((i) => i.originalRel),
};

const out = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'N step 1 closure',
  generatedAt: new Date().toISOString(),
  allowedCmDirs: ALLOWED_CM_DIRS,
  summary,
  items: unique,
};
await mkdir(resolve(root, 'artifacts/world-closeout'), { recursive: true });
await writeFile(resolve(root, 'artifacts/world-closeout/n-closure.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`CLOSURE total=${summary.total} hasCm=${summary.hasCm} missingCm=${summary.missingCm} (buildable=${summary.missingCm_buildable}) missingOrig=${summary.missingOrig}`);
for (const i of unique.filter((i) => i.state === 'missingCm')) {
  console.log(`  ${i.newCmAllowedInThisBatch ? 'BUILD' : 'KEEP-ORIGINAL(policy)'} ${i.originalRel}`);
}
for (const i of unique.filter((i) => i.state === 'missingOrig')) console.log(`  MISSING-ORIG ${i.originalRel}`);
