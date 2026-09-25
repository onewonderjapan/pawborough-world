// wave5-rooftoggle：「屋顶」按钮契约测试（headless Chromium + swiftshader）。
//
// 契约（本文件内嵌一份冻结版命名规则作为验收 oracle，不 import 实现 —— 测试不许拿产物和自己比；
// 规则出处见 web/roofs.js 头注）：
//   屋面节点 = 自身或任一祖先的名字命中以下任一规则（小写、剥 `mesh-` 前缀、剥 Blender 重名后缀 `.NNN`）：
//     R1 程序化屋面：`|` 分段第 5 段 == 'roofpart'（userData.roof 同源）
//     R2 厅堂套件 + 三穗堂：`hall-roof__*`
//     R3 商城大楼套件（华宝楼，web 端按名识别，不改 kit）：`roof-main__*` / `pav-roof__*`
//     R4 湖心亭：`huxin-ting__{mainroof,porchroof,towerroof,towerskirt,finial}*`
//     R5 瓦面节点：`*__gray-pan-tile` / `*__grey-pan-tile`（庙区模块屋面瓦、复廊、店铺屋面+山墙瓦皮）
//     R6 亭套件 / 店铺脊饰·屋架 / 门楼顶：`__` 前段 part == 'roof' 或以 `roof-` 开头或以 `-roof` 结尾
//   注意 three GLTFLoader：glTF 节点名在包装 Object3D 上，Mesh 本体是 `mesh_N`，所以按父链判；
//   node.name 被 sanitize（`.001` 的点被剥），原始名在 node.userData.name —— 两个候选名都要过规则。
//   点 #t-roofs 后：屋面 Mesh 有效可见数（自身与父链全 visible）从 N(>100) → 0；
//   非 roof Mesh 的有效可见集合不变；合批实例同步（__batchMembers 存在时，roof 成员全 hidden）。
//   再点一次应恢复 N。
//
// 用法：先起服务 PORT=5496 OUT_DIR=out-zone node scripts/server.mjs &
//       BASE=http://127.0.0.1:5496/ SHOT=<png 前缀> node tests/roof-toggle-test.mjs
import { createRequire } from 'node:module';
const require = createRequire('/home/baibai/pawborough-world/node_modules/');
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:5496/';
const shot = process.env.SHOT || null;
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

const MATCHER_SRC = `
function isRoofName(raw) {
  const n = String(raw).toLowerCase().replace(/^mesh-/, '').replace(/\\.[0-9]{1,3}$/, '');
  const pipe = n.split('|');
  if (pipe.length >= 5 && pipe[4] === 'roofpart') return true;
  const us = n.indexOf('__');
  const part = us >= 0 ? n.slice(0, us) : n;
  const rest = us >= 0 ? n.slice(us + 2) : '';
  if (part === 'hall-roof' || part === 'roof-main' || part === 'pav-roof') return true;
  if (part === 'huxin-ting') return /^(mainroof|porchroof|towerroof|towerskirt|finial)/.test(rest);
  if (/(gray|grey)-pan-tile$/.test(n)) return true;
  return part === 'roof' || part.startsWith('roof-') || (us >= 0 && part.endsWith('-roof'));
}
function nodeIsRoof(n) {
  if (n.userData && n.userData.roof) return true;
  if (n.name && isRoofName(n.name)) return true;
  if (n.userData && n.userData.name && isRoofName(n.userData.name)) return true;
  return false;
}
function meshIsRoof(o) {
  for (let n = o; n; n = n.parent) if (nodeIsRoof(n)) return true;
  return false;
}
function effVisible(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}`;

const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base + (process.env.QS || '?zone=core&cam=oblique'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.waitForFunction(() => (window.__zonesLoaded || []).length >= 5, null, { timeout: 300000 });

// 场景统计：roof / 非 roof 的有效可见 Mesh（非 roof 用名字聚合，跨状态稳定可比）
async function census() {
  return page.evaluate(`(() => {
    ${MATCHER_SRC}
    let roofTotal = 0, roofVisible = 0, meshTotal = 0;
    const roofFamilies = {}, otherVisible = [];
    window.__scene.traverse(o => {
      if (!o.isMesh || o.isBatchedMesh) return;
      meshTotal++;
      if (meshIsRoof(o)) {
        roofTotal++;
        if (effVisible(o)) {
          roofVisible++;
          let hit = null;
          for (let n = o; n && !hit; n = n.parent) {
            if (n.name && isRoofName(String(n.name).replace(/^mesh-/, ''))) hit = n.name;
            else if (n.userData && n.userData.name && isRoofName(n.userData.name)) hit = n.userData.name;
          }
          const k = String(hit).replace(/^mesh-/, '').replace(/\\.\\d{1,3}$/, '');
          roofFamilies[k] = (roofFamilies[k] || 0) + 1;
        }
      }
      else if (effVisible(o)) otherVisible.push(o.name);
    });
    otherVisible.sort();
    return { meshTotal, roofTotal, roofVisible, roofFamilies, otherVisibleCount: otherVisible.length, otherVisibleNames: otherVisible };
  })()`);
}
// 渲染像素读回（同帧 evaluate，防止回读的是旧帧）
async function pixels() {
  return page.evaluate(() => {
    const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl');
    const px = new Uint8Array(g.drawingBufferWidth * g.drawingBufferHeight * 4);
    g.readPixels(0, 0, g.drawingBufferWidth, g.drawingBufferHeight, g.RGBA, g.UNSIGNED_BYTE, px);
    let s = 0, s2 = 0, n = 0; for (let i = 0; i < px.length; i += 28) { const l = .2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2]; s += l; s2 += l * l; n++; }
    const mean = s / n; return { mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
  });
}
// 合批实例状态：roof 名单成员应 hidden、其余应 visible（实现前无此钩子 → 跳过并注明）
async function batchState() {
  return page.evaluate(`(() => {
    if (typeof window.__batchMembers !== 'function') return { available: false };
    ${MATCHER_SRC}
    return { available: true, members: window.__batchMembers().map(m => ({ ...m, roof: m.chain.some(nm => isRoofName(nm) || false) })) };
  })()`);
}

const failures = [];
const report = {};
try {
  const before = await census();
  report.before = { meshTotal: before.meshTotal, roofTotal: before.roofTotal, roofVisible: before.roofVisible, roofFamilies: before.roofFamilies, otherVisibleCount: before.otherVisibleCount };
  report.before.pixels = await pixels();
  if (shot) await page.screenshot({ path: shot + '-before.png' });

  // ① 屋顶按钮默认全亮：屋面可见数必须是正数且够大（防“规则没匹配到任何节点”的假通过）
  if (!(before.roofVisible > 100)) failures.push(`F1 默认屋面可见数 ${before.roofVisible} 应 >100（family=${JSON.stringify(before.roofFamilies)}）`);

  // ② 点「屋顶」→ 屋面可见数清零，非屋面可见集合不变
  await page.click('#t-roofs');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await census();
  report.afterOff = { roofVisible: after.roofVisible, otherVisibleCount: after.otherVisibleCount };
  report.afterOff.pixels = await pixels();
  if (shot) await page.screenshot({ path: shot + '-after.png' });
  if (after.roofVisible !== 0) failures.push(`F2 点击后屋面可见数 ${after.roofVisible} 应为 0（当前构建屋面节点是否带标记？）`);
  const sameOthers = after.otherVisibleCount === before.otherVisibleCount &&
    after.otherVisibleNames.length === before.otherVisibleNames.length &&
    after.otherVisibleNames.every((n, i) => n === before.otherVisibleNames[i]);
  if (!sameOthers) {
    const onlyB = before.otherVisibleNames.filter(n => !after.otherVisibleNames.includes(n)).slice(0, 8);
    const onlyA = after.otherVisibleNames.filter(n => !before.otherVisibleNames.includes(n)).slice(0, 8);
    failures.push(`F3 非屋面可见集合变化（before ${before.otherVisibleCount} → after ${after.otherVisibleCount}；只-before=${JSON.stringify(onlyB)}；只-after=${JSON.stringify(onlyA)}）`);
  }
  // ③ 合批实例同步
  const bs = await batchState();
  if (bs.available) {
    const roofShown = bs.members.filter(m => m.roof && m.visible);
    const otherHidden = bs.members.filter(m => !m.roof && !m.visible);
    report.batch = { members: bs.members.length, roofShown: roofShown.length, otherHidden: otherHidden.length };
    if (roofShown.length) failures.push(`F4 合批实例 ${roofShown.length} 个屋面成员仍可见（例 ${JSON.stringify(roofShown.slice(0, 3).map(m => m.name))}）`);
    if (otherHidden.length) failures.push(`F5 合批实例 ${otherHidden.length} 个非屋面成员被误隐藏（例 ${JSON.stringify(otherHidden.slice(0, 3).map(m => m.name))}）`);
  } else { report.batch = { available: false, note: 'window.__batchMembers 不存在，合批同步未验证（实现后必须存在）' }; }
  // ④ 渲染像素应有可见变化（屋面是大片灰瓦面）
  const dp = Math.abs(report.afterOff.pixels.mean - report.before.pixels.mean);
  report.pixelDeltaMean = +dp.toFixed(2);
  if (dp < 0.5) failures.push(`F6 关屋顶前后画布平均亮度几乎不变（Δmean=${dp.toFixed(3)}），渲染路径可能没吃到可见性`);
  // ⑤ 再点一次恢复
  await page.click('#t-roofs');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const back = await census();
  report.afterOn = { roofVisible: back.roofVisible, otherVisibleCount: back.otherVisibleCount };
  if (back.roofVisible !== before.roofVisible) failures.push(`F7 再点后屋面可见数 ${back.roofVisible} 应恢复为 ${before.roofVisible}`);
  if (back.otherVisibleCount !== before.otherVisibleCount) failures.push(`F8 再点后非屋面可见数 ${back.otherVisibleCount} 应为 ${before.otherVisibleCount}`);
} catch (e) {
  failures.push('异常: ' + (e && e.message || e));
} finally {
  await browser.close();
}
report.failures = failures;
report.pass = failures.length === 0;
console.log(JSON.stringify(report, null, 1));
process.exit(report.pass ? 0 : 2);
