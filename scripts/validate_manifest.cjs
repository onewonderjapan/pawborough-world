// Strict manifest verifier: every file the manifest references must match its
// recorded bytes AND sha256, both in the workspace and in dist/ (the built
// review bundle). Exits non-zero on any mismatch. --expect-fail inverts the
// exit logic for the negative test (a corrupted manifest must be rejected).
//
// Run: node scripts/validate_manifest.cjs [--root <workspace>] [--expect-fail]
const {createHash} = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const WS = rootArg >= 0 ? path.resolve(args[rootArg + 1]) : path.resolve(__dirname, '..');
const expectFail = args.includes('--expect-fail');
const manifest = JSON.parse(fs.readFileSync(path.join(WS, 'world/review-manifest.json'), 'utf8'));

const failures = [];
function check(label, p, record) {
  const full = path.join(WS, p);
  if (!fs.existsSync(full)) return failures.push(`${label}: missing file ${p}`);
  const b = fs.readFileSync(full);
  const sha = createHash('sha256').update(b).digest('hex');
  if (record.bytes !== undefined && b.length !== record.bytes)
    failures.push(`${label}: bytes ${b.length} != manifest ${record.bytes} (${p})`);
  if (record.sha256 && sha !== record.sha256)
    failures.push(`${label}: sha256 ${sha} != manifest ${record.sha256} (${p})`);
  return sha;
}

const rows = [];
for (const m of manifest.modules) {
  const before = failures.length;
  const local = check(`module ${m.id}`, m.path.replace(/^\.\//, ''), m);
  const dist = check(`dist module ${m.id}`, path.join('dist', m.path.replace(/^\.\//, '')), m);
  if (local !== dist) failures.push(`module ${m.id}: dist copy differs from workspace`);
  rows.push({id: m.id, localSha256: local, distSha256: dist, manifestMatches: failures.length === before});
}
const kitRec = {...manifest.streetKit};
const kitTris = kitRec.triangles;
delete kitRec.triangles;
check('street-kit', kitRec.path.replace(/^\.\//, ''), kitRec);
check('dist street-kit', path.join('dist', kitRec.path.replace(/^\.\//, '')), kitRec);
const worldRec = {...manifest.worldAssembly};
check('world-assembly', worldRec.path.replace(/^\.\//, ''), worldRec);
check('dist world-assembly', path.join('dist', worldRec.path.replace(/^\.\//, '')), worldRec);
check('reviewedWorldGlbSha256 consistency', worldRec.path.replace(/^\.\//, ''), {sha256: manifest.reviewedWorldGlbSha256});
if (typeof manifest.placedTriangles !== 'number' || manifest.placedTriangles <= 0)
  failures.push('placedTriangles missing or non-positive');
if (!Number.isInteger(kitTris) || kitTris <= 0) failures.push('streetKit.triangles missing');

const report = {
  validatedAt: new Date().toISOString(),
  root: WS,
  checkedModules: manifest.modules.length,
  placedTriangles: manifest.placedTriangles,
  failures,
  verdict: failures.length === 0 ? 'PASS' : 'FAIL',
};
fs.mkdirSync(path.join(WS, '../artifacts/r2'), {recursive: true});
fs.writeFileSync(path.join(WS, '../artifacts/r2/manifest-validation.json'),
                 JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`MANIFEST_VALIDATE ${report.verdict} failures=${failures.length}`);
for (const f of failures) console.log('  - ' + f);
if (expectFail) {
  if (report.verdict === 'FAIL') { console.log('NEGATIVE_OK corrupted manifest was rejected'); process.exit(0); }
  console.log('NEGATIVE_BROKEN corrupted manifest was accepted'); process.exit(1);
}
process.exit(report.verdict === 'PASS' ? 0 : 1);
