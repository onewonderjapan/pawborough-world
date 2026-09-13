// Validate every final GLB with the Khronos gltf-validator (local node_modules).
const path = require('path');
const fs = require('fs');
const validator = require('gltf-validator');

const WS = path.resolve(__dirname, '..');
const TARGETS = [];
for (const dir of fs.readdirSync(path.join(WS, 'building'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const glb = path.join(WS, 'building', dir.name, 'model.glb');
  if (fs.existsSync(glb)) TARGETS.push(path.relative(WS, glb));
}
TARGETS.push('world/street.glb');

(async () => {
  const report = { validatedAt: new Date().toISOString(), results: [] };
  let fail = 0;
  for (const rel of TARGETS) {
    const data = new Uint8Array(fs.readFileSync(path.join(WS, rel)));
    try {
      const r = await validator.validateBytes(data, { maxIssues: 200 });
      const entry = {
        file: rel,
        sha256: require('crypto').createHash('sha256').update(data).digest('hex'),
        bytes: data.length,
        validatorVersion: r.validatorVersion,
        errors: r.issues.numErrors,
        warnings: r.issues.numWarnings,
        infos: r.issues.numInfos,
        infoCodes: r.issues.messages.filter(m => m.severity === 0).slice(0, 6).map(m => m.code),
        warningCodes: r.issues.messages.filter(m => m.severity === 1).slice(0, 8).map(m => m.code + ':' + (m.pointer || '')),
        errorCodes: r.issues.messages.filter(m => m.severity === 2).slice(0, 8).map(m => m.code + ':' + (m.pointer || '')),
        info: r.info,
      };
      report.results.push(entry);
      if (r.issues.numErrors > 0) fail += 1;
      console.log(`${rel}: errors=${entry.errors} warnings=${entry.warnings} infos=${entry.infos} tris=${((r.info && r.info.totalTriangleCount) || 0)}`);
    } catch (e) {
      report.results.push({ file: rel, fatal: String(e) });
      fail += 1;
      console.log(`${rel}: FATAL ${e}`);
    }
  }
  report.errorFiles = fail;
  fs.writeFileSync(path.join(WS, '..', 'runs', 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('VALIDATION_DONE files=' + TARGETS.length + ' withErrors=' + fail);
})();
