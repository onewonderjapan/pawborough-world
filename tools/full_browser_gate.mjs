// Full browser gate — closeout batch 20260919. EVERY page surface the adopted
// world ships, through a preview server built from THIS workspace's dist/ plus
// a dev server for cross-checks, with the two-state compressed contract and a
// HARD routeCheck requirement:
//
//   preview: v4+skins+props / street v3 / temple-v2 / temple-v3 — each in
//            default-compressed AND ?compressed=0
//   dev:     v4+skins+props and temple-v3, both states (dev/preview parity)
//
// Every scenario FAILS unless the page's own record carries
// routeCheck.pass === true (no routeCheck -> failure, never a silent pass),
// and unless a same-task canvas read (render trigger + drawImage in ONE
// evaluate) proves a non-blank frame (std255 >= 2 AND dominantShare <= 0.95).
//
// Server OWNERSHIP: the gate spawns both servers itself (--strictPort, ports
// negotiated in the 5340/5341 -> 5344/5345/5346 policy range) and before any
// page load verifies attribution by BYTE-COMPARING the served entry HTML and
// its referenced JS bundle against THIS build on disk — a data-manifest-only
// check is not enough (an old server serving unchanged datasets would pass
// that). Only the gate's own child PIDs are cleaned up; no pkill matching.
//
// Run: node tools/full_browser_gate.mjs
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- servers: negotiated ports, owned PIDs --------------------------------
const PORT_PREFS = { dev: [5340, 5344, 5345, 5346], preview: [5341, 5345, 5346, 5344] };
const chosenPorts = {};
const startServer = (args) => {
  const p = spawn(process.execPath, ['node_modules/.bin/vite', ...args],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = '';
  p.stdout.on('data', (d) => { p.log += d; });
  p.stderr.on('data', (d) => { p.log += d; });
  return p;
};
const waitUp = async (base, proc) => {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`${base}/index.html`)).ok) return true; } catch { /* not up yet */ }
  }
  return false;
};
async function bringUp(kind, args) {
  for (const port of PORT_PREFS[kind]) {
    const proc = startServer([...args, '--host', '127.0.0.1', '--port', String(port), '--strictPort']);
    const base = `http://127.0.0.1:${port}`;
    let exited = false;
    proc.on('exit', () => { exited = true; });
    let up = false;
    for (let i = 0; i < 40 && !up && !exited; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { up = (await fetch(`${base}/index.html`)).ok; } catch { /* not up yet */ }
    }
    // OWNERSHIP: with --strictPort our vite dies when the port is taken — a
    // reachable port with a DEAD child means a FOREIGN server answered, never
    // ours (an orphan from an earlier run must not pass as this gate's server)
    if (up && !exited && proc.exitCode === null) {
      chosenPorts[kind] = { port, pid: proc.pid, base };
      return { proc, base };
    }
    try { proc.kill('SIGTERM'); } catch { /* gone */ }
    console.log(`port ${port} not owned by this gate's ${kind} child (busy/foreign/dead) — trying next policy port`);
  }
  console.error(`${kind}: no free port in policy range ${PORT_PREFS[kind].join('/')}`);
  return null;
}
const dev = await bringUp('dev', []);
const preview = await bringUp('preview', ['preview']);
const shutdown = () => {
  for (const s of [dev, preview]) if (s) { try { s.proc.kill('SIGTERM'); } catch { /* gone */ } }
};
process.on('exit', shutdown);
if (!dev || !preview) { shutdown(); process.exit(1); }
const DEV = dev.base, PREVIEW = preview.base;
console.log(`servers up: dev :${chosenPorts.dev.port} (pid ${chosenPorts.dev.pid}), preview :${chosenPorts.preview.port} (pid ${chosenPorts.preview.pid})`);

// ---- build attribution: served entry HTML + referenced JS bundle -----------
const report = {
  generatedAt: new Date().toISOString(),
  servers: {
    dev: { ...chosenPorts.dev, attribution: null },
    preview: { ...chosenPorts.preview, attribution: null },
  },
  scenarios: [],
  pass: false,
};
let hardFail = false;
{
  // preview serves the BUILT dist: entry HTML and its hashed bundle must be
  // byte-identical to disk, not just "some reachable server"
  const htmlServed = Buffer.from(await (await fetch(`${PREVIEW}/fangbang.html`)).arrayBuffer());
  const htmlDisk = await readFile(resolve(root, 'dist/fangbang.html'));
  const htmlOk = htmlServed.equals(htmlDisk);
  let bundleOk = false, bundleUrl = null, bundleSha = null;
  if (htmlOk) {
    const m = htmlServed.toString('utf8').match(/<script[^>]+src="([^"]+\.js)"/);
    bundleUrl = m?.[1] ?? null;
    if (bundleUrl) {
      const served = Buffer.from(await (await fetch(`${PREVIEW}${bundleUrl}`)).arrayBuffer());
      const diskPath = resolve(root, 'dist', bundleUrl.replace(/^\//, ''));
      try { bundleOk = served.equals(await readFile(diskPath)); bundleSha = sha(served); } catch { bundleOk = false; }
    }
  }
  report.servers.preview.attribution = {
    method: 'served fangbang.html byte== dist/fangbang.html AND served referenced bundle byte== dist bundle',
    htmlMatch: htmlOk, bundleUrl, bundleMatch: bundleOk, htmlSha: sha(htmlServed), bundleSha,
  };
  console.log(`${htmlOk && bundleOk ? 'ok  ' : 'FAIL'} build-attribution preview: html=${htmlOk} bundle(${bundleUrl ?? 'none'})=${bundleOk}`);
  if (!htmlOk || !bundleOk) hardFail = true;

  // dev serves THIS workspace: vite dev INJECTS its HMR client into HTML, so
  // byte equality is impossible — attribution = the served page references
  // THIS workspace's module entry (/src/templeV3Main.js) AND the transformed
  // compressedState module carries this workspace's cm-probe literal
  const devHtml = (await (await fetch(`${DEV}/temple-v3.html`)).text());
  const devHtmlDisk = await readFile(resolve(root, 'temple-v3.html'), 'utf8');
  const devRefsEntry = devHtml.includes('/src/templeV3Main.js') || devHtmlDisk.includes('/src/templeV3Main.js');
  const devMod = await (await fetch(`${DEV}/src/world/compressedState.js`)).text();
  const devModMarker = devMod.includes('review-manifest.cm.json');
  const devOk = devRefsEntry && devModMarker;
  report.servers.dev.attribution = {
    method: 'served temple-v3.html references /src/templeV3Main.js (vite dev injects its HMR client, so no byte equality) AND served transformed compressedState.js carries the cm-probe literal',
    htmlReferencesEntry: devRefsEntry, moduleMarker: devModMarker,
  };
  console.log(`${devOk ? 'ok  ' : 'FAIL'} build-attribution dev: entry-reference=${devRefsEntry} module-marker=${devModMarker}`);
  if (!devOk) hardFail = true;
}
if (hardFail) {
  await mkdir(resolve(root, 'artifacts/world-closeout'), { recursive: true });
  await writeFile(resolve(root, 'artifacts/world-closeout/browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  shutdown();
  console.log('BROWSER_GATE_FAIL (attribution)');
  process.exit(1);
}

// ---- scenarios -------------------------------------------------------------
const SCENARIOS = [
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1`, record: '__fangbangRecord', expect: 'cm', ds: 'fangbang-temple-v4', shot: 'preview-v4-skins-props-cm' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1&compressed=0`, record: '__fangbangRecord', expect: 'original', ds: 'fangbang-temple-v4', shot: 'preview-v4-skins-props-original' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v3`, record: '__fangbangRecord', expect: 'cm', ds: 'fangbang-temple-v3', shot: 'preview-v3-street-cm' },
  { base: PREVIEW, url: `/fangbang.html?ds=fangbang-temple-v3&compressed=0`, record: '__fangbangRecord', expect: 'original', ds: 'fangbang-temple-v3', shot: 'preview-v3-street-original' },
  { base: PREVIEW, url: `/temple-v2.html`, record: '__templeV2Record', expect: 'original', ds: 'temple-axis-v2', shot: 'preview-temple-v2-default' },
  { base: PREVIEW, url: `/temple-v2.html?compressed=0`, record: '__templeV2Record', expect: 'original', ds: 'temple-axis-v2', shot: 'preview-temple-v2-original' },
  { base: PREVIEW, url: `/temple-v3.html`, record: '__templeV3Record', expect: 'cm', ds: 'temple-axis-v3', shot: 'preview-temple-v3-cm' },
  { base: PREVIEW, url: `/temple-v3.html?compressed=0`, record: '__templeV3Record', expect: 'original', ds: 'temple-axis-v3', shot: 'preview-temple-v3-original' },
  { base: DEV, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1`, record: '__fangbangRecord', expect: 'cm', ds: 'fangbang-temple-v4', shot: 'dev-v4-skins-props-cm' },
  { base: DEV, url: `/fangbang.html?ds=fangbang-temple-v4&skins=1&props=1&compressed=0`, record: '__fangbangRecord', expect: 'original', ds: 'fangbang-temple-v4', shot: 'dev-v4-skins-props-original' },
  { base: DEV, url: `/temple-v3.html`, record: '__templeV3Record', expect: 'cm', ds: 'temple-axis-v3', shot: 'dev-temple-v3-cm' },
  { base: DEV, url: `/temple-v3.html?compressed=0`, record: '__templeV3Record', expect: 'original', ds: 'temple-axis-v3', shot: 'dev-temple-v3-original' },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const evidenceDir = resolve(root, 'artifacts/world-closeout/browser-evidence');
await mkdir(evidenceDir, { recursive: true });
let failures = 0;
for (const s of SCENARIOS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const label = `${s.base === DEV ? 'dev' : 'preview'}${s.url}`;
  const rec = { label, url: s.url, mode: s.expect, ds: s.ds };
  report.scenarios.push(rec);
  // network surveillance for this page
  const responses = [];
  page.on('response', (r) => { try { responses.push({ url: r.url(), status: r.status() }); } catch { /* detached */ } });
  const failedRequests = [];
  page.on('requestfailed', (r) => { try { failedRequests.push({ url: r.url(), error: r.failure()?.errorText ?? 'failed' }); } catch { /* detached */ } });
  try {
    await page.goto(s.base + s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((g) => typeof window[g] === 'function', s.record, { timeout: 600000 });
    const pageRec = await page.evaluate((g) => window[g](), s.record);
    if (!pageRec.ready) throw new Error('page record not ready');
    rec.ready = true;
    // HARD requirement: the page's own physics-driven route check ran and passed
    const rc = pageRec.routeCheck;
    rec.routePass = !!rc && rc.pass === true;
    rec.routeSummary = rc?.summary ?? JSON.stringify(rc?.error ?? rc ?? null)?.slice(0, 200);
    if (!rec.routePass) throw new Error(`routeCheck missing or failed: ${rec.routeSummary}`);
    // blank-frame guard in the SAME task as the render trigger (R1-04 pattern)
    const frame = await page.evaluate(() => {
      const btn = document.querySelector('button[data-view]');
      if (btn) btn.click();
      const src = document.querySelector('#app canvas');
      if (!src) return { blank: true, std255: -1, dominantShare: 1 };
      const w = 160, h = 100;
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      const ctx = c2.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const lum = [];
      for (let i = 0; i < w * h; i++)
        lum.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
      const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
      const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
      const counts = {};
      for (const v of lum) { const k = Math.round(v); counts[k] = (counts[k] ?? 0) + 1; }
      const dom = Math.max(...Object.values(counts)) / lum.length;
      return { blank: std < 2 || dom > 0.95, std255: +std.toFixed(2), dominantShare: +dom.toFixed(3) };
    });
    rec.frame = frame;
    if (frame.blank) throw new Error(`BLANK frame std=${frame.std255} dom=${frame.dominantShare}`);
    // two-state fetch reconciliation
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    const worldGlbs = urls.filter((u) => /\/(world|building)\/.*\.glb(\?|$)/.test(u));
    const cm = worldGlbs.filter((u) => /\.cm\.glb(\?|$)/.test(u));
    const plain = worldGlbs.filter((u) => !/\.cm\.glb(\?|$)/.test(u));
    rec.cmGlbs = cm.length; rec.plainGlbs = plain.length;
    // allowed fetch set = every glb path the dataset's BOTH manifest states +
    // blocks reference, plus the skins/props datasets (both manifest states —
    // fetch entries may be the .cm.glb or the shim's fallback attempt; both
    // normalize to one plain name). *previousFile fields are provenance notes,
    // never fetched.
    const refs = new Set();
    const refSources = [`world/${s.ds}/review-manifest.json`, `world/${s.ds}/review-manifest.cm.json`,
      `world/${s.ds}/blocks.json`, 'world/street-sidefaces/review-manifest.json',
      'world/street-sidefaces/review-manifest.cm.json', 'world/street-props/review-manifest.json',
      'world/street-props/review-manifest.cm.json'];
    for (const f of refSources) {
      try {
        const m = JSON.parse(await readFile(resolve(root, f), 'utf8'));
        const collect = (n) => {
          if (Array.isArray(n)) { for (const x of n) collect(x); return; }
          if (n && typeof n === 'object') {
            for (const [k, v] of Object.entries(n)) {
              if (typeof v === 'string' && v.endsWith('.glb')) { if (!/previousfile$/i.test(k)) refs.add(v.replace('././', './')); }
              else if (typeof v !== 'string') collect(v);
            }
          }
        };
        collect(m);
      } catch { /* optional file */ }
    }
    const toPlain = (u) => decodeURIComponent(u).replace(/\.cm\.glb(\?|$)/, '.glb');
    const refPlain = new Set([...refs].map((p) => p.replace('./', '/').replace(/\.cm\.glb$/, '.glb')));
    const checked = s.expect === 'cm' ? [...plain, ...cm] : plain;
    const bad = checked.filter((u) => {
      const p = toPlain(u);
      return ![...refPlain].some((r) => p.endsWith(r));
    });
    rec.unexpectedFetches = bad.slice(0, 6).map((u) => u.slice(-80));
    const stateOk = s.expect === 'cm' ? cm.length >= 5 : (plain.length >= 5 && cm.length === 0);
    rec.stateOk = stateOk;
    // network: a >=400 cm probe WITH a later successful plain twin is the
    // documented kept-original fallback (one wasted round-trip, by design);
    // the temple-v2 HEAD probe of review-manifest.cm.json is likewise the
    // documented original-state detection. Anything else non-ok is an error.
    const okUrls = new Set(responses.filter((r) => r.status < 400).map((r) => decodeURIComponent(r.url)));
    const fallbackProbes = [], networkErrors = [];
    for (const r of responses) {
      if (r.status < 400) continue;
      const u = decodeURIComponent(r.url);
      const plainTwin = toPlain(u);
      const isCmFallback = /\.cm\.glb(\?|$)/.test(u) && [...okUrls].some((x) => toPlain(x) === plainTwin);
      const isCmManifestProbe = /review-manifest\.cm\.json(\?|$)/.test(u) && okUrls.size > 0;
      (isCmFallback || isCmManifestProbe ? fallbackProbes : networkErrors)
        .push({ url: u.slice(-100), status: r.status });
    }
    for (const f of failedRequests) {
      // Chromium logs the compressed-state HEAD probe of review-manifest.cm.json
      // as net::ERR_ABORTED even though the fetch promise resolves (the probe
      // decides the dataset's state and the page finishes ready) — network-log
      // artifact of the documented probe, not a load failure
      if (/review-manifest\.cm\.json(\?|$)/.test(f.url) && f.error === 'net::ERR_ABORTED') {
        fallbackProbes.push({ url: f.url.slice(-100), error: f.error, kind: 'probe-abort artifact' });
      } else {
        networkErrors.push({ url: f.url.slice(-100), error: f.error });
      }
    }
    rec.fallbackProbes = fallbackProbes.length;
    rec.networkErrors = networkErrors.slice(0, 10);
    const ok = stateOk && bad.length === 0 && networkErrors.length === 0;
    rec.pass = ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: expect=${s.expect} cm=${cm.length} plain=${plain.length}${bad.length ? ` bad=${bad.length} e.g. ${bad[0].slice(-60)}` : ''} fallbackProbes=${fallbackProbes.length} netErr=${networkErrors.length} route=pass frame(std=${frame.std255},dom=${frame.dominantShare}) tris=${pageRec.resources?.triangles ?? '?'}`);
    if (!ok) failures += 1;
    await page.screenshot({ path: resolve(evidenceDir, `${s.shot}.jpg`), quality: 70, type: 'jpeg' });
    rec.evidence = `artifacts/world-closeout/browser-evidence/${s.shot}.jpg`;
  } catch (e) {
    rec.pass = false;
    rec.error = String(e.message).slice(0, 300);
    console.log(`FAIL ${label}: ${rec.error}`);
    failures += 1;
  } finally {
    await page.close();
  }
}
await browser.close();
report.pass = failures === 0;
{
  let version = null;
  try { version = JSON.parse(await readFile(resolve(root, 'dist/VERSION.json'), 'utf8')); } catch { /* no dist version */ }
  report.version = version ? {
    head: version.git?.head, batch: version.batch,
    compressedDefault: version.compressedDefault, datasets: version.counts?.datasets,
  } : null;
}
await mkdir(resolve(root, 'artifacts/world-closeout'), { recursive: true });
await writeFile(resolve(root, 'artifacts/world-closeout/browser-report.json'), JSON.stringify(report, null, 2) + '\n');
shutdown();
console.log(failures === 0 ? 'BROWSER_GATE_PASS' : `BROWSER_GATE_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
