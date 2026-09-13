// N2/N5 browser smoke test (technical self-check by the implementing session).
// Drives the REAL built client in headless Chromium: world load, triangle and
// texture integrity, walk mode entry/exit, WASD movement, physics-chain cruise,
// and the evidence-save endpoint. Pass --world laneb to smoke the N5 candidate
// dataset instead of the frozen world. This is recorded as a technical smoke
// test — it is NOT the lead's independent browser verification and does not
// flip walkingVerified/manualKeyboardWalkTested.
//
// Run: node tools/browser_smoke.mjs [--world laneb]   (exit 0 = all pass)
import { spawn } from 'node:child_process';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORLD = process.argv.includes('--world') ? process.argv[process.argv.indexOf('--world') + 1] : null;
const URL_PATH = WORLD ? `/?world=${WORLD}` : '/';
const EXPECTED_TRIS = WORLD === 'laneb' ? 176412 : 171464;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EV = resolve(root, '../artifacts/N2');
await mkdir(EV, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = (s) => console.log(`[smoke] ${s}`);

const PORT = 5285;
const URL = `http://127.0.0.1:${PORT}/`;
log(`starting vite preview on ${PORT}`);
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
server.stderr.on('data', (d) => { serverOut += d; });
for (let i = 0; i < 60 && !serverOut.includes(String(PORT)); i++) await new Promise(r => setTimeout(r, 300));
if (!serverOut.includes(String(PORT))) { console.error(serverOut); process.exit(1); }

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

try {
  await page.goto(URL + URL_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('完整世界已载入'), null, { timeout: 90000 });
  const rec0 = await record();
  check('world ready in browser', rec0.ready === true);
  check(`browser sees ${EXPECTED_TRIS} placed triangles`, rec0.resources.triangles === EXPECTED_TRIS, String(rec0.resources.triangles));
  check('texture sharing intact (18, not 161)', rec0.resources.uniqueTextures === 18, String(rec0.resources.uniqueTextures));
  check('street kit loaded from single assembly', rec0.streetKitLoaded === true);

  // walk mode: spawn lands on real ground
  await page.click('#btn-walk');
  await page.waitForTimeout(1500);
  const rec1 = await record();
  check('walk mode entered', rec1.mode === 'walk');
  const feet1 = rec1.walking.capsuleFeet;
  check('capsule spawned and landed on ground', feet1 && feet1[1] > -0.05 && feet1[1] < 0.3, `feet=${feet1?.map(v => v.toFixed(2))}`);
  check('walk entry recorded as reset, not walked route', rec1.walking.walkResets >= 1 && rec1.walking.manualKeyboardWalkTested === false);

  // WASD: hold W for ~1.5 s, expect eastward progress along +X
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const rec2 = await record();
  const dx = rec2.walking.capsuleFeet[0] - feet1[0];
  const dz = rec2.walking.capsuleFeet[2] - feet1[2];
  check('W walks east along the street', dx > 1.5 && Math.abs(dz) < Math.abs(dx), `dx=${dx.toFixed(2)} dz=${dz.toFixed(2)}`);

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
    // laneb: switch to the portal-axis camera, enter walk mode (reset to spawn), walk east,
    // then verify the walk HUD shows; deep-lane physics is covered by node tests
    await page.getByText('支弄B·门洞轴线').click();
    await page.waitForTimeout(200);
    await page.click('#btn-walk');
    await page.waitForTimeout(800);
    check('laneb walk mode entered on candidate world', (await record()).mode === 'walk');
    const nb = (await record()).walking.capsuleFeet;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    const na = (await record()).walking.capsuleFeet;
    check('laneb W walks on candidate world', na[0] - nb[0] > 1.0, `dx=${(na[0] - nb[0]).toFixed(2)}`);
  }

  // evidence save over the real endpoint (correct origin 5285)
  const evDir = resolve(root, '../artifacts/lead-review/web');
  const before = (await readdir(evDir).catch(() => [])).length;
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(800);
  const after = (await readdir(evDir).catch(() => [])).length;
  check('in-browser screenshot saved through evidence endpoint', after > before, `files ${before}->${after}`);

  check('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('smoke run completed without exception', false, String(e).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}

const pass = checks.every(c => c.pass);
await writeFile(join(EV, `browser-smoke-${stamp}.json`), JSON.stringify({ what: 'zcode technical browser smoke test (NOT lead verification)', url: URL, checks, consoleErrors, verdict: pass ? 'PASS' : 'FAIL' }, null, 2) + '\n');
log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(pass ? 0 : 1);
