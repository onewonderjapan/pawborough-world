// wave9-sharedtex P1：运行时分区件（zones-manifest.json 里每件的 cm 件，无 cm 时原始件）贴图普查。
// 按内容 sha256 归并：每张图被几个件引用 / 内嵌，内嵌重复字节（同一内容被第 2、3…个件再次内嵌的字节），按加载策略分组。
// 外置贴图（share-textures.mjs 之后 images[].uri = tex/<sha>.<ext>）按文件内容计，同一 URL 只算一次下载。
// 用法：OUT_DIR=out-zone node scripts/texture-census.mjs [--out <json>]
import fs from 'node:fs'; import path from 'node:path';
import { readGlb, glbImages, imageDims, sha256 } from './glb-textures.mjs';

const OUT = path.resolve(process.env.OUT_DIR || 'out');
const argOut = process.argv.indexOf('--out');
const outFile = argOut > 0 ? path.resolve(process.argv[argOut + 1]) : null;
const m = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const policyOf = z => z.loadPolicy || 'first-load';
const parts = m.zones.filter(z => z.file).map(z => ({ z, file: z.cm ? z.cm.file : z.file, policy: policyOf(z) }));

const byHash = new Map();
const perPart = [];
for (const p of parts) {
  const g = readGlb(path.join(OUT, p.file));
  const imgs = glbImages(path.join(OUT, p.file), g);
  let embeddedBytes = 0, externalRefs = 0;
  for (const im of imgs) {
    if (!im.bytes) throw new Error(`image ${im.index} of ${p.file} unreadable (${im.uri})`);
    const h = sha256(im.bytes);
    if (!byHash.has(h)) byHash.set(h, { sha256: h, names: new Set(), mimeType: im.mimeType, dims: imageDims(im.bytes), bytes: im.bytes.length, parts: [], embeddedIn: [], uris: new Set(), policies: new Set() });
    const e = byHash.get(h);
    e.names.add(im.name); e.parts.push(p.file); e.policies.add(p.policy);
    if (im.embedded) { e.embeddedIn.push(p.file); embeddedBytes += im.bytes.length; } else { e.uris.add(im.uri); externalRefs++; }
  }
  perPart.push({ file: p.file, id: p.z.id, part: p.z.part ?? null, policy: p.policy, glbBytes: g.bytes, images: imgs.length, embeddedImageBytes: embeddedBytes, externalImageRefs: externalRefs });
}

// 下载口径：内嵌 = 每个内嵌它的件各下载一次；外置 = 每个不同 URL 下载一次（viewer 端同 URL 共用一次请求，见 web/shared-textures.js）
const downloadsOf = (e, pol) => {
  const emb = e.embeddedIn.filter(f => !pol || parts.find(p => p.file === f).policy === pol).length;
  return emb + e.uris.size;
};
const textures = [...byHash.values()].map(e => ({
  sha256: e.sha256, names: [...e.names].sort(), mimeType: e.mimeType, width: e.dims?.[0] ?? null, height: e.dims?.[1] ?? null, bytes: e.bytes,
  partCount: new Set(e.parts).size, parts: [...new Set(e.parts)], embeddedIn: e.embeddedIn, externalUris: [...e.uris], policies: [...e.policies].sort(),
  downloads: downloadsOf(e), duplicateBytes: e.bytes * Math.max(0, downloadsOf(e) - 1),
})).sort((a, b) => b.duplicateBytes - a.duplicateBytes || b.bytes - a.bytes);

// 首载内部 / 首载 + deferred / 全部 的重复字节（同一内容多下载的字节）
function dupWithin(pols) {
  let dup = 0, total = 0, unique = 0;
  for (const e of byHash.values()) {
    const emb = e.embeddedIn.filter(f => pols.includes(parts.find(p => p.file === f).policy)).length;
    const ext = [...e.uris].filter(u => e.parts.some(f => pols.includes(parts.find(p => p.file === f).policy))).length;
    const n = emb + ext;
    if (!n) continue;
    total += e.bytes * n; unique += e.bytes; dup += e.bytes * (n - 1);
  }
  return { downloadedImageBytes: total, uniqueImageBytes: unique, duplicateBytes: dup };
}
// 「名 + 尺寸」口径（wave7 估算用的键）与内容哈希口径是否一致
const nameKey = new Map();
for (const e of byHash.values()) for (const n of e.names) {
  const k = `${n.replace(/\.\d{3}$/, '')}|${e.dims ? e.dims.join('x') : '?'}`;
  if (!nameKey.has(k)) nameKey.set(k, new Set());
  nameKey.get(k).add(e.sha256);
}
const nameSizeCollisions = [...nameKey.entries()].filter(([, s]) => s.size > 1).map(([k, s]) => ({ key: k, distinctContents: s.size }));

const totals = {
  parts: parts.length,
  imageRefs: [...byHash.values()].reduce((s, e) => s + e.parts.length, 0),
  uniqueContents: byHash.size,
  sharedContents: textures.filter(t => t.partCount > 1).length,
  embeddedRefs: [...byHash.values()].reduce((s, e) => s + e.embeddedIn.length, 0),
  externalFiles: new Set([...byHash.values()].flatMap(e => [...e.uris])).size,
  all: dupWithin(['first-load', 'deferred', 'on-demand']),
  firstLoad: dupWithin(['first-load']),
  firstLoadPlusDeferred: dupWithin(['first-load', 'deferred']),
  onDemand: dupWithin(['on-demand']),
  nameSizeKeyCollisions: nameSizeCollisions.length,
};
const report = { schema: 1, generatedBy: 'scripts/texture-census.mjs', outDir: path.relative(process.cwd(), OUT) || '.', basis: 'runtime parts = manifest cm file (raw file if no cm); content key = sha256 of image bytes; downloads = embedded copies + distinct external URLs', totals, perPart, textures, nameSizeCollisions };
if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(report, null, 1)); }
const mb = b => (b / 1e6).toFixed(3) + ' MB';
console.log(`CENSUS ${totals.parts} parts, ${totals.imageRefs} image refs, ${totals.uniqueContents} unique contents (${totals.sharedContents} in >1 part), external files ${totals.externalFiles}`);
console.log(`  all: downloaded ${mb(totals.all.downloadedImageBytes)} unique ${mb(totals.all.uniqueImageBytes)} duplicate ${mb(totals.all.duplicateBytes)}`);
console.log(`  first-load: downloaded ${mb(totals.firstLoad.downloadedImageBytes)} unique ${mb(totals.firstLoad.uniqueImageBytes)} duplicate ${mb(totals.firstLoad.duplicateBytes)}`);
console.log(`  first-load+deferred duplicate ${mb(totals.firstLoadPlusDeferred.duplicateBytes)}; on-demand duplicate ${mb(totals.onDemand.duplicateBytes)}; name+size collisions ${totals.nameSizeKeyCollisions}`);
