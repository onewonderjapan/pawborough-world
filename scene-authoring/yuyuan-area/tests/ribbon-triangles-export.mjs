// wave10-streetfix R3（审查必修3）：用 Node 直接跑 src/lib.mjs 的 ribbon()，把渲染端真实生成的
// 三角形（顶点取自 BufferGeometry 的 position/index）导出为 JSON，供 Python 侧测试做期望值。
// 测试不许拿 Python 复刻实现和自己比——期望值必须出自渲染端这一份代码。
// 用法：node tests/ribbon-triangles-export.mjs <layout.json> <roadId>
import { readFileSync } from 'node:fs';
import { ribbon } from '../src/lib.mjs';

const [layoutPath, roadId] = process.argv.slice(2);
const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
const o = layout.objects.find(x => x.id === roadId);
if (!o || !o.geometry || !o.geometry.polyline) {
  console.error(`road ${roadId} (polyline) not found in ${layoutPath}`);
  process.exit(2);
}
const pts = o.geometry.polyline;
const width = o.geometry.width;
const mesh = ribbon(pts, width, 0, 0xffffff, 'export');
const pos = mesh.geometry.attributes.position.array;
const idx = mesh.geometry.index.array;
const triangles = [];
for (let i = 0; i < idx.length; i += 3) {
  const tri = [];
  for (const vi of [idx[i], idx[i + 1], idx[i + 2]]) tri.push([pos[vi * 3], pos[vi * 3 + 2]]);
  triangles.push(tri);
}
console.log(JSON.stringify({ id: roadId, width, points: pts.length, triangles }));
