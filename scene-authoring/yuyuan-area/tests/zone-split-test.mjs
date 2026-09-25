// Zone split completeness: the zone GLBs together must carry exactly the placed triangles and named nodes of scene-areas.glb
// (no mesh lost, none duplicated across zones), every zone within its cap, manifest sha matches files.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { parseGlbJson, triangleCounts } from '../src/reconcile.mjs';
const OUT = path.resolve(process.env.OUT_DIR || 'out');
const mp = path.join(OUT, 'zones-manifest.json');
if (!fs.existsSync(mp)) { console.log('zone-split-test: SKIP (no zones-manifest.json in', OUT, ')'); process.exit(0); }
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
// Instance-weighted count of exactly zero-area / index-degenerate triangles in an uncompressed GLB
// (gltfpack is allowed to drop these and only these).
function zeroAreaPlaced(buf) {
  const jl = buf.readUInt32LE(12), j = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const binStart = 20 + jl + 8;
  const inst = new Map(); for (const n of j.nodes || []) if (n.mesh !== undefined) inst.set(n.mesh, (inst.get(n.mesh) || 0) + 1);
  const view = (ai) => { const a = j.accessors[ai], bv = j.bufferViews[a.bufferView]; return { a, off: binStart + (bv.byteOffset || 0) + (a.byteOffset || 0) }; };
  let zero = 0;
  for (const [mi, cnt] of inst) for (const pr of j.meshes[mi].primitives) {
    const P = view(pr.attributes.POSITION), I = view(pr.indices);
    const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + P.off, buf.byteOffset + P.off + P.a.count * 12));
    const rd = I.a.componentType === 5125 ? (k) => buf.readUInt32LE(I.off + 4 * k) : I.a.componentType === 5123 ? (k) => buf.readUInt16LE(I.off + 2 * k) : (k) => buf[I.off + k];
    let z = 0;
    for (let t = 0; t < I.a.count; t += 3) {
      const a = rd(t), b = rd(t + 1), c = rd(t + 2);
      if (a === b || b === c || a === c) { z++; continue; }
      const ux = pos[3*b]-pos[3*a], uy = pos[3*b+1]-pos[3*a+1], uz = pos[3*b+2]-pos[3*a+2];
      const vx = pos[3*c]-pos[3*a], vy = pos[3*c+1]-pos[3*a+1], vz = pos[3*c+2]-pos[3*a+2];
      const cx = uy*vz-uz*vy, cy = uz*vx-ux*vz, cz = ux*vy-uy*vx;
      if (cx === 0 && cy === 0 && cz === 0) z++;
    }
    zero += z * cnt;
  }
  return zero;
}
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d); } };
const scene = parseGlbJson(fs.readFileSync(path.join(OUT, 'scene-areas.glb')));
const meshNames = j => (j.nodes || []).filter(n => n.mesh !== undefined).map(n => n.name);
let placed = 0; const names = [];
for (const z of m.zones.filter(z => z.file)) {
  const buf = fs.readFileSync(path.join(OUT, z.file));
  ok(`${z.file} sha matches manifest`, crypto.createHash('sha256').update(buf).digest('hex') === z.sha256);
  ok(`${z.file} ${buf.length} ≤ cap ${m.capPerZoneBytes}`, buf.length <= m.capPerZoneBytes);
  const j = parseGlbJson(buf); placed += triangleCounts(j).placed; names.push(...meshNames(j));
}
// meshopt runtime copies: same placed triangles and same named mesh nodes as the raw zone file, validator 0 errors recorded
for (const z of m.zones.filter(z => z.file && z.cm)) {
  const raw = parseGlbJson(fs.readFileSync(path.join(OUT, z.file)));
  const cmBuf = fs.readFileSync(path.join(OUT, z.cm.file));
  const cm = parseGlbJson(cmBuf);
  ok(`${z.cm.file} sha matches manifest`, crypto.createHash('sha256').update(cmBuf).digest('hex') === z.cm.sha256);
  // gltfpack removes zero-area (degenerate) triangles and nothing else: dropped count must not exceed the raw file's zero-area count.
  const rt = triangleCounts(raw).placed, ct = triangleCounts(cm).placed, deg = zeroAreaPlaced(fs.readFileSync(path.join(OUT, z.file)));
  ok(`${z.cm.file} placed triangles ${ct} vs raw ${rt}: dropped ${rt - ct} ≤ raw zero-area ${deg}`, ct <= rt && rt - ct <= deg, `diff=${rt - ct} zeroArea=${deg}`);
  const rn = new Set(meshNames(raw)), cn = new Set((cm.nodes || []).map(n => n.name));
  const lost = [...rn].filter(n => !cn.has(n));
  ok(`${z.cm.file} keeps every named mesh node`, lost.length === 0, JSON.stringify(lost.slice(0, 5)));
  ok(`${z.cm.file} validator 0 errors`, z.cm.validatorErrors === 0);
  ok(`${z.cm.file} uses EXT_meshopt_compression`, (cm.extensionsUsed || []).includes('EXT_meshopt_compression'));
}
const sceneTri = triangleCounts(scene).placed;
ok(`placed triangles zones ${placed} == scene-areas ${sceneTri}`, placed === sceneTri, `diff=${placed - sceneTri}`);
const sn = meshNames(scene).sort(), zn = [...names].sort();
ok(`mesh-node count zones ${zn.length} == scene-areas ${sn.length}`, zn.length === sn.length);
const dup = zn.filter((n, i) => i && n === zn[i - 1] && sn.filter(x => x === n).length < zn.filter(x => x === n).length);
ok('no mesh node duplicated across zones', dup.length === 0, JSON.stringify([...new Set(dup)].slice(0, 5)));
// bazaar 分件（按内容类别，非填充顺序）：zone-bazaar=街面（店屋/摊位/檐棚/面元/地面），
// zone-bazaar-2=bazaarBlock 大楼体块。断言：恰两件、每件 ≤ cap、bazaarBlock 全在大楼件、
// 两件无重复节点、两件 placed 三角合计 == 拆件前 bazaar.glb（assemble-food 导出的 ZONE+INST+FOOD 全量）。
const bz = m.zones.filter(z => z.id === 'bazaar' && z.file);
ok(`bazaar 拆成两件（现 ${bz.length} 件）`, bz.length === 2, `parts=[${bz.map(z => z.file).join(', ')}]`);
if (bz.length === 2) {
  const parts = bz.map(z => ({ z, buf: fs.readFileSync(path.join(OUT, z.file)), j: parseGlbJson(fs.readFileSync(path.join(OUT, z.file))) }));
  for (const { z, buf } of parts) {
    ok(`bazaar 分件 ${z.file} ${buf.length} ≤ cap ${m.capPerZoneBytes}`, buf.length <= m.capPerZoneBytes);
    ok(`bazaar 分件 ${z.file} sha 与 manifest 一致`, crypto.createHash('sha256').update(buf).digest('hex') === z.sha256);
  }
  const kindsOf = j => new Set(meshNames(j).map(n => (n.split('|')[2] || '')));
  const streetKinds = kindsOf(parts[0].j), towerKinds = kindsOf(parts[1].j);
  ok(`bazaarBlock 大楼体块全在 ${parts[1].z.file}（${towerKinds.size ? '含 bazaarBlock' : '缺'}）`, towerKinds.has('bazaarBlock') && !streetKinds.has('bazaarBlock'));
  ok(`街面件含铺装内容（facadeBay/paving/plaza）`, ['facadeBay', 'paving', 'plaza'].some(k => streetKinds.has(k)));
  const nameCount = new Map();
  for (const p of parts) for (const n of meshNames(p.j)) nameCount.set(n, (nameCount.get(n) || 0) + 1);
  const dupBz = [...nameCount.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  ok('bazaar 两件无重复 mesh 节点', dupBz.length === 0, JSON.stringify(dupBz.slice(0, 5)));
  const bzTri = parts.reduce((s, p) => s + triangleCounts(p.j).placed, 0);
  const prePath = path.join(OUT, 'bazaar.glb');
  const pre = fs.existsSync(prePath) ? triangleCounts(parseGlbJson(fs.readFileSync(prePath))).placed : -1;
  ok(`bazaar 两件 placed 三角 ${bzTri} == 拆件前 bazaar.glb ${pre}`, bzTri === pre, `diff=${bzTri - pre}`);
}
// garden 分件（wave3-zonesplit，2026-09-25）：厅堂套件实例（module=hall-kit，id 表 modules/hall-kit/ids.json）单独成一件。
// 断言照 bazaar 分件写法：厅堂 id 锚节点全在同一件、别的 garden 件一个都没有；该件只装厅堂；
// 拆件前后三角守恒——(a) 园区各件 placed 三角合计 == 拆件前 garden.glb（assemble.py 导出的 ZONE+INST+SITE-garden 全量），
// (b) 厅堂件 placed 三角 == garden.glb 里各厅堂锚子树 placed 三角之和。HALL_KIT=0 时 ids 不入场景，跳过 (a) 以外的断言。
const HALL_IDS = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'modules', 'hall-kit', 'ids.json'), 'utf8')).ids;
const gd = m.zones.filter(z => z.id === 'garden' && z.file).map(z => ({ z, j: parseGlbJson(fs.readFileSync(path.join(OUT, z.file))) }));
// 子树 placed 三角（按节点名找根；名不在则 0）
function subtreeTris(j, rootNames) {
  const meshTris = (j.meshes || []).map(mm => mm.primitives.reduce((s, p) => s + Math.floor((p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3), 0));
  let t = 0; const seen = new Set();
  const walk = (ni) => { if (seen.has(ni)) return; seen.add(ni); const n = j.nodes[ni]; if (n.mesh !== undefined) t += meshTris[n.mesh] || 0; for (const c of n.children || []) walk(c); };
  (j.nodes || []).forEach((n, i) => { if (rootNames.has(n.name)) walk(i); });
  return t;
}
const gPrePath = path.join(OUT, 'garden.glb');
let hallKitOn = true;   // garden.glb 里有 hall-kit 锚 = HALL_KIT 开（按内容判定，不看环境变量）
if (fs.existsSync(gPrePath)) {
  const gPre = parseGlbJson(fs.readFileSync(gPrePath));
  const gTri = gd.reduce((s, p) => s + triangleCounts(p.j).placed, 0), preTri = triangleCounts(gPre).placed;
  ok(`garden ${gd.length} 件 placed 三角 ${gTri} == 拆件前 garden.glb ${preTri}`, gTri === preTri, `diff=${gTri - preTri}`);
  const hallSet = new Set(HALL_IDS);
  const preHallIds = (gPre.nodes || []).map(n => n.name).filter(n => hallSet.has(n));
  if (preHallIds.length) {
    const holders = gd.map(p => ({ file: p.z.file, ids: (p.j.nodes || []).map(n => n.name).filter(n => hallSet.has(n)) })).filter(h => h.ids.length);
    ok(`厅堂套件 ${preHallIds.length} 栋锚节点全在同一 garden 件（现分布 ${holders.map(h => h.file + ':' + h.ids.length).join(', ') || '无'}）`,
      holders.length === 1 && holders[0].ids.length === preHallIds.length);
    const hp = holders.length === 1 ? gd.find(p => p.z.file === holders[0].file) : null;
    ok(`厅堂件不是 zone-garden.glb（厅堂已从主件拆出）`, !!hp && hp.z.file !== 'zone-garden.glb', hp ? hp.z.file : '无');
    if (hp) {
      const hpTri = triangleCounts(hp.j).placed, hallsTri = subtreeTris(hp.j, hallSet), preHallsTri = subtreeTris(gPre, hallSet);
      ok(`${hp.z.file} 只装厅堂：件内 placed 三角 ${hpTri} == 厅堂锚子树 ${hallsTri}`, hpTri === hallsTri, `diff=${hpTri - hallsTri}`);
      ok(`${hp.z.file} 厅堂 placed 三角 ${hpTri} == 拆件前 garden.glb 厅堂子树 ${preHallsTri}`, hpTri === preHallsTri, `diff=${hpTri - preHallsTri}`);
    }
  } else { hallKitOn = false; console.log('SKIP 厅堂件断言（garden.glb 无 hall-kit 锚，HALL_KIT=0）'); }
} else console.log('SKIP garden 分件守恒（无 garden.glb）');
// 厅堂件 meshopt 位置量化（manifest cmPositionBits，export-zones HALLS_CM_POSITION_BITS）：量化步长（gltfpack 写在网格节点 scale）
// 不得比 zone-garden.cm.glb 粗——拆件前厅堂就在那一件里，按那一件的步长量化。
const cmStep = f => { const j = parseGlbJson(fs.readFileSync(path.join(OUT, f))); return Math.max(0, ...(j.nodes || []).filter(n => n.mesh !== undefined && n.scale).map(n => Math.max(...n.scale.map(Math.abs)))); };
const g1 = gd.find(p => p.z.file === 'zone-garden.glb'), gh = gd.find(p => p.z.role === 'garden-halls');
if (g1 && gh && g1.z.cm && gh.z.cm) {
  const s1 = cmStep(g1.z.cm.file), sh = cmStep(gh.z.cm.file);
  ok(`${gh.z.cm.file} 位置量化步长 ${(sh * 1000).toFixed(2)} mm ≤ ${g1.z.cm.file} ${(s1 * 1000).toFixed(2)} mm`, sh > 0 && sh <= s1);
}
// 园区每件留余量：原始 GLB ≤ ZONE_CAP_BYTES − GARDEN_HEADROOM_BYTES。
// 上限 12 MB = 机主决策 D4（COMMON.md：分区原始 GLB 上限维持 12 MB，manifest capPerZoneBytes）；
// 余量 3 MB = GOAL wave3-zonesplit 目标 1（「每件至少留 3 MB 余量」；依据：园区还要按得月楼样板加 9 座两层楼，
// 每座约 4–5k 三角 / 约 0.35 MB 原始体积，实测估算见工单包 artifacts/RESULT.json headroomBasis）。
// 余量是给 hall-kit 楼阁（ids.json 加 id → 落进厅堂件）留的；HALL_KIT=0 时这些楼不接入、园区不再长，
// 只报告不判定（12 MB 上限仍由上面逐件 ≤ cap 断言判定）。
const ZONE_CAP_BYTES = 12000000, GARDEN_HEADROOM_BYTES = 3000000;
for (const { z } of gd) {
  const b = fs.statSync(path.join(OUT, z.file)).size;
  const label = `garden 件 ${z.file} ${b} ≤ ${ZONE_CAP_BYTES} − ${GARDEN_HEADROOM_BYTES} 余量（余 ${((ZONE_CAP_BYTES - b) / 1e6).toFixed(2)} MB）`;
  if (hallKitOn) ok(label, b <= ZONE_CAP_BYTES - GARDEN_HEADROOM_BYTES);
  else console.log(`SKIP ${label}：HALL_KIT=0，楼阁不接入，只报告（${b <= ZONE_CAP_BYTES - GARDEN_HEADROOM_BYTES ? '满足' : '不满足'}）`);
}
// 首次加载体积：「核心三区」（web/main.js ZONES.core，loadPolicy≠on-demand）meshopt 件合计，拆件前后差 ≤ ±2%
// （GOAL wave3-zonesplit 目标 2）。需给拆件前产物目录 ZONE_SPLIT_BASE_OUT，否则跳过。
const FIRST_LOAD_TOL = 0.02, CORE_ZONES = new Set(['garden', 'temple', 'bazaar', 'pond']);
const firstLoad = mm => mm.zones.filter(z => CORE_ZONES.has(z.id) && z.file && z.loadPolicy !== 'on-demand').reduce((s, z) => s + (z.cm ? z.cm.bytes : z.bytes), 0);
const baseOut = process.env.ZONE_SPLIT_BASE_OUT ? path.resolve(process.env.ZONE_SPLIT_BASE_OUT) : null;
if (baseOut && fs.existsSync(path.join(baseOut, 'zones-manifest.json'))) {
  const bm = JSON.parse(fs.readFileSync(path.join(baseOut, 'zones-manifest.json'), 'utf8'));
  const a = firstLoad(bm), b = firstLoad(m), r = (b - a) / a;
  ok(`核心三区首次加载 ${a} → ${b}（${(r * 100).toFixed(2)}%）在 ±${FIRST_LOAD_TOL * 100}% 内`, Math.abs(r) <= FIRST_LOAD_TOL);
} else console.log('SKIP 首次加载 ±2%（未给 ZONE_SPLIT_BASE_OUT）');
console.log(`zone-split-test: ${pass} pass, ${fail} fail; total ${m.totalBytes} bytes in ${m.zones.filter(z => z.file).length} files`);
process.exit(fail ? 1 : 0);
