// portable 交付/恢复工具回归：
//   - 闭包推导（R1–R6 规则、vendor-src、importmap）与缺件 fail-closed；
//   - 路径逃逸防护与“不覆盖既有目录”；
//   - mini 仓库端到端：pack → verify → 空目录 restore（--skip-install --no-browser）
//     → 改一字节/缺纹理/缺 GLB 三种坏样本在启动前失败（坏样本保留，原件不动）。
// 全部合成小件，无网络、无 npm ci、无 Blender。
import { execFileSync, spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { deriveRuntimeClosure } from '../tools/portable/closure.mjs';
import { assertEmptyDest, copyTree, safeJoin, safeTarName } from '../tools/portable/lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function dirname(u) { return path.dirname(u); }
function resolve(...a) { return path.resolve(...a); }

const GITENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

async function writeFileAbs(p, content) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf8');
}

// ---- 合成 OUT_DIR + area web ------------------------------------------------
async function makeFixture(base, { omit = [], corrupt = [] } = {}) {
  const outDir = path.join(base, 'out-mini');
  const manifest = {
    schema: 2, capPerZoneBytes: 12000000, order: ['garden'],
    zones: [{
      id: 'garden', part: 1, file: 'zone-garden.glb', bytes: 16, collections: [], objects: 1,
      bounds: [[0, 0, 0], [1, 1, 1]], withinCap: true,
      cm: { file: 'zone-garden.cm.glb', bytes: 12, sha256: 'x', ratio: 0.5, positionBits: 16, validatorErrors: 0, validatorWarnings: 0, withinCap: true, textures: ['tex/abc123.jpg'] },
    }],
    textures: { 'tex/abc123.jpg': { bytes: 8 } },
  };
  await writeFileAbs(path.join(outDir, 'zones-manifest.json'), JSON.stringify(manifest));
  const files = {
    'zone-garden.glb': 'glTF' + 'raw-garden-payload',
    'zone-garden.cm.glb': 'glTF' + 'cm-payload',
    'tex/abc123.jpg': 'texdata8',
    'collision-garden.json': '{"colliders":[]}',
    'collision-fangbang.json': '{"colliders":[]}',
    'layout.json': '{"blocks":[]}',
    'tour.json': '{"shots":[]}',
    'scene-areas.glb': 'glTFlegacy',
  };
  for (const [rel, content] of Object.entries(files)) {
    let c = content;
    if (corrupt.includes(rel)) c = content.slice(0, -1) + 'X'; // 改一字节
    await writeFileAbs(path.join(outDir, rel), c);
  }
  for (const rel of omit) await fsp.rm(path.join(outDir, rel), { force: true });

  const area = path.join(base, 'scene-authoring/yuyuan-area');
  await writeFileAbs(path.join(area, 'web/index.html'),
    '<!doctype html><title>t</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","@dimforge/rapier3d-compat":"/vendor/@dimforge/rapier3d-compat/rapier.mjs"}}</script>');
  await writeFileAbs(path.join(area, 'web/main.js'),
    `fetch('/out/zones-manifest.json');fetch('/out/layout.json');fetch('/out/tour.json');fetch('/out/scene-areas.glb');
     import { WalkController } from '/vendor-src/player/WalkController.js';`);
  await writeFileAbs(path.join(area, 'scripts/server.mjs'),
    await fsp.readFile(path.join(root, 'scene-authoring/yuyuan-area/scripts/server.mjs'), 'utf8'));
  await writeFileAbs(path.join(area, 'package.json'), JSON.stringify({ name: 'area-t', type: 'module' }));
  await writeFileAbs(path.join(area, 'package-lock.json'), JSON.stringify({
    name: 'area-t', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'area-t' }, 'node_modules/three': { version: '0.180.0' } },
  }));
  // 探针可达件：area node_modules three、root node_modules rapier、root src vendor-src
  await writeFileAbs(path.join(area, 'node_modules/three/build/three.module.js'), 'export {} // three stub');
  await writeFileAbs(path.join(base, 'node_modules/@dimforge/rapier3d-compat/rapier.mjs'), 'export {} // rapier stub');
  await writeFileAbs(path.join(base, 'src/player/WalkController.js'), 'export class WalkController {}');
  await writeFileAbs(path.join(base, 'package.json'), JSON.stringify({ name: 'root-t', type: 'module' }));
  await writeFileAbs(path.join(base, 'package-lock.json'), JSON.stringify({
    name: 'root-t', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'root-t' }, 'node_modules/@dimforge/rapier3d-compat': { version: '0.19.0' } },
  }));
  return { outDir, area, base };
}

async function makeGitRepo(base) {
  sh('git', ['init', '-q', base]);
  sh('git', ['-C', base, 'checkout', '-q', '-b', 'main']);
  sh('git', ['-C', base, 'add', '-A']);
  sh('git', ['-C', base, 'commit', '-q', '-m', 'mini fixture'], { env: GITENV });
  return sh('git', ['-C', base, 'rev-parse', 'HEAD']).trim();
}

const PORT = 5599;

// ---- 闭包推导 ----------------------------------------------------------------
test('closure derivation covers R1–R6 + vendor-src + importmap, missing reported otherwise', async (t) => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-t-close-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const { outDir, area } = await makeFixture(base);
  const c = await deriveRuntimeClosure({ outDir, zonesManifestPath: path.join(outDir, 'zones-manifest.json'), webDir: path.join(area, 'web') });
  const paths = c.files.map((f) => f.path);
  for (const p of ['zones-manifest.json', 'zone-garden.glb', 'zone-garden.cm.glb', 'tex/abc123.jpg',
    'collision-garden.json', 'collision-fangbang.json', 'layout.json', 'tour.json', 'scene-areas.glb']) {
    assert.ok(paths.includes(p), `closure should include ${p}`);
  }
  assert.equal(c.missing.length, 0);
  assert.deepEqual(c.vendorSrc, ['player/WalkController.js']);
  assert.equal(c.moduleMap.three, '/node_modules/three/build/three.module.js');

  const c2 = await deriveRuntimeClosure({ outDir, zonesManifestPath: path.join(outDir, 'zones-manifest.json'), webDir: path.join(area, 'web') });
  assert.ok(c2.files.find((f) => f.path === 'layout.json').rules.some((r) => r.startsWith('R5:web-literal')));
  assert.ok(c2.files.find((f) => f.path === 'collision-fangbang.json').rules.some((r) => r.includes('fangbang')));

  // 缺件 fail-closed：cm GLB 与必要纹理缺失时必须列入 missing
  const base2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-t-close2-'));
  t.after(() => fsp.rm(base2, { recursive: true, force: true }));
  const { outDir: outDir2, area: area2 } = await makeFixture(base2, { omit: ['zone-garden.cm.glb', 'tex/abc123.jpg'] });
  const c3 = await deriveRuntimeClosure({ outDir: outDir2, zonesManifestPath: path.join(outDir2, 'zones-manifest.json'), webDir: path.join(area2, 'web') });
  assert.deepEqual(c3.missing.map((m) => m.path).sort(), ['tex/abc123.jpg', 'zone-garden.cm.glb']);
});

// ---- 路径安全 ----------------------------------------------------------------
test('path escape and no-overwrite guards', async (t) => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-t-safe-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  assert.throws(() => safeJoin(base, '../outside'));
  assert.throws(() => safeTarName('../evil'));
  assert.throws(() => safeTarName('/abs'));
  assert.doesNotThrow(() => safeTarName('a/b/c.txt'));

  const dest = path.join(base, 'dest');
  await fsp.mkdir(dest);
  await fsp.writeFile(path.join(dest, 'existing.txt'), 'keep');
  await assert.rejects(() => assertEmptyDest(dest), /DEST_NOT_EMPTY/);
  // 拒绝后原内容原样保留
  assert.equal(await fsp.readFile(path.join(dest, 'existing.txt'), 'utf8'), 'keep');

  const src = path.join(base, 'src-with-link');
  await fsp.mkdir(src);
  await fsp.writeFile(path.join(src, 'f.txt'), 'x');
  await fsp.symlink('/etc/hostname', path.join(src, 'link'));
  await assert.rejects(() => copyTree(src, path.join(base, 'copy')), /SYMLINK_IN_SOURCE/);
});

// ---- 端到端 mini：pack → verify → restore ------------------------------------
async function runTool(toolRel, args) {
  const r = spawnSync(process.execPath, [path.join(root, toolRel), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('mini end-to-end: pack → verify pass → restore into empty dir serves probes', async (t) => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-t-e2e-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const { outDir } = await makeFixture(base);
  const head = await makeGitRepo(base);
  const pkg = path.join(base, 'pkg-mini');

  const pack = await runTool('tools/portable/pack.mjs', [
    '--repo', base, '--head', head, '--out-dir', outDir,
    '--manifest', path.join(outDir, 'zones-manifest.json'), '--out', pkg, '--tar',
  ]);
  assert.equal(pack.code, 0, `pack failed: ${pack.out}`);
  assert.ok((await fsp.stat(pkg + '.tar')).size > 0);

  const verify = await runTool('tools/portable/verify.mjs', ['--package', pkg + '.tar', '--report', path.join(base, 'verify-report.json')]);
  assert.equal(verify.code, 0, `verify failed: ${verify.out}`);
  assert.match(verify.out, /VERIFY_PASS/);

  // 归档清单可独立重验（sidecar）
  const sidecar = JSON.parse(await fsp.readFile(pkg + '.tar.sha256', 'utf8'));
  const { createHash } = await import('node:crypto');
  const tarSha = createHash('sha256').update(await fsp.readFile(pkg + '.tar')).digest('hex');
  assert.equal(tarSha, sidecar.sha256);

  // 恢复到真正空目录（skip-install：合成 node_modules 已随代码提交，专测恢复/校验/服务/探针链）
  const dest = path.join(base, 'restore-1');
  const restore = await runTool('tools/portable/restore.mjs', [
    '--package', pkg + '.tar', '--dest', dest, '--port', String(PORT),
    '--skip-install', '--no-browser', '--check-and-exit', '--evidence-dir', path.join(base, 'ev1'),
  ]);
  assert.equal(restore.code, 0, `restore failed: ${restore.out}`);
  assert.match(restore.out, /RESTORE_PASS/);
  const report = JSON.parse(await fsp.readFile(path.join(base, 'ev1', 'restore-report.json'), 'utf8'));
  assert.equal(report.pass, true);
  assert.equal(report.postRestore.mismatches, 0);
  assert.equal(report.postRestore.missing.length, 0);
  assert.ok(report.stages.probes.length >= 10, `probes ran: ${report.stages.probes.length}`);
  assert.ok(report.stages.probes.every((p) => p.ok), JSON.stringify(report.stages.probes.filter((p) => !p.ok)));
  // 恢复树在 dest 而不是逃逸；runtime 闭包安放到 area OUT_DIR（镜像源布局）
  assert.ok(await fsp.stat(path.join(dest, 'scene-authoring/yuyuan-area/out-mini/zones-manifest.json')));
  assert.ok(await fsp.stat(path.join(dest, 'scene-authoring/yuyuan-area/scripts/server.mjs')));
}, { timeout: 60000 });

test('negative: corrupt one hash / missing texture / missing GLB fail closed BEFORE install+serve', async (t) => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-t-neg-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const first = await makeFixture(base);          // 先落 fixture，再提交（pack 源 = 已提交 head）
  const head = await makeGitRepo(base);

  // 三个坏样本：改一字节 / 缺必要纹理 / 缺 GLB。原件不动（每个用独立 fixture 状态），
  // 坏样本与失败报告全部保留。
  const cases = [
    { name: 'hash-corrupt', fixture: first, corruptAfterPack: true },
    { name: 'missing-texture', fixture: null, omit: ['tex/abc123.jpg'] },
    { name: 'missing-glb', fixture: null, omit: ['zone-garden.cm.glb'] },
  ];
  let i = 0;
  for (const c of cases) {
    const { outDir } = c.fixture || await makeFixture(base, { omit: c.omit });
    const pkg = path.join(base, `pkg-bad-${c.name}`);
    const pack = await runTool('tools/portable/pack.mjs', [
      '--repo', base, '--head', head, '--out-dir', outDir,
      '--manifest', path.join(outDir, 'zones-manifest.json'), '--out', pkg,
    ]);
    if (c.corruptAfterPack) {
      assert.equal(pack.code, 0, 'pack succeeds — corruption is introduced after packing, like a bad transfer');
      const victim = path.join(pkg, 'runtime', 'tex', 'abc123.jpg');
      await fsp.writeFile(victim, (await fsp.readFile(victim, 'utf8')).slice(0, -1) + 'Z');
    } else {
      // 缺纹理/缺 GLB 的 OUT_DIR 本身闭包不全：pack 必须 fail-closed 拒绝打包
      assert.equal(pack.code, 1, `${c.name}: pack must refuse incomplete closure`);
      assert.match(pack.out, /MISSING/);
      // 坏样本保留：OUT_DIR 目录仍在
      assert.ok(await fsp.stat(outDir));
      continue;
    }
    const dest = path.join(base, `restore-bad-${i++}`);
    const restore = await runTool('tools/portable/restore.mjs', [
      '--package', pkg, '--dest', dest, '--port', String(PORT),
      '--skip-install', '--no-browser', '--check-and-exit', '--evidence-dir', path.join(base, `ev-bad-${c.name}`),
    ]);
    assert.notEqual(restore.code, 0, `${c.name}: restore must fail`);
    assert.match(restore.out, /RESTORE_FAIL/);
    // fail-closed 在 install/serve 之前：恢复树里不应出现任何安装痕迹
    assert.ok(!(await fsp.stat(path.join(dest, 'node_modules')).catch(() => null)));
    const report = JSON.parse(await fsp.readFile(path.join(base, `ev-bad-${c.name}`, 'restore-report.json'), 'utf8'));
    assert.equal(report.pass, false);
    assert.ok(report.stages.verify.checks.some((k) => !k.ok), c.name);
    assert.ok(!/server up/.test(restore.out), `${c.name}: server must not start`);
  }
}, { timeout: 60000 });

test('negative: restore refuses non-empty dest and keeps its content intact', async (t) => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-t-dest-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const { outDir } = await makeFixture(base);
  const head = await makeGitRepo(base);
  const pkg = path.join(base, 'pkg-mini');
  const pack = await runTool('tools/portable/pack.mjs', [
    '--repo', base, '--head', head, '--out-dir', outDir,
    '--manifest', path.join(outDir, 'zones-manifest.json'), '--out', pkg,
  ]);
  assert.equal(pack.code, 0, pack.out);

  const dest = path.join(base, 'occupied');
  await fsp.mkdir(dest);
  await fsp.writeFile(path.join(dest, 'precious.txt'), 'do-not-touch');
  const restore = await runTool('tools/portable/restore.mjs', [
    '--package', pkg, '--dest', dest, '--skip-install', '--no-browser', '--check-and-exit',
    '--evidence-dir', path.join(base, 'ev-dest'),
  ]);
  assert.notEqual(restore.code, 0);
  assert.match(restore.out, /DEST_NOT_EMPTY/);
  assert.equal(await fsp.readFile(path.join(dest, 'precious.txt'), 'utf8'), 'do-not-touch');
});
