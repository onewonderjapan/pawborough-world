// 檐棚放置测试（STALL_KIT=1）：量导出后的分区 GLB 里 awning-* 锚节点的真实世界姿态，
// 对照冻结布局的 footprint（不拿 records 或 assemble 输出和自己比）。
//   - 锚点在墙边中点 0.3 m 内
//   - 本地 X（檐棚长度方向）与墙边夹角 ≤ 5°
//   - 本地 +Z（出挑方向）指向楼外：中点沿 +Z 0.5 m 在 footprint 外、沿 −Z 0.5 m 在 footprint 内
// 2026-09-23：records 的 dir/outward/rotY 比墙边转了 90°，16 条檐棚全部垂直立面横穿街道，
// 之前没有任何测试覆盖。四元数直接做向量旋转，不经矩阵（garden-kit-test 的矩阵有转置 bug）。
// 用法：OUT_DIR=out-zone node tests/awning-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

if (process.env.STALL_KIT === '0') { console.log('STALL_KIT=0 — skipping'); process.exit(0); }
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const byId = new Map(layout.objects.map(o => [o.id, o]));
const ap = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'bazaar-stalls', 'records', 'awning-placements.json'), 'utf8'));

function readGltf(p) {
  const b = fs.readFileSync(p);
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function qrot(q, v) {           // v' = q v q*
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}
// self-check: +90° about +Y maps +Z to +X
{
  const s = Math.SQRT1_2;
  const r = qrot([0, s, 0, s], [0, 0, 1]);
  if (Math.abs(r[0] - 1) > 1e-9 || Math.abs(r[2]) > 1e-9) { console.log('FAIL quaternion self-check', r); process.exit(1); }
}
function worldPose(g, idx, parent) {
  let t = [0, 0, 0], q = [0, 0, 0, 1];
  for (let i = idx; i !== undefined; i = parent.get(i)) {
    const n = g.nodes[i];
    if (n.matrix) throw new Error('matrix nodes not supported');
    const nt = n.translation || [0, 0, 0], nq = n.rotation || [0, 0, 0, 1], ns = n.scale || [1, 1, 1];
    const tt = qrot(nq, [t[0] * ns[0], t[1] * ns[1], t[2] * ns[2]]);
    t = [tt[0] + nt[0], tt[1] + nt[1], tt[2] + nt[2]];
    q = qmul(nq, q);
  }
  return { t, q };
}
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const found = new Map();
for (const z of manifest.zones) {
  const g = readGltf(path.join(OUT, z.file));
  const parent = new Map();
  g.nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  g.nodes.forEach((n, i) => { if (/^awning-bld-/.test(n.name || '')) found.set(n.name, worldPose(g, i, parent)); });
}
ok(`awning anchors exported ${found.size} = ${ap.edges.length}`, found.size === ap.edges.length);

for (const e of ap.edges) {
  const id = `awning-${e.blockId}-${e.edgeIndex}`;
  const pose = found.get(id);
  if (!pose) { ok(`${id} present`, false); continue; }
  let fp = byId.get(e.blockId).geometry.footprint;
  if (fp[0][0] === fp.at(-1)[0] && fp[0][1] === fp.at(-1)[1]) fp = fp.slice(0, -1);
  const [[ax, az], [bx, bz]] = e.edge;
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  const mid = [(ax + bx) / 2, (az + bz) / 2];
  const dpos = Math.hypot(pose.t[0] - mid[0], pose.t[2] - mid[1]);
  ok(`${id} at edge midpoint (${dpos.toFixed(3)} m ≤ 0.3)`, dpos <= 0.3);
  const lx = qrot(pose.q, [1, 0, 0]);
  const ang = Math.acos(Math.min(1, Math.abs(lx[0] * ux + lx[2] * uz) / Math.hypot(lx[0], lx[2]))) * 180 / Math.PI;
  ok(`${id} length axis ∥ wall (${ang.toFixed(2)}° ≤ 5)`, ang <= 5);
  const lz = qrot(pose.q, [0, 0, 1]);
  const h = Math.hypot(lz[0], lz[2]);
  const outP = [mid[0] + lz[0] / h * 0.5, mid[1] + lz[2] / h * 0.5];
  const inP = [mid[0] - lz[0] / h * 0.5, mid[1] - lz[2] / h * 0.5];
  ok(`${id} projects out of the building`, !inside(outP, fp) && inside(inP, fp));
}
console.log(`awning-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
