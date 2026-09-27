// portable 交付/恢复工具回归（返修版）：
//   - R3：不再 fsp.rm 清理——所有 fixture/坏样本保留在盘，路径追加记录到
//     tests/portable-fixtures-record.jsonl（每次运行新增行，不删旧行）；
//   - 闭包推导（R1–R6）与缺件 fail-closed；缺件 fixture 用“构建时就不含目标”构造；
//   - R2：恶意 tar 负例（../、绝对路径、symlink、hardlink、pax 头）在解包前整体拒绝，
//     dest 内外都不产生文件，坏归档保留；
//   - R1：pack 白名单（mini 仓断言 code/ 只含白名单文件，历史路径不进包）；
//   - mini 端到端：pack → verify → 真正空目录 restore（--skip-install --no-browser）
//     → 改一字节/缺纹理/缺GLB 在启动前失败；
//   - 非空 dest 拒绝且原内容原样。
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
import { writeTar, readTar, extractTar, rawTarBlock, TarUnsafeError } from '../tools/portable/tar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_RECORD = path.join(root, 'tests', 'portable-fixtures-record.jsonl');

// R3：保留并登记，绝不删除
async function retain(dir, purpose) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.appendFile(FIXTURE_RECORD, JSON.stringify({
    path: dir, purpose, retainedAt: new Date().toISOString(), pid: process.pid,
  }) + '\n', 'utf8');
  return dir;
}

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
async function makeFixture(base, { omit = [] } = {}) {
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
    if (omit.includes(rel)) continue; // R5 纪律：缺件 = 构建时就不写，而不是先写后删
    await writeFileAbs(path.join(outDir, rel), content);
  }

  const area = path.join(base, 'scene-authoring/yuyuan-area');
  await writeFileAbs(path.join(area, 'web/index.html'),
    '<!doctype html><title>t</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","@dimforge/rapier3d-compat":"/vendor/@dimforge/rapier3d-compat/rapier.mjs"}}</script>');
  await writeFileAbs(path.join(area, 'web/main.js'),
    `fetch('/out/zones-manifest.json');fetch('/out/layout.json');fetch('/out/tour.json');fetch('/out/scene-areas.glb');
     import { WalkController } from '/vendor-src/player/WalkController.js';
     import { selectGround } from '../src/areaGround.js';`);
  await writeFileAbs(path.join(area, 'src/areaGround.js'), 'export const selectGround = () => [];');
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
  // 白名单其余条目（R1 默认白名单要求这些路径在 head 上存在）
  await writeFileAbs(path.join(base, 'package.json'), JSON.stringify({ name: 'root-t', type: 'module' }));
  await writeFileAbs(path.join(base, 'package-lock.json'), JSON.stringify({
    name: 'root-t', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'root-t' }, 'node_modules/@dimforge/rapier3d-compat': { version: '0.19.0' } },
  }));
  await writeFileAbs(path.join(base, 'docs/PORTABLE-RESTORE.md'), '# ops doc\n');
  await writeFileAbs(path.join(base, 'docs/THIRD-PARTY-NOTICES.md'), '# notices\n');
  await writeFileAbs(path.join(base, 'PROJECT.json'), JSON.stringify({ projectId: 'root-t' }));
  // 一条“历史媒体”路径：必须被白名单排除（R1 断言用）
  await writeFileAbs(path.join(base, 'artifacts/adoption-east/frames-b/frame-b-00001.png'), 'NOT-A-REAL-PNG');
  return { outDir, area, base };
}

async function makeGitRepo(base) {
  sh('git', ['init', '-q', base]);
  sh('git', ['-C', base, 'checkout', '-q', '-b', 'main']);
  sh('git', ['-C', base, 'add', '-A']);
  sh('git', ['-C', base, 'commit', '-q', '-m', 'mini fixture'], { env: GITENV });
  return sh('git', ['-C', base, 'rev-parse', 'HEAD']).trim();
}

const PORT = 5603;

// ---- 闭包推导 ----------------------------------------------------------------
test('closure derivation covers R1–R6 + vendor-src + importmap, missing reported otherwise', async () => {
  const base = await retain(path.join(os.tmpdir(), `paw-t-close-${Date.now()}`), 'closure-derivation-fixture');
  const { outDir, area } = await makeFixture(base);
  const c = await deriveRuntimeClosure({ outDir, zonesManifestPath: path.join(outDir, 'zones-manifest.json'), webDir: path.join(area, 'web') });
  const paths = c.files.map((f) => f.path);
  for (const p of ['zones-manifest.json', 'zone-garden.glb', 'zone-garden.cm.glb', 'tex/abc123.jpg',
    'collision-garden.json', 'collision-fangbang.json', 'layout.json', 'tour.json', 'scene-areas.glb']) {
    assert.ok(paths.includes(p), `closure should include ${p}`);
  }
  assert.equal(c.missing.length, 0);
  assert.deepEqual(c.vendorSrc, ['player/WalkController.js']);
  assert.deepEqual(c.areaRelative, ['src/areaGround.js']);
  assert.equal(c.moduleMap.three, '/node_modules/three/build/three.module.js');
  assert.ok(c.files.find((f) => f.path === 'layout.json').rules.some((r) => r.startsWith('R5:web-literal')));
  assert.ok(c.files.find((f) => f.path === 'collision-fangbang.json').rules.some((r) => r.includes('fangbang')));

  // 缺件 fail-closed：cm GLB 与必要纹理缺失时必须列入 missing（构建时即不含，非删除）
  const base2 = await retain(path.join(os.tmpdir(), `paw-t-close2-${Date.now()}`), 'closure-missing-fixture');
  const { outDir: outDir2, area: area2 } = await makeFixture(base2, { omit: ['zone-garden.cm.glb', 'tex/abc123.jpg'] });
  const c3 = await deriveRuntimeClosure({ outDir: outDir2, zonesManifestPath: path.join(outDir2, 'zones-manifest.json'), webDir: path.join(area2, 'web') });
  assert.deepEqual(c3.missing.map((m) => m.path).sort(), ['tex/abc123.jpg', 'zone-garden.cm.glb']);
});

// ---- 路径安全 ----------------------------------------------------------------
test('path escape and no-overwrite guards', async () => {
  const base = await retain(path.join(os.tmpdir(), `paw-t-safe-${Date.now()}`), 'path-guard-fixture');
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

// ---- R2 恶意 tar 负例：解包前整体拒绝，dest 内外零副作用，坏归档保留 -----------
test('hostile tar entries refused before extraction; nothing lands inside or outside dest', async () => {
  const base = await retain(path.join(os.tmpdir(), `paw-t-hostile-${Date.now()}`), 'hostile-tar-fixtures');
  const hostileCases = [
    { name: 'parent-escape', block: rawTarBlock({ name: '../escape.txt', sizeBytes: 5, payload: Buffer.from('evil!') }) },
    { name: 'absolute-path', block: rawTarBlock({ name: 'abs.txt'.padEnd(10, 'x'), sizeBytes: 5, payload: Buffer.from('evil!') }), raw: rawTarBlock({ name: '/tmp/abs-evil.txt', sizeBytes: 5, payload: Buffer.from('evil!') }) },
    { name: 'symlink', block: rawTarBlock({ name: 'link.txt', typeflag: '2', linkName: '/etc/hostname' }) },
    { name: 'hardlink', block: rawTarBlock({ name: 'hard.txt', typeflag: '1', linkName: '/etc/hostname' }) },
    { name: 'pax-header', block: rawTarBlock({ name: 'PaxHeaders/0', typeflag: 'x', sizeBytes: 0 }) },
  ];
  let i = 0;
  for (const c of hostileCases) {
    const valid = writeTar([{ path: 'ok.txt', type: '0', data: Buffer.from('fine') }]);
    const tar = Buffer.concat([
      valid.subarray(0, valid.length - 1024), // 去掉 end blocks 后插入恶意条目
      c.raw || c.block,
      Buffer.alloc(1024),
    ]);
    const badPath = path.join(base, `hostile-${c.name}.tar`);
    await fsp.writeFile(badPath, tar); // 坏归档保留

    const dest = path.join(base, `dest-${i++}`);
    await fsp.mkdir(dest);
    const canaryOutside = path.join(base, 'escape.txt');
    await assert.rejects(() => extractTar(tar, dest), (e) => e instanceof TarUnsafeError, `${c.name} must be refused`);
    // dest 内零文件；dest 外（父目录）也没有逃逸文件
    assert.equal((await fsp.readdir(dest)).length, 0, `${c.name}: dest must stay empty`);
    assert.ok(!(await fsp.stat(canaryOutside).catch(() => null)), `${c.name}: nothing outside dest`);

    // readTar 单独也要拒绝
    assert.throws(() => readTar(tar), TarUnsafeError);
  }
});

// ---- 端到端 mini：pack（白名单）→ verify → restore ----------------------------
async function runTool(toolRel, args) {
  const r = spawnSync(process.execPath, [path.join(root, toolRel), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('mini end-to-end: whitelisted pack → verify pass → restore into empty dir serves probes', async () => {
  const base = await retain(path.join(os.tmpdir(), `paw-t-e2e-${Date.now()}`), 'mini-e2e-fixture');
  const { outDir } = await makeFixture(base);
  const head = await makeGitRepo(base);
  const pkg = path.join(base, 'pkg-mini');

  // 白名单覆盖：在默认白名单之上加入合成 stub node_modules（真实包里由 npm ci 提供）
  const sourcePaths = path.join(base, 'source-paths.json');
  await fsp.writeFile(sourcePaths, JSON.stringify([
    { path: 'scene-authoring/yuyuan-area/web/', why: 'viewer' },
    { path: 'scene-authoring/yuyuan-area/scripts/server.mjs', why: 'server entry' },
    { path: 'scene-authoring/yuyuan-area/package.json', why: 'area deps' },
    { path: 'scene-authoring/yuyuan-area/package-lock.json', why: 'area lock' },
    { path: 'scene-authoring/yuyuan-area/src/', why: 'area src (web relative imports)' },
    { path: 'scene-authoring/yuyuan-area/node_modules/', why: 'synthetic three stub (skip-install probe target)' },
    { path: 'src/', why: 'vendor-src' },
    { path: 'node_modules/', why: 'synthetic rapier stub (skip-install probe target)' },
    { path: 'package.json', why: 'root deps' },
    { path: 'package-lock.json', why: 'root lock' },
    { path: 'docs/PORTABLE-RESTORE.md', why: 'ops doc' },
    { path: 'docs/THIRD-PARTY-NOTICES.md', why: 'notices' },
    { path: 'PROJECT.json', why: 'manifest' },
  ]));

  const pack = await runTool('tools/portable/pack.mjs', [
    '--repo', base, '--head', head, '--out-dir', outDir,
    '--manifest', path.join(outDir, 'zones-manifest.json'), '--out', pkg,
    '--source-paths', sourcePaths, '--tar',
  ]);
  assert.equal(pack.code, 0, `pack failed: ${pack.out}`);

  // R1：包内 code/ 只含白名单路径；历史媒体（artifacts/adoption-east/...）不得进包
  const codeManifest = JSON.parse(await fsp.readFile(path.join(pkg, 'MANIFEST-code.json'), 'utf8'));
  assert.equal(codeManifest.declaredScope, 'area-runtime-only');
  assert.equal(codeManifest.includedFiles + codeManifest.excludedFiles, codeManifest.trackedFilesAtHead);
  assert.ok(!codeManifest.files.some((f) => f.path.includes('artifacts/')), 'historical media excluded');
  assert.ok(codeManifest.files.every((f) => /^[0-9a-f]{40}$/.test(f.gitBlobSha)));
  const pkgListed = JSON.parse(await fsp.readFile(path.join(pkg, 'MANIFEST-package.json'), 'utf8'));
  assert.ok(pkgListed.files.every((f) => !f.path.includes('artifacts/')), 'no historical media anywhere in package');

  const verify = await runTool('tools/portable/verify.mjs', ['--package', pkg + '.tar', '--report', path.join(base, 'verify-report.json')]);
  assert.equal(verify.code, 0, `verify failed: ${verify.out}`);
  assert.match(verify.out, /VERIFY_PASS/);

  // 归档清单可独立重验（sidecar）
  const sidecar = JSON.parse(await fsp.readFile(pkg + '.tar.sha256', 'utf8'));
  const { createHash } = await import('node:crypto');
  const tarSha = createHash('sha256').update(await fsp.readFile(pkg + '.tar')).digest('hex');
  assert.equal(tarSha, sidecar.sha256);

  // 恢复到真正空目录（skip-install：合成 node_modules 已随白名单提交，专测恢复/校验/服务/探针链）
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
  // 恢复树在 dest；runtime 闭包安放到 area OUT_DIR（镜像源布局）
  assert.ok(await fsp.stat(path.join(dest, 'scene-authoring/yuyuan-area/out-mini/zones-manifest.json')));
  assert.ok(await fsp.stat(path.join(dest, 'scene-authoring/yuyuan-area/scripts/server.mjs')));
}, { timeout: 60000 });

test('negative: corrupt one hash / missing texture / missing GLB fail closed BEFORE install+serve', async () => {
  const cases = [
    { name: 'hash-corrupt', omit: null, corruptAfterPack: true },
    { name: 'missing-texture', omit: ['tex/abc123.jpg'], corruptAfterPack: false },
    { name: 'missing-glb', omit: ['zone-garden.cm.glb'], corruptAfterPack: false },
  ];
  let i = 0;
  for (const c of cases) {
    // 每个负例独立 base：缺件 = 构建时就不含（不删除已有文件）
    const base = await retain(path.join(os.tmpdir(), `paw-t-neg-${c.name}-${Date.now()}`), `negative-fixture-${c.name}`);
    const { outDir } = await makeFixture(base, { omit: c.omit ?? [] });
    const head = await makeGitRepo(base);
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

test('negative: restore refuses non-empty dest and keeps its content intact', async () => {
  const base = await retain(path.join(os.tmpdir(), `paw-t-dest-${Date.now()}`), 'nonempty-dest-fixture');
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
