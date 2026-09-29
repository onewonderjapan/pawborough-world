// wave14-lantern（巡检 #17「灯笼简化为粉色蛋形」）红灯笼造型测试。
// 期望值全部从设计常量独立推导（LANTRN_PROF / 材质色 / 预算写死在下方并注明来源），
// 不读被测产物当真值；负例用合成/变异 GLB 证明每个判据能红（wave13-habaowin 反例驱动口径）。
// 被测集合从 modules/bazaar-tower-kit/params/*.json 的 features.lanterns 独立取；查到 0 个灯笼塔 = FAIL。
// 塔模型 out-bazaar-towers/<id>/model.glb 是登记的管线输入件：缺失 = FAIL（先跑标准重建），不静默跳过。
// 用法: OUT_DIR=out-zone node tests/lantern-shape-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const fails = [];
let passes = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { passes++; console.log(`PASS ${name}${detail ? ' ' + detail : ''}`); }
  else { fails.push(name + (detail ? ' ' + detail : '')); console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`); }
};

// ---------- 设计常量（来源：modules/bazaar-tower-kit/build_tower.py wave14-lantern 段） ----------
const DESIGN = {
  profRim: 0.42,          // LANTRN_PROF 端部（口沿）半径比
  profMid: 1.0,           // 中段半径比
  petalDelta: 0.05,       // LANTRN_PETAL 瓣鼓幅度（径向 ±5%）
  budgetPerLamp: 260,     // LANTERN_BUDGET_PER_LAMP（瘦身后导出实测 240/只；zone-bazaar-3.glb 10MB 口径反推：40 只 × >280 只会把分区件顶过 test_tower test6a 的 10_000_000 B）
  tasselTrisPerLamp: 24,  // 3 根 3 边 cyl（n-gon caps = n−2 tri）= 3 × 8
  handleTrisPerLamp: 24,  // 2 段 4 边 cyl（左 mount→apex→右 mount）= 2 × 12
  ribTrisPerLamp: 32,     // 4 条 quad strip（5 环 4 段）= 4 × 8
  capGapMax: 0.15,        // 灯盖顶 y − 灯身顶 y 设计差 = cap_h = rr×0.16 ∈ [0.045,0.048]；容差窗 [−0.02, +0.15]。
                          // 抓「灯身掉地面、灯盖留在檐口」类错位（2026-09-29 实际发生：lantern_body 传 z=0.0）
  ribCrestFrac: 0.8,      // 骨架棱中段顶点位于瓣脊高程（body 中段最大半径 −0.003）的占比下限。抓「棱放在瓣谷
                          // （cos(6θ)=−1）、整条沉在谷里被凸鼓面自身遮挡」——2026-09-29 R2 实际发生：
                          // 注释写 π/6+kπ/3 是瓣峰，实为瓣谷，棱白天黑夜都不可见
  bodyMatSuffix: 'lanterns-body', capPart: 'lanterns-cap', tasselPart: 'lanterns-tassel',
  handlePart: 'lanterns-handle', ribPart: 'lanterns-rib', cordPart: 'lanterns-cord',
  // lanternRed 设计色 #c8301f（build_tower.py FM.get('lanternRed','c8301f')；params/*.json 无覆盖——2026-09-29 全查）：
  // sRGB (200,48,31) → hue≈7.4°, S≈0.85, V≈0.78。判据窗 ±10° / S≥0.60 / V≥0.30。
  hueDeg: 7.4, hueTol: 10, minS: 0.60, minV: 0.30,
};

// ---------- GLB 解析 ----------
function parseGlb(p) {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(p + ': not GLB');
  const jl = buf.readUInt32LE(12);
  const j = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  let bin = null;
  const blOff = 20 + jl;                              // 第二个 chunk：length 在 +0、type 在 +4、data 在 +8
  if (buf.readUInt32LE(blOff + 4) === 0x004e4942) {   // 'BIN\0'（Blender glTF 导出的 chunk 标记，实测 42494e00）
    const bl = buf.readUInt32LE(blOff + 0);
    bin = buf.subarray(blOff + 8, blOff + 8 + bl);
  }
  return { json: j, bin };
}
function meshTris(g, meshIdx) {
  const m = g.json.meshes[meshIdx];
  return m.primitives.reduce((a, pr) => a + g.json.accessors[pr.indices].count / 3, 0);
}
function readPositions(g, meshIdx) {
  const pr = g.json.meshes[meshIdx].primitives[0];
  const acc = g.json.accessors[pr.attributes.POSITION];
  const bv = g.json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const f32 = new Float32Array(g.bin.buffer, g.bin.byteOffset + off, acc.count * 3);
  return Array.from(f32);
}
// 节点名（part__material）→ { meshIdx, matName }
function nodeByName(g) {
  const map = new Map();
  for (const n of g.json.nodes || []) {
    if (n.mesh == null) continue;
    const mesh = g.json.meshes[n.mesh];
    const mat = mesh.primitives[0].material;
    map.set(n.name || `mesh#${n.mesh}`, { meshIdx: n.mesh, matName: mat == null ? null : (g.json.materials[mat].name || '') });
  }
  return map;
}

// ---------- 判据函数（真产物与负例共用） ----------
// 半径一律相对「本灯聚类中心」：塔 GLB 顶点是世界坐标（x≈−187…−140），
// 到原点距离 ≈190m 会把口沿比/瓣差稀释成假绿（2026-09-29 修正前 rim/r 恒 ≈1.00 的根因）。
// 塔 GLB export_yup=True → 高度轴 = y（分量 +1）；半径平面 = (x,z)。
const U = 1, A = 0, B = 2;
function rimRatio(verts) {
  // 顶环带（高 ≥ hMax − 4% 高度带）最大半径 / 本体最大半径。鼓形口沿 ≈0.38–0.42；蛋形（端部收尖）→≈0。
  let hMin = Infinity, hMax = -Infinity, rMax = 0;
  const cx = [], cz = [];
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < verts.length; i += 3) {
    hMin = Math.min(hMin, verts[i + U]); hMax = Math.max(hMax, verts[i + U]);
    sx += verts[i + A]; sz += verts[i + B]; n++;
  }
  const ccx = sx / n, ccz = sz / n;
  for (let i = 0; i < verts.length; i += 3) rMax = Math.max(rMax, Math.hypot(verts[i + A] - ccx, verts[i + B] - ccz));
  const band = hMax - (hMax - hMin) * 0.04;
  let rim = 0;
  for (let i = 0; i < verts.length; i += 3) {
    if (verts[i + U] >= band) rim = Math.max(rim, Math.hypot(verts[i + A] - ccx, verts[i + B] - ccz));
  }
  return rim / (rMax || 1);
}
function petalDeltaFrac(verts) {
  // 中段环带（45–55% 高）的径向峰谷差 / 本体最大半径。瓜棱鼓身 ≈8–10%（10 边采样 6 瓣 ±5%）；光滑球 ≈0。
  const hs = [];
  let hMin = Infinity, hMax = -Infinity, rMax = 0, sx = 0, sz = 0;
  const n = verts.length / 3;
  for (let i = 0; i < verts.length; i += 3) {
    hs.push(verts[i + U]); hMin = Math.min(hMin, verts[i + U]); hMax = Math.max(hMax, verts[i + U]);
    sx += verts[i + A]; sz += verts[i + B];
  }
  const ccx = sx / n, ccz = sz / n;
  const lo = hMin + (hMax - hMin) * 0.45, hi = hMin + (hMax - hMin) * 0.55;
  let rMinBand = Infinity;
  for (let i = 0; i < hs.length; i++) {
    const r = Math.hypot(verts[i * 3 + A] - ccx, verts[i * 3 + B] - ccz);
    rMax = Math.max(rMax, r);
    if (hs[i] >= lo && hs[i] <= hi) rMinBand = Math.min(rMinBand, r);
  }
  return (rMax - rMinBand) / (rMax || 1);
}
// 骨架棱位于瓣峰高程：单灯 body/rib 顶点切片 → body 中段环带（45–55% 高）最大半径 = 瓣脊高程。
// rib 中段顶点半径 ≥ 瓣脊高程 − 0.003 的占比。棱在瓣峰 → ≈1（不被邻瓣遮挡）；
// 棱在瓣谷 → 谷底 +0.008 仍低于瓣脊 ≈0.02r → 占比 ≈0（凸鼓面自身遮挡，白天黑夜都看不见——R2 实际 bug 形态）。
function ribProudFrac(bodyVerts, ribVerts) {
  let sx = 0, sz = 0, n = 0, hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < bodyVerts.length; i += 3) {
    sx += bodyVerts[i + A]; sz += bodyVerts[i + B]; n++;
    hMin = Math.min(hMin, bodyVerts[i + U]); hMax = Math.max(hMax, bodyVerts[i + U]);
  }
  const cx = sx / n, cz = sz / n;
  const lo = hMin + (hMax - hMin) * 0.45, hi = hMin + (hMax - hMin) * 0.55;
  let crest = 0;
  for (let i = 0; i < bodyVerts.length; i += 3) {
    const y = bodyVerts[i + U]; if (y < lo || y > hi) continue;
    crest = Math.max(crest, Math.hypot(bodyVerts[i + A] - cx, bodyVerts[i + B] - cz));
  }
  let proud = 0, tot = 0;
  for (let i = 0; i < ribVerts.length; i += 3) {
    const y = ribVerts[i + U]; if (y < lo || y > hi) continue;
    tot++;
    if (Math.hypot(ribVerts[i + A] - cx, ribVerts[i + B] - cz) >= crest - 0.003) proud++;
  }
  return tot ? proud / tot : 0;
}
function srgbHsv(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const rgb = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  const mx = Math.max(...rgb), mn = Math.min(...rgb), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === rgb[0]) h = 60 * (((rgb[1] - rgb[2]) / d) % 6);
    else if (mx === rgb[1]) h = 60 * ((rgb[2] - rgb[0]) / d + 2);
    else h = 60 * ((rgb[0] - rgb[1]) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}
function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function matBaseSrgb(g, matName) {
  const m = g.json.materials.find(m => m.name === matName);
  if (!m || !m.pbrMetallicRoughness || !m.pbrMetallicRoughness.baseColorFactor) return null;
  return m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).map(linearToSrgb).map(v => Math.round(v * 255) / 255);
}
function bodyColorJudge(g, bodyMatName) {
  const srgb = matBaseSrgb(g, bodyMatName);
  if (!srgb) return { bad: 'no baseColorFactor' };
  const hex = '#' + srgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const { h, s, v } = srgbHsv(hex);
  let dh = Math.abs(h - DESIGN.hueDeg); if (dh > 180) dh = 360 - dh;
  if (dh > DESIGN.hueTol) return { bad: `hue ${h.toFixed(1)}° ∉ 设计 ${DESIGN.hueDeg}°±${DESIGN.hueTol}° (${hex})` };
  if (s < DESIGN.minS) return { bad: `饱和度 S ${s.toFixed(2)} < ${DESIGN.minS}（粉色/低饱和注入）(${hex})` };
  if (v < DESIGN.minV) return { bad: `明度 V ${v.toFixed(2)} < ${DESIGN.minV} (${hex})` };
  return { good: `${hex} hue ${h.toFixed(1)}° S ${s.toFixed(2)} V ${v.toFixed(2)}` };
}
// 灯聚类：body 顶点 3D 格哈希聚类（单灯宽 0.63m，灯距 pitch≥3.4m → 邻域合并只发生在同灯内；
// 多 run 塔（runs=street 的 yuebin 沿两条街）灯不在同一轴线上，单轴量化会把不同边的灯并簇——3D 距离才成立）。
// 返回簇数组（每簇 = 展平 xyz 数组），灯数 = 簇数；rim/petal 逐簇判据直接复用簇。
function lampClusters(verts) {
  // 格 0.7m：单灯最大跨 0.63m < 0.7（同灯必在 ±1 邻域内连通）；灯间最小边缘距
  // pitch3.4 − 0.63 = 2.77m > 2.1m（±1 邻域的最大连通距离）→ 灯间必不连通
  const CELL = 0.7;
  const grid = new Map();
  const pts = [];
  for (let i = 0; i < verts.length; i += 3) {
    const p = [verts[i], verts[i + 1], verts[i + 2]];
    p._seen = false;                       // 标记挂在对象上：flat 导出同一坐标复制多份顶点，按引用标记才不漏
    pts.push(p);
    const k = p.map(v => Math.floor(v / CELL)).join(',');
    (grid.get(k) || grid.set(k, []).get(k)).push(p);
  }
  const neighbors = (p) => {
    const out = [];
    const g = p.map(v => Math.floor(v / CELL));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = grid.get(`${g[0] + dx},${g[1] + dy},${g[2] + dz}`);
      if (cell) out.push(...cell);
    }
    return out;
  };
  const clusters = [];
  for (const start of pts) {
    if (start._seen) continue;
    const comp = [];
    start._seen = true;
    const queue = [start];
    while (queue.length) {
      const p = queue.pop();
      comp.push(p[0], p[1], p[2]);
      for (const q of neighbors(p)) {
        if (!q._seen) { q._seen = true; queue.push(q); }
      }
    }
    clusters.push(comp);
  }
  return clusters;
}

// ---------- 合成负例（每个判据配一个明显错误输入） ----------
function synthGlbJson({ rim, petal, colorHex, withTassel, withCap, bodyDropY, ribAt }) {
  // 7 环 12 边鼓/蛋合成体：rim 控制端部收口比，petal 控制径向峰谷差；bodyDropY 整体压低灯身（挂高错位负例）
  const verts = [];
  const prof = rim == null ? [0.42, 0.78, 0.97, 1.0, 0.97, 0.78, 0.42] : [rim, rim + (1 - rim) * 0.6, 1, 1, 1, rim + (1 - rim) * 0.6, rim];
  const H = 0.63;
  prof.forEach((pr, i) => {
    const h = -H / 2 + H * i / (prof.length - 1) + (bodyDropY || 0);
    for (let j = 0; j < 12; j++) {
      const th = 2 * Math.PI * j / 12;
      const rad = 0.3 * pr * (1 + (petal || 0) * Math.cos(6 * th));
      verts.push(+(rad * Math.cos(th)).toFixed(4), +h.toFixed(4), +(rad * Math.sin(th)).toFixed(4));
    }
  });
  // 顶/底心点（y-up：高度在 y 分量）
  verts.push(0, H / 2 + (bodyDropY || 0), 0); verts.push(0, -H / 2 + (bodyDropY || 0), 0);
  const idx = [];
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < 12; j++) {
    const a = i * 12 + j, b = i * 12 + (j + 1) % 12, c = (i + 1) * 12 + (j + 1) % 12, d = (i + 1) * 12 + j;
    idx.push(a, b, c, a, c, d);
  }
  const topC = prof.length * 12, botC = prof.length * 12 + 1;
  for (let j = 0; j < 12; j++) { const j2 = (j + 1) % 12; idx.push(topC, j, j2); idx.push(botC, prof.length * 12 + j2, prof.length * 12 + j); }
  const pos = Buffer.from(Float32Array.from(verts).buffer);
  const ind = Buffer.from(Uint32Array.from(idx).buffer);
  const binLen = pos.length + ind.length;
  const mats = [{ name: 'btk-lantern', pbrMetallicRoughness: { baseColorFactor: [0.5776, 0.0296, 0.0137, 1] } }];
  if (colorHex) {
    const n = parseInt(colorHex.replace('#', ''), 16);
    // baseColorFactor 是 linear：注入目标 sRGB 颜色需 sRGB→linear
    mats[0].pbrMetallicRoughness.baseColorFactor = [srgbToLinear((n >> 16 & 255) / 255), srgbToLinear((n >> 8 & 255) / 255), srgbToLinear((n & 255) / 255), 1];
  }
  const meshes = [{ name: 'body', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }];
  if (withTassel) meshes.push({ name: 't', primitives: [{ attributes: { POSITION: 2 }, indices: 3, material: 0 }] });
  const accessors = [
    { bufferView: 0, componentType: 5126, count: verts.length / 3, type: 'VEC3', min: [-0.4, -0.4, -0.4], max: [0.4, 0.4, 0.4] },
    { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' },
  ];
  const bufferViews = [
    { buffer: 0, byteOffset: 0, byteLength: pos.length },
    { buffer: 0, byteOffset: pos.length, byteLength: ind.length },
  ];
  let extraNodes = withTassel ? [{ name: 'lanterns-tassel__lantern', mesh: 1 }] : [];
  if (withCap) {
    // 灯盖合成：两根小梁组成的盖段，y ∈ [0.34, 0.38]（贴在未压低的灯身顶 0.315 之上 → 正例 gap=0.065 ∈ 窗）
    const cp = Buffer.from(Float32Array.from([-0.1, 0.34, -0.1, 0.1, 0.34, -0.1, 0.1, 0.38, -0.1, -0.1, 0.38, -0.1]).buffer);
    const ci = Buffer.from(Uint32Array.from([0, 1, 2, 0, 2, 3]).buffer);
    const capMeshIdx = meshes.length;
    meshes.push({ name: 'cap', primitives: [{ attributes: { POSITION: accessors.length }, indices: accessors.length + 1, material: 0 }] });
    accessors.push({ bufferView: bufferViews.length, componentType: 5126, count: 4, type: 'VEC3', min: [-0.1, 0.34, -0.1], max: [0.1, 0.38, 0.1] });
    accessors.push({ bufferView: bufferViews.length + 1, componentType: 5125, count: 6, type: 'SCALAR' });
    bufferViews.push({ buffer: 0, byteOffset: -1, byteLength: cp.length });   // byteOffset 下面 concat 后修正
    bufferViews.push({ buffer: 0, byteOffset: -1, byteLength: ci.length });
    extraNodes = [...extraNodes, { name: 'lanterns-cap__gild', mesh: capMeshIdx }];
    var capPos = cp, capIdx = ci;
  }
  if (withTassel) {
    const tp = Buffer.from(Float32Array.from([0, -0.5, 0, 0, -0.8, 0]).buffer);
    const ti = Buffer.from(Uint32Array.from([0, 1, 1]).buffer); // 退化三根合成不可判 —— 用 36 个退化 tri 代表穗账目
    const ti2 = Buffer.alloc(4 * 36 * 3); const u32 = new Uint32Array(ti2.buffer); for (let i = 0; i < 108; i++) u32[i] = 0;
    accessors.push({ bufferView: 2, componentType: 5126, count: 2, type: 'VEC3', min: [0, 0, -0.8], max: [0, 0, -0.5] });
    accessors.push({ bufferView: 3, componentType: 5125, count: 108, type: 'SCALAR' });
    bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: tp.length });
    bufferViews.push({ buffer: 0, byteOffset: binLen + tp.length, byteLength: ti2.length });
    meshes[1].primitives[0].attributes.POSITION = 2; meshes[1].primitives[0].indices = 3;
    var binBuf = Buffer.concat([pos, ind, tp, ti2]);
  } else {
    var binBuf = Buffer.concat([pos, ind]);
  }
  if (withCap) {
    // 把盖的 bufferView 指到 concat 后的真实偏移
    const off = binBuf.length;
    bufferViews[bufferViews.length - 2].byteOffset = off;
    bufferViews[bufferViews.length - 1].byteOffset = off + capPos.length;
    binBuf = Buffer.concat([binBuf, capPos, capIdx]);
  }
  if (ribAt) {
    // 骨架棱合成：θc = valley(π/6, cos6θ=−1) 或 peak(0, +1)，列半径仿生成器公式（列各自角 + 偏置）
    const thC = ribAt === 'valley' ? Math.PI / 6 : 0;
    const prof5 = [0.42, 0.85, 1.0, 0.85, 0.42];
    const H5 = 0.63, halfW = 0.05 / 0.3, ribOff = ribAt === 'valley' ? 0.008 : 0.012;
    const rp = [], ri = [];
    const cols = [[], []];
    prof5.forEach((pr, i) => {
      const h = -H5 / 2 + H5 * i / (prof5.length - 1);
      for (let s = 0; s < 2; s++) {
        const th = thC + (s ? halfW : -halfW);
        const rad = 0.3 * pr * (1 + 0.05 * Math.cos(6 * th)) + ribOff;
        rp.push(+(rad * Math.cos(th)).toFixed(5), +h.toFixed(4), +(rad * Math.sin(th)).toFixed(5));
        cols[s].push(i * 2 + s);
      }
    });
    for (let i = 0; i < prof5.length - 1; i++) ri.push(cols[0][i], cols[1][i], cols[1][i + 1], cols[0][i], cols[1][i + 1], cols[0][i + 1]);
    const rpos = Buffer.from(Float32Array.from(rp).buffer);
    const rind = Buffer.from(Uint32Array.from(ri).buffer);
    const meshIdx0 = meshes.length;
    meshes.push({ name: 'rib', primitives: [{ attributes: { POSITION: accessors.length }, indices: accessors.length + 1, material: 0 }] });
    accessors.push({ bufferView: bufferViews.length, componentType: 5126, count: rp.length / 3, type: 'VEC3', min: [-0.4, -0.4, -0.4], max: [0.4, 0.4, 0.4] });
    accessors.push({ bufferView: bufferViews.length + 1, componentType: 5125, count: ri.length, type: 'SCALAR' });
    bufferViews.push({ buffer: 0, byteOffset: -1, byteLength: rpos.length });
    bufferViews.push({ buffer: 0, byteOffset: -1, byteLength: rind.length });
    extraNodes = [...extraNodes, { name: 'lanterns-rib__dark', mesh: meshIdx0 }];
    var ribPosBuf = rpos, ribIdxBuf = rind;
  }
  if (ribAt) {
    const off = binBuf.length;
    bufferViews[bufferViews.length - 2].byteOffset = off;
    bufferViews[bufferViews.length - 1].byteOffset = off + ribPosBuf.length;
    binBuf = Buffer.concat([binBuf, ribPosBuf, ribIdxBuf]);
  }
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, ...extraNodes.map((_, i) => i + 1)] }],
    nodes: [{ name: 'lanterns-body__lantern', mesh: 0 }, ...extraNodes],
    meshes, accessors, bufferViews, materials: mats,
    buffers: [{ byteLength: binBuf.length }], bufferViews: bufferViews.map(b => ({ ...b, buffer: 0 })) };
  return { json, bin: binBuf };
}

// ---------- 主流程 ----------
const paramsDir = path.join(ROOT, 'modules', 'bazaar-tower-kit', 'params');
const lanternTowers = fs.readdirSync(paramsDir).filter(f => f.endsWith('.json')).map(f => {
  const d = JSON.parse(fs.readFileSync(path.join(paramsDir, f), 'utf8'));
  return d.features && d.features.lanterns ? { id: d.id, file: f } : null;
}).filter(Boolean);
ok(lanternTowers.length >= 1, '被测集合非空（params features.lanterns ≥1）', `found=${lanternTowers.length}`);

const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'lighting', 'presets.json'), 'utf8'));
const lanternGroup = presets.emissiveGroups.find(g => g.id === 'lantern');
ok(!!lanternGroup && lanternGroup.materials.includes('btk-lantern'), 'presets lantern 组仍含 btk-lantern（组数值未改）',
   lanternGroup ? `materials=${JSON.stringify(lanternGroup.materials)} color=${lanternGroup.color} intensity=${lanternGroup.intensity}` : 'group missing');
// 组数值冻结断言（基线 a2bc8104 的 lantern 组 = #ff7a3c / 3.0 / useMap false；本单禁改组数值，防漂移）
ok(lanternGroup && lanternGroup.color === '#ff7a3c' && lanternGroup.intensity === 3.0 && lanternGroup.useMap === false,
   'lantern 组数值与基线一致（#ff7a3c ×3.0 useMap=false）',
   lanternGroup ? `color=${lanternGroup.color} intensity=${lanternGroup.intensity}` : 'group missing');

let lampTotal = 0;
for (const t of lanternTowers) {
  const glbPath = path.join(ROOT, 'out-bazaar-towers', t.id, 'model.glb');
  if (!fs.existsSync(glbPath)) { ok(false, `${t.id}: 塔 GLB 存在`, `${glbPath} 缺失（先跑标准重建）`); continue; }
  const g = parseGlb(glbPath);
  const nodes = nodeByName(g);
  const byPart = (pre) => [...nodes.keys()].filter(k => k.startsWith(pre));
  const bodyKeys = byPart(DESIGN.bodyMatSuffix);
  ok(bodyKeys.length === 1, `${t.id}: 灯笼主体节点存在（${DESIGN.bodyMatSuffix}__*）`, bodyKeys.join(',') || 'missing');
  if (bodyKeys.length !== 1) continue;   // 该塔判据已红，后续几何判据无从执行

  const body = nodes.get(bodyKeys[0]);
  const verts = readPositions(g, body.meshIdx);
  const clusters = lampClusters(verts);
  const nLamps = clusters.length;
  lampTotal += nLamps;
  ok(nLamps >= 1, `${t.id}: 灯数（body 顶点聚类独立推）`, `lamps=${nLamps}`);

  // 鼓形：口沿比 + 瓣差，逐灯判（取全灯最差值）；负例见文末合成注入
  const rim = Math.min(...clusters.map(c => rimRatio(c)));
  ok(rim >= DESIGN.profRim * 0.6, `${t.id}: 鼓形口沿（端部硬收口，非蛋形尖端，逐灯最差）`, `rim/r=${rim.toFixed(2)} ≥ ${(DESIGN.profRim * 0.6).toFixed(2)}`);
  const pd = Math.min(...clusters.map(c => petalDeltaFrac(c)));
  ok(pd >= DESIGN.petalDelta * 0.6, `${t.id}: 纵向瓜棱（径向峰谷差，逐灯最差）`, `Δr/r=${(pd * 100).toFixed(1)}% ≥ ${(DESIGN.petalDelta * 0.6 * 100).toFixed(0)}%`);

  // 灯身-灯盖贴邻（挂高一致）：设计上灯盖顶 = 灯身顶 + cap_h（rr×0.16 ∈ [0.045,0.048]）。
  // 抓「灯身掉在地面 z=0、灯盖留在檐口」类错位（2026-09-29 lantern_body 传 z=0.0 实际事故）。
  {
    const capKeysPre = byPart(DESIGN.capPart);
    const bodyTop = Math.max(...verts.filter((_, i) => i % 3 === U));
    let capTop = null;
    if (capKeysPre.length) {
      const cv = readPositions(g, nodes.get(capKeysPre[0]).meshIdx);
      capTop = Math.max(...cv.filter((_, i) => i % 3 === U));
    }
    const gap = capTop == null ? null : capTop - bodyTop;
    ok(gap != null && gap >= -0.02 && gap <= DESIGN.capGapMax,
       `${t.id}: 灯身-灯盖贴邻（挂高一致，盖顶−身顶 ∈ [−0.02,${DESIGN.capGapMax}]）`,
       gap == null ? 'cap 节点缺失' : `gap=${gap.toFixed(3)}（身顶 y=${bodyTop.toFixed(2)} 盖顶 y=${capTop.toFixed(2)}）`);
  }

  // 主体色相（从设计色 #c8301f 推红范围）
  const col = bodyColorJudge(g, body.matName);
  ok(!!col.good, `${t.id}: 主体色相红色范围（设计色 #c8301f ±10°，S≥${DESIGN.minS}）`, col.good || col.bad);

  // 部件 + 账目
  const tasselKeys = byPart(DESIGN.tasselPart), capKeys = byPart(DESIGN.capPart),
    handleKeys = byPart(DESIGN.handlePart), ribKeys = byPart(DESIGN.ribPart), cordKeys = byPart(DESIGN.cordPart);
  ok(tasselKeys.length === 1 && capKeys.length === 1 && handleKeys.length === 1 && ribKeys.length === 1 && cordKeys.length === 1,
    `${t.id}: 灯盖/穗/提梁/骨架/吊线节点齐全`, `tassel=${tasselKeys.length} cap=${capKeys.length} handle=${handleKeys.length} rib=${ribKeys.length} cord=${cordKeys.length}`);
  let totalTris = meshTris(g, body.meshIdx);
  for (const k of [...tasselKeys, ...capKeys, ...handleKeys, ...ribKeys, ...cordKeys]) totalTris += meshTris(g, nodes.get(k).meshIdx);
  // 骨架棱凸出瓣面：rib 簇 → 最近 body 簇（灯轴），逐簇判中段环带凸出占比，取最差
  {
    const ribVertsAll = ribKeys.length ? readPositions(g, nodes.get(ribKeys[0]).meshIdx) : [];
    const ribClusters = ribVertsAll.length ? lampClusters(ribVertsAll) : [];
    const bCtr = clusters.map(c => { let sx = 0, sz = 0, n = 0; for (let i = 0; i < c.length; i += 3) { sx += c[i]; sz += c[i + 2]; n++; } return [sx / n, sz / n]; });
    let worst = 1, pairs = 0;
    for (const rc of ribClusters) {
      if (rc.length / 3 < 8) continue;
      let sx = 0, sz = 0, n = 0; for (let i = 0; i < rc.length; i += 3) { sx += rc[i]; sz += rc[i + 2]; n++; }
      const cx = sx / n, cz = sz / n;
      let bi = 0, bd = Infinity;
      bCtr.forEach((c, i) => { const d = (c[0] - cx) ** 2 + (c[1] - cz) ** 2; if (d < bd) { bd = d; bi = i; } });
      worst = Math.min(worst, ribProudFrac(clusters[bi], rc));
      pairs++;
    }
    ok(pairs >= 1 && worst >= DESIGN.ribCrestFrac,
       `${t.id}: 骨架棱位于瓣脊高程（逐簇最差占比 ≥ ${DESIGN.ribCrestFrac}）`,
       pairs ? `worst=${(worst * 100).toFixed(0)}% ribClusters=${pairs}` : 'rib 簇缺失');
  }
  const tasselTris = tasselKeys.length ? meshTris(g, nodes.get(tasselKeys[0]).meshIdx) : 0;
  const handleTris = handleKeys.length ? meshTris(g, nodes.get(handleKeys[0]).meshIdx) : 0;
  const ribTris = ribKeys.length ? meshTris(g, nodes.get(ribKeys[0]).meshIdx) : 0;
  ok(tasselTris >= DESIGN.tasselTrisPerLamp * nLamps * 0.8, `${t.id}: 穗子账目`, `tasselTris=${tasselTris} ≥ ${Math.round(DESIGN.tasselTrisPerLamp * nLamps * 0.8)}（${nLamps} 只）`);
  ok(handleTris >= DESIGN.handleTrisPerLamp * nLamps * 0.8, `${t.id}: 提梁账目`, `handleTris=${handleTris}`);
  ok(ribTris >= DESIGN.ribTrisPerLamp * nLamps * 0.8, `${t.id}: 骨架棱账目`, `ribTris=${ribTris}`);
  const perLamp = totalTris / nLamps;
  ok(totalTris <= DESIGN.budgetPerLamp * nLamps, `${t.id}: 每只三角预算 ≤ ${DESIGN.budgetPerLamp}`, `perLamp=${perLamp.toFixed(0)} total=${totalTris}`);
}

ok(lampTotal >= 30, '灯笼总数（两塔合计，设计账 14+26=40）', `total=${lampTotal}`);

// 组命中（分区 cm 件材质名存活——compress-zones 保护集口径）
const bzCm = path.join(OUT, 'zone-bazaar-3.cm.glb');
if (!fs.existsSync(bzCm)) { ok(false, 'zone-bazaar-3.cm.glb 存在', `${bzCm} 缺失（OUT_DIR=out-zone 标准重建后重跑）`); }
else {
  const g = parseGlb(bzCm);
  const names = (g.json.materials || []).map(m => m.name || '');
  ok(names.some(n => n.startsWith('btk-lantern')), '分区 cm 件 lantern 组命中：btk-lantern 名字存活', `hit=${names.filter(n => n.startsWith('btk-lantern')).join(',')}`);
}
const fbCms = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.startsWith('zone-fangbang-') && f.endsWith('.cm.glb')) : [];
ok(fbCms.length >= 1, 'zone-fangbang-*.cm.glb 存在', fbCms.join(','));
let fbHit = false;
for (const f of fbCms) {
  const g = parseGlb(path.join(OUT, f));
  const names = (g.json.materials || []).map(m => m.name || '');
  if (names.some(n => n.startsWith('red-silk-lantern'))) fbHit = true;
}
ok(fbHit, '分区 cm 件 lantern 组命中：red-silk-lantern 名字存活（方浜来源只读断言）');

// ---------- 负例：明显错误输入必须红 ----------
// N0 设计色注入（正例对照：判据对正确输入必须绿——证明判据非恒红）
{
  const g = synthGlbJson({ colorHex: '#c8301f' });
  const col = bodyColorJudge(g, 'btk-lantern');
  ok(!!col.good, '正例N0 设计色 #c8301f 注入 → 色相判据绿（判据非恒红）', col.good || col.bad);
}
// N1 粉色注入（低饱和粉 #ff9aa2：巡检「粉」的量化形态）→ 色相判据红
{
  const g = synthGlbJson({ colorHex: '#ff9aa2' });
  const col = bodyColorJudge(g, 'btk-lantern');
  ok(!!col.bad, '负例N1 粉色注入 → 色相判据红', col.bad || `unexpectedly green: ${col.good}`);
}
// N2 绿色注入（明显错误色相）→ 色相判据红
{
  const g = synthGlbJson({ colorHex: '#22aa33' });
  const col = bodyColorJudge(g, 'btk-lantern');
  ok(!!col.bad, '负例N2 绿色注入 → 色相判据红', col.bad || `unexpectedly green: ${col.good}`);
}
// N3 蛋形注入（端部收尖 rim=0.06）→ 口沿判据红
{
  const g = synthGlbJson({ rim: 0.06 });
  const r = rimRatio(readPositions(g, 0));
  ok(r < DESIGN.profRim * 0.6, '负例N3 蛋形（端部收尖）→ 口沿判据红', `rim/r=${r.toFixed(2)}`);
}
// N4 光滑球注入（petal=0）→ 瓜棱判据红
{
  const g = synthGlbJson({ petal: 0 });
  const pd = petalDeltaFrac(readPositions(g, 0));
  ok(pd < DESIGN.petalDelta * 0.6, '负例N4 光滑球（无瓜棱）→ 瓣差判据红', `Δr/r=${(pd * 100).toFixed(1)}%`);
}
// N5 删穗注入 → 穗判据红（节点缺失）
{
  const g = synthGlbJson({});
  const names = [...nodeByName(g).keys()];
  ok(!names.some(n => n.startsWith(DESIGN.tasselPart)), '负例N5 无穗合成体 → 穗节点判据可检缺失（真产物要求其存在）', names.join(','));
}
// N6 挂高错位注入（灯身压低 5m、灯盖留在原位）→ 贴邻判据红；对照：不压低时绿（判据非恒红）
{
  const gOk = synthGlbJson({ withCap: true });
  const capOk = nodeByName(gOk).get('lanterns-cap__gild');
  const bodyOk = readPositions(gOk, 0);
  const btOk = Math.max(...bodyOk.filter((_, i) => i % 3 === U));
  const ctOk = Math.max(...readPositions(gOk, capOk.meshIdx).filter((_, i) => i % 3 === U));
  const gapOk = ctOk - btOk;
  ok(gapOk >= -0.02 && gapOk <= DESIGN.capGapMax, '正例N6a 贴邻合成体（盖在身顶上）→ 贴邻判据绿', `gap=${gapOk.toFixed(3)}`);
  const gBad = synthGlbJson({ withCap: true, bodyDropY: -5 });
  const capBad = nodeByName(gBad).get('lanterns-cap__gild');
  const bodyBad = readPositions(gBad, 0);
  const btBad = Math.max(...bodyBad.filter((_, i) => i % 3 === U));
  const ctBad = Math.max(...readPositions(gBad, capBad.meshIdx).filter((_, i) => i % 3 === U));
  const gapBad = ctBad - btBad;
  ok(!(gapBad >= -0.02 && gapBad <= DESIGN.capGapMax), '负例N6b 灯身压低 5m → 贴邻判据红', `gap=${gapBad.toFixed(3)}`);
}
// N7 骨架棱位置：瓣谷注入（R2 实际 bug 形态：谷底 +0.008 仍低于瓣脊，被凸鼓面遮挡）→ 判据红；瓣峰对照 → 绿。
// petal:0.05 必带——判据的「瓣脊高程」只在有瓣鼓的鼓身上才有意义（真实产物 Δr/r=8.6%）
{
  const gV = synthGlbJson({ ribAt: 'valley', petal: 0.05 });
  const rbV = nodeByName(gV).get('lanterns-rib__dark');
  const fV = ribProudFrac(readPositions(gV, 0), readPositions(gV, rbV.meshIdx));
  ok(fV < DESIGN.ribCrestFrac, '负例N7a 棱在瓣谷 → 瓣脊高程判据红', `frac=${(fV * 100).toFixed(0)}%`);
  const gP = synthGlbJson({ ribAt: 'peak', petal: 0.05 });
  const rbP = nodeByName(gP).get('lanterns-rib__dark');
  const fP = ribProudFrac(readPositions(gP, 0), readPositions(gP, rbP.meshIdx));
  ok(fP >= DESIGN.ribCrestFrac, '正例N7b 棱在瓣峰 → 瓣脊高程判据绿（判据非恒红）', `frac=${(fP * 100).toFixed(0)}%`);
}

console.log(`\nlantern-shape: ${passes} pass, ${fails.length} fail`);
if (fails.length) { console.log('FAILURES:\n' + fails.map(f => '  - ' + f).join('\n')); process.exit(1); }
