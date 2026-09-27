// tools/portable/restore.mjs — 一条命令：真正空目录恢复 → 校验 → 固定版本依赖安装
// → 127.0.0.1:5603 启动 → HTTP 归因探针 → 浏览器 core 冷加载非空白证据。
//
//   node tools/portable/restore.mjs --package <目录|tar> --dest <不存在或为空的目录> \
//     [--port 5603] [--source-cache <npm离线缓存>] [--skip-install] [--no-browser] \
//     [--check-and-exit] [--evidence-dir <目录>] [--keep-tar-work]
//
// fail-closed 顺序：包校验（sha/缺件）→ 恢复树复核 → 才允许 npm ci → 启动 → 探针。
// 任何失败：写 restore-report（时间戳命名，不覆盖）并以非零码退出，服务绝不带伤启动。
// 诚实边界：同机新目录恢复 ≠ W2 已测环境；本工具不声明云端归档或性能通过。
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEmptyDest, assertSymlinksInside, copyTree, exists, nonClobberPath, parseArgs, readJson, safeJoin, sha256File, writeJson } from './lib.mjs';
import { readTar, extractTar, TarUnsafeError } from './tar.mjs';
import { verifyPackage } from './verify.mjs';
import { runBrowserCheck } from './browser_check.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['skip-install', 'no-browser', 'check-and-exit', 'keep-tar-work'] });
if (!args.package || !args.dest) { console.error('FAIL --package <dir|tar> --dest <empty dir> required'); process.exit(1); }

const pkg = path.resolve(String(args.package));
const dest = path.resolve(String(args.dest));
const port = Number(args.port || 5603);
const sourceCache = args['source-cache'] ? path.resolve(String(args['source-cache'])) : null;
const browserExecutable = args['browser-executable'] ? path.resolve(String(args['browser-executable'])) : null;
const skipInstall = !!args['skip-install'];
const withBrowser = !args['no-browser'];
const checkAndExit = !!args['check-and-exit'];
const evidenceDir = args['evidence-dir']
  ? path.resolve(String(args['evidence-dir']))
  : path.resolve(path.dirname(dest), path.basename(dest) + '-restore-evidence');

const report = {
  tool: 'tools/portable/restore.mjs',
  startedAt: new Date().toISOString(),
  package: pkg, dest, port, sourceCache,
  scopeAndCaveat: 'same-host fresh-directory restore; NOT a W2-tested environment; not a cloud-restored claim',
  pass: false,
  stages: {},
  failures: [],
};
// 进程纪律：只终止本进程 spawn 并在此记录的服务子进程（PID 见报告 stages.serve.pid）
let serverChild = null;
const fail = async (stage, msg) => {
  report.failures.push({ stage, msg });
  report.finishedAt = new Date().toISOString();
  if (serverChild?.pid) {
    report.serverKilledOnFail = { pid: serverChild.pid };
    serverChild.kill('SIGTERM');
  }
  console.error(`RESTORE_FAIL [${stage}] ${msg}`);
  await writeReportAndExit(1);
};
async function writeReportAndExit(code) {
  await fsp.mkdir(evidenceDir, { recursive: true });
  const p = await nonClobberPath(path.join(evidenceDir, 'restore-report.json'));
  await writeJson(p, report);
  console.log(`report: ${p}`);
  process.exit(code);
}

// ---- 1. 目标目录：不存在或为空，绝不覆盖 ------------------------------------
try { await assertEmptyDest(dest); } catch (e) { await fail('dest', e.message); }
await fsp.mkdir(dest, { recursive: true });

// ---- 2. 包 → dest（严格 tar 校验先行 / 目录拒绝符号链接复制）---------------
if (pkg.endsWith('.tar') && (await exists(pkg))) {
  // R2：解包【前】整体校验全部条目（路径 + 类型；拒绝 symlink/hardlink/special/扩展头）
  let buf;
  try { buf = await fsp.readFile(pkg); } catch (e) { await fail('extract', e.message); }
  try {
    const entries = readTar(buf);
    report.tarEntriesChecked = entries.length;
  } catch (e) {
    await fail('extract', e instanceof TarUnsafeError ? e.message : String(e.message || e));
  }
  try {
    await extractTar(buf, dest);
  } catch (e) {
    await fail('extract', e instanceof TarUnsafeError ? e.message : String(e.message || e));
  }
  await flattenSingleTopDir(dest);
} else {
  try { await copyTree(pkg, dest); }
  catch (e) { await fail('extract', e.message); }
}

// 归档以单个顶层目录打包时（pack --tar 的形态），把其内容上提一层到 dest 根。
// 只移动本工具刚解出的内容，不触碰其他文件。
async function flattenSingleTopDir(dir) {
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.') || e.name === '.gitignore');
  if (!(entries.length === 1 && entries[0].isDirectory())) return;
  const inner = path.join(dir, entries[0].name);
  for (const e of await fsp.readdir(inner)) {
    await fsp.rename(path.join(inner, e), path.join(dir, e));
  }
  await fsp.rmdir(inner);
}

// ---- 3. fail-closed 校验（在 npm/启动之前）---------------------------------
report.stages.verify = { startedAt: new Date().toISOString() };
let verify;
try {
  verify = await verifyPackage(dest, { keepWork: true });
} catch (e) {
  await fail('verify', `package verification threw: ${e.message}`);
}
report.stages.verify.checks = verify.checks;
report.stages.verify.head = verify.head;
report.stages.verify.runtimeTotals = verify.runtimeTotals;
report.stages.verify.pendingBlocks = verify.pendingBlocks;
report.stages.verify.assetsStatusExplicit = verify.assetsStatusExplicit;
if (!verify.pass) {
  const bad = verify.checks.filter((c) => !c.ok).map((c) => c.name + (c.detail ? `: ${c.detail}` : ''));
  await fail('verify', `package failed closed (${bad.length} bad checks); missing=${JSON.stringify(verify.missing.slice(0, 10))} mismatched=${JSON.stringify(verify.mismatched.slice(0, 10))}`);
}
report.preRestore = {
  head: verify.head,
  runtimeTotals: verify.runtimeTotals,
  packageFiles: (await readJson(safeJoin(dest, 'MANIFEST-package.json'))).totals,
};

// 恢复后运行时闭包逐文件 sha 复核（“恢复后”一侧的证据）
const rt = await readJson(safeJoin(dest, 'MANIFEST-runtime.json'));
const postRestore = [];
for (const f of rt.files) {
  const abs = safeJoin(dest, 'runtime', f.path);
  const actual = await exists(abs) ? await sha256File(abs) : null;
  postRestore.push({ path: f.path, expected: f.sha256, actual, match: actual === f.sha256 });
}
const postBad = postRestore.filter((p) => !p.match);
report.postRestore = { files: postRestore.length, mismatches: postBad.length, missing: postBad.filter((p) => !p.actual).map((p) => p.path).slice(0, 20) };
if (postBad.length) await fail('post-restore', `${postBad.length} runtime closure files differ after restore (first: ${postBad[0].path})`);

// ---- 3.5 白名单代码树展平到恢复根（镜像仓库布局），再安放运行时闭包 --------
const restoreJsonEarly = await readJson(safeJoin(dest, 'RESTORE.json'));
const codeDir = safeJoin(dest, 'code');
if (!(await exists(codeDir))) await fail('code-extract', 'code/ directory absent from package');
report.stages.codeExtract = { startedAt: new Date().toISOString(), mode: 'whitelist-dir-flatten' };
for (const entry of await fsp.readdir(codeDir, { withFileTypes: true })) {
  if (await exists(safeJoin(dest, entry.name))) await fail('code-extract', `collision flattening code: ${entry.name} already exists at restore root`);
  await fsp.rename(safeJoin(codeDir, entry.name), safeJoin(dest, entry.name));
}
await fsp.rmdir(codeDir);
report.stages.codeExtract.done = true;
const runtimeTarget = safeJoin(dest, restoreJsonEarly.source.areaDir, restoreJsonEarly.serve.outDirEnv);
if (await exists(runtimeTarget)) await fail('place-runtime', `${runtimeTarget} already exists — refusing to overwrite`);
await fsp.mkdir(path.dirname(runtimeTarget), { recursive: true });
await fsp.rename(safeJoin(dest, 'runtime'), runtimeTarget);
report.runtimePlacedAt = path.relative(dest, runtimeTarget);

// ---- 4. npm ci（固定锁文件版本；--source-cache 走本机离线缓存）--------------
const restoreJson = await readJson(safeJoin(dest, 'RESTORE.json'));
const areaDir = restoreJson.source.areaDir;
report.stages.install = { startedAt: new Date().toISOString(), skipped: skipInstall, logs: [] };
await fsp.mkdir(evidenceDir, { recursive: true });
if (!skipInstall) {
  const runNpm = async (cwd, tag) => {
    const attempts = [];
    if (sourceCache) attempts.push({ mode: 'offline', npmArgs: ['ci', '--no-audit', '--no-fund', '--cache', sourceCache, '--offline'] });
    attempts.push({ mode: 'prefer-offline', npmArgs: ['ci', '--no-audit', '--no-fund', '--prefer-offline'] });
    for (const a of attempts) {
      const logPath = await nonClobberPath(path.join(evidenceDir, `npm-${tag}-${a.mode}.log`));
      const r = spawnSync('npm', a.npmArgs, { cwd, encoding: 'utf8' });
      await fsp.writeFile(logPath, (r.stdout || '') + (r.stderr || ''), 'utf8');
      report.stages.install.logs.push({ tag, mode: a.mode, code: r.status, log: logPath });
      if (r.status === 0) return { mode: a.mode };
      console.error(`npm ci ${tag} (${a.mode}) exit ${r.status}; log: ${logPath}`);
    }
    return null;
  };
  if (!(await runNpm(dest, 'root'))) await fail('install', 'npm ci at repo root failed (see logs in evidence dir)');
  if (!(await runNpm(safeJoin(dest, areaDir), 'area'))) await fail('install', `npm ci at ${areaDir} failed (see logs in evidence dir)`);

  // 锁文件版本一致性 + 新环境证明（node_modules 链接不逃逸恢复根）
  const lockChecks = [];
  const checkVer = async (lockRel, modRel, name) => {
    let expected = null, actual = null;
    try { expected = (await readJson(safeJoin(dest, lockRel))).packages?.['node_modules/' + modRel]?.version ?? null; } catch { /* absent */ }
    try { actual = (await readJson(safeJoin(dest, lockRel.replace('package-lock.json', 'node_modules/' + modRel + '/package.json')))).version ?? null; } catch { /* absent */ }
    lockChecks.push({ name, expected, actual, match: expected === null || (expected !== null && expected === actual) });
  };
  await checkVer('package-lock.json', 'three', 'root/three');
  await checkVer('package-lock.json', '@dimforge/rapier3d-compat', 'root/rapier3d-compat');
  await checkVer(`${areaDir}/package-lock.json`, 'three', 'area/three');
  await checkVer(`${areaDir}/package-lock.json`, 'playwright', 'area/playwright');
  report.stages.install.lockChecks = lockChecks;
  if (lockChecks.some((c) => !c.match)) await fail('install', `installed versions differ from lockfile: ${JSON.stringify(lockChecks.filter((c) => !c.match))}`);
  for (const nm of ['node_modules', `${areaDir}/node_modules`]) {
    const abs = safeJoin(dest, nm);
    if (await exists(abs)) {
      try { await assertSymlinksInside(abs); }
      catch (e) { await fail('fresh-env', e.message); }
    }
  }
  report.stages.install.finishedAt = new Date().toISOString();
}

// ---- 5. 启动 127.0.0.1:port -------------------------------------------------
const serverLogPath = await nonClobberPath(path.join(evidenceDir, 'server.log'));
const server = spawn(process.execPath, ['scripts/server.mjs'], {
  cwd: safeJoin(dest, areaDir),
  env: { ...process.env, PORT: String(port), OUT_DIR: restoreJson.serve.outDirEnv },
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverChild = server;
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const serverLogFlush = setInterval(() => { fsp.writeFile(serverLogPath, serverLog).catch(() => {}); }, 2000);
report.stages.serve = { startedAt: new Date().toISOString(), pid: server.pid, log: serverLogPath };
let exited = null;
server.on('exit', (code, sig) => { exited = { code, sig }; });
const base = `http://127.0.0.1:${port}`;

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  if (exited) await fail('serve', `server exited early code=${exited.code}; log tail: ${serverLog.slice(-400)}`);
  await new Promise((r) => setTimeout(r, 500));
  try { up = (await fetch(base + '/web/index.html')).ok; } catch { /* not yet */ }
}
if (!up) await fail('serve', `server not up on ${base}; log tail: ${serverLog.slice(-400)}`);
report.stages.serve.url = base + '/';
console.log(`server up: ${base}/ (OUT_DIR=${restoreJson.serve.outDirEnv})`);

// ---- 6. HTTP 归因探针（小 JSON 字节比对；GLB/tex 魔数）----------------------
const magicProbe = (urlPath, magicLen) => new Promise((res) => {
  const req = http.get(base + path.posix.join('/', urlPath), (r) => {
    const chunks = [];
    let got = 0;
    r.on('data', (c) => { chunks.push(c); got += c.length; if (got >= magicLen) { req.destroy(); res({ status: r.statusCode, head: Buffer.concat(chunks).subarray(0, magicLen) }); } });
    r.on('end', () => res({ status: r.statusCode, head: Buffer.concat(chunks).subarray(0, got) }));
  });
  req.on('error', () => res({ status: 0, head: Buffer.alloc(0) }));
  req.setTimeout(60000, () => { req.destroy(); res({ status: 0, head: Buffer.alloc(0) }); });
});
const probes = [];
const probeByteCompare = async (urlPath, expectSha) => {
  try {
    const r = await fetch(base + path.posix.join('/', encodeURI(urlPath)));
    if (!r.ok) return { path: urlPath, kind: 'json-byte-compare', ok: false, detail: `HTTP ${r.status}` };
    const sha = (await crypto.subtle.digest('SHA-256', await r.arrayBuffer()));
    const hex = [...new Uint8Array(sha)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { path: urlPath, kind: 'json-byte-compare', ok: hex === expectSha, detail: hex === expectSha ? 'sha match' : `sha ${hex.slice(0, 12)}… != ${expectSha.slice(0, 12)}…` };
  } catch (e) { return { path: urlPath, kind: 'json-byte-compare', ok: false, detail: String(e.message || e) }; }
};
for (const f of rt.files) {
  if (f.path.endsWith('.json') && f.bytes <= 8 * 1024 * 1024) probes.push(await probeByteCompare('out/' + f.path, f.sha256));
}
for (const f of rt.files.filter((x) => x.path.endsWith('.glb'))) {
  const r = await magicProbe('out/' + encodeURI(f.path), 4);
  probes.push({ path: f.path, kind: 'glb-magic', ok: r.status === 200 && r.head.toString('latin1') === 'glTF', detail: `status=${r.status} head=${r.head.toString('latin1')}` });
}
for (const f of rt.files.filter((x) => x.path.startsWith('tex/'))) {
  const r = await magicProbe('out/' + encodeURI(f.path), 8);
  probes.push({ path: f.path, kind: 'tex-presence', ok: r.status === 200 && r.head.length === 8, detail: `status=${r.status}` });
}
const modProbe = async (urlPath, kind) => {
  const r = await magicProbe(urlPath.replace(/^\//, ''), 4);
  probes.push({ path: urlPath, kind, ok: r.status === 200, detail: `status=${r.status}` });
};
const html = await (await fetch(base + '/web/index.html')).text();
if (!html.includes('importmap')) probes.push({ path: 'web/index.html', kind: 'entry', ok: false, detail: 'importmap missing in served entry' });
else probes.push({ path: 'web/index.html', kind: 'entry', ok: true, detail: 'importmap present' });
for (const p of Object.values(restoreJson.probes.moduleMap || {})) if (p.endsWith('.js') || p.endsWith('.mjs')) await modProbe(p, 'module-map');
for (const v of restoreJson.probes.vendorSrc || []) await modProbe('/vendor-src/' + v, 'vendor-src');
for (const v of restoreJson.probes.areaSrcRefs || []) await modProbe('/' + v, 'area-relative');
report.stages.probes = probes;
const badProbes = probes.filter((p) => !p.ok);
if (badProbes.length) await fail('probes', `${badProbes.length}/${probes.length} probes failed (first: ${JSON.stringify(badProbes[0])})`);
console.log(`probes: ${probes.length}/${probes.length} ok`);

// ---- 7. 浏览器 core 冷加载非空白 -------------------------------------------
if (withBrowser) {
  report.stages.browser = { startedAt: new Date().toISOString(), browserExecutable };
  try {
    const bc = await runBrowserCheck({
      url: base + '/', playwrightFrom: safeJoin(dest, areaDir), evidenceDir, label: 'core-cold-load',
      browserExecutable, readyTimeoutMs: 180000,
    });
    report.stages.browser = { ...report.stages.browser, ...bc };
    if (!bc.pass) await fail('browser', `cold-load not acceptable: ${JSON.stringify(bc.frame ?? bc.error ?? bc)}`);
    console.log(`browser: PASS browser=${bc.browser} readyMs=${bc.readyMs} frame=${JSON.stringify(bc.frame)}`);
  } catch (e) {
    await fail('browser', String(e.message || e));
  }
} else {
  report.stages.browser = { skipped: true };
}

// ---- 8. 报告与收尾 ----------------------------------------------------------
report.pass = true;
report.finishedAt = new Date().toISOString();
report.serveStillRunning = !checkAndExit;
{
  await fsp.mkdir(evidenceDir, { recursive: true });
  const p = await nonClobberPath(path.join(evidenceDir, 'restore-report.json'));
  await writeJson(p, report);
  console.log(`report: ${p}`);
}
if (checkAndExit) {
  clearInterval(serverLogFlush);
  await fsp.writeFile(serverLogPath, serverLog).catch(() => {});
  server.kill('SIGTERM');
  console.log(`RESTORE_PASS dest=${dest} port=${port} (server stopped after checks)`);
  process.exit(0);
} else {
  console.log(`RESTORE_PASS dest=${dest} — serving ${base}/ until Ctrl+C`);
  process.on('SIGINT', () => { server.kill('SIGTERM'); process.exit(0); });
  process.on('SIGTERM', () => { server.kill('SIGTERM'); process.exit(0); });
  server.stdout.pipe(process.stdout);
  // server 子进程保持事件循环存活；此处不退出
}
