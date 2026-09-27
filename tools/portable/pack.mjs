// tools/portable/pack.mjs — 一条命令生成本地候选交付包。
//
// 源码来自显式指定的 git 提交（--repo --head，git archive，不取工作区脏状态），
// 运行时闭包来自显式指定的 OUT_DIR/--manifest（真实字节 + sha256）。
// 包内自带恢复/校验工具，做到自包含；--source-cache 只是记录给 restore 用的
// 本机离线 npm 缓存路径，打包阶段不复制缓存本身。
//
// 用法：
//   node tools/portable/pack.mjs \
//     --repo <git仓库或worktree> --head <已提交sha> \
//     --out-dir <OUT_DIR目录> --manifest <OUT_DIR/zones-manifest.json> \
//     --out <目标包目录，必须不存在> [--source-cache <npm离线缓存目录>] [--tar] [--area-dir <路径>]
//
// 边界（WAVE1_CONTRACT / ORDER）：
//   - --out 已存在即拒绝（不覆盖既有目录）；
//   - 闭包缺件 → 打包失败并列出缺件清单（fail-closed）；
//   - 代码为指定 head 的 git archive（LFS 件保持指针，运行时不依赖 smudge）；
//   - docs/MIGRATION-ASSETS.json 的 top-level 待归档块如实记为 pending_lead_archive，
//     绝不写成 cloud restored。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEmptyDest, exists, fmtBytes, listFiles, parseArgs, readJson, safeJoin, sha256Buf, sha256File, writeJson } from './lib.mjs';
import { deriveRuntimeClosure } from './closure.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_SCHEMA = 1;

const args = parseArgs(process.argv.slice(2), { flags: ['tar'] });
const req = (k) => { const v = args[k]; if (!v) { console.error(`FAIL missing required --${k}`); process.exit(1); } return String(v); };

const repo = path.resolve(req('repo'));
const head = req('head');
const outDir = path.resolve(req('out-dir'));
const manifestPath = path.resolve(req('manifest'));
const pkgOut = path.resolve(req('out'));
const areaDir = String(args['area-dir'] || 'scene-authoring/yuyuan-area').replace(/\/+$/, '');
const sourceCache = args['source-cache'] ? path.resolve(String(args['source-cache'])) : null;
const wantTar = !!args.tar;

const git = (cmdArgs, cwd = repo) => execFileSync('git', cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---- 0. 前置校验 -----------------------------------------------------------
// 目标不存在 → 新建；存在则必须为空目录，否则拒绝（不覆盖既有目录）。
await assertEmptyDest(pkgOut);
await fsp.mkdir(pkgOut, { recursive: true });
let commit;
try {
  git(['cat-file', '-e', `${head}^{commit}`]);
  commit = git(['rev-parse', `${head}^{commit}`]);
} catch (e) {
  console.error(`FAIL --head ${head} is not a commit reachable in ${repo}: ${e.message}`);
  process.exit(1);
}
const subject = git(['log', '-1', '--format=%s', commit]);
const dirtyCount = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
let remoteUrl = null;
try { remoteUrl = git(['remote', 'get-url', 'origin']); } catch { /* no origin */ }

// ---- 1. 运行时闭包（web 源码按 head 状态扫描，文件字节按 OUT_DIR 现盘） ------
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-pack-'));
try {
  // area web 目录在 head 的文件清单，逐个 git show 到临时目录再扫描 —— 保证
  // 闭包推导与将要恢复的代码状态一致，不受打包机工作区脏文件影响。
  const webPrefix = `${areaDir}/web/`;
  const headFiles = git(['ls-tree', '-r', '--name-only', commit]).split('\n');
  const webFiles = headFiles.filter((f) => f.startsWith(webPrefix));
  if (webFiles.length === 0) {
    console.error(`FAIL ${areaDir}/web/ has no files at ${commit.slice(0, 12)}`);
    process.exit(1);
  }
  const webScanDir = safeJoin(tmp, 'web');
  await fsp.mkdir(webScanDir, { recursive: true });
  for (const f of webFiles) {
    const content = git(['show', `${commit}:${f}`]);
    await fsp.writeFile(safeJoin(webScanDir, path.basename(f)), content, 'utf8');
  }

  const closure = await deriveRuntimeClosure({ outDir, zonesManifestPath: manifestPath, webDir: webScanDir });
  if (closure.missing.length > 0) {
    console.error(`FAIL runtime closure incomplete: ${closure.missing.length} missing in ${outDir}`);
    for (const m of closure.missing) console.error(`  MISSING ${m.path}  (${m.rules.join(', ')})`);
    process.exit(1);
  }
  console.log(`closure: ${closure.totals.files} files, ${fmtBytes(closure.totals.bytes)} ` +
    `(glb=${closure.totals.glb} json=${closure.totals.json} tex=${closure.totals.tex})`);

  // ---- 2. code.tar（指定 head 的 git archive）------------------------------
  const codeTar = safeJoin(pkgOut, 'code.tar');
  // 显式禁用 LFS 过滤：archive 保留指针（运行时闭包才带真实字节，且体积可控）
  const tarBuf = execFileSync('git',
    ['-c', 'filter.lfs.smudge=cat', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false', 'archive', '--format=tar', commit],
    { cwd: repo, maxBuffer: 1024 * 1024 * 512 });
  await fsp.writeFile(codeTar, tarBuf);
  const codeTarSha = sha256Buf(tarBuf);
  const lsTree = git(['ls-tree', '-r', '-l', commit]).split('\n').filter(Boolean);
  const trackedBytes = lsTree.reduce((s, l) => s + (parseInt(l.match(/\s(\d+)\t/) ? RegExp.$1 : '0', 10) || 0), 0);
  await writeJson(safeJoin(pkgOut, 'MANIFEST-code.json'), {
    head: commit,
    headSubject: subject,
    remoteUrlRecordedForProvenanceOnly: remoteUrl,
    packWorktreeDirtyEntries: dirtyCount,
    note: 'code.tar = git archive of the exact commit; LFS-tracked files stay as pointers by design — the runtime closure ships real bytes under runtime/',
    trackedFiles: lsTree.length,
    trackedBytes,
    codeTarBytes: tarBuf.byteLength,
    codeTarSha256: codeTarSha,
  });

  // ---- 3. runtime/ 闭包落盘 ------------------------------------------------
  for (const f of closure.files) {
    const dest = safeJoin(pkgOut, 'runtime', f.path);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(path.resolve(outDir, f.path), dest);
  }
  await writeJson(safeJoin(pkgOut, 'MANIFEST-runtime.json'), {
    sourceOutDir: outDir,
    sourceZonesManifest: manifestPath,
    derivationRules: 'see tools/portable/closure.mjs header (R1–R6)',
    zonesManifest: closure.zonesManifest,
    totals: closure.totals,
    files: closure.files,
  });

  // ---- 4. RESTORE.json（恢复/启动配置）------------------------------------
  const areaLockSha = await fileShaOrCommit(git, commit, `${areaDir}/package-lock.json`);
  const rootLockSha = await fileShaOrCommit(git, commit, 'package-lock.json');
  const migrationAssetsRaw = await gitShowOrNull(git, commit, 'docs/MIGRATION-ASSETS.json');
  await writeJson(safeJoin(pkgOut, 'RESTORE.json'), {
    packageSchema: PACKAGE_SCHEMA,
    createdAt: new Date().toISOString(),
    packTool: 'tools/portable/pack.mjs',
    source: {
      repoRecordedForProvenanceOnly: repo,
      remoteUrlRecordedForProvenanceOnly: remoteUrl,
      head: commit,
      headSubject: subject,
      areaDir,
    },
    layout: {
      codeArchive: 'code.tar',
      runtimeClosureDir: 'runtime/',
      runtimeManifest: 'MANIFEST-runtime.json',
      codeManifest: 'MANIFEST-code.json',
      assetsStatus: 'assets-status.json',
    },
    install: {
      steps: ['npm ci (repo root)', `npm ci (${areaDir})`],
      nodeEngines: 'Node >= 22 (vite 7 / built-in fetch / node:test assumptions)',
      sourceCache: sourceCache, // 本机离线 npm 缓存路径；restore 可 --offline 复用
      offlineNote: sourceCache
        ? 'restore may run npm ci with --cache <sourceCache> --offline; same-machine fresh directory, NOT a W2-tested environment'
        : 'no source cache recorded — restore needs npm registry access unless --source-cache is supplied',
    },
    serve: {
      host: '127.0.0.1',
      port: 5603,
      entry: `${areaDir}/scripts/server.mjs`,
      outDirEnv: path.basename(outDir),
      url: 'http://127.0.0.1:5603/',
    },
    probes: {
      zonesManifest: 'zones-manifest.json',
      byteCompareJson: closure.files.filter((f) => f.path.endsWith('.json')).map((f) => f.path),
      magicProbeGlb: closure.files.filter((f) => f.path.endsWith('.glb')).map((f) => f.path),
      magicProbeTex: closure.files.filter((f) => f.path.startsWith('tex/')).map((f) => f.path),
      moduleMap: closure.moduleMap,
      vendorSrc: closure.vendorSrc,
      entryHtml: 'web/index.html',
    },
    browser: {
      readySignal: 'window.__firstLoadReady === true',
      nonBlankRule: 'canvas lum std255 >= 2 AND dominantShare <= 0.95 (drawImage readback)',
      coreView: '/?zone=core&cam=oblique',
    },
    locks: {
      rootPackageLockSha256Git: rootLockSha,
      areaPackageLockSha256Git: areaLockSha,
    },
    tools: null, // 打包末尾回填
  });

  // ---- 5. assets-status.json（MIGRATION-ASSETS 状态如实转录）--------------
  let assetsStatus;
  if (migrationAssetsRaw == null) {
    assetsStatus = { sourceHead: commit, present: false, status: 'absent_at_head' };
  } else {
    try {
      const ma = JSON.parse(migrationAssetsRaw);
      const pending = {};
      for (const [k, v] of Object.entries(ma)) {
        if (/pending/i.test(k)) pending[k] = { status: 'pending_lead_archive', value: v };
      }
      assetsStatus = {
        sourceHead: commit,
        sourceCommitField: ma.sourceCommit ?? null,
        present: true,
        filesCount: Array.isArray(ma.files) ? ma.files.length : null,
        uniqueBytes: ma.uniqueBytes ?? null,
        storage: ma.storage ?? null,
        state: ma.state ?? null,
        ownerAdopted: ma.ownerAdopted ?? null,
        cloudReceipt: ma.cloudReceipt ?? null,
        cloudReceipts: ma.cloudReceipts ?? null,
        pendingBlocks: pending,
        statusExplicit: {
          cloudRestored: false,
          statement: 'top-level pending blocks are NOT uploaded; this package records them as pending_lead_archive — they are never to be reported as cloud restored',
        },
      };
    } catch (e) {
      assetsStatus = { sourceHead: commit, present: true, status: 'unreadable', error: String(e.message || e) };
    }
  }
  await writeJson(safeJoin(pkgOut, 'assets-status.json'), assetsStatus);

  // ---- 6. 自包含恢复工具 + 薄启动器 + START-HERE --------------------------
  // 注意：包内工具放在 _restore/ 命名空间，避免与恢复后的仓库根 tools/ 相撞。
  const toolNames = (await fsp.readdir(TOOL_DIR)).filter((f) => f.endsWith('.mjs') || f.endsWith('.ps1'));
  const toolVersions = {};
  for (const t of toolNames) {
    const b = await fsp.readFile(path.join(TOOL_DIR, t));
    toolVersions[t] = sha256Buf(b);
    const dst = safeJoin(pkgOut, '_restore', 'portable', t);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.writeFile(dst, b);
  }
  const restoreJsonPath = safeJoin(pkgOut, 'RESTORE.json');
  const restoreJson = await readJson(restoreJsonPath);
  restoreJson.tools = { dir: '_restore/portable/', versions: toolVersions };
  await writeJson(restoreJsonPath, restoreJson);

  await fsp.writeFile(safeJoin(pkgOut, 'START-HERE.zh-CN.md'), startHere(commit, subject, areaDir, path.basename(outDir), sourceCache), 'utf8');

  // ---- 7. MANIFEST-package.json（覆盖包内其余每个文件）--------------------
  const all = await listFiles(pkgOut);
  const entries = [];
  for (const rel of all) {
    if (rel === 'MANIFEST-package.json') continue;
    const abs = safeJoin(pkgOut, rel);
    entries.push({ path: rel, bytes: (await fsp.stat(abs)).size, sha256: await sha256File(abs) });
  }
  await writeJson(safeJoin(pkgOut, 'MANIFEST-package.json'), {
    packageSchema: PACKAGE_SCHEMA,
    createdAt: new Date().toISOString(),
    files: entries,
    totals: { files: entries.length, bytes: entries.reduce((s, f) => s + f.bytes, 0) },
  });

  // ---- 8. 可选归档 tar + 归档清单（sidecar，可独立重验）--------------------
  if (wantTar) {
    const tarPath = pkgOut + '.tar';
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('tar', ['-cf', tarPath, '-C', path.dirname(pkgOut), path.basename(pkgOut)], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('FAIL tar creation failed'); process.exit(1); }
    const tarSha = await sha256File(tarPath);
    const tarBytes = (await fsp.stat(tarPath)).size;
    await fsp.writeFile(tarPath + '.sha256', JSON.stringify({
      archive: path.basename(tarPath), bytes: tarBytes, sha256: tarSha,
      covers: 'MANIFEST-package.json inside the tar re-verifies every file',
      createdAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
    console.log(`archive: ${tarPath} (${fmtBytes(tarBytes)}) sha256=${tarSha.slice(0, 16)}…`);
  }

  const pkgManifest = await readJson(safeJoin(pkgOut, 'MANIFEST-package.json'));
  console.log(`PACKAGE ready ${pkgOut}`);
  console.log(`  head=${commit.slice(0, 12)} (${subject.slice(0, 60)})`);
  console.log(`  files=${pkgManifest.totals.files} bytes=${fmtBytes(pkgManifest.totals.bytes)} ` +
    `(code.tar=${fmtBytes(tarBuf.byteLength)}, runtime=${fmtBytes(closure.totals.bytes)})`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

async function fileShaOrCommit(git, commit, rel) {
  try { return git(['rev-parse', `${commit}:${rel}`]); } catch { return null; }
}
async function gitShowOrNull(git, commit, rel) {
  try { return git(['show', `${commit}:${rel}`]); } catch { return null; }
}

function startHere(commit, subject, areaDir, outDirName, sourceCache) {
  return `# Pawborough 本地候选包 — 启动说明

- 代码 head：\`${commit}\`（${subject}）
- 运行时闭包：\`runtime/\`（恢复时展开到 \`${areaDir}/${outDirName}/\`）
- 本包状态：**delivered_for_lead_review**（本地候选，不等于采用 / 云端归档）

## 恢复并启动（Linux/macOS，Node >= 22）

\`\`\`bash
node _restore/portable/restore.mjs --package <本包目录> --dest <新的空目录> --port 5603${sourceCache ? ` \\\n  --source-cache ${sourceCache}` : ''}
\`\`\`

恢复流程：sha256 全量校验（缺件/坏 hash 在启动前失败）→ npm ci 固定锁文件版本 →
启动 127.0.0.1:5603 → HTTP 探针 → headless 浏览器 core 冷加载非空白证据。
交互运行时服务保持前台；\`--check-and-exit\` 用于自动化验证后退出。

仅校验不恢复：\`node _restore/portable/verify.mjs --package <本包目录>\`。

## 诚实边界

- 同机新目录恢复 ≠ W2 已测环境；W2 真实 GPU 性能 / 人工巡游另行取证。
- \`assets-status.json\` 中 pending 块为 **pending_lead_archive（未上传）**，不是 cloud restored。
- \`runtime/\` 只含查看器实际读取闭包（GLB+外置tex+manifest+collision/layout/tour 等）；
  重建/再生成不在本包范围。
- PowerShell 启动器 \`_restore/portable/serve-windows.ps1\` 仅为薄启动器，Windows 路径未实测。
`;
}
