// C4 — compressed dist variant (tools/build_compressed_dist.mjs).
// Per the N4 lab conclusion (meshopt-geometry is the practical tier; KTX2
// showed no byte advantage and UASTC bloat), every world/** and building/**
// GLB is compressed with the N4 gltfpack build (`-cc` meshopt + quantization,
// `-kn` keeps named nodes — the page's walkable-ground extraction and
// resource accounting depend on node names). Outputs land in
// dist-compressed/: the original dist PLUS `*.cm.glb` next to each `*.glb`
// and `review-manifest.cm.json` next to byte-checked manifests (every glb
// path/bytes/sha256 field rewritten to the compressed reality, so the page's
// integrity checks stay true). The page enters the variant with
// ?compressed=1 (default off); the ORIGINAL dist is left untouched.
//
// Run: node tools/build_compressed_dist.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, copyFile, access } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GLTFPACK = process.env.GLTFPACK
  ?? '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack';

async function walk(dir, filter) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, filter));
    else if (filter(e.name)) out.push(p);
  }
  return out;
}

// 1. compress every GLB under world/ and building/ to <name>.cm.glb
//    (idempotent: inputs ending in .cm.glb are previous outputs, skip them)
const glbs = [
  ...await walk(resolve(root, 'world'), (n) => n.endsWith('.glb') && !n.endsWith('.cm.glb')),
  ...await walk(resolve(root, 'building'), (n) => n.endsWith('.glb') && !n.endsWith('.cm.glb')),
].sort();
// GLBs carrying walkable-ground node names feed the page's name-based ground
// extraction (GROUND_NODE_RE): quantized output re-parents meshes under
// unnamed dequant nodes, which breaks that contract — so those get floating-
// point positions (+14-bit UVs) which keep meshes attached to named nodes.
const GROUND_PREFIX_RE = /^(street-kit__|sctail__|laneb__|temple-ground__)/;
async function glbHasGroundNames(path) {
  const buf = await readFile(path);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return (gltf.nodes ?? []).some((n) => n.name && GROUND_PREFIX_RE.test(n.name));
}

const rows = [];
let origTotal = 0, cmTotal = 0, failed = 0;
for (const glb of glbs) {
  const outGlb = glb.replace(/\.glb$/, '.cm.glb');
  try {
    const ground = await glbHasGroundNames(glb);
    const modeArgs = ground ? ['-vpf', '-vt', '14'] : [];
    execFileSync(GLTFPACK, ['-cc', '-kn', ...modeArgs, '-i', glb, '-o', outGlb], { stdio: 'pipe' });
    const a = (await readFile(glb)).byteLength;
    const b = (await readFile(outGlb)).byteLength;
    origTotal += a; cmTotal += b;
    rows.push({ file: relative(root, glb).split('\\').join('/'), original: a, compressed: b,
                ratio: +(b / a).toFixed(3), mode: ground ? 'vpf-vt14 (ground names)' : 'quantized' });
  } catch (e) {
    failed += 1;
    rows.push({ file: relative(root, glb).split('\\').join('/'), error: String(e.message).slice(0, 200) });
  }
  process.stdout.write(`\r${rows.length}/${glbs.length}`);
}
process.stdout.write('\n');
if (failed > 0) console.log(`WARNING: ${failed} GLBs failed to compress (left as original only)`);

// 2. rewrite byte-checked manifests into *.cm.json (recursive: every glb
//    path field gets .cm + the compressed bytes/sha256)
async function cmPathFor(glbRel) {
  const abs = resolve(root, glbRel);
  try { await access(abs.replace(/\.glb$/, '.cm.glb')); return glbRel.replace(/\.glb$/, '.cm.glb'); }
  catch { return null; }
}
function rewrite(node) {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && v.endsWith('.glb') && !v.endsWith('.cm.glb')) {
        out[k] = null; // placeholder; fill after async lookup
        out[`__pending_${k}`] = v;
      } else {
        out[k] = rewrite(v);
      }
    }
    return out;
  }
  return node;
}
const MANIFESTS = ['world/fangbang-temple-v3/review-manifest.json', 'world/street-sidefaces/review-manifest.json'];
for (const mf of MANIFESTS) {
  const raw = JSON.parse(await readFile(resolve(root, mf), 'utf8'));
  const tree = rewrite(raw);
  const resolvePending = async (node) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('__pending_')) {
        const realKey = k.slice('__pending_'.length);
        const cmRel = await cmPathFor(v);
        if (cmRel) {
          const b = await readFile(resolve(root, cmRel));
          node[realKey] = './' + cmRel;
          if ('bytes' in node) node.bytes = b.byteLength;
          if ('sha256' in node) node.sha256 = sha(b);
        } else {
          node[realKey] = v; // uncompressed fallback — flags stay honest
        }
        delete node[k];
      } else if (node[k] && typeof node[k] === 'object') {
        await resolvePending(node[k]);
      }
    }
  };
  await resolvePending(tree);
  // gltfpack -kn keeps every named node and expands shared texture objects
  // (one per primitive) — WorldLoader's image-sharing ceiling reads
  // sceneImages.count, so double it for the compressed reality and say why
  if (tree.sceneImages?.count) {
    tree.sceneImages = {
      ...tree.sceneImages,
      count: tree.sceneImages.count * 2,
      note: 'doubled for the compressed variant: gltfpack -kn expands shared texture objects (one per primitive)',
    };
  }
  tree.compressedVariant = {
    note: 'auto-generated by tools/build_compressed_dist.mjs: every .glb field repointed to .cm.glb with its true bytes/sha256 (meshopt -cc -kn per N4)',
    gltfpack: 'meshopt + KHR_mesh_quantization (-cc -kn); textures untouched',
  };
  const outP = resolve(root, mf.replace(/\.json$/, '.cm.json'));
  await mkdir(dirname(outP), { recursive: true });
  await writeFile(outP, JSON.stringify(tree, null, 2) + '\n');
}

// 3. dist-compressed/ = the built dist + all cm artifacts (original dist untouched)
const dist = resolve(root, 'dist');
const distC = resolve(root, 'dist-compressed');
const cmFiles = [
  ...await walk(resolve(root, 'world'), (n) => n.endsWith('.cm.glb') || n.endsWith('.cm.json')),
  ...await walk(resolve(root, 'building'), (n) => n.endsWith('.cm.glb')),
];
await mkdir(distC, { recursive: true });
await execFileSync('cp', ['-r', `${dist}/.`, `${distC}/`]);
for (const p of cmFiles) {
  const rel = relative(root, p);
  const dst = resolve(distC, rel);
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(p, dst);
}

// 4. report
const report = {
  tool: 'tools/build_compressed_dist.mjs',
  codec: `gltfpack (N4 toolchain aarch64) -cc -kn: EXT_meshopt_compression + KHR_mesh_quantization; node names kept; textures untouched (N4: KTX2 no byte advantage, UASTC +188%)`,
  glbCount: glbs.length, failures: failed,
  originalBytes: origTotal, compressedBytes: cmTotal,
  ratio: +(cmTotal / origTotal).toFixed(3),
  budget: { compressedDistBytesMax: '0.6 of original', pass: cmTotal / origTotal <= 0.6 },
  perFile: rows,
  distCompressed: 'dist-compressed/ (original dist + *.cm.glb + review-manifest.cm.json; enter with ?compressed=1)',
};
await writeFile(resolve(root, 'artifacts/v1-candidate/compressed-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`COMPRESSED_DIST_READY glbs=${glbs.length} failures=${failed} ${origTotal} -> ${cmTotal} bytes (ratio ${report.ratio}, budget pass=${report.budget.pass})`);
