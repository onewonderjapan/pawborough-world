// tools/portable/verify.mjs — 候选包校验（可独立运行，也被 restore 复用）。
//   node tools/portable/verify.mjs --package <目录|tar> [--report <路径>] [--keep-work]
//
// 检查项（任何一项失败即非零退出，fail-closed）：
//   1. MANIFEST-package.json 覆盖包内全部文件：无缺件、无坏 sha、无未列文件；
//   2. code.tar sha256 与 MANIFEST-code.json 一致；head 一致于 RESTORE.json；
//   3. MANIFEST-runtime.json：zones-manifest 可解析、闭包文件全部在 runtime/ 且 sha 匹配；
//   4. 自包含恢复工具在位（tools/portable/{restore,verify,closure,lib}.mjs）。
// tar 输入：先验 sidecar .sha256（若有），tar -tf 校验条目名安全且无链接后解包到临时目录。
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, listFiles, nonClobberPath, parseArgs, readJson, safeJoin, safeTarName, sha256File, writeJson } from './lib.mjs';

export async function verifyPackage(pkg, { keepWork = false } = {}) {
  const report = {
    tool: 'tools/portable/verify.mjs',
    package: path.resolve(pkg),
    pass: false,
    checks: [],
    missing: [],
    mismatched: [],
    unlisted: [],
  };
  const check = (name, ok, detail = '') => {
    report.checks.push({ name, ok, detail });
    if (!ok) report.pass = false;
    return ok;
  };

  let workDir = null;
  try {
    let dir = path.resolve(pkg);
    if (dir.endsWith('.tar') && (await exists(dir))) {
      const sidecar = dir + '.sha256';
      if (await exists(sidecar)) {
        const rec = JSON.parse(await fsp.readFile(sidecar, 'utf8'));
        const actual = await sha256File(dir);
        check('archive.sha256', actual === rec.sha256, `${actual === rec.sha256 ? 'match' : `expected ${rec.sha256} got ${actual}`}`);
        check('archive.bytes', (await fsp.stat(dir)).size === rec.bytes);
      } else {
        check('archive.sidecar', false, `${sidecar} absent — archive manifest not re-verifiable`);
      }
      const listing = spawnSync('tar', ['-tf', dir], { encoding: 'utf8' });
      check('tar.listing', listing.status === 0, listing.stderr?.slice(0, 200) || '');
      if (listing.status !== 0) return report;
      const names = listing.stdout.split('\n').filter(Boolean);
      try {
        for (const n of names) safeTarName(n);
        check('tar.entry-names', true);
      } catch (e) {
        check('tar.entry-names', false, e.message);
        return report;
      }
      const tv = spawnSync('tar', ['-tvf', dir], { encoding: 'utf8' });
      const linkEntries = tv.stdout.split('\n').filter((l) => /->/.test(l));
      check('tar.no-symlinks', linkEntries.length === 0, linkEntries.slice(0, 3).join('; '));
      if (linkEntries.length) return report;

      workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-verify-'));
      const x = spawnSync('tar', ['-xf', dir, '-C', workDir], { stdio: 'inherit' });
      check('tar.extract', x.status === 0);
      if (x.status !== 0) return report;
      const inner = (await fsp.readdir(workDir)).filter((e) => !e.startsWith('.'));
      dir = path.join(workDir, inner[0]);
    }

    report.packageDir = dir;
    report.pass = true;
    if (!(await exists(safeJoin(dir, 'MANIFEST-package.json')))) {
      check('package.manifest-present', false, 'MANIFEST-package.json absent');
      return report;
    }
    const manifest = await readJson(safeJoin(dir, 'MANIFEST-package.json'));
    const listed = new Map(manifest.files.map((f) => [f.path, f]));

    for (const f of manifest.files) {
      const abs = safeJoin(dir, f.path);
      if (!(await exists(abs))) { report.missing.push(f.path); continue; }
      const actual = await sha256File(abs);
      if (actual !== f.sha256) report.mismatched.push({ path: f.path, expected: f.sha256, actual });
    }
    const present = (await listFiles(dir)).filter((p) => p !== 'MANIFEST-package.json');
    report.unlisted = present.filter((p) => !listed.has(p));
    check('package.files-complete', report.missing.length === 0, `${report.missing.length} missing`);
    check('package.shas-match', report.mismatched.length === 0, `${report.mismatched.length} mismatched`);
    check('package.no-unlisted', report.unlisted.length === 0, report.unlisted.slice(0, 5).join(', '));

    // RESTORE.json / MANIFEST-code.json 一致性
    if (listed.has('RESTORE.json') && listed.has('MANIFEST-code.json')) {
      const restore = await readJson(safeJoin(dir, 'RESTORE.json'));
      const code = await readJson(safeJoin(dir, 'MANIFEST-code.json'));
      report.head = code.head;
      check('code.tar-sha', await sha256File(safeJoin(dir, 'code.tar')) === code.codeTarSha256);
      check('head-consistent', restore.source?.head === code.head, `${restore.source?.head} vs ${code.head}`);
      check('restore.serve-port', Number.isInteger(restore.serve?.port), `port=${restore.serve?.port}`);
      report.servePort = restore.serve?.port;
    } else {
      check('restore+code-manifests', false, 'RESTORE.json / MANIFEST-code.json not in package manifest');
    }

    // 运行时闭包复核
    if (listed.has('MANIFEST-runtime.json')) {
      const rt = await readJson(safeJoin(dir, 'MANIFEST-runtime.json'));
      const zones = await readJson(safeJoin(dir, 'runtime', rt.zonesManifest ? path.basename(rt.sourceZonesManifest) : 'zones-manifest.json'));
      check('runtime.zones-manifest-parses', Array.isArray(zones.zones) && zones.zones.length > 0, `${zones.zones?.length ?? 0} zone entries`);
      const rtMissing = [];
      for (const f of rt.files) {
        if (!(await exists(safeJoin(dir, 'runtime', f.path)))) rtMissing.push(f.path);
      }
      check('runtime.files-present', rtMissing.length === 0, rtMissing.slice(0, 5).join(', '));
      report.runtimeTotals = rt.totals;
      report.pendingBlocks = null;
      if (listed.has('assets-status.json')) {
        const as = await readJson(safeJoin(dir, 'assets-status.json'));
        report.pendingBlocks = as.pendingBlocks ? Object.keys(as.pendingBlocks) : [];
        report.assetsStatusExplicit = as.statusExplicit ?? null;
      }
    } else {
      check('runtime.manifest-present', false, 'MANIFEST-runtime.json absent');
    }

    for (const t of ['restore.mjs', 'verify.mjs', 'closure.mjs', 'lib.mjs']) {
      check(`self-contained-tools/${t}`, listed.has(`_restore/portable/${t}`));
    }
    report.pass = report.checks.every((c) => c.ok);
    return report;
  } finally {
    if (workDir && !keepWork) await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function writeReport(report, reportPath) {
  const p = await nonClobberPath(reportPath);
  await writeJson(p, report);
  return p;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { flags: ['keep-work'] });
  if (!args.package) { console.error('FAIL --package <dir|tar> required'); process.exit(1); }
  const report = await verifyPackage(String(args.package), { keepWork: !!args['keep-work'] });
  for (const c of report.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  console.log(`VERIFY_${report.pass ? 'PASS' : 'FAIL'} ${report.package}`);
  if (args.report) console.log(`report: ${await writeReport(report, String(args.report))}`);
  process.exit(report.pass ? 0 : 1);
}
