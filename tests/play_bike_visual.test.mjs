// tests/play_bike_visual.test.mjs — 自行车视觉验收（工单 B1，接替 Opus 草稿）。
// 两段：
//   A. node 侧真实皮肤接触契约（与 outbox primary-contacts.mjs 同一量法：改绑后权重簇、
//      8 曲柄相位 × 3 转向 = 24 采样）：臂簇质心 ≤0.035、腿簇 ≤0.050、
//      臂角 ≤1.20 / 腿角 ≤1.35、脊柱前倾 ≤0.55。座位抬升 seatLift=0.025 为
//      几何标定值：腿簇可达球半径（≈0.169，由皮肤分布决定）限制髋骨最大抬升，
//      L=0.025 时腿余量 ~19%、臂余量 ~35%；更高必破足部接触（见
//      outbox zcode-b/run/LIFT-SWEEP.json 的 L-窗口扫描）。
//   B. 真实 Chrome/GPU 截图：出生停车多点采样数值（前后轮地面射线）+ 停车侧视/
//      前三四 + 骑乘侧视/前三四/后视 + 骑行段 + 下车还原。
// 截图与结果只写本任务 outbox（zcode-b/screenshots），不动 agy 证据。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREA = join(__dirname, '../scene-authoring/yuyuan-area');
const req = createRequire(join(AREA, 'package.json'));
const SHOTS = process.env.PB_EVIDENCE_DIR || join(__dirname, '../out/play-bike-visual');
mkdirSync(SHOTS, { recursive: true });

const results = { bike: [], oldnorth: [] };
const check = (group, name, passed, detail) => {
  results[group].push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name} — ${detail}`);
  return passed;
};

// ---------- A. 皮肤接触契约（node，无浏览器） ----------
async function contactContract() {
  console.log('\n=== A. 自行车真实皮肤接触契约（24 相位） ===');
  const THREE = req('three');
  const { GLTFLoader } = await import(AREA + '/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const { BikeView } = await import(AREA + '/web/play/bike-view.js');
  const { PlayAvatar } = await import(AREA + '/web/play/avatar.js');
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  const fs = await import('fs/promises');
  const load = async (path) => {
    const b = await fs.readFile(path);
    return new Promise((ok, no) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, no));
  };
  const char = await load(AREA + '/resources/characters/gray-cat/character.glb');
  const bike = await load(AREA + '/resources/vehicles/play-bicycle.glb');
  const root = bike.scene;
  const find = (n) => root.getObjectByName(n);
  const rig = { root, frontWheel: find('front-wheel'), rearWheel: find('rear-wheel'), steering: find('steering'),
    crank: find('crank'), seat: find('seat'), handleL: find('handle-L'), handleR: find('handle-R'),
    pedalL: find('pedal-L'), pedalR: find('pedal-R') };
  const avatar = new PlayAvatar({ gltfScene: char.scene, animations: char.animations });
  const scene = new THREE.Scene();
  scene.add(root, avatar.root);
  avatar.root.position.set(-157.75, .035, -22.25);
  avatar.root.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  const view = new BikeView(rig);
  check('bike', '两轮地面取最高支持面', Math.abs(view.parkingGroundY((x,z) => z < 0 ? .08 : .04, 0, 0, 0) - .095) < 1e-6, 'sloped support');
  check('bike', '缺一个车轮支撑面时拒绝停车', view.parkingGroundY((x,z) => z < 0 ? null : .04, 0, 0, 0) === null, 'one wheel over void');
  view.placeAt([-156.55, .054, -22.25], .7);
  scene.updateMatrixWorld(true);
  view.attachRider(avatar, { signedTravel: 0 });
  const body = avatar.model.getObjectByName('cat_body');
  const sk = body.skeleton;
  const pairs = [['armL', rig.handleL, .13, .035, 1.2], ['armR', rig.handleR, .13, .035, 1.2],
    ['legL', rig.pedalL, .14, .05, 1.35], ['legR', rig.pedalR, .14, .05, 1.35]];
  const tmp = new THREE.Vector3();
  // 改绑后的真实权重簇（与 primary-contacts.mjs 同序：attachRider 之后计算）
  const groups = {};
  for (const [name, node, minDist] of pairs) {
    const bi = sk.bones.findIndex(b => b.name === name);
    const ids = [];
    for (let i = 0; i < body.geometry.attributes.position.count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (body.geometry.attributes.skinIndex.getComponent(i, k) === bi) weight += body.geometry.attributes.skinWeight.getComponent(i, k);
      tmp.fromBufferAttribute(body.geometry.attributes.position, i).applyMatrix4(sk.boneInverses[bi]);
      if (weight >= .5 && tmp.length() > minDist) ids.push({ i, y: tmp.y });
    }
    const minY = Math.min(...ids.map(p => p.y));
    groups[name] = { all: ids.map(p => p.i), distal: ids.filter(p => p.y <= minY + .035).map(p => p.i) };
  }
  let allPass = true;
  for (const [name, node, , tol, angLimit] of pairs) {
    let maxAll = 0, maxDistal = 0, maxAngle = 0;
    const bone = avatar.model.getObjectByName(name);
    for (let i = 0; i < 24; i++) {
      rig.steering.rotation.y = [-.1, 0, .1][Math.floor(i / 8)];
      const phase = (i % 8) * Math.PI / 4;
      rig.crank.rotation.x = phase;
      view.sit(avatar, .7, phase);
      scene.updateMatrixWorld(true);
      body.skeleton.update();
      const goal = node.getWorldPosition(new THREE.Vector3());
      for (const [k, ids] of Object.entries(groups[name])) {
        const avg = new THREE.Vector3();
        for (const id of ids) { body.getVertexPosition(id, tmp); avg.add(tmp.applyMatrix4(body.matrixWorld)); }
        avg.divideScalar(ids.length);
        const d = avg.distanceTo(goal);
        if (k === 'all') maxAll = Math.max(maxAll, d); else maxDistal = Math.max(maxDistal, d);
      }
      maxAngle = Math.max(maxAngle, avatar.restBoneQuaternions.get(name).angleTo(bone.quaternion));
    }
    allPass &= check('bike', `${name} 皮肤接触（24 相位）`, maxAll <= tol && maxAngle <= angLimit,
      `maxMeanGap=${maxAll.toFixed(4)}(≤${tol}) maxDistal=${maxDistal.toFixed(4)} maxAngle=${maxAngle.toFixed(3)}(≤${angLimit})`);
  }
  allPass &= check('bike', '脊柱前倾限幅', view._spineLean <= 0.55, `spineLean=${view._spineLean}`);
  view.detachRider(avatar);
  writeFileSync(join(SHOTS, 'bike-contact-results.json'), JSON.stringify({ spineLean: view._spineLean, checks: results.bike }, null, 2) + '\n');
  return allPass;
}

// ---------- B. 真实浏览器视觉 ----------
async function browserVisual() {
  console.log('\n=== B. 自行车浏览器视觉（真实 Chrome/GPU） ===');
  const { chromium } = req('playwright');
  const URL = (process.env.PB_BASE || 'http://127.0.0.1:5492') + '/?play=1&at=center';
  const CHROME = process.env.PB_CHROME || chromium.executablePath();
  const browser = await chromium.launch({
    executablePath: CHROME, headless: false,
    args: ['--disable-dev-shm-usage', '--disable-frame-rate-limit', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', e => check('bike', '页面运行异常', false, e.message));
  const shot = (name) => page.screenshot({ path: join(SHOTS, `bike-${name}.png`) });
  const status = () => page.evaluate(() => window.__play.status());
  const dragYaw = async (dx) => {
    await page.mouse.move(640, 360); await page.mouse.down();
    await page.mouse.move(640 + dx, 360, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const relOf = (s) => {
    const v = s.viewYaw ?? s.heading;
    if (v === null || v === undefined) return null;
    let d = v - (s.heading ?? 0);
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const aimRelativeYaw = async (target) => {
    // 指针锁可能在上/下车后丢失（丢失即暂停）：先点画面恢复/再锁定
    await page.mouse.click(640, 360);
    await page.waitForTimeout(500);
    let s = await status();
    for (let i = 0; i < 14; i++) {
      const d = relOf(s);
      if (d === null || Math.abs(d - target) < 0.12) return d ?? s;
      const px = Math.round((target - d) * 900);
      if (Math.abs(px) < 3) break;
      await dragYaw(px);
      s = await status();
    }
    return relOf(s);
  };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__play?.status?.()?.bikePlaced && window.__play?.status?.()?.ready && window.__ready, null, { timeout: 120000 });
    await page.bringToFront();
    await page.waitForTimeout(1500);
    await page.mouse.click(640, 360);
    await page.waitForTimeout(800);

    // 停车数值：出生多点采样 Y vs 前轮/中/后轮真实地面射线
    const s0 = await status();
    const park = await page.evaluate(async () => {
      const zp = window.__walk?.zonePhysics;
      const wrapper = zp?.physics;
      const world = wrapper?.world ?? wrapper;
      const handles = new Set(zp.groundColliders.map(c => c.handle));
      const st = window.__play.status();
      const pos = st.vehicle?.pos, yaw = st.vehicle?.yaw ?? 0;
      if (!world?.castRay || !pos) return { ok: false };
      const R = await import('@dimforge/rapier3d-compat');
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const front = [pos[0] + sy * -0.36, pos[2] + cy * -0.36];
      const rear = [pos[0] + sy * 0.36, pos[2] + cy * 0.36];
      const ground = (x, z) => {
        const hit = world.castRay(new R.Ray({ x, y: 8, z }, { x: 0, y: -1, z: 0 }), 12, true, undefined, undefined, undefined, undefined, c => handles.has(c.handle));
        return hit ? 8 - hit.timeOfImpact : null;
      };
      return { ok: true, pos, gC: ground(pos[0], pos[2]), gF: ground(front[0], front[1]), gR: ground(rear[0], rear[1]) };
    });
    if (park.ok) {
      const gMax = Math.max(park.gC, park.gF, park.gR);
      check('bike', '停车两轮不陷地', park.pos[1] >= gMax - 0.005,
        `bikeY=${park.pos[1].toFixed(4)} 地面 中/前/后=${[park.gC, park.gF, park.gR].map(v => v?.toFixed(4))}`);
      check('bike', '停车不悬空', park.pos[1] - gMax <= 0.06, `间隙=${(park.pos[1] - gMax).toFixed(4)}`);
    } else check('bike', '停车探针', false, '物理世界/车辆未就绪');

    // 停车视觉：每次 上车→（有 viewYaw 反馈）对准→原地下车（车落地在猫旁）→拍。
    const parkShot = async (name, target) => {
      let st = await status();
      if (!st.riding) {
        await page.keyboard.press('KeyR');
        await page.waitForTimeout(1500);
        st = await status();
      }
      if (!st.riding) return false;
      await aimRelativeYaw(target);
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(1200);
      await page.waitForTimeout(400);
      await shot(name);
      return true;
    };
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(1500);
    let s = await status();
    if (!s.riding) {
      await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
      await page.keyboard.press('KeyR'); await page.waitForTimeout(1500);
      s = await status();
    }
    check('bike', '上车', !!s.riding, `riding=${s.riding}`);
    const ok1 = await parkShot('parked-side', Math.PI / 2);
    const ok2 = await parkShot("parked-front3q", 3 * Math.PI / 4);
    check('bike', '停车侧视/前三四截图', ok1 && ok2, `side=${ok1} front3q=${ok2}`);
    s = await status();
    check('bike', '下车还原', !s.riding, `riding=${s.riding} vehicle=${JSON.stringify(s.vehicle?.pos)}`);

    // 再上车：骑乘侧视 / 前三四 / 骑行 / 后视 / 下车
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(1500);
    s = await status();
    check('bike', '再上车', !!s.riding, `riding=${s.riding}`);
    await aimRelativeYaw(Math.PI / 2);
    await shot('ridden-side');
    await aimRelativeYaw(3 * Math.PI / 4);
    await shot('ridden-front3q');
    await aimRelativeYaw(Math.PI / 2);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    await shot('ridden-side-moving');
    s = await status();
    check('bike', '骑行段在真实地面', (s.feet?.[1] ?? -9) >= -0.1, `feet=${JSON.stringify(s.feet)}`);
    await aimRelativeYaw(0);
    await shot('ridden-rear');
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(1200);
    s = await status();
    check('bike', '最终下车', !s.riding, `riding=${s.riding}`);
    await shot('after-dismount');
  } catch (e) {
    check('bike', '浏览器流程异常', false, e.message);
    try { await shot('FAIL'); } catch {}
  } finally {
    await browser.close();
  }
}

const a = await contactContract();
if (process.env.PB_BROWSER === '1') await browserVisual();
writeFileSync(join(SHOTS, 'bike-test-results.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.bike.filter(c => !c.passed).length;
console.log(`\n=== 自行车视觉测试：${results.bike.length - failed}/${results.bike.length} 通过 ===`);
if (failed || !a) process.exit(1);
console.log('=== ALL BIKE VISUAL TESTS PASSED ===');
