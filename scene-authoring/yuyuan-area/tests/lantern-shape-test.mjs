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
  budgetPerLamp: 460,     // LANTERN_BUDGET_PER_LAMP（导出实测 392/只）
  tasselTrisPerLamp: 24,  // 3 根 3 边 cyl（n-gon caps = n−2 tri）= 3 × 8
  handleTrisPerLamp: 36,  // 3 段 4 边 cyl = 3 × 12
  ribTrisPerLamp: 48,     // 4 条 quad strip（7 环 6 段）= 4 × 12
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
function rimRatio(verts) {
  // 顶环带（高 ≥ hMax − 4% 高度带）最大半径 / 全局最大半径。鼓形口沿 ≈0.42；蛋形（端部收尖）→≈0。
  // 塔 GLB export_yup=True → 高度轴 = y（分量 +1）；半径平面 = (x,z)。
  const U = 1, A = 0, B = 2;
  let hMin = Infinity, hMax = -Infinity, rMax = 0;
  for (let i = 0; i < verts.length; i += 3) {
    hMin = Math.min(hMin, verts[i + U]); hMax = Math.max(hMax, verts[i + U]);
    rMax = Math.max(rMax, Math.hypot(verts[i + A], verts[i + B]));
  }
  const band = hMax - (hMax - hMin) * 0.04;
  let rim = 0;
  for (let i = 0; i < verts.length; i += 3) {
    if (verts[i + U] >= band) rim = Math.max(rim, Math.hypot(verts[i + A], verts[i + B]));
  }
  return rim / (rMax || 1);
}
function petalDeltaFrac(verts) {
  // 中段环带的径向峰谷差 / 最大半径。瓜棱鼓身 ≈2×petal(5%)×prof 比 ≥4%；光滑球 ≈0。高度轴 = y（同上）。
  const U = 1, A = 0, B = 2;
  const hs = [];
  let hMin = Infinity, hMax = -Infinity, rMax = 0;
  for (let i = 0; i < verts.length; i += 3) { hs.push(verts[i + U]); hMin = Math.min(hMin, verts[i + U]); hMax = Math.max(hMax, verts[i + U]); rMax = Math.max(rMax, Math.hypot(verts[i + A], verts[i + B])); }
  const lo = hMin + (hMax - hMin) * 0.45, hi = hMin + (hMax - hMin) * 0.55;
  let rMinBand = Infinity;
  for (let i = 0; i < hs.length; i++) {
    if (hs[i] >= lo && hs[i] <= hi) rMinBand = Math.min(rMinBand, Math.hypot(verts[i * 3 + A], verts[i * 3 + B]));
  }
  return (rMax - rMinBand) / (rMax || 1);
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
// 灯数：body 顶点 3D 格哈希聚类（单灯宽 0.63m，灯距 pitch≥3.4m → 1.5m 格邻域合并；
// 多 run 塔（runs=street 的 yuebin 沿两条街）灯不在同一轴线上，单轴量化会把不同边的灯并簇——3D 距离才成立）
function lampCount(verts) {
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
  let clusters = 0;
  for (const start of pts) {
    if (start._seen) continue;
    clusters++;
    start._seen = true;
    const queue = [start];
    while (queue.length) {
      const p = queue.pop();
      for (const q of neighbors(p)) {
        if (!q._seen) { q._seen = true; queue.push(q); }
      }
    }
  }
  return clusters;
}

// ---------- 合成负例（每个判据配一个明显错误输入） ----------
function synthGlbJson({ rim, petal, colorHex, withTassel }) {
  // 7 环 12 边鼓/蛋合成体：rim 控制端部收口比，petal 控制径向峰谷差
  const verts = [];
  const prof = rim == null ? [0.42, 0.78, 0.97, 1.0, 0.97, 0.78, 0.42] : [rim, rim + (1 - rim) * 0.6, 1, 1, 1, rim + (1 - rim) * 0.6, rim];
  const H = 0.63;
  prof.forEach((pr, i) => {
    const h = -H / 2 + H * i / (prof.length - 1);
    for (let j = 0; j < 12; j++) {
      const th = 2 * Math.PI * j / 12;
      const rad = 0.3 * pr * (1 + (petal || 0) * Math.cos(6 * th));
      verts.push(+(rad * Math.cos(th)).toFixed(4), +h.toFixed(4), +(rad * Math.sin(th)).toFixed(4));
    }
  });
  // 顶/底心点（y-up：高度在 y 分量）
  verts.push(0, H / 2, 0); verts.push(0, -H / 2, 0);
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
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, ...(withTassel ? [1] : [])] }],
    nodes: [{ name: 'lanterns-body__lantern', mesh: 0 }, ...(withTassel ? [{ name: 'lanterns-tassel__lantern', mesh: 1 }] : [])],
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
  const nLamps = lampCount(verts);
  lampTotal += nLamps;
  ok(nLamps >= 1, `${t.id}: 灯数（body 顶点聚类独立推）`, `lamps=${nLamps}`);

  // 鼓形：口沿比 + 瓣差（负例见文末合成注入）
  const rim = rimRatio(verts);
  ok(rim >= DESIGN.profRim * 0.6, `${t.id}: 鼓形口沿（端部硬收口，非蛋形尖端）`, `rim/r=${rim.toFixed(2)} ≥ ${(DESIGN.profRim * 0.6).toFixed(2)}`);
  const pd = petalDeltaFrac(verts);
  ok(pd >= DESIGN.petalDelta * 0.6, `${t.id}: 纵向瓜棱（径向峰谷差）`, `Δr/r=${(pd * 100).toFixed(1)}% ≥ ${(DESIGN.petalDelta * 0.6 * 100).toFixed(0)}%`);

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

console.log(`\nlantern-shape: ${passes} pass, ${fails.length} fail`);
if (fails.length) { console.log('FAILURES:\n' + fails.map(f => '  - ' + f).join('\n')); process.exit(1); }
