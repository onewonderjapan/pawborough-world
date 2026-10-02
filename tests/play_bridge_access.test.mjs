// 工单 A（playtest-remnants 20261002）：九曲桥 street→bridge 通行补丁契约测试。
// 真实数据：OUT_DIR（默认 out-zone）的 layout.json + collision-<zone>.json + 分区 GLB；
// 真实物理：AreaWalkPhysics（浏览器同一加载器）+ WalkController + CruiseDriver（生产输入链，
// 只经 setMoveInput，绝不写位置）。修复前复现：playtest-remnants outbox ROOT-CAUSE.md / DELIVERY.md。
//
// 断言四件事：
//   P1 规划推导正确——端帽回退正中 water-62072388:edge-32 的桥头端，唇墙留在开口水面侧，
//      踏步 4 级、顶高=既有台阶 topY+LIFT、从凹口爬向桥面；
//   P2 桥面起点可站立——play/viewer 两种胶囊在可见桥头 (-175.96,-109.98) 都不与任何墙相交
//      （修复前 play 胶囊与 edge-32 端帽相交 ~0.16 m，这是「正面台阶如撞墙」的隐形部分）；
//   P3 自然走向可上桥——从台阶凹口（测试员被阻点 (-175.72,-108.50) 北侧）沿生产控制器直行，
//      踏新踏步上桥面（修复前此处是 0.51 m 直立面，4 s 无进展）；
//   P4 全程可达+水防护不弱——锚点→岸道→台阶→桥面→湖心亭抱厦内→原路回到锚点双向可达，
//      途中任意时刻脚下有地面、脚高 ≥0.45（桥/抱厦面）、不与墙相交；桥头以南沿水线直行不落穿
//      （minimumGroundY -0.1 下界 + 唇墙，任何时刻脚不低于 -0.1）。
// 用法：OUT_DIR=out-zone node tests/play_bridge_access.test.mjs（仓库根）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { AreaWalkPhysics } from '../scene-authoring/yuyuan-area/src/areaWalkPhysics.js';
import { WalkController } from '../src/player/WalkController.js';
import { CruiseDriver } from '../src/player/cruise.js';
import { planBridgeAccess, applyAccessPhysics, planSeamBridges, porchApproachPath } from '../scene-authoring/yuyuan-area/web/play/bridge-access.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'scene-authoring/yuyuan-area/out-zone');
const readOut = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));

const layout = readOut('layout.json');
const ZONES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];
const collisionZones = ZONES.map((z) => ({ zone: z, records: readOut(`collision-${z}.json`).colliders }));

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

// ---------- P1 规划推导 ----------
const plan = planBridgeAccess({ layout, collisionZones, capsuleRadius: 0.28 });
const trim = plan.trims.find((t) => t.name === 'water-water-62072388:edge-32');
check(!!trim, 'P1 trim: bridge-adjacent guard end cap is targeted', trim ? `newEnd=(${trim.newEnd[0].toFixed(2)},${trim.newEnd[1].toFixed(2)})` : 'missing');
check(plan.trims.length >= 1 && plan.trims.length <= 4, 'P1 trim: narrowly scoped (only landing-adjacent guards)', `count=${plan.trims.length}`);
check(plan.lips.length >= 1, 'P1 lips: bridge-crossed water opening gets lip walls', `count=${plan.lips.length}`);
for (const lip of plan.lips) {
  // 唇墙必须在桥折线两侧留出桥口：唇墙段上的点到桥轴最近距离 ≥ 桥半宽
  const BR = layout.objects.find((o) => o.id === 'jiuqu-bridge').geometry.polyline;
  const mid = [(lip.a[0] + lip.b[0]) / 2, (lip.a[1] + lip.b[1]) / 2];
  let nearest = Infinity;
  for (let j = 0; j + 1 < BR.length; j++) {
    const a = BR[j], ab = [BR[j + 1][0] - a[0], BR[j + 1][1] - a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = Math.max(0, Math.min(1, ((mid[0] - a[0]) * ab[0] + (mid[1] - a[1]) * ab[1]) / (l2 || 1)));
    nearest = Math.min(nearest, Math.hypot(mid[0] - (a[0] + ab[0] * t), mid[1] - (a[1] + ab[1] * t)));
  }
  check(nearest >= 1.2 + 0.28, `P1 lip clears the deck mouth (${lip.name})`, `nearestToDeckAxis=${nearest.toFixed(2)}m`);
}
const steps = plan.steps;
check(steps && steps.stepCount === 4 && steps.boxes.length === 4, 'P1 steps: 4 treads derived from the existing layout step record');
{
  const tops = steps.boxes.map((b) => +b.y1.toFixed(4));
  const descending = tops.every((t, i) => i === 0 || t < tops[i - 1]);
  check(descending && Math.abs(tops[0] - 0.555) < 0.01, 'P1 steps: tops descend from deck-side 0.555 (topY+LIFT)', tops.join(','));
  // 爬向 = 从凹口指向桥面：与陆侧法线相反（climb ≈ -N），且从最外踏步中点沿 climb 走会跨进桥半宽
  {
    const N = [steps.climb[0] * -1, steps.climb[1] * -1];
    check(steps.climb[0] * N[0] + steps.climb[1] * N[1] < -0.99, 'P1 steps: climb direction points off the land normal (toward the deck)');
    const outer = steps.boxes.at(-1);
    const midOuter = [(outer.corners[0][0] + outer.corners[1][0] + outer.corners[2][0] + outer.corners[3][0]) / 4,
      (outer.corners[0][1] + outer.corners[1][1] + outer.corners[2][1] + outer.corners[3][1]) / 4];
    const stepped = [midOuter[0] + steps.climb[0] * 0.32, midOuter[1] + steps.climb[1] * 0.32];
    const BRp = layout.objects.find((o) => o.id === 'jiuqu-bridge').geometry.polyline;
    const distAfter = (p) => {
      let best = Infinity;
      for (let j = 0; j + 1 < BRp.length; j++) {
        const a = BRp[j], ab = [BRp[j + 1][0] - a[0], BRp[j + 1][1] - a[1]];
        const l2 = ab[0] * ab[0] + ab[1] * ab[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (l2 || 1)));
        best = Math.min(best, Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t)));
      }
      return best;
    };
    check(distAfter(stepped) < distAfter(midOuter), 'P1 steps: climbing closes the distance to the deck');
  }
}

// ---------- 真实物理世界（浏览器同一加载器，含补丁） ----------
await RAPIER.init();
const world = new AreaWalkPhysics({
  RAPIER,
  manifest: readOut('zones-manifest.json'),
  readJson: async (f) => readOut(f),
  readBytes: async (f) => fs.readFileSync(path.join(OUT, f)),
});
await world.loadZones(ZONES);
const physics = world.physics;
// 缝探测（与浏览器 walk.js 钩子同一实现：物理世界地面射线，路径=桥折线+门口进出线）
{
  const BRp = layout.objects.find((o) => o.id === 'jiuqu-bridge').geometry.polyline;
  const approach = porchApproachPath(layout);
  check(!!approach, 'P5 porch approach path derived (B0→I0)', approach ? `B0=(${approach.B0[0].toFixed(2)},${approach.B0[1].toFixed(2)})` : 'missing');
  const gh = new Set(world.groundColliders.map((c) => c.handle));
  const probe = (x, z) => {
    const h = physics.world.castRay(new RAPIER.Ray({ x, y: 3, z }, { x: 0, y: -1, z: 0 }), 8, true,
      undefined, undefined, undefined, undefined, (c) => gh.has(c.handle));
    return h ? 3 - h.timeOfImpact : null;
  };
  plan.seamSlabs = planSeamBridges({ paths: [BRp, approach?.path].filter(Boolean), probe }).slabs;
  check(plan.seamSlabs.length >= 1, 'P5 seam plan: deck↔porch expansion joint detected for bridging',
    plan.seamSlabs.map((s) => `seam ${(s.seam[1] - s.seam[0]).toFixed(2)}m`).join(', ') || 'none');
}
const applied = applyAccessPhysics(RAPIER, physics, plan, world);
check(applied.trimmed.includes('water-water-62072388:edge-32') && applied.lipsAdded >= 1 && applied.stepsCollider !== null,
  'P1 applied: trim + lip + steps/seam colliders live in the physics world',
  `trimmed=${applied.trimmed.length} lips=${applied.lipsAdded} seams=${applied.seamSlabs}`);

const groundHandles = new Set(world.groundColliders.map((c) => c.handle));
const wallHandles = new Set(physics.colliders.map((c) => c.handle));
const groundY = (x, z, top = 8) => {
  const h = physics.world.castRay(new RAPIER.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 12, true,
    undefined, undefined, undefined, undefined, (c) => groundHandles.has(c.handle));
  const y = h ? top - h.timeOfImpact : null;
  return y !== null && y >= -0.1 ? y : null;
};
const PLAY_CAPSULE = { radius: 0.28, halfHeight: 0.2, eyeHeight: 0.8, autostep: 0.15, minimumGroundY: -0.1 };

// ---------- P2 桥头可站立 ----------
{
  const shapeP = new RAPIER.Capsule(0.2, 0.28);
  const shapeV = new RAPIER.Capsule(0.6, 0.35);
  for (const [name, shape, r] of [['play r0.28', shapeP, 0.28], ['viewer r0.35', shapeV, 0.35]]) {
    const gy = groundY(-175.96, -109.98);
    const hit = physics.world.intersectionWithShape(
      { x: -175.96, y: (gy ?? 0.55) + r + 0.21, z: -109.98 }, { x: 0, y: 0, z: 0, w: 1 }, shape,
      undefined, undefined, undefined, undefined, (c) => wallHandles.has(c.handle));
    const wallName = hit ? (physics.colliders.find((c) => c.handle === hit)?.record?.name || hit) : 'none';
    check(!hit, `P2 deck start standable (${name})`, `wall=${wallName}`);
  }
}

// ---------- 通用步行（生产控制器 + CruiseDriver） ----------
function walkRoute(label, pts, { reachRadius = 0.35, maxSeconds = 150 } = {}) {
  const [sx, sz] = pts[0];
  const sy = groundY(sx, sz, 2) ?? 0.5;
  const ctl = new WalkController({
    RAPIER, physics,
    capsule: { ...PLAY_CAPSULE, speed: 2.6, runSpeed: 4.2, groundColliders: () => world.groundColliders, spawn: [sx, sy + 0.05, sz] },
  });
  const driver = new CruiseDriver({ controller: ctl, waypoints: pts.map(([x, z]) => [x, 0, z]), reachRadius, timeoutSteps: 60 * maxSeconds });
  let i = 0, fail = null, stalled = 0, minY = Infinity, last = ctl.feetPosition(), elevatedMinY = Infinity;
  while (!driver.done) {
    driver.tick(1 / 60); ctl.step(1 / 60); i++;
    const f = ctl.feetPosition();
    minY = Math.min(minY, f[1]);
    if (f[1] > 0.45) {   // 上了桥面/抱厦（≥0.45）之后不允许再掉回低处（street 0.06 是合法起点）
      elevatedMinY = Math.min(elevatedMinY, f[1]);
      if (elevatedMinY < 0.4) { fail = `dropped off the deck to ${f[1].toFixed(3)} at (${f[0].toFixed(2)},${f[2].toFixed(2)})`; break; }
    }
    if (f[1] < -0.1) { fail = `fell below -0.1 at (${f[0].toFixed(2)},${f[1].toFixed(3)},${f[2].toFixed(2)})`; break; }
    const body = ctl.body.translation();
    const wall = physics.world.intersectionWithShape(body, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(0.2, 0.28),
      undefined, undefined, ctl.collider, undefined, (c) => wallHandles.has(c.handle));
    if (wall) { fail = `capsule in wall at (${f[0].toFixed(2)},${f[1].toFixed(3)},${f[2].toFixed(2)})`; break; }
    if (Math.hypot(f[0] - last[0], f[2] - last[2]) > 0.02) { stalled = 0; last = f; } else if (++stalled >= 60 * 8) { fail = `no progress 8s at (${f[0].toFixed(2)},${f[1].toFixed(3)},${f[2].toFixed(2)}) wp ${driver.i}/${driver.status().total}`; break; }
    if (i > 60 * maxSeconds) { fail = `timeout at (${f[0].toFixed(2)},${f[1].toFixed(3)},${f[2].toFixed(2)}) wp ${driver.i}/${driver.status().total}`; break; }
  }
  const f = ctl.feetPosition();
  const status = driver.status();
  const end = pts.at(-1);
  const err = Math.hypot(f[0] - end[0], f[2] - end[1]);
  ctl.dispose();
  return { pass: !fail && driver.done, fail, minY, elevatedMinY, end: f, err, reached: status.reached, total: status.total };
}

// ---------- P3 自然走向上桥（修复前的阻点出发，直行即爬上新踏步） ----------
{
  const r = walkRoute('P3 pocket → deck via the new landing steps', [
    [-176.35, -107.9],   // 凹口（测试员 ESE 走到 (-175.72,-108.50) 被阻处的北侧通路）
    [-176.5, -108.35],   // 踏步基线
    [-176.55, -109.6],   // 爬完 4 级，落桥面
    [-175.6, -110.3],    // 桥首段
  ], { reachRadius: 0.4 });
  check(r.pass && r.end[1] > 0.5, 'P3 natural approach climbs onto the deck', r.fail || `endY=${r.end[1].toFixed(3)}`);
}

// ---------- P5 抱厦门口让桥缝可穿过（play 胶囊，修复前 unsupported 卡死） ----------
{
  const r = walkRoute('P5 play capsule crosses the porch-mouth seam', [
    [-151.37, -134.44],   // 缝北侧（桥面 0.55）
    [-151.17, -133.36],   // 缝南侧（抱厦地面 0.57，IN_V 一带）
  ], { reachRadius: 0.4, maxSeconds: 40 });
  check(r.pass, 'P5 play capsule crosses the porch seam', r.fail || 'ok');
  const r2 = walkRoute('P5 seam return', [
    [-151.17, -133.36],
    [-151.37, -134.44],
  ], { reachRadius: 0.4, maxSeconds: 40 });
  check(r2.pass, 'P5 play capsule crosses the porch seam (return)', r2.fail || 'ok');
}

// ---------- P4 全程往返（锚点→岸道→台阶→桥→湖心亭抱厦→原路回锚点） ----------
{
  // 湖心亭门前点/抱厦内点：与 tests/huxinting-walkin-check.mjs 同法从 layout 重算
  const ht = layout.objects.find((o) => o.id === 'huxin-ting');
  let FP = ht.geometry.footprint.slice();
  if (FP[0][0] === FP.at(-1)[0] && FP[0][1] === FP.at(-1)[1]) FP = FP.slice(0, -1);
  let A2 = 0, cxs = 0, czs = 0;
  for (let i = 0; i < FP.length; i++) {
    const [x0, z0] = FP[i], [x1, z1] = FP[(i + 1) % FP.length];
    const cr = x0 * z1 - x1 * z0;
    A2 += cr; cxs += (x0 + x1) * cr; czs += (z0 + z1) * cr;
  }
  const CX = cxs / (3 * A2), CZ = czs / (3 * A2);
  let best = null;
  for (let i = 0; i < FP.length; i++) {
    const a = FP[i], b = FP[(i + 1) % FP.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || L > best[0]) best = [L, a, b];
  }
  const UX = (best[2][0] - best[1][0]) / best[0], UZ = (best[2][1] - best[1][1]) / best[0];
  const VX = UZ, VZ = -UX;
  const toLocal = (x, z) => [(x - CX) * UX + (z - CZ) * UZ, (x - CX) * VX + (z - CZ) * VZ];
  const toWorld = (u, v) => [CX + u * UX + v * VX, CZ + u * UZ + v * VZ];
  const LV = FP.map((p) => toLocal(p[0], p[1])[1]);
  const V0 = (Math.max(...LV) - Math.min(...LV)) / 2;
  const BR = layout.objects.find((o) => o.id === 'jiuqu-bridge').geometry.polyline;
  const BL = BR.map((p) => toLocal(p[0], p[1]));
  let hit = null;
  for (let i = 0; i + 1 < BL.length; i++) {
    const [ua, va] = BL[i], [ub, vb] = BL[i + 1];
    if ((ua > 0) === (ub > 0) || ua === ub) continue;
    const t = ua / (ua - ub), v = va + (vb - va) * t;
    if (v > V0 && (!hit || v < hit.v)) hit = { i, t, v };
  }
  const cum = [0];
  for (let i = 1; i < BR.length; i++) cum.push(cum[i - 1] + Math.hypot(BR[i][0] - BR[i - 1][0], BR[i][1] - BR[i - 1][1]));
  const sHit = cum[hit.i] + hit.t * (cum[hit.i + 1] - cum[hit.i]);
  const at = (s) => {
    let i = 0;
    while (i + 2 < cum.length && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / (cum[i + 1] - cum[i]);
    return [BR[i][0] + (BR[i + 1][0] - BR[i][0]) * t, BR[i][1] + (BR[i + 1][1] - BR[i][1]) * t];
  };
  const IN_V = V0 + 0.62;
  const porch = toWorld(0, IN_V);
  const cumAll = [0];
  for (let i = 1; i < BR.length; i++) cumAll.push(cumAll[i - 1] + Math.hypot(BR[i][0] - BR[i - 1][0], BR[i][1] - BR[i - 1][1]));
  const sHitAll = cumAll[hit.i] + hit.t * (cumAll[hit.i + 1] - cumAll[hit.i]);
  const B0 = at(sHitAll);   // 桥上门前点（walkin 同口径）

  // 去：锚点 → 岸道 → 新踏步上桥 → 桥（全折线）→ 门前点 → 抱厦内
  const outPts = [
    [-159.75, -100.75],            // jiuqu 锚点（公开出生点）
    [-168.5, -103.5], [-173.0, -103.2],   // 广场，绕护栏拐角外侧
    [-175.6, -105.2], [-176.7, -107.0],   // 岸道南下（新踏步正上方入口）
    [-176.5, -108.4],                     // 踏新踏步
    [-176.45, -109.7], [-175.5, -110.9],  // 落桥面、沿南缘过桥头
    ...BR.slice(1, hit.i + 1).map((p) => [p[0], p[1]]),
    B0, porch,
  ];
  // 回：抱厦内 → 门前点 → 桥折线逆向 → 桥头 → 新踏步下到岸道 → 绕 pt32 拐角 → 锚点
  const backPts = [
    porch, B0,
    ...BR.slice(1, hit.i + 1).map((p) => [p[0], p[1]]).reverse(),
    [-175.5, -110.9], [-176.5, -109.9],            // 桥面起点南缘
    [-176.5, -108.6], [-176.6, -107.3],            // 新踏步下到凹口
    [-176.4, -105.9],                              // 岸道北上
    [-175.8, -104.9], [-174.9, -103.9],            // 绕 pt32 护栏拐角外侧
    [-173.0, -103.2], [-168.5, -103.5], [-159.75, -100.75],
  ];
  const out = walkRoute('P4 street→bridge→porch', outPts, { reachRadius: 0.4, maxSeconds: 220 });
  check(out.pass && out.elevatedMinY >= 0.4, 'P4 street→bridge→huxinting porch reachable', out.fail || `endErr=${out.err.toFixed(2)} elevatedMinY=${out.elevatedMinY.toFixed(3)}`);

  const back = walkRoute('P4 porch→bridge→street (return)', backPts, { reachRadius: 0.4, maxSeconds: 220 });
  check(back.pass && back.elevatedMinY >= 0.4, 'P4 huxinting porch→bridge→street return reachable', back.fail || `endErr=${back.err.toFixed(2)} elevatedMinY=${back.elevatedMinY.toFixed(3)}`);

  // 水线防护：桥头以南沿水线直行（测试员落水方向），不得穿到 -0.1 以下
  const guard = walkRoute('P4 shoreline south of the bridge start stays safe', [
    [-176.6, -110.9], [-176.5, -112.2], [-176.4, -113.8], [-176.2, -115.5],
  ], { reachRadius: 0.5, maxSeconds: 60 });
  check(guard.minY >= -0.1, 'P4 no fall through the waterline (lip + support guard)', `minY=${guard.minY.toFixed(3)}${guard.fail ? ' (' + guard.fail + ')' : ''}`);
}

physics.dispose();
console.log(`RESULT play_bridge_access ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exitCode = failed === 0 ? 0 : 1;
