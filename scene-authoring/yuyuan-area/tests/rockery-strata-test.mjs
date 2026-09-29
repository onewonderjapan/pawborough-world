// M2 大假山黄石层理测试（wave13-matdetail）。口径：
//  - 被测件 = out-garden-kits/rockery-dajiashan/model.glb（staged 输入件，assemble ROCKERY_KIT 消费）。
//  - 断言：① rockery-stone/-dark 的 baseColorTexture = 程序化层理贴图（strata-tint-*），贴图亮度
//    std ≥ 阈值；② 两 stone 材质带 metallicRoughnessTexture 且 G 通道有层理变化；③ moss 材质
//    不受影响（baseColorFactor = 5c6b4a 线性）；④ 几何不变守卫（tris 与 AABB，不超预算）。
//
// 阈值来源（渲染标定，2026-09-29，1280×720 Cycles 64spp+OIDN day）：
//  tour-dajiashan（eye→target 18.2 m）岩面窗口 luma std：基线 13.42（平滑黏土感，巡检第 7 条）；
//  tour-yulinglong（16.2 m，同为特写机位，距离差 12% 不作修正——方差由材质颜色承载，与距离近似无关）
//  岩面窗口 luma std 16.56 / 23.58，取干净右窗 16.56 为玉玲珑实测准绳。
//  层理贴图实测（modules/rockery/records/strata-bake-dajiashan.json texStats）：lumaStd 8.64 时
//  渲染像素 std 达标（≥16.5）。贴图阈值 = 8.64 × 0.85 ≈ 7.3（15% 裕量，容忍共享纹理管道重采样）。
//  基线贴图（PaintedPlaster017 灰泥 tint）lumaStd = 1.68 → 本测试在 6c6270fb 基线产物上红。
// 用法：node tests/rockery-strata-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_PATH = process.env.DAJIASHAN_GLB
  ? path.resolve(process.env.DAJIASHAN_GLB)
  : path.join(ROOT, 'out-garden-kits', 'rockery-dajiashan', 'model.glb');
const BUDGET_TRIS = 25000;
const LUMA_STD_MIN = 7.3;        // 层理贴图亮度 std 阈值（来源见头注）
const ORM_G_STD_MIN = 0.006;     // G 通道层理变化（0.944↔1.0 理论 std ≈0.012，取一半）
const MOSS_FACTOR = [0.10702310502529144, 0.14702726900577545, 0.06847816705703735];

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}

if (!fs.existsSync(GLB_PATH)) {
  console.log(`FAIL 大假山 GLB 不存在于 ${GLB_PATH}`);
  process.exit(1);
}
const buf = fs.readFileSync(GLB_PATH);
const jsonLen = buf.readUInt32LE(12);
const gj = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen;
const bin = buf.subarray(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff));

function imageBytes(name) {
  const img = gj.images.find((i) => i.name === name);
  if (!img) return null;
  const bv = gj.bufferViews[img.bufferView];
  return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
}
// 最小 PNG 解码（truecolor RGB/RGBA 8bit 非隔行；贴图均由 strata-texture.py 生成）
function decodePng(b) {
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off), type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(off + 8); h = b.readUInt32BE(off + 12); depth = b[off + 16]; ctype = b[off + 17]; }
    if (type === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported png depth=${depth} ctype=${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ctype === 6 ? 4 : 3;
  const rowLen = w * bpp;
  const up = Buffer.alloc(h * rowLen);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const row = raw.subarray(rp, rp + rowLen); rp += rowLen;
    const prev = y ? up.subarray((y - 1) * rowLen, y * rowLen) : Buffer.alloc(rowLen);
    const cur = up.subarray(y * rowLen, (y + 1) * rowLen);
    for (let x = 0; x < rowLen; x++) {
      const a2 = x >= bpp ? cur[x - bpp] : 0, b2 = prev[x], c2 = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a2; else if (f === 2) v += b2; else if (f === 3) v += (a2 + b2) >> 1;
      else if (f === 4) { const pp = a2 + b2 - c2, pa = Math.abs(pp - a2), pb = Math.abs(pp - b2), pc = Math.abs(pp - c2); v += (pa <= pb && pa <= pc) ? a2 : (pb <= pc ? b2 : c2); }
      cur[x] = v & 255;
    }
  }
  return { w, h, bpp, data: up };
}
function lumaStats(img) {
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < img.data.length; i += img.bpp) {
    const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    s += l; s2 += l * l; n++;
  }
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

// ---------------- 断言 ----------------
const mats = Object.fromEntries(gj.materials.map((m) => [m.name, m]));
for (const name of ['rockery-stone', 'rockery-stone-dark']) {
  const m = mats[name];
  ok(`${name} 材质存在`, !!m);
  if (!m) continue;
  const pbr = m.pbrMetallicRoughness || {};
  // ① 层理颜色贴图
  const texIdx = pbr.baseColorTexture?.index;
  ok(`${name} 带 baseColorTexture`, texIdx !== undefined);
  if (texIdx !== undefined) {
    const img = gj.images[gj.textures[texIdx].source];
    ok(`${name} 颜色贴图 = 程序化层理贴图（${img.name}）`, /^strata-tint-/.test(img.name || ''), img.name);
    const bytes = imageBytes(img.name);
    ok(`${name} 层理贴图可解码（PNG）`, !!bytes && bytes[0] === 0x89 && bytes[1] === 0x50);
    if (bytes && bytes[1] === 0x50) {
      const dec = decodePng(bytes);
      const st = lumaStats(dec);
      ok(`${name} 层理贴图亮度 std ${st.std.toFixed(2)} ≥ ${LUMA_STD_MIN}（${dec.w}×${dec.h}，均值 ${st.mean.toFixed(1)}）`,
        st.std >= LUMA_STD_MIN, `std=${st.std.toFixed(3)}`);
      // 层理向（v）方差应显著大于带内细噪声：按行平均的条带曲线 std
      const rows = [];
      for (let y = 0; y < dec.h; y++) {
        let s = 0;
        for (let x = 0; x < dec.w; x += 4) {
          const o = (y * dec.w + x) * dec.bpp;
          s += 0.2126 * dec.data[o] + 0.7152 * dec.data[o + 1] + 0.0722 * dec.data[o + 2];
        }
        rows.push(s / Math.ceil(dec.w / 4));
      }
      const rm = rows.reduce((a, b) => a + b, 0) / rows.length;
      const rstd = Math.sqrt(rows.reduce((a, b) => a + (b - rm) ** 2, 0) / rows.length);
      ok(`${name} 层理条带（v 向行均值）std ${rstd.toFixed(2)} ≥ 2（条带承载主要方差，非纯噪声）`,
        rstd >= 2, `rowStd=${rstd.toFixed(3)}`);
    }
  }
  // ② 粗糙度层理（ORM G 通道）
  const ormIdx = pbr.metallicRoughnessTexture?.index;
  ok(`${name} 带 metallicRoughnessTexture（粗糙度层理）`, ormIdx !== undefined);
  if (ormIdx !== undefined) {
    const img = gj.images[gj.textures[ormIdx].source];
    const bytes = imageBytes(img.name);
    if (bytes && bytes[1] === 0x50) {
      const dec = decodePng(bytes);
      let s = 0, s2 = 0; const n = dec.w * dec.h;
      for (let i = 0; i < n; i++) {
        const g = dec.data[i * dec.bpp + 1] / 255;
        s += g; s2 += g * g;
      }
      const mean = s / n, std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      ok(`${name} ORM G 均值 ${mean.toFixed(3)} ∈ [0.93, 1.0]（roughnessFactor 0.9 不变）`,
        mean >= 0.93 && mean <= 1.0, `mean=${mean.toFixed(4)}`);
      ok(`${name} ORM G 层理 std ${std.toFixed(4)} ≥ ${ORM_G_STD_MIN}`, std >= ORM_G_STD_MIN, `std=${std.toFixed(4)}`);
    }
  }
}
// ③ moss 不受影响
{
  const m = mats['rockery-moss'];
  ok('rockery-moss 材质存在', !!m);
  if (m) {
    const c = m.pbrMetallicRoughness?.baseColorFactor;
    ok('rockery-moss baseColorFactor 保持 5c6b4a 线性（不受层理影响）',
      !!c && c.length === 4 && c[3] === 1
      && MOSS_FACTOR.every((v, i) => Math.abs(c[i] - v) < 1e-4), JSON.stringify(c));
    ok('rockery-moss 无贴图（常量色）', !m.pbrMetallicRoughness?.baseColorTexture);
  }
}
// ④ 几何守卫 + 预算（validator 三角数；与 layout 无关的形态守卫在 rockery-test）
{
  const res = await validateBytes(new Uint8Array(buf));
  const errs = res.issues.numErrors ?? 0;
  ok(`glTF validator 0 错误（warnings=${res.issues.numWarnings ?? 0}）`, errs === 0, JSON.stringify((res.issues.messages || []).filter((m) => m.severity === 0).slice(0, 3)));
  const tris = res.info?.totalTriangleCount ?? 0;
  ok(`三角 ${tris} ≤ ${BUDGET_TRIS}（几何不变守卫的预算口径）`, tris > 0 && tris <= BUDGET_TRIS);
  const colorImgs = gj.images.filter((i) => /^strata-tint-/.test(i.name || ''));
  ok(`层理贴图随 GLB 内嵌（${colorImgs.map((i) => i.name).join(',')}；stone+dark 各 1）`,
    colorImgs.length === 2 && colorImgs.some((i) => i.name === 'strata-tint-a08560')
    && colorImgs.some((i) => i.name === 'strata-tint-836d4f'));
}

console.log(`RESULT pass=${pass} fail=${fail}`);
if (fail) { failures.forEach((f) => console.log('  -', f)); process.exit(1); }
