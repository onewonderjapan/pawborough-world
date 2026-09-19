// S1 — lanes-construction batch, decode validation of the two authorized v3
// cm corrections (westshops-strips stale rebuild candidate; lions revert
// re-confirmation) through the PRODUCTION loader factory, same bar as the N
// closeout chain (tools/closeout_cm_validate.mjs). Serves its own vite dev on
// policy ports 5344-5346 and stops it on exit.
//
// Run: node tools/lanes_s1_cm_validate.mjs
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number((process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : null) ?? 5344);

let proc = null, port = null, log = '';
for (const p of [PORT, 5345, 5346]) {
  proc = spawn(process.execPath, ['node_modules/.bin/vite', '--host', '127.0.0.1', '--port', String(p), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`http://127.0.0.1:${p}/index.html`)).ok; } catch {}
  }
  if (up) { port = p; break; }
  try { proc.kill('SIGTERM'); } catch {}
}
if (!port) { console.error(`no free validation port\n${log.slice(-1500)}`); process.exit(1); }
console.log(`validation dev server on 127.0.0.1:${port}`);
const shutdown = () => { try { proc.kill('SIGTERM'); } catch {} };
process.on('exit', shutdown);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://127.0.0.1:${port}/tools/cm_validate.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__cmLoad === 'function', null, { timeout: 60000 });
const loadStats = (url) => page.evaluate(async (u) => window.__cmLoad(u), url);

const TOL = { triDrift: 0.001, posErrM: 0.002 };
const rootUrl = `http://127.0.0.1:${port}/`;
const pairs = [
  { rel: 'world/fangbang-temple-v3/westshops-strips.glb', original: 'world/fangbang-temple-v3/westshops-strips.glb',
    cm: 'artifacts/lanes-construction/tails/cm-candidates/world/fangbang-temple-v3/westshops-strips.cm.glb', section: 'staleCmRebuildCandidate' },
  { rel: 'world/fangbang-temple-v3/temple-axis/lions.glb', original: 'world/fangbang-temple-v3/temple-axis/lions.glb',
    cm: 'world/fangbang-temple-v3/temple-axis/lions.cm.glb', section: 'lionsRevertReconfirm' },
];

let failures = 0;
const results = [];
for (const p of pairs) {
  const rec = { originalRel: p.rel, section: p.section };
  const [o, c] = await Promise.all([loadStats(rootUrl + p.original), loadStats(rootUrl + p.cm)]);
  const triDrift = o.triangles > 0 ? Math.abs(o.triangles - c.triangles) / o.triangles : 0;
  const dmin = Math.max(...['x', 'y', 'z'].map((a, i) => Math.abs(o.min[i] - c.min[i])));
  const dmax = Math.max(...['x', 'y', 'z'].map((a, i) => Math.abs(o.max[i] - c.max[i])));
  const posErr = Math.max(dmin, dmax);
  const groundLost = o.groundNames.filter((n) => !c.groundNames.includes(n));
  Object.assign(rec, {
    triangles: { original: o.triangles, cm: c.triangles, drift: +triDrift.toFixed(6), pass: triDrift <= TOL.triDrift },
    bounds: { original: { min: o.min, max: o.max }, cm: { min: c.min, max: c.max }, positionErrorM: +posErr.toFixed(6), pass: posErr <= TOL.posErrM },
    textures: { original: o.textures, cm: c.textures, pass: o.textures === c.textures },
    groundNames: { original: o.groundNames, cm: c.groundNames, lost: groundLost, pass: groundLost.length === 0 },
  });
  const { createHash } = await import('node:crypto');
  const h = (x) => createHash('sha256').update(x).digest('hex');
  const [ob, cb] = await Promise.all([readFile(resolve(root, p.original)), readFile(resolve(root, p.cm))]);
  rec.provenance = { sourceSha256: h(ob), cmSha256: h(cb), sourceBytes: ob.byteLength, cmBytes: cb.byteLength };
  rec.pass = rec.triangles.pass && rec.bounds.pass && rec.textures.pass && rec.groundNames.pass;
  if (!rec.pass) failures += 1;
  console.log(`${rec.pass ? 'ok  ' : 'FAIL'} [${p.section}] ${p.rel} tris ${o.triangles}->${c.triangles} (drift ${(triDrift * 100).toFixed(4)}%) posErr ${posErr.toFixed(5)}m tex ${o.textures}->${c.textures}`);
  results.push(rec);
}

await browser.close();
shutdown();
const report = {
  batch: 'pawborough-lanes-construction-night-20260920',
  stage: 'S1 decode validation of two authorized v3 cm corrections (production loader, browser)',
  generatedAt: new Date().toISOString(),
  server: `http://127.0.0.1:${port} (vite dev, owned and stopped by this run)`,
  tolerances: TOL,
  results,
};
await writeFile(resolve(root, 'artifacts/lanes-construction/tails/s1-cm-validate.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`S1 validate candidate=${results[0].pass ? 'PASS' : 'FAIL'} lionsReconfirm=${results[1].pass ? 'PASS(over-tolerance again -> revert confirmed)' : 'UNEXPECTED-PASS'} failures=${failures}`);
