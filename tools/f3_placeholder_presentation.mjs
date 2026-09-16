// F3 placeholder presentation — REAL button path browser regression.
//
// Lead design: artifacts/daytime-design-20260914/PLACEHOLDER_PRESENTATION.md.
// Walk west loads the adjacent placeholder block -> back to framing view with
// the 占位建筑 checkbox OFF (refined only: placeholders hidden, colliders
// untouched, static shadow refreshed) -> screenshot -> checkbox ON -> back to
// walk (placeholders forced visible together with their collision BEFORE any
// movement; checkbox shows checked+disabled) -> repeat toggles grow nothing.
//
// Drives headless Chromium against the built preview (vite preview of dist/)
// using ONLY real UI interaction: button/checkbox clicks and native keyboard.
// Runs against both datasets (default + ?world=laneb). Triangle telemetry is
// used ONLY as evidence that the boxes actually left/returned to the render —
// never as an FPS/compression claim; resources() totals must stay identical.
//
// Run: node tools/f3_placeholder_presentation.mjs [--port 5311] [--world laneb]
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const PORT = parseInt(arg('--port', '5311'), 10);
const WORLD = arg('--world', 'laneb'); // 'laneb' | 'default'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, arg('--out', '../artifacts/feature-f3'));
const SHOTS = join(OUT, 'web');
await mkdir(SHOTS, { recursive: true });
const log = (s) => console.log(`[f3:${WORLD}] ${s}`);

const blocksPath = WORLD === 'laneb' ? 'world/laneb/blocks.json' : 'world/blocks.json';
const dataset = JSON.parse(await readFile(resolve(root, blocksPath), 'utf8'));
const WEST_IDS = dataset.blocks.find(b => b.id === 'block-adjacent-west').placeholderIds.slice().sort();

const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: 'pipe', detached: true,
  env: { ...process.env, EVIDENCE_DIR: SHOTS, EVIDENCE_PORTS: '528[45]|53[0-9][0-9]' },
});
const killServer = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } };
process.on('exit', killServer);
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
server.stderr.on('data', (d) => { serverOut += d; });
for (let i = 0; i < 60 && !serverOut.includes('Local:'); i++) await new Promise(r => setTimeout(r, 300));
if (!serverOut.includes('Local:')) { console.error(serverOut); killServer(); process.exit(1); }
log(`preview on ${PORT}, world=${WORLD}`);

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
const boxState = () => page.evaluate(() => { const b = document.querySelector('#chk-placeholder'); return { checked: b.checked, disabled: b.disabled }; });
const notice = () => page.evaluate(() => document.querySelector('#notice').textContent);
const eqIDs = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
// capture through the real evidence endpoint; returns {jpg, json} file names
async function shot() {
  const before = new Set(await readdir(SHOTS).catch(() => []));
  await page.getByText('保存实测图').click();
  await page.waitForTimeout(700);
  const fresh = (await readdir(SHOTS).catch(() => [])).filter(f => f.endsWith('.jpg') && !before.has(f));
  return fresh[0] ? { jpg: fresh[0], json: fresh[0].replace(/\.jpg$/, '.json') } : null;
}
async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  let rec = await record();
  while (Date.now() - t0 < timeoutMs) {
    rec = await record();
    if (pred(rec)) return rec;
    await page.waitForTimeout(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

let result = { ok: false };
try {
  await page.goto(`http://127.0.0.1:${PORT}/${WORLD === 'laneb' ? '?world=laneb' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('完整世界已载入'), null, { timeout: 90000 });
  const r0 = await record();
  check('A0: world ready', r0.ready === true);
  check('A0: framing default is refined-only (placeholders hidden preference)', r0.presentation.placeholdersVisible === false && r0.presentation.viewPreference === false, JSON.stringify(r0.presentation));
  check('A0: nothing loaded-hidden yet (adjacent blocks load in walk)', eqIDs(r0.presentation.hiddenPlaceholderIds, []));
  check('A0: worldVersion recorded from the loaded assembly', /^glb-sha256-[0-9a-f]{64}$/.test(r0.presentation.worldVersion ?? ''), r0.presentation.worldVersion);
  const resTriangles0 = r0.resources.triangles;
  const box0 = await boxState();
  check('A0: checkbox enabled+unchecked in framing view', box0.checked === false && box0.disabled === false);

  // ---- A1: real 行走模式 click -> west placeholders load VISIBLE with their collision ----
  await page.click('#btn-walk');
  const landed = await waitFor(r => r.mode === 'walk' && r.walking.capsuleFeet[1] < 0.3 && r.walking.blocks.active.includes('block-adjacent-west'), 15000, 'walk landing + west block load');
  check('A1: walk mode landed with west block loaded', landed.mode === 'walk' && landed.walking.blocks.active.includes('block-adjacent-west'), `feet=${landed.walking.capsuleFeet.map(v => +v.toFixed(2))}`);
  check('A1: walk enforces placeholders visible (never an invisible wall)', landed.presentation.placeholdersVisible === true && eqIDs(landed.presentation.hiddenPlaceholderIds, []));
  check('A1: placeholder colliders exist and match the loaded geometry', landed.presentation.placeholderColliders === WEST_IDS.length && landed.presentation.loadedPlaceholderCount === WEST_IDS.length, `colliders=${landed.presentation.placeholderColliders}`);
  const box1 = await boxState();
  check('A1: checkbox shows checked+disabled during walk', box1.checked === true && box1.disabled === true);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const walked = await record();
  check('A1: movement allowed after display/collision restore', walked.walking.capsuleFeet[0] > landed.walking.capsuleFeet[0] + 1.5, `dx=${(walked.walking.capsuleFeet[0] - landed.walking.capsuleFeet[0]).toFixed(2)}m`);
  const shotA = await shot();
  check('A1: walk shot captured', shotA !== null, shotA?.jpg ?? 'none');

  // ---- A2: back to framing view -> default pref hides the loaded placeholders (display only) ----
  await page.click('#btn-walk');
  await page.waitForTimeout(500);
  // re-anchor the designed aerial pose with the real view button: after a walk
  // return the orbit rig sits at the walker's street position looking down,
  // where the west boxes are outside the frustum (nothing to compare)
  await page.click('button[data-view="full-west"]');
  await page.waitForTimeout(400);
  const v1 = await record();
  check('A2: back in view, user preference restored (refined only)', v1.mode === 'view' && v1.presentation.placeholdersVisible === false && v1.presentation.viewPreference === false);
  check('A2: hidden IDs are exactly the loaded west stable IDs', eqIDs(v1.presentation.hiddenPlaceholderIds, WEST_IDS), `${v1.presentation.hiddenPlaceholderIds.length} hidden`);
  check('A2: colliders untouched by hiding (display only)', v1.presentation.placeholderColliders === WEST_IDS.length);
  check('A2: asset totals unchanged (hiding is NOT a smaller pack)', v1.resources.triangles === resTriangles0, `${resTriangles0}`);
  check('A2: blocks stayed loaded (no lifecycle churn on a view switch)', eqIDs(v1.walking.blocks.active, ['block-adjacent-west', 'block-review-street']));
  const box2 = await boxState();
  check('A2: checkbox enabled+unchecked again in view', box2.checked === false && box2.disabled === false);
  const triHidden = v1.render.trianglesIncludingShadow, callsHidden = v1.render.callsIncludingShadow;
  const shotB = await shot();
  check('A2: refined-only shot captured', shotB !== null, shotB?.jpg ?? 'none');

  // ---- A3: real checkbox click -> placeholders shown again in framing view ----
  await page.check('#chk-placeholder');
  await page.waitForTimeout(400);
  const v2 = await record();
  const delta = v2.render.trianglesIncludingShadow - triHidden;
  const callsDelta = v2.render.callsIncludingShadow - callsHidden;
  check('A3: checkbox shows placeholders in view', v2.presentation.placeholdersVisible === true && eqIDs(v2.presentation.hiddenPlaceholderIds, []));
  // real render effect: each returning box adds exactly its own 12-triangle
  // draw call (measured: the designed sun shadow frustum does not cover the
  // adjacent blocks, so the delta is main-pass boxes; the shadow refresh is
  // still enforced on every toggle so no stale map can survive)
  check('A3: boxes really returned to the render (one 12-tri draw call each)', delta > 0 && delta % 12 === 0 && callsDelta === delta / 12, `delta=${delta} tris, +${callsDelta} calls`);
  check('A3: asset totals still unchanged', v2.resources.triangles === resTriangles0);
  const shotC = await shot();
  check('A3: engineering shot captured', shotC !== null, shotC?.jpg ?? 'none');

  // saved sidecar records must carry the presentation + world version honestly
  if (shotB?.json && shotC?.json) {
    const recB = JSON.parse(await readFile(join(SHOTS, shotB.json), 'utf8'));
    const recC = JSON.parse(await readFile(join(SHOTS, shotC.json), 'utf8'));
    check('A3: saved -noph record lists the hidden stable IDs', eqIDs(recB.presentation.hiddenPlaceholderIds, WEST_IDS) && recB.presentation.placeholdersVisible === false);
    check('A3: saved -ph record shows placeholders visible', recC.presentation.placeholdersVisible === true && recC.presentation.hiddenPlaceholderIds.length === 0);
    check('A3: both saved records carry the world version', recB.presentation.worldVersion === recC.presentation.worldVersion && /^glb-sha256-/.test(recC.presentation.worldVersion));
  } else check('A3: saved record sidecars present', false, `${shotB?.json} / ${shotC?.json}`);

  // ---- A4: walk re-entry with preference OFF still enforces visible, toggles grow nothing ----
  await page.uncheck('#chk-placeholder'); // user prefers refined-only again
  await page.waitForTimeout(300);
  const epochBefore = (await record()).walking.blocks.epoch;
  const resBefore = (await record()).resources;
  for (let i = 0; i < 3; i++) {
    await page.click('#btn-walk'); // to walk (enforced visible)
    await page.waitForTimeout(450);
    const w = await record();
    check(`A4: toggle ${i + 1} walk enforces visible`, w.mode === 'walk' && w.presentation.placeholdersVisible === true && eqIDs(w.presentation.hiddenPlaceholderIds, []));
    await page.click('#btn-walk'); // back to view (pref off)
    await page.waitForTimeout(450);
    const v = await record();
    check(`A4: toggle ${i + 1} view restores refined-only`, v.mode === 'view' && v.presentation.placeholdersVisible === false);
  }
  const rEnd = await record();
  check('A4: repeated switching grew nothing (meshes/geometries/materials/textures/colliders/epoch)',
    rEnd.resources.meshes === resBefore.meshes && rEnd.resources.uniqueGeometries === resBefore.uniqueGeometries &&
    rEnd.resources.uniqueMaterials === resBefore.uniqueMaterials && rEnd.resources.uniqueTextures === resBefore.uniqueTextures &&
    rEnd.presentation.placeholderColliders === WEST_IDS.length && rEnd.walking.blocks.epoch === epochBefore,
    `epoch=${epochBefore}->${rEnd.walking.blocks.epoch} colliders=${rEnd.presentation.placeholderColliders}`);
  const boxEnd = await boxState();
  check('A4: preference survives the round trip (checkbox enabled+unchecked)', boxEnd.checked === false && boxEnd.disabled === false);
  check('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  result = { ok: checks.every(c => c.pass), checks, consoleErrors, world: WORLD, port: PORT, westIds: WEST_IDS, at: new Date().toISOString() };
} catch (e) {
  result = { ok: false, checks, consoleErrors, world: WORLD, port: PORT, error: String(e).slice(0, 400), at: new Date().toISOString() };
  log(`ABORTED: ${result.error}`);
} finally {
  await browser.close();
  killServer();
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(join(OUT, `f3-placeholder-presentation-${WORLD}-${stamp}.json`), JSON.stringify({ what: 'F3 placeholder presentation real-button regression (walk load -> framing hide -> shot -> show -> walk enforce -> toggle storm)', ...result }, null, 2) + '\n');
log(result.ok ? 'F3 REGRESSION PASS' : 'F3 REGRESSION FAIL');
process.exit(result.ok ? 0 : 1);
