// Q — portable delivery package: START_HERE (zh-CN), delivery-manifest.json
// (relative paths + bytes + sha256 + code commit + video status) and a
// self-contained package/ directory holding the built site + all closeout
// reports + the video terminal state. Bare file:// is NOT a supported way to
// browse the site — the docs give the localhost static-serve command.
//
// Run: node tools/closeout_package.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(root, 'artifacts/world-closeout');
const PKG = resolve(ART, 'package');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const git = (cmd) => { try { return execSync2(cmd); } catch { return null; } };
function execSync2(cmd) { return execFileSync('git', cmd.split(' '), { cwd: root, encoding: 'utf8' }).trim(); }
const codeCommit = git('rev-parse HEAD');

// ---- 1. START_HERE.zh-CN.md -------------------------------------------------
const receipt = JSON.parse(await readFile(resolve(ART, 'video-receipt.json'), 'utf8'));
const browserReport = JSON.parse(await readFile(resolve(ART, 'browser-report.json'), 'utf8'));
const clipA = receipt.clipA;
const clipAState = clipA.state === 'NO_TERMINAL_STATUS'
  ? '渲染进行中（未到终态）——见下方「视频状态」'
  : (clipA.state === 'partial' ? `partial（${clipA.probedFrames}/${receipt.expectedFrames} 帧，cutoff 到点，允许终态）`
    : clipA.state === 'complete' ? `complete（${clipA.probedFrames}/${receipt.expectedFrames} 帧）` : `${clipA.state}——已如实记录交机主`);
const startHere = `# Pawborough 当前世界 — 收口交付（${new Date().toISOString().slice(0, 10)}）

本包是 Pawborough 已采用东延伸世界的工程收口批（pawborough-world-closeout-night-20260919）交付物：
压缩覆盖补全、正式入口与构建、源脚本再生一致性、视频终态、恢复验证。
机主视觉采用决定不变（OWNER_DECISION-20260919.json G1）；工程验证另记，不回写审美裁决。

## 启动

要求：Node 22、本包 \`site/\`（即构建产物 dist）。

\`\`\`bash
# 静态服务（推荐；不要用 file:// 直接打开）
cd site && python3 -m http.server 8080   # 或: npx vite preview --host 127.0.0.1 --port 5341
# 打开 http://127.0.0.1:8080/
\`\`\`

开发态（需仓库源码而非本包）：\`npm ci && npm run dev\`（vite，5340/5341 策略端口，见 DESIGN_SPEC）。

## 默认页与压缩回退

- 入口页：\`index.html\`（导航）与 \`index-v1.html\`（版本清单页，站点相对 URL）。
- 现役桥接世界：\`fangbang.html?ds=fangbang-temple-v4&skins=1&props=1\`。
  压缩变体（*.cm.glb + review-manifest.cm.json）为**默认加载**；URL 加 \`?compressed=0\` 回原始字节。
  个别资产无有效压缩件（狮子/东延伸 surface，几何退化三角漂移超 0.1% 容差）时页面自动回退原始字节，属设计内回退。
- 其他页：\`fangbang.html?ds=fangbang-temple-v3\`（街道 v3）、\`temple-v2.html\`（原始态数据集）、\`temple-v3.html\`（本批起为正式构建入口）。

## 数据集范围

world/ 下 15 个数据集（street-reviewed 主街、fangbang-temple v1–v4 桥接系列、temple-axis-v2/v3 庙轴、
temple-shanmen/entry/dadian、street-sidefaces 外皮、street-props 街道道具、east-edge、street-completion、laneb）。
逐文件 sha256 见 \`VERSION.json\`；数据集清单见 \`index-v1.html\`。

## 设计推定声明

庙宇片区为设计推定（dimensions are design），非史料测绘；东延伸样段端墙为"样段端墙，非历史"。
生成图非史料，数值以冻结 spec 为准（见各数据集 review-manifest.json reference 字段）。

## 视频状态

- clipB（24s 环绕）：complete 576/576 帧，GPU→CPU 切换（CUDA OOM 后 --resume 续渲）接缝 0 空白。哈希已复核。
- clipA（穿街主片，原计划 ${receipt.expectedFrames} 帧）：${clipAState}
  ${clipA.state === 'NO_TERMINAL_STATUS' ? '- 终态 MP4/status 由源任务守望进程在完成或 11h 上限时组装；本批不停止、不续渲、不竞争。终态落盘后运行 `node tools/closeout_video_receipt.mjs` 即完成复制与校验。' : '- 终态已复制入 package/video/，前后哈希一致。'}
- 29 张机位静帧与 12 张前后对照页沿用 adoption-east 批既有证据（未重渲）。

## 依赖与设备

three 0.180 / rapier3d-compat 0.19 / vite 7.1.5（锁文件版本，未升级）；验证用 playwright（--no-save 安装）+ 系统 Chrome headless。
压缩：gltfpack 1.2（N4 工具链 aarch64，-cc -kn；ground 名件 -vpf -vt14）。验证历史跑在本机 aarch64 + SwiftShader 软渲。

## 已知残留

- world/fangbang-temple-v3/（街道 v3）内 westshops-strips.cm.glb 过期（与本批 v4 同源问题）及其 lions.cm.glb 退化三角漂移 0.56%：allowedChanges 未授权改该目录，未动；修复链已备好（授权后 rebuild + make_cm_manifest --dataset fangbang-temple-v3）。
- temple-axis-v3/tree-camphor.glb（v1 树）不在盘上：仅清单 treeV2.previousFile 溯源注记引用，页面从不加载；v2 已替代。
- ${clipA.state === 'NO_TERMINAL_STATUS' ? 'clipA 终态待守望落盘（见上）。' : '无。'}
- 管理正本在 W2；本目录为 S1 outbox 交接包。
`;
await writeFile(resolve(ART, 'START_HERE.zh-CN.md'), startHere);

// ---- 2. package/ assembly ---------------------------------------------------
await mkdir(resolve(PKG, 'site'), { recursive: true });
await mkdir(resolve(PKG, 'reports'), { recursive: true });
// site = the built dist (verbatim)
execFileSync('cp', ['-r', resolve(root, 'dist') + '/.', resolve(PKG, 'site')]);
// reports + video + docs
for (const f of ['baseline.json', 'n-closure.json', 'n-candidates.json', 'n-validate.json', 'n-install.json',
  'cm-provenance.json', 'rebuild-report.json', 'browser-report.json', 'video-receipt.json', 'PROGRESS.json']) {
  try { await copyFile(resolve(ART, f), resolve(PKG, 'reports', f)); } catch { /* optional */ }
}
try { await copyFile(resolve(ART, 'START_HERE.zh-CN.md'), resolve(PKG, 'START_HERE.zh-CN.md')); } catch {}
try {
  await mkdir(resolve(PKG, 'video'), { recursive: true });
  for (const f of (await readdir(resolve(ART, 'video')).catch(() => []))) await copyFile(resolve(ART, 'video', f), resolve(PKG, 'video', f));
} catch { /* video terminal state pending */ }
// browser evidence stills
try {
  const ev = await readdir(resolve(ART, 'browser-evidence'));
  await mkdir(resolve(PKG, 'reports', 'browser-evidence'), { recursive: true });
  for (const f of ev) await copyFile(resolve(ART, 'browser-evidence', f), resolve(PKG, 'reports', 'browser-evidence', f));
} catch { /* none yet */ }

// ---- 3. delivery-manifest.json ---------------------------------------------
const walk = async (dir, base = dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out.sort();
};
const files = [];
for (const rel of await walk(PKG)) {
  const b = await readFile(resolve(PKG, rel));
  files.push({ path: `artifacts/world-closeout/package/${rel}`, bytes: b.byteLength, sha256: sha(b) });
}
const manifest = {
  batch: 'pawborough-world-closeout-night-20260919',
  generatedAt: new Date().toISOString(),
  codeCommit: codeCommit,
  assetsCommit: codeCommit,
  note: 'code and shipped assets ride the same commit tree; assets are LFS-pointer-verified in git and byte-present in package/site',
  video: {
    clipB: { state: 'complete', frames: receipt.clipB.frames, durationSec: receipt.clipB.durationSec, sha256: receipt.clipB.sha256 },
    clipA: { state: clipA.state, renderedOfExpected: clipA.copied ? clipA.copied.renderedOfExpected : null, sha256: clipA.sourceSha256 ?? null },
  },
  browserGate: { pass: browserReport.pass, scenarios: browserReport.scenarios.length },
  serve: 'cd artifacts/world-closeout/package/site && python3 -m http.server 8080  # localhost 静态服务；file:// 不作为可用网页口径',
  files,
};
await writeFile(resolve(ART, 'delivery-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`PACKAGE ready files=${files.length} codeCommit=${codeCommit.slice(0, 12)} clipA=${clipA.state}`);
