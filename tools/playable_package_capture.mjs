// world-playable-night 20260920 — owner review captures for the two spots the
// upstream gallery does not cover (main street, temple front), taken from the
// REAL candidate page (fangbang.html?ds=fangbang-temple-v7) through its own
// __fangbangView hook: same contract as tools/lane_b_polish_capture.mjs.
// Headless Chrome + SwiftShader, 1280x720, dpr 1, page default lighting.
// Non-empty pixel check fails blank/grey frames.
//
// Output: artifacts/world-playable/captures/*.png + capture-record.json
// Run: node tools/playable_package_capture.mjs
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'artifacts/world-playable/captures');
const DATASET = 'fangbang-temple-v7';
const PORT = 5410;   // this batch's own dev port (EXECUTION_POLICY.runtime)

// poses copied verbatim from world/fangbang-temple-v7/cameras.json so the
// captures are the same framing a player gets from the page's camera buttons —
// all four player start points from one session, canvas-only, no page chrome
const POSES = [
  { id: 'main-street', view: 'junction-west', note: '主街西口：精修主街望西延伸拼接处' },
  { id: 'temple-front', view: 'shanmen-from-road', note: '庙前：方浜路中线正望山门（页面主画面）' },
  { id: 'lane-a-mouth', view: 'lane-a-street-look-in', note: 'A弄：街口望入（窄门洞纵深）' },
  { id: 'lane-b-mouth', view: 'lane-b-street-look-in', note: 'B弄：街口望入' },
];

const record = {
  tool: 'tools/playable_package_capture.mjs',
  env: { chrome: '/usr/bin/google-chrome', headless: true, swiftshader: true,
    viewport: [1280, 720], dpr: 1, dataset: DATASET, port: PORT,
    startedAt: new Date().toISOString() },
  captures: [], pass: true,
};

const cams = JSON.parse(await readFile(resolve(root, `world/${DATASET}/cameras.json`), 'utf8'));

let proc = null, log = '', portActual = null;
for (const p of [PORT, PORT + 2, PORT + 3]) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, env: { ...process.env, EVIDENCE_PORTS: `54[0-9][0-9]` }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tryPort = p;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`http://127.0.0.1:${tryPort}/fangbang.html`)).ok; } catch {}
  }
  if (up) { record.env.port = p; portActual = p; break; }
  log += `\n[port ${p} not usable]`;
  proc.kill();
  proc = null;
}
if (!proc) { console.error('CAPTURE_FAIL no dev server port available\n' + log); process.exit(1); }

const { chromium } = await import('../node_modules/playwright/index.mjs');
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
  await page.goto(`http://127.0.0.1:${portActual}/fangbang.html?ds=${DATASET}`, { waitUntil: 'domcontentloaded' });
  // ready + automatic route check must be DONE before the view hook exists
  await page.waitForFunction(() => typeof window.__fangbangView === 'function'
    && window.__fangbangRecord?.().routeCheck, null, { timeout: 900000, polling: 1000 });
  if (problems.length) throw new Error(problems.slice(0, 3).join(' | '));
  // clean owner-review framing: dismiss the entry card through the page's own
  // 取景 button (same as the lane-b capture contract), then hide the DOM chrome
  // (header/footer/review pill) presentation-only so the shot is canvas-only.
  await page.click('#btn-framing');
  await page.addStyleTag({ content: 'header,footer,details#review,#hud{display:none!important}' });
  // guard against a mid-capture full page reload (vite HMR or stray): if the
  // marker resets, wait for the view hook to exist again before continuing
  await page.evaluate(() => { window.__capMark = 1; });
  const waitHook = () => page.waitForFunction(() => typeof window.__fangbangView === 'function', null, { timeout: 900000, polling: 500 });
  for (const pose of POSES) {
    const c = cams.cameras.find((x) => x.id === pose.view);
    if (!c) throw new Error('camera missing: ' + pose.view);
    if (!await page.evaluate(() => window.__capMark === 1)) { console.log('page reloaded mid-capture; re-waiting for hook'); await waitHook(); await page.evaluate(() => { window.__capMark = 1; }); }
    await page.evaluate(([pos, tgt]) => window.__fangbangView(pos, tgt, null),
      [c.positionGlb, c.targetGlb]);
    await page.waitForTimeout(700);   // let the on-demand frame settle
    // viewport clip instead of element screenshot: the element-screenshot
    // stability wait proved flaky here (rare detach/re-resolve misreported as
    // "not attached" and then caught a mid-fit frame). Chrome-only run, the
    // canvas fills the viewport once the page chrome is hidden.
    const box = await page.locator('#app canvas').boundingBox();
    if (!box) throw new Error(`${pose.id}: canvas has no box`);
    let shot = await page.screenshot({ type: 'png', clip: box });
    if (shot.length < 60000) {
      const diag = await page.evaluate(() => ({
        canvases: document.querySelectorAll('#app canvas').length,
        buffer: (() => { const el = document.querySelector('#app canvas'); return el ? [el.width, el.height] : null; })(),
        mark: window.__capMark ?? null,
        fatal: !document.querySelector('#fatal')?.hidden,
        stage: document.querySelector('#stage')?.textContent ?? null,
      }));
      console.log('small frame diagnostics:', JSON.stringify(diag));
      await page.waitForTimeout(1500);
      shot = await page.screenshot({ type: 'png', clip: box });
    }
    if (shot.length < 60000) throw new Error(`${pose.id}: suspiciously small frame (${shot.length} B)`);
    // NOTE: written to a staging name first — the served world-preview module
    // graph imports captures/main-street.png, and writing the final name would
    // make vite full-reload THIS page mid-capture. Files are renamed after the
    // browser is closed.
    const file = resolve(OUT, '.staging-' + pose.id + '.png');
    await writeFile(file, shot);
    record.captures.push({ id: pose.id, view: pose.view, note: pose.note,
      presentation: 'canvas-only, entry card dismissed via the real 取景 button, header/footer/review pill hidden for the shot',
      bytes: shot.length, file: 'artifacts/world-playable/captures/' + pose.id + '.png' });
    console.log('captured', pose.id, shot.length, 'B');
  }
  await page.close();
} catch (e) {
  record.pass = false;
  record.error = String(e?.message ?? e);
  console.error('CAPTURE_FAIL', record.error);
} finally {
  await browser.close();
  proc.kill();
  // promote staged shots only now that no page is open (see staging note)
  const { rename, readdir: rd } = await import('node:fs/promises');
  for (const f of await rd(OUT))
    if (f.startsWith('.staging-')) await rename(resolve(OUT, f), resolve(OUT, f.slice('.staging-'.length)));
}
record.finishedAt = new Date().toISOString();
await writeFile(resolve(OUT, 'capture-record.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
process.exit(record.pass ? 0 : 1);
