// wave12-towerwin：商城楼楼上窗背板 btk-winback 夜间点亮的专项检查（lighting-check S5 的盲区补丁，浏览器专项）。
// R1 重写：从「材质条目计数」改为「背板覆盖率」。背景：R0 的期望值是 raw GLB 里 btk-winback 材质条目数（14），
// 与运行时材质对象数比较——那只在 -km 保住全部重复条目时成立。R1 起 btk-winback 靠材质级语义 extras
// pbRole=window-backing（gltfpack -ke 下 extras 参与材质比较，内容相同不再合并）保名，合法压缩会把同内容
// 的多条 winback 合并成每件 1 个材质对象——全窗仍然全亮，旧断言却会红，反过来迫使管线保留重复材质。
// 断言（?zone=bazaar&light=night，查看器默认加载 meshopt cm 件）：
//   T1 raw GLB 独立真相：逐 bazaar 分件解析未压缩 GLB（assemble 产物，cm 由此压缩而来），按材质实例
//      （= 逐楼，Blender 对每栋楼独立命名材质）分组统计 btk-winback 背板的 node / primitive / 三角数；
//      与 modules/bazaar-tower-kit 生成器侧的 measurements.json（windowBackingCalls / byNode 三角数，
//      build_tower.py 生成时写，独立于本检查与 __lighting）交叉核对。并断言 bazaar 分件之外没有 winback。
//   T2 cm GLB 静态：压缩件同口径分组统计与 raw 逐组相等（背板三角一个不少）；每个名为 windows__winback*
//      的节点的 primitive 全部归属 btk-winback，且压缩后材质带 extras.pbRole=window-backing（语义存活）。
//      材质对象数只作辅助输出，不作断言（同内容合并是合法的，覆盖率看背板 mesh / 三角）。
//   T3 浏览器 A/B 差分：同一页面加载两遍。
//      B 侧：服务端 presets 原文。经 page.on('response') 记录 presets.json 的实际返回（命中次数 + 内容），
//        并与仓库 lighting/presets.json 深比较——证明 B 侧点亮用的就是仓库 presets，不是旧缓存。
//        背板 mesh 全部命中（数量与逐 mesh 三角 = raw），材质名语义匹配，night 下 emissiveIntensity > 0，
//        且材质基名在 lattice 组 materials 里。
//      A 侧：playwright 请求拦截 presets.json，lattice 组去掉 btk-winback 后 fulfill（不改仓库文件），
//        记录拦截命中次数；同样检查 night 生效 / error / timedOut / page errors（R1 补严）。
//        同一批背板材质 emissiveIntensity 必须全部归 0（差分打在材质级，不看条目计数）；
//        其余发光组命中数两侧一致（拦截只许影响 lattice）。
//   红态（R1 重证，见工单包 artifacts/r1/）：
//     ① 漏 presets 接线（lattice 组去掉 btk-winback）→ B 侧 emissiveIntensity>0 断言红；
//     ② 压缩后部分背板错归木料（受控篡改 cm 件的 primitive 材质索引）→ T2 归属/三角多集断言红。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
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
const trisOf = (gltf, prim) => prim.indices !== undefined ? gltf.accessors[prim.indices].count / 3 : gltf.accessors[prim.attributes.POSITION].count / 3;

function glbJson(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const clen = b.readUInt32LE(12);
  return JSON.parse(b.slice(20, 20 + clen).toString('utf8'));
}

// 逐节点（=逐楼）统计 btk-winback 背板：每栋楼一个 windows__winback(.NNN) wrapper 节点。
// 分组键用「节点」而非「材质实例」：raw 里每楼一个材质实例，cm 里 gltfpack 会把同内容材质合法合并
// （两楼共用一个材质名），按材质分组会误报覆盖率变化。名字落点：raw GLB 名字直接在 mesh 节点上；
// cm 里 gltfpack 把命名 wrapper 与 mesh 节点拆开——与浏览器侧 GLTFLoader 一致，都沿父链找名。
// 按节点引用记账（gltfpack mesh_dedup 会把完全相同的实例网格合并共享，按 mesh 记账会丢重数）。
function winbackStats(gltf) {
  const parent = new Map();
  for (const [i, n] of (gltf.nodes || []).entries()) for (const c of n.children || []) parent.set(c, i);
  const chainNodeName = (i) => { for (let n = i; n !== undefined; n = parent.get(n)) { const nm = gltf.nodes[n].name; if (nm && /^windows__winback/.test(String(nm))) return String(nm); } return null; };
  const towers = new Map();                          // wrapper 节点名 -> { prims, tris, mats:Set(材质实例名) }
  const nodeViolations = [];                         // 名为 windows__winback* 却不归属 winback 材质的 primitive
  for (const [i, node] of (gltf.nodes || []).entries()) {
    if (node.mesh === undefined) continue;
    const nodeName = chainNodeName(i);
    if (!nodeName) continue;
    const t = towers.get(nodeName) || { prims: 0, tris: 0, mats: new Set() };
    for (const prim of ((gltf.meshes || [])[node.mesh].primitives || [])) {
      const mat = (gltf.materials || [])[prim.material] || {};
      if (baseName(mat.name) !== 'btk-winback') { nodeViolations.push({ node: nodeName, mat: mat.name || null }); continue; }
      t.prims++; t.tris += trisOf(gltf, prim); t.mats.add(mat.name);
    }
    towers.set(nodeName, t);
  }
  return { towers, nodeViolations };
}
const multiset = (xs) => [...xs].sort();

// ---------- T1：raw GLB 逐楼背板覆盖率（独立真相源）----------
const zoneFiles = fs.readdirSync(OUT).filter(f => /^zone-.*\.glb$/.test(f) && !f.endsWith('.cm.glb'));
const RAW = {};                                      // file -> winbackStats
for (const f of zoneFiles) RAW[f] = winbackStats(glbJson(path.join(OUT, f)));
const bazaarFiles = zoneFiles.filter(f => /^zone-bazaar(-\d+)?\.glb$/.test(f));
const rawTotalTris = bazaarFiles.reduce((s, f) => s + [...RAW[f].towers.values()].reduce((a, g) => a + g.tris, 0), 0);
const nonBazaar = zoneFiles.filter(f => !/^zone-bazaar(-\d+)?\.glb$/.test(f) && RAW[f].towers.size);
ok(rawTotalTris > 0, 'T1 raw GLB: btk-winback backing triangles exist in bazaar zone GLBs', { totalTris: rawTotalTris });
ok(nonBazaar.length === 0, 'T1 raw GLB: btk-winback only in bazaar parts', nonBazaar);
const rawViol = bazaarFiles.flatMap(f => RAW[f].nodeViolations.map(v => ({ file: f, ...v })));
ok(rawViol.length === 0, 'T1 raw GLB: every windows__winback* node attributes to btk-winback', rawViol);

// 生成器侧逐楼期望（windowBackingCalls / byNode 三角数）：zonePart → 分件文件，同文件内按三角数多重集对账
const REG = JSON.parse(fs.readFileSync(path.join(KIT, 'ids.json'), 'utf8'));
const partFile = (p) => p === 1 ? 'zone-bazaar.glb' : `zone-bazaar-${p}.glb`;
const perFileExpect = new Map();                     // file -> [tris per tower]
let measMissing = [];
for (const id of REG.ids) {
  const mf = path.join(ROOT, 'out-bazaar-towers', id, 'measurements.json');
  if (!fs.existsSync(mf)) { measMissing.push(id); continue; }
  const meas = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const calls = meas.windowBackingCalls || 0;
  if (!calls) continue;
  const tris = (meas.byNode || {})['windows__winback'];
  const f = partFile(REG.zonePart[id]);
  if (!RAW[f]) { measMissing.push(id + ':nozonefile'); continue; }
  if (tris !== calls * 2) { ok(false, `T1 generator cross-check: ${id} byNode tris == 2x windowBackingCalls`, { tris, calls }); }
  if (!perFileExpect.has(f)) perFileExpect.set(f, []);
  perFileExpect.get(f).push(tris);
}
if (measMissing.length) console.log('WARN T1 generator measurements missing (degraded to raw-internal consistency only):', measMissing);
for (const [f, expect] of perFileExpect) {
  const got = [...RAW[f].towers.values()].map(g => g.tris);
  ok(multiset(expect).join() === multiset(got).join(), `T1 raw GLB per-tower backing tris == generator windowBackingCalls*2 (${f})`, { expect, got });
}
if (!rawTotalTris) { console.error('T1 dead end, aborting'); process.exit(1); }

// ---------- T2：cm GLB 静态（压缩后背板覆盖率 + 语义存活）----------
const cmAux = {};
for (const f of bazaarFiles) {
  const cm = winbackStats(glbJson(path.join(OUT, f.replace(/\.glb$/, '.cm.glb'))));
  // 逐楼对账（材质合并合法，覆盖率看节点）：wrapper 节点名 + 该楼三角数、primitive 数逐楼相等
  const key = (towers) => multiset([...towers].map(([n, t]) => `${n}#${t.tris}t${t.prims}p`)).join();
  ok(key(RAW[f].towers) === key(cm.towers), `T2 cm GLB: per-tower backing coverage identical to raw (${f})`,
    { raw: [...RAW[f].towers], cm: [...cm.towers] });
  ok(cm.nodeViolations.length === 0, `T2 cm GLB: every windows__winback* node attributes to btk-winback (${f})`, cm.nodeViolations);
  const gltf = glbJson(path.join(OUT, f.replace(/\.glb$/, '.cm.glb')));
  const badExtras = (gltf.materials || []).filter(m => baseName(m.name) === 'btk-winback' && !(m.extras && m.extras.pbRole === 'window-backing'));
  ok(badExtras.length === 0, `T2 cm GLB: btk-winback materials carry extras.pbRole=window-backing (${f})`, badExtras.map(m => m.name));
  const cmMats = new Set(); for (const t of cm.towers.values()) for (const m of t.mats) cmMats.add(m);
  cmAux[f] = { materials: cmMats.size, towers: cm.towers.size, tris: [...cm.towers.values()].reduce((a, g) => a + g.tris, 0) };   // 辅助输出：合并后每件材质对象数
}
console.log('INFO cm winback materials per file (auxiliary, not asserted):', cmAux);

// ---------- T3：浏览器 A/B ----------
const _REPO_PRESETS = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
const LATTICE_MATERIALS = _REPO_PRESETS.emissiveGroups.find(g => g.id === 'lattice').materials;
const LATTICE_COLOR_HEX = _REPO_PRESETS.emissiveGroups.find(g => g.id === 'lattice').color.replace(/^#/, '').toLowerCase();
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
      const g = j.emissiveGroups.find(g => g.id === 'lattice');
      g.materials = g.materials.filter(m => m !== 'btk-winback');
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
                    // 注意：three 的 emissiveIntensity 默认恒为 1（glTF 无该字段），亮灭要看 emissive 颜色
                    // （点亮 = 发光组 color，熄灭 = 000000，glTF emissiveFactor 缺省即黑）
                    mats: mats.map(m => ({ name: m.name, base: m.name.replace(/\.\d{3}$/, ''), emissiveHex: m.emissive && m.emissive.getHexString() })) });
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

const rawPanels = bazaarFiles.flatMap(f => [...RAW[f].towers].map(([n, t]) => ({ node: n, tris: t.tris })));
const bByNode = multiset(B.panels.map(p => p.node + '#' + p.tris));
const rawByNode = multiset(rawPanels.map(p => p.node + '#' + p.tris));
ok(bByNode.join() === rawByNode.join(), 'T3 B: backing meshes in cm scene match raw coverage (per node + triangles)', { browser: B.panels.length, raw: rawPanels.length, sample: { browser: B.panels.slice(0, 3), raw: rawPanels.slice(0, 3) } });
const bBadMat = B.panels.filter(p => !p.mats.length || p.mats.some(m => m.base !== 'btk-winback'));
ok(bBadMat.length === 0, 'T3 B: every backing mesh material is btk-winback', bBadMat);
const bDark = B.panels.filter(p => p.mats.some(m => m.emissiveHex !== LATTICE_COLOR_HEX));
ok(bDark.length === 0, `T3 B: every backing material lit with lattice color ${LATTICE_COLOR_HEX} at night`, bDark);
const bNotInGroup = B.panels.flatMap(p => p.mats).filter(m => !LATTICE_MATERIALS.includes(m.base));
ok(bNotInGroup.length === 0, 'T3 B: backing material base names are in lattice group materials', bNotInGroup.map(m => m.name));

// A 侧：拦截 presets，lattice 组去掉 btk-winback
const A = await openNight({ stripWinback: true });
ok(A.presetHits.n >= 1 && A.presetHits.bodies.length === A.presetHits.n, 'T3 A: interception hits recorded', A.presetHits.n);
ok(A.st && A.st.preset === 'night' && !A.st.error && !A.st.timedOut, 'T3 A: night preset applied with stripped presets (no error, no timeout)', A.st && { preset: A.st.preset, error: A.st.error, timedOut: A.st.timedOut });
ok(A.errors.length === 0, 'T3 A: no page errors', A.errors);
const aByNode = multiset(A.panels.map(p => p.node + '#' + p.tris));
ok(aByNode.join() === rawByNode.join(), 'T3 A: backing meshes unchanged under stripped presets (interception only touches lighting)', A.panels.length);
const aLit = A.panels.filter(p => p.mats.some(m => m.emissiveHex !== '000000'));
ok(aLit.length === 0, 'T3 A: every backing material dark (emissive black) without btk-winback wiring', aLit);
if (A.st && B.st) {
  const groups = Object.keys(B.st.emissiveByGroup || {});
  const others = groups.filter(g => g !== 'lattice').every(g => (B.st.emissiveByGroup[g] || 0) === (A.st.emissiveByGroup[g] || 0));
  ok(others, 'T3 A/B: stripping affects only the lattice group', { B: B.st.emissiveByGroup, A: A.st.emissiveByGroup });
  console.log('INFO emissiveByGroup.lattice B/A (auxiliary):', B.st.emissiveByGroup?.lattice, '/', A.st.emissiveByGroup?.lattice,
              '| distinct cm winback materials (auxiliary):', Object.values(cmAux).reduce((s, v) => s + v.materials, 0));
}

await browser.close();
console.log(`towerwin-night-check: ${passes} pass, ${fails} fail`);
if (fails) process.exit(1);
