# PORTABLE-RESTORE — 本地可恢复候选交付工具（tools/portable/）

本工具把「已提交的代码状态 + 主控候选运行时闭包」打成自包含本地候选包，并在任意
真正空目录一条命令恢复、校验、安装固定版本依赖、在 localhost 启动并出真实浏览器
证据。它不重复 372 输入/76 运行闭包的 hash 报告，也不做任何重建/美术。

- 状态口径：一切产物只称 **delivered_for_lead_review**，不等于采用或云端归档。
- 同机新目录恢复 **≠ W2 已测环境**；W2 真实 GPU 性能与人工巡游另行取证（见文末待办）。

## 命令

### 1) 打包（一条命令）

```bash
node tools/portable/pack.mjs \
  --repo    <git 仓库或 worktree 路径> \
  --head    <已提交 commit sha> \
  --out-dir <OUT_DIR 目录（候选运行时产物所在）> \
  --manifest <OUT_DIR 内 zones-manifest.json 路径> \
  --out     <目标包目录（必须不存在）> \
  [--source-cache <本机 npm 离线缓存目录>] [--tar] [--area-dir scene-authoring/yuyuan-area]
```

- 代码 = `git archive --head`（明确含哪个提交，写进包内 `MANIFEST-code.json`/`RESTORE.json`）；
  工作区脏状态不进入包。LFS 跟踪的大文件保持指针——运行时不需要它们。
- 运行时闭包 = 从 zones-manifest + area web 源码推导的实际读取项：
  zones-manifest、分区原始 GLB（步行地面）、cm GLB、外置 tex、collision-*.json、
  layout/tour/commercial-route/connectivity/commerce-audit/nav-gap/fangbang-supersede/
  assemble-stats、scene-areas.glb（推导规则见 `tools/portable/closure.mjs` 头注 R1–R6）。
- 闭包缺件 → 打包失败并列出缺件清单（fail-closed）。
- `--tar` 额外生成 `<包目录>.tar` 与 `.tar.sha256` sidecar（归档清单可独立重验）。
- 包内自带恢复/校验工具（`tools/portable/`）与薄启动器，自包含。
- `--out` 已存在且非空 → 拒绝（不覆盖既有目录，不删除旧内容）。

### 2) 校验（只验证不恢复）

```bash
node tools/portable/verify.mjs --package <包目录 | 包.tar> [--report <路径>]
```

检查包内每个文件的 sha256（缺件/坏 hash/未列文件）、code.tar 完整性、head 一致性、
运行时闭包在场、自包含工具在场。任何一项失败即非零退出。

### 3) 恢复并启动（一条命令）

```bash
node tools/portable/restore.mjs \
  --package <包目录 | 包.tar> \
  --dest    <不存在或为空的目录> \
  [--port 5603] [--source-cache <npm 离线缓存>] [--skip-install] [--no-browser] \
  [--check-and-exit] [--evidence-dir <目录>]
```

流程（顺序即 fail-closed 顺序）：

1. tar 条目名安全检查（拒绝 `../`、绝对路径、符号链接）后解包到 dest；
2. 全包 sha256 校验 —— **改一个 hash / 缺一个必要纹理 / 缺一个 GLB 都在这里失败，
   服务绝不带伤启动**，失败报告与坏样本保留；
3. code.tar 解包到恢复根（冲突即失败），运行时闭包安放回 `scene-authoring/yuyuan-area/<OUT_DIR>/`；
4. `npm ci`（仓库根 + area，锁文件固定版本；给 `--source-cache` 时先 `--offline`，
   失败回退 `--prefer-offline`，两次尝试的日志都保留）；
5. 新环境证明：node_modules 内任何符号链接目标都不得逃逸恢复根
   （不复制/不借用旧环境软链）；
6. 启动 `127.0.0.1:5603`（`scripts/server.mjs`，`OUT_DIR=<OUT_DIR 名>`）；
7. HTTP 归因探针：入口 HTML 含 importmap；全部闭包 JSON 逐字节 sha 比对；全部 GLB
   验 `glTF` 魔数；tex 在场；three / rapier / vendor-src 模块路径 200；
8. headless Chromium 冷加载 `/?zone=core&cam=oblique`，等 `window.__firstLoadReady`，
   canvas 回读判定非空白（亮度 std255 ≥ 2 且 dominantShare ≤ 0.95），证据截图落盘。

交互运行时服务保持前台（Ctrl+C 停）；自动化加 `--check-and-exit`（验证完自动退出）。
恢复前后路径/sha/缺件清单写入 `<evidence-dir>/restore-report.json`（时间戳命名，不覆盖）。

## W2 / 新机运行前提

- Node ≥ 22；npm（锁文件版本安装，不升级）；约 1.5 GB 磁盘（包 + 恢复树 + node_modules）。
- 浏览器证据需 Chromium：优先 playwright 注册表缓存，回退系统 Chrome
  （`--no-browser` 可跳过该步，其余校验不受影响）。
- 5603 端口空闲；`--source-cache` 需指向同机已预热 npm 缓存，否则需要 registry 访问。
- **已知边界**：同机新目录 ≠ W2 已测；未做跨机/离线净机恢复声明。

## Windows（未实测，薄启动器）

包内 `_restore/portable/serve-windows.ps1`（仓库侧同名文件在 `tools/portable/`）只是把参数
转发给 `node .../restore.mjs`。不承诺未测 Windows 路径正确；前提仅是 node 在 PATH。

## 资产状态诚实口径

包内 `assets-status.json` 转录指定 head 的 `docs/MIGRATION-ASSETS.json`：所有 top-level
待归档块（`wave9SharedTexPendingLeadArchive`、`nightFinalRuntimePendingLeadArchive`、
`solBridgePendingLeadArchive`、`combinedReviewRuntimePendingLeadArchive`）一律记为
**pending_lead_archive（未上传）**，`statusExplicit.cloudRestored = false`。
无 AWS 身份/桶授权，本工具不上传任何内容。

## 单元/回归测试

```bash
node --test tests/portable_tools.test.mjs
```

覆盖：闭包推导与缺件 fail-closed、路径逃逸/不覆盖守卫、mini 端到端
（pack → verify → 空目录恢复 → 13 项探针）、改一字节/缺纹理/缺 GLB 三种坏样本在
安装与启动前失败、非空 dest 拒绝且原内容不动。

## 遗留人工待办（不在本单内）

- W2 真实 GPU 性能（P50/P95、加载峰值）与机主亲走巡游 —— 技术准备的恢复包已备，
  结果必须人工取得（见 docs/PERF-W2.md 惯例）。
- MIGRATION-ASSETS 各 pending 块的真实云端归档：等机主明确身份/桶后另行执行。
- 恢复包将来对新 HEAD 重跑：`pack` 全部参数显式传入即可，不绑定任何目录或提交。
