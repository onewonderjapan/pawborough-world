// wave12-towerwin：商城楼楼上窗背板 btk-winback 夜间点亮的专项检查（lighting-check S5 的盲区补丁，浏览器专项）。
// R1 重写：从「材质条目计数」改为「背板覆盖率」。背景：R0 的期望值是 raw GLB 里 btk-winback 材质条目数（14），
// 与运行时材质对象数比较——那只在 -km 保住全部重复条目时成立。R1 起 btk-winback 靠材质级语义 extras
// pbRole=window-backing（gltfpack -ke 下 extras 参与材质比较，内容相同不再合并）保名，合法压缩会把同内容
// 的多条 winback 合并成每件 1 个材质对象——全窗仍然全亮，旧断言却会红，反过来迫使管线保留重复材质。
// wave12-towerwin2 扩展：btk-winback 家族（wood 段 btk-winback；非 wood timber 段 btk-winback-<timber>，
// 本轮新增 btk-winback-wood2）扩展到 screen（winbay-*）/band（bandb-*）两类格心背后的 lit 段，且拆段后
// 背板只盖格心覆盖段（实心段 = 原 timber，不得发光）。逐楼分组改用锚节点（楼 id，assemble 保留），
// 一栋楼可有多个家族 wrapper 节点（如和丰楼 winback + winback-wood2）。
// 断言（?zone=bazaar&light=night，查看器默认加载 meshopt cm 件）：
//   T1 raw GLB 独立真相：逐 bazaar 分件解析未压缩 GLB（assemble 产物，cm 由此压缩而来），按楼（锚节点）
//      统计 btk-winback 家族背板的 primitive / 三角 / z 下沿 / 材质族；与 modules/bazaar-tower-kit
//      measurements.json 独立对账：逐楼三角 = 三类出板调用计数之和（windowBackingCalls + screenBackingCalls
//      + bandBackingCalls，缺字段即红——正式验收不再降级；wave12-debt D2 合并保留 TOWERWIN_STRICT
//      语义：npm 默认 =1 即红，显式 =0 仅本地排查 WARN），逐楼 timber 族拆分 = winbackByTimber；
//      并断言每楼背板 z 下沿 ≥ 该楼格心节点（windows__lattice*）z 下沿（拆段后同底；改前整板下探实心段，
//      T0 缺陷）。bazaar 分件之外没有 winback 家族。
//   T2 cm GLB 静态：压缩件同口径逐楼（+族）覆盖率与 raw 相等（背板三角一个不少）；windows__winback* 节点
//      的 primitive 全部归属 btk-winback 家族，且压缩后材质带 extras.pbRole=window-backing（语义存活）。
//      材质对象数只作辅助输出，不作断言（同内容合并是合法的，覆盖率看背板 mesh / 三角）。
//   T3 浏览器 A/B 差分：同一页面加载两遍。
//      B 侧：服务端 presets 原文。经 page.on('response') 记录 presets.json 的实际返回（命中次数 + 内容），
//        并与仓库 lighting/presets.json 深比较——证明 B 侧点亮用的就是仓库 presets，不是旧缓存。
//        背板 mesh 全部命中（数量与逐 mesh 三角 = raw），材质名语义匹配（家族基名），night 下 emissive
//        颜色 = bazaar-window 组色、emissiveIntensity = 组 intensity × night 预设 emissiveScale（期望从仓库
//        presets 独立算，>0——R1 审查可选项2：只看颜色不防「颜色对强度零」）。
//      A 侧：playwright 请求拦截 presets.json，bazaar-window 组去掉全部 btk-winback* 后 fulfill（不改仓库文件），
//        记录拦截命中次数；同样检查 night 生效 / error / timedOut / page errors（R1 补严）。
//        同一批背板材质 emissive 必须全部归零色（差分打在材质级，不看条目计数）；
//        其余发光组命中数两侧一致（拦截只许影响 bazaar-window）。
//   红态（R1 重证见工单包 artifacts/r1/；towerwin2 红态见本单 artifacts/logs/；wave13 拆组红态：
//     旧 lattice 口径测试打 bazaar-window presets 恰红 bNotInGroup + A 侧归零两条，见工单包 artifacts/b1/）：
//     ① 漏 presets 接线（bazaar-window 组丢 btk-winback* / 拆组被还原）→ B 侧点亮/归属断言红；
//     ② 压缩后部分背板错归木料（受控篡改 cm 件的 primitive 材质索引）→ T2 归属/三角多集断言红；
//     ③ towerwin2 基线（6a2bf26c 产物：screen/band 无背板、winb 整板未拆段）→ T1 逐楼对账 / z 下沿红。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5497/';
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const PRESETS_FILE = path.join(ROOT, 'lighting', 'presets.json');
const KIT = path.join(ROOT, 'modules', 'bazaar-tower-kit');
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

let fails = 0, passes = 0;
const ok = (cond, msg, data) => { if (cond) { passes++; console.log('PASS', msg); } else { fails++; console.error('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };
const baseName = (n) => String(n || '').replace(/\.\d{3}$/, '');
const isWinbackMat = (n) => /^btk-winback(-|$)/.test(baseName(n));   // 家族：btk-winback / btk-winback-<timber>
const trisOf = (gltf, prim) => prim.indices !== undefined ? gltf.accessors[prim.indices].count / 3 : gltf.accessors[prim.attributes.POSITION].count / 3;
const zMinOf = (gltf, prim) => {                                     // POSITION accessor min[1]（glTF Y-up = 高度）
  const a = gltf.accessors[prim.attributes.POSITION];
  return a && a.min ? a.min[1] : undefined;
};

function glbJson(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const clen = b.readUInt32LE(12);
  return JSON.parse(b.slice(20, 20 + clen).toString('utf8'));
}

// 逐楼统计 btk-winback 家族背板与格心节点：每栋楼一个锚 empty 节点（名 = 楼 id，assemble 保留），
// 楼下可有一个（wood 族）或多个（如和丰楼 winback + winback-wood2）windows__winback* wrapper 节点。
// 分组键用「锚节点 id」而非「材质实例」：raw 里每楼每族一个材质实例，cm 里 gltfpack 会把同内容材质合法
// 合并（两楼共用一个材质名），按材质分组会误报覆盖率变化。名字落点：raw GLB 名字直接在 mesh 节点上；
// cm 里 gltfpack 把命名 wrapper 与 mesh 节点拆开——与浏览器侧 GLTFLoader 一致，都沿父链找名。
// 按节点引用记账（gltfpack mesh_dedup 会把完全相同的实例网格合并共享，按 mesh 记账会丢重数）。
// 同时统计每楼 windows__lattice*（格心叶）节点 z 下沿，供「背板只盖格心覆盖段」的几何不变式（T0）用。
function winbackStats(gltf, ids) {
  const parent = new Map();
  for (const [i, n] of (gltf.nodes || []).entries()) for (const c of n.children || []) parent.set(c, i);
  const chainNodeName = (i) => { for (let n = i; n !== undefined; n = parent.get(n)) { const nm = gltf.nodes[n].name; if (nm && /^windows__winback/.test(String(nm))) return String(nm); } return null; };
  const chainLatticeName = (i) => { for (let n = i; n !== undefined; n = parent.get(n)) { const nm = gltf.nodes[n].name; if (nm && /^windows__lattice/.test(String(nm))) return String(nm); } return null; };
  const towerOf = (i) => { for (let n = i; n !== undefined; n = parent.get(n)) { const nm = gltf.nodes[n].name; if (nm && ids.has(String(nm))) return String(nm); } return null; };
  const towers = new Map();                          // 楼 id -> { prims, tris, zMin, mats:Set, fam:Map(族->三角), wrappers:[名] }
  const latTowers = new Map();                       // 楼 id -> 格心节点 zMin
  const nodeViolations = [];                         // 名为 windows__winback* 却不归属 winback 家族的 primitive
  const orphanWrappers = [];                         // windows__winback* 找不到楼锚（分组兜底键失效）
  for (const [i, node] of (gltf.nodes || []).entries()) {
    if (node.mesh === undefined) continue;
    const latName = chainLatticeName(i);
    if (latName) {
      const tid = towerOf(i) || latName;
      for (const prim of ((gltf.meshes || [])[node.mesh].primitives || [])) {
        const z = zMinOf(gltf, prim);
        if (z !== undefined) latTowers.set(tid, Math.min(latTowers.get(tid) ?? Infinity, z));
      }
      continue;
    }
    const nodeName = chainNodeName(i);
    if (!nodeName) continue;
    const tid = towerOf(i);
    if (!tid) orphanWrappers.push(nodeName);
    const key = tid || nodeName;
    const fam = baseName(nodeName).replace(/^windows__/, '');       // 'winback' / 'winback-<timber>'
    const t = towers.get(key) || { prims: 0, tris: 0, zMin: Infinity, mats: new Set(), fam: new Map(), wrappers: [] };
    let wrapTris = 0;
    for (const prim of ((gltf.meshes || [])[node.mesh].primitives || [])) {
      const mat = (gltf.materials || [])[prim.material] || {};
      if (!isWinbackMat(mat.name)) { nodeViolations.push({ node: nodeName, mat: mat.name || null }); continue; }
      const z = zMinOf(gltf, prim);
      const tri = trisOf(gltf, prim);
      t.prims++; t.tris += tri; wrapTris += tri;
      t.mats.add(mat.name);
      if (z !== undefined) t.zMin = Math.min(t.zMin, z);
      t.fam.set(fam, (t.fam.get(fam) || 0) + tri);
    }
    t.wrappers.push([nodeName, wrapTris]);
    towers.set(key, t);
  }
  return { towers, latTowers, nodeViolations, orphanWrappers };
}
const multiset = (xs) => [...xs].sort();

// ---------- T1：raw GLB 逐楼背板覆盖率（独立真相源）----------
const REG = JSON.parse(fs.readFileSync(path.join(KIT, 'ids.json'), 'utf8'));
const IDS = new Set(REG.ids);
const zoneFiles = fs.readdirSync(OUT).filter(f => /^zone-.*\.glb$/.test(f) && !f.endsWith('.cm.glb'));
const RAW = {};                                      // file -> winbackStats
for (const f of zoneFiles) RAW[f] = winbackStats(glbJson(path.join(OUT, f)), IDS);
const bazaarFiles = zoneFiles.filter(f => /^zone-bazaar(-\d+)?\.glb$/.test(f));
const rawTotalTris = bazaarFiles.reduce((s, f) => s + [...RAW[f].towers.values()].reduce((a, g) => a + g.tris, 0), 0);
const nonBazaar = zoneFiles.filter(f => !/^zone-bazaar(-\d+)?\.glb$/.test(f) && RAW[f].towers.size);
ok(rawTotalTris > 0, 'T1 raw GLB: btk-winback backing triangles exist in bazaar zone GLBs', { totalTris: rawTotalTris });
ok(nonBazaar.length === 0, 'T1 raw GLB: btk-winback only in bazaar parts', nonBazaar);
const rawViol = bazaarFiles.flatMap(f => RAW[f].nodeViolations.map(v => ({ file: f, ...v })));
ok(rawViol.length === 0, 'T1 raw GLB: every windows__winback* node attributes to btk-winback family', rawViol);
const rawOrphans = bazaarFiles.flatMap(f => RAW[f].orphanWrappers.map(n => ({ file: f, node: n })));
ok(rawOrphans.length === 0, 'T1 raw GLB: every windows__winback* wrapper resolves to a tower anchor', rawOrphans);
// T0 缺陷几何不变式（独立于生成器 measurements）：每楼背板 z 下沿 ≥ 该楼格心（windows__lattice*）z 下沿
// ——拆段后 lit 段与格心同底（等号）；改前 winb 整板下探格心底以下 ~ (1-lf)·(h+0.14) 的实心段（夜间裸亮）。
const zViol = [];
for (const f of bazaarFiles) {
  for (const [id, t] of RAW[f].towers) {
    const latZ = RAW[f].latTowers.get(id);
    if (latZ === undefined) { zViol.push({ file: f, id, why: 'no-lattice-node' }); continue; }
    if (t.zMin === Infinity) continue;
    if (t.zMin < latZ - 0.005) zViol.push({ file: f, id, wbZ: +t.zMin.toFixed(4), latZ: +latZ.toFixed(4) });
  }
}
ok(zViol.length === 0, 'T1 raw GLB: per-tower backing zMin >= lattice zMin (backing covers lattice band only — no bare solid glow)', zViol);

// 生成器侧逐楼期望（三类出板调用计数 / winbackByTimber，build_tower.py 写，独立于本检查与 __lighting）：
// zonePart → 分件文件，同文件内按「楼 id + 三角」多重集对账。缺字段 = 红（正式验收，不再降级警告）。
const partFile = (p) => p === 1 ? 'zone-bazaar.glb' : `zone-bazaar-${p}.glb`;
const perFileExpect = new Map();                     // file -> [tris per tower]
const measFail = [];
for (const id of REG.ids) {
  const mf = path.join(ROOT, 'out-bazaar-towers', id, 'measurements.json');
  if (!fs.existsSync(mf)) { measFail.push(`${id}:no-measurements`); continue; }
  const meas = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const w = meas.windowBackingCalls, s = meas.screenBackingCalls, b = meas.bandBackingCalls;
  const fam = meas.winbackByTimber;
  const missing = ['windowBackingCalls', 'screenBackingCalls', 'bandBackingCalls', 'winbackByTimber'].filter(k => meas[k] === undefined);
  if (missing.length) { measFail.push(`${id}:missing-${missing.join('+')}`); continue; }
  const tris = (w + s + b) * 2;
  const byNode = Object.entries(meas.byNode || {}).filter(([k]) => /^windows__winback/.test(k)).reduce((a, [, v]) => a + v, 0);
  if (byNode !== tris) { measFail.push(`${id}:byNode-${byNode}!=calls-${tris}`); }
  const f = partFile(REG.zonePart[id]);
  if (!RAW[f]) { measFail.push(`${id}:nozonefile`); continue; }
  const got = RAW[f].towers.get(id);
  if (!got && tris > 0) { measFail.push(`${id}:tower-missing-in-${f}`); continue; }
  if (got && got.tris !== tris) measFail.push(`${id}:tris-${got.tris}!=${tris}`);
  const famTris = Object.fromEntries([...(got ? got.fam : [])].map(([k, v]) => [k === 'winback' ? 'wood' : k.replace(/^winback-/, ''), v / 2]));   // 每板 2 三角 → 板数
  const famStr = (o) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  if (famStr(famTris) !== famStr(fam)) measFail.push(`${id}:fam-${famStr(famTris)}!=${famStr(fam)}`);
  if (!perFileExpect.has(f)) perFileExpect.set(f, []);
  perFileExpect.get(f).push(tris);
}
// wave12-debt D2（R2 合并保留）：STRICT 语义——npm run test:towerwin-night 默认 TOWERWIN_STRICT=1，
// 缺 measurements / 缺字段 / 对账不符即红，不许降级成「raw 内部自洽」弱证据；=0 仅本地排查（WARN）。
if (measFail.length && process.env.TOWERWIN_STRICT === '0') {
  console.log('WARN T1 generator cross-check (TOWERWIN_STRICT=0 debug only):', measFail);
} else {
  ok(measFail.length === 0, 'T1 generator cross-check: per-tower tris == (window+screen+band)*2 and timber family split == winbackByTimber', measFail);
}
for (const [f, expect] of perFileExpect) {
  const got = [...RAW[f].towers.values()].map(g => g.tris);
  ok(multiset(expect).join() === multiset(got).join(), `T1 raw GLB per-tower backing tris == generator 3-class calls*2 (${f})`, { expect, got });
}
if (!rawTotalTris) { console.error('T1 dead end, aborting'); process.exit(1); }

// ---------- T2：cm GLB 静态（压缩后背板覆盖率 + 语义存活）----------
const cmAux = {};
for (const f of bazaarFiles) {
  const cm = winbackStats(glbJson(path.join(OUT, f.replace(/\.glb$/, '.cm.glb'))), IDS);
  // 逐楼对账（材质合并合法，覆盖率看节点）：楼 id + 族 + 三角、primitive 数逐楼相等（一栋楼可多家族 wrapper）
  const key = (towers) => multiset([...towers].map(([id, t]) => `${id}#${[...t.fam].map(([k, v]) => k + ':' + v).join(',')}#${t.tris}t${t.prims}p`)).join();
  ok(key(RAW[f].towers) === key(cm.towers), `T2 cm GLB: per-tower backing coverage identical to raw (${f})`,
    { raw: [...RAW[f].towers], cm: [...cm.towers] });
  ok(cm.nodeViolations.length === 0, `T2 cm GLB: every windows__winback* node attributes to btk-winback family (${f})`, cm.nodeViolations);
  const gltf = glbJson(path.join(OUT, f.replace(/\.glb$/, '.cm.glb')));
  const badExtras = (gltf.materials || []).filter(m => isWinbackMat(m.name) && !(m.extras && m.extras.pbRole === 'window-backing'));
  ok(badExtras.length === 0, `T2 cm GLB: btk-winback family materials carry extras.pbRole=window-backing (${f})`, badExtras.map(m => m.name));
  const cmMats = new Set(); for (const t of cm.towers.values()) for (const m of t.mats) cmMats.add(m);
  cmAux[f] = { materials: cmMats.size, towers: cm.towers.size, tris: [...cm.towers.values()].reduce((a, g) => a + g.tris, 0) };   // 辅助输出：合并后每件材质对象数
}
console.log('INFO cm winback materials per file (auxiliary, not asserted):', cmAux);

// ---------- T3：浏览器 A/B ----------
const _REPO_PRESETS = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
// wave13：商城楼背板改按 bazaar-window 组断言（wave13 自 lattice 组拆出的独立发光组，
// 拆组时参数与 lattice 相同；之后机主 2026-09-29 选档 intensity 0.5，期望值始终从 presets 读取）。
const BAZAAR_WIN = _REPO_PRESETS.emissiveGroups.find(g => g.id === 'bazaar-window');
ok(!!BAZAAR_WIN, 'T3 presets: emissiveGroup bazaar-window exists (btk-winback* split out of lattice)', _REPO_PRESETS.emissiveGroups.map(g => g.id));
const BAZAAR_MATERIALS = BAZAAR_WIN ? BAZAAR_WIN.materials : [];
const BAZAAR_COLOR_HEX = BAZAAR_WIN ? BAZAAR_WIN.color.replace(/^#/, '').toLowerCase() : '';
// 期望亮度独立取自仓库 presets：emissiveIntensity = bazaar-window 组 intensity × night 预设 emissiveScale
// （lighting.js applyEmissive 的公式；R1 审查可选项2：只看颜色不防「颜色对、强度为零」→ 期望值必须 > 0；
//  wave12-debt D2 合并保留：期望强度本身必须 > 0——预设与实际同时为零时等值断言不红）
const BAZAAR_INTENSITY_EXPECT = BAZAAR_WIN ? BAZAAR_WIN.intensity * ((_REPO_PRESETS.presets && _REPO_PRESETS.presets.night && _REPO_PRESETS.presets.night.emissiveScale) || 0) : 0;
ok(BAZAAR_INTENSITY_EXPECT > 0, 'T3 presets: bazaar-window intensity x night.emissiveScale > 0 (zero expectation would make the equality vacuous)', BAZAAR_INTENSITY_EXPECT);
ok(BAZAAR_MATERIALS.length > 0 && BAZAAR_MATERIALS.every(m => m.startsWith('btk-winback')), 'T3 presets: bazaar-window group owns the btk-winback* family', BAZAAR_MATERIALS);
const latticeGroup = _REPO_PRESETS.emissiveGroups.find(g => g.id === 'lattice');
ok(latticeGroup && !latticeGroup.materials.some(m => m.startsWith('btk-winback')), 'T3 presets: lattice group no longer lists btk-winback* (wave13 split)', latticeGroup && latticeGroup.materials);
const PRESET_URL = '**/lighting/presets.json';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

async function openNight({ stripWinback }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });   // 独立 context：HTTP 缓存不得短路拦截
  const page = await ctx.newPage();
  const errors = [];
  const presetHits = { n: 0, bodies: [] };           // 命中次数 + 实际到达页面的内容
  page.on('pageerror', e => errors.push(String(e)));
  if (stripWinback) {
    await page.route(PRESET_URL, route => {
      presetHits.n++;
      const j = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
      const g = j.emissiveGroups.find(g => g.id === 'bazaar-window');
      g.materials = g.materials.filter(m => !m.startsWith('btk-winback'));   // 家族整体摘除（bazaar-window 组 = 全部 btk-winback*）
      const body = JSON.stringify(j);
      presetHits.bodies.push(body);
      route.fulfill({ status: 200, contentType: 'application/json', body });
    });
  } else {
    page.on('response', async res => {               // 被动记录：B 侧服务端真正返回的内容
      if (!res.url().endsWith('/lighting/presets.json')) return;
      try { presetHits.n++; presetHits.bodies.push(await res.text()); } catch (e) { errors.push('presets read: ' + e); }
    });
  }
  await page.goto(BASE + '?zone=bazaar&light=night', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });   // deferred outer 到齐后再读数，两页口径一致
  const st = await page.evaluate(() => window.__lighting.state());
  const panels = await page.evaluate(() => {
    // 名字落点（three 0.180 GLTFLoader）：glTF 节点名在包装 Object3D 上，Mesh 本体 mesh_N；
    // node.name 被 sanitize 剥点，原始名在 userData.name —— 沿父链两个候选都试。
    const cands = (o) => { const out = []; for (let n = o; n; n = n.parent) { for (const c of [n.userData && n.userData.name, n.name]) { if (typeof c === 'string') out.push(c.replace(/^mesh-/, '')); } } return out; };
    const panels = [];
    window.__scene.traverse(o => {
      if (!o.isMesh) return;
      const hit = cands(o).find(c => /^windows__winback/.test(c));
      if (!hit) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      panels.push({ node: hit, tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3,
                    // 亮态判据 = emissive 颜色（点亮 = 发光组色）+ emissiveIntensity（= 组 intensity × night
                    // emissiveScale，lighting.js 显式设置；glTF 材质自带的缺省 1 不作判据，见 T3 期望值）
                    mats: mats.map(m => ({ name: m.name, base: m.name.replace(/\.\d{3}$/, ''),
                                           emissiveHex: m.emissive && m.emissive.getHexString(),
                                           emissiveIntensity: m.emissiveIntensity })) });
    });
    return panels;
  });
  await ctx.close();
  return { st, errors, presetHits, panels };
}

// B 侧：仓库 presets 原文（服务端返回被记录并与仓库文件比对）
const B = await openNight({ stripWinback: false });
ok(B.st && B.st.preset === 'night' && !B.st.error && !B.st.timedOut, 'T3 B: night preset applied (not legacy fallback)', B.st && { preset: B.st.preset, error: B.st.error, timedOut: B.st.timedOut });
ok(B.errors.length === 0, 'T3 B: no page errors', B.errors);
ok(B.presetHits.n >= 1, 'T3 B: presets.json fetched (hit count recorded)', B.presetHits.n);
const repoPresets = _REPO_PRESETS;
const servedSame = B.presetHits.bodies.length && B.presetHits.bodies.every(b => { try { return JSON.stringify(JSON.parse(b)) === JSON.stringify(repoPresets); } catch (e) { return false; } });
ok(servedSame, 'T3 B: served presets content identical to repository file', B.presetHits.bodies.map(b => b.length));

const rawPanels = bazaarFiles.flatMap(f => [...RAW[f].towers.values()].flatMap(t => t.wrappers.map(([n, tris]) => ({ node: n, tris }))));
const bByNode = multiset(B.panels.map(p => p.node + '#' + p.tris));
const rawByNode = multiset(rawPanels.map(p => p.node + '#' + p.tris));
ok(bByNode.join() === rawByNode.join(), 'T3 B: backing meshes in cm scene match raw coverage (per node + triangles)', { browser: B.panels.length, raw: rawPanels.length, sample: { browser: B.panels.slice(0, 3), raw: rawPanels.slice(0, 3) } });
const bBadMat = B.panels.filter(p => !p.mats.length || p.mats.some(m => !isWinbackMat(m.base)));
ok(bBadMat.length === 0, 'T3 B: every backing mesh material is btk-winback family', bBadMat);
const bDark = B.panels.filter(p => p.mats.some(m => m.emissiveHex !== BAZAAR_COLOR_HEX));
ok(bDark.length === 0, `T3 B: every backing material lit with bazaar-window color ${BAZAAR_COLOR_HEX} at night`, bDark);
const bIntensity = B.panels.filter(p => p.mats.some(m => !(Math.abs(m.emissiveIntensity - BAZAAR_INTENSITY_EXPECT) < 1e-6)));
ok(bIntensity.length === 0, `T3 B: every backing material emissiveIntensity == bazaar-window(${BAZAAR_WIN.intensity}) x night.emissiveScale = ${BAZAAR_INTENSITY_EXPECT}`, bIntensity.map(p => ({ node: p.node, mats: p.mats.map(m => ({ n: m.name, i: m.emissiveIntensity })) })));
const bNotInGroup = B.panels.flatMap(p => p.mats).filter(m => !BAZAAR_MATERIALS.includes(m.base));
ok(bNotInGroup.length === 0, 'T3 B: backing material base names are in bazaar-window group materials', bNotInGroup.map(m => m.name));

// A 侧：拦截 presets，bazaar-window 组去掉 btk-winback
const A = await openNight({ stripWinback: true });
ok(A.presetHits.n >= 1 && A.presetHits.bodies.length === A.presetHits.n, 'T3 A: interception hits recorded', A.presetHits.n);
ok(A.st && A.st.preset === 'night' && !A.st.error && !A.st.timedOut, 'T3 A: night preset applied with stripped presets (no error, no timeout)', A.st && { preset: A.st.preset, error: A.st.error, timedOut: A.st.timedOut });
ok(A.errors.length === 0, 'T3 A: no page errors', A.errors);
const aByNode = multiset(A.panels.map(p => p.node + '#' + p.tris));
ok(aByNode.join() === rawByNode.join(), 'T3 A: backing meshes unchanged under stripped presets (interception only touches lighting)', A.panels.length);
const aLit = A.panels.filter(p => p.mats.some(m => m.emissiveHex !== '000000'));
ok(aLit.length === 0, 'T3 A: every backing material dark (emissive black) without bazaar-window wiring', aLit);
if (A.st && B.st) {
  const groups = Object.keys(B.st.emissiveByGroup || {});
  const others = groups.filter(g => g !== 'bazaar-window').every(g => (B.st.emissiveByGroup[g] || 0) === (A.st.emissiveByGroup[g] || 0));
  ok(others, 'T3 A/B: stripping affects only the bazaar-window group', { B: B.st.emissiveByGroup, A: A.st.emissiveByGroup });
  console.log('INFO emissiveByGroup.bazaar-window B/A (auxiliary):', B.st.emissiveByGroup?.['bazaar-window'], '/', A.st.emissiveByGroup?.['bazaar-window'],
              '| distinct cm winback materials (auxiliary):', Object.values(cmAux).reduce((s, v) => s + v.materials, 0));
}

await browser.close();
console.log(`towerwin-night-check: ${passes} pass, ${fails} fail`);
if (fails) process.exit(1);
