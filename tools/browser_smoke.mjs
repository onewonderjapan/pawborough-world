// N2/N5 browser smoke test (technical self-check by the implementing session).
// Drives the REAL built client (vite preview of dist/) in headless Chromium:
// world load, triangle and texture integrity, block dataset connectivity,
// walk mode entry/exit, WASD movement, walk-camera quaternion finiteness
// (R1), pixel-level proof that the walk view renders the world (R1 — the old
// regression showed a uniform background), physics-chain cruise, and the
// evidence-save endpoint. Pass --world laneb to smoke the N5 candidate.
//
// This is recorded as a technical smoke test — it is NOT the lead's
// independent browser verification and does not flip walkingVerified.
//
// Run: node tools/browser_smoke.mjs [--world laneb] [--port N] [--shots DIR]
//   --port N   local preview port (default 5285; use a free port when the
//              owner's preview is running)
//   --shots D  directory for evidence screenshots/JSON (server-side
//              EVIDENCE_DIR); default keeps the historical lead-review/web
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const WORLD = process.argv.includes('--world') ? arg('--world', null) : null;
const PORT = parseInt(arg('--port', '5285'), 10);
const SHOTS = arg('--shots', null);
const URL_PATH = WORLD ? `/?world=${WORLD}` : '/';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// expected triangle total comes from the dataset manifest itself (no drift)
const expectedTris = JSON.parse(await readFile(resolve(root, WORLD === 'laneb' ? 'world/laneb/review-manifest.json' : 'world/review-manifest.json'), 'utf8')).placedTriangles;

const EV = process.env.SMOKE_EV ? resolve(root, process.env.SMOKE_EV) : resolve(root, '../artifacts/N2');
const SHOTS_DIR = SHOTS ? resolve(root, SHOTS) : resolve(root, '../artifacts/lead-review/web');
await mkdir(EV, { recursive: true });
await mkdir(SHOTS_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = (s) => console.log(`[smoke] ${s}`);

const URL0 = `http://127.0.0.1:${PORT}/`;
log(`starting vite preview on ${PORT}`);
// detached + whole-process-group kill: node_modules/.bin/vite is a shim that
// spawns the real node server — killing only the shim orphans the server,
// which then poisons later runs (stale server keeps serving with its OLD env)
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: 'pipe', detached: true,
  env: { ...process.env, EVIDENCE_DIR: SHOTS_DIR, EVIDENCE_PORTS: process.env.EVIDENCE_PORTS || '528[45]|529[0-9]' },
});
const killServer = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ } };
process.on('exit', killServer);
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
server.stderr.on('data', (d) => { serverOut += d; });
// match vite's READY banner, not just any mention of the port — a
// strictPort conflict error also names the port and must fail the run
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
  checks.push({ name, pass: Boolean(cond), detail });
  log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
}
async function record() {
  return page.evaluate(() => JSON.parse(document.querySelector('#record').textContent));
}
async function notice() {
  return page.evaluate(() => document.querySelector('#notice').textContent);
}
// save the CURRENT on-screen frame through the real evidence endpoint and
// return pixel statistics decoded in-page (uniform background => the walk
// view is blank; the R1 regression is only closed if the walk frame shows
// actual world content)
async function captureStats(name) {
  const before = new Set(await readdir(SHOTS_DIR).catch(() => []));
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(800);
  const after = (await readdir(SHOTS_DIR).catch(() => [])).filter(f => f.endsWith('.jpg'));
  const fresh = after.find(f => f.startsWith(name + '-') && !before.has(f));
  if (!fresh) return null;
  const b64 = (await readFile(join(SHOTS_DIR, fresh))).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0;
    const buckets = new Set();
    let grad = 0, gn = 0;
    for (let y = 0; y < c.height; y += 4) {
      let prev = null;
      for (let x = 0; x < c.width; x += 4) {
        const i = (y * c.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        n++; sr += r; sg += g; sb += b; sr2 += r * r; sg2 += g * g; sb2 += b * b;
        buckets.add(((r >> 4) * 64) + ((g >> 4) * 8) + (b >> 4));
        if (prev !== null) { grad += Math.abs(r - prev[0]) + Math.abs(g - prev[1]) + Math.abs(b - prev[2]); gn++; }
        prev = [r, g, b];
      }
    }
    const mean = [sr / n, sg / n, sb / n];
    const std = [Math.sqrt(Math.max(0, sr2 / n - mean[0] ** 2)), Math.sqrt(Math.max(0, sg2 / n - mean[1] ** 2)), Math.sqrt(Math.max(0, sb2 / n - mean[2] ** 2))];
    return { width: c.width, height: c.height, mean, std, distinctColors: buckets.size, meanGradient: grad / (gn || 1) };
  }, b64);
}

try {
  await page.goto(URL0 + URL_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('完整世界已载入'), null, { timeout: 90000 });
  const rec0 = await record();
  check('world ready in browser', rec0.ready === true);
  check(`browser sees ${expectedTris} placed triangles`, rec0.resources.triangles === expectedTris, String(rec0.resources.triangles));
  check('texture sharing intact (18, not 161)', rec0.resources.uniqueTextures === 18, String(rec0.resources.uniqueTextures));
  check('street kit loaded from single assembly', rec0.streetKitLoaded === true);
  check('blocks dataset connected: reviewed street active (R3)',
    Array.isArray(rec0.walking?.blocks?.active) && rec0.walking.blocks.active.includes('block-review-street'),
    JSON.stringify(rec0.walking?.blocks));
  check('walk camera quaternion finite in view mode', rec0.camera?.walkOrientationFinite === true);

  // control: a preset orbit view must render real content (calibrates the
  // pixel assertions below against a known-good frame)
  const viewStats = await captureStats('full-west-pbr');
  check('view-mode frame carries real content (control)',
    viewStats && viewStats.std.every(s => s > 5) && viewStats.meanGradient > 1 && viewStats.distinctColors > 16,
    viewStats ? `std=${viewStats.std.map(v => v.toFixed(1))} grad=${viewStats.meanGradient.toFixed(2)} colors=${viewStats.distinctColors}` : 'capture failed');

  // walk mode: spawn lands on real ground, camera quaternion stays finite
  await page.click('#btn-walk');
  await page.waitForTimeout(1500);
  const rec1 = await record();
  check('walk mode entered', rec1.mode === 'walk');
  const feet1 = rec1.walking.capsuleFeet;
  check('capsule spawned and landed on ground', feet1 && feet1[1] > -0.05 && feet1[1] < 0.3, `feet=${feet1?.map(v => v.toFixed(2))}`);
  check('walk entry recorded as reset, not walked route', rec1.walking.walkResets >= 1 && rec1.walking.manualKeyboardWalkTested === false);
  check('walk camera quaternion finite after production update (R1)',
    rec1.camera?.walkOrientationFinite === true && rec1.camera.quaternion.every(Number.isFinite),
    JSON.stringify(rec1.camera?.quaternion));

  // THE R1 content check: the walk frame must show the world, not a uniform
  // background (old bug rendered background-only despite moving feet)
  const walkStats = await captureStats('walk-pbr');
  check('walk-mode frame renders actual world content (R1)',
    walkStats && walkStats.std.every(s => s > 3) && walkStats.meanGradient > 0.5 && walkStats.distinctColors > 12,
    walkStats ? `std=${walkStats.std.map(v => v.toFixed(1))} grad=${walkStats.meanGradient.toFixed(2)} colors=${walkStats.distinctColors}` : 'capture failed');

  // WASD: hold W ~3.5 s, expect eastward progress along +X. The frame loop
  // clamps dt (0.25 s) and runs at most 8 fixed steps per frame, so under CPU
  // load the effective walk speed drops — the distance threshold leaves room
  // for that throttling while still proving input -> physics -> displacement.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const rec2 = await record();
  const dx = rec2.walking.capsuleFeet[0] - feet1[0];
  const dz = rec2.walking.capsuleFeet[2] - feet1[2];
  check('W walks east along the street', dx > 2.0 && Math.abs(dz) < Math.abs(dx), `dx=${dx.toFixed(2)} dz=${dz.toFixed(2)}`);
  check('walk camera quaternion still finite after movement', rec2.camera?.walkOrientationFinite === true);

  // pause leaves no motion (P pause, P resume)
  const beforePause = (await record()).walking.capsuleFeet;
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  const duringPause = (await record()).walking.capsuleFeet;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const stillPaused = (await record()).walking.capsuleFeet;
  check('paused: no movement even with key held', Math.hypot(stillPaused[0] - beforePause[0], stillPaused[2] - beforePause[2]) < 0.05);
  await page.keyboard.press('KeyP'); // resume
  await page.waitForTimeout(300);

  // back to view mode, then physics-chain cruise (frozen world only; the
  // laneb smoke focuses on load + walk + portal approach instead)
  await page.click('#btn-walk');
  await page.waitForTimeout(300);
  check('back to view mode', (await record()).mode === 'view');
  if (!WORLD) {
    await page.getByText('路线巡游（物理链）').click();
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('巡游完成') || document.querySelector('#notice')?.textContent.includes('巡游受阻'), null, { timeout: 180000 });
    const cruiseNotice = await notice();
    check('route cruise completed via physics chain', cruiseNotice.includes('巡游完成：23/23'), cruiseNotice);
    const rec3 = await record();
    check('cruise evidence recorded separately from manual walk', rec3.walking.autoPhysicsCruise?.reached === 23 && rec3.walking.manualKeyboardWalkTested === false);
  } else {
    // laneb: switch to the door-behind camera (must show stone paving, R2),
    // then a walk-mode sanity pass on the candidate world
    await page.getByText('支弄B·门后回望').click();
    await page.waitForTimeout(400);
    const pavingStats = await captureStats('lane-b-inside-return-pbr');
    check('laneb door-behind frame renders world content (R2 paving visible)',
      pavingStats && pavingStats.std.every(s => s > 3) && pavingStats.meanGradient > 0.5 && pavingStats.distinctColors > 12,
      pavingStats ? `std=${pavingStats.std.map(v => v.toFixed(1))} grad=${pavingStats.meanGradient.toFixed(2)} colors=${pavingStats.distinctColors}` : 'capture failed');
    await page.click('#btn-walk');
    await page.waitForTimeout(800);
    check('laneb walk mode entered on candidate world', (await record()).mode === 'walk');
    const nb = (await record()).walking.capsuleFeet;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
    const na = (await record()).walking.capsuleFeet;
    check('laneb W walks on candidate world', na[0] - nb[0] > 0.8, `dx=${(na[0] - nb[0]).toFixed(2)}`);
  }

  // evidence save over the real endpoint (origin must match the running port)
  const before = (await readdir(SHOTS_DIR).catch(() => [])).length;
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(800);
  const after = (await readdir(SHOTS_DIR).catch(() => [])).length;
  check('in-browser screenshot saved through evidence endpoint', after > before, `files ${before}->${after}`);

  check('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('smoke run completed without exception', false, String(e).slice(0, 300));
} finally {
  await browser.close();
  killServer();
}

const pass = checks.every(c => c.pass);
await writeFile(join(EV, `browser-smoke-${stamp}.json`), JSON.stringify({ what: 'zcode technical browser smoke test (NOT lead verification)', url: URL0, checks, consoleErrors, verdict: pass ? 'PASS' : 'FAIL' }, null, 2) + '\n');
log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(pass ? 0 : 1);
