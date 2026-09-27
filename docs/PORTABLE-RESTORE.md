# PORTABLE-RESTORE — 本地可恢复候选交付工具（tools/portable/）

本工具把「已提交 head 的白名单源码 + 候选运行时闭包」打成自包含**区域 runtime 恢复包**，
并在任意真正空目录一条命令恢复、校验、安装固定版本依赖、在 localhost 启动并出真实
浏览器证据。它不重复 372 输入/76 运行闭包的 hash 报告，也不做任何重建/美术。

- 状态口径：一切产物只称 **delivered_for_lead_review**，不等于采用或云端归档。
- 同机新目录恢复 **≠ W2 已测环境**；S1 性能不替代 W2 真实 GPU 性能与人工巡游。
- 范围声明：本包为**本版区域 runtime 恢复包（area-runtime-only）**，不声称恢复全部
  历史数据集、截图或 artifacts。

## 打包范围（R1 白名单）

代码源不是全仓 archive，而是显式、可复验的路径白名单（`pack.mjs` 内
`DEFAULT_SOURCE_WHITELIST`，可用 `--source-paths <json>` 覆盖），默认仅含区域
runtime 所需：area `web/`、`scripts/server.mjs`、两个 `package.json`/锁文件、
仓库根 `src/`（`/vendor-src` 提供的步行/物理/地面模块）、`docs/PORTABLE-RESTORE.md`、
`docs/THIRD-PARTY-NOTICES.md`、`PROJECT.json`。1224b416 上为 51 件 ≈ 0.5MB
（全仓 13,175 件，其余 13,124 件历史媒体/截图/artifacts/数据集按白名单排除；
LFS 指针不进包）。`MANIFEST-code.json` 记录原 head、每件 gitBlobSha+sha256、
included/excluded 计数与白名单本身。原仓库文件不做任何删除。

## 命令

### 1) 打包（一条命令）

```bash
node tools/portable/pack.mjs \
  --repo    <git 仓库或 worktree 路径> \
  --head    <已提交 commit sha> \
  --out-dir <OUT_DIR 目录（候选运行时产物所在）> \
  --manifest <OUT_DIR 内 zones-manifest.json 路径> \
  --out     <目标包目录（必须不存在）> \
  [--source-cache <本机 npm 离线缓存目录>] [--tar] [--source-paths <白名单json>]
```

- 运行时闭包 = 从 zones-manifest + area web 源码推导的实际读取项：
  zones-manifest、分区原始 GLB（步行地面）、cm GLB、外置 tex、collision-*.json、
  layout/tour/commercial-route/connectivity/commerce-audit/nav-gap/fangbang-supersede/
  assemble-stats、scene-areas.glb（推导规则见 `tools/portable/closure.mjs` 头注 R1–R6）。
- 闭包缺件 → 打包失败并列出缺件清单（fail-closed）。
- `--tar` 额外生成 `<包目录>.tar`（自写 ustar）与 `.tar.sha256` sidecar（可独立重验）。
- 包内自带恢复/校验工具（`_restore/portable/`，独立命名空间避免与恢复后仓库
  `tools/` 相撞）与薄启动器。
- `--out` 已存在且非空 → 拒绝（不覆盖既有目录，不删除旧内容）。

### 2) 校验（只验证不恢复）

```bash
node tools/portable/verify.mjs --package <包目录 | 包.tar> [--report <路径>]
```

tar 输入先验 sidecar sha256，再由严格 tar 层整体校验全部条目（路径 + 类型），
全部通过后才解包。目录输入检查：包内每文件 sha256（缺件/坏 hash/未列文件）、
白名单与 code/ 一一对应（含 gitBlobSha 清单）、head 一致、declaredScope、
运行时闭包在场、自包含工具在场。任何一项失败即非零退出。

### 3) 恢复并启动（一条命令）

```bash
node tools/portable/restore.mjs \
  --package <包目录 | 包.tar> \
  --dest    <不存在或为空的目录> \
  [--port 5603] [--source-cache <npm 离线缓存>] [--skip-install] [--no-browser] \
  [--browser-executable <chrome/chromium 路径>] [--check-and-exit] \
  [--evidence-dir <目录>] [--ready-timeout-ms 180000]
```

流程（顺序即 fail-closed 顺序）：

1. tar 输入：**解包前**整体校验全部条目 —— 只接受普通文件/目录，拒绝绝对路径、
   `..`、symlink、hardlink、char/block/fifo、pax/GNU 扩展头（`tools/portable/tar.mjs`）；
   目录输入：拒绝符号链接复制。
2. 全包 sha256 校验 —— **改一个 hash / 缺一个必要纹理 / 缺一个 GLB 都在这里失败，
   服务绝不带伤启动**；失败报告与坏样本保留（时间戳命名，不覆盖）。
3. `code/` 展平到恢复根（碰撞即失败），运行时闭包安放
   `scene-authoring/yuyuan-area/<OUT_DIR>/`。
4. `npm ci`（仓库根 + area，锁文件固定版本并核对实际安装版本；给 `--source-cache`
   时先 `--offline`，失败回退 `--prefer-offline`，两次尝试日志都保留）。
5. 新环境证明：node_modules 内符号链接不得逃逸恢复根（不借用旧环境软链）。
6. 启动 `127.0.0.1:5603`（`scripts/server.mjs`，`OUT_DIR=<OUT_DIR 名>`）。
7. HTTP 归因探针：入口 HTML 含 importmap；全部闭包 JSON 逐字节 sha 比对；全部 GLB
   验 `glTF` 魔数；tex 在场；three / rapier / vendor-src 模块路径 200。
8. 浏览器 core 冷加载证据（`--no-browser` 可跳过）：
   - headless Chromium；`--browser-executable` 显式指定（S1 实测可用
     `/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`
     + `--enable-unsafe-swiftshader --disable-dev-shm-usage`）；每个候选先做
     WebGL 能力预检，无渲染能力立即换下一个，不盲等；不扫描/不启动 X display；
   - 就绪不是只读一个 true：`__firstLoadReady` 且 default 策略分区全部出现在
     `__zonesLoaded`，且无 pageerror / 模块或资产请求失败（favicon 除外）；
   - 非空白：同一次 evaluate 内等两帧 requestAnimationFrame（真实渲染触发）后
     drawImage 回读 160×100 像素，规则固定 std255≥2 且 dominantShare≤0.95，
     **不放宽阈值**；PNG 截图 + RGBA 像素数据落盘；
   - GPU 类型从页面实际 WebGL `UNMASKED_RENDERER_WEBGL` 读取落盘（读不到记
     `rendererVerified:false`），不做 DISPLAY 等推断；
   - 成功与失败都写 JSON 报告（console/pageerror/网络错误全程保留）。

恢复前后路径/sha/缺件清单写入 `<evidence-dir>/restore-report.json`。交互运行时
服务保持前台（Ctrl+C 停）；自动化加 `--check-and-exit`。

## 进程纪律

工具只终止自己 spawn 并记录 PID 的服务子进程；不使用 pgrep/pkill/killall 等按
名字的进程操作。端口被占用时报告并失败，不清场。

## W2 / 新机运行前提

- Node ≥ 22；npm（锁文件版本安装，不升级）；磁盘 ≈ 1GB（包 + 恢复树 + node_modules）。
- 浏览器证据需 Chromium + WebGL（软渲或真机 GPU）；`--no-browser` 可跳过该步。
- 5603 端口空闲；`--source-cache` 需指向同机已预热 npm 缓存，否则需要 registry 访问。
- **已知边界**：同机新目录 ≠ W2 已测；未做跨机/离线净机恢复声明。

## Windows（未实测，薄启动器）

包内 `_restore/portable/serve-windows.ps1`（仓库侧同名文件在 `tools/portable/`）只是
把参数转发给 `node .../restore.mjs`。不承诺未测 Windows 路径正确；前提仅是 node 在 PATH。

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

覆盖：闭包推导与缺件 fail-closed（缺件=构建时不含，非删除）、路径逃逸/不覆盖/
symlink 守卫、恶意 tar 负例（../、绝对路径、symlink、hardlink、pax 头：解包前整体
拒绝，dest 内外零副作用，坏归档保留）、白名单 pack 断言（历史媒体不进包）、mini
端到端（pack → verify → 空目录恢复 → 探针）、改一字节/缺纹理/缺 GLB 在安装与启动前
失败、非空 dest 拒绝且原内容不动。
**fixture 纪律**：测试不删除任何产物；全部 fixture/坏样本保留在盘，路径逐次追加
记录到 `tests/portable-fixtures-record.jsonl`。

## 遗留人工待办（不在本单内）

- W2 真实 GPU 性能（P50/P95、加载峰值）与机主亲走巡游 —— 结果必须人工取得
  （见 docs/PERF-W2.md 惯例）。
- MIGRATION-ASSETS 各 pending 块的真实云端归档：等机主明确身份/桶后另行执行。
- 恢复包将来对新 HEAD 重跑：`pack` 全部参数显式传入即可，不绑定任何目录或提交。
