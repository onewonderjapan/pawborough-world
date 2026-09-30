// wave14-templeeast R1（astra 必修）：庙东跨院跨院步行验证。
// 与 tests/zone-walk-check.mjs 同一条链：真实 Rapier + 真实分区 GLB 地面（groundNodeRe/extraGroundNodes）+ 全部分区
// collision-<zone>.json 墙体，CruiseDriver → WalkController 输入链（不直接写位置）。
// 两条局部路线：南院 → 横厅 t2 东侧过道 → 中院 → 横厅 t1 东侧过道 → 北院，及其反向。
// 路点在庙轴本地系、由 layout 推（原点 = 山门锚、rotY = 山门 rotY；过道中线 = 横厅台基东缘与楼台基西缘的中点），
// 每条断言：到终点误差 ≤1.0 m、全程不掉地（≥ 支撑面 −0.05 m）、胶囊（r 0.35、高 1.9）不进任何 OBB、无 NaN、
// 并且真的走了东侧过道（经过 x∈[横厅台基东缘, 楼台基西缘] 且 z 在两座横厅台基范围内的采样帧各 ≥ 30 帧）。
// 冻结商业路线不在这里改；报告写 OUT_DIR/templeeast-walk.json。
// 用法：OUT_DIR=out-zone node tests/templeeast-walk-check.mjs（负例：TEMPLEEAST_LAYOUT=<旧 layout> 配旧构建目录）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { readGlb } from '../../../src/world/glbReader.js';
import { buildPhysicsWorld } from '../../../src/world/physics.js';
import { collectGroundTriangles } from '../../../src/world/groundExtractor.js';
import { WalkController } from '../../../src/player/WalkController.js';
import { CruiseDriver } from '../../../src/player/cruise.js';
import { selectAreaGroundMeshes } from '../src/walkGround.js';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const R = 0.35, EYE = 1.6;
const ZONES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];
let failures = 0, passes = 0;
const fail = (n, d = '') => { failures++; console.log('FAIL', n, d); };
const ok = (n) => { passes++; console.log('ok  ', n); };

const L = JSON.parse(fs.readFileSync(process.env.TEMPLEEAST_LAYOUT ? path.resolve(process.env.TEMPLEEAST_LAYOUT) : path.join(AREA, 'baseline', 'layout.json'), 'utf8'));
const sm = L.instances.find(i => i.id === 'temple-shanmen');
const [OX, OZ] = sm.position, TH = sm.rotY, C = Math.cos(TH), S = Math.sin(TH);
const W = ([lx, lz]) => [OX + lx * C + lz * S, OZ - lx * S + lz * C];
const toLocal = ([x, z]) => [(x - OX) * C - (z - OZ) * S, (x - OX) * S + (z - OZ) * C];
const rectOf = (id) => { const o = L.objects.find(x => x.id === id); const q = o.geometry.footprint.map(toLocal);
  return { x0: Math.min(...q.map(p => p[0])), x1: Math.max(...q.map(p => p[0])), z0: Math.min(...q.map(p => p[1])), z1: Math.max(...q.map(p => p[1])) }; };
const PO = 0.2;   // hall-kit defaults.platformOut
const hallRect = (id) => { const r = rectOf(id); return { x1: r.x1 + PO, z0: r.z0 - PO, z1: r.z1 + PO }; };
const halls = { t1: hallRect('templeeast-t1'), t2: hallRect('templeeast-t2') };
const towerX0 = Math.min(...['templeeast-r1', 'templeeast-r2', 'templeeast-r3'].map(id => rectOf(id).x0)) - PO;

const collision = ZONES.map(z => ({ zone: z, file: JSON.parse(fs.readFileSync(path.join(OUT, `collision-${z}.json`), 'utf8')) }));
const colliders = collision.flatMap(f => f.file.colliders);
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const groundMeshes = [];
for (const f of collision) for (const e of manifest.zones.filter(e => e.id === f.zone && e.file)) {
  const { meshes } = readGlb(fs.readFileSync(path.join(OUT, e.file)));
  groundMeshes.push(...selectAreaGroundMeshes(meshes, f.file));
}
const groundTriangles = collectGroundTriangles(groundMeshes);
await RAPIER.init();
const physics = buildPhysicsWorld(RAPIER, { collision: { colliders }, groundTriangles });
ok(`physics: ${colliders.length} colliders, ${groundMeshes.length} ground meshes`);
const groundY = (x, z, fromY, ex) => { const h = physics.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), 60, true, undefined, undefined, ex); return h ? fromY - h.timeOfImpact : null; };
const obbs = colliders.map(c => { const r = c.obb, ct = Math.cos(r.theta), st = Math.sin(r.theta);
  return { name: c.name, cx: r.pos[0] + ct * r.center[0] + st * r.center[2], cy: r.center[1] + (r.pos[1] ?? 0), cz: r.pos[2] - st * r.center[0] + ct * r.center[2],
    hx: r.size[0] / 2, hy: r.size[1] / 2, hz: r.size[2] / 2, ct, st }; });
function capsuleHitsObb(feet) {
  const ys = []; for (let y = feet[1] + 0.3; y <= feet[1] + 1.9001; y += 0.32) ys.push(y); ys.push(feet[1] + 1.9);
  for (const b of obbs) {
    if (b.cy - b.hy > feet[1] + 1.9 || b.cy + b.hy < feet[1]) continue;
    for (const sy of ys) { const dx = feet[0] - b.cx, dz = feet[2] - b.cz, dy = sy - b.cy; if (Math.abs(dy) > b.hy + R) continue;
      const lx = b.ct * dx - b.st * dz, lz = b.st * dx + b.ct * dz; const qx = Math.max(Math.abs(lx) - b.hx, 0), qz = Math.max(Math.abs(lz) - b.hz, 0);
      if (qx * qx + qz * qz < R * R) return b.name; }
  }
  return null;
}

// 南院 (21.5,-15) → t2 南端出入口 → 过道 x 23.5 → 中院 → t1 南端出入口 → 过道 → 北院 (22.0,-57)
// 路点由 layout 推：过道中线 xm = (横厅台基东缘 + 楼台基西缘)/2；每座横厅南端前 0.9 m 先到 xm−1.1（院内），再进过道、从北端出。
const passX = (h) => (h.x1 + towerX0) / 2;
const through = (h) => [[passX(h) - 1.1, h.z1 + 0.9], [passX(h), h.z1 + 0.1], [passX(h), h.z0 - 0.1], [passX(h) - 1.1, h.z0 - 0.9]];
const LOCAL = [[21.5, -15.0], ...through(halls.t2), ...through(halls.t1), [22.0, -57.0]];
const routes = [{ name: '南院→北院（东侧过道）', pts: LOCAL }, { name: '北院→南院（东侧过道）', pts: [...LOCAL].reverse() }];
const results = [];
for (const r of routes) {
  const pts = r.pts.map(W);
  const gy0 = groundY(pts[0][0], pts[0][1], 6);
  if (gy0 === null) { fail(r.name, 'no ground at spawn'); continue; }
  const controller = new WalkController({ RAPIER, physics, capsule: { radius: R, halfHeight: 0.6, eyeHeight: EYE, spawn: [pts[0][0], gy0 + 0.05, pts[0][1]] } });
  const driver = new CruiseDriver({ controller, waypoints: pts.map(([x, z]) => [x, 0, z]), reachRadius: 0.5, timeoutSteps: 60 * 240 });
  let steps = 0, bad = null, minClear = Infinity, inT1 = 0, inT2 = 0, maxY = -Infinity;
  while (!driver.done) {
    driver.tick(1 / 60); controller.step(1 / 60); steps++;
    const f = controller.feetPosition();
    if (!f.every(Number.isFinite)) { bad = `NaN at ${steps}`; break; }
    const gy = groundY(f[0], f[2], f[1] + 2, controller.collider);
    if (gy === null) { bad = `no support at ${steps}`; break; }
    minClear = Math.min(minClear, f[1] - gy); maxY = Math.max(maxY, f[1]);
    if (f[1] - gy < -0.05) { bad = `fell at ${steps}`; break; }
    const hit = capsuleHitsObb(f); if (hit) { bad = `capsule inside ${hit} at ${steps}`; break; }
    const [lx, lz] = toLocal([f[0], f[2]]);
    if (lx >= halls.t1.x1 && lx <= towerX0) { if (lz >= halls.t1.z0 && lz <= halls.t1.z1) inT1++; if (lz >= halls.t2.z0 && lz <= halls.t2.z1) inT2++; }
  }
  const end = controller.feetPosition();
  const endErr = Math.hypot(end[0] - pts.at(-1)[0], end[2] - pts.at(-1)[1]);
  const res = { route: r.name, pass: !bad && driver.done && !driver.status().blocked && endErr <= 1.0 && inT1 >= 30 && inT2 >= 30,
    simSeconds: +(steps / 60).toFixed(1), endErrorM: +endErr.toFixed(2), minGroundClearanceM: +minClear.toFixed(3), maxFeetY: +maxY.toFixed(3),
    framesInPassageT1: inT1, framesInPassageT2: inT2, reached: driver.status().reached, total: driver.status().total, blocked: driver.status().blocked, error: bad,
    waypointsLocal: r.pts };
  if (res.pass) ok(`${r.name}: ${res.simSeconds}s sim, end err ${res.endErrorM} m, 过道帧 t1 ${inT1} / t2 ${inT2}, 最高脚点 ${res.maxFeetY} m`);
  else fail(r.name, JSON.stringify({ bad, endErr: res.endErrorM, blocked: res.blocked, inT1, inT2, reached: res.reached }));
  results.push(res);
  controller.dispose();
}
physics.dispose();
fs.writeFileSync(process.env.TEMPLEEAST_WALK_REPORT || path.join(OUT, 'templeeast-walk.json'), JSON.stringify({ generatedAt: new Date().toISOString(), method: 'CruiseDriver -> WalkController vs real Rapier world (all zone collisions + zone GLB ground)', capsule: { radius: R, height: 1.9 }, halls, routes: results, allPass: results.length === 2 && results.every(x => x.pass) }, null, 1) + '\n');
console.log(`\ntempleeast-walk-check: ${passes} pass, ${failures} fail`);
if (failures || results.length !== 2) process.exit(1);
