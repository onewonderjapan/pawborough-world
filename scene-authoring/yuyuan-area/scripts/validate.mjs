// 校验：gltf-validator 检查全部交付 GLB + 真实计数（unique vs placed 三角、节点数、图片数）。
// placed = 节点树实例化后的三角形数（与 coverage/reconcile 同一实现）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';
import { parseGlbJson, triangleCounts } from '../src/reconcile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');

const FILES = ['scene-areas.glb', 'garden.glb', 'temple.glb', 'bazaar.glb',
  'procedural-garden.glb', 'procedural-temple.glb', 'procedural-bazaar.glb', 'procedural-pond.glb', 'procedural-outer.glb'];

const report = { validator: {}, stats: [], issues: [] };
for (const f of FILES) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) { report.issues.push(`missing ${f}`); continue; }
  try {
    const res = await validateBytes(new Uint8Array(fs.readFileSync(p)));
    report.validator[f] = { issues: { numErrors: res.issues.numErrors, numWarnings: res.issues.numWarnings } };
    if (res.issues.numErrors > 0) {
      report.issues.push(`${f}: ${res.issues.numErrors} validator errors: ${JSON.stringify(res.issues.messages?.slice(0, 5) || [])}`);
    }
    const buf = fs.readFileSync(p);
    const j = parseGlbJson(buf);
    const tri = triangleCounts(j);
    report.stats.push({
      file: f, bytes: buf.length,
      meshes: (j.meshes || []).length, nodes: (j.nodes || []).length,
      uniqueTriangles: tri.unique, placedTriangles: tri.placed,
      images: (j.images || []).length,
    });
  } catch (e) {
    report.issues.push(`${f}: validator failed ${e.message}`);
  }
}
fs.writeFileSync(path.join(OUT, 'validation.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.stats.map(s =>
  `${s.file}: ${(s.bytes / 1e6).toFixed(1)}MB unique=${(s.uniqueTriangles / 1000).toFixed(0)}k placed=${(s.placedTriangles / 1000).toFixed(0)}k nodes=${s.nodes}`), null, 1));
if (report.issues.length) { console.error('ISSUES:', report.issues); process.exit(2); }
console.log('validation clean');
