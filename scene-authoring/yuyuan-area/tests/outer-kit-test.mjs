// 外围老城厢套件测试（wave7-outerkit 样板 → wave8-outerlazy 全铺开，2026-09-26 机主「外围 301 栋全部铺开」）。
// 读最终运行时件 OUT_DIR/zone-outer.glb（Blender 导出的原始件），期望值一律从 baseline/layout.json 现算
// （footprint、height、levels、道路、与湖心亭 footprint 的重合），不拿产物和产物比。
//   OUTER_KIT_EXPECT=1（默认，对应 OUTER_KIT 默认开）：外围区全部 outerBuilding（除与湖心亭 footprint 重合的占位，
//     HUXINTING=0 时它仍是方块）都是套件网格，逐栋查三角上限 / 选型 / 墙脚落在 footprint 上 / 外挑 / 屋脊高 / 屋面无洞 / 绕序；
//   OUTER_KIT_EXPECT=0：OUTER_KIT=0 产物 —— 没有任何套件网格，外围 outerBuilding 全是方块。
// 用法：OUT_DIR=out-zone node tests/outer-kit-test.mjs ；OUT_DIR=out-zone-kit0 OUTER_KIT_EXPECT=0 node tests/outer-kit-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polySymDiffArea, polyArea as libPolyArea } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const EXPECT = process.env.OUTER_KIT_EXPECT !== '0';
const TRI_CAP = 400;
let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

// ---------- 期望：baseline/layout.json ----------
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'outer-kit', 'ids.json'), 'utf8'));
const SAMPLES = reg.ids;   // wave7 样板 10 栋（选取检查 + 联系表延续）；全铺开后套件范围 = 外围区全部 outerBuilding
const byId = new Map(layout.objects.map(o => [o.id, o]));
const outerIds = layout.objects.filter(o => o.kind === 'outerBuilding' && o.zone === 'outer').map(o => o.id);
// 与湖心亭 footprint 重合的占位（对称差 ≤ 5% 湖心亭面积；同 build-scene 的 HUXINTING 让位口径，从 layout 几何现算）
const huxin = byId.get('huxin-ting');
const hArea = huxin ? Math.abs(libPolyArea(huxin.geometry.footprint)) : 0;
const dupIds = new Set(huxin ? outerIds.filter(id => polySymDiffArea(huxin.geometry.footprint, byId.get(id).geometry.footprint) / hArea <= 0.05) : []);
const KIT_IDS = outerIds.filter(id => !dupIds.has(id));
const OWNER_COUNT = 301;   // GOAL wave8：304 栋 − bazaar 区 2 栋 − 湖心亭重合 1 栋
const ringOf = (fp) => {
  const r = fp.map(p => [p[0], p[1]]);
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
};
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const boundaryDist = (p, r) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length])); return d; };
const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
// 临街（测试自己的实现，不调生成器）：边中点到道路中线距离 − 半宽 ≤ 6 m 且边长 ≥ 3 m
const roads = [];
for (const o of layout.objects) if (o.kind === 'road' && o.geometry.polyline) for (let i = 1; i < o.geometry.polyline.length; i++) roads.push([o.geometry.polyline[i - 1], o.geometry.polyline[i], (o.geometry.width || 4) / 2]);
const fronting = (r) => r.some((a, i) => { const b = r[(i + 1) % r.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) return false; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return roads.some(([p, q, h]) => segDist(m, p, q) - h <= 6); });

// ---------- GLB 读取 ----------
function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bin = b.subarray(20 + jl + 8);
  return { json, bin };
}
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const [T, sz] = CT[a.componentType], n = NC[a.type];
  const stride = bv.byteStride || sz * n, off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const pos = off + k * stride + c * sz;
    out[k * n + c] = T === Float32Array ? g.bin.readFloatLE(pos) : T === Uint32Array ? g.bin.readUInt32LE(pos) : T === Uint16Array ? g.bin.readUInt16LE(pos) : T === Uint8Array ? g.bin.readUInt8(pos) : T === Int16Array ? g.bin.readInt16LE(pos) : g.bin.readInt8(pos);
  }
  return { data: out, n, count: a.count };
}
function mat4(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0], [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

const glbPath = path.join(OUT, 'zone-outer.glb');
if (!fs.existsSync(glbPath)) { console.log('FAIL no', glbPath); process.exit(1); }
const g = readGlb(glbPath);
// 每个带 extras.id 的节点：世界三角（位置 + 属性法线）+ 材质
const nodes = new Map();
const idOf = (nd) => (nd.extras && nd.extras.id) || (String(nd.name || '').split('|')[1]);
function walk(ni, parentM, owner) {
  const nd = g.json.nodes[ni];
  const M = mul(parentM, mat4(nd));
  let own = owner;
  if (nd.extras && nd.extras.id) { own = { id: nd.extras.id, extras: nd.extras, name: nd.name, tris: [], materials: new Set(), attrs: new Set() }; nodes.set(own.id + '#' + ni, own); }
  if (nd.mesh !== undefined && own) {
    for (const pr of g.json.meshes[nd.mesh].primitives) {
      own.materials.add(pr.material);
      for (const k of Object.keys(pr.attributes)) own.attrs.add(k);
      const P = accessor(g, pr.attributes.POSITION), N = pr.attributes.NORMAL !== undefined ? accessor(g, pr.attributes.NORMAL) : null;
      const I = pr.indices !== undefined ? accessor(g, pr.indices).data : Array.from({ length: P.count }, (_, k) => k);
      for (let k = 0; k + 2 < I.length; k += 3) {
        const v = [I[k], I[k + 1], I[k + 2]].map(j => xf(M, [P.data[j * 3], P.data[j * 3 + 1], P.data[j * 3 + 2]]));
        const n = N ? [I[k], I[k + 1], I[k + 2]].map(j => { const q = xf([M[0], M[1], M[2], 0, M[4], M[5], M[6], 0, M[8], M[9], M[10], 0, 0, 0, 0, 1], [N.data[j * 3], N.data[j * 3 + 1], N.data[j * 3 + 2]]); return q; }) : null;
        own.tris.push({ v, n });
      }
    }
  }
  for (const c of nd.children || []) walk(c, M, own);
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const s of g.json.scenes) for (const r of s.nodes) walk(r, I4, null);
const entries = [...nodes.values()];
const kitEntries = entries.filter(e => e.extras.outerKit);
const obEntries = entries.filter(e => e.extras.kind === 'outerBuilding' || String(e.name || '').includes('|outerBuilding|'));

// ---------- 共同：外围 outerBuilding 身份齐全 ----------
const seen = new Map();
for (const e of obEntries) seen.set(e.id, (seen.get(e.id) || 0) + 1);
// 湖心亭重合占位：HUXINTING 开时让位（不在外围件），HUXINTING=0 时照常出方块 —— 按内容判定在不在
const dupPresent = [...dupIds].filter(id => seen.has(id));
const expectedIds = [...KIT_IDS, ...dupPresent];
ok(`外围件 outerBuilding 节点 ${seen.size} 个 = layout outer 区 ${KIT_IDS.length} 个 + 在场的湖心亭重合占位 ${dupPresent.length} 个`, expectedIds.every(id => seen.get(id) === 1) && seen.size === expectedIds.length);
ok(`套件范围 ${KIT_IDS.length} 栋 = 机主口径 ${OWNER_COUNT}（layout 外围区 ${outerIds.length} − 湖心亭重合 ${[...dupIds].join(',')}）`, KIT_IDS.length === OWNER_COUNT);
ok(`湖心亭重合占位在场时仍是方块（${dupPresent.join(',') || '不在场'}）`, entries.filter(e => dupIds.has(e.id)).every(e => !e.extras.outerKit));

if (!EXPECT) {
  ok(`默认产物无套件网格（实得 ${kitEntries.length}）`, kitEntries.length === 0);
  console.log(`outer-kit-test (expect off): ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

// ---------- 样板集合本身：高度 / 形状 / 临街分散（输入选取检查，从 layout 现算） ----------
{
  const objs = SAMPLES.map(id => byId.get(id));
  ok('样板 10 栋且都是外围 outerBuilding', SAMPLES.length === 10 && objs.every(o => o && o.kind === 'outerBuilding' && o.zone === 'outer'));
  const heights = new Set(objs.map(o => o.height));
  const fr = objs.map(o => fronting(ringOf(o.geometry.footprint)));
  const nonRect = objs.filter(o => { const r = ringOf(o.geometry.footprint); return r.length > 4; }).length;
  ok(`样板高度档 ≥ 4（实得 ${[...heights].join('/')}）`, heights.size >= 4);
  ok(`样板临街 ≥ 3 且不临街 ≥ 3（${fr.filter(Boolean).length}/${fr.filter(x => !x).length}）`, fr.filter(Boolean).length >= 3 && fr.filter(x => !x).length >= 3);
  ok(`样板非四边形轮廓 ≥ 3（实得 ${nonRect}）`, nonRect >= 3);
}

// ---------- 套件网格 ----------
{
  const kitSet = new Set(kitEntries.map(e => e.id));
  const missing = KIT_IDS.filter(id => !kitSet.has(id));
  ok(`套件网格 ${kitEntries.length} 个恰为外围 ${KIT_IDS.length} 栋各一（缺 ${missing.length}：${missing.slice(0, 5).join(',')}）`, kitEntries.length === KIT_IDS.length && missing.length === 0);
}
const kitMats = new Set(kitEntries.flatMap(e => [...e.materials]));
ok(`套件共用 1 个材质（实得 ${kitMats.size}）`, kitMats.size === 1);
const modes = new Set(kitEntries.map(e => e.extras.outerKit));
ok(`套件方案一致（${[...modes]}）`, modes.size === 1);
const mode = [...modes][0];
{
  const m = g.json.materials[[...kitMats][0]] || {};
  const texIdx = new Set();
  const pbr = m.pbrMetallicRoughness || {};
  for (const t of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture]) if (t) texIdx.add(t.index);
  const imgs = new Set([...texIdx].map(t => g.json.textures[t].source));
  ok(`套件材质贴图 ≤ 1 张（实得 ${imgs.size}，方案 ${mode}）`, imgs.size <= 1 && (mode !== 'tex' || imgs.size === 1));
  if (mode === 'tex') {
    const img = g.json.images[[...imgs][0]];
    ok(`tex 图集为 JPEG（${img.mimeType}）`, img.mimeType === 'image/jpeg');
    ok('tex 网格带 UV、不带顶点色', kitEntries.every(e => e.attrs.has('TEXCOORD_0') && !e.attrs.has('COLOR_0')));
  }
}
const typeCount = {}, stats = { tris: 0, maxTris: 0, maxOut: 0, maxRidgeOver: 0 };
for (const id of KIT_IDS) {
  const o = byId.get(id), es = kitEntries.filter(e => e.id === id);
  if (es.length !== 1) { ok(`${id} 恰一个套件节点`, false); continue; }
  const e = es[0], r = ringOf(o.geometry.footprint), A = Math.abs(area(r));
  const h = o.height, levels = o.levels || Math.round(h / 3.2);
  ok(`${id} 三角 ${e.tris.length} ≤ ${TRI_CAP}`, e.tris.length <= TRI_CAP && e.tris.length > 0);
  typeCount[e.extras.kitType] = (typeCount[e.extras.kitType] || 0) + 1;
  stats.tris += e.tris.length; stats.maxTris = Math.max(stats.maxTris, e.tris.length);
  // 选型：levels ≥ 4 → apartment；临街 → shophouse；否则 lilong
  const wantType = levels >= 4 ? 'apartment' : fronting(r) ? 'shophouse' : 'lilong';
  ok(`${id} 选型 ${e.extras.kitType} = layout 推出的 ${wantType}`, e.extras.kitType === wantType);
  // 位置 / 轮廓：地面层顶点全在 footprint 边上（≤ 3 cm）；footprint 每个角都有地面顶点
  const all = e.tris.flatMap(t => t.v);
  const ground = all.filter(p => Math.abs(p[1]) <= 0.02);
  const gd = Math.max(...ground.map(p => boundaryDist([p[0], p[2]], r)));
  ok(`${id} 地面顶点 ${ground.length} 个都落在 layout footprint 边上（最大偏 ${gd.toFixed(3)} m）`, ground.length >= r.length && gd <= 0.03);
  const cornerMiss = r.filter(c => !ground.some(p => Math.hypot(p[0] - c[0], p[2] - c[1]) <= 0.03)).length;
  ok(`${id} footprint ${r.length} 个角都有墙脚顶点（缺 ${cornerMiss}）`, cornerMiss === 0);
  // 外扩上限：屋檐 0.35 + 披檐 0.9 → 所有顶点距 footprint ≤ 1.3 m（在外时）
  const outMax = Math.max(0, ...all.filter(p => !inside([p[0], p[2]], r)).map(p => boundaryDist([p[0], p[2]], r)));
  ok(`${id} 外挑 ≤ 1.3 m（实得 ${outMax.toFixed(2)}）`, outMax <= 1.3);
  stats.maxOut = Math.max(stats.maxOut, outMax);
  // 高度：屋脊在 layout height 之上、不超 1.6 m；无地下顶点
  const ymax = Math.max(...all.map(p => p[1])), ymin = Math.min(...all.map(p => p[1]));
  ok(`${id} 屋脊 ${ymax.toFixed(2)} ∈ [h=${h}, h+1.6]，底 ${ymin.toFixed(2)} ≥ 0`, ymax >= h && ymax <= h + 1.6 && ymin >= -1e-3);
  stats.maxRidgeOver = Math.max(stats.maxRidgeOver, ymax - h);
  // 屋面覆盖：footprint 内 0.5 m 网格采样点，每点正上方（高于 h/2）都要有朝上的三角（无洞）；顺带查绕序与法线一致
  let wind = 0;
  const upTris = [];
  for (const t of e.tris) {
    const [a, b, c] = t.v;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (t.n) { const an = [0, 1, 2].map(k => t.n[0][k] + t.n[1][k] + t.n[2][k]); if (an[0] * n[0] + an[1] * n[1] + an[2] * n[2] < 0) wind++; }
    if (n[1] > 1e-9 && Math.min(a[1], b[1], c[1]) > h / 2) upTris.push([[a[0], a[2]], [b[0], b[2]], [c[0], c[2]]]);
  }
  const inTri = (p, [a, b, c]) => {
    const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
    const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
    return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9) || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
  };
  let xs = r.map(p => p[0]), zs = r.map(p => p[1]), nIn = 0, nCov = 0;
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5) {
    if (!inside([x, z], r) || boundaryDist([x, z], r) < 0.05) continue;
    nIn++;
    if (upTris.some(t => inTri([x, z], t))) nCov++;
  }
  ok(`${id} 屋面覆盖 footprint 采样点 ${nCov}/${nIn}（无洞）`, nIn > 0 && nCov === nIn);
  ok(`${id} 三角绕序与法线一致（反向 ${wind}）`, wind === 0);
}
// 套件范围外的 outerBuilding（湖心亭重合占位）无套件标记
ok('套件范围外的外围楼无套件标记', obEntries.filter(e => !KIT_IDS.includes(e.id)).every(e => !e.extras.outerKit));
console.log(`REPORT 选型 ${JSON.stringify(typeCount)}；套件三角合计 ${stats.tris}，单栋最多 ${stats.maxTris}；最大外挑 ${stats.maxOut.toFixed(2)} m；屋脊最多高出 layout height ${stats.maxRidgeOver.toFixed(2)} m`);
// cm 件 validator 0 错
const man = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const zo = man.zones.find(z => z.id === 'outer');
ok(`zone-outer.cm.glb validator 0 错（${zo.cm ? zo.cm.validatorErrors : 'no cm'}）`, zo.cm && zo.cm.validatorErrors === 0);
console.log(`outer-kit-test: ${pass} pass, ${fail} fail (mode ${mode}, ${kitEntries.reduce((s, e) => s + e.tris.length, 0)} kit tris; zone-outer ${zo.bytes} B, cm ${zo.cm && zo.cm.bytes} B)`);
process.exit(fail ? 1 : 0);
