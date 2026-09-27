// wave11-huxwalk（主控 2026-09-27 选项 1）：从九曲桥走进湖心亭抱厦、在抱厦里转一趟、原路回到桥上，正反各一次。
// 真实输入链：OUT_DIR 的分区 raw GLB + collision-<zone>.json -> AreaWalkPhysics（浏览器同一份）-> WalkController + CruiseDriver
// （只经 setMoveInput，不写位置）。路线点一律从 baseline/layout.json 重算（湖心亭局部系同 modules/huxinting/build.py：
// footprint 面积形心 + 最长边主轴，+v 临桥；桥中线 = layout jiuqu-bridge.polyline），不读产物里的湖心亭 / 桥几何。
// 判据（每个物理步）：脚下有步行地面（脚心及 0.10 m 四点向下射线命中地面 trimesh）、脚不低于地面 0.05、脚高 ≥ 0.45（桥面 / 抱厦地面 0.55–0.57，
// 掉进水里或落到池底都会低于此值）、胶囊不与任何碰撞墙相交、10 s 无水平进展即判卡死；全部路线点到达、终点误差 ≤ 0.3 m、
// 最深进入抱厦：局部 v ≤ V0 + 0.8（主楼 +v 墙线外 0.8 m，抱厦前檐在 V0 + 1.1 以外）。另从抱厦中心向 16 个方向各直走 4 s（护栏探针）：任何时刻都要有地面、脚高 ≥ 0.45。
// HUXINTING=0（程序化占位方块，没有抱厦）时跳过。
// 用法：OUT_DIR=out-zone [ART_DIR=<工作区外目录>] [RUN_TAG=x] node tests/huxinting-walkin-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { AreaWalkPhysics } from '../src/areaWalkPhysics.js';
import { WalkController } from '../../../src/player/WalkController.js';
import { CruiseDriver } from '../../../src/player/cruise.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
if (process.env.HUXINTING === '0') { console.log('SKIP huxinting-walkin: HUXINTING=0 (procedural placeholder, no porch)'); process.exit(0); }
let ART = null;
if (process.env.ART_DIR) {
  ART = path.resolve(process.env.ART_DIR);
  const REPO = path.resolve(AREA, '../..');
  if (ART === REPO || ART.startsWith(REPO + path.sep)) throw new Error('ART_DIR must be outside the workspace');
  fs.mkdirSync(ART, { recursive: true });
}
const readOut = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(AREA, 'baseline', 'layout.json'), 'utf8'));

// ---------- 湖心亭局部系（layout 重算，同 build.py） ----------
const ht = layout.objects.find((o) => o.id === 'huxin-ting');
let FP = ht.geometry.footprint;
if (FP[0][0] === FP.at(-1)[0] && FP[0][1] === FP.at(-1)[1]) FP = FP.slice(0, -1);
const nF = FP.length;
let A2 = 0, cxs = 0, czs = 0;
for (let i = 0; i < nF; i++) {
  const [x0, z0] = FP[i], [x1, z1] = FP[(i + 1) % nF];
  const cr = x0 * z1 - x1 * z0;
  A2 += cr; cxs += (x0 + x1) * cr; czs += (z0 + z1) * cr;
}
const CX = cxs / (3 * A2), CZ = czs / (3 * A2);
let best = null;
for (let i = 0; i < nF; i++) {
  const a = FP[i], b = FP[(i + 1) % nF], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!best || L > best[0]) best = [L, a, b];     // 同 Python max(...)：等长取后者不会发生（6 点 footprint 边长互异）
}
let UX = (best[2][0] - best[1][0]) / best[0], UZ = (best[2][1] - best[1][1]) / best[0];
if (UX < 0) { UX = -UX; UZ = -UZ; }
const VX = UZ, VZ = -UX;
const toLocal = (x, z) => [(x - CX) * UX + (z - CZ) * UZ, (x - CX) * VX + (z - CZ) * VZ];
const toWorld = (u, v) => [CX + u * UX + v * VX, CZ + u * UZ + v * VZ];
const LV = FP.map((p) => toLocal(p[0], p[1])[1]);
const V0 = (Math.max(...LV) - Math.min(...LV)) / 2;   // 同 build.py：footprint 在局部系的半进深（主楼 +v 墙线）

// ---------- 桥中线与抱厦中心线（u = 0）的交点：桥上门前点 B0 ----------
const bridge = layout.objects.find((o) => o.id === 'jiuqu-bridge');
const BR = bridge.geometry.polyline;
const BL = BR.map((p) => toLocal(p[0], p[1]));
let hit = null;
for (let i = 0; i + 1 < BL.length; i++) {
  const [ua, va] = BL[i], [ub, vb] = BL[i + 1];
  if ((ua > 0) === (ub > 0) || ua === ub) continue;
  const t = ua / (ua - ub), v = va + (vb - va) * t;
  if (v > V0 && (!hit || v < hit.v)) hit = { i, t, v };
}
if (!hit) throw new Error('bridge centreline does not cross the porch centreline on the bridge side');
// 桥中线弧长参数化，取门前点前后 4 m 作起终点（沿桥走，含中间折点）
const cum = [0];
for (let i = 1; i < BR.length; i++) cum.push(cum[i - 1] + Math.hypot(BR[i][0] - BR[i - 1][0], BR[i][1] - BR[i - 1][1]));
const sHit = cum[hit.i] + hit.t * (cum[hit.i + 1] - cum[hit.i]);
const at = (s) => {
  let i = 0;
  while (i + 2 < cum.length && cum[i + 1] < s) i++;
  const t = (s - cum[i]) / (cum[i + 1] - cum[i]);
  return [BR[i][0] + (BR[i + 1][0] - BR[i][0]) * t, BR[i][1] + (BR[i + 1][1] - BR[i][1]) * t];
};
const alongBridge = (s0, s1) => {
  const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const pts = [at(lo)];
  for (let i = 0; i < cum.length; i++) if (cum[i] > lo && cum[i] < hi) pts.push(BR[i]);
  pts.push(at(hi));
  return s1 < s0 ? pts.reverse() : pts;
};
const B0 = at(sHit);
const IN_V = V0 + 0.62;               // 抱厦内：门扇（主楼墙 V0 外 ≈0.1）与前檐裙墙内皮之间的中线
const I0 = toWorld(0, IN_V), IW = toWorld(-1.3, IN_V), IE = toWorld(1.3, IN_V);
const fwdPts = [...alongBridge(sHit - 4, sHit), I0, IW, IE, I0, ...alongBridge(sHit, sHit + 4)];
const dedupe = (pts) => pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
const routes = [['forward (west→porch→east)', dedupe(fwdPts)], ['return (east→porch→west)', dedupe(fwdPts).reverse()]];

// ---------- 物理（浏览器同一加载器；池带 + 园区） ----------
await RAPIER.init();
const manifest = readOut('zones-manifest.json');
const world = new AreaWalkPhysics({ RAPIER, manifest, readJson: async (f) => readOut(f), readBytes: async (f) => fs.readFileSync(path.join(OUT, f)) });
await world.loadZones(['pond', 'garden']);
const physics = world.physics;
const groundHandles = new Set(world.groundColliders.map((c) => c.handle));
const wallHandles = new Set(physics.colliders.map((c) => c.handle));
const groundY = (x, z, top) => {
  const h = physics.world.castRay(new RAPIER.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 6, true,
    undefined, undefined, undefined, undefined, (c) => groundHandles.has(c.handle));
  return h ? top - h.timeOfImpact : null;
};
const capsule = { radius: 0.35, halfHeight: 0.6, eyeHeight: 1.6 };
const shape = new RAPIER.Capsule(0.6, 0.35);
const MIN_FEET_Y = 0.45;
const pond = readOut('collision-pond.json');
const htRecords = pond.colliders.filter((c) => c.name.startsWith('huxin-ting:')).map((c) => c.name);

// 脚下支撑：脚心 + 半径 0.10 m 四点向下射线取最高（胶囊底半径 0.35；门槛与桥面之间有 0.02 m 让桥缝，单根脚心射线会漏过这条缝）
const supportY = (x, z, top) => {
  let y = null;
  for (const [dx, dz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
    const g = groundY(x + dx, z + dz, top);
    if (g !== null && (y === null || g > y)) y = g;
  }
  return y;
};
function guardStep(controller) {
  const feet = controller.feetPosition();
  const gy = supportY(feet[0], feet[2], feet[1] + 0.2);
  const pos = controller.body.translation();
  const wall = physics.world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape,
    undefined, undefined, controller.collider, undefined, (c) => wallHandles.has(c.handle));
  if (!feet.every(Number.isFinite)) return { feet, fail: 'nonfinite feet' };
  if (gy === null) return { feet, fail: 'no walk ground under the feet' };
  if (feet[1] - gy < -0.05) return { feet, fail: `below support by ${(feet[1] - gy).toFixed(3)} m` };
  if (feet[1] < MIN_FEET_Y) return { feet, fail: `feet y ${feet[1].toFixed(3)} < ${MIN_FEET_Y} (fell off the deck / into the pond)` };
  if (wall) return { feet, fail: `capsule intersects wall handle ${wall.handle}` };
  return { feet, gy, fail: null };
}

const results = [];
for (const [direction, pts] of routes) {
  const [sx, sz] = pts[0];
  const sy = groundY(sx, sz, 2);
  const controller = new WalkController({ RAPIER, physics, capsule: { ...capsule, spawn: [sx, (sy ?? 0.55) + 0.05, sz] } });
  const driver = new CruiseDriver({ controller, waypoints: pts.map(([x, z]) => [x, 0, z]), reachRadius: 0.18, timeoutSteps: 60 * 180 });
  let steps = 0, failure = null, stalled = 0, last = controller.feetPosition(), minV = Infinity, maxY = -Infinity, minY = Infinity;
  const trace = [];
  while (!driver.done) {
    driver.tick(1 / 60); controller.step(1 / 60); steps++;
    const g = guardStep(controller);
    const feet = g.feet;
    minV = Math.min(minV, toLocal(feet[0], feet[2])[1]);
    if (Number.isFinite(feet[1])) { maxY = Math.max(maxY, feet[1]); minY = Math.min(minY, feet[1]); }
    if (steps % 30 === 0 || g.fail) trace.push({ steps, feet: feet.map((q) => +q.toFixed(3)), local: toLocal(feet[0], feet[2]).map((q) => +q.toFixed(3)), waypoint: driver.i });
    if (g.fail) { failure = g.fail; break; }
    if (Math.hypot(feet[0] - last[0], feet[2] - last[2]) > 0.02) { stalled = 0; last = feet; } else if (++stalled >= 600) { failure = `no horizontal progress for 10 s at waypoint ${driver.i}`; break; }
  }
  const feet = controller.feetPosition(), end = pts.at(-1);
  const endpointError = Math.hypot(feet[0] - end[0], feet[2] - end[1]);
  const deepEnough = minV <= V0 + 0.8;   // 局部 v ≤ V0 + 0.8：确实进到抱厦里（抱厦前檐 / 门口线在 V0 + 1.1 以外）
  const pass = !failure && driver.done && !driver.blocked && endpointError <= 0.3 && deepEnough;
  results.push({ direction, pass, steps, simulatedSeconds: +(steps / 60).toFixed(2), failure, blocked: driver.blocked, reached: driver.status().reached,
    total: driver.status().total, endpointError: +endpointError.toFixed(4), deepestLocalV: +minV.toFixed(3), needLocalVAtMost: +(V0 + 0.8).toFixed(3),
    feetYRange: [+minY.toFixed(3), +maxY.toFixed(3)], trace });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${direction}: steps ${steps}, reached ${driver.status().reached}/${driver.status().total}, end err ${endpointError.toFixed(3)} m, deepest v ${minV.toFixed(2)} (need ≤ ${(V0 + 0.8).toFixed(2)}), feet y ${minY.toFixed(3)}..${maxY.toFixed(3)}${failure ? ', failure: ' + failure : ''}`);
  controller.dispose();
}

// ---------- 护栏探针：从抱厦中心向 16 个方向直走 4 s（只有当抱厦可达时才有意义；可达性由上面路线判定） ----------
const probes = [];
if (results.every((r) => r.pass)) {
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2;
    const c = new WalkController({ RAPIER, physics, capsule: { ...capsule, spawn: [I0[0], 0.62, I0[1]] } });
    for (let i = 0; i < 30; i++) c.step(1 / 60);   // 落地
    c.yaw = yaw; c.setMoveInput(1, 0);
    let fail = null, far = 0;
    for (let i = 0; i < 240 && !fail; i++) {
      c.step(1 / 60);
      const g = guardStep(c);
      fail = g.fail;
      far = Math.max(far, Math.hypot(g.feet[0] - I0[0], g.feet[2] - I0[1]));
    }
    const f = c.feetPosition();
    probes.push({ yawDeg: +(yaw * 180 / Math.PI).toFixed(1), pass: !fail, fail, end: f.map((q) => +q.toFixed(3)), endLocal: toLocal(f[0], f[2]).map((q) => +q.toFixed(3)), maxDistFromPorchCentre: +far.toFixed(2) });
    c.dispose();
  }
  const bad = probes.filter((p) => !p.pass);
  console.log(`${bad.length ? 'FAIL' : 'PASS'} guard probes: ${probes.length - bad.length}/${probes.length} keep walk ground under the feet (max ${Math.max(...probes.map((p) => p.maxDistFromPorchCentre)).toFixed(2)} m from the porch centre)${bad.length ? ' — ' + bad.map((p) => `${p.yawDeg}°: ${p.fail}`).join('; ') : ''}`);
} else {
  console.log('SKIP guard probes: the porch is not reachable');
}
const pass = results.every((r) => r.pass) && probes.length === 16 && probes.every((p) => p.pass);
const report = {
  time: new Date().toISOString(), outDir: OUT, pass,
  frame: { centroid: [+CX.toFixed(4), +CZ.toFixed(4)], axis: [+UX.toFixed(6), +UZ.toFixed(6)], V0: +V0.toFixed(4) },
  bridgeDoorPoint: B0.map((q) => +q.toFixed(3)), porchPoints: { I0, IW, IE },
  huxintingColliderRecords: htRecords.length, huxintingColliderNames: htRecords,
  extraGroundNodes: pond.extraGroundNodes,
  thresholds: { capsuleRadius: 0.35, reachRadius: 0.18, endpointErrorM: 0.3, minFeetY: MIN_FEET_Y, belowSupportM: -0.05, stallSeconds: 10 },
  results, probes, zoneEvents: world.events,
};
if (ART) fs.writeFileSync(path.join(ART, process.env.RUN_TAG ? `HUXWALK-CHECK-${process.env.RUN_TAG}.json` : 'HUXWALK-CHECK.json'), JSON.stringify(report, null, 1) + '\n');
physics.dispose();
console.log(`RESULT huxinting-walkin ${pass ? 'PASS' : 'FAIL'}`);
if (!pass) process.exitCode = 1;
