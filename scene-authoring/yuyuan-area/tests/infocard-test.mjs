// wave11-infocard R2：点击地标弹信息卡 —— headless 验收（R2 按主控裁定口径 + REVIEW-astra 8 项必修重写）。
// 用法：PORT=5496 OUT_DIR=out-zone node scripts/server.mjs &
//       BASE=http://127.0.0.1:5496/ OUT_DIR=out-zone [SHOT_DIR=<目录>] [REPORT=<json>] node tests/infocard-test.mjs
//
// R2 期望值口径（主控裁定 2026-09-27，一律不许拿产物比产物）：
//   模型高度    运行时该 layout id 全部可见网格的世界包围盒最高点，地面 0 m 起算；oracle 用 Node 独立解析
//               OUT_DIR 的 raw 分区 GLB（节点变换 × POSITION accessor min/max，y<0 截 0），与卡片值差 ≤ 0.1 m；
//   层数       layout storeys → levels，都没有 → 未核实（不从模型猜）；
//   轮廓面积    layout footprint 鞋带面积现算（输入轮廓口径）；
//   模型来源    R4：oracle = 本次点击射线的独立命中网格 → 对回 raw GLB 节点 → raw 父链最近 extras.module（无静态套件表）。
// 断言：
//   T1 9 个对象（默认 8 + 反例仪门戏楼）真实点击逐个弹卡，6 字段 + 名称逐项核对（高度按 ≤0.1 m 数值容差）；
//      R4：模型来源期望 = 本次点击射线的独立 oracle（见 tests/infocard-raw-oracle.mjs）命中节点 → raw GLB 父链最近
//      extras.module，精确相等；同时核对 __pickDebug.node 与 oracle 命中网格是同一对象；
//   T2 白名单：卡片 DOM 只有 h2 名称 + 6 组 dt/dd + 1 行固定说明，无任何其他文本；
//   T3 无名对象不弹卡，但 __pickDebug 仍写 { id, name:null }；空白点击写 { id:null, name:null }；
//   T4 Esc 关卡（先断言卡片已打开）+ 标签高亮清除；
//   T5 步行模式不弹卡（先断言卡片已打开；切步行时已开卡片立即关闭并清高亮，enter 与 spawnAt 两条路径都测），
//      退回轨道恢复弹卡；
//   T6 隐藏几何不抢点击：T6a 关屋顶后与 ?batch=0 同屏点 __pickDebug.id 逐点一致（保留 A/B 对照）；
//      T6b/T6c（R4）前景对象自身 / 父节点 visible=false 后：被测拾取 id 与「独立射线第一个可见命中 → raw GLB 父链 id」
//      精确相等，命中节点同一；恢复态 oracle 与实现都回到前景；
//      T6d（R4）浏览器实点「屋顶」按钮（web/roofs.js 规则）后逐点点选：比较实际命中节点身份（three uuid 与 raw GLB 节点）
//      而非只比 id，并要求至少 1 个「隐藏同 id 屋面在前、可见网格在后」的反例点；
//   T7 375px 手机宽度：卡片停靠在工具区之外（矩形不相交），每个工具按钮中心 elementFromPoint 命中按钮本身，
//      实点「步行」确认模式真的切换；
//   T8（R4）九曲桥来源按命中父链：T8a 默认顶视点精确相等；T8b 默认状态 bridge-head 可达性射线扫描（不可达如实记限制）；
//      T8c 内存受控构造（抬高/平移 bridge-head 构件组，同 id 两个 module 同时可见、分别可点）两处各点一次，精确相等。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RawGlbIndex, installPageOracle } from './infocard-raw-oracle.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5496/';
const SHOT_DIR = process.env.SHOT_DIR || null;
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const objs = new Map(layout.objects.map(o => [o.id, o]));

// ---------- oracle（独立于实现，不从 web/infocard.js import 任何映射） ----------
function footprintArea(o) {
  const fp = o?.geometry?.footprint;
  if (!Array.isArray(fp) || fp.length < 3) return null;
  let a = 0;
  for (let i = 0; i < fp.length; i++) {
    const p = fp[i], q = fp[(i + 1) % fp.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
const NOTE = '名称来自 OpenStreetMap；形制为本项目推断建模，年代与史实未核实。';
const FIELDS = ['类别', '所在区域', '模型高度', '层数（输入数据）', '轮廓面积（OSM）', '模型来源'];
const AREA_CN = { garden: '豫园', temple: '城隍庙', bazaar: '商城', pond: '池带', fangbang: '方浜中路', outer: '外围' };
// kind → 中文（与实现独立重写；R2：templeAnchor 里 戏台/戏楼 这类具体类型先于泛化的「门」）
function kindOra(o) {
  const k = o?.kind;
  const n = String(o?.name || '');
  if (k === 'hall') return '厅堂';
  if (k === 'xuan') return '轩';
  if (k === 'tower') return o?.zone === 'pond' ? '亭' : '楼';
  if (k === 'bazaarBlock') return '商城楼';
  if (k === 'zigzagBridge' || k === 'bridge') return '桥';
  if (k === 'rockery') return '假山';
  if (k === 'templeAnchor') {
    if (/殿$/.test(n)) return '殿';
    if (/庭$|院|穿廊|香道/.test(n)) return '庭院';
    if (/戏台|戏楼/.test(n)) return '戏台';
    if (/门/.test(n)) return '门';
    if (/廊/.test(n)) return '廊';
    if (/^tree/.test(n)) return '树';
    return '庙宇建筑';
  }
  const CN = {
    pavilion: '亭', waterside: '水榭', watersideGallery: '水廊', corridor: '廊', stage: '戏台',
    gateAnchor: '门楼', moonGateWall: '洞门', wallHead: '墙头', wall: '墙', steps: '台阶',
    shopAnchor: '店铺', stall: '摊位', bench: '长凳', tree: '树', plaza: '广场', water: '水面',
    road: '道路', path: '小径', paving: '铺装', ground: '地面', outerBuilding: '楼',
    facadeBay: '立面开间', osmTempleOutline: '庙界', temple: '殿宇',
  };
  return CN[k] ?? (k ? String(k) : '—');
}
// 9 个点击对象：按 layout 名称解析（默认 8 目标 + 反例仪门戏楼）；名称不写死 id。
const TARGET_NAMES = [
  ['三穗堂'], ['仰山堂'], ['湖心亭'], ['九曲桥', 'zigzagBridge'], ['大假山（示意）'],
  ['华宝楼'], ['大殿'], ['上海老饭店'], ['仪门戏楼'],
];
function byName(name, kind) {
  const hits = layout.objects.filter(o => o.name === name);
  if (hits.length === 1) return hits[0];
  if (kind) { const k = hits.find(o => o.kind === kind); if (k) return k; }
  console.error(`SETUP 目标「${name}」解析失败：${JSON.stringify(hits.map(h => ({ id: h.id, kind: h.kind })))}`);
  process.exit(2);
}
const TARGETS = TARGET_NAMES.map(([nm, kind]) => ({ o: byName(nm, kind), nm }));

// ---------- GLB oracle：raw 分区 GLB 独立解析（高度 / 来源） ----------
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1];
  const q = n.rotation || [0, 0, 0, 1];   // glTF: xyzw
  const [x, y, z, w] = q;
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
function parseGltfJson(file) {
  const b = fs.readFileSync(file);
  const magic = b.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`${file}: not GLB`);
  const jsonLen = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
}
function idFromPipe(name) {
  const parts = String(name || '').split('|');
  return parts.length >= 4 ? parts[1] : null;
}
// 汇总全部 raw 分区件：id → { maxY, module }（模块 = 该 id 装配节点父链 extras.module，必须唯一）
function buildGlbOracle() {
  const mfPath = path.join(OUT, 'zones-manifest.json');
  if (!fs.existsSync(mfPath)) { console.error(`SETUP 缺 ${mfPath}`); process.exit(2); }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const files = [...new Set(mf.zones.filter(z => z.file).map(z => z.file))];
  const byId = {};
  for (const f of files) {
    let g;
    try { g = parseGltfJson(path.join(OUT, f)); } catch (e) { console.error(`SETUP ${f}: ${e.message}`); process.exit(2); }
    const par = new Array(g.nodes.length).fill(null);
    g.nodes.forEach((n, i) => (n.children || []).forEach(c => { par[c] = i; }));
    const local = new Array(g.nodes.length);
    const world = (i) => {
      if (local[i]) return local[i];
      const m = trs(g.nodes[i]);
      local[i] = par[i] == null ? m : mul4(world(par[i]), m);
      return local[i];
    };
    const chainId = (i) => {
      for (let c = i; c != null; c = par[c]) {
        const n = g.nodes[c];
        if (n.extras && n.extras.id != null) return n.extras.id;
        const pid = idFromPipe(n.name);
        if (pid) return pid;
      }
      return null;
    };
    const chainModule = (i) => {
      for (let c = i; c != null; c = par[c]) {
        const n = g.nodes[c];
        if (n.extras && n.extras.module != null) return n.extras.module;
      }
      return null;
    };
    g.nodes.forEach((n, i) => {
      if (n.mesh === undefined) return;
      const id = chainId(i);
      if (!id) return;
      const w = world(i);
      const mesh = g.meshes[n.mesh];
      const mod = chainModule(i);
      for (const prim of mesh.primitives) {
        const acc = g.accessors[prim.attributes.POSITION];
        if (!acc || !acc.min || !acc.max) continue;
        let primMaxY = -Infinity;
        for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
          const y = w[1] * cx + w[5] * cy + w[9] * cz + w[13];
          if (!(id in byId)) byId[id] = { maxY: -Infinity, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, modules: new Set(), modTop: {} };
          const xx = w[0] * cx + w[4] * cy + w[8] * cz + w[12];
          const zz = w[2] * cx + w[6] * cy + w[10] * cz + w[14];
          if (y > byId[id].maxY) byId[id].maxY = y;
          if (y > primMaxY) primMaxY = y;
          if (xx < byId[id].minX) byId[id].minX = xx;
          if (xx > byId[id].maxX) byId[id].maxX = xx;
          if (zz < byId[id].minZ) byId[id].minZ = zz;
          if (zz > byId[id].maxZ) byId[id].maxZ = zz;
        }
        if (mod) {
          byId[id].modules.add(mod);
          byId[id].modTop[mod] = Math.max(byId[id].modTop[mod] ?? -Infinity, primMaxY);   // 该 module 网格的世界最高点（多模块 id 的顶面排序用）
        }
      }
    });
  }
  const out = {};
  for (const [id, v] of Object.entries(byId)) {
    void v.modules.size;
    out[id] = { maxY: Math.max(0, v.maxY), cx: (v.minX + v.maxX) / 2, cz: (v.minZ + v.maxZ) / 2, modules: [...v.modules].sort(), modTop: v.modTop };
  }
  return out;
}
const GLB_ORA = buildGlbOracle();
// R4：命中节点 oracle —— raw 分区 GLB 三角形索引（命中三角形 → raw 节点 → raw 父链 id / module）
const RAW = new RawGlbIndex(OUT);

function expectedCard(t) {
  const o = t.o;
  const g = GLB_ORA[o.id] || { maxY: null, modules: [] };
  const st = o.storeys ?? o.levels;
  const a = footprintArea(o);
  return {
    name: o.name,
    dts: FIELDS,
    dds: [
      kindOra(o),
      AREA_CN[o.zone] || o.zone || '—',
      g.maxY == null ? '—' : `${g.maxY.toFixed(1)} m`,
      st == null ? '未核实' : String(st),
      a == null ? '—' : `${a.toFixed(1)} m²`,
      g.modules.length ? `套件：${g.modules.join('|')}` : '程序化体块',
    ],
    srcModules: g.modules,
    note: NOTE,
  };
}
// 点击世界锚点：footprint 质心 / rocks / 折线中点 / position；eye 高度取 layout 高度（缺省 8）
function clickPoint(o) {
  const g = o.geometry || {};
  let cx, cz;
  if (g.footprint) { const xs = g.footprint.map(p => p[0]), zs = g.footprint.map(p => p[1]); cx = xs.reduce((x, y) => x + y) / xs.length; cz = zs.reduce((x, y) => x + y) / zs.length; }
  else if (g.rocks) { const xs = g.rocks.map(r => r.x), zs = g.rocks.map(r => r.z); cx = xs.reduce((x, y) => x + y) / xs.length; cz = zs.reduce((x, y) => x + y) / zs.length; }
  else if (g.polyline) { const p = g.polyline[Math.floor(g.polyline.length / 2)]; cx = p[0]; cz = p[1]; }
  else if (g.position) { cx = g.position[0]; cz = g.position.length > 2 ? g.position[2] : g.position[1]; }
  else return null;
  const oc = GLB_ORA[o.id];
  const hasOwnAnchor = !!(g.footprint || g.rocks || g.polyline);
  if (!hasOwnAnchor && oc && Number.isFinite(oc.cx) && Math.hypot(oc.cx - cx, oc.cz - cz) > 2) { cx = oc.cx; cz = oc.cz; }   // 只有 position 锚点的对象（如同一锚点挂多个 anchor）：改点 GLB 网格质心
  const top = (o.height ?? o.deckY ?? 8);
  return { eye: [cx + 4, top + 130, cz + 4], target: [cx, 0.5, cz] };
}
// 无名对象：layout 里 name 为空的外围道路，离任何有名对象 ≥ 80 m（顶视点击必命中它自身；从 layout 现算，不写死 id）
const anchor2d = (q) => {
  const g = q.geometry || {};
  if (g.position) return [g.position[0], g.position.length > 2 ? g.position[2] : g.position[1]];
  if (g.footprint) { const xs = g.footprint.map(p => p[0]), zs = g.footprint.map(p => p[1]); return [xs.reduce((x, y) => x + y) / xs.length, zs.reduce((x, y) => x + y) / zs.length]; }
  if (g.polyline) { const p = g.polyline[Math.floor(g.polyline.length / 2)]; return [p[0], p[1]]; }
  return null;
};
const UNNAMED_OBJ = layout.objects
  .filter(o => !o.name && o.kind === 'road' && o.zone === 'outer' && (o.geometry?.polyline?.length ?? 0) >= 2)
  .map(o => {
    const p = o.geometry.polyline[Math.floor(o.geometry.polyline.length / 2)];
    const dmin = layout.objects.reduce((s, q) => {
      if (q.id === o.id || !q.name) return s;
      const a = anchor2d(q);
      return a ? Math.min(s, Math.hypot(a[0] - p[0], a[1] - p[1])) : s;
    }, Infinity);
    return { o, d: dmin };
  })
  .sort((a, b) => b.d - a.d)[0];
if (!UNNAMED_OBJ || !(UNNAMED_OBJ.d >= 80)) { console.error(`SETUP 无名外围道路解析失败：${JSON.stringify(UNNAMED_OBJ?.o?.id)} 距最近有名对象 ${UNNAMED_OBJ?.d}m`); process.exit(2); }
const UNNAMED = UNNAMED_OBJ.o.id;

// ---------- 跑测试 ----------
// ONLY=T6,T8 只跑列出的分组（调试 / 最小用例集用；验收与红绿收据一律全量跑，不设 ONLY）
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const run = (t) => !ONLY || ONLY.has(t);
if (ONLY) console.log(`ONLY=${[...ONLY].join(',')}（非全量）`);
let fails = 0;
const fail = (m) => { console.error('FAIL', m); fails++; };
const ok = (m) => console.log('ok  ', m);
const report = { targets: {}, oracle: {} };

const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
async function newPage(qs, viewport = { width: 1400, height: 900 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(BASE + qs, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
  await page.waitForFunction(() => document.querySelectorAll('#labels .lbl').length > 0, null, { timeout: 60000 });
  return page;
}
const page = await newPage('?zone=core&cam=oblique');
const pageU = await newPage('?zone=core&cam=oblique&batch=0');   // T6 对照：改前渲染路径
await installPageOracle(page);
await installPageOracle(pageU);
// R4：一次真实鼠标点击的完整记录：__pickDebug {id,name,node} + 被测实现本次点选的射线（被动记录）+ 卡片来源
const clickFull = async (p, x, y) => {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(30);
  const n0 = await p.evaluate(() => { window.__pickDebug = undefined; return window.__oraLastRay ? window.__oraLastRay.n : 0; });
  await p.mouse.click(x, y);
  await p.waitForTimeout(100);
  return p.evaluate((n0) => {
    const el = document.getElementById('info');
    const open = el.style.display === 'block';
    const dds = open ? [...el.querySelectorAll(':scope > dl > dd')].map(d => d.textContent) : null;
    const d = window.__pickDebug;
    const r = window.__oraLastRay;
    return { id: d ? d.id ?? null : 'no-write', name: d ? d.name ?? null : null, node: d ? d.node ?? null : null, open, src: dds ? dds[dds.length - 1] : null, ray: r && r.n > n0 ? { o: r.o, d: r.d } : null };
  }, n0);
};
const oracleAt = async (p, ray) => (ray ? RAW.expect(await p.evaluate((r) => window.__oraHits(r, 16), ray)) : { error: '没有射线', id: null, module: null, uuid: null, raw: null });
const slim = (r) => (r ? { id: r.id, node: r.node, open: r.open, src: r.src } : r);
const slimO = (o) => (o ? { id: o.id, module: o.module, uuid: o.uuid, raw: o.raw ? `${o.raw.file}#${o.raw.node} ${o.raw.name}` : null, rawPath: o.raw ? o.raw.path : null, ambiguous: o.raw ? o.raw.ambiguous : null, firstHidden: o.firstHidden, error: o.error } : o);

const aim = (p) => page.evaluate(([e, t]) => window.__viewAt(e, t), [p.eye, p.target]);
const readCard = () => page.evaluate(() => {
  const el = document.getElementById('info');
  if (el.style.display !== 'block') return { open: false };
  return {
    open: true,
    name: el.querySelector(':scope > h2')?.textContent ?? null,
    dts: [...el.querySelectorAll(':scope > dl > dt')].map(d => d.textContent),
    dds: [...el.querySelectorAll(':scope > dl > dd')].map(d => d.textContent),
    note: el.querySelector(':scope > p.infocard-note')?.textContent ?? null,
    childTags: [...el.children].map(c => c.tagName + (c.className ? '.' + c.className : '')),
    text: el.textContent,
    rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
    activeLabels: [...document.querySelectorAll('#labels .lbl.lbl-card-active')].map(n => n.dataset.labelText),
  };
});
const pickDebug = () => page.evaluate(() => (window.__pickDebug === undefined ? 'undefined' : { id: window.__pickDebug.id ?? null, name: window.__pickDebug.name ?? null }));

// ---------- T1 + T2 逐对象点击并核对（默认 8 目标 + 反例仪门戏楼） ----------
for (const t of (run('T1') ? TARGETS : [])) {
  const o = t.o;
  const cp = clickPoint(o);
  if (!cp) { fail(`T1 ${t.nm} 无可算点击锚点`); report.targets[o.id] = { name: t.nm, ok: false, failCount: 1, error: 'no-anchor' }; continue; }
  await aim(cp);
  await page.waitForTimeout(100);
  const clk = await clickFull(page, 700, 450);
  const got = await readCard();
  const want = expectedCard(t);
  // R4：模型来源期望 = 本次点击射线的独立 oracle 命中节点 → raw GLB 父链最近 extras.module（所有目标一律精确相等）
  const ora = await oracleAt(page, clk.ray);
  want.dds[5] = ora.module ? `套件：${ora.module}` : '程序化体块';
  report.targets[o.id] = { name: t.nm, want, got, pick: slim(clk), oracle: slimO(ora) };
  report.oracle[o.id] = GLB_ORA[o.id] || null;
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `infocard-${o.id}.png`) });
  if (!got.open) { fail(`T1 ${t.nm} 点击后卡片未弹出`); report.targets[o.id].ok = false; report.targets[o.id].failCount = 1; continue; }   // R3 可选2：未弹卡也写 ok:false/failCount
  const bad = [];
  if (got.name !== want.name) bad.push(`名称 ${JSON.stringify(got.name)} != ${JSON.stringify(want.name)}`);
  if (JSON.stringify(got.dts) !== JSON.stringify(want.dts)) bad.push(`dt ${JSON.stringify(got.dts)} != ${JSON.stringify(want.dts)}`);
  for (let i = 0; i < 6; i++) {
    if (i === 2 && got.open) {   // 模型高度：数值容差 ≤0.1 m（卡片 1 位小数 vs GLB oracle）
      const hv = parseFloat(String(got.dds?.[2] ?? '').replace(' m', ''));
      const wv = parseFloat(want.dds[2]);
      if (!Number.isFinite(hv) || !Number.isFinite(wv) || Math.abs(hv - wv) > 0.1) bad.push(`模型高度 ${got.dds?.[2]} != ${want.dds[2]}(±0.1)`);
      continue;
    }
    if (i === 5) {   // 模型来源：R4 = 独立射线命中节点 raw 父链 module，精确相等（不再按 id 取集合）
      if (ora.error) { bad.push(`模型来源 oracle 错误：${ora.error}`); continue; }
      if (ora.id !== o.id) { bad.push(`独立射线首个可见命中是 ${JSON.stringify(ora.id)} 不是目标 ${o.id}（点击点前置失败）`); continue; }
      if (clk.node !== ora.uuid) bad.push(`实际命中节点 ${clk.node} != oracle 命中网格 ${ora.uuid}`);
      if (got.dds?.[5] !== want.dds[5]) bad.push(`模型来源 ${JSON.stringify(got.dds?.[5])} != 命中父链精确 ${JSON.stringify(want.dds[5])}（raw ${ora.raw.file}#${ora.raw.node} ${ora.raw.name}）`);
      continue;
    }
    if (got.dds?.[i] !== want.dds[i]) bad.push(`${want.dts[i]} ${JSON.stringify(got.dds?.[i])} != ${JSON.stringify(want.dds[i])}`);
  }
  if (got.note !== want.note) bad.push(`固定说明 ${JSON.stringify(got.note)}`);
  const tags = (got.childTags || []).join(',');
  if (tags !== 'H2,DL,P.infocard-note') bad.push(`白名单外元素 ${tags}`);
  const joined = want.name + want.dts.flatMap((d, i) => [d, i === 2 ? got.dds[i] : want.dds[i]]).join('') + want.note;   // 高度按容差另判，文本比对取实值
  if (got.text !== joined) bad.push(`白名单外文本 ${JSON.stringify(got.text.slice(0, 160))}`);
  report.targets[o.id].ok = bad.length === 0;   // 必修6：逐对象 ok 由该对象断言失败数决定
  report.targets[o.id].failCount = bad.length;
  if (bad.length) fail(`T1/T2 ${t.nm}：${bad.join('；')}`);
  else ok(`T1/T2 ${t.nm}：名称 + 6 字段（高度 GLB oracle ±0.1）+ 固定说明逐项一致`);
}

// ---------- T4 Esc 关卡（先断言已打开）+ 高亮清除 ----------
if (run('T4')) {
  const san = TARGETS[0].o;
  await aim(clickPoint(san));
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  let got = await readCard();
  if (!got.open) fail('T4 前置失败：点三穗堂后卡片未打开');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  got = await readCard();
  if (got.open) fail('T4 Esc 后卡片未关闭');
  else ok('T4 Esc 关闭卡片（关闭前确认过已打开）');
  const hl = await page.evaluate(() => document.querySelectorAll('#labels .lbl.lbl-card-active').length);
  if (hl) fail(`T4 Esc 后标签高亮未清除（${hl} 个）`);
  else ok('T4 Esc 后标签高亮清除');
}

// ---------- T3 无名对象 / 空白点击（__pickDebug 契约） ----------
if (run('T3')) {
  const cp = clickPoint(objs.get(UNNAMED));
  await aim(cp);
  await page.waitForTimeout(100);
  const clk3 = await clickFull(page, 700, 450);
  let got = await readCard();
  if (got.open) fail(`T3 无名对象 ${UNNAMED} 弹了卡：${JSON.stringify(got.name)}`);
  else ok('T3 无名对象不弹卡');
  const dbg = await pickDebug();
  if (dbg === 'undefined') fail('T3 __pickDebug 未定义（身份契约缺失）');
  else if (!dbg.id || dbg.name !== null) fail(`T3 无名对象 __pickDebug 应为 { id 非空, name:null }：${JSON.stringify(dbg)}`);
  else ok(`T3 无名对象 __pickDebug = { id:${dbg.id}, name:null }`);
  // R4（合并 streetfix 后道路无名点复核）：被测拾取 id / 命中节点 = 独立射线 raw GLB 期望，且该 id 在 layout 里无名
  {
    const o3 = await oracleAt(page, clk3.ray);
    report.T3 = { unnamedTarget: UNNAMED, pick: slim(clk3), oracle: slimO(o3) };
    const b3 = [];
    if (o3.error) b3.push(`oracle 错误：${o3.error}`);
    else {
      if (clk3.id !== o3.id) b3.push(`被测 id ${JSON.stringify(clk3.id)} != 独立射线 raw GLB 期望 ${JSON.stringify(o3.id)}`);
      if (clk3.node !== o3.uuid) b3.push(`实际命中节点 ${clk3.node} != oracle ${o3.uuid}`);
      const lo = o3.id ? objs.get(o3.id) : null;
      if (!o3.id) b3.push('独立射线在无名道路点没有命中任何有 id 的网格');
      else if (lo && lo.name) b3.push(`独立射线命中的 ${o3.id} 在 layout 里有名（${lo.name}），不是无名点`);
    }
    if (b3.length) fail(`T3 无名道路点身份：${b3.join('；')}`);
    else ok(`T3 无名道路点：被测拾取 = 独立射线 raw GLB 期望 ${o3.id}（${o3.raw.file}#${o3.raw.node} ${o3.raw.name}）${o3.id === UNNAMED ? '' : `（≠ 选定道路 ${UNNAMED}，同为无名）`}`);
  }
  // 空白：先开卡再点空白（必修：关闭测试先断言卡片已打开）
  const san = TARGETS[0].o;
  await aim(clickPoint(san));
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  got = await readCard();
  if (!got.open) fail('T3 前置失败：空白测试前卡片未打开');
  // 实点找真空白：先把机位调成地平线视角（上半画面为天空），再逐候选真实点击直到 __pickDebug.id === null
  const sanG = TARGETS[0].o.geometry.footprint;
  const sx0 = sanG.reduce((a, p) => a + p[0], 0) / sanG.length, sz0 = sanG.reduce((a, p) => a + p[1], 0) / sanG.length;
  await page.evaluate(([e, t]) => window.__viewAt(e, t), [[sx0, 25, sz0], [sx0, 2, sz0 - 600]]);
  await page.waitForTimeout(120);
  const SKY_CANDIDATES = [[700, 140], [500, 120], [900, 120], [300, 160], [1100, 140], [700, 90]];
  let skyHit = null;
  for (const [sx, sy] of SKY_CANDIDATES) {
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(70);
    const d = await pickDebug();
    if (d !== 'undefined' && d.id === null) { skyHit = [sx, sy]; break; }
  }
  if (!skyHit) fail(`T3 候选点里没找到空白（全部命中对象）：${JSON.stringify(SKY_CANDIDATES)}`);
  got = await readCard();
  if (got.open) fail(`T3 点空白（${skyHit}）后卡片仍在`);
  else ok(`T3 点空白（${skyHit}）关闭卡片（关闭前确认过已打开）`);
  const dbg2 = await pickDebug();
  if (dbg2 !== 'undefined' && (dbg2.id !== null || dbg2.name !== null)) fail(`T3 空白点击 __pickDebug 应为 { id:null, name:null }：${JSON.stringify(dbg2)}`);
  else ok('T3 空白点击 __pickDebug = { id:null, name:null }');
}

// ---------- T5 步行模式（先开卡；切步行立即关卡清高亮；退回轨道恢复弹卡） ----------
if (run('T5')) {
  const hb = TARGETS[5].o;   // 华宝楼
  const cp = clickPoint(hb);
  await aim(cp);
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  let got = await readCard();
  if (!got.open) fail('T5 前置失败：步行测试前卡片未打开');
  else ok('T5 步行测试前置：卡片已打开');
  await page.evaluate(() => window.__walk.enter());
  await page.waitForFunction(() => window.__walk.status().mode === 'walk' && window.__walk.status().physicsReady, null, { timeout: 300000 });
  const closed = await readCard();
  if (closed.open) fail('T5 切入步行模式后已开卡片未立即关闭');
  else ok('T5 切入步行模式：卡片立即关闭');
  const hl = await page.evaluate(() => document.querySelectorAll('#labels .lbl.lbl-card-active').length);
  if (hl) fail(`T5 切步行后标签高亮未清除（${hl} 个）`);
  else ok('T5 切步行后标签高亮清除');
  await aim(cp);
  await page.waitForTimeout(150);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(120);
  got = await readCard();
  if (got.open) fail('T5 步行模式点击对象弹了卡');
  else ok('T5 步行模式不弹卡');
  await page.evaluate(() => window.__walk.exit());
  await page.waitForFunction(() => window.__walk.status().mode === 'orbit', null, { timeout: 60000 });
  await aim(cp);
  await page.waitForTimeout(150);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(120);
  got = await readCard();
  if (!got.open || got.name !== '华宝楼') fail(`T5 退回轨道后未恢复弹卡：${JSON.stringify(got)}`);
  else ok('T5 退回轨道后恢复弹卡（华宝楼）');
  // R3 可选1：spawnAt() 走 walk.js 内部 setMode（pb:mode 统一通知），不再依赖 __walk.enter 包装 —— 卡片也必须立即关
  await page.evaluate(() => window.__walk.spawnAt('main'));
  const closedSpawn = await readCard();
  if (closedSpawn.open) fail(`T5 spawnAt() 进入步行后已开卡片未立即关闭：${JSON.stringify(closedSpawn.name)}`);
  else ok('T5 spawnAt()（内部 setMode）进入步行：卡片立即关闭');
  await page.waitForFunction(() => window.__walk.status().mode === 'walk', null, { timeout: 300000 });
  await page.evaluate(() => window.__walk.exit());
  await page.waitForFunction(() => window.__walk.status().mode === 'orbit', null, { timeout: 60000 });
}

// ---------- T6 隐藏几何不抢点击 ----------
// R3（REVIEW-astra-R2 必修2）：在原 A/B 对照之外，加「确定期望 ID」的用例：
//   T6b 前景对象自身 visible=false → 必须命中后景 id（≠前景）；
//   T6c 前景父节点 visible=false → 同上；
//   T6d 浏览器里实际点击「屋顶」按钮（正式按钮，规则在 web/roofs.js），再点选：
//       命中 id 的网格必须与测试独立从场景里筛出的「隐藏 id 集合」无交集（父链全部可见）。
if (run('T6')) {
  const pts = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) pts.push([Math.round(170 + i * 212), Math.round(230 + j * 200)]);
  const bothReset = async () => {
    await Promise.all([page, pageU].map(p => p.evaluate(() => window.__goto('core', 'oblique'))));
    await page.waitForTimeout(400);
    await pageU.waitForTimeout(400);
  };
  const hideRoofs = (p, v) => p.evaluate((v) => {
    let n = 0;
    window.__scene.traverse(o => { if (!o.isBatchedMesh && /roof/i.test(o.name)) { o.visible = v; n++; } });
    window.__batchSync?.();
    return n;
  }, v);
  const pickGrid = (p) => p.evaluate(async (pts) => {
    const out = [];
    for (const [x, y] of pts) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));   // R3：每点前清卡，防卡片盖住后续样本
      await new Promise(r => setTimeout(r, 30));
      window.__pickDebug = undefined;
      const n0 = window.__oraLastRay ? window.__oraLastRay.n : 0;
      const el = document.elementFromPoint(x, y);
      const target = el && (el.closest('canvas') || el);
      if (target && target.dispatchEvent) {
        target.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 60));
      const r = window.__oraLastRay;
      out.push(window.__pickDebug ? { id: window.__pickDebug.id ?? null, name: window.__pickDebug.name ?? null, node: window.__pickDebug.node ?? null, ray: r && r.n > n0 ? { o: r.o, d: r.d } : null } : { id: 'no-write', node: null, ray: null });
    }
    return out;
  }, pts);

  // ---- T6a 关屋顶（按名隐藏）后与 batch=0 逐点一致（原有对照，保留）----
  await bothReset();
  const nRoofA = await hideRoofs(page, false);
  const nRoofU = await hideRoofs(pageU, false);
  if (nRoofA !== nRoofU || nRoofA === 0) fail(`T6 关屋顶隐藏的屋面网格数 ${nRoofA} vs ${nRoofU}（须 >0 才有意义）`);
  else ok(`T6 两侧各隐藏 ${nRoofA} 个屋面网格`);
  await page.waitForTimeout(200);
  await pageU.waitForTimeout(200);
  const [pb, pu] = await Promise.all([pickGrid(page), pickGrid(pageU)]);
  report.T6 = { points: pts, batched: pb.map(slim), unbatched: pu.map(slim) };
  const noPick = pb.filter(v => v.id === 'no-write').length;
  if (noPick) fail(`T6 ${noPick} 个点没有写入 __pickDebug（每次拾取都必须写）`);
  const diff = pts.map((p, i) => [p, pb[i]?.id, pu[i]?.id]).filter(r => r[1] !== r[2]);
  const nulls = pb.filter(v => v && v.id === null).length;
  if (diff.length) fail(`T6 关屋顶后与 batch=0 点选不一致：${JSON.stringify(diff)}`);
  else ok(`T6 关屋顶后 20→15 点选与 batch=0 逐点一致（含 ${nulls} 个空白点）`);
  await hideRoofs(page, true);
  await hideRoofs(pageU, true);

  // ---- T6b/T6c 确定期望 ID（R4 按 REVIEW-astra-R3 必修1 重写）----
  // 期望值独立确定：被测实现点击时算出的同一条射线（Raycaster.setFromCamera 被动记录）→ 测试自己的
  // THREE.Raycaster 求命中 → 第一个父链全部可见的命中三角形按世界坐标对回 raw GLB 节点 → raw 父链 layout id。
  // 被测拾取（__pickDebug.id）与之精确相等；命中节点（__pickDebug.node）与 oracle 命中网格是同一个对象。
  // 仅「≠前景 / 两次一致」不再算通过（REVIEW-astra-R3：把后景换成 ground 旧断言照样过）。
  const CAND = [[700, 450], [500, 300], [900, 600], [400, 520], [1000, 350]];
  const hideById = (how, fgId) => page.evaluate(({ how, fgId }) => {
    const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
    window.__t6hidden = [];
    let n = 0;
    if (how === 'self') {
      window.__scene.traverse(o => { if (o.isMesh && o.visible && idOf(o) === fgId) { o.visible = false; n++; window.__t6hidden.push(o); } });
    } else {
      // 「父节点隐藏」：从网格向上找最小的「子树覆盖全部前景网格」的祖先再藏它
      const meshes = [];
      window.__scene.traverse(o => { if (o.isMesh && idOf(o) === fgId) meshes.push(o); });
      const isAnc = (a, m) => { for (let x = m; x; x = x.parent) if (x === a) return true; return false; };
      let cand = null;
      for (let a = meshes[0] && meshes[0].parent; a && a !== window.__scene; a = a.parent) {
        if (meshes.every(m => isAnc(a, m))) { cand = a; break; }
      }
      if (!cand && meshes[0]) cand = meshes[0].parent;
      if (cand && cand.visible) { cand.visible = false; n = 1; window.__t6hidden.push(cand); }
    }
    window.__batchSync?.();
    return n;
  }, { how, fgId });
  const showHidden = () => page.evaluate(() => {
    for (const o of window.__t6hidden || []) o.visible = true;
    window.__t6hidden = [];
    window.__batchSync?.();
  });
  await bothReset();
  let fgId = null, fx = 0, fy = 0;
  for (const [cx, cy] of CAND) {
    const d = await clickFull(page, cx, cy);
    if (d.id && d.id !== 'no-write') { fgId = d.id; fx = cx; fy = cy; break; }
  }
  if (!fgId) fail('T6b 找不到前景对象（候选点全部空白）');
  else {
    report.T6bc = { fgId, at: [fx, fy] };
    for (const [tag, how] of [['T6b', 'self'], ['T6c', 'parent']]) {
      const bads = [];
      const rec = { how, fgId };
      try {
        const n1 = await hideById(how, fgId);
        const r1 = await clickFull(page, fx, fy);
        const o1 = await oracleAt(page, r1.ray);
        await showHidden();
        await page.waitForTimeout(150);
        const r0 = await clickFull(page, fx, fy);        // 恢复态：oracle 与实现都应回到前景
        const o0 = await oracleAt(page, r0.ray);
        await hideById(how, fgId);                       // 同样隐藏态复测
        const r2 = await clickFull(page, fx, fy);
        const o2 = await oracleAt(page, r2.ray);
        await showHidden();
        await page.waitForTimeout(150);
        Object.assign(rec, { hidden: n1, r1: slim(r1), o1: slimO(o1), r0: slim(r0), o0: slimO(o0), r2: slim(r2), o2: slimO(o2) });
        if (!n1) bads.push('没有隐藏到任何网格/节点');
        for (const [lbl, r, o] of [['隐藏态1', r1, o1], ['恢复态', r0, o0], ['隐藏态2', r2, o2]]) {
          if (!r.ray) { bads.push(`${lbl} 没记录到被测实现的射线`); continue; }
          if (r.id === 'no-write') { bads.push(`${lbl} 拾取没写 __pickDebug`); continue; }
          if (o.error) { bads.push(`${lbl} oracle 错误：${o.error}`); continue; }
          if (r.id !== o.id) bads.push(`${lbl} 被测拾取 ${JSON.stringify(r.id)} != 独立射线 raw GLB 期望 ${JSON.stringify(o.id)}（${o.raw ? o.raw.file + '#' + o.raw.node + ' ' + o.raw.name : '无命中'}）`);
          if (r.node !== o.uuid) bads.push(`${lbl} 实际命中节点 ${r.node} != oracle 命中网格 ${o.uuid}`);
        }
        if (!o1.error && !o0.error) {
          if (o1.id === null) bads.push('隐藏前景后 oracle 无后景命中（该像素无可验证后景，换候选点）');
          if (o1.id === fgId) bads.push(`隐藏后 oracle 仍命中前景 ${fgId}（隐藏没盖住，前置失败）`);
          if (o0.id !== fgId) bads.push(`恢复态 oracle 期望 ${o0.id} != 前景 ${fgId}（前置失败）`);
        }
        if (bads.length) fail(`${tag} 前景${how === 'self' ? '自身' : '父节点'}隐藏：${bads.join('；')}`);
        else ok(`${tag} 前景${how === 'self' ? '自身' : '父节点'}隐藏（${n1} 项）：被测拾取 = 独立射线 raw GLB 期望 ${o1.id}（${o1.raw.file}#${o1.raw.node} ${o1.raw.name}），命中节点同一；恢复态 = 前景 ${fgId}；复测一致`);
      } catch (e) { fail(`${tag} 异常中断：${e.message.split('\n')[0]}`); await showHidden().catch(() => {}); }
      report.T6bc[tag] = rec;
    }
  }

  // ---- T6d 实点「屋顶」按钮后点选：比较实际命中节点身份，不只比 layout id（R4 必修1）----
  // 对每个样本点：被测实现 __pickDebug.node（three uuid）必须 === oracle 第一个父链全部可见的命中网格，
  // 其父链全部可见，且两者对回 raw GLB 是同一节点（file#node）；batch=0 页对回的 raw 节点也相同。
  // 同 id 反例覆盖：统计「射线上先有隐藏的同 id 网格（屋面）、后有可见网格」的点，另加 3 个厅殿顶视专点，须 ≥1——
  // 只比 id 的旧 T6d 在这些点上无法区分「命中隐藏屋顶」与「命中可见墙身」。
  await bothReset();
  await page.keyboard.press('Escape');
  await pageU.keyboard.press('Escape');
  // 真实鼠标点正式按钮中心（先确认中心点命中按钮本身）。不用 page.click：两页同时 swiftshader 渲染时
  // playwright 的滚动/稳定性等帧会拖到超时（R3 红2 就是在这里中断的）。
  const realClickBtn = async (p, sel) => {
    const c = await p.evaluate((sel) => { const b = document.querySelector(sel); const r = b.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; return { x, y, hitSelf: document.elementFromPoint(x, y) === b, active: b.classList.contains('active') }; }, sel);
    if (!c.hitSelf) throw new Error(`${sel} 按钮中心被其它元素遮挡`);
    await p.mouse.click(c.x, c.y);
    await p.waitForFunction(([sel, a]) => document.querySelector(sel).classList.contains('active') !== a, [sel, c.active], { timeout: 60000 });
  };
  try {
    await realClickBtn(page, '#t-roofs');
    await realClickBtn(pageU, '#t-roofs');
    await page.waitForTimeout(300);
    await pageU.waitForTimeout(300);
    const hiddenRoofMeshes = await page.evaluate(() => { let n = 0; window.__scene.traverse(o => { if (o.isMesh && !o.isBatchedMesh) { for (let x = o; x; x = x.parent) if (x.visible === false) { n++; break; } } }); return n; });
    const [rb, ru] = [await pickGrid(page), await pickGrid(pageU)];
    const rows = [];
    const badsD = [];
    let sameIdCases = 0;
    const checkPoint = async (p, r, tagPt) => {
      const o = await oracleAt(p, r.ray);
      const row = { at: tagPt, impl: slim(r), oracle: slimO(o) };
      const b = [];
      if (!r.ray) b.push('没记录到被测实现的射线');
      else if (o.error) b.push(`oracle 错误：${o.error}`);
      else {
        if ((r.id ?? null) !== o.id) b.push(`id ${JSON.stringify(r.id)} != oracle ${JSON.stringify(o.id)}`);
        if ((r.node ?? null) !== o.uuid) {
          const nh = r.node ? await p.evaluate(([ray, u]) => window.__oraNodeHit(ray, u), [r.ray, r.node]) : null;
          const rm = nh && nh.hit && nh.hit.tri ? RAW.matchTriangle(nh.hit.tri, nh.hit.point) : null;
          row.implNode = nh ? { visibleChain: nh.visibleChain, roof: nh.roof, raw: rm ? `${rm.file}#${rm.node} ${rm.name}` : null } : null;
          b.push(`实际命中节点 ${r.node}${nh ? `（父链${nh.visibleChain ? '可见' : '含隐藏'}${nh.roof ? '，屋面' : ''}，raw ${row.implNode.raw}）` : ''} != oracle 可见命中 ${o.uuid}（raw ${o.raw ? o.raw.file + '#' + o.raw.node + ' ' + o.raw.name : '—'}）`);
        } else if (r.node) {
          const nh = await p.evaluate(([ray, u]) => window.__oraNodeHit(ray, u), [r.ray, r.node]);
          if (!nh.found || !nh.visibleChain) b.push(`实际命中节点 ${r.node} 父链含隐藏节点`);
        }
        if (o.firstHidden && o.id && o.firstHidden.id === o.id) { row.sameIdHiddenInFront = o.firstHidden; }
      }
      row.bads = b;
      return row;
    };
    for (let i = 0; i < pts.length; i++) {
      const a = await checkPoint(page, rb[i], pts[i]);
      const u = await checkPoint(pageU, ru[i], pts[i]);
      if (a.sameIdHiddenInFront) sameIdCases++;
      const rawA = a.oracle.raw, rawU = u.oracle.raw;
      if ((rawA || null) !== (rawU || null)) a.bads.push(`batch=0 页 oracle 节点不同：${rawA} vs ${rawU}`);
      if (a.bads.length) badsD.push(`${JSON.stringify(pts[i])} ${a.bads.join('，')}`);
      if (u.bads.length) badsD.push(`${JSON.stringify(pts[i])}(batch=0) ${u.bads.join('，')}`);
      rows.push({ batched: a, unbatched: u });
    }
    // 厅殿顶视专点（只在合批页，屋顶仍关）：射线必先穿过隐藏的同 id 屋面
    const special = [];
    for (const nm of ['三穗堂', '仰山堂', '大殿']) {
      const t = TARGETS.find(x => x.nm === nm);
      const [mx, , mz] = clickPoint(t.o).target;   // 与 T1 同一锚点（footprint 质心 / GLB 网格质心）
      await page.evaluate(([e, tt]) => window.__viewAt(e, tt), [[mx + 0.5, 60, mz + 0.5], [mx, 0, mz]]);
      await page.waitForTimeout(400);
      const r = await clickFull(page, 700, 450);
      const row = await checkPoint(page, r, nm);
      if (row.sameIdHiddenInFront) sameIdCases++;
      if (row.bads.length) badsD.push(`${nm} 顶视 ${row.bads.join('，')}`);
      special.push(row);
    }
    report.T6d = { hiddenMeshes: hiddenRoofMeshes, rows, special, sameIdCases };
    if (!hiddenRoofMeshes) badsD.push('屋顶按钮没有隐藏任何网格');
    if (sameIdCases < 1) badsD.push('没有任何样本点出现「隐藏同 id 网格在前、可见网格在后」——同 id 反例未覆盖，T6d 区分不了隐藏屋顶与墙身');
    if (badsD.length) fail(`T6d 屋顶按钮点选：${badsD.slice(0, 6).join('；')}${badsD.length > 6 ? `（共 ${badsD.length} 条）` : ''}`);
    else ok(`T6d 实点「屋顶」按钮（隐藏 ${hiddenRoofMeshes} 个网格）后 15 点×2 页 + 3 厅殿顶视：实际命中节点 = 独立射线第一个可见命中（raw GLB 同一节点、父链全部可见），两页一致；同 id 隐藏在前的反例点 ${sameIdCases} 个`);
  } catch (e) { fail(`T6d 异常中断：${e.message.split('\n')[0]}`); }
  await page.keyboard.press('Escape');
  await pageU.keyboard.press('Escape');
  for (const p of [page, pageU]) {   // 恢复屋顶（只在当前为关时再点一次）
    const off = await p.evaluate(() => !document.getElementById('t-roofs').classList.contains('active'));
    if (off) await realClickBtn(p, '#t-roofs').catch(e => fail(`T6d 恢复屋顶失败：${e.message.split('\n')[0]}`));
  }
  await page.waitForTimeout(200);
}

// ---------- T8 九曲桥来源按命中父链（R4 按 REVIEW-astra-R3 必修2 重写）----------
// oracle：被测实现同一条射线 → 测试独立 Raycaster 第一个可见命中 → 对回 raw GLB 节点 → raw 父链最近 extras.module，
// 卡片来源与之精确相等（有 module →「套件：<module>」，无 →「程序化体块」）。
//   T8a 默认状态折线顶视点：精确相等；
//   T8b 默认状态 bridge-head 可达性扫描（只算射线不点击）：找到可达像素就真实点击断言；找不到如实记为限制（不算失败）；
//   T8c 受控构造（只动内存场景，不改产物）：把 bridge-head 构件组整体抬高（必要时平移），使同一 layout id 下两个
//       module 同时可见、顶视分别首中；两处各真实点击一次，来源必须各自等于命中父链的 module。
//       变异「返回该 id 当前可见的最高 module」：默认状态 T8b 的 bridge-head 点被判成 garden-kit，
//       受控状态 garden-kit 点被判成（抬高后最高的）bridge-head → 两处都失败。
if (run('T8')) {
  const bridge = layout.objects.find(o => o.kind === 'zigzagBridge' && o.name === '九曲桥');
  const poly = bridge.geometry.polyline;
  const srcOf = (o) => (o.module ? `套件：${o.module}` : '程序化体块');
  const topDown = async (x, z) => {
    await page.evaluate(([e, t]) => window.__viewAt(e, t), [[x, 40, z + 0.3], [x, 0.5, z]]);
    await page.waitForTimeout(250);
  };
  const judge = (tag, r, o, wantModule) => {
    const b = [];
    if (!r.ray) b.push('没记录到被测实现的射线');
    else if (o.error) b.push(`oracle 错误：${o.error}`);
    else {
      if (o.id !== bridge.id) b.push(`oracle 命中 ${JSON.stringify(o.id)} 不是九曲桥（前置失败）`);
      if (wantModule !== undefined && o.module !== wantModule) b.push(`oracle 命中 module ${JSON.stringify(o.module)} 不是本点预期构件 ${wantModule}（前置失败）`);
      if (r.id !== o.id) b.push(`被测 id ${JSON.stringify(r.id)} != ${o.id}`);
      if (r.node !== o.uuid) b.push(`实际命中节点 ${r.node} != oracle ${o.uuid}`);
      if (r.src !== srcOf(o)) b.push(`来源 ${JSON.stringify(r.src)} != 命中父链精确 ${JSON.stringify(srcOf(o))}（raw ${o.raw.file}#${o.raw.node} ${o.raw.path}）`);
    }
    if (b.length) fail(`${tag}：${b.join('；')}`);
    else ok(`${tag}：来源 ${r.src} = raw GLB 命中节点 ${o.raw.file}#${o.raw.node}「${o.raw.name}」父链最近 module，精确相等`);
    return b.length === 0;
  };
  report.T8 = {};
  // T8a 默认状态
  try {
    const seg = Math.floor(poly.length / 2);
    const [px, pz] = poly[seg];
    const [qx, qz] = poly[(seg + 1) % poly.length];
    const dl = Math.hypot(qx - px, qz - pz) || 1;
    const nx = -(qz - pz) / dl, nz = (qx - px) / dl;
    await topDown(px + nx * 0.4, pz + nz * 0.4);
    const r = await clickFull(page, 700, 450);
    const o = await oracleAt(page, r.ray);
    report.T8.a = { impl: slim(r), oracle: slimO(o) };
    judge('T8a 默认状态折线顶视点', r, o);
  } catch (e) { fail(`T8a 异常中断：${e.message.split('\n')[0]}`); }

  // T8b 默认状态 bridge-head 可达性扫描（射线，不点击）
  try {
    const bh = [];   // bridge-head 在 raw GLB 的世界包围盒中心（按 module 过滤 raw 三角形索引）
    for (const P of RAW.prims) { const c = RAW.chain(P.file, P.node); if (c.id === bridge.id && c.module === 'bridge-head') bh.push(P); }
    const ctrs = bh.map(P => [(P.min[0] + P.max[0]) / 2, (P.min[1] + P.max[1]) / 2, (P.min[2] + P.max[2]) / 2]);
    const ends = [poly[0], poly[poly.length - 1], [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2], [(poly.at(-1)[0] + poly.at(-2)[0]) / 2, (poly.at(-1)[1] + poly.at(-2)[1]) / 2]];
    const cams = [];
    for (const [ex, ez] of [...ends, ...ctrs.map(c => [c[0], c[2]])]) {
      cams.push([[ex, 30, ez + 0.3], [ex, 0.3, ez]]);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; cams.push([[ex + Math.cos(a) * 6, 1.2, ez + Math.sin(a) * 6], [ex, 0.3, ez]]); }
    }
    let rays = 0, found = null;
    const tally = {};
    for (const [e, t] of cams) {
      await page.evaluate(([e, t]) => window.__viewAt(e, t), [e, t]);
      await page.waitForTimeout(250);
      const hitsList = await page.evaluate(() => {
        const out = [];
        for (let y = 60; y <= 860; y += 50) for (let x = 60; x <= 1340; x += 64) { const ray = window.__oraPixelRay(x, y); out.push({ x, y, ray, hits: window.__oraHits(ray, 8) }); }
        return out;
      });
      for (const h of hitsList) {
        rays++;
        const o = RAW.expect(h.hits);
        if (o.id === bridge.id) tally[o.module ?? '(none)'] = (tally[o.module ?? '(none)'] || 0) + 1;
        if (!found && o.id === bridge.id && o.module === 'bridge-head') found = { cam: [e, t], x: h.x, y: h.y };
      }
      if (found) break;
    }
    report.T8.b = { bridgeHeadPrims: bh.length, bridgeHeadCenters: ctrs, cams: cams.length, rays, tally, found };
    if (!bh.length) fail('T8b raw GLB 里没有九曲桥 bridge-head 构件（产物变了，前置失败）');
    else if (found) {
      await page.evaluate(([e, t]) => window.__viewAt(e, t), found.cam);
      await page.waitForTimeout(250);
      const r = await clickFull(page, found.x, found.y);
      const o = await oracleAt(page, r.ray);
      report.T8.b.click = { impl: slim(r), oracle: slimO(o) };
      judge(`T8b 默认状态 bridge-head 可达像素 (${found.x},${found.y})`, r, o, 'bridge-head');
    } else {
      report.T8.b.limitation = `默认状态下 ${cams.length} 个机位 × ${rays / cams.length} 像素共 ${rays} 条射线，命中九曲桥的首个可见网格全部是 ${JSON.stringify(tally)}，bridge-head 不可达（被 garden-kit 桥面/栏杆包住）；由 T8c 受控用例验证父链取 module`;
      ok(`T8b 限制（不算失败）：${report.T8.b.limitation}`);
    }
  } catch (e) { fail(`T8b 异常中断：${e.message.split('\n')[0]}`); }

  // T8c 受控构造（只动内存场景，不改产物）：把 bridge-head 构件组整体抬高并可选平移，使它与 garden-kit 同时可见、
  // 顶视各自首中；同一 layout id 下两个 module 各真实点击一次。没有隐藏任何网格。
  // 变异「返回该 id 当前可见的最高 module」：抬高后 bridge-head 最高，garden-kit 点会被判成 bridge-head → 失败。
  try {
    const OFFS = [[0, 20, 0], [30, 20, 0], [-30, 20, 0], [0, 20, 30], [0, 20, -30], [45, 20, 45], [-45, 20, -45]];
    // bridge-head 探测点：raw GLB 里 bridge-head 朝上、且不与别的节点重合（raw 里 bridge-head 顶面有与 garden-kit
    // 桥面逐顶点重合的三角形，oracle 对这类重合几何判 ambiguous）的三角形中面积最大者的质心（raw 几何现算，不写死坐标）
    let bhTop = null;
    const ups = [];
    for (const P of RAW.prims) {
      const c = RAW.chain(P.file, P.node);
      if (c.id !== bridge.id || c.module !== 'bridge-head') continue;
      for (let t = 0; t + 2 < P.idx.length; t += 3) {
        const v = [0, 1, 2].map(k => [P.wpos[P.idx[t + k] * 3], P.wpos[P.idx[t + k] * 3 + 1], P.wpos[P.idx[t + k] * 3 + 2]]);
        const e1 = v[1].map((x, i) => x - v[0][i]), e2 = v[2].map((x, i) => x - v[0][i]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const a = Math.hypot(...n) / 2;
        if (a > 0.05 && n[1] / (2 * a) > 0.9) ups.push({ a, v });
      }
    }
    ups.sort((x, y) => y.a - x.a);
    let coincident = 0;
    for (const u of ups) {
      const ctr = [0, 1, 2].map(i => (u.v[0][i] + u.v[1][i] + u.v[2][i]) / 3);
      const m = RAW.matchTriangle(u.v, ctr);
      if (!m || m.ambiguous) { coincident++; continue; }
      bhTop = [ctr[0], ctr[2]];
      break;
    }
    report.T8.bhTopCoincidentSkipped = coincident;
    if (!bhTop) throw new Error('raw GLB 里找不到 bridge-head 朝上三角形');
    const setup = await page.evaluate(({ idWanted }) => {
      const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
      const G = [];
      window.__scene.traverse(o => {
        if (o.userData && o.userData.module === 'bridge-head' && idOf(o) === idWanted) {
          let top = true; for (let p = o.parent; p; p = p.parent) if (p.userData && p.userData.module === 'bridge-head' && idOf(p) === idWanted) top = false;
          if (top) G.push(o);
        }
      });
      window.__t8G = G;
      window.__t8G0 = G.map(g => g.position.toArray());
      window.__t8Id = idWanted;
      return { groups: G.map(g => ({ uuid: g.uuid, name: g.name })) };
    }, { idWanted: bridge.id });
    report.T8.c = { groups: setup.groups, bhTop };
    if (!setup.groups.length) throw new Error('场景里找不到九曲桥 bridge-head 构件组');
    const moveBy = (d) => page.evaluate((d) => {
      window.__oraUndo = {};
      for (let i = 0; i < window.__t8G.length; i++) {
        const g = window.__t8G[i];
        const p0 = window.__t8G0[i];
        g.position.set(p0[0], p0[1], p0[2]); g.updateMatrixWorld(true);
        const w0 = g.getWorldPosition(g.position.clone());
        if (d) {
          const wp = w0.clone(); wp.x += d[0]; wp.y += d[1]; wp.z += d[2];
          const lp = g.parent ? g.parent.worldToLocal(wp.clone()) : wp;   // 世界位移换算到父坐标系
          g.position.copy(lp); g.updateMatrixWorld(true);
          const w1 = g.getWorldPosition(g.position.clone());
          window.__oraUndo[g.uuid] = [w1.x - w0.x, w1.y - w0.y, w1.z - w0.z];   // oracle 对 raw GLB 前扣回
        }
      }
      const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
      const modOf = (node) => { for (let n = node; n; n = n.parent) if (n.userData && n.userData.module != null) return String(n.userData.module); return null; };
      const vis = (node) => { for (let n = node; n; n = n.parent) if (n.visible === false) return false; return true; };
      const cnt = {};
      window.__scene.traverse(o => { if (o.isMesh && !o.isBatchedMesh && idOf(o) === window.__t8Id && vis(o)) { const m = modOf(o) ?? '(none)'; cnt[m] = (cnt[m] || 0) + 1; } });
      return { undo: window.__oraUndo, visibleByModule: cnt };
    }, d);
    const seg = Math.floor(poly.length / 2);
    const [px, pz] = poly[seg];
    const [qx, qz] = poly[(seg + 1) % poly.length];
    const dl = Math.hypot(qx - px, qz - pz) || 1;
    const gk = [px - (qz - pz) / dl * 0.4, pz + (qx - px) / dl * 0.4];   // 与 T8a 同一点
    const probe = async (x, z) => {   // 只算射线（不点击）：顶视画面中心的 oracle
      await topDown(x, z);
      return page.evaluate(() => window.__oraHits(window.__oraPixelRay(700, 450), 12)).then(h => RAW.expect(h));
    };
    let chosen = null;
    const tried = [];
    for (const d of OFFS) {
      const st = await moveBy(d);
      const bhPt = [bhTop[0] + d[0], bhTop[1] + d[2]];
      const ob = await probe(...bhPt);
      const og = await probe(...gk);
      tried.push({ d, bh: [ob.id, ob.module, ob.error], gk: [og.id, og.module, og.error] });
      if (ob.id === bridge.id && ob.module === 'bridge-head' && og.id === bridge.id && og.module === 'garden-kit') { chosen = { d, st, gkPt: gk, bhPt }; break; }
    }
    report.T8.c.tried = tried;
    if (!chosen) { await moveBy(null); throw new Error(`候选位移都凑不出「两构件同时可见且分别首中」的受控场景：${JSON.stringify(tried)}`); }
    report.T8.c.setup = chosen;
    const vbm = chosen.st.visibleByModule;
    if (!(vbm['garden-kit'] > 0 && vbm['bridge-head'] > 0)) fail(`T8c 受控场景同 id 两个 module 未同时可见：${JSON.stringify(vbm)}`);
    else ok(`T8c 受控场景：bridge-head 构件组世界位移 ${JSON.stringify(chosen.d)}，同 id 可见网格 ${JSON.stringify(vbm)}（两 module 同时可见，未隐藏任何网格）`);
    await topDown(...chosen.bhPt);
    const rB = await clickFull(page, 700, 450);
    const oB = await oracleAt(page, rB.ray);
    await topDown(...chosen.gkPt);
    const rG = await clickFull(page, 700, 450);
    const oG = await oracleAt(page, rG.ray);
    report.T8.c.bridgeHead = { impl: slim(rB), oracle: slimO(oB) };
    report.T8.c.gardenKit = { impl: slim(rG), oracle: slimO(oG) };
    judge('T8c 受控 bridge-head 点', rB, oB, 'bridge-head');
    judge('T8c 受控 garden-kit 点', rG, oG, 'garden-kit');
    await moveBy(null);   // 还原
    await page.evaluate(() => { window.__oraUndo = {}; });
    await topDown(...gk);
    const rR = await clickFull(page, 700, 450);
    const oR = await oracleAt(page, rR.ray);
    report.T8.c.restored = { impl: slim(rR), oracle: slimO(oR) };
    judge('T8c 还原后默认点', rR, oR, 'garden-kit');
  } catch (e) {
    fail(`T8c 异常中断：${e.message.split('\n')[0]}`);
    await page.evaluate(() => { if (window.__t8G) window.__t8G.forEach((g, i) => { g.position.fromArray(window.__t8G0[i]); g.updateMatrixWorld(true); }); window.__oraUndo = {}; }).catch(() => {});
  }
}
await pageU.close();

// ---------- T7 375px 手机宽度 ----------
if (run('T7')) try {
  const mp = await newPage('?zone=garden&cam=oblique', { width: 375, height: 667 });
  const o = TARGETS[0].o;   // 三穗堂
  const fp = o.geometry.footprint;
  const mx = fp.reduce((s, p) => s + p[0], 0) / fp.length, mz = fp.reduce((s, p) => s + p[1], 0) / fp.length;
  await mp.evaluate(([e, t]) => window.__viewAt(e, t), [[mx + 3, 26, mz + 3], [mx, 1, mz]]);
  await mp.waitForTimeout(120);
  await mp.mouse.click(Math.round(375 / 2), 520);
  await mp.waitForTimeout(100);
  const res = await mp.evaluate(() => {
    const el = document.getElementById('info');
    const r = el.getBoundingClientRect();
    const bar = document.getElementById('bar').getBoundingClientRect();
    const overlap = !(r.right <= bar.left || bar.right <= r.left || r.bottom <= bar.top || bar.bottom <= r.top);
    const buttons = [...document.querySelectorAll('#bar button')].map(b => {
      const c = b.getBoundingClientRect();
      const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
      return { id: b.id || b.textContent, hitSelf: hit === b };
    });
    // wave12-debt D4：工具区不止 button——#bar select（光照下拉 #t-light）同样按中心点 elementFromPoint
    // 验命中（R2 审查可选 1：旧断言只枚举 button，不能宣称覆盖下拉）。
    const selects = [...document.querySelectorAll('#bar select')].map(el => {
      const c = el.getBoundingClientRect();
      const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
      return { id: el.id, value: el.value, hitSelf: hit === el, state: el.dataset.state || null };
    });
    return {
      open: el.style.display === 'block',
      name: el.querySelector(':scope > h2')?.textContent ?? null,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      barRect: { x: +bar.x.toFixed(1), y: +bar.y.toFixed(1), w: +bar.width.toFixed(1), h: +bar.height.toFixed(1) },
      overlapBar: overlap,
      buttons,
      selects,
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
  if (SHOT_DIR) await mp.screenshot({ path: path.join(SHOT_DIR, 'infocard-mobile-375.png') });
  report.mobile = res;
  if (!res.open || res.name !== '三穗堂') fail(`T7 手机宽度未弹三穗堂卡：${JSON.stringify(res)}`);
  else if (res.overlapBar) fail(`T7 卡片与工具区矩形相交：card=${JSON.stringify(res.rect)} bar=${JSON.stringify(res.barRect)}`);
  else ok(`T7 卡片 ${JSON.stringify(res.rect)} 与工具区 ${JSON.stringify(res.barRect)} 不相交`);
  const badBtn = (res.buttons || []).filter(b => !b.hitSelf);
  if (badBtn.length) fail(`T7 ${badBtn.length} 个工具按钮中心 elementFromPoint 未命中按钮本身：${JSON.stringify(badBtn)}`);
  else ok(`T7 ${(res.buttons || []).length} 个工具按钮中心全部命中按钮本身`);
  const badSel = (res.selects || []).filter(x => !x.hitSelf);
  if (badSel.length) fail(`T7 ${badSel.length} 个工具下拉中心 elementFromPoint 未命中自身：${JSON.stringify(badSel)}`);
  else ok(`T7 ${(res.selects || []).length} 个工具下拉（光照）中心全部命中自身`);
  if (res.scrollW > 375) fail(`T7 手机宽度出现横向滚动：scrollWidth=${res.scrollW}`);
  // 实点「步行」，确认模式真的切换（同时验证已开卡片被立即关闭）
  const walkBtn = await mp.$('#w-mode');
  await walkBtn.click();
  await mp.waitForFunction(() => window.__walk.status().mode === 'walk', null, { timeout: 300000 });
  const st = await mp.evaluate(() => window.__walk.status().mode);
  if (st !== 'walk') fail(`T7 实点「步行」后模式未切换：${st}`);
  else ok('T7 实点「步行」：模式已切换为 walk');
  const closed = await mp.evaluate(() => document.getElementById('info').style.display !== 'block');
  if (!closed) fail('T7 实点「步行」后已开卡片未关闭');
  else ok('T7 实点「步行」：卡片立即关闭');
  await mp.evaluate(() => window.__walk.exit());
  // wave12-debt D4：实际切换一次光照档位（day→night）确认下拉真的生效——selectOption 触发 change →
  // lighting.set → __lighting.state().preset 变为 night，且下拉回填 applied 状态（不只是枚举命中）。
  try {
    const before = await mp.evaluate(() => ({ preset: window.__lighting && window.__lighting.state().preset }));
    await mp.selectOption('#t-light', 'night');
    await mp.waitForFunction(() => window.__lighting && window.__lighting.state().preset === 'night', null, { timeout: 120000 });
    const after = await mp.evaluate(() => {
      const sel = document.getElementById('t-light');
      return { preset: window.__lighting.state().preset, selValue: sel.value, selState: sel.dataset.state || null };
    });
    if (after.preset !== 'night') fail(`T7 光照下拉切 night 未生效：${JSON.stringify({ before, after })}`);
    else if (after.selValue !== 'night' || after.selState !== 'applied') fail(`T7 光照下拉状态未回填 applied：${JSON.stringify(after)}`);
    else ok(`T7 光照下拉实切生效：${before.preset || '(none)'} → night，select 回填 applied`);
    await mp.selectOption('#t-light', before.preset && before.preset !== 'night' ? before.preset : 'day');
    await mp.waitForFunction(() => window.__lighting && window.__lighting.state().preset !== 'night', null, { timeout: 120000 });
  } catch (e) { fail(`T7 光照下拉切换异常：${String(e.message).split('\n')[0]}`); }
  await mp.close();
} catch (e) { fail(`T7 异常中断：${e.message.split('\n')[0]}`); }

await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`infocard-test: ${fails} fail`); process.exit(1); }
console.log('infocard-test: all pass');
