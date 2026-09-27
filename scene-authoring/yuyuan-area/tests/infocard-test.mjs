// wave11-infocard R2：点击地标弹信息卡 —— headless 验收（R2 按主控裁定口径 + REVIEW-astra 8 项必修重写）。
// 用法：PORT=5496 OUT_DIR=out-zone node scripts/server.mjs &
//       BASE=http://127.0.0.1:5496/ OUT_DIR=out-zone [SHOT_DIR=<目录>] [REPORT=<json>] node tests/infocard-test.mjs
//
// R2 期望值口径（主控裁定 2026-09-27，一律不许拿产物比产物）：
//   模型高度    运行时该 layout id 全部可见网格的世界包围盒最高点，地面 0 m 起算；oracle 用 Node 独立解析
//               OUT_DIR 的 raw 分区 GLB（节点变换 × POSITION accessor min/max，y<0 截 0），与卡片值差 ≤ 0.1 m；
//   层数       layout storeys → levels，都没有 → 未核实（不从模型猜）；
//   轮廓面积    layout footprint 鞋带面积现算（输入轮廓口径）；
//   模型来源    oracle 从 raw GLB 该 id 节点父链 extras 独立读 module（无静态套件表）。
// 断言：
//   T1 9 个对象（默认 8 + 反例仪门戏楼）真实点击逐个弹卡，6 字段 + 名称逐项核对（高度按 ≤0.1 m 数值容差）；
//   T2 白名单：卡片 DOM 只有 h2 名称 + 6 组 dt/dd + 1 行固定说明，无任何其他文本；
//   T3 无名对象不弹卡，但 __pickDebug 仍写 { id, name:null }；空白点击写 { id:null, name:null }；
//   T4 Esc 关卡（先断言卡片已打开）+ 标签高亮清除；
//   T5 步行模式不弹卡（先断言卡片已打开；切步行时已开卡片立即关闭并清高亮，enter 与 spawnAt 两条路径都测），
//      退回轨道恢复弹卡；
//   T6 隐藏几何不抢点击：T6a 关屋顶后与 ?batch=0 同屏点 __pickDebug.id 逐点一致（保留 A/B 对照）；
//      T6b/T6c 确定期望 ID 用例——前景对象自身 / 父节点 visible=false 后真实点击必须命中后景 id（≠前景）；
//      T6d 浏览器实点「屋顶」按钮（web/roofs.js 规则）后逐点点选，命中 id 与测试独立筛出的隐藏 id 集合无交集；
//   T7 375px 手机宽度：卡片停靠在工具区之外（矩形不相交），每个工具按钮中心 elementFromPoint 命中按钮本身，
//      实点「步行」确认模式真的切换；
//   T8 九曲桥来源按命中构件（R3 必修3）：折线顶视命中桥面/栏杆、受控隐藏后点击命中桥体，
//      两个点的期望值 = raw GLB 命中节点向上最近 extras.module，精确相等（不是集合成员）。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/baibai/pawborough-world/node_modules/');
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
for (const t of TARGETS) {
  const o = t.o;
  const cp = clickPoint(o);
  if (!cp) { fail(`T1 ${t.nm} 无可算点击锚点`); report.targets[o.id] = { name: t.nm, ok: false, failCount: 1, error: 'no-anchor' }; continue; }
  await aim(cp);
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  const got = await readCard();
  const want = expectedCard(t);
  report.targets[o.id] = { name: t.nm, want, got };
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
    if (i === 5) {   // 模型来源：R3 按命中父链精确相等；单模块 id 直接全串比对，多模块 id（九曲桥）由 T8 双构件精确断言兜底
      const v = String(got.dds?.[5] ?? '');
      const m = v.startsWith('套件：') ? v.slice(3) : null;
      if (want.srcModules.length === 1) {
        if (v !== `套件：${want.srcModules[0]}`) bad.push(`模型来源 ${JSON.stringify(v)} != 精确 ${JSON.stringify(`套件：${want.srcModules[0]}`)}`);
      } else if (want.srcModules.length ? !(m && want.srcModules.includes(m)) : v !== '程序化体块') bad.push(`模型来源 ${JSON.stringify(v)} 不在 GLB 集合 ${JSON.stringify(want.srcModules)}`);
      continue;
    }
    if (got.dds?.[i] !== want.dds[i]) bad.push(`${want.dts[i]} ${JSON.stringify(got.dds?.[i])} != ${JSON.stringify(want.dds[i])}`);
  }
  if (got.note !== want.note) bad.push(`固定说明 ${JSON.stringify(got.note)}`);
  const tags = (got.childTags || []).join(',');
  if (tags !== 'H2,DL,P.infocard-note') bad.push(`白名单外元素 ${tags}`);
  const joined = want.name + want.dts.flatMap((d, i) => [d, i === 5 ? got.dds[i] : want.dds[i]]).join('') + want.note;
  if (got.text !== joined) bad.push(`白名单外文本 ${JSON.stringify(got.text.slice(0, 160))}`);
  report.targets[o.id].ok = bad.length === 0;   // 必修6：逐对象 ok 由该对象断言失败数决定
  report.targets[o.id].failCount = bad.length;
  if (bad.length) fail(`T1/T2 ${t.nm}：${bad.join('；')}`);
  else ok(`T1/T2 ${t.nm}：名称 + 6 字段（高度 GLB oracle ±0.1）+ 固定说明逐项一致`);
}

// ---------- T4 Esc 关卡（先断言已打开）+ 高亮清除 ----------
{
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
{
  const cp = clickPoint(objs.get(UNNAMED));
  await aim(cp);
  await page.waitForTimeout(100);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(80);
  let got = await readCard();
  if (got.open) fail(`T3 无名对象 ${UNNAMED} 弹了卡：${JSON.stringify(got.name)}`);
  else ok('T3 无名对象不弹卡');
  const dbg = await pickDebug();
  if (dbg === 'undefined') fail('T3 __pickDebug 未定义（身份契约缺失）');
  else if (!dbg.id || dbg.name !== null) fail(`T3 无名对象 __pickDebug 应为 { id 非空, name:null }：${JSON.stringify(dbg)}`);
  else ok(`T3 无名对象 __pickDebug = { id:${dbg.id}, name:null }`);
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
{
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
{
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
      const el = document.elementFromPoint(x, y);
      const target = el && (el.closest('canvas') || el);
      if (target && target.dispatchEvent) {
        target.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 60));
      out.push(window.__pickDebug ? { id: window.__pickDebug.id ?? null, name: window.__pickDebug.name ?? null } : 'no-pick');
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
  report.T6 = { points: pts, batched: pb, unbatched: pu };
  const noPick = pb.filter(v => v === 'no-pick').length;
  if (noPick) fail(`T6 ${noPick} 个点没有写入 __pickDebug（每次拾取都必须写）`);
  const diff = pts.map((p, i) => [p, pb[i]?.id, pu[i]?.id]).filter(r => r[1] !== r[2]);
  const nulls = pb.filter(v => v && v.id === null).length;
  if (diff.length) fail(`T6 关屋顶后与 batch=0 点选不一致：${JSON.stringify(diff)}`);
  else ok(`T6 关屋顶后 20→15 点选与 batch=0 逐点一致（含 ${nulls} 个空白点）`);
  await hideRoofs(page, true);
  await hideRoofs(pageU, true);

  // ---- T6b/T6c 确定期望 ID：前景（自身 / 父节点）隐藏 → 必须命中后景 id 且 ≠ 前景 ----
  // 流程（全程真实鼠标点击同一屏幕点）：点击得前景 id → 按 id 隐藏（记录被藏对象）→ 同点点击得后景（期望）→
  // 只恢复自己藏的对象并复核点回前景 → 再同样隐藏复测后景一致。期望值由测试独立从场景状态推导。
  const CAND = [[700, 450], [500, 300], [900, 600], [400, 520], [1000, 350]];
  const hideById = (how, fgId) => page.evaluate(({ how, fgId }) => {
    const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
    window.__t6hidden = [];
    let n = 0;
    if (how === 'self') {
      window.__scene.traverse(o => { if (o.isMesh && o.visible && idOf(o) === fgId) { o.visible = false; n++; window.__t6hidden.push(o); } });
    } else {
      // 「父节点隐藏」：从网格向上找最小的「子树覆盖全部前景网格」的祖先再藏它 ——
      // 只藏第一个网格的直接父节点时，同对象的其它网格（别的包装节点）仍可见，前景照样被命中。
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
  const pickAt = async (x, y) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(30);
    await page.evaluate(() => { window.__pickDebug = undefined; });
    await page.mouse.click(x, y);
    await page.waitForTimeout(90);
    return page.evaluate(() => (window.__pickDebug ? window.__pickDebug.id ?? null : 'no-write'));
  };
  await bothReset();
  let fgId = null, fx = 0, fy = 0;
  for (const [cx, cy] of CAND) {
    const d = await pickAt(cx, cy);
    if (d !== 'no-write' && d !== null) { fgId = d; fx = cx; fy = cy; break; }
  }
  if (!fgId) fail('T6b 找不到前景对象（候选点全部空白）');
  else {
    report.T6bc = { fgId, at: [fx, fy] };
    for (const [tag, how] of [['T6b', 'self'], ['T6c', 'parent']]) {
      const n1 = await hideById(how, fgId);
      const bg1 = await pickAt(fx, fy);
      await showHidden();
      await page.waitForTimeout(150);
      const reFg = await pickAt(fx, fy);        // 恢复态复核：点回前景
      await hideById(how, fgId);                // 同样隐藏态复测
      const bg2 = await pickAt(fx, fy);
      await showHidden();
      await page.waitForTimeout(150);
      const bads = [];
      if (!n1) bads.push('没有隐藏到任何网格/节点');
      if ([bg1, bg2, reFg].includes('no-write')) bads.push(`有拾取没写 __pickDebug（bg1=${bg1} bg2=${bg2} reFg=${reFg}）`);
      else {
        if (bg1 === null || bg2 === null) bads.push(`隐藏前景后命中空白（bg1=${bg1} bg2=${bg2}），该像素没有可验证的后景`);
        if (bg1 !== bg2) bads.push(`同样隐藏态两次拾取不一致：${bg1} vs ${bg2}`);
        if (bg1 === fgId) bads.push(`隐藏的前景仍被命中（${fgId}）——visible 过滤失效`);
        if (reFg !== fgId) bads.push(`恢复可见后未点回前景：${reFg} != ${fgId}`);
      }
      report.T6bc[tag] = { how, fgId, hidden: n1, bg1, bg2, reFg };
      if (bads.length) fail(`${tag} 前景${how === 'self' ? '自身' : '父节点'}隐藏：${bads.join('；')}`);
      else ok(`${tag} 前景${how === 'self' ? '自身' : '父节点'}隐藏（${n1} 项）后命中后景 ${bg1}（≠前景 ${fgId}），恢复点回前景，复测一致`);
    }
  }

  // ---- T6d 实点「屋顶」按钮（web/roofs.js 规则）后再点选：命中 id 不得属于隐藏 id 集合 ----
  const idOfIn = `(node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; }`;
  const visIn = `(node) => { for (let n = node; n; n = n.parent) if (n.visible === false) return false; return true; }`;
  await bothReset();
  await page.click('#t-roofs');
  await pageU.click('#t-roofs');
  await page.waitForTimeout(300);
  await pageU.waitForTimeout(300);
  const hiddenIdsOf = (p) => p.evaluate(`(() => { const idOf = ${idOfIn}; const vis = ${visIn}; const H = new Set(); window.__scene.traverse(o => { if (o.isMesh && !vis(o)) { const id = idOf(o); if (id) H.add(id); } }); return [...H]; })()`);
  const hiddenIdsB = await hiddenIdsOf(page);
  const hiddenIdsU = await hiddenIdsOf(pageU);
  const [rb, ru] = await Promise.all([pickGrid(page), pickGrid(pageU)]);
  // 独立 oracle：测试端用 three 自己做射线（visibleChain 过滤 + 第一个有 id 的命中），
  // 与实现的拾取路径无关 —— 两边同时漏掉可见性过滤也会被抓到（REVIEW-astra-R2 必修2）。
  const oraclePicks = (p) => p.evaluate(async (pts) => {
    const THREE = await import('three');
    const cam = window.__cam();
    const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 4000);
    camera.position.set(cam.p[0], cam.p[1], cam.p[2]);
    camera.lookAt(cam.t[0], cam.t[1], cam.t[2]);
    camera.updateMatrixWorld();
    const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p2 = String(n.name || '').split('|'); if (p2.length >= 4) return p2[1]; } return null; };
    const vis = (node) => { for (let n = node; n; n = n.parent) if (n.visible === false) return false; return true; };
    const ray = new THREE.Raycaster();
    ray.layers.enableAll();   // 与 web/main.js 的点选 raycaster 同口径：合批原网格在 ORIGINAL_LAYER，不开就一个都打不中
    const out = [];
    for (const [x, y] of pts) {
      ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
      const hits = ray.intersectObjects(window.__scene.children, true);
      let id = null;
      for (const h of hits) { if (!vis(h.object)) continue; const hid = idOf(h.object); if (!hid) continue; id = hid; break; }
      out.push(id);
    }
    return out;
  }, pts);
  const [ob, ou] = await Promise.all([oraclePicks(page), oraclePicks(pageU)]);
  report.T6d = { hiddenIds: hiddenIdsB, oracleBatched: ob, oracleUnbatched: ou, batched: rb, unbatched: ru };
  const diffD = pts.map((p, i) => [p, rb[i]?.id, ru[i]?.id]).filter(r => r[1] !== r[2]);
  const vsOracle = pts.map((p, i) => [p, rb[i]?.id ?? null, ob[i]]).filter(r => (r[1] ?? null) !== r[2]);
  const badsD = [];
  if (!hiddenIdsB.length) badsD.push('屋顶按钮没有隐藏任何 id 的网格（点不出「隐藏不抢点」）');
  if (hiddenIdsB.length !== hiddenIdsU.length) badsD.push(`两侧隐藏 id 数不同：${hiddenIdsB.length} vs ${hiddenIdsU.length}`);
  if (vsOracle.length) badsD.push(`${vsOracle.length} 个点与测试端独立射线 oracle 不一致：${JSON.stringify(vsOracle.slice(0, 4))}`);
  if (diffD.length) badsD.push(`与 batch=0 不一致：${JSON.stringify(diffD.slice(0, 4))}`);
  if (badsD.length) fail(`T6d 屋顶按钮点选：${badsD.join('；')}`);
  else ok(`T6d 实点「屋顶」按钮（隐藏 ${hiddenIdsB.length} 个 id）后 15 点点选：与测试端独立射线 oracle 逐点一致、与 batch=0 一致`);
  await page.click('#t-roofs');   // 恢复屋顶
  await pageU.click('#t-roofs');
  await page.waitForTimeout(200);
}

// ---------- T8 九曲桥来源按命中构件（必修3）：两点精确相等，不是集合成员 ----------
// 点 1：折线顶视（桥面/栏杆，module=顶面更高的构件）真实点击；
// 点 2：受控隐藏同 id 的 garden-kit 网格（与屋顶开关同一可见性技术）后真实点击，命中 bridge-head 桥体。
// 期望值一律 = raw GLB 里命中网格所在节点向上最近的 extras.module（chainModule），精确相等。
{
  const bridge = layout.objects.find(o => o.kind === 'zigzagBridge' && o.name === '九曲桥');
  const ora = GLB_ORA[bridge.id];
  if (!ora || ora.modules.length !== 2 || !ora.modTop) {
    fail(`T8 raw GLB 里九曲桥应有且应有两个 module（实测 ${JSON.stringify(ora && ora.modules)}）`);
  } else {
    const modsByTop = Object.entries(ora.modTop).sort((a, b) => b[1] - a[1]);   // 顶面从高到低
    const topMod = modsByTop[0][0];       // 桥面/栏杆（最高面，顶视首先命中）
    const bodyMod = modsByTop[modsByTop.length - 1][0];   // 桥体（顶面更低，被桥面/栏杆包住）
    const poly = bridge.geometry.polyline;
    const seg = Math.floor(poly.length / 2);
    const [px, pz] = poly[seg];
    const [qx, qz] = poly[(seg + 1) % poly.length];
    const dl = Math.hypot(qx - px, qz - pz) || 1;
    const nx = -(qz - pz) / dl, nz = (qx - px) / dl;      // 折线左法线 → 偏向栏杆
    // 桥端陆地段中点（折线末段中点）：bridge-head 平台只铺在两端陆地段（raw GLB extras.inference：
    // 折线伸出池岸的东西两段读作实体桥头平台，桥体中部没有平台几何，顶视会打到水面）
    const p2x = (poly[poly.length - 1][0] + poly[poly.length - 2][0]) / 2;
    const p2z = (poly[poly.length - 1][1] + poly[poly.length - 2][1]) / 2;
    const aimClick = async (x, z, ty) => {
      await page.evaluate(([e, t]) => window.__viewAt(e, t), [[x, 40, z + 0.3], [x, ty, z]]);
      await page.waitForTimeout(140);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(30);
      await page.evaluate(() => { window.__pickDebug = undefined; });
      await page.mouse.click(700, 450);
      await page.waitForTimeout(100);
      return page.evaluate(() => {
        const el = document.getElementById('info');
        const dds = el.style.display === 'block' ? [...el.querySelectorAll(':scope > dl > dd')].map(d => d.textContent) : null;
        return {
          open: el.style.display === 'block',
          src: dds ? dds[dds.length - 1] : null,
          id: window.__pickDebug ? window.__pickDebug.id ?? null : 'no-write',
        };
      });
    };
    report.T8 = { topMod, bodyMod };
    // 点 1：桥面/栏杆（折线点向栏杆侧偏 0.4 m，顶视首先命中最高构件）
    const r1 = await aimClick(px + nx * 0.4, pz + nz * 0.4, 0.8);
    const bads1 = [];
    if (r1.id !== bridge.id) bads1.push(`命中 id ${JSON.stringify(r1.id)} != ${bridge.id}`);
    if (r1.src !== `套件：${topMod}`) bads1.push(`来源 ${JSON.stringify(r1.src)} != 精确 ${JSON.stringify(`套件：${topMod}`)}`);
    report.T8.railing = r1;
    if (bads1.length) fail(`T8 点1（${topMod} 构件）：${bads1.join('；')}`);
    else ok(`T8 点1 顶视命中 ${topMod} 构件：来源精确 = ${r1.src}`);

    // 点 2：受控隐藏 garden-kit（=点1 命中的构件模块）网格 → 点击暴露的桥体 → 恢复
    const hideKit = await page.evaluate(async ({ idWanted, modWanted }) => {
      const scene = window.__scene;
      const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
      const modOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.module != null) return String(n.userData.module); } return null; };
      let n = 0;
      scene.traverse(o => { if (o.isMesh && idOf(o) === idWanted && modOf(o) === modWanted) { o.visible = false; n++; } });
      window.__batchSync?.();
      return n;
    }, { idWanted: bridge.id, modWanted: topMod });
    const r2 = await aimClick(p2x, p2z, 0.3);
    await page.evaluate(({ idWanted, modWanted }) => {
      const scene = window.__scene;
      const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
      const modOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.module != null) return String(n.userData.module); } return null; };
      scene.traverse(o => { if (o.isMesh && idOf(o) === idWanted && modOf(o) === modWanted) { o.visible = true; } });
      window.__batchSync?.();
    }, { idWanted: bridge.id, modWanted: topMod });
    const r3 = await aimClick(px + nx * 0.4, pz + nz * 0.4, 0.8);   // 恢复后复核点 1
    const bads2 = [];
    if (hideKit === 0) bads2.push(`没有隐藏到任何 ${topMod} 网格（受控暴露失败）`);
    if (r2.id !== bridge.id) bads2.push(`命中 id ${JSON.stringify(r2.id)} != ${bridge.id}`);
    if (r2.src !== `套件：${bodyMod}`) bads2.push(`来源 ${JSON.stringify(r2.src)} != 精确 ${JSON.stringify(`套件：${bodyMod}`)}`);
    if (r3.src !== `套件：${topMod}`) bads2.push(`恢复后点1 复核来源 ${JSON.stringify(r3.src)} != ${JSON.stringify(`套件：${topMod}`)}`);
    report.T8.body = { hidden: hideKit, r2, r3 };
    if (bads2.length) fail(`T8 点2（${bodyMod} 构件，受控暴露）：${bads2.join('；')}`);
    else ok(`T8 点2 隐藏 ${hideKit} 个 ${topMod} 网格后点击桥体：来源精确 = ${r2.src}；恢复后复核一致`);
  }
}
await pageU.close();

// ---------- T7 375px 手机宽度 ----------
{
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
    return {
      open: el.style.display === 'block',
      name: el.querySelector(':scope > h2')?.textContent ?? null,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      barRect: { x: +bar.x.toFixed(1), y: +bar.y.toFixed(1), w: +bar.width.toFixed(1), h: +bar.height.toFixed(1) },
      overlapBar: overlap,
      buttons,
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
  await mp.close();
}

await browser.close();
if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1) + '\n');
if (fails) { console.error(`infocard-test: ${fails} fail`); process.exit(1); }
console.log('infocard-test: all pass');
