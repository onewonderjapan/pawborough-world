// wave8-smallqa 渲染机位生成：四视图（正/斜俯/背/眼高1.6）+ 上下文 / 近景特写。
// 机位全部在 node 侧算好（复用 smallqa-lib 的摆放重算），输出 shots JSON 给 smallqa-render.py。
// 用法：node tests/smallqa-shots.mjs --out <shots.json> [--tag before]
//       [--context] [--closeups]   （缺省只出 25 个模块 GLB 的四视图）
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './smallqa-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const ROOT = Q.ROOT;
const OUT = opt('--out');
const TAG = opt('--tag', 'before');
const WANT_CONTEXT = args.includes('--context');
const WANT_CLOSEUPS = args.includes('--closeups');

const PAV_RE = /^(bld-428179924|bld-428186467|bld-428196085|bld-428196091|bld-428196098)(\.|$)/;
const isPavRoof = (n) => n.part === 'roof' && n.mat === 'pav-tile';

const shots = [];
const insts = [];

// ---- 模块清单 ----
for (const p of Q.pavilionInstances()) insts.push({ id: p.id, zh: p.zh, family: 'pavilion', file: path.join(ROOT, 'out-garden-kits', `pavilion-${p.id}`, 'model.glb'), position: p.position, rotY: p.rotY });
{
  const seen = new Set();
  for (const s of Q.stallInstances()) {
    if (seen.has(s.module)) continue;
    seen.add(s.module);
    insts.push({ id: s.module.replace('.glb', ''), zh: s.kind === 'bench' ? '长凳' : '摊位-' + (s.type || s.kind), family: s.kind === 'bench' ? 'bench' : 'stall', file: path.join(ROOT, 'out-bazaar-stalls', s.module), position: s.position, rotY: s.rotY });
  }
}
for (const a of Q.awningInstances()) insts.push({ id: a.id, zh: a.street || '', family: 'awning', file: path.join(ROOT, 'out-bazaar-stalls', a.module), position: a.position, rotY: a.rotY });

// 本地包围盒（GLB 根系）
const bboxOf = (file) => {
  const t = Q.readGlbTree(file);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const n of t.nodes) for (let i = 0; i < n.P.length / 3; i++) for (let c = 0; c < 3; c++) { const v = n.P[i * 3 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
  return { mn, mx };
};
const placeFn = (position, rotY) => {
  const [x, z] = position, r = rotY, c = Math.cos(r), s = Math.sin(r);
  return (lx, ly, lz) => [x + c * lx + s * lz, ly, z - s * lx + c * lz];
};

// ---- 四视图机位（同 templeqa-render 口径）。模块 GLB 导入在世界原点、保持模块本地坐标（Y-up，+Z 正面），
// 所以机位也直接用模块本地坐标——不做实例摆位（上下文镜才用世界坐标）。----
for (const it of insts) {
  const { mn, mx } = bboxOf(it.file);
  const W = mx[0] - mn[0], H = mx[1] - mn[1], D = mx[2] - mn[2];
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const d = Math.max(1.3 * W, 2.0 * (mn[1] + H), 3.0);
  const R = Math.hypot(W, D, mn[1] + H);
  const loc = {
    front: [[cx, 0.4 * (mn[1] + H) + 0.4, mx[2] + d], [cx, 0.45 * (mn[1] + H), cz], 40],
    oblique: [[cx + 0.62 * R * 1.25, 0.25 * (mn[1] + H) + 0.75 * R, mx[2] + 0.62 * R * 1.25], [cx, 0.4 * (mn[1] + H), cz], 36],
    back: [[cx, 0.4 * (mn[1] + H) + 0.4, mn[2] - d], [cx, 0.45 * (mn[1] + H), cz], 40],
    eye: [[cx + 0.28 * W, 1.6, mx[2] + Math.max(2.2, 0.55 * W)], [cx - 0.05 * W, 0.4 * (mn[1] + H), cz], 28],
  };
  for (const [view, [p, t, lens]] of Object.entries(loc)) {
    shots.push({ name: `${it.family}-${it.id}-${view}-${TAG}`, glbs: [it.file], pos: p.map((v) => +v.toFixed(3)), tgt: t.map((v) => +v.toFixed(3)), lens });
  }
}

// ---- 上下文：问题个案的世界机位（世界坐标 GLB 直接加载）----
if (WANT_CONTEXT) {
  const OUTZ = path.join(ROOT, process.env.SMALLQA_ZONES || 'out-zone');
  const world = (x, y, z) => [x, y, z];
  const ctx = [
    // 塔楼灯笼/牌匾穿檐棚（389701812）：沿街看檐棚与塔楼墙交线
    { name: `ctx-awning-389701812-${TAG}`, glbs: [path.join(OUTZ, 'zone-bazaar-3.glb'), path.join(OUTZ, 'zone-bazaar-2.glb'), path.join(OUTZ, 'zone-bazaar.glb')], pos: [-146, 6.5, -24], tgt: [-140.5, 3.0, -35.5], lens: 35 },
    // outerBuilding 穿檐棚（428202606）
    { name: `ctx-awning-428202606-${TAG}`, glbs: [path.join(OUTZ, 'zone-bazaar-2.glb'), path.join(OUTZ, 'zone-bazaar.glb'), path.join(OUTZ, 'zone-outer.glb')], pos: [-196, 5.5, -101], tgt: [-194, 3.0, -109], lens: 35 },
    // 邻块互穿（553893868/553893867）
    { name: `ctx-awning-553893868-${TAG}`, glbs: [path.join(OUTZ, 'zone-bazaar-2.glb'), path.join(OUTZ, 'zone-bazaar.glb')], pos: [-138, 5.0, -46], tgt: [-132.5, 3.0, -51.5], lens: 35 },
    // 对照：仅贴墙嵌入的普通檐棚（165791764）
    { name: `ctx-awning-165791764-${TAG}`, glbs: [path.join(OUTZ, 'zone-bazaar-2.glb'), path.join(OUTZ, 'zone-bazaar.glb')], pos: [-140, 5.5, -12], tgt: [-135, 3.0, -23], lens: 35 },
    // 长凳半叠（stall-49/50/51）
    { name: `ctx-bench-row-${TAG}`, glbs: [path.join(OUTZ, 'zone-bazaar.glb')], pos: [-128.3, 3.2, 24.5], tgt: [-126.0, 0.6, 21.6], lens: 40 },
    // 亭上下文（428196085）
    { name: `ctx-pavilion-428196085-${TAG}`, glbs: [path.join(OUTZ, 'zone-garden.glb')], pos: [-84, 7.5, -136], tgt: [-79.5, 2.5, -140.5], lens: 32 },
  ];
  for (const s of ctx) shots.push({ ...s, pos: world(...s.pos), tgt: world(...s.tgt) });
}

// ---- 近景特写 ----
if (WANT_CLOSEUPS) {
  const OUTZ = path.join(ROOT, process.env.SMALLQA_ZONES || 'out-zone');
  // 亭檐角饰冒瓦最重的 428196085（0.074 m），檐角近景（模块本地坐标）
  {
    const f = path.join(ROOT, 'out-garden-kits', 'pavilion-bld-428196085', 'model.glb');
    for (const [nm, lp, lt] of [
      [`closeup-pav-corner-428196085-a-${TAG}`, [-1.147, 3.655, -2.431], [-2.6, 4.4, -4.6]],
      [`closeup-pav-corner-428196085-b-${TAG}`, [2.4, 3.6, 1.8], [4.2, 4.6, 3.6]],
    ]) {
      shots.push({ name: nm, glbs: [f], pos: lp, tgt: lt, lens: 50 });
    }
  }
  // 椽头（反向闭合盒）428196091 檐下近景（模块本地坐标）
  {
    const f = path.join(ROOT, 'out-garden-kits', 'pavilion-bld-428196091', 'model.glb');
    shots.push({ name: `closeup-pav-rafter-428196091-${TAG}`, glbs: [f], pos: [2.9, 3.3, 0.1], tgt: [3.0, 3.25, 0.05], lens: 50 });
  }
  // 烤架晾杆悬空（模块本地机位，放在原点）
  {
    const f = path.join(ROOT, 'out-bazaar-stalls', 'stall-grill.glb');
    shots.push({ name: `closeup-grill-rack-${TAG}`, glbs: [f], pos: [1.9, 1.75, 0.9], tgt: [0.55, 1.3, 0.0], lens: 50 });
    shots.push({ name: `closeup-grill-rack-side-${TAG}`, glbs: [f], pos: [0.58, 1.35, 1.6], tgt: [0.56, 1.3, 0.0], lens: 50 });
  }
  // drink 摜柜背板冒棚顶
  {
    const f = path.join(ROOT, 'out-bazaar-stalls', 'stall-drink.glb');
    shots.push({ name: `closeup-drink-cabback-${TAG}`, glbs: [f], pos: [-1.6, 1.9, -1.4], tgt: [-0.8, 1.25, -0.42], lens: 50 });
  }
  // 檐棚布 × 街面披檐线脚（通用 16 条案例的近景：165791764 沿墙）
  {
    shots.push({ name: `closeup-awning-facadeband-${TAG}`, glbs: [path.join(OUTZ, 'zone-bazaar-2.glb'), path.join(OUTZ, 'zone-bazaar.glb')], pos: [-137.5, 3.6, -18.5], tgt: [-135.2, 3.02, -21.5], lens: 50 });
  }
}

fs.writeFileSync(OUT, JSON.stringify({ tag: TAG, shots }, null, 1));
console.log('shots', shots.length, '->', OUT);
