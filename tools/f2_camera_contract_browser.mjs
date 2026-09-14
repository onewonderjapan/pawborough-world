// F2-02 browser verification — the REAL preset-button path on the built
// preview. Clicks every laneb camera preset button and asserts the live
// camera lands exactly on its cameras.json pose (the original 11 delivered
// presets and the two other lane-B presets must be UNCHANGED by the F2-02
// camera fix; only lane-b-detail moves). Captures the lane-b-detail frame
// through the real evidence endpoint with full record() telemetry.
//
// Run: node tools/f2_camera_contract_browser.mjs [--port 5297]
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const PORT = parseInt(arg('--port', '5297'), 10);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, arg('--out', '../artifacts/fix-f2'));
const SHOTS = join(OUT, 'web');
await mkdir(SHOTS, { recursive: true });
const log = (s) => console.log(`[f2-02] ${s}`);

// label map — mirrors src/main.js exactly
const LABELS = { 'full-west': '全段·西', 'full-east': '全段·东', 'eye-west': '沿街·西向东', 'eye-east': '沿街·东向西', across: '对街北望', corner: '光启路口', lane: '支弄B', catwall: '猫墙', plaza: '玄扈台前空地', 'corner-close': '路名牌近景', 'module-near': '店面近景', 'lane-b-axis': '支弄B·门洞轴线', 'lane-b-inside-return': '支弄B·门后回望', 'lane-b-detail': '支弄B·门框细节' };
const cameras = JSON.parse(await readFile(resolve(root, 'world/laneb/cameras.json'), 'utf8')).cameras;

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
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, pass: Boolean(cond), detail: String(detail) });
  log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
}
const record = () => page.evaluate(() => JSON.parse(document.querySelector('#record').textContent));

let result = { ok: false };
try {
  await page.goto(`http://127.0.0.1:${PORT}/?world=laneb`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('完整世界已载入'), null, { timeout: 90000 });
  check('laneb world ready', (await record()).ready === true);

  const TOL = 1e-3;
  const rows = [];
  for (const c of cameras) {
    await page.click(`button[data-view="${c.id}"]`); // exact preset button, no label ambiguity
    await page.waitForTimeout(250);
    const rec = await record();
    const err = Math.max(
      ...rec.camera.position.map((v, i) => Math.abs(v - c.positionGlb[i])),
      ...rec.camera.target.map((v, i) => Math.abs(v - c.targetGlb[i])));
    rows.push({ id: c.id, positionGlb: c.positionGlb, targetGlb: c.targetGlb, observedPosition: rec.camera.position, observedTarget: rec.camera.target, fovDeg: +rec.camera.fov.toFixed(4), maxError: +err.toExponential(3), pass: err <= TOL });
    check(`preset lands on cameras.json: ${c.id}`, err <= TOL, `err=${err.toExponential(2)}`);
  }

  // lane-b-detail must sit exactly on the lead design pose (runtime truth)
  const design = JSON.parse(await readFile(resolve(root, '../artifacts/final-lead-review-20260914/detail-camera-design.json'), 'utf8'));
  const detailRow = rows.find(r => r.id === 'lane-b-detail');
  check('lane-b-detail == lead design position', detailRow.observedPosition.every((v, i) => Math.abs(v - design.positionGlb[i]) <= TOL), JSON.stringify(detailRow.observedPosition.map(v => +v.toFixed(6))));
  check('lane-b-detail == lead design target', detailRow.observedTarget.every((v, i) => Math.abs(v - design.targetGlb[i]) <= TOL), JSON.stringify(detailRow.observedTarget.map(v => +v.toFixed(6))));

  // readable-after frame through the real evidence endpoint
  await page.click('button[data-view="lane-b-detail"]');
  await page.waitForTimeout(500);
  const detailRec = await record();
  const before = new Set(await readdir(SHOTS).catch(() => []));
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(800);
  const fresh = (await readdir(SHOTS).catch(() => [])).filter(f => f.endsWith('.jpg') && !before.has(f));
  check('lane-b-detail after-fix frame captured', fresh.length > 0, fresh[0] ?? 'none');
  result = { ok: checks.every(c => c.pass), rows, detailRecord: detailRec, screenshot: fresh[0] ?? null, consoleErrors, at: new Date().toISOString() };
} catch (e) {
  result = { ok: false, checks, consoleErrors, error: String(e).slice(0, 400), at: new Date().toISOString() };
  log(`ABORTED: ${result.error}`);
} finally {
  await browser.close();
  killServer();
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(join(OUT, `f2-02-camera-browser-check-${stamp}.json`), JSON.stringify({ what: 'F2-02 browser preset-button camera check (all 14 laneb presets) + lane-b-detail after-fix capture', port: PORT, verdict: result.ok ? 'PASS' : 'FAIL', ...result }, null, 2) + '\n');
log(result.ok ? 'F2-02 BROWSER CHECK PASS' : 'F2-02 BROWSER CHECK FAIL');
process.exit(result.ok ? 0 : 1);
