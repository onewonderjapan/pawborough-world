// M1 瓦纹测试负例固定（wave13-matdetail R1，审查项 3）：对 out-zone/huxin-ting.glb 做
// 内存变形（不落盘产物，变形件写系统临时目录），断言对应测试真的红——审查实测 R0 的
// 测试在以下变形下仍全绿（假绿），修复后这四条必须各自触发目标断言 FAIL：
//   NEG-A 瓦纹贴图换成纯蓝 PNG   → tests/huxinting-test.mjs     FAIL（瓦纹贴图 解码/中性灰/色彩空间）
//   NEG-B 四块撒头换无贴图灰面   → tests/huxinting-tile-test.mjs FAIL（瓦面图元全部绑定 ht-tile-tex 贴图）
//   NEG-C 下檐瓦面 UV 坡向恒定   → tests/huxinting-tile-test.mjs FAIL（瓦面坡向 V 跨度）
//   NEG-D 下檐瓦面 UV 接缝回绕   → tests/huxinting-tile-test.mjs FAIL（瓦面面级 U 极差）
// 用法：node tests/huxinting-tile-negative-test.mjs（需已构建 OUT_DIR 默认 out-zone 的 huxin-ting.glb）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_PATH = process.env.HUXINTING_GLB
  ? path.resolve(process.env.HUXINTING_GLB)
  : path.join(ROOT, process.env.OUT_DIR || 'out-zone', 'huxin-ting.glb');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}

if (!fs.existsSync(GLB_PATH)) {
  console.log(`FAIL 被测 GLB 不存在：${GLB_PATH}`);
  process.exit(1);
}
const buf = fs.readFileSync(GLB_PATH);
const jsonLen = buf.readUInt32LE(12);
const gj0 = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen;
const bin0 = buf.subarray(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff));

// ---------------- GLB 重打包 / 注入工具 ----------------
function buildGlb(gj, bin) {
  let j = Buffer.from(JSON.stringify(gj), 'utf8');
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const pad = (4 - (bin.length % 4)) % 4;
  const b = bin.length ? Buffer.concat([bin, Buffer.alloc(pad, 0)]) : bin;
  const total = 12 + 8 + j.length + 8 + b.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(j.length, 12); out.write('JSON', 16, 'ascii'); j.copy(out, 20);
  const off = 20 + j.length;
  out.writeUInt32LE(b.length, off); out.write('BIN\0', off + 4, 'ascii'); b.copy(out, off + 8);
  return out;
}
function appendBufferView(gj, bin, bytes) {
  const pad = (4 - (bin.length % 4)) % 4;
  const newBin = Buffer.concat([bin, Buffer.alloc(pad, 0), bytes]);
  gj.bufferViews.push({ buffer: 0, byteOffset: bin.length + pad, byteLength: bytes.length });
  return { bin: newBin, view: gj.bufferViews.length - 1 };
}
// 纯色 PNG（RGBA 8bit 非隔行）
function solidPng(w, h, rgba) {
  const bpp = 4, stride = 1 + w * bpp;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * bpp;
      raw[o] = rgba[0]; raw[o + 1] = rgba[1]; raw[o + 2] = rgba[2]; raw[o + 3] = rgba[3];
    }
  }
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32LE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function clone(gj) { return JSON.parse(JSON.stringify(gj)); }

// 跑测试子进程（变形件 HUXINTING_GLB；OUT_DIR 指空目录，避免读到总装产物）
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-neg-'));
const emptyOut = path.join(tmpBase, 'out');
fs.mkdirSync(emptyOut);
function runTest(script, glbFile) {
  const glbPath = path.join(tmpBase, glbFile);
  fs.writeFileSync(glbPath, glbBuf);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', script)], {
    encoding: 'utf8',
    env: { ...process.env, HUXINTING_GLB: glbPath, OUT_DIR: emptyOut },
    cwd: ROOT,
  });
  // 红日志证据：回显子测试实际触发的 FAIL 行（前 3 条），供 artifacts 负例存档
  for (const line of (r.stdout || '').split('\n')) {
    if (line.startsWith('FAIL')) console.log('  ↳ 子测试', script, '→', line.trim().slice(0, 120));
  }
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
let glbBuf = null;

// ---------------- NEG-A：瓦纹 → 纯蓝 PNG（原测必须红） ----------------
{
  const gj = clone(gj0);
  const { bin, view } = appendBufferView(gj, Buffer.from(bin0), solidPng(128, 128, [0, 0, 255, 255]));
  gj.images.push({ bufferView: view, mimeType: 'image/png', name: 'neg-pure-blue' });
  const texIdx = gj.textures.length;
  gj.textures.push({ source: gj.images.length - 1 });
  const mat = gj.materials.find((m) => m.name === 'ht-tile-tex');
  mat.pbrMetallicRoughness.baseColorTexture.index = texIdx;
  glbBuf = buildGlb(gj, bin);
  const r = runTest('huxinting-test.mjs', 'neg-a.glb');
  const hit = /FAIL[^\n]*瓦纹贴图/.test(r.out);
  ok('NEG-A 纯蓝贴图 → huxinting-test 红（瓦纹贴图解码/中性灰断言）', r.status === 1 && hit,
    `status=${r.status} 瓦纹FAIL=${hit}`);
}

// ---------------- NEG-B：四块撒头换无贴图灰面（瓦面测试必须红） ----------------
{
  const gj = clone(gj0);
  const grey = { name: 'neg-flat-grey', pbrMetallicRoughness: { baseColorFactor: [0.35, 0.35, 0.35, 1], roughnessFactor: 0.9 } };
  gj.materials.push(grey);
  const greyIdx = gj.materials.length - 1;
  let touched = 0;
  for (const m of gj.meshes) {
    if (!/-satou-[we]$/.test(m.name || '')) continue;
    for (const p of m.primitives) { p.material = greyIdx; touched++; }
  }
  glbBuf = buildGlb(gj, Buffer.from(bin0));
  const r = runTest('huxinting-tile-test.mjs', 'neg-b.glb');
  const hit = /FAIL[^\n]*绑定 ht-tile-tex/.test(r.out);
  ok(`NEG-B 撒头 ${touched} 图元换灰面 → huxinting-tile-test 红（贴图绑定断言）`, r.status === 1 && touched === 4 && hit,
    `status=${r.status} touched=${touched} 绑定FAIL=${hit}`);
}

// ---------------- NEG-C：mainroof-lower 坡向 V 恒定（瓦面测试必须红） ----------------
function mutTexcoord(gj2, meshName, fn) {
  const m = gj2.meshes.find((x) => x.name === meshName);
  const p = m.primitives[0];
  const a = gj2.accessors[p.attributes.TEXCOORD_0];
  const bv = gj2.bufferViews[a.bufferView];
  const base = bv.byteOffset + (a.byteOffset || 0);
  const bin2 = Buffer.from(bin0);
  for (let i = 0; i < a.count; i++) {
    const u = bin2.readFloatLE(base + i * 8), v = bin2.readFloatLE(base + i * 8 + 4);
    const [nu, nv] = fn(u, v);
    bin2.writeFloatLE(nu, base + i * 8);
    bin2.writeFloatLE(nv, base + i * 8 + 4);
  }
  return bin2;
}
{
  const gj = clone(gj0);
  const bin = mutTexcoord(gj, 'huxin-ting__mainroof-lower', (u) => [u, 0.5]);
  glbBuf = buildGlb(gj, bin);
  const r = runTest('huxinting-tile-test.mjs', 'neg-c.glb');
  const hit = /FAIL[^\n]*坡向 V 跨度/.test(r.out);
  ok('NEG-C 坡向 V 恒定注入 → huxinting-tile-test 红（坡向跨度断言）', r.status === 1 && hit,
    `status=${r.status} 坡向FAIL=${hit}`);
}

// ---------------- NEG-D：mainroof-lower 接缝回绕（瓦面测试必须红） ----------------
{
  // 模拟 R0 bug 形态：合拢列右边界顶点（接缝拆分副本，U = full_u）改回 U=0，
  // 复现「末列跨回 0、面级 U 极差 ≈ 全周长周期数」的回绕
  const gj = clone(gj0);
  const m = gj.meshes.find((x) => x.name === 'huxin-ting__mainroof-lower');
  const a = gj.accessors[m.primitives[0].attributes.TEXCOORD_0];
  const bv = gj.bufferViews[a.bufferView];
  const base = bv.byteOffset + (a.byteOffset || 0);
  const bin = Buffer.from(bin0);
  let uMax = -Infinity;
  for (let i = 0; i < a.count; i++) uMax = Math.max(uMax, bin.readFloatLE(base + i * 8));
  let nSeam = 0;
  for (let i = 0; i < a.count; i++) {
    if (bin.readFloatLE(base + i * 8) >= uMax - 0.01) { bin.writeFloatLE(0, base + i * 8); nSeam++; }
  }
  glbBuf = buildGlb(gj, bin);
  const r = runTest('huxinting-tile-test.mjs', 'neg-d.glb');
  const hit = /FAIL[^\n]*U 极差/.test(r.out);
  ok(`NEG-D 接缝顶点 U 回 0 注入（${nSeam} 顶点）→ huxinting-tile-test 红（面级 U 极差断言）`, r.status === 1 && nSeam > 0 && hit,
    `status=${r.status} nSeam=${nSeam} 回绕FAIL=${hit}`);
}

// 清理临时目录（变形件不入库）
fs.rmSync(tmpBase, { recursive: true, force: true });

console.log(`RESULT pass=${pass} fail=${fail}`);
if (fail) { failures.forEach((f) => console.log('  -', f)); process.exit(1); }
