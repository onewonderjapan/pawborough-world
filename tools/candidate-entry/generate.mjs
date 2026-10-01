// One candidate descriptor; final binding is supplied explicitly by the lead.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const kinds = ['technical', 'walk', 'control', 'restore'];
const head = value => { if (!/^[a-f0-9]{40}$/.test(value || '')) throw Error('HEAD must be a full 40-character Git hash'); return value; };
const text = value => typeof value === 'string' ? value : '';
function checkedFile(root, relative, expectedSha, expectedBytes) {
  if (!relative || path.isAbsolute(relative)) throw Error(`invalid relative asset path: ${relative}`);
  const base = fs.realpathSync(root), file = fs.realpathSync(path.resolve(root, relative));
  if (!file.startsWith(base + path.sep)) throw Error(`asset escapes OUT_DIR: ${relative}`);
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== expectedSha || bytes.length !== expectedBytes) throw Error(`asset hash/size mismatch: ${relative}`);
  return bytes.length;
}
function runtimeBudget(out, manifest) {
  if (manifest.schema !== 2 || !Array.isArray(manifest.zones) || !manifest.zones.length) throw Error('zones manifest schema 2 required');
  const ids = new Set(manifest.zones.filter(e => e.file).map(e => e.id));
  if (['garden','pond','temple','bazaar','outer','fangbang'].some(z => !ids.has(z))) throw Error('world v1 scope missing a required zone');
  if (manifest.zones.some(e => (e.id === 'fangbang' && e.loadPolicy !== 'on-demand') || (e.id === 'outer' && e.loadPolicy !== 'deferred'))) throw Error('current lazy load policy missing');
  let glbBytes = 0, textureBytes = 0, rawMax = 0, bazaar4 = null;
  const uniqueTextures = new Set();
  for (const e of manifest.zones.filter(e => e.file)) {
    const raw = checkedFile(out, e.file, e.sha256, e.bytes);
    rawMax = Math.max(rawMax, raw);
    if (e.id === 'bazaar' && e.part === 4) bazaar4 = raw;
    if (e.cm) checkedFile(out, e.cm.file, e.cm.sha256, e.cm.bytes);
    for (const name of e.cm?.textures || []) {
      const t = manifest.textures?.[name];
      if (!t) throw Error(`texture metadata missing: ${name}`);
      checkedFile(out, name, t.sha256, t.bytes);
    }
    if (['on-demand', 'deferred'].includes(e.loadPolicy)) continue;
    glbBytes += e.cm?.bytes ?? e.bytes;
    for (const name of e.cm?.textures || []) uniqueTextures.add(name);
  }
  for (const name of uniqueTextures) textureBytes += manifest.textures[name].bytes;
  const bytes = glbBytes + textureBytes;
  if (bytes > 20000000 || rawMax > 12000000 || (bazaar4 !== null && bazaar4 > 10000000)) throw Error('existing runtime budget exceeded');
  return { status: 'passed', bytes, glbBytes, uniqueTextureBytes: textureBytes, uniqueTextureFiles: uniqueTextures.size,
    rawMaxBytes: rawMax, bazaar4RawBytes: bazaar4,
    scope: '默认核心视觉首载 = GLB + 唯一外置贴图；外围后台、方浜按需；不含JS/WASM及步行模式原始物理GLB下载。' };
}
function review(kind, file, context) {
  if (!file) return { status: 'unverified', reason: '未提供本版审查收据' };
  try {
    const raw = fs.readFileSync(file), r = JSON.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(r.manifestSha256 || '') || r.schemaVersion !== 1 || r.kind !== kind || r.candidateId !== context.id || r.buildHead !== context.buildHead
      || r.manifestSha256 !== context.manifestSha256 || !['passed', 'pending', 'failed'].includes(r.status)) throw Error('收据没有绑定本版候选、构建HEAD和清单hash');
    if (r.fixture && !context.fixture) throw Error('验证样例收据不能用于最终候选');
    if (r.reusedFrom && !text(r.reason).trim()) throw Error('复用旧PASS必须明确reason和证据hash');
    if (r.status === 'passed' && (!Array.isArray(r.evidence) || !r.evidence.length)) throw Error('PASS缺少证据引用');
    const evidence = (r.evidence || []).map(e => {
      const target = path.resolve(path.dirname(file), e.path), bytes = fs.readFileSync(target);
      if (sha(bytes) !== e.sha256) throw Error(`审查证据hash不符: ${e.path}`);
      return { path: target, sha256: e.sha256 };
    });
    return { status: r.status, reason: text(r.reason), receiptSha256: sha(raw), evidence, reusedFrom: text(r.reusedFrom) || null };
  } catch (e) { return { status: 'unverified', reason: e.message }; }
}
export function generate(options) {
  const buildHead = head(options.buildHead || options.sourceHead), packageHead = head(options.packageHead);
  if (options.sourceHead && head(options.sourceHead) !== buildHead) throw Error('source-head and build-head must identify the same asset-build source');
  if (!text(options.id).trim()) throw Error('candidate-id required');
  const out = path.resolve(options.out), output = path.resolve(options.output || path.join(out, 'candidate-version.json'));
  if (output !== path.join(out, 'candidate-version.json')) throw Error('output must be OUT_DIR/candidate-version.json');
  const state = { schemaVersion: 1, projectId: 'pawborough-world', candidateId: options.id, generatedAt: new Date().toISOString(),
    fixture: !!options.fixture, sourceBuildHead: buildHead, packageHead, manifestSha256: null,
    budget: { status: 'unverified', bytes: null }, reviews: {}, issues: [],
    adoption: { status: 'pending', reason: '三地标已逐项采用（docs/OWNER_DECISION-landmarks-20260930.json、OWNER_DECISION-jiuqu-20261001.json）；版本整体以机主确认封版为准。9/19历史adopt_all不属于本版。' },
    archive: { status: 'pending', reason: '本版归档回执见 docs/migrations/（2026-09-30 jiuqu/stalllight/lantern/ridge）；历史账号/桶不能代替本版回执。' },
    walkTopology: '进入庙内后院后，经原山门返回，再沿现有道路到商城和豫园入口。',
    ownerTasks: ['确认 v1.0 封版（打 v1.0 标签并推送）。'] };
  try {
    const raw = fs.readFileSync(path.resolve(options.manifest || path.join(out, 'zones-manifest.json')));
    state.manifestSha256 = sha(raw); state.budget = runtimeBudget(out, JSON.parse(raw));
  } catch (e) { state.issues.push(e.message); }
  for (const kind of kinds) state.reviews[kind] = review(kind, options.receipts?.[kind], {
    id: options.id, buildHead, manifestSha256: state.manifestSha256, fixture: state.fixture });
  state.technicalStatus = state.budget.status === 'passed' && kinds.every(k => state.reviews[k].status === 'passed') ? 'passed' : 'unverified';
  fs.writeFileSync(output, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), opt = { receipts: {} };
    for (let i = 0; i < args.length; i++) {
      const a = args[i]; if (a === '--fixture' || a === '--strict') { opt[a.slice(2)] = true; continue; }
      const v = args[++i]; if (!v || !a.startsWith('--')) throw Error('option value missing');
      const map = { '--candidate-id': 'id', '--source-head': 'sourceHead', '--build-head': 'buildHead', '--package-head': 'packageHead', '--out-dir': 'out', '--manifest': 'manifest', '--output': 'output' };
      if (map[a]) opt[map[a]] = v;
      else if (/^--(technical|walk|control|restore)-receipt$/.test(a)) opt.receipts[a.slice(2, -8)] = v;
      else throw Error(`unknown option ${a}`);
    }
    if (!opt.out) throw Error('--out-dir required');
    const s = generate(opt); console.log(JSON.stringify({ output: path.join(path.resolve(opt.out), 'candidate-version.json'), technicalStatus: s.technicalStatus, fixture: s.fixture }));
    if (opt.strict && s.technicalStatus !== 'passed') process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
