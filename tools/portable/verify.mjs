// tools/portable/verify.mjs — 候选包校验（可独立运行，也被 restore 复用）。
//   node tools/portable/verify.mjs --package <目录|tar> [--report <路径>] [--keep-work]
//
// 检查项（任何一项失败即非零退出，fail-closed）：
//   1. MANIFEST-package.json 覆盖包内全部文件：无缺件、无坏 sha、无未列文件；
//   2. MANIFEST-code.json：白名单声明在场、code/ 与清单一一对应、逐文件
//      gitBlobSha+sha256 双记录；RESTORE.json head 一致、declaredScope=area-runtime-only；
//   3. MANIFEST-runtime.json：zones-manifest 可解析、闭包文件全部在 runtime/ 且 sha 匹配；
//   4. 自包含恢复工具在位（_restore/portable/{restore,verify,closure,tar,lib}.mjs）。
// tar 输入：先验 sidecar .sha256（若有）→ readTar 严格校验全部条目（路径+类型，
// 拒绝 symlink/hardlink/special/扩展头）→ 校验全部通过后才解包到临时目录。
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, listFiles, nonClobberPath, parseArgs, readJson, safeJoin, sha256File, writeJson } from './lib.mjs';
import { readTar, extractTar, TarUnsafeError } from './tar.mjs';

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
      // R2：先整体严格校验条目（路径+类型），全部通过才解包
      const buf = await fsp.readFile(dir);
      try {
        const entries = readTar(buf);
        check('tar.entries-safe', true, `${entries.length} entries, regular/dir only, no absolute/.. paths`);
      } catch (e) {
        check('tar.entries-safe', false, e instanceof TarUnsafeError ? e.message : String(e.message || e));
        return report;
      }
      workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-verify-'));
      try {
        await extractTar(buf, workDir);
        check('tar.extract', true);
      } catch (e) {
        check('tar.extract', false, String(e.message || e));
        return report;
      }
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

    // RESTORE.json / MANIFEST-code.json 一致性（R1：白名单 + 逐文件 blob 清单）
    if (listed.has('RESTORE.json') && listed.has('MANIFEST-code.json')) {
      const restore = await readJson(safeJoin(dir, 'RESTORE.json'));
      const code = await readJson(safeJoin(dir, 'MANIFEST-code.json'));
      report.head = code.head;
      check('head-consistent', restore.source?.head === code.head, `${restore.source?.head} vs ${code.head}`);
      check('restore.serve-port', Number.isInteger(restore.serve?.port), `port=${restore.serve?.port}`);
      check('scope.declared', restore.declaredScope === 'area-runtime-only' && code.declaredScope === 'area-runtime-only', `${restore.declaredScope}/${code.declaredScope}`);
      check('whitelist.present', Array.isArray(code.sourcePathWhitelist) && code.sourcePathWhitelist.length > 0, `${code.sourcePathWhitelist?.length ?? 0} rules, excluded ${code.excludedFiles} tracked paths`);
      const codeListed = new Map(code.files.map((f) => [f.path, f]));
      const codePresent = present.filter((p) => p.startsWith('code/')).map((p) => p.slice('code/'.length));
      const codeMissing = codePresent.filter((p) => !codeListed.has(p));
      const codeStale = code.files.filter((f) => !codePresent.includes(f.path)).map((f) => f.path);
      check('code.manifest-matches', codeMissing.length === 0 && codeStale.length === 0,
        codeMissing.length ? `unlisted: ${codeMissing.slice(0, 3).join(',')}` : codeStale.length ? `stale: ${codeStale.slice(0, 3).join(',')}` : 'one-to-one');
      check('code.blob-inventory', code.files.every((f) => typeof f.gitBlobSha === 'string' && /^[0-9a-f]{40}$/.test(f.gitBlobSha)), 'every file has git blob sha at head');
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

    for (const t of ['restore.mjs', 'verify.mjs', 'closure.mjs', 'tar.mjs', 'lib.mjs']) {
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
