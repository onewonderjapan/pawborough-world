// world-playable-night 20260920 — gallery provenance manifest generator.
// Hashes every image / reopenable source the homepage gallery cites, so the
// "来自游戏实景" captions and the portable package can be checked against the
// real bytes. Rerunnable; output is imported by the page (display) and by the
// package builder (verification).
//
// Run: node tools/playable_package_gallery_manifest.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const IMAGES = {
  mainStreet: { path: 'artifacts/world-playable/captures/main-street.png',
    from: '本批实拍：fangbang.html?ds=fangbang-temple-v7 页面 junction-west 机位（canvas原图）' },
  templeFront: { path: 'artifacts/world-playable/captures/temple-front.png',
    from: '本批实拍：同页 shanmen-from-road 机位（canvas原图）' },
  laneA: { path: 'artifacts/world-playable/captures/lane-a-mouth.png',
    from: '本批实拍：同页 lane-a-street-look-in 机位（canvas原图）；A弄GLB自v6起逐字节沿用，经哈希核对' },
  laneB: { path: 'artifacts/world-playable/captures/lane-b-mouth.png',
    from: '本批实拍：同页 lane-b-street-look-in 机位（canvas原图，v7候选资产）' },
  laneABefore: { path: 'artifacts/lane-a-polish/before/street-mouth.png',
    from: 'A弄精修施工前（上一版，lane-a-polish批交付图）' },
  laneBAfterEvidence: { path: 'artifacts/lane-b-polish/after/street-mouth.png',
    from: 'B弄精修后（v7候选交付图，上游证据留档）' },
  laneBBefore: { path: 'artifacts/lane-b-polish/before/street-mouth.png',
    from: 'B弄精修施工前（v6，lane-b-polish批交付图）' },
};

// reopenable Blender sources cited in 制作资料 (stay in the workspace; NOT in
// the web package — the package README says so explicitly)
const SOURCES = {
  'world/lane-b-polish/review/scene.blend': 'B弄审查场景（含S04/S05/S07 context，默认相机street-mouth）',
  'world/lane-b-polish/lane-b/model.blend': 'B弄弄身源工程',
  'world/lane-b-polish/interfaces/model.blend': '两弄街口接口源工程（A段与v6逐字节相同）',
  'world/lane-a-polish/lane-a/model.blend': 'A弄弄身源工程（v6，历史状态如实引用）',
};

const out = { generatedAt: new Date().toISOString(), images: {}, sources: {} };
let missing = [];
for (const [id, m] of Object.entries(IMAGES)) {
  try { const b = await readFile(resolve(root, m.path));
    out.images[id] = { path: m.path, bytes: b.length, sha256: sha(b), from: m.from }; }
  catch { missing.push(m.path); }
}
for (const [p, note] of Object.entries(SOURCES)) {
  try { const b = await readFile(resolve(root, p));
    out.sources[p] = { bytes: b.length, sha256: sha(b), note }; }
  catch { missing.push(p); }
}
if (missing.length) { console.error('GALLERY_MANIFEST_MISSING', missing); process.exit(1); }
const dst = resolve(root, 'src/worldPreview/galleryManifest.json');
await writeFile(dst, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`GALLERY_MANIFEST_OK ${Object.keys(out.images).length} images, ${Object.keys(out.sources).length} sources`);
