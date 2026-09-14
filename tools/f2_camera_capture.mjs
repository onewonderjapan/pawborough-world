// F2 evidence capture — drives the REAL built client (vite preview of dist/)
// in headless Chromium, clicks one camera preset button, saves the frame
// through the real evidence endpoint and dumps the live record() telemetry.
// Used for the lane-b-detail blocked-before / readable-after pair so both
// screenshots come from the same pipeline.
//
// Run: node tools/f2_camera_capture.mjs --label '支弄B·门框细节' --name lane-b-detail-before --port 5297 --out ../artifacts/fix-f2
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const LABEL = arg('--label', '支弄B·门框细节');
const NAME = arg('--name', 'lane-b-detail-capture');
const PORT = parseInt(arg('--port', '5297'), 10);
const WORLD = arg('--world', 'laneb');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', arg('--out', '../artifacts/fix-f2'));
const SHOTS = join(OUT, 'web');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(SHOTS, { recursive: true });
const log = (s) => console.log(`[capture] ${s}`);

const URL0 = `http://127.0.0.1:${PORT}/`;
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: 'pipe', detached: true,
  env: { ...process.env, EVIDENCE_DIR: SHOTS, EVIDENCE_PORTS: '528[45]|529[0-9]' },
});
const killServer = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } };
process.on('exit', killServer);
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
server.stderr.on('data', (d) => { serverOut += d; });
for (let i = 0; i < 60 && !serverOut.includes('Local:'); i++) await new Promise(r => setTimeout(r, 300));
if (!serverOut.includes('Local:')) { console.error(serverOut); killServer(); process.exit(1); }

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
let result = { ok: false };
try {
  await page.goto(URL0 + `/?world=${WORLD}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('完整世界已载入'), null, { timeout: 90000 });
  await page.getByText(LABEL).click();
  await page.waitForTimeout(600);
  const record = await page.evaluate(() => JSON.parse(document.querySelector('#record').textContent));
  const before = new Set(await readdir(SHOTS));
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(800);
  // the endpoint names files `${viewId}-pbr-<ts>` — match ANY fresh capture
  const fresh = (await readdir(SHOTS)).filter(f => f.endsWith('.jpg') && !before.has(f));
  if (!fresh.length) throw new Error('evidence endpoint did not save a screenshot');
  result = { ok: true, port: PORT, url: URL0 + `/?world=${WORLD}`, clickedLabel: LABEL, captureName: NAME, screenshot: fresh[0], record, consoleErrors, at: new Date().toISOString() };
  log(`saved ${fresh[0]}; camera at ${record.camera.position.map(v => +v.toFixed(3))} -> ${record.camera.target.map(v => +v.toFixed(3))}`);
} catch (e) {
  result = { ok: false, error: String(e).slice(0, 400), consoleErrors, at: new Date().toISOString() };
  log(`FAILED: ${result.error}`);
} finally {
  await browser.close();
  killServer();
}
await writeFile(join(OUT, `${NAME}-capture.json`), JSON.stringify(result, null, 2) + '\n');
process.exit(result.ok ? 0 : 1);
