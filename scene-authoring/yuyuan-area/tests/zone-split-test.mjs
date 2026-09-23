// Zone split completeness: the zone GLBs together must carry exactly the placed triangles and named nodes of scene-areas.glb
// (no mesh lost, none duplicated across zones), every zone within its cap, manifest sha matches files.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { parseGlbJson, triangleCounts } from '../src/reconcile.mjs';
const OUT = path.resolve(process.env.OUT_DIR || 'out');
const mp = path.join(OUT, 'zones-manifest.json');
if (!fs.existsSync(mp)) { console.log('zone-split-test: SKIP (no zones-manifest.json in', OUT, ')'); process.exit(0); }
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
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
  // gltfpack removes zero-area (degenerate) triangles; 2026-09-23 lead check: the 4 dropped in temple-1/-2 were exactly the 4 zero-area ones.
  const rt = triangleCounts(raw).placed, ct = triangleCounts(cm).placed;
  ok(`${z.cm.file} placed triangles ${ct} vs raw ${rt} (only degenerate removal, ≤0.01%)`, ct <= rt && rt - ct <= Math.max(8, rt * 1e-4), `diff=${rt - ct}`);
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
console.log(`zone-split-test: ${pass} pass, ${fail} fail; total ${m.totalBytes} bytes in ${m.zones.filter(z => z.file).length} files`);
process.exit(fail ? 1 : 0);
