// Validate every delivered GLB with the Khronos gltf-validator (local node_modules).
// Covers the 13 placed module models AND the assembled world GLBs actually loaded
// by the browser (street-reviewed.glb, street-kit.glb) plus the original
// street.glb. Any error/fatal makes the process exit non-zero so `set -e`
// pipelines cannot falsely pass. glTF severity codes: 0=error, 1=warning, 2=info.
//
// Usage:
//   node scripts/validate_all.cjs                    # full workspace check
//   node scripts/validate_all.cjs --root <dir>       # check a sandbox copy
//   node scripts/validate_all.cjs --files a.glb,b.glb --root <dir>
//   node scripts/validate_all.cjs --report <out.json>
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const validator = require('gltf-validator');

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const ROOT = path.resolve(argValue('--root') ?? path.join(__dirname, '..'));
const reportArg = argValue('--report');
const filesArg = argValue('--files');

const TARGETS = filesArg
  ? filesArg.split(',').map(s => s.trim()).filter(Boolean)
  : (() => {
      const list = [];
      for (const dir of fs.readdirSync(path.join(ROOT, 'building'), { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const glb = path.join(ROOT, 'building', dir.name, 'model.glb');
        if (fs.existsSync(glb)) list.push(path.relative(ROOT, glb));
      }
      list.sort();
      // Assembled worlds actually fetched by the client, plus original street.glb.
      for (const extra of ['world/street-reviewed.glb', 'world/street-kit.glb', 'world/street.glb']) {
        if (fs.existsSync(path.join(ROOT, extra))) list.push(extra);
      }
      return list;
    })();

(async () => {
  const report = { validatedAt: new Date().toISOString(), root: ROOT, results: [] };
  let fail = 0;
  for (const rel of TARGETS) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      report.results.push({ file: rel, fatal: 'missing file' });
      fail += 1;
      console.log(`${rel}: FATAL missing file`);
      continue;
    }
    const data = new Uint8Array(fs.readFileSync(full));
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    try {
      const r = await validator.validateBytes(data, { maxIssues: 200 });
      const entry = {
        file: rel,
        sha256,
        bytes: data.length,
        validatorVersion: r.validatorVersion,
        errors: r.issues.numErrors,
        warnings: r.issues.numWarnings,
        infos: r.issues.numInfos,
        errorCodes: r.issues.messages.filter(m => m.severity === 0).slice(0, 8).map(m => m.code + ':' + (m.pointer || '')),
        warningCodes: r.issues.messages.filter(m => m.severity === 1).slice(0, 8).map(m => m.code + ':' + (m.pointer || '')),
        infoCodes: r.issues.messages.filter(m => m.severity === 2).slice(0, 6).map(m => m.code),
        info: r.info,
      };
      report.results.push(entry);
      if (r.issues.numErrors > 0) fail += 1;
      console.log(`${rel}: errors=${entry.errors} warnings=${entry.warnings} infos=${entry.infos} tris=${((r.info && r.info.totalTriangleCount) || 0)}`);
    } catch (e) {
      report.results.push({ file: rel, sha256, fatal: String(e) });
      fail += 1;
      console.log(`${rel}: FATAL ${e}`);
    }
  }
  report.errorFiles = fail;
  report.verdict = fail === 0 ? 'PASS' : 'FAIL';
  const reportPath = reportArg ?? path.join(ROOT, '..', 'runs', 'validation.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`VALIDATION_DONE files=${TARGETS.length} withErrors=${fail} verdict=${report.verdict}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
