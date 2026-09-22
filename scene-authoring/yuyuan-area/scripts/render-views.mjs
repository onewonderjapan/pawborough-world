// 截图脚本 v2：对预览页按机位截图，带空白帧守卫。
// 默认核心三区总览；含 3 条通路关键街景与 3 个"前后对照"after 机位
// （对应 before 机位用同一脚本对旧 out/ 服务运行：OUT_DIR=out RENDER_DIR=renders-v2/before SHOTS=... PORT=... ）。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = path.join(ROOT, process.env.RENDER_DIR || 'renders');
const PORT = process.env.PORT || '5470';
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
fs.mkdirSync(OUTDIR, { recursive: true });

const SHOTS = [
  { name: '01-core-oblique', zone: 'core', cam: 'oblique' },
  { name: '02-core-top', zone: 'core', cam: 'top' },
  { name: '03-all-top', zone: 'all', cam: 'top' },
  { name: '04-garden-oblique', zone: 'garden', cam: 'oblique' },
  { name: '05-temple-oblique', zone: 'temple', cam: 'oblique' },
  { name: '06-bazaar-oblique', zone: 'bazaar', cam: 'oblique' },
  // 三条连接通路关键街景
  { name: "07-route-garden-gate", zone: "garden", cam: "low", view: { p: [-172, 10, -157], t: [-155, 1.5, -173] } }, // 门楼(v3 移位落点)→三穗堂 通路
  { name: '08-route-bazaar-street', zone: 'all', cam: 'low', street: 'east' },                                          // 商业主街东段
  { name: '09-route-temple-axis', zone: 'temple', cam: 'low', view: { p: [-70, 4.5, 26], t: [-80, 2.5, -30] } },        // 山门→仪门→大殿
  // G1 v3 新增：gpath-1 干绕行走廊（仰山堂→万花楼，绕池北岸与水渠东端）+ 九曲桥西落岸台阶
  { name: "13-route-gpath1-detour", zone: "garden", cam: "low", view: { p: [-112, 4.5, -212], t: [-124, 1.5, -204] } },
  { name: "14-route-jiuqu-landing", zone: "all", cam: "low", view: { p: [-190, 5.5, -99], t: [-176, 1, -113] } },
  // 前后对照（after 机位；before 用旧数据同脚本同机位）
  { name: '10-cmp-roof-after', zone: 'garden', cam: 'top' },
  { name: "11-cmp-bridge-landing-after", zone: "all", cam: "oblique", view: { p: [-196, 9, -101], t: [-171, 0.5, -117] } }, // 池西接岸
  { name: '12-cmp-street-front-after', zone: 'bazaar', cam: 'low' },
  // G2 七节点近景（净距+视线检查后的机位，scripts/compute-g2-shots.mjs 生成；22/24 目检通过保留原机位）
  { name: '21-node-sansuitang', zone: 'garden', cam: 'low', view: { p: [-151.1, 6, -194.8], t: [-162.5, 2.6, -180.9] } },  // 重檐+五开间柱廊
  { name: '22-node-dianchuntang', zone: 'garden', cam: 'low', view: { p: [-94.3, 6, -242.7], t: [-90.7, 2.8, -228.1] } }, // 围廊类两层
  { name: '23-node-huijinglou', zone: 'garden', cam: 'low', view: { p: [-96.2, 6, -201.6], t: [-111.1, 2.6, -191.6] } },  // 类别样板（标注推断）
  { name: '24-node-yuhuatang-moongate', zone: 'garden', cam: 'low', view: { p: [-98.5, 4.5, -131.5], t: [-98.6, 2, -150] } }, // 月洞门+格扇厅
  { name: '25-node-dachangtai', zone: 'garden', cam: 'low', view: { p: [-97, 6, -194.2], t: [-90.7, 2.6, -211.1] } },      // 敞亭戏台
  { name: '26-node-tingtaoge-gallery', zone: 'garden', cam: 'low', view: { p: [-82.8, 7, -137.2], t: [-70.2, 2.6, -147.1] } }, // 水廊+端头阁
  { name: '27-node-deyuelou', zone: 'garden', cam: 'low', view: { p: [-116.1, 6, -125.4], t: [-118.8, 4.6, -140.2] } },   // 围平座（v1 已验证净空线）
  { name: '28-wall-lattice', zone: 'garden', cam: 'low', view: { p: [-176.8, 4.5, -202.3], t: [-174.6, 2.6, -185.4] } },  // 龙墙漏窗段
  { name: '29-wall-dragonhead', zone: 'garden', cam: 'low', view: { p: [-158.6, 4.2, -167.5], t: [-165.5, 2.6, -158.9] } },// 龙头低位轮廓
];

// G3 街景机位（scripts/compute-g3-shots.mjs 生成，人眼高度 1.6-2.2m，净距+视线检查）
const g3file = path.resolve(ROOT, process.env.OUT_DIR || 'out', 'g3-shot-cams.json');
if (fs.existsSync(g3file)) {
  const cams = JSON.parse(fs.readFileSync(g3file, 'utf8'));
  for (const [name, c] of Object.entries(cams)) SHOTS.push({ name, zone: 'all', cam: 'low', view: c });
}

const CHROME = (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath());
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });

const results = [];
for (const s of SHOTS) {
  if (ONLY && !ONLY.has(s.name)) continue;
  await page.evaluate(([zone, cam, street, view]) => {
    window.__goto(zone, cam);
    if (street) window.__streetView(street);
    if (view) window.__viewAt(view.p, view.t);
  }, [s.zone, s.cam, s.street || null, s.view || null]);
  await page.waitForTimeout(1400);
  const stats = await page.evaluate(() => window.__pixelStats());
  const blank = stats.std < 2.0 || stats.uniq < 12;
  const file = path.join(OUTDIR, s.name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  results.push({ name: s.name, ...stats, blank, bytes: fs.statSync(file).size });
  console.log(s.name, 'std', stats.std.toFixed(1), 'uniq', stats.uniq, blank ? 'BLANK-GUARD-TRIP' : 'ok');
}
await browser.close();
fs.writeFileSync(path.join(OUTDIR, 'render-checks.json'), JSON.stringify(results, null, 1));
const tripped = results.filter(r => r.blank);
if (tripped.length) {
  console.error('空白帧守卫触发:', tripped.map(t => t.name).join(', '));
  process.exit(2);
}
console.log('renders ok:', results.length);
