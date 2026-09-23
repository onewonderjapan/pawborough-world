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
console.log(`zone-split-test: ${pass} pass, ${fail} fail; total ${m.totalBytes} bytes in ${m.zones.filter(z => z.file).length} files`);
process.exit(fail ? 1 : 0);
