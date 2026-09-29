// wave14-stalllight A 几何：烤制摊排烟罩必须有可信支撑（巡检 #19：罩+烟囱悬空在烤炉上方 0.56 m，视觉上靠细撑杆「漂浮」）。
// 判据（设计意图，与产物无关的独立期望）：
//   P1 罩（*_hood）下方存在 ≥2 根落地立柱（*_hoodPost）：柱底 y = 0（落地，容差 0.01）——落地是「立柱支撑」的定义，
//      不从产物读；修前产物没有 hoodPost，本判据红。
//   P2 立柱在罩 footprint 覆盖范围内（柱 x ∈ 罩 x 范围 ±0.1，柱 z 在罩后缘 −0.15…+0.05），柱顶到达罩底高度（y_max ≥ 罩 y_min − 0.05）。
//   P3 每柱有一根托臂（*_hoodArm）同时与柱、罩的包围盒相交（托住罩后缘）。
// 负例（HOOD_NEG 环境变量，对解析结果做故障注入后断言必须 FAIL）：
//   HOOD_NEG=lift  把 hoodPost 顶点整体抬离地面 +0.3（模拟「漂浮」）→ P1 红；
//   HOOD_NEG=del   丢掉全部 hoodPost → P1 红；
//   HOOD_NEG=tilt  把 hoodArm 抬高 0.2（臂不接触罩）→ P3 红。
// 用法：[STALL_DIR=out-bazaar-stalls] [HOOD_NEG=lift|del|tilt] node tests/stall-hood-support-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve(ROOT, process.env.STALL_DIR || 'out-bazaar-stalls');
const NEG = process.env.HOOD_NEG || null;
const FILE = 'stall-grill.glb';

function readGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${p}: not GLB`);
  const jsonLen = b.readUInt32LE(12);
  const g = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = b.slice(binStart);
  return { g, bin };
}
function accessorMinMax(g, bin, ai) {
  const a = g.accessors[ai];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  const bv = g.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const o = base + i * nComp * 4;
    const v = [];
    for (let c = 0; c < nComp; c++) v.push(bin.readFloatLE(o + c * 4));
    out.push(v);
  }
  return out;
}
// mesh 顶点（本地）经 node TRS 到 GLB 世界。kit builder 顶点即设计坐标、node 无变换，但按 glTF 规范走全 TRS。
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function xform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}
function meshWorldBox(g, bin, mesh, m) {
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const prim of mesh.primitives) {
    const pos = accessorMinMax(g, bin, prim.attributes.POSITION);
    for (const v of pos) {
      const w = xform(m, v);
      for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], w[c]); max[c] = Math.max(max[c], w[c]); }
    }
  }
  return { min, max };
}

const { g, bin } = readGlb(path.join(DIR, FILE));
const nodes = g.nodes || [];
const parts = [];   // { name, box }
for (const n of nodes) {
  if (!n.mesh != null && n.mesh == null) continue;
  const mesh = g.meshes[n.mesh];
  if (!mesh) continue;
  parts.push({ name: n.name || '', box: meshWorldBox(g, bin, mesh, nodeMatrix(n)) });
}
const hood = parts.filter(p => /_hood$/.test(p.name));
const posts = parts.filter(p => /_hoodPost/.test(p.name));
const arms = parts.filter(p => /_hoodArm/.test(p.name));

// 故障注入（负例只作用于断言输入，不写盘）
if (NEG === 'lift') for (const p of posts) { p.box.min[1] += 0.3; p.box.max[1] += 0.3; }
if (NEG === 'del') posts.length = 0;
if (NEG === 'tilt') for (const p of arms) { p.box.min[1] += 0.2; p.box.max[1] += 0.2; }

let fails = 0;
const fail = (msg) => { console.error('FAIL ' + msg); fails++; };
const ok = (msg) => console.log('PASS ' + msg);

if (!hood.length) { fail(`${FILE}: 找不到 *_hood 网格`); process.exit(1); }
if (!posts.length) fail(`${FILE}: 找不到 *_hoodPost 立柱（排烟罩无支撑来源——含 HOOD_NEG=del 注入的删柱故障）`);

// P1 落地
const grounded = posts.filter(p => p.box.min[1] <= 0.01);
if (posts.length && grounded.length !== posts.length)
  fail(`P1 落地立柱 ${grounded.length}/${posts.length}（柱底 y 须 = 0±0.01；修前罩悬空即此判据）: ` +
    posts.map(p => `${p.name} y_min=${p.box.min[1].toFixed(3)}`).join(', '));
else if (posts.length) ok(`P1 ${grounded.length} 根立柱全部落地（y_min=0±0.01）`);
// P2 位置与高度
const h = hood[0].box;
if (posts.length) {
  for (const p of posts) {
    const [px, , pz] = [(p.box.min[0] + p.box.max[0]) / 2, 0, (p.box.min[2] + p.box.max[2]) / 2];
    const inX = px >= h.min[0] - 0.1 && px <= h.max[0] + 0.1;
    const inZ = pz >= h.min[2] - 0.15 && pz <= h.min[2] + 0.10;   // 罩后缘侧
    const tall = p.box.max[1] >= h.min[1] - 0.05;
    if (!inX || !inZ || !tall)
      fail(`P2 立柱 ${p.name} 不在罩支撑位: x=${px.toFixed(2)}∈[${h.min[0].toFixed(2)},${h.max[0].toFixed(2)}]±0.1=${inX} z=${pz.toFixed(2)} 后缘侧=${inZ} 柱顶${p.box.max[1].toFixed(2)}≥罩底${h.min[1].toFixed(2)}−0.05=${tall}`);
  }
  if (!fails) ok(`P2 ${posts.length} 根立柱均在罩 footprint 后缘支撑位且柱顶到达罩底`);
}
// P3 托臂连接柱与罩
if (posts.length && !arms.length) fail(`P3 找不到 *_hoodArm 托臂`);
const overlap = (a, b) => a.min[0] <= b.max[0] && b.min[0] <= a.max[0] && a.min[1] <= b.max[1] && b.min[1] <= a.max[1] && a.min[2] <= b.max[2] && b.min[2] <= a.max[2];
for (const p of posts) {
  const arm = arms.find(a => Math.abs((a.box.min[0] + a.box.max[0]) / 2 - (p.box.min[0] + p.box.max[0]) / 2) < 0.05);
  if (!arm) { fail(`P3 立柱 ${p.name} 无同 x 托臂`); continue; }
  if (!overlap(arm.box, p.box)) fail(`P3 托臂 ${arm.name} 与立柱 ${p.name} 包围盒不相交`);
  if (!overlap(arm.box, h)) fail(`P3 托臂 ${arm.name} 与罩包围盒不相交（未托住罩）`);
}
if (posts.length && arms.length && !fails) ok(`P3 ${arms.length} 根托臂均同时连接立柱与罩`);

console.log(`${NEG ? '[NEG ' + NEG + '] ' : ''}stall-hood-support-test: ${fails} failure(s)`);
if (NEG) {
  if (!fails) { console.error(`负例 ${NEG} 未变红——测试抓不住该故障`); process.exit(1); }
  console.log(`负例 ${NEG} 如预期 FAIL`);
  process.exit(0);
}
process.exit(fails ? 1 : 0);
