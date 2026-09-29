// 三穗堂戗脊橙红小方块（巡检 #13）修复测试。
// 取证结论（artifacts/forensics/void-scan-baseline.txt / roof-profile-baseline.txt / ray-forensic.txt）：
//   巡检看到的"戗脊橙红小方块"不是脊饰，是三穗堂 bld-428179901 内主梁 main-beam（材质
//   sst-timber-darkred #8a4030，HSV S≈0.65 H≈11°）背端梁头穿出背面屋面 0.06–0.1 m，航拍读作
//   4 个贴片色块。修复 = build.py 背端缩进 ZB+0.2 → ZB+1.2（local -13.5 → -12.5）。
// 判据（期望值全部独立于生成器输出）：
//   A  暴露橙红射线判据：在三穗堂 footprint bbox 上空垂直向下网格射线，首击面为室内构件
//      （hall-interior__sst-timber-darkred，设计色表 modules/sansuitang/build.py SST_TIMBER
//      #8a4030 所在橙红域）= 违规，期望 0。依据：artifacts/REFERENCE-NOTES.md 三张参考照
//      （城隍庙/豫园屋面以上无橙红）。只判 hall-interior：hall-roof__sst-timber-darkred 是
//      檐口封檐板，顶边从上方可见属设计意图（檐口红棕），不构成巡检缺陷。
//   B  main-beam 数量/位置/缩进判据：模块 GLB 坐标（= build.py rng 的 GLB Y-up 设计坐标
//      + 重锚 (0,0,+6.65)），hall-interior__sst-timber-darkred 分量中 Δz>9.5 的 box=main-beam
//      （设计梁长 9.9 = 前端 local −2.6 到缩进背端 −12.5，从 rng 参数推；guazhu 0.24 /
//      upper-beam 4.9 不误配；缺陷态梁长 10.9 也命中，靠 zmin 判据抓），
//      期望 4 根（xs=±1.9/±5.3，±8.5 被 |x|>hw-.1 跳过），中心 x∈{±1.9,±5.3}±0.06，
//      顶面 y=6.7±0.06（gableBreakY 7.9−1.2），背端 GLB zmin ≥ −5.85
//      （= 局部设计线 ZB+1.2=−12.5，ZB=−(2.4+11.3)=−13.7；基线缺陷值 −6.85）。
//   C  名字↔颜色锁：gltf 材质表中 sst-timber-darkred 的 baseColorFactor 必须落在同一橙红域
//      （判据 A 的颜色语义依据；若未来改色，此断言提示同步更新色域）。
// 负例（合成 GLB，明显错误输入，必跑）：橙红板无遮挡→A 红；同板被深灰屋面盖住→A 绿；
//   3 根→B 红；背端 −6.85→B 红；位置 x=2.4→B 红；4 根合规→B 绿。
// 用法：OUT_DIR=out-zone node tests/sansuitang-ridge-test.mjs（产物段在无产物时跳过）
//       node tests/sansuitang-ridge-test.mjs --require-products（缺产物 = FAIL，重建守卫口径）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 内联最小 GLB 读取器（与 tests/sansuitang-test.mjs 同款实现风格：节点世界矩阵 + primitive 收集）。
// 不依赖仓库根 src/world/glbReader.js（yuyuan-area 子目录下无该模块）。
function readGlb(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(28 + jsonLen, 28 + jsonLen + buf.readUInt32LE(20 + jsonLen));
  const comp = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function accessor(ai) {
    const a = gltf.accessors[ai];
    const bv = gltf.bufferViews[a.bufferView];
    const [bsize, Arr] = comp[a.componentType];
    const nc = ncomp[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || bsize * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + off + i * stride, nc)));
    return out;
  }
  function localMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
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
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function transformPoint(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  const meshes = [];
  const walk = (ni, parent) => {
    const n = gltf.nodes[ni];
    const world = mul4(parent, localMatrix(n));
    for (const c of n.children ?? []) walk(c, world);
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const pos = accessor(prim.attributes.POSITION).flat();
        const ind = accessor(prim.indices).flat();
        meshes.push({ name: n.name ?? '', positions: pos, indices: ind, matrix: world });
      }
    }
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { gltf, meshes };
}
function transformPoint(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const SST_GLB = process.env.SANSUITANG_GLB ? path.resolve(process.env.SANSUITANG_GLB) : path.join(ROOT, 'out-garden-kits', 'sansuitang-bld-428179901', 'model.glb');
const REQUIRE = process.argv.includes('--require-products');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}

// ---------- 颜色域（设计色表：SST_TIMBER '#8a4030' sRGB → 线性 [0.254,0.0513,0.0295]） ----------
function srgbFromLinear(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function hsvFromRgb255(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, mx === 0 ? 0 : d / mx, mx / 255];
}
// 橙红域（宽于 #8a4030 实测 H=10.7 S=0.652 V=0.541，容相邻橙红变体；排除深灰瓦/白墙/木纹中性色）
const ORANGE = { hMin: -20, hMax: 35, sMin: 0.45, vMin: 0.15 };
function factorIsOrange(f) {
  if (!f || f.length < 3) return false;
  const [h, s, v] = hsvFromRgb255(srgbFromLinear(f[0]) * 255, srgbFromLinear(f[1]) * 255, srgbFromLinear(f[2]) * 255);
  return h >= ORANGE.hMin && h <= ORANGE.hMax && s >= ORANGE.sMin && v >= ORANGE.vMin;
}

// ---------- 垂直射线网格扫描：首击橙红 = 违规 ----------
// tris: [{ax,ay,az,bx,...,cz, orange}]；从 y=originY 向下，逐 (px,pz) 网格取最高命中。
// 三角形按其 AABB 桶化（桶 = 网格），射线只查所在桶，避免全量求交。
function scanExposedOrange(tris, x0, x1, z0, z1, step = 0.25, originY = 15) {
  const cell = (v, lo) => Math.floor((v - lo) / step);
  const nx = cell(x1, x0) + 1, nz = cell(z1, z0) + 1;
  const buckets = new Array(nx * nz).fill(null);
  const put = (gx, gz, t) => { const i = gx * nz + gz; (buckets[i] ??= []).push(t); };
  for (const t of tris) {
    const tx0 = Math.min(t.ax, t.bx, t.cx), tx1 = Math.max(t.ax, t.bx, t.cx);
    const tz0 = Math.min(t.az, t.bz, t.cz), tz1 = Math.max(t.az, t.bz, t.cz);
    const gx0 = Math.max(0, cell(tx0, x0)), gx1 = Math.min(nx - 1, cell(tx1, x0));
    const gz0 = Math.max(0, cell(tz0, z0)), gz1 = Math.min(nz - 1, cell(tz1, z0));
    if (gx1 < gx0 || gz1 < gz0) continue;
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) put(gx, gz, t);
  }
  const violations = [];
  for (let gx = 0; gx < nx; gx++) {
    for (let gz = 0; gz < nz; gz++) {
      const list = buckets[gx * nz + gz];
      if (!list) continue;
      const px = x0 + gx * step, pz = z0 + gz * step;
      let best = null;
      for (const t of list) {
        // 2D 重心系数（x,z 平面），内部点才求 y
        const d = (t.bx - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (t.bz - t.az);
        if (Math.abs(d) < 1e-12) continue;
        const w1 = ((px - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (pz - t.az)) / d;
        const w2 = ((t.bx - t.ax) * (pz - t.az) - (px - t.ax) * (t.bz - t.az)) / d;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const y = w0 * t.ay + w1 * t.by + w2 * t.cy;
        if (y > originY) continue;
        if (!best || y > best.y) best = { y, orange: t.orange };
      }
      if (best && best.orange) violations.push({ x: px, z: pz, y: best.y });
    }
  }
  return violations;
}
function trisOfMeshes(meshes, nameRe, orange = true) {
  const out = [];
  for (const m of meshes) {
    if (!nameRe.test(m.name)) continue;
    const P = [];
    for (let i = 0; i < m.positions.length; i += 3)
      P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = [P[m.indices[i]], P[m.indices[i + 1]], P[m.indices[i + 2]]];
      out.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2], orange });
    }
  }
  return out;
}

// ---------- main-beam 分类（连通分量并查集 + AABB 尺寸） ----------
function classifyBeams(glbParsed) {
  const meshes = glbParsed.meshes.filter((m) => /hall-interior__sst-timber-darkred/.test(m.name));
  const comps = new Map(); // 顶点量化 key -> comp id
  const parent = [];
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  let next = 0;
  const items = [];
  for (const m of meshes) {
    const P = [];
    for (let i = 0; i < m.positions.length; i += 3)
      P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
    const ids = P.map((p) => {
      const key = `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`;
      if (!comps.has(key)) { comps.set(key, next); parent.push(next++); }
      return comps.get(key);
    });
    for (let i = 0; i < m.indices.length; i += 3) union(ids[m.indices[i]], ids[m.indices[i + 1]]);
    for (let i = 0; i < m.indices.length; i += 3) union(ids[m.indices[i]], ids[m.indices[i + 2]]);
    for (const p of P) items.push({ p, root: find(comps.get(`${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`)) });
  }
  const boxes = new Map();
  for (const { p, root } of items) {
    const b = boxes.get(root) ?? { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], n: 0 };
    for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p[k]); b.max[k] = Math.max(b.max[k], p[k]); }
    b.n++;
    boxes.set(root, b);
  }
  const beams = [];
  for (const b of boxes.values()) {
    const d = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    if (d[2] > 9.5 && d[1] > 0.3 && d[1] < 0.5 && d[0] > 0.2 && d[0] < 0.4)
      beams.push({ cx: (b.min[0] + b.max[0]) / 2, top: b.max[1], zmin: b.min[2], size: d });
  }
  return { totalComps: boxes.size, beams };
}

// ---------- 合成 GLB（负例载体） ----------
function buildMiniGlb(entries) {
  // entries: [{name, factor:[r,g,b](linear), boxes:[{min:[..],max:[..]}]}]；每 entry 一个 box mesh
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  let off = 0;
  const binParts = [];
  const pad4 = (n) => (n + 3) & ~3;
  entries.forEach((e, i) => {
    const [x0, y0, z0] = e.boxes[0].min, [x1, y1, z1] = e.boxes[0].max;
    const v = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 7, 1, 0, 4, 7, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4]);
    const vbOff = off; off += pad4(v.byteLength); binParts.push(Buffer.from(v.buffer, v.byteOffset, v.byteLength), Buffer.alloc(pad4(v.byteLength) - v.byteLength));
    const ibOff = off; off += pad4(idx.byteLength); binParts.push(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength), Buffer.alloc(pad4(idx.byteLength) - idx.byteLength));
    json.bufferViews.push({ buffer: 0, byteOffset: vbOff, byteLength: v.byteLength });
    json.bufferViews.push({ buffer: 0, byteOffset: ibOff, byteLength: idx.byteLength });
    const pv = json.accessors.length;
    json.accessors.push({ bufferView: json.bufferViews.length - 2, componentType: 5126, count: 8, type: 'VEC3', min: e.boxes[0].min, max: e.boxes[0].max });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5125, count: idx.length, type: 'SCALAR' });
    json.materials.push({ name: e.name, pbrMetallicRoughness: { baseColorFactor: e.factor } });
    json.nodes.push({ name: e.name, mesh: i });
    json.meshes.push({ primitives: [{ attributes: { POSITION: pv }, indices: pv + 1, material: i, mode: 4 }] });
    json.scenes[0].nodes.push(i);
  });
  json.buffers = [{ byteLength: off }];
  const bin = Buffer.concat(binParts);
  let nj = Buffer.from(JSON.stringify(json));
  nj = Buffer.concat([nj, Buffer.alloc((4 - (nj.length % 4)) % 4, 0x20)]); // GLB 要求 4 字节对齐，JSON pad 用空格
  const paddedBin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + nj.length + 8 + paddedBin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(nj.length, 0); jh.write('JSON', 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(paddedBin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([head, jh, nj, bh, paddedBin]);
}

// ---------- 单元段：合成 GLB 负例/正例（自给，必跑） ----------
const ORANGE_FACTOR = [0.254, 0.0513, 0.0295]; // = sRGB #8a4030（设计色表 SST_TIMBER）
const GREY_FACTOR = [0.0795, 0.0885, 0.1046];  // ≈ sRGB #6d7480 深灰（屋面瓦同族，非橙红域）
// 合规 main-beam 样板（模块 GLB 坐标：设计局部 z −12.5..−2.6 + REANCHOR 6.65，梁长 9.9 = 实测产物一致值）
const BEAM_D = { min: [-5.45, 6.3, -5.85], max: [-5.15, 6.7, 4.05] };
function synthBeams(overrides, dropIdx) {
  // overrides: [{idx, min, max}] 覆盖第 idx 根；dropIdx: 删除第 idx 根（数量负例）
  const xs = [-5.3, -1.9, 1.9, 5.3];
  const entries = [];
  xs.forEach((cx, i) => {
    if (i === dropIdx) return;
    const o = (overrides ?? []).find((v) => v.idx === i);
    const b = o ?? { min: [cx - 0.15, 6.3, -5.85], max: [cx + 0.15, 6.7, 4.05] };
    entries.push({ name: `hall-interior__sst-timber-darkred-${i}`, factor: ORANGE_FACTOR, boxes: [b] });
  });
  return entries;
}
function evalBeamAssertions(parsed) {
  const { totalComps, beams } = classifyBeams(parsed);
  const errs = [];
  // 坐标口径：模块 GLB = rng 的 GLB Y-up 设计坐标 + 重锚 (0,0,+REANCHOR=6.65)。
  // main-beam 背端设计线 GLB zmin = ZB+1.2+REANCHOR = -13.7+1.2+6.65 = -5.85（基线缺陷值 = -13.5+6.65 = -6.85）。
  if (beams.length !== 4) errs.push(`main-beam 数量 ${beams.length} != 4（总分量 ${totalComps}）`);
  for (const b of beams) {
    if (![-5.3, -1.9, 1.9, 5.3].some((x) => Math.abs(b.cx - x) <= 0.06)) errs.push(`中心 x=${b.cx.toFixed(3)} 不在设计柱位 ±1.9/±5.3±0.06`);
    if (Math.abs(b.top - 6.7) > 0.06) errs.push(`顶面 y=${b.top.toFixed(3)} 偏离设计 6.7±0.06`);
    if (b.zmin < -5.85 - 1e-3) errs.push(`背端 GLB zmin=${b.zmin.toFixed(3)} 越过设计缩进线 −5.85（=ZB+1.2+REANCHOR；设计局部 −12.5）`);
  }
  return errs;
}
function evalOrangeAssertions(tris, bbox) {
  return scanExposedOrange(tris, bbox[0], bbox[1], bbox[2], bbox[3]);
}
{
  // U1 负例：橙红板 8m 高无遮挡 → 判据 A 必须红
  const g1 = readGlb(buildMiniGlb([{ name: 'test__orange-plate', factor: ORANGE_FACTOR, boxes: [{ min: [-2, 8, -2], max: [2, 8.05, 2] }] }]));
  const t1 = trisOfMeshes(g1.meshes, /test__orange-plate/, true);
  const v1 = evalOrangeAssertions(t1, [-5, 5, -5, 5]);
  ok('U1 负例: 无遮挡橙红板被射线判据抓到（A 红）', v1.length > 0, `违规点 ${v1.length}`);
  // U2 反向负例：同一橙红板被深灰屋面板盖住 → 判据 A 必须绿（暴露才红，不是见材质就红）
  const g2 = readGlb(buildMiniGlb([
    { name: 'test__orange-plate', factor: ORANGE_FACTOR, boxes: [{ min: [-2, 7, -2], max: [2, 7.05, 2] }] },
    { name: 'test__grey-roof', factor: GREY_FACTOR, boxes: [{ min: [-3, 8, -3], max: [3, 8.05, 3] }] },
  ]));
  const t2 = trisOfMeshes(g2.meshes, /test__orange-plate/, true);
  const tg = trisOfMeshes(g2.meshes, /test__grey-roof/, false);
  const v2 = evalOrangeAssertions([...t2, ...tg], [-5, 5, -5, 5]);
  ok('U2 反向负例: 被屋面盖住的橙红板不违规（A 绿）', v2.length === 0, `违规点 ${v2.length}`);
  // U3 负例：只有 3 根 → B 红
  const e3 = evalBeamAssertions(readGlb(buildMiniGlb(synthBeams([], 3))));
  ok('U3 负例: 3 根 main-beam 被数量判据抓到（B 红）', e3.some((s) => s.includes('数量')), e3.join('; '));
  // U4 负例：背端 −6.85（基线缺陷值 = 设计局部 −13.5 + REANCHOR，梁长 10.9）→ B 红
  const e4 = evalBeamAssertions(readGlb(buildMiniGlb(synthBeams([{ idx: 0, min: [-5.45, 6.3, -6.85], max: [-5.15, 6.7, 4.05] }]))));
  ok('U4 负例: 背端 −6.85（基线缺陷值）被缩进判据抓到（B 红）', e4.some((s) => s.includes('−5.85')), e4.join('; '));
  // U5 负例：位置偏到 x=2.4 → B 红
  const e5 = evalBeamAssertions(readGlb(buildMiniGlb(synthBeams([{ idx: 2, min: [2.25, 6.3, -5.85], max: [2.55, 6.7, 5.05] }]))));
  ok('U5 负例: 柱位偏移 x=2.4 被位置判据抓到（B 红）', e5.some((s) => s.includes('柱位')), e5.join('; '));
  // U6 正例：4 根合规 → B 绿
  const e6 = evalBeamAssertions(readGlb(buildMiniGlb(synthBeams([]))));
  ok('U6 正例: 4 根合规 main-beam 全部通过（B 绿）', e6.length === 0, e6.join('; '));
  // 判据 C：合成材质名字↔颜色锁（用 U1 的 gltf：test__orange 名下 factor 必须在橙红域）
  const c1 = g1.gltf.materials.filter((m) => /orange/.test(m.name)).every((m) => factorIsOrange(m.pbrMetallicRoughness.baseColorFactor));
  const c2 = g2.gltf.materials.filter((m) => /grey-roof/.test(m.name)).every((m) => !factorIsOrange(m.pbrMetallicRoughness.baseColorFactor));
  ok('U7 色域判定: 橙红因子判橙红、深灰因子判非橙红', c1 && c2);
}

// ---------- 产物段 ----------
const haveModule = fs.existsSync(SST_GLB);
// 只读未压缩 raw 分区件：.cm.glb 是 EXT_meshopt_compression 件，朴素读取器不可解析（几何同源、
// 浏览器可见性由截图验收覆盖）。正则限定 zone-garden[-N].glb，不匹配 *.cm.glb。
const zoneFiles = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => /^zone-garden(?:-\d+)?\.glb$/.test(f)).sort() : [];
if (!haveModule || zoneFiles.length === 0) {
  if (REQUIRE) {
    ok('产物存在', false, `module=${haveModule} zones=${zoneFiles.length}（OUT_DIR=${OUT}）`);
  } else {
    console.log(`SKIP 产物段: module=${haveModule} zones=${zoneFiles.length}（OUT_DIR=${OUT}；--require-products 可强制）`);
  }
}
if (haveModule) {
  const glb = readGlb(fs.readFileSync(SST_GLB));
  // P1 暴露橙红（模块本地 bbox 射线）。只判 hall-interior__（室内构件）——hall-roof__sst-timber-darkred
  // （封檐板/檐口木，4416 tris）从正上方可见其顶边是设计意图（REFERENCE-NOTES 第 3 条：檐口红棕为江南
  // 常见做法），不构成巡检 #13 的"贴片色块"缺陷；巡检现象 = 室内构件穿顶露头。
  const t = trisOfMeshes(glb.meshes, /hall-interior__sst-timber-darkred/, true);
  ok('P1 前置: 模块 GLB 有 hall-interior__sst-timber-darkred 三角形', t.length > 0, `${t.length} tris`);
  // 遮挡体 = bbox 内所有非橙红三角形（屋面/墙等）。「首击无橙红」必须有屋面参与遮挡，
  // 否则被屋面盖住的室内梁架（合法存在）也会被记违规——判据 A 的语义是"暴露"，不是"存在"。
  const occ = trisOfMeshes(glb.meshes, /^(?!hall-interior__sst-timber-darkred)/, false);
  ok('P1 前置: 模块 GLB 有遮挡三角形（屋面等）', occ.length > 0, `${occ.length} tris`);
  const v = evalOrangeAssertions([...t, ...occ], [-9.9, 9.9, -7.3, 7.7]);
  ok('P1 模块 GLB: footprint 垂直射线首击无橙红室内构件（期望 0）', v.length === 0, `违规 ${v.length} 点 ${JSON.stringify(v.slice(0, 8))}`);
  // P2 main-beam 数量/位置/缩进
  const errs = evalBeamAssertions(glb);
  ok('P2 模块 GLB: main-beam 数量=4、柱位 ±1.9/±5.3、顶 6.7、背端 GLB zmin ≥ −5.85', errs.length === 0, errs.join('; '));
  // P3 名字↔颜色锁
  const mats = glb.gltf.materials.filter((m) => m.name === 'sst-timber-darkred');
  ok('P3 前置: 材质表含 sst-timber-darkred', mats.length > 0, `${mats.length}`);
  ok('P3 sst-timber-darkred baseColorFactor 在橙红域（名字↔颜色锁，判据 A 语义依据）',
    mats.every((m) => factorIsOrange(m.pbrMetallicRoughness?.baseColorFactor)),
    JSON.stringify(mats.map((m) => m.pbrMetallicRoughness?.baseColorFactor)));
}
if (zoneFiles.length > 0) {
  // P4 暴露橙红（分区件世界坐标，浏览器实际消费的资产）。同 P1 只判 hall-interior__。
  const X0 = -172.9, X1 = -152.0, Z0 = -190.1, Z1 = -171.6;
  let tris = [];
  let meshCount = 0;
  for (const zf of zoneFiles) {
    const g = readGlb(fs.readFileSync(path.join(OUT, zf)));
    for (const m of g.meshes) {
      if (!/hall-interior__sst-timber-darkred/.test(m.name)) continue;
      const P = [];
      for (let i = 0; i < m.positions.length; i += 3)
        P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
      // mesh AABB 与三穗堂 bbox 相交才收集
      let ax0 = 1e9, ax1 = -1e9, az0 = 1e9, az1 = -1e9, ay1 = -1e9;
      for (const p of P) { if (p[0] < ax0) ax0 = p[0]; if (p[0] > ax1) ax1 = p[0]; if (p[1] > ay1) ay1 = p[1]; if (p[2] < az0) az0 = p[2]; if (p[2] > az1) az1 = p[2]; }
      if (ax1 < X0 || ax0 > X1 || az1 < Z0 || az0 > Z1) continue;
      for (let i = 0; i + 2 < m.indices.length; i += 3) {
        const a = P[m.indices[i]], b = P[m.indices[i + 1]], c = P[m.indices[i + 2]];
        if (!a || !b || !c) throw new Error(`${zf}: mesh ${m.name} indices 越界（i=${i} posCount=${P.length}）`);
        tris.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2], orange: true });
      }
      meshCount++;
    }
  }
  ok('P4 前置: 分区件中有三穗堂室内 sst-timber-darkred mesh', meshCount >= 1, `${meshCount} meshes, ${tris.length} tris`);
  // 全量遮挡需要屋面 tri 参与：再收集 bbox 内所有非橙红 tri（不判违规，只当遮挡体）
  for (const zf of zoneFiles) {
    const g = readGlb(fs.readFileSync(path.join(OUT, zf)));
    for (const m of g.meshes) {
      if (/hall-interior__sst-timber-darkred/.test(m.name)) continue;
      const P = [];
      for (let i = 0; i < m.positions.length; i += 3)
        P.push(transformPoint(m.matrix, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
      let ax0 = 1e9, ax1 = -1e9, az0 = 1e9, az1 = -1e9, ay1 = -1e9;
      for (const p of P) { if (p[0] < ax0) ax0 = p[0]; if (p[0] > ax1) ax1 = p[0]; if (p[1] > ay1) ay1 = p[1]; if (p[2] < az0) az0 = p[2]; if (p[2] > az1) az1 = p[2]; }
      if (ax1 < X0 || ax0 > X1 || az1 < Z0 || az0 > Z1) continue;
      for (let i = 0; i + 2 < m.indices.length; i += 3) {
        const a = P[m.indices[i]], b = P[m.indices[i + 1]], c = P[m.indices[i + 2]];
        if (!a || !b || !c) throw new Error(`${zf}: mesh ${m.name} indices 越界（i=${i} posCount=${P.length}）`);
        tris.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2], orange: false });
      }
    }
  }
  const v4 = evalOrangeAssertions(tris, [X0, X1, Z0, Z1]);
  ok('P4 分区件: footprint 垂直射线首击无橙红室内构件（期望 0）', v4.length === 0, `违规 ${v4.length} 点 ${JSON.stringify(v4.slice(0, 8))}`);
}

// 断言计数下限（每组断言都要有计数下限，防零执行假绿）
ok('断言计数下限', pass + fail >= 8, `共 ${pass + fail} 条`);

console.log(`\nsansuitang-ridge-test: pass=${pass} fail=${fail}`);
if (fail > 0) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
