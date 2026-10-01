# Pawborough 开发接手入口

更新于 2026-10-01。当前版本为 **v1.0 豫园区域全域版**，标签 `v1.0` 对应 `3f61883cab14ad05cedf248296d2898aebf4b844`，源码与标签已推送。这是可移交版本，公开游戏服务尚未部署。

## 接手顺序

1. 读 [v1.0 交付书](docs/V1-RELEASE.md)和[版本记录](VERSION-v1.json)，核对本版范围、构建源与验收边界。
2. 读[文档导航](docs/README.md)，按模块查资产、机主决定与历史材料。
3. 核对当前分支、工作区和已运行服务，再执行所需命令；不要从旧工单恢复已结束任务。
4. 后续施工范围以机主当次指示为准。角色方向已指定，具体角色和接入程度仍待明确；技术待办见交付书第 6 节。

## 当前命令

从本仓库根执行，场景输出为 `scene-authoring/yuyuan-area/out-zone/`：

```bash
git status --short --branch
npm run area:rebuild
OUT_DIR=out-zone npm run area:serve
# 已有输出的验证：
OUT_DIR=out-zone npm run area:verify
```

重建与验证按任务需要执行；交接本身不要求重复已有验收。`area:serve` 默认端口 5486，以实际输出为准。`out-goal-current`、5607 及下文未归档/未推送状态属于 9 月 27 日候选版，不能作为 v1.0 当前状态。

入口 `candidate-version.json` 的技术收据已经绑定本版，但生成工具仍含封版前的人工待办文案；`v1.0` 标签已推送，不要因这条文案重复请求封版。版本整体采用与归档状态仍须依据对应决定和回执，不能只凭标签推断。详见[版本接收说明](docs/CANDIDATE-HANDOFF.zh-CN.md)。

## 历史交接

以下保留 2026-09-27 交接全文，仅用于核查当时的工作量、来源与证据。文中的“当前”、端口、资产数量、远端提交及待办均按当时记录理解。

<details>
<summary>查看 2026 年 9 月 27 日历史交接</summary>

# Pawborough 给 Claude 的接续交接 · 2026-09-27 JST

这是 S1 的执行交付和事实记录；W2 仍是项目管理正本。机主最新要求是“合并所有分支和 worktree，明确这两天推进了多少”。本文件优先于旧夜班工单里的进行中状态；旧路线图只用于查历史，不据此重复施工。

## 1. 先看结论

**Pawborough 世界 v1 已推进到可浏览、可连续步行、可导控制层、可独立恢复的本地技术候选；尚未完成机主美术采用、W2 真 GPU 验收和本版 S3 归档。** 不是新建了一整座城，也不是已发布游戏。

所有分支的代码成果已收敛到本地主仓库 `main`。本次盘点覆盖 **26 个 worktree、26 个本地分支及 3 个远端引用**，所有 HEAD 均已包含在源码 `601d42a27b0d3552a9800f328f6ea2e050153072` 中。因此执行一次从 `fefb6ee5` 到 `601d42a2` 的 fast-forward 即可，没有遗漏提交或需要硬拼的冲突。本交接及清单另作一个文档提交；用 `git log -1` 查看最新文档 HEAD。

- **唯一接续目录**：`/home/baibai/work/onewonderjapan/pawborough-world`，分支 `main`。`/home/baibai/pawborough-world` 曾是便利链接，已失效（2026-09-29 清理，勿重建）；对话初始目录 `/home/baibai/unity` 不是当前世界源码根。
- **当前本地预览**：<http://127.0.0.1:5607/candidate/>。页面、代码、依赖、运行资产现在都从主仓库提供，不再依赖施工 worktree 提供当前服务。
- **当前运行目录**：`/home/baibai/work/onewonderjapan/pawborough-world/scene-authoring/yuyuan-area/out-goal-current`。不要把旧 `out/` 或 `out-zone/` 自动当成本版。
- **当前服务**：`pawborough-main-preview-20260927.service`，只监听 `127.0.0.1:5607`。不启第二个同端口服务。
- **资产归位**：372 项声明输入全部核 hash；主仓更新 27 项（23 项旧版本、4 项缺失），旧的 23 份先备份留存。90 项当前运行文件另复制到主仓并逐个核 hash。
- **保留现场**：全部 worktree、分支和历史失败输出保留，没有删除。盘点时没有未提交源码；23 个 untracked 项均为环境链接。历史中间产物不是待合源码，也没有混入当前运行候选。
- **远端仍为 `fefb6ee5`**：本次只有本地合并，没有推送。已授权 S3 profile 的 SSO token 仍过期；新二进制没有真实归档回执，不能推 main。

本次实测合并收据和完整清单：[CONSOLIDATION.json](/home/baibai/work/onewonderjapan/pawborough-world/docs/handoff-20260927/CONSOLIDATION.json)、[WORKTREE_INDEX.md](/home/baibai/work/onewonderjapan/pawborough-world/docs/handoff-20260927/WORKTREE_INDEX.md)。最终 Git 状态回执在 `/home/baibai/outbox/pawborough-claude-handoff-20260927/FINAL_MERGE_RECEIPT.json`。

## 2. 这两天到底推进了多少

统计时间是 **2026-09-26—27，日本时间**。Codex 负责总控、审查、限定返修、整合和独立交付验证；具体施工由 GPT-6 Sol/high 与 ZCode GLM-5.3-Flash 承担，goal 阶段 Flash/max 有真实请求收据。不能把这些全部归为总控亲写，也不能把 Claude 等前任成果重新记账。

### 代码量的可信边界

以这次主仓合并前 `fefb6ee5` 为可复核比较点，到源码 `601d42a2`：

|口径|实数|如何理解|
|---|---:|---|
|新增到 main 的历史提交|39，其中 29 个非 merge|包含接手时侧分支已有但尚未进 main 的工作|
|晚于旧 main 提交时刻的提交|34，其中 24 个非 merge|另有 5 个非 merge 是 9/26 15:03 JST 前已有的共享贴图/外围 P1–P3 工作，单列为继承|
|Git 净差异|84 个文件，+9,845 / −1,030 行|包含工具、检查、清单、文档，不能等同业务代码量或完成百分比|
|两天全仓历史|93 个提交|只作背景统计，**不能说这 93 个都是本次新写**|

以上不计本次交接文档提交。明细：[PROGRESS_METRICS.json](/home/baibai/outbox/pawborough-claude-handoff-20260927/PROGRESS_METRICS.json)。接手时还做过 368 项旧输入核对和 86 项本机资产补齐；那属于恢复、整合既有成果，不计新模型。

### 实际产品和工程变化

|工作|实际推进|关键依据 / 边界|
|---|---|---|
|共享贴图收尾|补同输入几何与无损证明、URI 边界；拒绝宽泛 SKIP|该单同输入首载 18,574,796 → 12,815,599 B，省 5,759,197 B（约 31%）。不是最终整合版体积；共享贴图主体部分是接手前已有|
|既有外围收尾|301 栋既有范围的图集/变化打磨收口及审查；接入 v2 图集|不是新建 301 栋；逐栋净改数未核实。包体增量 198,224 B；P1–P3 已有，后续收口单列|
|商城剩余三目标|将 428202606 / 428202607 / 553893884 的套件接入世界；修正分件归属|12 → 15 个目标套件接入，不代表新增地理 footprint；三件回到 part4，raw 8,959,668 B，守住 10 MB 门槛|
|商城玻璃返修|553893868 自由段玻璃原约 40%，严谨口径 39%，修到 69%|50% 门槛未降低；原失败未报成完成；最终 15 项塔楼检查通过|
|亭子/摊位八项修复|修生成器并接入 19 项活动二进制变化，长凳间距可复导|不是新增 19 个模型；3 项停用檐棚仍留档，不装配|
|九曲桥岸端，Sol|只修原台阶朝向和桥面接触，桥身与锚点保持|原 89/311 个失败采样 → 311/311 通过；6 条 GLB/Rapier 巡游通过，同编码 +252 B|
|程序化店面，Flash|175 个开间尺寸/门窗衔接修复，越界归零|184 项真实 GLB 断言通过，同环境运行时 +16,904 B；未偷偷给原封墙开门|
|稳定身份，Flash/max|175 开间只有 7 种共用 ID → 175 个稳定唯一 ID|保留原门型与几何、兼容旧别名；这是追溯能力，不是新增 175 个店面|
|完整跨区，Sol|按需加载保留同一物理世界和控制器；修跳回锚点、真实缺面和已有地面选网遗漏|实走方浜→山门→庙后院→从原山门返出→商城/园区及返程，无中途传送；仅 2 个可见小补面，14 → 16 分件，不是扩建 2 个区域|
|当版控制层，Flash/max|把已有 11 镜头重导到当前身份/补面版本|11×24×4 = 1,056 PNG，264 相机 JSON；0 检查错误。不是新设计 11 个镜头|
|可恢复交付，Flash/max + Sol|白名单包、严格归档校验、动态依赖补齐、真实空目录恢复、长路径 tar 修复|最终 107 个源码文件 + 90 个运行文件；97 HTTP 探针和真实冷启动通过，有封包后逐字节对账|
|候选入口与现场启动，Sol|同源候选入口、显式版本与证据；WebGL/模块启动失败不再永久“加载场景”|6 个启动 DOM 检查；独立 Chrome 实际可见。Codex 内置浏览器的 WebGL 能力仍未恢复，补丁提供清楚错误而非修好 GPU|

所以净变化是：**把断点施工和分散输出收口成可走通、可追溯、可恢复、可交给人审的当前世界 v1 候选**。园/庙/商城/池带主体、已有 20 栋厅堂、原有 5 条商业路线、既有方浜街段等基础不能重算为本轮从零创造。

逐项修前/修后、执行者、提交及原始证据：[PROGRESS_FACTS.md](/home/baibai/work/onewonderjapan/pawborough-world/docs/handoff-20260927/PROGRESS_FACTS.md)。模型表现观察：[MODEL_QUALITY.md](/home/baibai/outbox/pawborough-goal-integrate-20260927/delivery/MODEL_QUALITY.md)。本批任务难度不同，只比较本次交付纪律与返工，不能泛化模型排名。

## 3. 当前版本、资产与封包：不要混淆

|层|当前标识|说明|
|---|---|---|
|本地主仓源码|`601d42a2` + 本交接文档提交|含现场启动错误提示补丁|
|最后一次场景构建源|`0c8dc196`|后续工具/入口/提示改动没有改变已验收场景几何|
|已封存可恢复包源码|`a4c91ec4`|**未包含 601 启动补丁**；包和 checksum 未改写|
|原三路夜班组合|`1224b416`|当时 14 分件、22 项联合检查和 5 条旧路线通过；后来完整跨区不能用旧 5 路代替|
|旧主仓/当前远端|`fefb6ee5`|这是合并前/远端状态，不是现在本地主仓状态|

最终候选核心视觉首载 **13,628,009 B = 11,820,800 B GLB + 1,807,209 B 唯一外置贴图**；不包含 JS/WASM 和步行用 raw 物理 GLB。16 个运行分件，最大 raw 件 9,941,820 B，商城 part4 raw 8,959,668 B。不要把某个早期 raw 输出、共享贴图单包或压缩后总量混作同一口径。

运行文件集中在主仓 `scene-authoring/yuyuan-area/out-goal-current/`；372 项输入由主仓 `docs/MIGRATION-ASSETS.json` 管理。运行文件的 90 项 hash 清单副本在 [MANIFEST-runtime.json](/home/baibai/work/onewonderjapan/pawborough-world/docs/handoff-20260927/MANIFEST-runtime.json)，其中 `sourceOutDir` 是产出时历史来源，不是当前服务目录。

完整可携带包仍在：`/home/baibai/outbox/pawborough-goal-integrate-20260927/delivery/`。

|文件|实测大小|SHA-256|
|---|---:|---|
|`pawborough-world-v1-candidate-20260927.tar`|188,667,904 B|`485face2f9a0f1ad55da7003181ca41d662ee43afd9ec9bb90dd6e154dca15a2`|
|`control-layers-20260927.tar`|615,331,840 B|`2f8057f906342e7b5c2caac1a301200fcb33cd5a4986144a3ec68856e04964b5`|

候选 `.tar.sha256` 是工具 JSON 侧车，按包内 verify 工具使用；控制层侧车才是标准 sha256sum 文本。不要对前者盲跑 `sha256sum -c` 后说归档坏了。

封存包、独立恢复目录和控制层不需为了交接再复制、重建一套。`delivery/restored-candidate/` 保留了真实空目录恢复证据；现在 5607 已迁到主仓。若以后要求制作含 601 补丁的新便携包，另给新版本名和新 hash，保留 a4 包，不伪造它已包含补丁。

启动补丁原件：[startup-error-601d42a2.patch](/home/baibai/outbox/pawborough-webgl-startup-20260927/artifacts/startup-error-601d42a2.patch)。主仓已经包含，**不要再 apply 一次**。

## 4. 如何打开、如何定位“卡在加载”

先查看已有服务，打开独立 Chrome 的 <http://127.0.0.1:5607/candidate/>。服务正常时不要另起实例。

```bash
git -C /home/baibai/work/onewonderjapan/pawborough-world status --short
git -C /home/baibai/work/onewonderjapan/pawborough-world log -1 --oneline
systemctl --user status pawborough-main-preview-20260927.service --no-pager
```

只有服务确实停止且 5607 没有监听时，才可手动从规范目录启动：

```bash
cd /home/baibai/work/onewonderjapan/pawborough-world/scene-authoring/yuyuan-area
OUT_DIR=out-goal-current PORT=5607 node scripts/server.mjs
```

旧 README/PROJECT 中的默认 5486/5487/5488 和旧输出路径是早期入口，不作为当前候选启动说明。5497 是 `1224b416` 历史预览；5500 是历史审查材料服务。它们不是当前 5607，也不要用宽泛 `pkill`/`pgrep` 清理。

用户现场的 Codex 内置浏览器报 WebGLDisabled / BindToCurrentSequence 失败，发生在场景下载前。独立 Chrome 已真实显示场景；601 补丁已在内置浏览器显示明确中文失败说明、复制 URL 与重试。这是浏览器图形初始化问题，不能因 loading 就重做 GLB、重跑 Blender，或宣称内置浏览器已修好。

这次只迁移服务根，10 项真实 HTTP 源码/入口/依赖/清单字节前后相同；372 输入与 90 运行文件也完全匹配，所以复用了已有场景/路线/恢复 PASS，没有重复全量 QC。

## 5. Claude 先读哪些真实证据

证据优先级：当前主仓合并回执 → 最终 CLOSEOUT / LEAD_REVIEW → 实际命令退出码、hash、图和浏览器报告 → 工人的手写 RESULT → 早期计划。存在已修过的手写时间/文件名错误，不可仅看 `PASS` 字符。

1. 本次合并：`/home/baibai/outbox/pawborough-claude-handoff-20260927/`，包含 `INVENTORY_BEFORE.json`、`ASSET_CONSOLIDATION_RECEIPT.json`、`PREVIEW_CONSOLIDATION_RECEIPT.json`、`FINAL_MERGE_RECEIPT.json`、`PROGRESS_METRICS.json`。旧 23 份输入位于其 `retained-main-inputs/`。
2. 总交付：`/home/baibai/outbox/pawborough-goal-integrate-20260927/delivery/CLOSEOUT.json`、`FINAL_PACKAGE_VERIFY.json`、`FINAL_RESTORED_BYTE_MATCH.json`、`METADATA_SEAL.json`。
3. 主控五项审查：`/home/baibai/outbox/pawborough-goal-20260927/control/G1_LEAD_REVIEW.json` 至 `G5_LEAD_REVIEW.json`；模型请求为 `WORKER_MODEL_RECEIPTS.json`、`WAVE2_MODEL_RECEIPTS.json`。
4. 当版路线证据复用理由：同目录 `CURRENT_RUNTIME_ORIENTED_PARITY.json`、`CURRENT_ROUTE_METADATA_PARITY.json`。有向三角形/物理内容保持，只 source hash 字段更新，故无需再走一整轮。
5. 最终真实恢复：`delivery/final-evidence/restore/restore-report.json`；方浜生产控制器起步为 `delivery/final-evidence/candidate-fangbang/candidate-walk-smoke.json`；最终入口为 `delivery/final-evidence/SEALED_ENTRY_CHECK.json`。
6. 夜班与比较：`/home/baibai/outbox/pawborough-night-20260926/PLAN.md`、`/home/baibai/outbox/pawborough-parallel-20260927/MORNING_REVIEW.md`，以及 `/home/baibai/outbox/pawborough-goal-integrate-20260927/delivery/MODEL_QUALITY.md`。
7. 用户现场启动：`/home/baibai/outbox/pawborough-webgl-startup-20260927/artifacts/LEAD_REVIEW.json`。

历史 CLOSEOUT 写 main=fef / 没有推送，是当时事实。本次只改变本地主仓合并状态，没有篡改封存收据。不要拿历史 main 字段覆盖本文件的当前合并回执。

## 6. 待办与禁止重复施工的边界

|待办|真实状态|接续动作|
|---|---|---|
|W2 真实 GPU、人工全程巡游|未做|安排 W2 本机/既有授权隧道测试。S1 SwiftShader 的 core 16.91s、现场 Chrome 5.1s/6.5s 都不能填写成 W2 性能成绩|
|湖心亭、九曲桥、大假山视觉采用|待机主|提供当前候选与既有图证，让机主判断；不要代改采用状态|
|S3 本版归档与 remote main|阻塞于 SSO token 过期|已授权 profile `onewonder.root`、私有 bucket `onewonder-pawborough-assets-566601428909-apne1`。先恢复真实登录、核对身份和桶，再做本版新文件归档和真实 hash/回执，之后才能推 main。不要猜另一 profile/bucket|
|内置浏览器 WebGL|仍不可用|当前可用路径是独立 Chrome。需要修浏览器环境时单列环境问题，不重复世界构建|
|新可携带包含启动补丁|当前 a4 包不含；主仓已含|如有新封包需求，用新文件/新 hash，只验受影响启动与闭包，不覆盖旧包或重渲控制层|

S3 身份授权来源保存在 `/home/baibai/outbox/pawborough-goal-20260927/control/ARCHIVE_AUTHORITY.json`；2026-09-27 本次 fresh STS 仍返回 token expired，未发起上传。本地 main 合并已获本轮用户明确授权；这不解除既有“归档前不推 main”门槛。

原 `pawborough-9-26-glm` heartbeat 已 PAUSED，旧 a/b/final/facade 及 goal 施工均已结束。当前没有需要接续的工人队列，**不要从旧 jobs 的 queued 或工单文字恢复它们，不开重复任务**。

角色模型是 deferred G1，完整玩法是 deferred G3，Unity 是 W2 可选导入而非世界 v1 前置。后续任何扩建或新美术决策按机主当前范围来；技术交接不构成采用或发布授权。

## 7. 模型施工与审查中暴露的问题

- Sol 本批桥端、完整跨区、入口和最终接线较连贯。查明九曲桥实际 site 入口是正确查证，原工单入口错误不记为 Sol 返工。G2 Git author 误继承 GLM 配置，实际执行方为 Sol/high，不可按 author 字段猜模型。
- Flash 完成了批量生成/导出与身份、恢复工具。审查纠正过宽泛 SKIP、资产账“无新二进制”、有向几何比较遗漏、双方缺件误过、硬编码日期、手写 RESULT 引用错误文件等。以修后实际证据为准，原失败保留。
- Flash 恢复工人曾以过宽 `pgrep` 误停别的预览，主控恢复并限制只能操作自己 PID；不能把因此中断的浏览器结果当成 Sol 功能失败。最后真实封包的 ustar 长路径问题由 Sol 小修，实际/UTF8 路径检查通过。
- 不用测试条数/总耗时给不同难度任务作通用模型排行榜。独立审查发现问题并修正是本次推进的一部分，但未把这些过程包装成新增世界内容。

后续 3D 资产方法：优先盘点现有合格资产，再可复用套件，最后必要自建。规则为 `/home/baibai/.agents/skills/3d-asset-reuse/SKILL.md`，已读回执 `/home/baibai/outbox/3d-asset-reuse-skill-20260927/session-readbacks/unity.json`。当前交接只整合已验收资产，没有借方法同步启动新批次。

可复用工程经验已在知识库私有 [PR 13](https://github.com/onewonderjapan/knowledge-base/pull/13)，待机主合并；不必再写同题笔记。它不是本 Pawborough 仓的待合分支，本次没有改它的合并状态。

</details>
