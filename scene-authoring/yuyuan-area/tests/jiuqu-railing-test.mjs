// wave14-jiuqu：九曲桥镂空石栏杆 + 石墩验收（先红后绿；红基线 = 旧实心栏板产物 ca33d55c）。
// 期望值全部是冻结的设计常数（GOAL + 参考照片 PBR-SH-0004-017/018/019 推算，标"未核实"），
// 折线/开口/水面从 baseline/layout.json 独立重算，不读生成器 records。
// 被测对象 = staged/site-modules/jiuqu-bridge.glb（标准口径 SITE_MODULES=1 装配进 zone-pond 的那件）。
// 内置负例：同进程向解析后的三角注入"连续实心墙"，遮挡率 / 透空检查必须转红（证明检查器专抓实心墙）。
// 用法：node tests/jiuqu-railing-test.mjs（STAGED_DIR 可换对照产物）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGED = process.env.STAGED_DIR ? path.resolve(process.env.STAGED_DIR) : path.resolve(ROOT, 'staged', 'site-modules');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const COLL = JSON.parse(fs.readFileSync(path.join(STAGED, 'garden-kit-collision.json'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name} :: ${detail}`); console.log('FAIL', name, detail); }
}

// ---------- 冻结设计常数（未核实：按参考照片比例推算，依据见各条） ----------
const DECK_Y = 0.55;                 // layout jiuqu-bridge.deckY（冻结，不改）
const WATER_Y = -0.14;               // layout water-62072388.height（冻结）
const POST_SQ = [0.13, 0.27];        // 望柱方身见方设计 0.20（GOAL 0.16–0.2，±0.04 量测容差）
const POST_TOP = [DECK_Y + 1.18, DECK_Y + 1.28];   // 柱头顶 = deckY+1.23（柱 0.95 + 柱头 0.28）
const CAP_BAND = [DECK_Y + 0.93, DECK_Y + 1.26];   // 柱头存在带（柱头是柱的标志）
const CLUSTER_MAX = 0.40;            // 柱头簇 xz 包围盒上限（0.20 柱 + 略放大柱头 0.25 + 容差）
const RATIO_RANGE = [0.10, 0.55];    // 沿桥投影栏杆遮挡率设计范围（实心墙 ≈ 1.0，参考照片柱间大透空）
const OPEN_MIN = 0.25;               // 柱间花瓶柱带（deck+0.30/0.45/0.60 三高）全透空采样占比下限
const DECK_T_MAX = 0.12;             // 桥面石板厚上限（设计 0.09，旧 0.18 必红）
const PIER_TOP = [DECK_Y - 0.12, DECK_Y - 0.06];   // 墩帽顶 = 板底 deckY−0.09 ±0.03
const PIER_SQ = [0.35, 0.70];        // 方墩见方（墩身 0.42 / 墩帽 0.60）
const PIER_MIN = 8;                  // 立水中方墩数下限（97 m 桥、3 m 站距）
const PIER_NEAR = 0.55;              // 水下实体三角离最近墩心距离上限（墩间透空见水）
const TINT_LIN = [1.0, 0.89627, 0.87137];          // #fff3f0 线性（sRGB→linear 精确转换：((c+0.055)/1.055)^2.4，R1 审查更正）
const TINT_TOL = 0.03;

// ---------- GLB 解析（garden-kit-test 同款：JSON+BIN、节点 TRS 展开、三角形世界坐标） ----------
function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen));
  let bin = null;
  if (28 + jsonLen < buf.length) {
    const binLen = buf.readUInt32LE(20 + jsonLen);
    bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  }
  const comp = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function accessor(ai) {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const [bsize, Arr] = comp[a.componentType];
    const nc = ncomp[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || bsize * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) {
      const o = off + i * stride;
      out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + o, nc)));
    }
    return out;
  }
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mulVec(m, v) {
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  const verts = [], tris = [], triMats = [];
  function walk(ni, pm) {
    const n = json.nodes[ni];
    const m = pm ? mul4(pm, nodeMatrix(n)) : nodeMatrix(n);
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const pos = accessor(p.attributes.POSITION).map((v) => mulVec(m, v));
        const idx = p.indices !== undefined ? accessor(p.indices).map((v) => v[0]) : pos.map((_, i) => i);
        const base = verts.length;
        verts.push(...pos);
        for (let i = 0; i < idx.length; i += 3) {
          tris.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
          triMats.push(p.material !== undefined ? json.materials[p.material].name : null);
        }
      }
    }
    for (const c of n.children || []) walk(c, m);
  }
  for (const ni of json.scenes[json.scene || 0].nodes) walk(ni, null);
  const matByName = new Map((json.materials || []).map((m) => [m.name, m]));
  return { json, verts, tris, triMats, matByName };
}

// ---------- 射线（Möller–Trumbore），返回最近命中距离或 null ----------
function raycast(g, o, d, maxDist, triIdx) {
  let best = null;
  const [ox, oy, oz] = o, [dx, dy, dz] = d;
  for (const t of triIdx) {
    const [ia, ib, ic] = g.tris[t];
    const a = g.verts[ia], b = g.verts[ib], c = g.verts[ic];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-9 && det < 1e-9) continue;
    const inv = 1 / det;
    const sx = ox - a[0], sy = oy - a[1], sz = oz - a[2];
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-6 && dist < maxDist && (best === null || dist < best)) best = dist;
  }
  return best;
}

// ---------- 折线几何（从 layout 独立重算，garden-kit-test 同款 mitre） ----------
const BO = LAYOUT.objects.find((o) => o.id === 'jiuqu-bridge');
const PTS = BO.geometry.polyline;
const W = BO.width ?? 2.4;
const DIRS = [], NRMS = [];
for (let k = 0; k + 1 < PTS.length; k++) {
  const dx = PTS[k + 1][0] - PTS[k][0], dz = PTS[k + 1][1] - PTS[k][1], l = Math.hypot(dx, dz);
  DIRS.push([dx / l, dz / l]); NRMS.push([-dz / l, dx / l]);
}
function mitrePoint(i, side, half = W / 2) {
  const n = PTS.length;
  if (i <= 0) { const nn = NRMS[0]; return [PTS[0][0] + nn[0] * side * half, PTS[0][1] + nn[1] * side * half]; }
  if (i >= n - 1) { const nn = NRMS[n - 2]; return [PTS[n - 1][0] + nn[0] * side * half, PTS[n - 1][1] + nn[1] * side * half]; }
  const n0 = NRMS[i - 1], n1 = NRMS[i];
  let cx = (n0[0] + n1[0]) * side, cz = (n0[1] + n1[1]) * side, cl = Math.hypot(cx, cz);
  if (cl < 1e-6) { cx = n1[0] * side; cz = n1[1] * side; cl = 1; }
  cx /= cl; cz /= cl;
  const m = Math.min(half / Math.max((cx * n1[0] + cz * n1[1]) * side, 0.35), 1.9);
  return [PTS[i][0] + cx * m, PTS[i][1] + cz * m];
}
function edgeBand(i, side, half = W / 2) {
  const a = mitrePoint(i, side, half), b = mitrePoint(i + 1, side, half);
  const el = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (el < 1e-6) return null;
  const ed = [(b[0] - a[0]) / el, (b[1] - a[1]) / el];
  let en = [-ed[1], ed[0]];
  if ((en[0] * NRMS[i][0] + en[1] * NRMS[i][1]) * side < 0) en = [-en[0], -en[1]];
  return { a, b, el, ed, inn: [-en[0], -en[1]], out: en };
}
// 抱厦开口（从 huxin-ting footprint 独立重算，garden-kit-test 同式）
const HT = LAYOUT.objects.find((o) => o.id === 'huxin-ting');
const PORCH = (() => {
  if (!HT) return null;
  const fp = HT.geometry.footprint.slice(); if (fp[0][0] === fp.at(-1)[0] && fp[0][1] === fp.at(-1)[1]) fp.pop();
  const n = fp.length; let a2 = 0, cx = 0, cz = 0;
  for (let k = 0; k < n; k++) { const p = fp[k], q = fp[(k + 1) % n], c = p[0] * q[1] - q[0] * p[1]; a2 += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c; }
  cx /= 3 * a2; cz /= 3 * a2;
  let best = null; for (let k = 0; k < n; k++) { const p = fp[k], q = fp[(k + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (!best || L > best[0]) best = [L, p, q]; }
  let ux = (best[2][0] - best[1][0]) / best[0], uz = (best[2][1] - best[1][1]) / best[0]; if (ux < 0) { ux = -ux; uz = -uz; }
  return { cx, cz, ux, uz, vx: uz, vz: -ux, half: 0.75 };
})();
function inPorchOpening(p) {
  if (!PORCH) return false;
  const u = (p[0] - PORCH.cx) * PORCH.ux + (p[1] - PORCH.cz) * PORCH.uz;
  const v = (p[0] - PORCH.cx) * PORCH.vx + (p[1] - PORCH.cz) * PORCH.vz;
  return Math.abs(u) < PORCH.half - 0.01 && v > 0 && v < 9;
}
const EDGE_IN = 0.19;   // 栏杆带离桥面边线内缩（0.08 外缩 + 0.11 半柱，设计不变量）

// ---------- 被测 GLB ----------
const GLB_PATH = path.join(STAGED, 'jiuqu-bridge.glb');
const g = parseGlb(GLB_PATH);
console.log(`jiuqu-railing-test: ${GLB_PATH} tris=${g.tris.length}`);

// 栏杆带附近的三角索引（加速射线：xz 包围盒离带线 0.8 m 内）
function bandTriIndex(geom, band) {
  const idx = [];
  for (let t = 0; t < geom.tris.length; t++) {
    const [ia, ib, ic] = geom.tris[t];
    let inBand = false;
    for (const vi of [ia, ib, ic]) {
      const v = geom.verts[vi];
      if (!v) break;
      const px = v[0] - band.a[0], pz = v[2] - band.a[1];
      const s = px * band.ed[0] + pz * band.ed[1], l = px * band.inn[0] + pz * band.inn[1];
      if (s >= -0.5 && s <= band.el + 0.5 && l >= -0.8 && l <= 0.8) { inBand = true; break; }
    }
    if (inBand) idx.push(t);
  }
  return idx;
}

// ---------- 遮挡率 / 透空（可作用于任意 tris/verts 集合，负例复用） ----------
function occlusion(geom, band, triIdx) {
  const heights = [0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.05, 1.15].map((h) => DECK_Y + h);
  let blocked = 0, total = 0;
  const openFlags = [];
  for (let s = 0.15; s <= band.el - 0.15 + 1e-9; s += 0.1) {
    const bx = band.a[0] + band.ed[0] * s, bz = band.a[1] + band.ed[1] * s;
    if (inPorchOpening([bx, bz])) continue;
    const ox = bx + band.out[0] * 1.5, oz = bz + band.out[1] * 1.5;
    const d = [-band.out[0], 0, -band.out[1]];
    let hitAny = false, openHere = true;
    for (const y of heights) {
      const hit = raycast(geom, [ox, y, oz], d, 3.0, triIdx);
      total++;
      if (hit !== null) { blocked++; hitAny = true; }
    }
    for (const y of [DECK_Y + 0.30, DECK_Y + 0.45, DECK_Y + 0.60]) {
      if (raycast(geom, [ox, y, oz], d, 3.0, triIdx) !== null) { openHere = false; break; }
    }
    openFlags.push(openHere);
    void hitAny;
  }
  return { ratio: total ? blocked / total : 1, open: openFlags.length ? openFlags.filter(Boolean).length / openFlags.length : 0, samples: openFlags.length };
}

const BANDS = [];
for (let i = 0; i < PTS.length - 1; i++) for (const side of [-1, 1]) {
  const band = edgeBand(i, side, W / 2 - EDGE_IN);
  if (band && band.el >= 0.05) BANDS.push({ i, side, band });
}

// ---------- A) 浅粉米色石材质 ----------
{
  const m = g.matByName.get('garden-bridge-stone');
  ok('A 栏杆材质 garden-bridge-stone 存在', !!m);
  if (m) {
    const pbr = m.pbrMetallicRoughness || {};
    ok('A 材质挂基色贴图（石/泥材质必须有基色贴图）', !!pbr.baseColorTexture);
    const f = pbr.baseColorFactor || [1, 1, 1, 1];
    const d = Math.max(Math.abs(f[0] - TINT_LIN[0]), Math.abs(f[1] - TINT_LIN[1]), Math.abs(f[2] - TINT_LIN[2]));
    ok(`A baseColorFactor ≈ #fff3f0 线性（实测 [${f.slice(0, 3).map((x) => x.toFixed(3))}]，偏差 ${d.toFixed(4)} ≤ ${TINT_TOL}）`, d <= TINT_TOL);
  }
}

// ---------- B) 栏杆间断望柱：沿桥投影遮挡率 + 柱间透空（实心墙必红） ----------
{
  let bSum = 0, bN = 0, oSum = 0, worst = '';
  for (const { band } of BANDS) {
    const ti = bandTriIndex(g, band);
    const r = occlusion(g, band, ti);
    bSum += r.ratio * r.samples; bN += r.samples; oSum += r.open * r.samples;
    if (r.ratio > 0.9 && !worst) worst = `band(${band.a.map((x) => x.toFixed(1))}) ratio=${r.ratio.toFixed(2)}`;
  }
  const ratio = bSum / Math.max(1, bN), open = oSum / Math.max(1, bN);
  ok(`B 沿桥投影栏杆遮挡率 ${ratio.toFixed(3)} ∈ [${RATIO_RANGE}]（设计：间断望柱+横枋+花瓶柱；实心墙≈1.0）`,
    ratio >= RATIO_RANGE[0] && ratio <= RATIO_RANGE[1], `worst=${worst}`);
  ok(`B 柱间花瓶柱带全透空采样占比 ${(open * 100).toFixed(1)}% ≥ ${(OPEN_MIN * 100).toFixed(0)}%（实心墙=0%）`, open >= OPEN_MIN);
}

// ---------- C) 转折处必有望柱 ----------
{
  let worst = 0, missing = 0;
  for (let i = 0; i < PTS.length; i++) {
    const j = Math.max(0, Math.min(i, PTS.length - 2));
    for (const side of [-1, 1]) {
      const band = edgeBand(j, side);
      const c = mitrePoint(i, side);
      if (inPorchOpening(c)) continue;
      const ex = c[0] + band.inn[0] * EDGE_IN, ez = c[1] + band.inn[1] * EDGE_IN;
      let bd = null;
      for (let vi = 0; vi < g.verts.length; vi++) {
        const v = g.verts[vi];
        if (v[1] < CAP_BAND[0] || v[1] > CAP_BAND[1]) continue;
        const hd = Math.hypot(v[0] - ex, v[2] - ez);
        if (bd === null || hd < bd) bd = hd;
      }
      if (bd === null || bd > 0.30) { missing++; if (!worst || bd > worst) worst = bd ?? 99; } else worst = Math.max(worst, bd);
    }
  }
  ok(`C 每个折线顶点内外角有望柱（缺 ${missing}，worst ${Number.isFinite(worst) ? worst.toFixed(3) : worst} ≤ 0.30）`, missing === 0);
}

// ---------- D) 望柱尺寸落在设计范围（0.20 方 / 柱头顶 deckY+1.23） ----------
{
  // 柱头簇：帽带顶点按 0.35 m 贪心聚类
  const cap = [];
  for (const v of g.verts) if (v[1] >= CAP_BAND[0] && v[1] <= CAP_BAND[1]) cap.push(v);
  const clusters = [];
  for (const v of cap) {
    let best = null;
    for (const c of clusters) {
      const d = Math.hypot(v[0] - c.cx, v[2] - c.cz);
      if (d < 0.35 && (best === null || d < best.d)) best = { c, d };
    }
    if (best) { const c = best.c; c.n++; c.minY = Math.min(c.minY, v[1]); c.maxY = Math.max(c.maxY, v[1]); }
    else clusters.push({ cx: v[0], cz: v[2], n: 1, minY: v[1], maxY: v[1] });
  }
  ok(`D 望柱数（柱头簇）${clusters.length} ≥ 100（≤1.5 m 间距 × 双侧 97 m 桥）`, clusters.length >= 100);
  let badSq = 0, badTop = 0;
  for (const c of clusters) {
    // 簇内 xz 范围
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const v of cap) if (Math.hypot(v[0] - c.cx, v[2] - c.cz) < 0.35) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
    if (Math.max(x1 - x0, z1 - z0) > CLUSTER_MAX) badSq++;
    if (c.maxY < POST_TOP[0] || c.maxY > POST_TOP[1]) badTop++;
  }
  ok(`D 柱头簇包围盒 ≤ ${CLUSTER_MAX}（0.20 柱 + 略放大柱头；超 ${badSq}）`, badSq === 0);
  ok(`D 柱头顶 y ∈ [${POST_TOP.map((x) => x.toFixed(2))}]（设计 deckY+1.23；超 ${badTop}）`, badTop === 0);
  // 柱身见方：帽带下沿第一环切片（abs 1.48..1.58，两代设计此处都只有柱/柱头顶点，栏板与横枋不侵入）
  let sqBad = 0, checked = 0;
  for (const c of clusters.slice(0, 12)) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
    for (const v of g.verts) {
      if (v[1] < CAP_BAND[0] + 0.00 || v[1] > CAP_BAND[0] + 0.10) continue;
      if (Math.hypot(v[0] - c.cx, v[2] - c.cz) > 0.30) continue;
      x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); n++;
    }
    if (n < 4) continue;
    checked++;
    const ext = Math.max(x1 - x0, z1 - z0);
    if (ext < POST_SQ[0] || ext > 0.31) sqBad++;   // 上限 0.31：0.20 柱身 + 略放大柱头底环 0.25
  }
  ok(`D 柱头底环见方 ∈ [${POST_SQ[0]},0.31]（0.20 柱 + 略放大柱头的量测代理；抽 ${checked} 根超 ${sqBad}）`, checked >= 10 && sqBad === 0);
}

// ---------- E) 石墩：灰色方墩立水中、单排、顶住板底 ----------
const pierCenters = [];
{
  // grey-stone 三角焊接岛
  const gi = [];
  for (let t = 0; t < g.tris.length; t++) if (g.triMats[t] === 'garden-grey-stone') gi.push(t);
  const key = (v) => `${Math.round(v[0] * 500)}_${Math.round(v[1] * 500)}_${Math.round(v[2] * 500)}`;
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const triKey = [];
  for (const t of gi) {
    const [ia, ib, ic] = g.tris[t];
    const ks = [key(g.verts[ia]), key(g.verts[ib]), key(g.verts[ic])];
    triKey.push(ks);
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    uni(ks[0], ks[1]); uni(ks[1], ks[2]);
  }
  const islands = new Map();
  for (let n = 0; n < gi.length; n++) {
    const r = find(triKey[n][0]);
    if (!islands.has(r)) islands.set(r, { n: 0, minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9, sx: 0, sz: 0 });
    const o = islands.get(r);
    o.n++;
    for (const k of triKey[n]) void k;
    for (const vi of g.tris[gi[n]]) {
      const v = g.verts[vi];
      o.minX = Math.min(o.minX, v[0]); o.maxX = Math.max(o.maxX, v[0]);
      o.minZ = Math.min(o.minZ, v[2]); o.maxZ = Math.max(o.maxZ, v[2]);
      o.minY = Math.min(o.minY, v[1]); o.maxY = Math.max(o.maxY, v[1]);
      o.sx += v[0] / 3; o.sz += v[2] / 3;
    }
  }
  // 墩身/墩帽角点不共位（0.42 vs 0.60 方）→ 按中心聚簇合成整墩：top = 各岛最高，bottom = 各岛最低
  const clustersP = [];
  for (const o of islands.values()) {
    const c = [o.sx / o.n, o.sz / o.n];
    let best = null;
    for (const cl of clustersP) if (Math.hypot(c[0] - cl.cx, c[1] - cl.cz) < 0.35) { best = cl; break; }
    if (best) { best.minY = Math.min(best.minY, o.minY); best.maxY = Math.max(best.maxY, o.maxY); best.ext = Math.max(best.ext, o.maxX - o.minX, o.maxZ - o.minZ); best.n += o.n; }
    else clustersP.push({ cx: c[0], cz: c[1], minY: o.minY, maxY: o.maxY, ext: Math.max(o.maxX - o.minX, o.maxZ - o.minZ), n: o.n });
  }
  const piers = clustersP.filter((o) => o.maxY >= PIER_TOP[0] && o.maxY <= PIER_TOP[1] && o.minY < WATER_Y + 0.02);
  for (const o of piers) pierCenters.push([o.cx, o.cz]);
  const inWater = piers.filter((o) => o.minY < WATER_Y);
  ok(`E 方墩 ${piers.length} ≥ ${PIER_MIN}（顶 ∈ [${PIER_TOP.map((x) => x.toFixed(2))}]、底入水；其中 minY<水面 ${inWater.length}）`, piers.length >= PIER_MIN && inWater.length >= PIER_MIN);
  let sqBad = 0;
  for (const o of piers) {
    if (o.ext < PIER_SQ[0] || o.ext > PIER_SQ[1]) sqBad++;
  }
  ok(`E 方墩见方 ∈ [${PIER_SQ}]（设计墩身 0.42/墩帽 0.60；测 ${piers.length} 根超 ${sqBad}）`, piers.length >= PIER_MIN && sqBad === 0);
  // 单排：墩心都在中线 0.6 m 内
  let offRow = 0;
  const distToLine = (p) => {
    let best = 1e9;
    for (let k = 0; k + 1 < PTS.length; k++) {
      const a = PTS[k], b = PTS[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)));
    }
    return best;
  };
  for (const c of pierCenters) if (distToLine(c) > 0.6) offRow++;
  ok(`E 单排方墩（墩心离中线 ≤ 0.6 m；测 ${pierCenters.length} 根偏出 ${offRow}）`, pierCenters.length >= PIER_MIN && offRow === 0);
}

// ---------- F) 墩间可见水面：水下实体只许出现在墩位附近 ----------
{
  let bad = 0, n = 0;
  for (let t = 0; t < g.tris.length; t++) {
    const [ia, ib, ic] = g.tris[t];
    const vs = [g.verts[ia], g.verts[ib], g.verts[ic]];
    if (Math.min(vs[0][1], vs[1][1], vs[2][1]) >= WATER_Y + 0.03) continue;
    n++;
    const cx = (vs[0][0] + vs[1][0] + vs[2][0]) / 3, cz = (vs[0][2] + vs[1][2] + vs[2][2]) / 3;
    let near = false;
    for (const c of pierCenters) if (Math.hypot(cx - c[0], cz - c[1]) < PIER_NEAR) { near = true; break; }
    if (!near) bad++;
  }
  ok(`F 水面以下的桥体三角 ${n} 个全部落在墩位 ±${PIER_NEAR} m 内（墩间透空见水；离墩三角 ${bad}）`, n > 0 && pierCenters.length >= PIER_MIN && bad === 0);
}

// ---------- G) 桥面石板薄（≤0.12，顶 0.55 不变）；H) 平面走向/宽度不变 ----------
{
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const deckVert = [];
  for (let t = 0; t < g.tris.length; t++) if (g.triMats[t] === 'garden-deck-stone') for (const vi of g.tris[t]) deckVert.push(g.verts[vi]);
  for (const v of deckVert) { y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
  ok(`G 桥面板顶 y ${y1.toFixed(3)} ∈ 0.55±0.03（步行标高不变）`, Math.abs(y1 - DECK_Y) <= 0.03);
  ok(`G 桥面板厚 ${(y1 - y0).toFixed(3)} ≤ ${DECK_T_MAX}（设计 0.09；旧 0.18 必红）`, y1 - y0 <= DECK_T_MAX + 1e-6);
  let off = 0;
  // 桥面轮廓 = 每跨的 mitre 四边形（外转角可合法外凸至 1.9 m），距离按四边形边界算，不按中线
  const deckEdges = [];
  for (let k = 0; k + 1 < PTS.length; k++) {
    const q = [mitrePoint(k, -1), mitrePoint(k + 1, -1), mitrePoint(k + 1, 1), mitrePoint(k, 1)];
    for (let e = 0; e < 4; e++) deckEdges.push([q[e], q[(e + 1) % 4]]);
  }
  const distToOutline = (p) => {
    let best = 1e9;
    for (const [a, b] of deckEdges) {
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)));
    }
    return best;
  };
  for (const v of deckVert) if (distToOutline([v[0], v[2]]) > 0.08) off++;
  ok(`H 桥面顶点 ${deckVert.length} 个全部贴冻结折线的 mitre 轮廓（±0.08 m；偏出 ${off}，平面走向不变）`, off === 0);
}

// ---------- I) 碰撞：连续护栏盒不变（栏杆挡人，步行零变化） ----------
{
  const br = COLL.modules['jiuqu-bridge'];
  const bal = br.boxes.filter((b) => b.name === 'balustrade');
  const deckBoxes = br.boxes.filter((b) => b.walkableTop === 0.55);
  ok(`I 连续护栏盒 ${bal.length} ≥ 30（不随镂空视觉减少）`, bal.length >= 30);
  let badShape = 0, badOff = 0;
  for (const b of bal) {
    if (Math.abs(b.size[0] - 0.24) > 0.01 || Math.abs(b.size[1] - 1.23) > 0.01 || Math.abs(b.center[1] - (DECK_Y + 0.615)) > 0.01) badShape++;
    const dist = (() => { let best = 1e9; for (let k = 0; k + 1 < PTS.length; k++) { const a = PTS[k], d = DIRS[k], nn = NRMS[k]; const rel = [(b.center[0] - a[0]) * d[0] + (b.center[2] - a[1]) * d[1], (b.center[0] - a[0]) * nn[0] + (b.center[2] - a[1]) * nn[1]]; if (rel[0] >= -0.01 && rel[0] <= Math.hypot(PTS[k + 1][0] - a[0], PTS[k + 1][1] - a[1]) + 0.01) best = Math.min(best, Math.abs(rel[1])); } return best; })();
    if (!(Math.abs(dist - (W / 2 - 0.19)) <= 0.03)) badOff++;
  }
  ok(`I 护栏盒截面 0.24×1.23、顶 = deckY+1.23（形错 ${badShape}）`, badShape === 0);
  ok(`I 护栏盒离中线 ${(W / 2 - 0.19).toFixed(2)} m（位错 ${badOff}）`, badOff === 0);
  ok(`I 桥面碰撞盒 walkableTop=0.55 × ${deckBoxes.length} ≥ 17（步行面不变）`, deckBoxes.length >= 17);
  ok(`I 抱厦开口 2 处保留（实测 ${(br.openings || []).length}）`, (br.openings || []).length === 2);
}

// ---------- J) 必修1（R1 审查）：每根花瓶柱上下端与横枋接触（间隙 ≤ 5 mm） ----------
// R0 断接：柱顶 deck+0.72 vs 上枋底 deck+0.79，324 根全部留 7 cm 空隙。顶环识别：
// 离带线横向 |l| < 0.045（上/下枋棱线横向 ±0.05、边石 ±0.07、望柱棱线 ≥0.0795 全排除；折线 ±10.8° 下
// 花瓶柱顶环角点横向最大 ≈0.038）且 y ∈ [deck+0.65, deck+0.82]（旧 0.72 / 接枋后 0.795 均在内，柱头 ≥deck+0.95 排除）。
{
  const RAIL_BOT = DECK_Y + 0.79;    // 上枋底（上枋 0.12 高、中心 deckY+0.85）
  const BOT_TOP = DECK_Y + 0.15;     // 下枋顶（下枋 0.10 高、中心 deckY+0.10）
  const GAP_MAX = 0.005;
  const bals = [];
  for (const { band } of BANDS) {
    const ring = [];
    for (let vi = 0; vi < g.verts.length; vi++) {
      const v = g.verts[vi];
      if (v[1] < DECK_Y + 0.65 || v[1] > DECK_Y + 0.82) continue;
      const px = v[0] - band.a[0], pz = v[2] - band.a[1];
      const s = px * band.ed[0] + pz * band.ed[1];
      const l = px * band.inn[0] + pz * band.inn[1];
      if (s < -0.3 || s > band.el + 0.3 || Math.abs(l) >= 0.045) continue;
      ring.push([v[0], v[2], v[1]]);
    }
    const clusters = [];
    for (const [x, z, y] of ring) {
      let best = null;
      for (const c of clusters) {
        const d = Math.hypot(x - c.sx / c.n, z - c.sz / c.n);
        if (d < 0.10 && (best === null || d < best.d)) best = { c, d };
      }
      if (best) { const c = best.c; c.sx += x; c.sz += z; c.n++; c.maxY = Math.max(c.maxY, y); }
      else clusters.push({ sx: x, sz: z, n: 1, maxY: y });
    }
    for (const c of clusters) if (c.n >= 3) bals.push({ band, cx: c.sx / c.n, cz: c.sz / c.n, maxY: c.maxY });
  }
  ok(`J 花瓶柱顶环簇 ${bals.length} ≥ 300（R0 实测 324 根花瓶柱）`, bals.length >= 300);
  let badTop = 0, worstGap = -1e9;
  for (const c of bals) {
    const gap = RAIL_BOT - c.maxY;
    if (gap > worstGap) worstGap = gap;
    if (gap > GAP_MAX) badTop++;
  }
  ok(`J 每根花瓶柱上端接上枋底：最大间隙 ${worstGap.toFixed(4)} m ≤ 0.005（断接 ${badTop}/${bals.length}；R0 旧件 0.07 必红）`,
    bals.length >= 300 && badTop === 0);
  let badBot = 0, worstBot = -1e9;
  for (const c of bals) {
    const ti = bandTriIndex(g, c.band);
    const hit = raycast(g, [c.cx, DECK_Y + 0.40, c.cz], [0, -1, 0], 0.60, ti);
    const gap = hit === null ? 1e9 : (DECK_Y + 0.40 - hit) - BOT_TOP;
    if (gap > worstBot) worstBot = gap;
    if (!(hit !== null && gap <= GAP_MAX)) badBot++;
  }
  ok(`J 每根花瓶柱下端坐低下枋顶：柱轴下射线首命中最大间隙 ${worstBot.toFixed(4)} m ≤ 0.005（悬空 ${badBot}/${bals.length}）`,
    bals.length >= 300 && badBot === 0);
}

// ---------- N) 负例：注入连续实心墙 → B 组检查必须转红（证明专抓实心墙） ----------
{
  const mv = g.verts.slice(), mt = g.tris.map((t) => t.slice()), mm = g.triMats.slice();
  let added = 0;
  for (const { band } of BANDS) {
    // 每带注入一块通长实心栏板：0.55..1.78、厚 0.10，贴带线（模拟"回到实心墙"）
    const th = 0.05;
    const c = [[0, -th], [band.el, -th], [band.el, th], [0, th]];
    const base = mv.length;
    for (const [u, l] of c) mv.push([band.a[0] + band.ed[0] * u + band.inn[0] * l, DECK_Y, band.a[1] + band.ed[1] * u + band.inn[1] * l]);
    for (const [u, l] of c) mv.push([band.a[0] + band.ed[0] * u + band.inn[0] * l, DECK_Y + 1.23, band.a[1] + band.ed[1] * u + band.inn[1] * l]);
    const q = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const f of q) { mt.push([base + f[0], base + f[1], base + f[2]]); mt.push([base + f[0], base + f[2], base + f[3]]); mm.push('garden-grey-stone', 'garden-grey-stone'); added += 2; }
  }
  const mutant = { verts: mv, tris: mt, triMats: mm };
  let ratioSum = 0, n = 0, openSum = 0;
  for (const { band } of BANDS) {
    const ti = bandTriIndex(mutant, band);
    const r = occlusion(mutant, band, ti);
    ratioSum += r.ratio * r.samples; openSum += r.open * r.samples; n += r.samples;
  }
  const mr = ratioSum / Math.max(1, n), mo = openSum / Math.max(1, n);
  ok(`N 负例：注入实心墙（+${added} 三角）后遮挡率 ${mr.toFixed(3)} > ${RATIO_RANGE[1]}（检查器转红）`, mr > RATIO_RANGE[1]);
  ok(`N 负例：注入实心墙后透空占比 ${(mo * 100).toFixed(1)}% < ${(OPEN_MIN * 100).toFixed(0)}%（检查器转红）`, mo < OPEN_MIN);
}

console.log(`\njiuqu-railing-test: ${pass} pass, ${fail} fail`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
