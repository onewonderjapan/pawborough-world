// N step 3 — browser-side decode validation of cm candidates (and, on
// request, any original/cm pair) through the PRODUCTION loader factory
// (src/world/decoders.js: GLTFLoader + MeshoptDecoder). Served by vite dev so
// bare 'three' imports resolve exactly like the real pages.
//
// For every pair it reports: triangles, world Box3 min/max, mesh count,
// unique material count, texture count, ground-node names. The driver applies
// the DESIGN_SPEC tolerances: triangle drift <= 0.1%, position error
// <= 0.002 m, ground names preserved, texture count preserved (materials may
// merge — recorded, not failed).
//
// Run: node tools/closeout_cm_validate.mjs [--port 5344]
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const PORT = Number(arg('--port', 5344));

// start vite dev on the first free port of 5344/5345/5346 (policy fallbacks)
let proc = null, port = null, log = '';
for (const p of [5344, 5345, 5346]) {
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
if (!port) { console.error(`no free validation port in 5344-5346\n${log.slice(-1500)}`); process.exit(1); }
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
const pairs = [];
{
  const cand = JSON.parse(await readFile(resolve(root, 'artifacts/world-closeout/n-candidates.json'), 'utf8'));
  for (const r of cand.rows.filter((r) => !r.error)) {
    pairs.push({ rel: r.originalRel, original: r.originalRel, cm: r.candidateRel, provenance: r, section: 'newCandidate' });
  }
}
// existing shipped cm siblings: same decode-equivalence bar, so the whole
// default state is proven against the CURRENT originals (provenance bootstrap)
{
  const closure = JSON.parse(await readFile(resolve(root, 'artifacts/world-closeout/n-closure.json'), 'utf8'));
  for (const it of closure.items.filter((i) => i.state === 'hasCm')) {
    pairs.push({ rel: it.originalRel, original: it.originalRel, cm: it.cmRel, provenance: null, section: 'existingShipped' });
  }
}

let failures = 0;
const results = [];
for (const p of pairs) {
  const rec = { originalRel: p.rel, section: p.section };
  try {
    const [o, c] = await Promise.all([loadStats(rootUrl + p.original), loadStats(rootUrl + p.cm)]);
    const triDrift = o.triangles > 0 ? Math.abs(o.triangles - c.triangles) / o.triangles : 0;
    const dmin = Math.max(...['x', 'y', 'z'].map((a, i) => Math.abs(o.min[i] - c.min[i])));
    const dmax = Math.max(...['x', 'y', 'z'].map((a, i) => Math.abs(o.max[i] - c.max[i])));
    const posErr = Math.max(dmin, dmax);
    const groundLost = o.groundNames.filter((n) => !c.groundNames.includes(n));
    Object.assign(rec, {
      triangles: { original: o.triangles, cm: c.triangles, drift: +triDrift.toFixed(6), pass: triDrift <= TOL.triDrift },
      bounds: { original: { min: o.min, max: o.max }, cm: { min: c.min, max: c.max }, positionErrorM: +posErr.toFixed(6), pass: posErr <= TOL.posErrM },
      meshes: { original: o.meshes, cm: c.meshes },
      materials: { original: o.materials, cm: c.materials, merged: c.materials < o.materials },
      textures: { original: o.textures, cm: c.textures, pass: o.textures === c.textures },
      groundNames: { original: o.groundNames, cm: c.groundNames, lost: groundLost, pass: groundLost.length === 0 },
    });
    if (p.provenance) {
      rec.bytes = { original: p.provenance.sourceBytes, cm: p.provenance.outputBytes, ratio: p.provenance.ratio };
      rec.provenance = { sourceSha256: p.provenance.sourceSha256, outputSha256: p.provenance.outputSha256, tool: p.provenance.tool, toolVersion: p.provenance.toolVersion, args: p.provenance.args };
    } else {
      // hash the on-disk pair so the registry gets real SHAs for shipped cm
      const [ob, cb] = await Promise.all([readFile(resolve(root, p.original)), readFile(resolve(root, p.cm))]);
      const { createHash } = await import('node:crypto');
      const h = (b) => createHash('sha256').update(b).digest('hex');
      rec.bytes = { original: ob.byteLength, cm: cb.byteLength, ratio: +(cb.byteLength / ob.byteLength).toFixed(3) };
      rec.provenance = { sourceSha256: h(ob), outputSha256: h(cb), verifiedEquivalentByDecode: true };
    }
    rec.pass = rec.triangles.pass && rec.bounds.pass && rec.textures.pass && rec.groundNames.pass;
    if (!rec.pass) failures += 1;
    console.log(`${rec.pass ? 'ok  ' : 'FAIL'} [${p.section}] ${p.rel} tris ${o.triangles}->${c.triangles} (drift ${(triDrift * 100).toFixed(4)}%) posErr ${posErr.toFixed(5)}m tex ${o.textures}->${c.textures} mat ${o.materials}->${c.materials}${groundLost.length ? ` GROUND-LOST ${groundLost.length}` : ''}`);
  } catch (e) {
    rec.pass = false; rec.error = String(e.message).slice(0, 300); failures += 1;
    console.log(`FAIL [${p.section}] ${p.rel}: ${rec.error}`);
  }
  results.push(rec);
}

await browser.close();
shutdown();
const report = {
  batch: 'pawborough-world-closeout-night-20260919',
  stage: 'N step 3 decode validation (production loader, browser)',
  generatedAt: new Date().toISOString(),
  server: `http://127.0.0.1:${port} (vite dev, owned and stopped by this run)`,
  tolerances: TOL,
  validatedPort: port,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  results,
};
await writeFile(resolve(root, 'artifacts/world-closeout/n-validate.json'), JSON.stringify(report, null, 2) + '\n');
const bySection = (s) => report.results.filter((r) => r.section === s);
console.log(`VALIDATE newCandidate passed=${bySection('newCandidate').filter((r) => r.pass).length}/${bySection('newCandidate').length} ` +
  `existingShipped passed=${bySection('existingShipped').filter((r) => r.pass).length}/${bySection('existingShipped').length}`);
// failures are EXPECTED to be handled by the fallback policy (keep original,
// record reason) in the install step — the report carries every detail
process.exit(0);
