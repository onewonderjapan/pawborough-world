// Final restored-candidate wiring only: no input driver, cruise, full route or rebuild.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs, nonClobberPath, readJson, writeJson, sha256Buf } from './lib.mjs';

export function checkCandidateBinding(version, manifestBytes, packageHead) {
  if (version.schemaVersion !== 1 || version.projectId !== 'pawborough-world' || !version.candidateId || version.fixture) throw Error('not a real candidate descriptor');
  if (!/^[a-f0-9]{40}$/.test(packageHead || '') || !/^[a-f0-9]{40}$/.test(version.sourceBuildHead || '') || version.packageHead !== packageHead) throw Error('candidate/package HEAD mismatch');
  if (version.manifestSha256 !== sha256Buf(manifestBytes)) throw Error('candidate/current manifest hash mismatch');
  return true; // pending technical/owner states are valid; smoke never promotes them
}
export async function candidateWalkSmoke({ root, outDir, port, browserExecutable, evidenceDir, packageHead }) {
  root = path.resolve(root); outDir = path.resolve(outDir); evidenceDir = path.resolve(evidenceDir);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !browserExecutable) throw Error('explicit valid port/browser required');
  await fsp.mkdir(evidenceDir, { recursive: true });
  const report = { tool: 'candidate_walk_smoke', startedAt: new Date().toISOString(), root, outDir, port, packageHead,
    scope: 'same-host candidate binding + production Fangbang spawn only; no route/human/W2/adoption/archive claim', pass: false,
    diagnostics: { pageErrors: [], consoleErrors: [], requestFailed: [], httpErrors: [] } };
  const log = await nonClobberPath(path.join(evidenceDir, 'candidate-server.log'));
  const logFile = await fsp.open(log, 'w');
  const area = path.join(root, 'scene-authoring/yuyuan-area');
  let server, browser;
  try {
    server = spawn(process.execPath, [path.join(area, 'scripts/server.mjs')], {
      cwd: area, env: { ...process.env, OUT_DIR: outDir, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    report.server = { pid: server.pid, log, ownChildOnly: true };
    await writeJson(await nonClobberPath(path.join(evidenceDir, 'candidate-server-pid.json')), report.server);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('own server did not announce listening')), 15000);
      const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      server.stdout.on('data', b => { logFile.write(b); if (b.toString().includes(`preview at http://127.0.0.1:${port}/`)) finish(); });
      server.stderr.on('data', b => logFile.write(b));
      server.once('error', finish); server.once('exit', code => finish(Error(`own server exited before startup: ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const fetchChecked = async rel => { const r = await fetch(base + rel); if (!r.ok) throw Error(`${rel}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
    const entry = await fetchChecked('/candidate/');
    if (!entry.toString('utf8').includes('id="candidate"')) throw Error('candidate page absent');
    const version = JSON.parse(await fetchChecked('/out/candidate-version.json'));
    const manifestBytes = await fetchChecked('/out/zones-manifest.json');
    checkCandidateBinding(version, manifestBytes, packageHead);
    report.candidate = { candidateId: version.candidateId, sourceBuildHead: version.sourceBuildHead, packageHead: version.packageHead,
      manifestSha256: version.manifestSha256, technicalStatus: version.technicalStatus, bindingPass: true };
    const pw = pathToFileURL(path.join(area, 'node_modules/playwright/index.mjs')).href;
    const { chromium } = await import(pw);
    const env = { ...process.env }; delete env.DISPLAY;
    browser = await chromium.launch({ executablePath: browserExecutable, headless: true, env,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => report.diagnostics.pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/favicon.ico')) report.diagnostics.consoleErrors.push(m.text()); });
    page.on('requestfailed', r => { if (!r.url().endsWith('/favicon.ico')) report.diagnostics.requestFailed.push({ url: r.url(), error: r.failure()?.errorText }); });
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) report.diagnostics.httpErrors.push({ url: r.url(), status: r.status() }); });
    await page.goto(base + '/candidate/');
    await page.waitForFunction(id => document.getElementById('candidate')?.textContent === id, version.candidateId, { timeout: 15000 });
    const candidateShot = await nonClobberPath(path.join(evidenceDir, 'candidate-entry.png'));
    await page.screenshot({ path: candidateShot });
    await page.goto(base + '/?zone=fangbang&walk=1&at=fangbang-street');
    await page.waitForFunction(() => {
      const s = window.__walk?.status();
      return s?.physicsReady && s.mode === 'walk' && s.anchor === 'fangbang-street' && s.grounded
        && ['garden','pond','temple','bazaar','outer','fangbang'].every(z => s.zones.includes(z));
    }, undefined, { timeout: 180000 });
    const state = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { WalkController } = await import('/vendor-src/player/WalkController.js');
      return { status: window.__walk.status(), productionController: window.__walk.controller instanceof WalkController };
    });
    if (!state.productionController || state.status.wallCount <= 0 || state.status.groundTriangleCount <= 0) throw Error('production walking physics not active');
    if (Object.values(report.diagnostics).some(a => a.length)) throw Error('asset/module/browser errors present');
    report.walkStart = state;
    report.screenshots = [candidateShot, await nonClobberPath(path.join(evidenceDir, 'fangbang-start.png'))];
    await page.screenshot({ path: report.screenshots[1] });
    report.pass = true;
  } catch (e) { report.error = e.message; }
  finally {
    if (browser) await browser.close().catch(() => {});
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const ended = new Promise(resolve => server.once('close', resolve));
      server.kill('SIGTERM'); report.stoppedOwnServerPid = server.pid;
      await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    await logFile.close();
    report.finishedAt = new Date().toISOString();
    report.reportPath = await nonClobberPath(path.join(evidenceDir, 'candidate-walk-smoke.json'));
    await writeJson(report.reportPath, report);
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const a = parseArgs(process.argv.slice(2));
    for (const k of ['root','out-dir','port','browser-executable','evidence-dir','package-head']) if (!a[k]) throw Error(`--${k} required`);
    const r = await candidateWalkSmoke({ root: String(a.root), outDir: String(a['out-dir']), port: Number(a.port),
      browserExecutable: String(a['browser-executable']), evidenceDir: String(a['evidence-dir']), packageHead: String(a['package-head']) });
    console.log(JSON.stringify({ pass: r.pass, report: r.reportPath, error: r.error || null })); if (!r.pass) process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
