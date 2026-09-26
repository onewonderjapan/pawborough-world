// wave9-sharedtex：运行时分区件共用贴图（compress-zones.mjs 之后跑；SHARED_TEX=0 跳过）。
//
// 问题：每个 zone-*.cm.glb 各自内嵌一套贴图，同一内容（同一张砖墙 / 屋面 / 铺地图）被 8–10 个件重复下载
//      （wave9 P1 普查：首载 11 件内嵌 8.88 MB 图，其中 5.76 MB 是重复）。
// 做法（方案 A「外置按内容命名的贴图 + 查看器按 URL 共用」，取舍见工单包 RESULT.json approaches）：
//   1. 普查全部运行时件（manifest 每件的 cm 件）的内嵌图，按 sha256 归并；被 ≥ 2 个件内嵌的内容（SHARED_TEX_ALL=1 时全部）
//      写成 OUT_DIR/tex/<sha256 前 16 位>.<ext>（字节原样，不重编码，所以像素不变）；
//   2. 这些件的 images[i] 改成 { name, uri: 'tex/<hash>.<ext>', mimeType }（name 保留 → three 的 texture.name 不变），
//      删掉图所在 bufferView，BIN 块里其余区段（普通 bufferView 与 EXT_meshopt_compression 压缩流）按原顺序紧排、4 字节对齐，
//      所有 bufferView 下标引用重映射；meshopt 压缩流字节原样搬移，不重压缩；
//   3. 用 gltf-validator（externalResourceFunction 读 tex/）复验，manifest 该件 cm.{bytes,sha256,ratio,validator*,withinCap} 更新，
//      并写 cm.textures（该件引用的外置图 URI）与顶层 textures{uri: {bytes, sha256, mimeType, names, usedBy}}。
// 运行时字节口径（zone-split-test / outer-lazy-check / web/main.js 同一口径）：一组件的下载字节 = Σ 件 GLB 字节 + 这组件引用的外置图并集字节。
// 已外置的件（images 已是 uri）再跑一次不变（幂等）；只改 cm 件，原始 zone-*.glb（步行地面、离线检查、?raw=1 读）不动。
import fs from 'node:fs'; import path from 'node:path';
import { validateBytes } from 'gltf-validator';
import { readGlb, writeGlb, sha256, EXT_OF } from './glb-textures.mjs';

const OUT = path.resolve(process.env.OUT_DIR || 'out');
const ALL = process.env.SHARED_TEX_ALL === '1';
const TEX_DIR = 'tex';
const mp = path.join(OUT, 'zones-manifest.json');
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
const parts = m.zones.filter(z => z.file && z.cm);
fs.mkdirSync(path.join(OUT, TEX_DIR), { recursive: true });

// ---- 1. 普查：内容 → 引用它的件（已外置的 uri 也算，保证重跑时同一口径）
const glbs = new Map();
const users = new Map();   // sha -> Set(file)
for (const z of parts) {
  const f = path.join(OUT, z.cm.file), g = readGlb(f);
  glbs.set(z.cm.file, g);
  (g.json.images || []).forEach(im => {
    let h;
    if (im.bufferView !== undefined) { const bv = g.json.bufferViews[im.bufferView]; h = sha256(g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)); }
    else if (im.uri && im.uri.startsWith(TEX_DIR + '/')) h = sha256(fs.readFileSync(path.join(OUT, im.uri)));
    else return;
    if (!users.has(h)) users.set(h, new Set());
    users.get(h).add(z.cm.file);
  });
}
const shareIt = h => ALL || users.get(h).size >= 2;

// ---- 2. 逐件外置
function align4(n) { return (n + 3) & ~3; }
function remapBufferViews(node, map) {
  if (Array.isArray(node)) { node.forEach(x => remapBufferViews(x, map)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'bufferView' && typeof v === 'number') { if (!map.has(v)) throw new Error('dangling bufferView ' + v); node[k] = map.get(v); }
    else remapBufferViews(v, map);
  }
}
const textures = {};
let removedTotal = 0;
for (const z of parts) {
  const g = glbs.get(z.cm.file), j = g.json;
  const uris = new Set();
  const drop = new Set();
  (j.images || []).forEach(im => {
    if (im.uri && im.uri.startsWith(TEX_DIR + '/')) { uris.add(im.uri); return; }
    if (im.bufferView === undefined) return;
    const bv = j.bufferViews[im.bufferView];
    const bytes = g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const h = sha256(bytes);
    if (!shareIt(h)) return;
    const ext = EXT_OF[im.mimeType];
    if (!ext) throw new Error(`${z.cm.file}: unsupported image mimeType ${im.mimeType}`);
    const uri = `${TEX_DIR}/${h.slice(0, 16)}.${ext}`, dst = path.join(OUT, uri);
    if (fs.existsSync(dst)) { if (sha256(fs.readFileSync(dst)) !== h) throw new Error('hash-prefix collision / stale file ' + dst); }
    else fs.writeFileSync(dst, bytes);
    drop.add(im.bufferView);
    delete im.bufferView;
    im.uri = uri;
    uris.add(uri);
  });
  // 图的 bufferView 只许被图引用（否则不能删）
  const refs = new Map();
  const count = (node) => { if (Array.isArray(node)) node.forEach(count); else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === 'bufferView' && typeof v === 'number') refs.set(v, (refs.get(v) || 0) + 1); else count(v); } };
  count(j);
  for (const d of drop) if (refs.get(d)) throw new Error(`${z.cm.file}: image bufferView ${d} also referenced elsewhere`);
  if (drop.size) {
    // BIN 紧排：buffer 0 上的全部区段（留下的 bufferView + meshopt 压缩流），按原偏移顺序搬
    const segs = [];
    j.bufferViews.forEach((bv, i) => {
      if (drop.has(i)) return;
      if (bv.buffer === 0) segs.push({ off: bv.byteOffset || 0, len: bv.byteLength, set: o => { bv.byteOffset = o; } });
      const mc = bv.extensions && bv.extensions.EXT_meshopt_compression;
      if (mc && mc.buffer === 0) segs.push({ off: mc.byteOffset || 0, len: mc.byteLength, set: o => { mc.byteOffset = o; } });
    });
    segs.sort((a, b) => a.off - b.off);
    const moved = new Map();   // 原 off:len -> 新 off（同一区段被多处引用时共用）
    const chunks = []; let cur = 0, lastEnd = 0;
    for (const s of segs) {
      const key = s.off + ':' + s.len;
      if (!moved.has(key)) {
        if (s.off < lastEnd) throw new Error(`${z.cm.file}: overlapping buffer segments at ${s.off}`);
        const o = align4(cur);
        if (o > cur) chunks.push(Buffer.alloc(o - cur));
        chunks.push(g.bin.subarray(s.off, s.off + s.len));
        cur = o + s.len; lastEnd = s.off + s.len;
        moved.set(key, o);
      }
      s.set(moved.get(key));
    }
    const bin = Buffer.concat(chunks);
    j.buffers[0].byteLength = bin.length;
    // 删 bufferView 并重映射下标
    const map = new Map(); const kept = [];
    j.bufferViews.forEach((bv, i) => { if (!drop.has(i)) { map.set(i, kept.length); kept.push(bv); } });
    j.bufferViews = kept;
    for (const key of Object.keys(j)) if (key !== 'bufferViews') remapBufferViews(j[key], map);
    g.bin = bin;
  }
  const f = path.join(OUT, z.cm.file);
  const out = drop.size ? writeGlb(f, j, g.bin) : fs.readFileSync(f);
  const res = await validateBytes(new Uint8Array(out), {
    uri: z.cm.file,
    externalResourceFunction: u => new Promise((ok, no) => { try { ok(new Uint8Array(fs.readFileSync(path.join(OUT, decodeURIComponent(u))))); } catch (e) { no(e.message); } }),
  });
  const before = z.cm.bytes;
  z.cm.bytes = out.length; z.cm.sha256 = sha256(out); z.cm.ratio = +(out.length / z.bytes).toFixed(3);
  z.cm.validatorErrors = res.issues.numErrors; z.cm.validatorWarnings = res.issues.numWarnings; z.cm.withinCap = out.length <= m.capPerZoneBytes;
  z.cm.textures = [...uris].sort();
  if (drop.size) { z.cm.embeddedBytesBeforeShare = before; removedTotal += before - out.length; }
  if (res.issues.numErrors) console.error('validator errors', z.cm.file, JSON.stringify(res.issues.messages.filter(x => x.severity === 0).slice(0, 3)));
  for (const u of uris) {
    const b = fs.readFileSync(path.join(OUT, u));
    const t = textures[u] || (textures[u] = { bytes: b.length, sha256: sha256(b), mimeType: Object.keys(EXT_OF).find(k => u.endsWith('.' + EXT_OF[k])), names: [], usedBy: [] });
    for (const im of j.images) if (im.uri === u && !t.names.includes(im.name || '')) t.names.push(im.name || '');
    t.usedBy.push(z.cm.file);
  }
  console.log(`${z.cm.file}: ${drop.size} images -> ${TEX_DIR}/, ${before} -> ${out.length} B, refs ${uris.size} shared, err=${res.issues.numErrors} warn=${res.issues.numWarnings}`);
}
m.textures = textures;
m.sharedTextures = { dir: TEX_DIR, rule: ALL ? 'all embedded images' : 'image contents embedded in >= 2 runtime parts', tool: 'scripts/share-textures.mjs',
                     files: Object.keys(textures).length, bytes: Object.values(textures).reduce((s, t) => s + t.bytes, 0),
                     runtimeBytesRule: 'bytes of a set of parts = sum of cm GLB bytes + union of their cm.textures bytes (each shared file downloaded once)' };
m.compression.totalCmBytes = parts.reduce((s, z) => s + z.cm.bytes, 0);
fs.writeFileSync(mp, JSON.stringify(m, null, 1));
const bad = parts.filter(z => z.cm.validatorErrors).length;
console.log(`SHARED_TEX DONE ${m.sharedTextures.files} files ${(m.sharedTextures.bytes / 1e6).toFixed(3)} MB; GLBs shrank ${(removedTotal / 1e6).toFixed(3)} MB`);
process.exit(bad ? 2 : 0);
