// M1 湖心亭瓦面瓦纹测试（wave13-matdetail）。口径：
//  - 被测件 = out-zone/huxin-ting.glb 模块 GLB（HUXINTING_GLB 可只换被测件，同 huxinting-test.mjs）。
//  - 主楼 satou 沿檐宽从 baseline/layout.json 的 footprint 独立重算（面积形心 + 最长边主轴，同 huxinting-test.mjs
//    公式）：两坡交接三角面（歇山「撒头」satou，eave_kit xieshan_roof 端部小坡）沿檐宽 = 2*(V0 - breakInset)。
//    抱厦 satou 沿檐宽被承台让桥二分收缩（build 内部迭代量，无法从 layout 反算），改为读被测件 satou 网格
//    顶点 0-1 边（eave_kit 输出顺序保证 = 沿檐边），垄数由同一 pitch 公式独立推出。
//  - 断言：① 全部 roof 瓦面（lower / upper-s|n / cone / tile / satou-w|e）带 TEXCOORD_0（瓦纹贴图无漏铺）；
//    ② 每块 satou 有伴生 -wa 几何瓦垄网格且垄数覆盖沿檐宽；③ satou UV 的沿檐跨度 ≥ 几何宽/垄距-1
//    （瓦纹周期 = 垄距 0.33 m）；④ 瓦垄条网格带 COLOR_0（垄脊/垄沟顶点色）；⑤ 带瓦纹 UV 的瓦面三角比例 = 1.0。
//  - ⑥ R1（审查项 1/3）瓦面图元贴图绑定 + UV 质量真实校验（原版只查属性存在 = 撒头换灰面仍假绿）：
//    每个瓦面图元经 material→baseColorTexture 绑定 ht-tile-tex 贴图且 PNG 可解码；坡向 V 跨度 ≥ 1.5 周期
//    （非恒定）；逐三角 UV 面积有效（3D 正常的三角不得 UV 退化）；单位长度纹理密度中位数 ≈ 1/0.33 周期/m
//    （设计 1 周期 = 垄距）；面级 U 极差 ≤ 8 周期（闭环合拢列回绕检测，satou 单 quad 除外）。
//    负例固定在 tests/huxinting-tile-negative-test.mjs（撒头无贴图 / V 恒定 / U 回绕必须红）。
// 用法：OUT_DIR=out-zone node tests/huxinting-tile-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const GLB_PATH = process.env.HUXINTING_GLB ? path.resolve(process.env.HUXINTING_GLB) : path.join(OUT, 'huxin-ting.glb');
const HUXINTING = process.env.HUXINTING !== '0';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}

if (process.env.HUXINTING === '0') {
  console.log('HUXINTING=0 — 湖心亭模块测试跳过');
  process.exit(0);
}

// ---------------- layout 独立重算：面积形心 / 最长边主轴 ----------------
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const HT = LAYOUT.objects.find((o) => o.id === 'huxin-ting');
const FP = HT.geometry.footprint.slice(0, -1);
const A2 = FP.reduce((s, p, i) => s + p[0] * FP[(i + 1) % FP.length][1] - FP[(i + 1) % FP.length][0] * p[1], 0);
const CX = FP.reduce((s, p, i) => s + (p[0] + FP[(i + 1) % FP.length][0]) * (p[0] * FP[(i + 1) % FP.length][1] - FP[(i + 1) % FP.length][0] * p[1]), 0) / (3 * A2);
const CZ = FP.reduce((s, p, i) => s + (p[1] + FP[(i + 1) % FP.length][1]) * (p[0] * FP[(i + 1) % FP.length][1] - FP[(i + 1) % FP.length][0] * p[1]), 0) / (3 * A2);
const [L0, a0, b0] = FP.reduce((best, p, i) => {
  const q = FP[(i + 1) % FP.length];
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return L > best[0] ? [L, p, q] : best;
}, [0, null, null]);
let UX = (b0[0] - a0[0]) / L0, UZ = (b0[1] - a0[1]) / L0;
if (UX < 0) { UX = -UX; UZ = -UZ; }
const VX = UZ, VZ = -UX;
const loc = (px, pz) => [(px - CX) * UX + (pz - CZ) * UZ, (px - CX) * VX + (pz - CZ) * VZ];
const LOC = FP.map((p) => loc(p[0], p[1]));
const U0 = (Math.max(...LOC.map((q) => q[0])) - Math.min(...LOC.map((q) => q[0]))) / 2;
const V0 = (Math.max(...LOC.map((q) => q[1])) - Math.min(...LOC.map((q) => q[1]))) / 2;

// 设计冻结值（modules/huxinting/build.py D['roof'] / D['wa']，2026-09-25 GOAL 冻结）
const PITCH = 0.33, BREAK_INSET = 0.8;
// 主楼撒头沿檐宽 = 折线环 v 跨（矩形内收 breakInset）；抱厦撒头沿檐宽读被测件几何（让桥收缩，见头注）
const W_MAIN_SATOU = 2 * (V0 - BREAK_INSET);

// ---------------- GLB 解析 ----------------
if (!fs.existsSync(GLB_PATH)) {
  console.log(`FAIL huxin-ting.glb 不存在于 ${GLB_PATH}`);
  process.exit(1);
}
const buf = fs.readFileSync(GLB_PATH);
const jsonLen = buf.readUInt32LE(12);
const gj = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen;
const bin = buf.slice(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff));

const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessorBounds(idx) {
  const acc = gj.accessors[idx];
  if (acc.bufferView === undefined) return null;
  const bv = gj.bufferViews[acc.bufferView];
  const nc = NCOMP[acc.type];
  const fsize = acc.componentType === 5126 ? 4 : acc.componentType === 5123 ? 2 : 1;
  const stride = bv.byteStride || nc * fsize;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const mn = Array(nc).fill(Infinity), mx = Array(nc).fill(-Infinity);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < nc; c++) {
      const o = base + i * stride + c * fsize;
      const v = acc.componentType === 5126 ? bin.readFloatLE(o) : acc.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o);
      if (v < mn[c]) mn[c] = v;
      if (v > mx[c]) mx[c] = v;
    }
  }
  return { min: mn, max: mx, count: acc.count };
}
function primTriCount(p) {
  if (p.indices !== undefined) return gj.accessors[p.indices].count / 3;
  return gj.accessors[p.attributes.POSITION].count / 3;
}

// mesh 名 -> { prims, triTotal, hasUV, uvUSpan, hasColor, pos }
const meshes = {};
for (const m of gj.meshes || []) {
  const rec = { name: m.name, triTotal: 0, hasUV: true, uvUSpan: 0, hasColor: false, hasColor1: false, prims: 0, pos: null };
  for (const p of m.primitives) {
    rec.prims++;
    rec.triTotal += primTriCount(p);
    if (p.attributes.TEXCOORD_0 === undefined) rec.hasUV = false;
    else {
      const b = accessorBounds(p.attributes.TEXCOORD_0);
      rec.uvUSpan = Math.max(rec.uvUSpan, b.max[0] - b.min[0]);
    }
    if (p.attributes.COLOR_0 !== undefined) rec.hasColor = true;
    if (p.attributes.COLOR_1 !== undefined) rec.hasColor1 = true;
    if (rec.pos === null && p.attributes.POSITION !== undefined) rec.pos = p.attributes.POSITION;
  }
  meshes[m.name] = rec;
}
const names = Object.keys(meshes);

// satou 网格的沿檐宽：GLB 顶点保持 eave_kit 输出顺序 [(ub,bv0),(ub,bv1),(ug,bv1),(ug,bv0)]，
// 顶点 0-1 边 = 沿檐边（抱厦被让桥收深，从 layout 反算不出，直接读被测件几何，垄数由同一 pitch 公式推）
function accessorVec3(idx) {
  const acc = gj.accessors[idx];
  const bv = gj.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = [];
  for (let i = 0; i < acc.count; i++) out.push([bin.readFloatLE(base + i * 12), bin.readFloatLE(base + i * 12 + 4), bin.readFloatLE(base + i * 12 + 8)]);
  return out;
}
const satouEaveSpan = {};
for (const n of satouNameCandidates()) {
  const pts = accessorVec3(meshes[n].pos);
  satouEaveSpan[n] = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
}
function satouNameCandidates() { return Object.keys(meshes).filter((n) => /-satou-[we]$/.test(n)); }

// ---------------- 断言 ----------------
// ① 全部 roof 瓦面带 TEXCOORD_0：satou 4 块（主楼 2 + 抱厦 2）+ 其余 roof 面
const SATOU_RE = /-satou-[we]$/;
const satouNames = names.filter((n) => SATOU_RE.test(n));
ok('satou 网格存在（主楼+抱厦共 4 块）', satouNames.length === 4, `found ${satouNames.length}: ${satouNames.join(',')}`);
const roofFaceRe = /-(lower|upper-[sn]|cone|tile)$/;
const roofFaces = names.filter((n) => roofFaceRe.test(n) || SATOU_RE.test(n));
ok('roof 瓦面网格存在（≥6 块）', roofFaces.length >= 6, `found ${roofFaces.length}`);
const noUV = roofFaces.filter((n) => !meshes[n].hasUV);
ok('全部 roof 瓦面带 TEXCOORD_0（瓦纹贴图无漏铺）', noUV.length === 0, `missing UV: ${noUV.join(',') || 'none'}`);

// ② 每块 satou 有伴生 -wa 几何瓦垄：垄数 ≥ ceil(沿檐宽/垄距)，三角数 ≥ 每垄 1 quad + 2 端面
for (const n of satouNames) {
  const isMain = n.startsWith('huxin-ting__mainroof');
  const span = satouEaveSpan[n] || 0;
  const need = Math.max(1, Math.ceil((span / PITCH) - 0.05));       // 同 build.py tile_ridges 取整口径
  const wa = meshes[n + '-wa'];
  ok(`${n} 有伴生瓦垄 -wa`, !!wa && wa.triTotal > 0, wa ? `tris=${wa.triTotal}` : 'missing');
  ok(`${n} 瓦垄数覆盖沿檐 ${span.toFixed(2)} m（≥${need} 条 / 垄距 ${PITCH}）`,
    !!wa && wa.triTotal >= 4 * need - 2, wa ? `tris=${wa.triTotal} (< ${4 * need - 2})` : 'missing');
  if (isMain) {
    // 主楼不受让桥收缩影响，沿檐宽与 layout 独立重算值交叉验证（2*(V0 - breakInset)）
    ok(`${n} 沿檐宽 ≈ layout 独立重算 ${W_MAIN_SATOU.toFixed(2)} m`, Math.abs(span - W_MAIN_SATOU) < 0.15,
      `span=${span.toFixed(3)}`);
  }
  // ③ UV 沿檐跨度 ≥ 期望垄数-1（周期 = 垄距；容差 1 个周期）
  ok(`${n} 瓦纹 UV 跨度 ≥ ${(span / PITCH - 1).toFixed(1)} 周期`, meshes[n].hasUV && meshes[n].uvUSpan >= span / PITCH - 1,
    `uSpan=${meshes[n].uvUSpan.toFixed(2)}`);
}

// ④ 瓦垄条带 COLOR_0（垄脊亮 / 垄沟暗顶点色）——全部 -wa 网格（-bofeng-wa 是博风板 w 端 a 侧命名，非瓦垄，排除）
const waNames = names.filter((n) => /-wa$/.test(n) && !/-bofeng-/.test(n));
ok('瓦垄条网格存在（≥6 块）', waNames.length >= 6, `found ${waNames.length}`);
const waNoColor = waNames.filter((n) => !meshes[n].hasColor);
ok('瓦垄条网格带 COLOR_0 顶点色', waNoColor.length === 0, `missing COLOR_0: ${waNoColor.join(',') || 'none'}`);
// 回归守卫：材质节点树不含 Color Attribute 时导出器会把颜色双写成 COLOR_0+COLOR_1（两种位深），炸 cm validator
const c1 = names.filter((n) => meshes[n].hasColor1);
ok('全网格无 COLOR_1（双写守卫）', c1.length === 0, `COLOR_1 on: ${c1.join(',') || 'none'}`);

// 带瓦纹 UV 的瓦面三角比例（覆盖率口径：satou 被覆盖且全部瓦面有 UV → 1.0）
const triAll = roofFaces.reduce((s, n) => s + meshes[n].triTotal, 0);
const triUV = roofFaces.reduce((s, n) => s + (meshes[n].hasUV ? meshes[n].triTotal : 0), 0);
const cover = triAll ? triUV / triAll : 0;
ok('带瓦纹 UV 的瓦面三角比例 = 1.0（交接三角面被覆盖）', cover === 1, `cover=${cover.toFixed(4)} (${triUV}/${triAll})`);

// ---------------- ⑥ R1 瓦面图元贴图绑定 + UV 质量（审查项 1/3；逐图元真实校验） ----------------
function accUV(idx) {
  const a = gj.accessors[idx];
  const bv = gj.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) out.push([bin.readFloatLE(base + i * 8), bin.readFloatLE(base + i * 8 + 4)]);
  return out;
}
function accIdxRaw(idx) {
  const a = gj.accessors[idx];
  const bv = gj.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const u16 = a.componentType === 5123;
  const out = [];
  for (let i = 0; i < a.count; i++) out.push(u16 ? bin.readUInt16LE(base + i * 2) : bin.readUInt32LE(base + i * 4));
  return out;
}
// PNG 真解码（同 huxinting-test.mjs 口径：inflateSync + 格式/长度校验，防「压缩流当像素」假绿）
function decodePng128(b) {
  if (!(b[0] === 0x89 && b[1] === 0x50)) throw new Error('not png');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0; const idat = []; let hasIEND = false;
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off), type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(off + 8); h = b.readUInt32BE(off + 12); depth = b[off + 16]; ctype = b[off + 17]; }
    if (type === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') hasIEND = true;
    off += 12 + len;
  }
  if (!idat.length || !hasIEND) throw new Error('missing IDAT/IEND');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ctype === 6 ? 4 : 3, rowLen = w * bpp;
  if (raw.length !== h * (1 + rowLen)) throw new Error(`inflate length ${raw.length} != ${h * (1 + rowLen)}`);
  const up = Buffer.alloc(h * rowLen);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++]; const row = raw.subarray(rp, rp + rowLen); rp += rowLen;
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
const srgbToLinT = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// 设计值：1 纹理周期 = 垄距 0.33 m → 密度 1/0.33 = 3.03 周期/m。容差：檐口弧长 > 弦长 + cone 攒尖
// 列向收拢（顶部 UV 拉伸，实测 ~4.6）取 [2.2, 5.2]；satou 用正交投影近似（实测 ~3.03）同容差覆盖。
const DENSITY = 1 / PITCH, DENSITY_LO = 2.2, DENSITY_HI = 5.2;
const FACE_U_CYC_MAX = 8, V_SPAN_MIN = 1.5;

const badBind = [], badV = [], badDegen = [], badDens = [], badSeam = [];
for (const n of roofFaces) {
  const m = gj.meshes.find((x) => x.name === n);
  for (const p of m.primitives) {
    // 贴图绑定：material → baseColorTexture → image（ht-tile-tex，可解码且中性灰）
    const mat = p.material !== undefined ? gj.materials[p.material] : null;
    const tex = mat?.pbrMetallicRoughness?.baseColorTexture;
    const im = tex !== undefined ? gj.images[gj.textures[tex.index].source] : null;
    if (!mat || tex === undefined || !im || im.name !== 'ht-tile-tex') { badBind.push(`${n}(${im ? im.name : 'no-texture'})`); continue; }
    const bv = gj.bufferViews[im.bufferView];
    const ib = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    try {
      const dec = decodePng128(ib);
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let i = 0; i < dec.data.length; i += dec.bpp) { r += dec.data[i]; g += dec.data[i + 1]; b += dec.data[i + 2]; cnt++; }
      const mb = [r / cnt, g / cnt, b / cnt];
      if (!(Math.abs(mb[0] - mb[1]) <= 3 && Math.abs(mb[1] - mb[2]) <= 3)) badBind.push(`${n}(贴图非中性灰 ${mb.map((v) => v.toFixed(0)).join('/')})`);
    } catch (e) { badBind.push(`${n}(贴图不可解码: ${e.message})`); }
    // UV 质量：坡向跨度 / 逐三角 UV 面积 / 纹理密度 / 面级 U 极差（接缝回绕）
    if (p.attributes.TEXCOORD_0 === undefined) { badV.push(`${n}(no UV)`); continue; }
    const uv = accUV(p.attributes.TEXCOORD_0);
    const pos = accessorVec3(p.attributes.POSITION);
    const idx = accIdxRaw(p.indices);
    const us = uv.map((q) => q[0]), vs = uv.map((q) => q[1]);
    const vSpan = Math.max(...vs) - Math.min(...vs);
    if (vSpan < V_SPAN_MIN) badV.push(`${n}(vSpan=${vSpan.toFixed(3)} < ${V_SPAN_MIN}，坡向恒定?)`);
    let maxDU = 0, degenUVgood3D = 0; const dens = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      maxDU = Math.max(maxDU, Math.max(us[a], us[b], us[c]) - Math.min(us[a], us[b], us[c]));
      const Auv = Math.abs((us[b] - us[a]) * (vs[c] - vs[a]) - (us[c] - us[a]) * (vs[b] - vs[a])) / 2;
      const [A, B, C] = [pos[a], pos[b], pos[c]];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const A3 = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      if (Auv < 1e-9 && A3 > 1e-7) degenUVgood3D++;
      else if (A3 > 1e-7 && Auv > 1e-9) dens.push(Math.sqrt(Auv / A3));
    }
    if (degenUVgood3D > 0) badDegen.push(`${n}(${degenUVgood3D} 三角 3D 正常但 UV 退化)`);
    dens.sort((x, y) => x - y);
    const med = dens.length ? dens[Math.floor(dens.length / 2)] : 0;
    if (!(med >= DENSITY_LO && med <= DENSITY_HI)) badDens.push(`${n}(densityMed=${med.toFixed(2)} ∉ [${DENSITY_LO},${DENSITY_HI}] cyc/m)`);
    if (!SATOU_RE.test(n) && maxDU > FACE_U_CYC_MAX) badSeam.push(`${n}(maxFaceDU=${maxDU.toFixed(1)} > ${FACE_U_CYC_MAX}，合拢列接缝回绕?)`);
  }
}
ok(`瓦面图元全部绑定 ht-tile-tex 贴图且可解码为中性灰（异常 ${badBind.length}）`, badBind.length === 0, badBind.slice(0, 3).join(', '));
ok(`瓦面坡向 V 跨度 ≥ ${V_SPAN_MIN} 周期（非恒定，异常 ${badV.length}）`, badV.length === 0, badV.slice(0, 3).join(', '));
ok(`瓦面逐三角 UV 有效（3D 正常而 UV 退化的三角 ${badDegen.length}）`, badDegen.length === 0, badDegen.slice(0, 3).join(', '));
ok(`瓦面纹理密度中位数 ∈ [${DENSITY_LO}, ${DENSITY_HI}] 周期/m（设计 1 周期 = 垄距 ${PITCH} m，异常 ${badDens.length}）`, badDens.length === 0, badDens.slice(0, 3).join(', '));
ok(`瓦面面级 U 极差 ≤ ${FACE_U_CYC_MAX} 周期（无合拢列接缝回绕，异常 ${badSeam.length}）`, badSeam.length === 0, badSeam.slice(0, 3).join(', '));

console.log(`RESULT pass=${pass} fail=${fail}`);
if (fail) { failures.forEach((f) => console.log('  -', f)); process.exit(1); }
