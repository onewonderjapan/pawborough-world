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
import { polySymDiffArea, polyArea as libPolyArea, polyIntersectionArea } from '../src/lib.mjs';
import { glbEntries } from '../modules/outer-kit/glb-read.mjs';

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

// ---------- GLB 读取（modules/outer-kit/glb-read.mjs，带 UV）----------
const glbPath = path.join(OUT, 'zone-outer.glb');
if (!fs.existsSync(glbPath)) { console.log('FAIL no', glbPath); process.exit(1); }
const { g, entries } = glbEntries(glbPath);
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
// wave9：被某栋套件楼包住的别栋（≥ 95% 面积在其 footprint 内、面积更小）= 院落洞：那块地归被包住的楼，
// 外楼屋面在洞上挖空、洞边起朝内的墙（从 layout 现算）
const HOLE_KINDS = new Set(['outerBuilding', 'bazaarBlock']);
const holesOf = (id) => {
  const r = ringOf(byId.get(id).geometry.footprint), A = Math.abs(area(r));
  const xs = r.map(p => p[0]), zs = r.map(p => p[1]);
  return layout.objects.filter(q => q.id !== id && HOLE_KINDS.has(q.kind) && q.geometry && q.geometry.footprint).map(q => ringOf(q.geometry.footprint))
    .filter(q => q.every(p => p[0] >= Math.min(...xs) - 0.1 && p[0] <= Math.max(...xs) + 0.1 && p[1] >= Math.min(...zs) - 0.1 && p[1] <= Math.max(...zs) + 0.1))
    .filter(q => { const aq = Math.abs(area(q)); return aq < A && polyIntersectionArea(q, r) >= 0.95 * aq; });
};
const holeReport = [];
const typeCount = {}, stats = { tris: 0, maxTris: 0, maxOut: 0, maxRidgeOver: 0 };
for (const id of KIT_IDS) {
  const o = byId.get(id), es = kitEntries.filter(e => e.id === id);
  if (es.length !== 1) { ok(`${id} 恰一个套件节点`, false); continue; }
  const e = es[0], r = ringOf(o.geometry.footprint), A = Math.abs(area(r));
  const holes = holesOf(id);
  if (holes.length) holeReport.push(id + '⊃' + holes.length);
  const onAnyBoundary = (p) => Math.min(boundaryDist(p, r), ...holes.map(h => boundaryDist(p, h)));
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
  const gd = Math.max(...ground.map(p => onAnyBoundary([p[0], p[2]])));
  ok(`${id} 地面顶点 ${ground.length} 个都落在 layout footprint 边（含院落洞边）上（最大偏 ${gd.toFixed(3)} m）`, ground.length >= r.length && gd <= 0.03);
  if (holes.length) {
    const hm = holes.flat().filter(c => !ground.some(p => Math.hypot(p[0] - c[0], p[2] - c[1]) <= 0.03)).length;
    ok(`${id} 院落洞 ${holes.length} 个的角都有墙脚顶点（缺 ${hm}）`, hm === 0);
  }
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
  let xs = r.map(p => p[0]), zs = r.map(p => p[1]), nIn = 0, nCov = 0, holeRoofed = 0;
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5) {
    if (!inside([x, z], r) || boundaryDist([x, z], r) < 0.05) continue;
    if (holes.some(h => boundaryDist([x, z], h) < 0.05)) continue;   // 洞边 5 cm 内不判
    if (holes.some(h => inside([x, z], h))) {   // 院落洞：必须空（归被包住的楼）
      if (upTris.some(t => inTri([x, z], t))) holeRoofed++;
      continue;
    }
    nIn++;
    if (upTris.some(t => inTri([x, z], t))) nCov++;
  }
  ok(`${id} 屋面覆盖 footprint 采样点 ${nCov}/${nIn}（无洞）`, nIn > 0 && nCov === nIn);
  if (holes.length) ok(`${id} 院落洞上方没有本栋屋面（压住 ${holeRoofed} 个采样点）`, holeRoofed === 0);
  ok(`${id} 三角绕序与法线一致（反向 ${wind}）`, wind === 0);
}
// 套件范围外的 outerBuilding（湖心亭重合占位）无套件标记
// ---------- wave9-outerpolish P2：墙色变体（图集 v2 行，4 种墙色）----------
// 行序契约（与 modules/outer-kit/bake_atlas.py ROWS、src/outer-kit.mjs ATLAS_ROWS 同序）：瓦面 256 行 + 每条 128 行
const TONES = ['cream', 'greywhite', 'greybrick', 'oldyellow'];
const ROWS = ['shopA', 'shopB', 'aptGreyA', 'aptGreyB', 'aptYellowA', 'aptYellowB', ...TONES.flatMap(t => ['resA', 'resB', 'upA', 'upB', 'sidewin', 'plain'].map(k => t + ':' + k))];
const ATLAS_H = 256 + 128 * ROWS.length;
const rowName = (v) => { const k = Math.floor((v * ATLAS_H - 256) / 128); return v * ATLAS_H >= 256 && k >= 0 && k < ROWS.length ? ROWS[k] : null; };
const vOf = (t) => (t.uv[0][1] + t.uv[1][1] + t.uv[2][1]) / 3;
if (mode === 'tex') {
  const m = g.json.materials[[...kitMats][0]], img = g.json.images[g.json.textures[m.pbrMetallicRoughness.baseColorTexture.index].source];
  const bv = g.json.bufferViews[img.bufferView], jb = g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  let dim = null;
  for (let i = 2; i + 8 < jb.length;) {
    if (jb[i] !== 0xff) { i++; continue; }
    const mk = jb[i + 1], len = jb.readUInt16BE(i + 2);
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { dim = [jb.readUInt16BE(i + 7), jb.readUInt16BE(i + 5)]; break; }
    i += 2 + len;
  }
  ok(`图集 ${dim && dim.join('×')} = 512×${ATLAS_H}（瓦面 + ${ROWS.length} 条）`, dim && dim[0] === 512 && dim[1] === ATLAS_H);
  // 分配规则（从 layout 现算：选型 + id 哈希；与生成器同一规则、独立实现）
  const h32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rnd = (seed, k) => { let x = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  const W8 = { shophouse: [0.35, 0.2, 0.15, 0.3], lilong: [0.3, 0.2, 0.3, 0.2], apartment: [0, 0.6, 0, 0.4] };
  const wantTone = (id, type) => { const r = rnd(h32(id), 30); let acc = 0; for (let k = 0; k < 4; k++) { acc += W8[type][k]; if (r < acc) return TONES[k]; } return 'oldyellow'; };
  const toneCount = {}, byType = {};
  let badRule = [], badRows = [];
  for (const id of KIT_IDS) {
    const o = byId.get(id), e = kitEntries.find(x => x.id === id);
    const levels = o.levels || Math.round(o.height / 3.2), type = levels >= 4 ? 'apartment' : fronting(ringOf(o.geometry.footprint)) ? 'shophouse' : 'lilong';
    const tone = e.extras.kitTone;
    toneCount[tone] = (toneCount[tone] || 0) + 1;
    byType[type] = byType[type] || {}; byType[type][tone] = (byType[type][tone] || 0) + 1;
    if (tone !== wantTone(id, type)) badRule.push(id);
    // 产物 UV：墙面采样的色行全部属于本栋墙色（公房条：灰白 → aptGrey、旧黄 → aptYellow；店面条不分色）
    const rows = new Set(e.tris.filter(t => t.uv).map(t => rowName(vOf(t))).filter(Boolean));
    const aptWant = tone === 'oldyellow' ? 'aptYellow' : 'aptGrey';
    const wrong = [...rows].filter(r => (r.includes(':') && !r.startsWith(tone + ':')) || (r.startsWith('apt') && (type !== 'apartment' || !r.startsWith(aptWant))));
    if (wrong.length || ![...rows].some(r => r.includes(':'))) badRows.push(id + ':' + (wrong.join('/') || 'no tone rows'));
  }
  ok(`墙色按规则分配（选型权重 + id 哈希），不符 ${badRule.length}：${badRule.slice(0, 4).join(',')}`, badRule.length === 0);
  ok(`墙面 UV 色行与本栋墙色一致，不符 ${badRows.length}：${badRows.slice(0, 4).join(',')}`, badRows.length === 0);
  const shares = TONES.map(t => (toneCount[t] || 0) / KIT_IDS.length);
  ok(`4 种墙色都用上且不偏科（${TONES.map((t, k) => t + ' ' + (shares[k] * 100).toFixed(0) + '%').join(' / ')}）`, shares.every(x => x >= 0.08) && Math.max(...shares) <= 0.5);
  console.log(`REPORT 墙色 ${JSON.stringify(toneCount)} 按选型 ${JSON.stringify(byType)}`);
}

// ---------- wave9-outerpolish P3：长立面防重复 ----------
// 从产物读：footprint 每条 ≥ 40 m 的边上的开间墙（店面 / 民居 / 楼层 / 公房条）三角，按层归组，
// 由 UV 反推「条 + 镜像（dU/d沿墙 的符号）+ 相位（U 截距）」；同一套映射沿墙连续铺开的最长距离 ≤ 20 m，且每层至少换一次条（A/B）。
// 全部开间墙（不论长短）：镜像的比例在 25–75%，B 条比例在 25–75%。
if (mode === 'tex') {
  const BAYED = (r) => r && (r.startsWith('shop') || r.startsWith('apt') || /:(res|up)[AB]$/.test(r));
  const long = [], allGroups = [];
  for (const id of KIT_IDS) {
    // 墙边方向统一成「从楼外看自左向右」（环按 x-z 正面积绕序，a→b 在外看是自右向左，所以反过来走）
    const e = kitEntries.find(x => x.id === id), r0 = ringOf(byId.get(id).geometry.footprint), r = area(r0) > 0 ? r0.slice().reverse() : r0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 3) continue;
      const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const onEdge = (p) => { const s = (p[0] - a[0]) * dir[0] + (p[2] - a[1]) * dir[1], d = Math.abs(-(p[0] - a[0]) * dir[1] + (p[2] - a[1]) * dir[0]); return d <= 0.03 && s >= -0.03 && s <= L + 0.03; };
      const levels = new Map();
      for (const t of e.tris) {
        if (!t.uv || !t.v.every(onEdge)) continue;
        const row = rowName(vOf(t));
        if (!BAYED(row)) continue;
        const al = t.v.map(p => (p[0] - a[0]) * dir[0] + (p[2] - a[1]) * dir[1]);
        let j0 = 0, j1 = 1;
        for (let x = 0; x < 3; x++) for (let y = x + 1; y < 3; y++) if (Math.abs(al[y] - al[x]) > Math.abs(al[j1] - al[j0])) { j0 = x; j1 = y; }
        if (Math.abs(al[j1] - al[j0]) < 0.05) continue;
        const slope = (t.uv[j1][0] - t.uv[j0][0]) / (al[j1] - al[j0]);
        const icpt = t.uv[j0][0] - slope * al[j0];
        const lk = Math.round(Math.min(...t.v.map(p => p[1])) * 20);
        if (!levels.has(lk)) levels.set(lk, []);
        levels.get(lk).push({ a0: Math.min(...al), a1: Math.max(...al), key: row + '|' + Math.sign(slope) + '|' + Math.round(icpt * 200), row, mirror: slope < 0 });
      }
      for (const [lk, iv] of levels) {
        iv.sort((p, q) => p.a0 - q.a0);
        let run = null, maxRun = 0;
        const runs = [];
        for (const x of iv) {
          if (run && x.key === run.key && x.a0 <= run.a1 + 0.05) run.a1 = Math.max(run.a1, x.a1);
          else { if (run) runs.push(run); run = { ...x }; }
        }
        if (run) runs.push(run);
        for (const q of runs) maxRun = Math.max(maxRun, q.a1 - q.a0);
        const grp = { id, edge: i, len: L, level: lk / 20, maxRun, rows: new Set(iv.map(x => x.row)).size, mirror: iv[0].mirror, b: iv[0].row.endsWith('B') };
        allGroups.push(grp);
        if (L >= 40) long.push(grp);
      }
    }
  }
  const worst = long.reduce((p, q) => (!p || q.maxRun > p.maxRun ? q : p), null);
  ok(`≥ 40 m 开间立面 ${new Set(long.map(x => x.id + '#' + x.edge)).size} 条 / ${long.length} 层：同一映射最长连续 ${worst ? worst.maxRun.toFixed(1) : 0} m ≤ 20 m（最长 ${worst ? worst.id + '#' + worst.edge : '-'}）`, long.length > 0 && worst.maxRun <= 20);
  const noSwap = long.filter(x => x.rows < 2);
  ok(`≥ 40 m 开间立面每层都换条（A/B）：没换的 ${noSwap.length} 层`, noSwap.length === 0);
  const fm = allGroups.filter(x => x.mirror).length / (allGroups.length || 1), fb = allGroups.filter(x => x.b).length / (allGroups.length || 1);
  ok(`开间墙 ${allGroups.length} 层组：镜像 ${(fm * 100).toFixed(0)}%、B 条 ${(fb * 100).toFixed(0)}% 都在 25–75%`, fm >= 0.25 && fm <= 0.75 && fb >= 0.25 && fb <= 0.75);
  console.log(`REPORT 长立面 ≥ 40 m：${new Set(long.map(x => x.id + '#' + x.edge)).size} 条 / ${long.length} 层，同一映射最长连续 ${worst ? worst.maxRun.toFixed(1) : 0} m（${worst ? worst.id + '#' + worst.edge : '-'}），没换条 ${noSwap.length} 层；开间墙 ${allGroups.length} 层组 镜像 ${(fm * 100).toFixed(0)}% / B 条 ${(fb * 100).toFixed(0)}%`);
}
ok('套件范围外的外围楼无套件标记', obEntries.filter(e => !KIT_IDS.includes(e.id)).every(e => !e.extras.outerKit));
console.log(`REPORT 院落洞 ${holeReport.join(',') || '无'}；选型 ${JSON.stringify(typeCount)}；套件三角合计 ${stats.tris}，单栋最多 ${stats.maxTris}；最大外挑 ${stats.maxOut.toFixed(2)} m；屋脊最多高出 layout height ${stats.maxRidgeOver.toFixed(2)} m`);
// cm 件 validator 0 错
const man = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const zo = man.zones.find(z => z.id === 'outer');
ok(`zone-outer.cm.glb validator 0 错（${zo.cm ? zo.cm.validatorErrors : 'no cm'}）`, zo.cm && zo.cm.validatorErrors === 0);
console.log(`outer-kit-test: ${pass} pass, ${fail} fail (mode ${mode}, ${kitEntries.reduce((s, e) => s + e.tris.length, 0)} kit tris; zone-outer ${zo.bytes} B, cm ${zo.cm && zo.cm.bytes} B)`);
process.exit(fail ? 1 : 0);
