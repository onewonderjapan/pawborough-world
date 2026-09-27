// tools/portable/pack.mjs — 一条命令生成本地候选交付包（区域 runtime 恢复包）。
//
// R1 源码边界：不再无筛选 git archive 全仓。代码源 = 显式、可复验的路径白名单
//（默认为当前区域 runtime 所需的最小集合，可用 --source-paths <json> 覆盖），
// 逐文件记录原 git head 的 blob SHA + 内容 sha256；历史截图/旧 artifacts/数据集/
// 无关 LFS 指针一律不进包。包声明范围：area-runtime-only —— 本包是“本版区域
// runtime 恢复包”，不声称恢复全部历史数据集。不以删除原仓文件达成瘦身。
//
// 用法：
//   node tools/portable/pack.mjs \
//     --repo <git仓库或worktree> --head <已提交sha> \
//     --out-dir <OUT_DIR目录> --manifest <OUT_DIR/zones-manifest.json> \
//     --out <目标包目录，必须不存在> [--source-cache <npm离线缓存目录>] [--tar] \
//     [--source-paths <白名单json>]
//
// 其余边界与原版一致：--out 已存在非空即拒绝；闭包缺件 fail-closed；
// docs/MIGRATION-ASSETS.json 的 pending 块如实记为 pending_lead_archive。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEmptyDest, exists, fmtBytes, listFiles, parseArgs, readJson, safeJoin, sha256Buf, sha256File, writeJson } from './lib.mjs';
import { deriveRuntimeClosure } from './closure.mjs';
import { writeTar } from './tar.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_SCHEMA = 2;

// R1：显式源码白名单（可被 --source-paths 覆盖）。path 以 '/' 结尾 = 前缀匹配，否则精确匹配。
const DEFAULT_SOURCE_WHITELIST = [
  { path: 'scene-authoring/yuyuan-area/web/', why: '查看器（server 以 /web 提供的页面与模块）' },
  { path: 'scene-authoring/yuyuan-area/scripts/server.mjs', why: '静态服务入口（恢复后 localhost 启动）' },
  { path: 'scene-authoring/yuyuan-area/package.json', why: 'area 依赖声明' },
  { path: 'scene-authoring/yuyuan-area/package-lock.json', why: 'area 固定版本锁文件' },
  { path: 'scene-authoring/yuyuan-area/src/', why: 'area src（web 相对引用如 ../src/walkGround.js，server 以 /src 提供）' },
  { path: 'src/', why: '仓库根 DOM-free 模块（server 以 /vendor-src 提供：步行/物理/地面/GLB 解析/巡游）' },
  { path: 'package.json', why: '仓库根依赖声明（/vendor 提供的 rapier 等）' },
  { path: 'package-lock.json', why: '仓库根固定版本锁文件' },
  // 老提交上可能尚不存在的条目标 required:false —— 缺失记入 whitelistReport，不失败
  { path: 'docs/PORTABLE-RESTORE.md', why: '本包操作文档（旧 head 可能未提交；包内 START-HERE 兜底）', required: false },
  { path: 'docs/THIRD-PARTY-NOTICES.md', why: '第三方许可声明（合法分发所需）' },
  { path: 'PROJECT.json', why: '项目清单/来源说明' },
];

const args = parseArgs(process.argv.slice(2), { flags: ['tar'] });
const req = (k) => { const v = args[k]; if (!v) { console.error(`FAIL missing required --${k}`); process.exit(1); } return String(v); };

const repo = path.resolve(req('repo'));
const head = req('head');
const outDir = path.resolve(req('out-dir'));
const manifestPath = path.resolve(req('manifest'));
const pkgOut = path.resolve(req('out'));
const sourceCache = args['source-cache'] ? path.resolve(String(args['source-cache'])) : null;
const wantTar = !!args.tar;

const git = (cmdArgs, cwd = repo) => execFileSync('git', cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitBuf = (cmdArgs, cwd = repo) => execFileSync('git', cmdArgs, { cwd, maxBuffer: 1024 * 1024 * 256, stdio: ['ignore', 'pipe', 'pipe'] });

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

let whitelist = DEFAULT_SOURCE_WHITELIST;
if (args['source-paths']) {
  const parsed = JSON.parse(await fsp.readFile(path.resolve(String(args['source-paths'])), 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((e) => !e.path || !e.why)) {
    console.error('FAIL --source-paths must be a JSON array of {path, why}');
    process.exit(1);
  }
  whitelist = parsed;
}

// ---- 1. 运行时闭包（web 源码按 head 状态扫描，文件字节按 OUT_DIR 现盘）------
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'paw-pack-'));
try {
  const webPrefix = `${'scene-authoring/yuyuan-area'}/web/`; // area 固定为仓库内标准路径（白名单亦然）
  const headFiles = git(['ls-tree', '-r', '--name-only', commit]).split('\n');
  const webFiles = headFiles.filter((f) => f.startsWith(webPrefix));
  if (webFiles.length === 0) {
    console.error(`FAIL ${webPrefix} has no files at ${commit.slice(0, 12)}`);
    process.exit(1);
  }
  const webScanDir = safeJoin(tmp, 'web');
  await fsp.mkdir(webScanDir, { recursive: true });
  for (const f of webFiles) {
    await fsp.writeFile(safeJoin(webScanDir, path.basename(f)), git(['show', `${commit}:${f}`]), 'utf8');
  }

  const closure = await deriveRuntimeClosure({ outDir, zonesManifestPath: manifestPath, webDir: webScanDir });
  if (closure.missing.length > 0) {
    console.error(`FAIL runtime closure incomplete: ${closure.missing.length} missing in ${outDir}`);
    for (const m of closure.missing) console.error(`  MISSING ${m.path}  (${m.rules.join(', ')})`);
    process.exit(1);
  }
  console.log(`closure: ${closure.totals.files} files, ${fmtBytes(closure.totals.bytes)} ` +
    `(glb=${closure.totals.glb} json=${closure.totals.json} tex=${closure.totals.tex})`);
  console.log(`code references from web: vendor-src=${closure.vendorSrc.length} areaRelative=${closure.areaRelative.length}`);

  // ---- 2. 白名单代码源：ls-tree 精确清点 + cat-file 逐文件取 blob ---------
  const lsTreeAll = git(['ls-tree', '-r', '-l', commit]).split('\n').filter(Boolean);
  const totalTracked = lsTreeAll.length;
  const lsTreeMap = new Map(); // path -> {sha, size}
  for (const line of lsTreeAll) {
    const m = line.match(/^(\d+) blob (\S+)\s+(\d+)\t(.*)$/); // -l 的 size 列左填充空格
    if (m) lsTreeMap.set(m[4], { sha: m[2], size: parseInt(m[3], 10) });
  }
  const selected = new Map(); // path -> {sha, size, why}
  const whitelistReport = [];
  for (const rule of whitelist) {
    let matched = 0;
    for (const [p, meta] of lsTreeMap) {
      const hit = rule.path.endsWith('/') ? p.startsWith(rule.path) : p === rule.path;
      if (hit) { selected.set(p, { ...meta, why: rule.why }); matched++; }
    }
    whitelistReport.push({ path: rule.path, required: rule.required !== false, matched });
    if (matched === 0 && rule.required !== false) {
      console.error(`FAIL whitelist entry matched nothing at ${commit.slice(0, 12)}: ${rule.path}`);
      process.exit(1);
    }
  }
  const codeFiles = [];
  for (const [p, meta] of [...selected].sort()) {
    const blob = gitBuf(['cat-file', 'blob', meta.sha]);
    // LFS 指针守卫：白名单内不允许出现指针文件（runtime 需要真实可用的文本/源码）
    if (blob.subarray(0, 25).toString('utf8') === 'version https://git-lfs/') {
      console.error(`FAIL whitelist file is an LFS pointer (runtime needs real bytes or exclusion): ${p}`);
      process.exit(1);
    }
    const dest = safeJoin(pkgOut, 'code', p);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, blob);
    codeFiles.push({ path: p, gitBlobSha: meta.sha, bytes: blob.length, sha256: sha256Buf(blob), why: meta.why });
  }
  console.log(`code: ${codeFiles.length} files (whitelist) of ${totalTracked} tracked — ` +
    `excluded ${totalTracked - codeFiles.length} historical/irrelevant paths`);

  // 代码引用闭包校验：web 相对引用（如 ../src/walkGround.js）必须被白名单覆盖
  const areaPrefix = 'scene-authoring/yuyuan-area/';
  const uncoveredRefs = closure.areaRelative.filter((rel) => !selected.has(areaPrefix + rel));
  if (uncoveredRefs.length > 0) {
    console.error(`FAIL web code references not covered by whitelist (would 404 at runtime): ${uncoveredRefs.join(', ')}`);
    process.exit(1);
  }

  await writeJson(safeJoin(pkgOut, 'MANIFEST-code.json'), {
    head: commit,
    headSubject: subject,
    declaredScope: 'area-runtime-only',
    scopeStatement: '本包是本版区域 runtime 恢复包（代码白名单 + 运行时闭包）；不声称恢复全部历史数据集、截图或 artifacts',
    sourcePathWhitelist: whitelist,
    whitelistReport,
    sourcePathsOverride: args['source-paths'] ? path.resolve(String(args['source-paths'])) : null,
    trackedFilesAtHead: totalTracked,
    includedFiles: codeFiles.length,
    excludedFiles: totalTracked - codeFiles.length,
    exclusionNote: '历史截图/旧 artifacts/数据集/无关媒体与其 LFS 指针按白名单排除；未修改原仓库任何文件',
    files: codeFiles,
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
  const areaDir = 'scene-authoring/yuyuan-area';
  const areaLockSha = await fileShaOrCommit(commit, `${areaDir}/package-lock.json`);
  const rootLockSha = await fileShaOrCommit(commit, 'package-lock.json');
  const migrationAssetsRaw = await gitShowOrNull(commit, 'docs/MIGRATION-ASSETS.json');
  await writeJson(safeJoin(pkgOut, 'RESTORE.json'), {
    packageSchema: PACKAGE_SCHEMA,
    createdAt: new Date().toISOString(),
    packTool: 'tools/portable/pack.mjs',
    declaredScope: 'area-runtime-only',
    source: {
      repoRecordedForProvenanceOnly: repo,
      remoteUrlRecordedForProvenanceOnly: remoteUrl,
      head: commit,
      headSubject: subject,
      areaDir,
    },
    layout: {
      codeDir: 'code/', // 白名单源码（恢复时展平到恢复根，镜像仓库布局）
      codeManifest: 'MANIFEST-code.json',
      runtimeClosureDir: 'runtime/',
      runtimeManifest: 'MANIFEST-runtime.json',
      assetsStatus: 'assets-status.json',
    },
    install: {
      steps: ['npm ci (repo root)', `npm ci (${areaDir})`],
      nodeEngines: 'Node >= 22 (vite 7 / built-in fetch / node:test assumptions)',
      sourceCache: sourceCache,
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
      areaSrcRefs: closure.areaRelative,
      entryHtml: 'web/index.html',
    },
    browser: {
      readySignal: 'window.__firstLoadReady === true + default-loadPolicy zones all loaded + no module/asset request failures',
      nonBlankRule: 'canvas lum std255 >= 2 AND dominantShare <= 0.95 (same-evaluate render via double requestAnimationFrame + drawImage readback)',
      coreView: '/?zone=core&cam=oblique',
      browserExecutable: null, // restore 可 --browser-executable 显式指定（S1 实测：chromium-1234 + --enable-unsafe-swiftshader）
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

  // ---- 8. 可选归档（自写 ustar + 归档清单 sidecar，可独立重验）------------
  if (wantTar) {
    const tarEntries = [];
    const tarFiles = await listFiles(pkgOut); // 重新列举：必须包含刚写好的 MANIFEST-package.json
    for (const rel of tarFiles) {
      const abs = safeJoin(pkgOut, rel);
      const st = await fsp.stat(abs);
      if (st.size > 1024 * 1024 * 1024) throw new Error(`FILE_TOO_LARGE_FOR_TAR: ${rel}`);
      tarEntries.push({ path: `${path.basename(pkgOut)}/${rel}`, type: '0', data: await fsp.readFile(abs) });
    }
    const tarPath = pkgOut + '.tar';
    await fsp.writeFile(tarPath, writeTar(tarEntries));
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
    `(code=${codeFiles.length} whitelist files, runtime=${fmtBytes(closure.totals.bytes)})`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

async function fileShaOrCommit(commit, rel) {
  try { return git(['rev-parse', `${commit}:${rel}`]); } catch { return null; }
}
async function gitShowOrNull(commit, rel) {
  try { return git(['show', `${commit}:${rel}`]); } catch { return null; }
}

function startHere(commit, subject, areaDir, outDirName, sourceCache) {
  return `# Pawborough 本地候选包 — 启动说明

- 代码 head：\`${commit}\`（${subject}），按显式白名单打包（area-runtime-only）
- 运行时闭包：\`runtime/\`（恢复时展开到 \`${areaDir}/${outDirName}/\`）
- 本包状态：**delivered_for_lead_review**（本地候选，不等于采用 / 云端归档）
- 范围声明：本版**区域 runtime 恢复包**；不声称恢复全部历史数据集/截图/artifacts

## 恢复并启动（Linux/macOS，Node >= 22）

\`\`\`bash
node _restore/portable/restore.mjs --package <本包目录或.tar> --dest <新的空目录> --port 5603${sourceCache ? ` \\\n  --source-cache ${sourceCache}` : ''}
\`\`\`

恢复流程：归档条目与 sha256 全量校验（缺件/坏 hash 在启动前失败）→ npm ci 固定锁文件版本 →
启动 127.0.0.1:5603 → HTTP 归因探针 → headless 浏览器 core 冷加载：分区完成核验 + 非空白
（同次 evaluate 内 RAF 渲染后回读像素；PNG 与像素数据落盘）。可用
\`--browser-executable <chrome路径>\` 显式指定浏览器（S1 实测：chromium-1234 +
--enable-unsafe-swiftshader/--disable-dev-shm-usage）。自动化验证加 \`--check-and-exit\`。

仅校验不恢复：\`node _restore/portable/verify.mjs --package <本包目录或.tar>\`。

## 诚实边界

- 同机新目录恢复 ≠ W2 已测环境；S1 性能不替代 W2 真实 GPU 性能 / 人工巡游。
- \`assets-status.json\` 中 pending 块为 **pending_lead_archive（未上传）**，不是 cloud restored。
- \`runtime/\` 只含查看器实际读取闭包；重建/再生成不在本包范围。
- PowerShell 启动器 \`_restore/portable/serve-windows.ps1\` 仅为薄启动器，Windows 路径未实测。
`;
}
