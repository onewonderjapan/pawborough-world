// G5 食品接入实图：viewer 真实渲染路径（window.__viewAt 设机位），空白守卫+像素统计。
// 用法：先 PORT=5480 OUT_DIR=out-goal-05 npm run server
//   node scripts/render-g5.mjs shots.json renders-goal-05
// shots.json: [{name, p:[x,y,z], t:[x,y,z]}]（viewer three.js 世界系 = GLB 系 (x,高度,z_map)）
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsFile = process.argv[2] || 'g5-shots.json';
const OUTDIR = path.resolve(ROOT, process.argv[3] || 'renders-goal-05');
const PORT = process.env.PORT || '5480';
fs.mkdirSync(OUTDIR, { recursive: true });
const shots = JSON.parse(fs.readFileSync(path.resolve(shotsFile), 'utf8'));

const CHROME = (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath());
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await page.waitForTimeout(800);

let pass = 0, fail = 0;
const results = [];
for (const s of shots) {
  await page.evaluate(([p, t]) => window.__viewAt(p, t), [s.p, s.t]);
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(() => window.__pixelStats());
  const file = path.join(OUTDIR, s.name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  const blank = stats.std < 2.0 || stats.uniq < 12;
  results.push({ name: s.name, p: s.p, t: s.t, ...stats, blank, bytes: fs.statSync(file).size });
  if (blank) { fail++; console.log('FAIL blank', s.name, JSON.stringify(stats)); }
  else { pass++; console.log('PASS', s.name, `std=${stats.std.toFixed(1)} uniq=${stats.uniq}`); }
}
await browser.close();
fs.writeFileSync(path.join(OUTDIR, 'render-checks.json'), JSON.stringify(
  { generatedAt: new Date().toISOString(), shotsFile, summary: { pass, fail }, results }, null, 1));
if (fail) { console.error(`fails: ${fail}`); process.exit(1); }
console.log(`renders ok: ${pass} shots`);
