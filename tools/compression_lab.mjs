// N4 compression lab driver: serves the workspace with vite dev (port 5284,
// this run's own server) and loads every candidate through the production
// decoder path (createGLTFLoader) in real Chromium. Records bytes, fetch and
// parse times, resource counts, decoder extensions actually exercised, and a
// same-camera screenshot per candidate. Screenshots are lab evidence, not
// lead review.
//
// Run: node tools/compression_lab.mjs   (exit 0 = all candidates loaded)
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EV = resolve(root, '../artifacts/N4');
await mkdir(EV, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const PORT = 5284;
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let out = '';
server.stdout.on('data', d => { out += d; });
server.stderr.on('data', d => { out += d; });
for (let i = 0; i < 80 && !out.includes(String(PORT)); i++) await new Promise(r => setTimeout(r, 250));
if (!out.includes(String(PORT))) { console.error(out); process.exit(1); }

const BASE = 'kit/out/plain-shop-a';
const CANDIDATES = [
  ['original', `${BASE}/model.glb`],
  ['pruned-hi-precision', `${BASE}/cand-pruned.glb`],
  ['meshopt-geometry', `${BASE}/cand-meshopt.glb`],
  ['webp-textures', `${BASE}/cand-webp.glb`],
  ['ktx2-etc1s', `${BASE}/cand-ktx2.glb`],
  ['ktx2-uastc', `${BASE}/cand-ktx2-uastc.glb`],
];

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

const rows = [];
try {
  for (const [name, src] of CANDIDATES) {
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?src=/${src}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => ['LAB_READY', 'LAB_ERROR'].includes(document.title), null, { timeout: 60000 });
    } catch {
      rows.push({ name, src, error: 'timeout' });
      continue;
    }
    const r = await page.evaluate(() => window.__labResult);
    r.name = name;
    rows.push(r);
    if (!r.error) {
      await page.screenshot({ path: join(EV, `lab-${name}.png`) });
    }
    console.log(JSON.stringify(r));
  }
} finally {
  await browser.close();
  server.kill();
}

const pass = rows.length === CANDIDATES.length && rows.every(r => !r.error);
await writeFile(join(EV, `lab-${stamp}.json`), JSON.stringify({
  what: 'N4 compression lab: candidates loaded through production decoder path (createGLTFLoader)',
  server: `vite dev 127.0.0.1:${PORT}`,
  browser: 'playwright chromium headless',
  rows, pageErrors: errors, verdict: pass ? 'PASS' : 'FAIL',
}, null, 2) + '\n');
console.log(pass ? 'LAB PASS' : 'LAB FAIL');
process.exit(pass ? 0 : 1);
