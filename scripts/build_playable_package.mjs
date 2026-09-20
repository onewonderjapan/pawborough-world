// world-playable-night 20260920 — portable local package builder.
// vite-builds the site (world-preview.html + fangbang.html + gallery inputs)
// into a NEW dist-world-playable directory (--emptyOutDir false; the builder
// REFUSES to touch an existing directory instead of deleting it), carries the
// verified fangbang-temple-v7 dependency closure + optional skins/props, adds
// launcher scripts / README / provenance manifest, and gates the result:
// built html must be bundle-backed, no workspace/absolute paths anywhere, and
// every closure file must exist byte-identical at its relative path.
//
// Runability (browser smoke) lives in tools/playable_package_game_smoke.mjs so
// this build step stays fast and deterministic.
//
// Run:   node scripts/build_playable_package.mjs            (fresh build)
//        node scripts/build_playable_package.mjs --repair   (additive: copy ONLY
//        missing closure files into an existing package dir, then re-verify and
//        regenerate the manifest — never deletes or overwrites world payloads)
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'dist-world-playable';
const REPAIR = process.argv.includes('--repair');
const DATASET = 'fangbang-temple-v7';
const EXPECT_BASE = 694430, EXPECT_ALLON = 708066;   // measured two-config budgets
const sha = (b) => createHash('sha256').update(b).digest('hex');
const outDir = resolve(root, OUT);

// ---- 0. directory policy ------------------------------------------------------
{
  const st = await stat(outDir).catch(() => null);
  if (REPAIR) {
    if (!st) {
      console.error(`REPAIR_REFUSED: ${OUT} 不存在（repair 只面向已构建目录）。请先完整构建。`);
      process.exit(1);
    }
  } else if (st) {
    console.error(`BUILD_REFUSED: ${OUT} 已存在。为不删除任何旧产物，请先确认后改用新的输出目录（或对既有目录使用 --repair 只增修复）。`);
    process.exit(1);
  }
}

// ---- 1. vite build (skipped in repair mode: the dir is never emptied) ---------
if (!REPAIR) {
  const vite = spawnSync(process.execPath, ['node_modules/.bin/vite', 'build', '--outDir', OUT, '--emptyOutDir', 'false'],
    { cwd: root, stdio: 'inherit' });
  if (vite.status !== 0) process.exit(vite.status ?? 1);
}

// ---- 2. built-entry gates ------------------------------------------------------
for (const page of ['world-preview.html', 'fangbang.html']) {
  const html = await readFile(resolve(outDir, page), 'utf8');
  if (/\/src\/(fangbangMain|worldPreview\/previewMain)\.js/.test(html))
    throw new Error(`dist ${page} still points at source /src/*.js`);
  if (!/assets\/.*\.js/.test(html)) throw new Error(`dist ${page} has no bundled script`);
  if (/\/home\/|file:\/\//.test(html)) throw new Error(`dist ${page} leaks absolute/workspace paths`);
}

// ---- 3. v7 dependency closure (verified lane-b closure, reused verbatim) ------
const m = JSON.parse(await readFile(resolve(root, `world/${DATASET}/review-manifest.json`), 'utf8'));
const blocks = JSON.parse(await readFile(resolve(root, `world/${DATASET}/blocks.json`), 'utf8'));
const files = new Set([
  `world/${DATASET}/review-manifest.json`, `world/${DATASET}/instances.json`,
  `world/${DATASET}/collision-world.json`, `world/${DATASET}/route.json`,
  `world/${DATASET}/cameras.json`, `world/${DATASET}/blocks.json`,
  `world/${DATASET}/street-reviewed-lanes.glb`,
  m.worldAssembly.path.slice(2),
  m.streetCompletion.surface.path.slice(2),
  m.streetCompletion.eastTailSurface.path.slice(2),
  m.westExtension.surface.path.slice(2), m.westExtension.sealWall.path.slice(2),
  ...(m.eastExtension ? [m.eastExtension.surface.path.slice(2), m.eastExtension.sealWall.path.slice(2)] : []),
  ...(m.templeAxis?.assets ?? []).flatMap((a) => [a.glb.replace('./', '')]),
]);
for (const b of blocks.blocks) {
  if (b.kind !== 'assets') continue;
  for (const a of b.assets ?? []) {
    for (const p of [a.glb, a.collision]) {
      if (p === undefined) continue;
      if (typeof p !== 'string' || !p.startsWith('./')) throw new Error(`asset path escapes site root: ${p}`);
      files.add(p.slice(2));
    }
  }
}
// optional skins/props configuration must also run from the package
for (const extra of ['world/street-sidefaces/review-manifest.json', 'world/street-sidefaces/collision-world.json',
  'world/street-sidefaces/instances.json', 'world/street-props/review-manifest.json',
  'world/street-props/instances.json', 'world/street-props/collision.json'])
  files.add(extra);
const sk = JSON.parse(await readFile(resolve(root, 'world/street-sidefaces/review-manifest.json'), 'utf8'));
for (const k of sk.skins ?? []) files.add(k.glb.replace('./', ''));
const pr = JSON.parse(await readFile(resolve(root, 'world/street-props/review-manifest.json'), 'utf8'));
for (const [, a] of Object.entries(pr.assets ?? {})) files.add(a.file.replace('./', ''));

const skip = (f) => f.endsWith('.blend') || f.endsWith('.blend1') || f.endsWith('.py');
const closure = {};
const missing = [];
for (const f of files) {
  if (skip(f)) continue;
  const src = resolve(root, f), dst = resolve(outDir, f);
  try {
    const b = await readFile(src);
    if (b.length === 0) throw new Error('empty');
    if (REPAIR) {
      // additive: only ABSENT files are copied in; existing payloads must
      // already match the source byte-exactly (verified, not overwritten)
      const cur = await stat(dst).catch(() => null);
      if (cur) {
        const have = await readFile(dst);
        if (have.length !== b.length || sha(have) !== sha(b)) throw new Error(`existing copy differs from source: ${f}`);
        closure[f] = { bytes: b.length, sha256: sha(b) };
        continue;
      }
    }
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    closure[f] = { bytes: b.length, sha256: sha(b) };
  } catch (e) {
    if (String(e).includes('differs from source')) { console.error('REPAIR_CONFLICT', String(e)); process.exit(1); }
    missing.push(f);
  }
}
if (missing.length) { console.error('PACKAGE_INCOMPLETE', missing); process.exit(1); }

// ---- 4. launcher scripts + README (repair mode fills only ABSENT files) -------
const ensureFile = async (dst, content) => {
  if (REPAIR && (await stat(dst).catch(() => null))) return;
  await (typeof content === 'string'
    ? writeFile(dst, content, 'utf8')
    : copyFile(content, dst));
};
await ensureFile(resolve(outDir, 'start-world-playable.py'), resolve(root, 'scripts/playable_package_serve.py'));
await ensureFile(resolve(outDir, 'start-world-playable.mjs'), resolve(root, 'scripts/playable_package_serve.mjs'));

const galleryManifest = JSON.parse(await readFile(resolve(root, 'src/worldPreview/galleryManifest.json'), 'utf8'));
const readme = `# 方浜市声 · 本地试玩包（world-playable-night 20260920）

这是 Pawborough「方浜市声」世界候选 **fangbang-temple-v7** 的本地便携试玩包。
纯静态文件：无安装、无联网、无外部统计。

## 启动（一条命令）

优先使用 python3 标准库（推荐）：

    python3 start-world-playable.py            # 默认 http://127.0.0.1:5411
    python3 start-world-playable.py 5412       # 指定端口

没有 python3 时用 Node 备选（同机已装 Node 即可，不自动安装任何环境）：

    node start-world-playable.mjs

端口被占用时会明确报错并退出，不会杀掉占用端口的进程。
启动后打开 **world-preview.html**（首页），从主街 / A弄 / B弄 / 庙前任选出发点进入。

## 试玩

- 首页选择出发点 →「开始探索」进入行走；首页「先看场景」看四处实景与修整前后对照。
- 游戏页：WASD 行走 · 鼠标环视 · P 暂停 · V 取景/行走切换 · 空格小跳 · Esc 暂停。
- 「场景总览」随时回到首页；旧入口 fangbang.html 直接打开也保留。
- 画面选项里的「全开」（沿街立面换装 + 街面物件）资源较多；默认普通配置。

## 内容与来源

- \`world/\` 为 fangbang-temple-v7 数据集及其依赖闭包（\`package-manifest.json\` 有逐文件字节与 SHA-256）。
- 网页与图库图片为构建产物（\`assets/\`），来源与哈希见 \`package-manifest.json\` 的 provenance 段。
- **不含** Blender 源工程、历史渲染视频或完整工作区；源工程保留在工作区
  \`world/lane-b-polish/\` 等目录，重开方式见首页「制作资料」。

## 已知问题（截至打包）

- v7 为候选：机主尚未采用（ownerAdopted=false）。
- 三角形预算：默认 694,430（上限 700,000 达标）；全开 ${EXPECT_ALLON.toLocaleString()}，超目标 8,066。
- 上游交付清单含两个未随提交的 .blend1 备份条目（UP-G1），不影响本包。
- 无帧率宣传：本包在同机 Chrome + SwiftShader 软件渲染下验证，无有效硬件实测。
`;
await ensureFile(resolve(outDir, 'README.md'), readme);

// ---- 5. package manifest (files + provenance; hashes verified below) ----------
const walkDist = async (dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkDist(p));
    else out.push(p);
  }
  return out;
};
const allFiles = (await walkDist(outDir)).map((p) => relative(outDir, p).replaceAll('\\', '/')).sort();
const manifestFiles = {};
for (const rel of allFiles) {
  if (rel === 'package-manifest.json') continue;   // never self-hash (the 20260920 lesson)
  const b = await readFile(resolve(outDir, rel));
  manifestFiles[rel] = { bytes: b.length, sha256: sha(b) };
}
const head = await (async () => { try {
  const { execSync } = await import('node:child_process');
  return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
} catch { return null; } })();

const manifest = {
  package: 'world-playable-night-20260920',
  generatedBy: 'scripts/build_playable_package.mjs',
  builtFromHead: head,
  dataset: DATASET,
  budgets: { base: EXPECT_BASE, ceiling: 700000, allOn: EXPECT_ALLON,
    note: 'base measured on the built package; all-on is the separate skins+props configuration and is NOT claimed under the 700k ceiling' },
  launcher: { python: 'python3 start-world-playable.py [port]', node: 'node start-world-playable.mjs [port]',
    host: '127.0.0.1', defaultPort: 5411 },
  networkAccess: 'none — all references are relative local paths',
  notIncluded: ['*.blend / *.blend1 sources (stay in the workspace)', 'historical render videos', 'node_modules'],
  entryPages: ['world-preview.html', 'fangbang.html'],
  knownIssues: [
    'candidate pending owner adoption (ownerAdopted=false)',
    'all-on budget exceeds the 700k target by 8066 triangles',
    'upstream manifest lists two gitignored .blend1 entries (UP-G1, see workspace artifacts/world-playable/UPSTREAM-INHERIT.json)',
  ],
  provenance: galleryManifest,
  closure,
  files: manifestFiles,
};
await writeFile(resolve(outDir, 'package-manifest.json'), JSON.stringify(manifest, null, 1) + '\n', 'utf8');

// ---- 6. verify: re-read EVERY packaged file against the manifest ----------------
let verified = 0;
const errors = [];
for (const [rel, e] of Object.entries(manifestFiles)) {
  try {
    const b = await readFile(resolve(outDir, rel));
    if (b.length !== e.bytes || sha(b) !== e.sha256) errors.push(rel);
    else verified++;
  } catch { errors.push(rel + ' (missing)'); }
}
if (errors.length) { console.error('MANIFEST_VERIFY_FAIL', errors.slice(0, 10)); process.exit(1); }

console.log(`PLAYABLE_PACKAGE_READY dir=${OUT} files=${allFiles.length + 1} verified=${verified} ` +
  `closureBytes=${Object.values(closure).reduce((s, v) => s + v.bytes, 0)}`);
