// wave9-sharedtex：运行时分区件贴图「同内容只下载一次」静态契约（manifest + 磁盘文件口径；浏览器实测口径见 tests/shared-texture-browser-check.mjs）。
// 期望值一律从磁盘上的 GLB / 贴图文件现算（manifest 只作被核对对象），不 import 实现（scripts/share-textures.mjs）。
//   T1 每个运行时件（manifest 每件的 cm 件）的每张图都能取到字节：内嵌 bufferView，或 uri 指向 OUT_DIR 下存在的文件；
//   T2 同一图内容（sha256）在全部运行时件里只对应一个下载单元：内嵌副本数 + 不同外置 URL 数 ≤ 1（改前：37 种内容被 2–10 个件各嵌一份，失败）；
//   T3 外置图文件名 = 内容 sha256 前 16 位（内容寻址，可 immutable 缓存），manifest textures{} 的 bytes / sha256 与文件一致，
//      每件 cm.textures == 该 GLB 实际引用的外置 URI 集合；cm.bytes / cm.sha256 与磁盘件一致；
//   T4 首载（loadPolicy 既非 deferred 也非 on-demand 的件）运行时字节 = Σ GLB 文件字节 + 引用外置图并集字节 ≤ 20 MB；
//   T5（给 SHARED_TEX_BASE_OUT = 改前产物目录时）：
//     a 跨重建：逐件比改前/改后的图顺序、名字、内容 sha（贴图来自输入资源，跨重建必须稳定）；
//     b 同输入无损：把改前产物复制到临时目录、只跑共享贴图步骤，比较转换前后的图像内容、
//       去 buffers/bufferViews/images 存储 JSON、每段 meshopt 字节流——全部 cm 分区（含 pond）；
//       另对转换结果做三种真实破坏（改节点平移 / 改流 1 字节 / 丢图），证明比对抓得住；
//     c 首载下降 ≥ 0.3 MB。
// 用法：OUT_DIR=out-zone [SHARED_TEX_BASE_OUT=<改前 out 目录>] node tests/shared-texture-test.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.SHARED_TEX_BASE_OUT ? path.resolve(ROOT, process.env.SHARED_TEX_BASE_OUT) : null;
const FIRST_LOAD_CAP = 20000000, MIN_DROP = 300000;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) pass++; else { fail++; console.error('FAIL', m); } if (c && process.env.VERBOSE) console.log('PASS', m); return c; };

function glb(file) {
  const buf = fs.readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const o = 20 + jl;
  const bin = o + 8 <= buf.length ? buf.subarray(o + 8, o + 8 + buf.readUInt32LE(o)) : Buffer.alloc(0);
  return { json, bin, bytes: buf.length, sha: sha(buf) };
}
function images(dir, g) {
  return (g.json.images || []).map(im => {
    if (im.bufferView !== undefined) { const bv = g.json.bufferViews[im.bufferView]; return { name: im.name || '', embedded: true, bytes: g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) }; }
    const p = im.uri ? path.join(dir, decodeURIComponent(im.uri)) : null;
    return { name: im.name || '', embedded: false, uri: im.uri, bytes: p && fs.existsSync(p) ? fs.readFileSync(p) : null };
  });
}
function manifest(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'zones-manifest.json'), 'utf8')); }
const ia0 = (dir, g) => images(dir, g).map(i => `${i.name}:${i.bytes ? sha(i.bytes) : 'missing'}`);
const POL = new Set(['deferred', 'on-demand']);
// 一组件的运行时下载字节（磁盘口径）：GLB 文件字节 + 外置图（不同 URL）字节并集
function runtimeBytes(dir, zs) {
  let s = 0; const seen = new Set();
  for (const z of zs) {
    const f = path.join(dir, z.cm ? z.cm.file : z.file);
    s += fs.statSync(f).size;
    for (const im of images(dir, glb(f))) if (!im.embedded && im.uri && !seen.has(im.uri)) { seen.add(im.uri); s += im.bytes ? im.bytes.length : 0; }
  }
  return s;
}

const m = manifest(OUT);
const parts = m.zones.filter(z => z.file);
const units = new Map();   // content sha -> { embedded: [file], uris: Set }
const parsed = new Map();
for (const z of parts) {
  const file = z.cm ? z.cm.file : z.file;
  const g = glb(path.join(OUT, file));
  parsed.set(file, g);
  const imgs = images(OUT, g);
  ok(`T1 ${file}: ${imgs.length} 张图全部可取（缺 ${imgs.filter(i => !i.bytes).map(i => i.uri).join(',') || '无'}）`, imgs.every(i => i.bytes));
  for (const im of imgs.filter(i => i.bytes)) {
    const h = sha(im.bytes);
    if (!units.has(h)) units.set(h, { names: new Set(), embedded: [], uris: new Set() });
    const u = units.get(h); u.names.add(im.name);
    if (im.embedded) u.embedded.push(file); else u.uris.add(im.uri);
  }
  if (z.cm) {
    ok(`T3 ${file}: manifest cm.bytes ${z.cm.bytes} == 磁盘 ${g.bytes}`, z.cm.bytes === g.bytes);
    ok(`T3 ${file}: manifest cm.sha256 == 磁盘`, z.cm.sha256 === g.sha);
    const refd = [...new Set(imgs.filter(i => !i.embedded).map(i => i.uri))].sort();
    ok(`T3 ${file}: cm.textures [${(z.cm.textures || []).length}] == GLB 引用外置 URI [${refd.length}]`, JSON.stringify((z.cm.textures || []).slice().sort()) === JSON.stringify(refd));
  }
}
const multi = [...units.entries()].filter(([, u]) => u.embedded.length + u.uris.size > 1);
ok(`T2 同内容贴图只对应一个下载单元：${units.size} 种内容，多份下载的 ${multi.length} 种` +
   (multi.length ? `（例 ${multi.slice(0, 4).map(([h, u]) => `${[...u.names][0]}×${u.embedded.length + u.uris.size}`).join('、')}）` : ''), multi.length === 0);
// T3 外置文件：内容寻址 + manifest 登记一致
const extUris = new Set([...units.values()].flatMap(u => [...u.uris]));
for (const u of extUris) {
  const b = fs.readFileSync(path.join(OUT, u)), h = sha(b);
  ok(`T3 ${u}: 文件名 = sha256 前 16 位（${h.slice(0, 16)}）`, path.basename(u).split('.')[0] === h.slice(0, 16));
  const t = (m.textures || {})[u];
  ok(`T3 ${u}: manifest textures 登记 bytes/sha256 与文件一致`, !!t && t.bytes === b.length && t.sha256 === h);
}
ok(`T3 manifest textures ${Object.keys(m.textures || {}).length} 项 == 实际引用 ${extUris.size} 项`, Object.keys(m.textures || {}).length === extUris.size);
// T4 首载 ≤ 20 MB（运行时口径，含外置图）
const first = parts.filter(z => !POL.has(z.loadPolicy));
const firstBytes = runtimeBytes(OUT, first);
ok(`T4 首载 ${first.length} 件运行时 ${firstBytes} B（${(firstBytes / 1e6).toFixed(3)} MB，含外置图）≤ ${FIRST_LOAD_CAP / 1e6} MB`, firstBytes <= FIRST_LOAD_CAP);
const totalBytes = runtimeBytes(OUT, parts);
console.log(`REPORT 首载 ${firstBytes} B；deferred+on-demand 增量 ${totalBytes - firstBytes} B；全部运行时 ${totalBytes} B；外置图 ${extUris.size} 个`);

// T5 与改前产物逐件比
if (BASE && fs.existsSync(path.join(BASE, 'zones-manifest.json'))) {
  const bm = manifest(BASE);
  // bufferView 下标会因删掉图的 bufferView 而重排：访问器里的 bufferView 下标换成该 bufferView 的描述（去掉偏移）再比
  const bvDesc = (j, i) => { const bv = j.bufferViews[i]; const mc = bv.extensions?.EXT_meshopt_compression;
    return { buffer: bv.buffer, byteLength: bv.byteLength, byteStride: bv.byteStride, target: bv.target, mc: mc && { buffer: mc.buffer, byteLength: mc.byteLength, byteStride: mc.byteStride, mode: mc.mode, filter: mc.filter, count: mc.count } }; };
  const strip = j => { const c = JSON.parse(JSON.stringify(j));
    for (const a of c.accessors || []) { if (a.bufferView !== undefined) a.bufferView = bvDesc(j, a.bufferView);
      if (a.sparse) { a.sparse.indices.bufferView = bvDesc(j, a.sparse.indices.bufferView); a.sparse.values.bufferView = bvDesc(j, a.sparse.values.bufferView); } }
    delete c.buffers; delete c.bufferViews; delete c.images; return JSON.stringify(c); };
  const streams = g => g.json.bufferViews.map(bv => bv.extensions?.EXT_meshopt_compression).filter(Boolean)
    .map(mc => sha(g.bin.subarray(mc.byteOffset || 0, (mc.byteOffset || 0) + mc.byteLength)));
  // T5a 跨重建贴图一致性：贴图内容来自输入资源，跨重建必须逐字节稳定
  for (const z of parts.filter(z => z.cm)) {
    const bz = bm.zones.find(x => x.file === z.file);
    if (!ok(`T5 ${z.cm.file}: 改前产物有同名件`, !!(bz && bz.cm))) continue;
    const a = glb(path.join(BASE, bz.cm.file)), b = parsed.get(z.cm.file);
    const ia = images(BASE, a).map(i => `${i.name}:${sha(i.bytes)}`), ib = images(OUT, b).map(i => `${i.name}:${i.bytes ? sha(i.bytes) : 'missing'}`);
    ok(`T5 ${z.cm.file}: ${ib.length} 张图顺序 / 名字 / 内容与改前全同`, JSON.stringify(ia) === JSON.stringify(ib));
  }
  // T5b 几何 / 压缩流无损证明必须在【同一份未共享的压缩 GLB】上做：跨重建的原始件哈希差异（上游 Blender
  // 构建非逐字节确定，如 huxin-ting）不能作为豁免任何比对的理由。把改前产物复制到临时目录，只跑共享贴图
  // 步骤，比较转换前后的图像内容、去存储字段 JSON、每段 meshopt 字节流——输入相同，任何差异都是共享步骤的错。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharedtex-lossless-'));
  fs.copyFileSync(path.join(BASE, 'zones-manifest.json'), path.join(tmp, 'zones-manifest.json'));
  for (const bz of bm.zones.filter(z => z.cm)) fs.copyFileSync(path.join(BASE, bz.cm.file), path.join(tmp, bz.cm.file));
  const sp = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'share-textures.mjs')], { cwd: ROOT, env: { ...process.env, OUT_DIR: tmp }, encoding: 'utf8' });
  ok(`T5-lossless 复制件上只跑共享贴图步骤 EXIT 0（${sp.status}）`, sp.status === 0);
  if (sp.status !== 0) console.error(sp.stdout, sp.stderr);
  const covered = [];
  for (const bz of bm.zones.filter(z => z.cm)) {
    const a = glb(path.join(BASE, bz.cm.file)), b = glb(path.join(tmp, bz.cm.file));
    const ia = images(BASE, a).map(i => `${i.name}:${sha(i.bytes)}`), ib = images(tmp, b).map(i => `${i.name}:${i.bytes ? sha(i.bytes) : 'missing'}`);
    ok(`T5-lossless ${bz.cm.file}: ${ib.length} 张图转换前后内容全同`, JSON.stringify(ia) === JSON.stringify(ib));
    ok(`T5-lossless ${bz.cm.file}: 除 buffers/bufferViews/images 外 JSON 转换前后全同（几何 / 材质 / 节点 / 采样器）`, strip(a.json) === strip(b.json));
    ok(`T5-lossless ${bz.cm.file}: meshopt 压缩流 ${streams(b).length} 段字节转换前后全同`, JSON.stringify(streams(a)) === JSON.stringify(streams(b)));
    covered.push(bz.cm.file);
  }
  ok(`T5-lossless 覆盖改前产物全部 ${covered.length} 件 cm 分区（${covered.includes('zone-pond.cm.glb') ? '含 zone-pond' : '该产物无 zone-pond 件'}）`, covered.length > 0);
  // T5-negative：对同一份转换结果做三种真实破坏（改几何 / 改压缩流 / 丢图），证明上面的比对抓得住
  {
    const pick = covered.find(f => f.includes('pond')) || covered[0];
    const a = glb(path.join(BASE, pick)), b = glb(path.join(tmp, pick));
    const j1 = JSON.parse(JSON.stringify(b.json));
    const nd = (j1.nodes || []).find(n => n.translation);
    if (nd) nd.translation[0] += 0.5; else if (j1.meshes && j1.meshes[0]) j1.meshes[0].name = (j1.meshes[0].name || '') + '-tampered';
    ok(`T5-negative ${pick}: 改节点平移 → JSON 比对必须报不同`, strip(a.json) !== strip(j1));
    const mc = b.json.bufferViews.map(bv => bv.extensions?.EXT_meshopt_compression).find(Boolean);
    if (mc && mc.byteLength > 0) {
      const bin2 = Buffer.from(b.bin); bin2[mc.byteOffset] ^= 0xff;
      ok(`T5-negative ${pick}: 改 meshopt 流 1 字节 → 流比对必须报不同`, JSON.stringify(streams(a)) !== JSON.stringify(streams({ json: b.json, bin: bin2 })));
    }
    const j3 = JSON.parse(JSON.stringify(b.json)); j3.images.pop();
    ok(`T5-negative ${pick}: 丢一张图 → 图像比对必须报不同`, JSON.stringify(ia0(BASE, a)) !== JSON.stringify(ia0(tmp, { json: j3, bin: b.bin })));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const bFirst = runtimeBytes(BASE, bm.zones.filter(z => z.file && !POL.has(z.loadPolicy)));
  const bTotal = runtimeBytes(BASE, bm.zones.filter(z => z.file));
  ok(`T5 首载 ${bFirst} → ${firstBytes} B，降 ${((bFirst - firstBytes) / 1e6).toFixed(3)} MB ≥ ${MIN_DROP / 1e6} MB`, bFirst - firstBytes >= MIN_DROP);
  console.log(`REPORT 改前 首载 ${bFirst} B 全部 ${bTotal} B → 改后 首载 ${firstBytes} B 全部 ${totalBytes} B`);
} else console.log('SKIP T5（未给 SHARED_TEX_BASE_OUT）');
console.log(`shared-texture-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
