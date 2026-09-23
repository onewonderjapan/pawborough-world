// WP4.3 headless 机器人巡游测试：真实 Rapier + 真实分区 GLB 地面 + collision-<zone>.json 墙体，
// 用 CruiseDriver 沿 out-zone/commercial-route.json 每条路线走（与浏览器步行同一条
// WalkController 输入链，绝不直接写位置）。断言：
//   1) 每个采样帧脚点高度 ≥ 支撑面 −0.05 m（不掉地）；
//   2) 任一帧胶囊不与任何建筑 OBB 相交（不穿墙）；
//   3) 终点误差 ≤ 1.0 m；
//   4) 全程无 NaN。
// 产物：artifacts/walk/WALK-CHECK.json + 每条路线起点/中点/终点眼高截图 artifacts/walk/shots/。
// 截图经 playwright 打开预览页（BASE，默认 http://127.0.0.1:5494/，先自行起服务），
// 用 window.__walk.eyeView 摆相机 —— 与物理无关，不依赖指针锁定。
// 用法：OUT_DIR=out-zone BASE=http://127.0.0.1:5494/ node tests/zone-walk-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const ART = path.resolve(AREA, '..', '..', 'artifacts', 'walk');
const SHOTS = path.join(ART, 'shots');
const BASE = process.env.BASE || 'http://127.0.0.1:5494/';
const CHROME = process.env.WALK_CHROME || '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const R = 0.35, EYE = 1.6;
const ZONES = ['garden', 'pond', 'temple', 'bazaar', 'outer'];

let failures = 0;
const fail = (name, detail = '') => { failures += 1; console.log('FAIL', name, detail); };
const ok = (name) => console.log('ok  ', name);

// ---------- 输入 ----------
const layoutShaBuf = fs.readFileSync(path.join(AREA, 'baseline', 'layout.json'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;
const collision = ZONES.map((z) => ({
  zone: z,
  file: JSON.parse(fs.readFileSync(path.join(OUT, `collision-${z}.json`), 'utf8')),
}));
const colliders = collision.flatMap((f) => f.file.colliders);

// ---------- 地面三角形（与 web/walk.js 完全同层：原始分区 GLB + walkGround 选网） ----------
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const partsOf = (z) => manifest.zones.filter((e) => e.id === z && e.file).map((e) => e.file);
const groundMeshes = [];
for (const f of collision) {
  for (const part of partsOf(f.zone)) {
    const { meshes } = readGlb(fs.readFileSync(path.join(OUT, part)));
    groundMeshes.push(...selectAreaGroundMeshes(meshes, f.file));
  }
}
if (!groundMeshes.length) { fail('ground meshes', 'none matched — check groundNodeRe/extraGroundNodes'); process.exit(1); }
// 与浏览器 walk.js 同一条收集链：别名层输出直接进共享 collectGroundTriangles
const groundTriangles = collectGroundTriangles(groundMeshes);

await RAPIER.init();
const physics = buildPhysicsWorld(RAPIER, { collision: { colliders }, groundTriangles });
function concatFloat32(chunks) {
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
function concatUint32(chunks) {
  const out = new Uint32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
ok(`physics: ${colliders.length} wall colliders, ground trimesh built from ${groundMeshes.length} meshes`);

// ---------- 支撑面 / OBB 查询 ----------
function groundY(x, z, fromY, excludeCollider) {
  const hit = physics.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), 60, true,
    undefined, undefined, excludeCollider);
  return hit ? fromY - hit.timeOfImpact : null;
}
// 胶囊（r=0.35，脚点到脚点+1.9）与 OBB（center/halfExtents/yaw）相交：沿胶囊轴取 6 点各做
// 点-膨胀盒检验（r 大于任何墙半厚，不会隧穿），数学与契约测试 hits() 同源（yaw 逆变换）。
const obbs = colliders.map((c) => {
  const rec = c.obb;
  const ct = Math.cos(rec.theta), st = Math.sin(rec.theta);
  const wx = rec.pos[0] + ct * rec.center[0] + st * rec.center[2];
  const wz = rec.pos[2] - st * rec.center[0] + ct * rec.center[2];
  return { name: c.name, cx: wx, cy: rec.center[1] + (rec.pos[1] ?? 0), cz: wz,
    hx: rec.size[0] / 2, hy: rec.size[1] / 2, hz: rec.size[2] / 2, ct, st };
});
function capsuleHitsObb(feet) {
  const samples = [];
  for (let y = feet[1] + 0.3; y <= feet[1] + 1.9001; y += 0.32) samples.push(y);
  samples.push(feet[1] + 1.9);
  for (const b of obbs) {
    if (b.cy - b.hy > feet[1] + 1.9 || b.cy + b.hy < feet[1]) continue;   // 高度带不重叠
    for (const sy of samples) {
      const dx = feet[0] - b.cx, dz = feet[2] - b.cz, dy = sy - b.cy;
      if (Math.abs(dy) > b.hy + R) continue;
      const lx = b.ct * dx - b.st * dz, lz = b.st * dx + b.ct * dz;
      const qx = Math.max(Math.abs(lx) - b.hx, 0), qz = Math.max(Math.abs(lz) - b.hz, 0);
      if (qx * qx + qz * qz < R * R) return b.name;
    }
  }
  return null;
}
function distToPolyline(x, z, pts) {
  let m = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    m = Math.min(m, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return m;
}

// ---------- 每条路线巡游 ----------
const routeResults = [];
const eyeStations = [];       // {route, station, eye:[x,y,z], yaw}
for (const r of routes) {
  const name = `${r.from}→${r.to}`;
  const pts3 = r.points.map(([x, z]) => [x, 0, z]);
  const [sx, sz] = r.points[0];
  const gy0 = groundY(sx, sz, 6);
  if (gy0 === null) { fail(`route ${name} spawn support`, 'no ground below spawn'); routeResults.push({ route: name, pass: false, blocked: 'no ground' }); continue; }
  const controller = new WalkController({ RAPIER, physics, capsule: { radius: R, halfHeight: 0.6, eyeHeight: EYE, spawn: [sx, gy0 + 0.05, sz] } });
  // reachRadius 0.9：终点停驻误差必须 ≤1.0 m，驱动半径得比门槛更紧
  const driver = new CruiseDriver({ controller, waypoints: pts3, reachRadius: 0.9, timeoutSteps: 60 * 900 });
  const t0 = Date.now();
  let steps = 0, bad = null, minClear = Infinity, minFeetY = Infinity, maxDev = 0, wallHit = null;
  let midRecorded = false;
  eyeStations.push({ route: name, station: 'start', eye: controller.eyePosition(), yaw: controller.yaw });
  while (!driver.done) {
    driver.tick(1 / 60);
    controller.step(1 / 60);
    steps += 1;
    const feet = controller.feetPosition();
    const eye = controller.eyePosition();
    if (!Number.isFinite(feet[0]) || !Number.isFinite(feet[1]) || !Number.isFinite(feet[2])
      || !Number.isFinite(eye[0]) || !Number.isFinite(eye[1]) || !Number.isFinite(eye[2])) { bad = `NaN at step ${steps}`; break; }
    const gy = groundY(feet[0], feet[2], feet[1] + 2, controller.collider);
    if (gy === null) { bad = `no support below feet at step ${steps} (${feet[0].toFixed(1)},${feet[2].toFixed(1)})`; break; }
    minClear = Math.min(minClear, feet[1] - gy);
    minFeetY = Math.min(minFeetY, feet[1]);
    if (feet[1] - gy < -0.05) { bad = `fell ${ (feet[1] - gy).toFixed(3) } m below ground at step ${steps}`; break; }
    wallHit = capsuleHitsObb(feet);
    if (wallHit) { bad = `capsule inside OBB ${wallHit} at step ${steps}`; break; }
    maxDev = Math.max(maxDev, distToPolyline(feet[0], feet[2], r.points));
    if (!midRecorded && steps > 8 && driver.i >= Math.floor(pts3.length / 2)) {
      midRecorded = true;
      eyeStations.push({ route: name, station: 'mid', eye, yaw: controller.yaw });
    }
  }
  const wallSeconds = (Date.now() - t0) / 1000;
  const endFeet = controller.feetPosition();
  eyeStations.push({ route: name, station: 'end', eye: controller.eyePosition(), yaw: controller.yaw });
  const endErr = Math.hypot(endFeet[0] - r.points.at(-1)[0], endFeet[2] - r.points.at(-1)[1]);
  const res = {
    route: name,
    pass: !bad && driver.done && endErr <= 1.0,
    simSeconds: +(steps / 60).toFixed(1),
    wallClockSeconds: +wallSeconds.toFixed(1),
    steps,
    reachedWaypoints: driver.status().reached,
    totalWaypoints: driver.status().total,
    minGroundClearanceM: Number.isFinite(minClear) ? +minClear.toFixed(3) : null,
    minFeetY: Number.isFinite(minFeetY) ? +minFeetY.toFixed(3) : null,
    maxLateralDeviationM: +maxDev.toFixed(2),
    endErrorM: +endErr.toFixed(2),
    endFeet: endFeet.map((v) => +v.toFixed(2)),
    blocked: driver.status().blocked,
    error: bad,
  };
  if (!res.pass) fail(`route ${name}`, JSON.stringify({ bad: res.error, endErr, done: driver.done, blocked: res.blocked }));
  else ok(`route ${name}: ${res.simSeconds}s sim, end err ${res.endErrorM} m, max dev ${res.maxLateralDeviationM} m, min clearance ${res.minGroundClearanceM} m`);
  routeResults.push(res);
  controller.dispose();
}
physics.dispose();

// ---------- 产物 ----------
const report = {
  generatedAt: new Date().toISOString(),
  outDir: path.basename(OUT),
  inputs: { zones: ZONES, layoutSha256: (await import('node:crypto')).createHash('sha256').update(layoutShaBuf).digest('hex') },
  physics: { walls: colliders.length, groundMeshes: groundMeshes.length },
  method: 'CruiseDriver -> WalkController fixed-step input chain against real Rapier world; ground = raw zone GLB meshes filtered by per-zone groundNodeRe/extraGroundNodes',
  routes: routeResults,
  allPass: routeResults.every((r) => r.pass),
};
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(path.join(ART, 'WALK-CHECK.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`WALK-CHECK.json written; allPass=${report.allPass}`);

// ---------- 眼高截图（不依赖物理构建；单独特例：页面加载默认轨道即可 eyeView） ----------
if (process.env.WALK_SHOTS !== '0') {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(new URL('?zone=all', BASE).href);
  await page.waitForFunction('window.__ready === true', undefined, { timeout: 120000 });
  for (const st of eyeStations) {
    if (!st.eye || !Number.isFinite(st.eye[0])) continue;
    const slug = st.route.replace(/[^\w]+/g, '-');
    await page.evaluate(([x, y, z, yaw]) => window.__walk.eyeView(x, y, z, yaw), [st.eye[0], st.eye[1], st.eye[2], st.yaw]);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(SHOTS, `${slug}-${st.station}.png`) });
  }
  await browser.close();
  console.log(`eye-height shots written to ${SHOTS} (${eyeStations.length})`);
}

process.exit(failures ? 1 : 0);
