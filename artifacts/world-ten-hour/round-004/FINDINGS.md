# round-004 FINDINGS（第4轮：矩阵新条件补角 + 批末回归）

日期：2026-09-21（UTC 时间戳为系统记录，长测全程 SwiftShader 软件基线，headless Chrome，linux arm64）。
本轮无任何 src/ 代码改动（零代码变更轮）；全部工作是两个新条件长跑 + 逐事件归因 + 批末回归。

## 新条件长跑（复用 longrun_driver.mjs 现成参数，--gc 与 round-3 的 S4/S5 同口径）

### S8 — 1920×1080 视口，default，mainAB，冷启动，30:06（s8-mainAB-default-1920）
- 路线：228/267 航点（85.4%），779.7m。30 分钟时限内未走完全程——1920 下帧时约为 1280 的 2.8×，同墙钟内里程相应减少，属诚实的时间盒结果（S4 在 1280 跑 62 分钟走完全程）。
- 帧真值（软件基线）：p50=516.7ms、p99=983.3ms、max=5716.5ms（max 在 +9s，启动 routeCheck 阶段，与 S4 同相位）。对照 S4（1280×900）p50=183ms → 像素 2.4×，帧时 ~2.8×，符合软件光栅缩放预期。1–5s 停顿仅 15 帧、>5s 仅启动 1 帧。
- 堆（post-GC）：79.05→79.51MB，斜率 +0.949MB/h，前后半 +1.574→+0.427（趋平）。**在更高视口这一新条件下再次支持 round-3 的"非泄漏"判定**。
- 预算：694430 三角形全程精确锁定；资源 496/476/346 恒定。
- 转换：5P/5V/5失焦 全部干净。
- 异常 3 条：全部是已知世界边界楔点 `[-130.5, 28.1]`（back-301/ms-303）——round-2/3 已 3 次复现，本次为**第 4 次复现，且首次在不同视口（1920）**，证明与视口/帧率无关，是该处几何本身的可通过-可卡住楔缝。驱动按"玩家方式"3 次脱困后跳过该航点（waypointSkipped back-301），未坠落，继续走完折返段。几何修复仍超范围，留证待机主。

### S9 — templeFront 入口，templeLoop 轨道，default，1280×900，冷启动，30:01（s9-templeFront-tloop）
- 路线：2/2 航点（100%）约 1 分钟走完——庙前广场本身只有 ms-301→ms-302 两个航点（round-2 已记录的空间事实），其余 29 分钟为**庙前山门最重视角持续渲染 + 每 5 分钟 P/V/失焦循环**的浸泡条件（此前矩阵从未在庙前入口做过长测）。
- 帧真值：p50=166.6ms、p99=183.4ms、max=6666.4ms（+10s 启动 routeCheck）。11394 帧中仅 11 帧超 250ms——庙前朝向（望山门/庙轴线）视锥剔除后实际比主街行进视角轻，这本身是有用的取景/导览信息（庙前是适合低配机器的取景位）。
- 堆（post-GC）：78.83→79.04MB，斜率 +0.476MB/h，前后半 +0.841→+0.128（趋平）。**第三个独立条件下再次支持非泄漏**。
- 预算：694430 精确锁定；资源 496/476/346 恒定；5P/5V/5失焦干净；**零异常**。

## 逐事件归因：历史长测里每轮恰好 1 条的 console-error 404 与走查"4 hard errors"

本轮用带 location 的小探针实测定位（脚本结论，非猜测）：
- **console-error 404 = `/favicon.ico` 缺失**（页面三张 HTML 均无 `<link rel="icon">`，浏览器自动请求得 404）。纯 devtools 噪音，不影响加载；round-2 起每轮长测的"恰好 1 条"即此。**候选一行修复**（三个 HTML 各加一个 data-URI icon link），留待下轮与便携包重建同批做，避免本轮末尾代码改动造成包/源不一致。
- **walkthrough 的 4 条 requestfailed = `review-manifest.cm.json` 的 HEAD 探测**（`src/world/compressedState.js:32` 设计内行为）：vite 对缺失路径回退 200 text/html，代码已显式把"200+HTML"判为无压缩变体并整体保持原始字节（不混装）；Playwright 对收到头后无 body 的 HEAD 记 `net::ERR_ABORTED`，故每次 fangbang.html 加载出现 1 条。**与 round-1 基线逐字一致**，不是回归、不是资源缺失。walkthrough 工具末尾把这 4 条计成"hard errors"的措辞有误导（下轮可顺手在工具里把"设计内探测"单独归类，不改判定逻辑）。
- 我中途曾把 console-error 初步归因为 cm.json 探测，后经 location 字段证伪并更正为 favicon——按诚实记录规则在此留痕。

## 批末回归（最终代码态，HEAD=6d850742，零代码变更）

- `world_ten_hour_walkthrough.mjs` → round-004/walkthrough-final/：12 截图 + 事件 JSON，**与 round-1 基线逐事件对齐**（同样 12 shots、同样 4 条设计内 requestfailed、同样 1 条 favicon 404、无新增）；UP-B1（取景↔行走姿态保持 horizDistM=0）与 UP-B2（HUD Esc 提示）在最终态复验 PASS；390/1920 overflowX=0。
- `error_recovery_probe.mjs` → round-004/error-recovery-final/：**16/16 PASS**（对齐 round-1 的 16/16）。
- 全套单测未重跑：本轮零代码改动，按台账引用 round-3 收口的 139/139（干净树）结果，不重复耗时。

## 结论与下一项

矩阵补角完成：堆缓升非泄漏的判定现已在 **default 1280（S4）、allOn 1280（S5）、default 1920（S8）、templeFront 1280（S9）** 四个独立条件下成立，且前后半斜率均趋平。世界边界类缺陷（桥东虚空、中街北缘、ms-303 楔点）证据链已含视口无关性证明。剩余候选工作（下轮）：favicon 一行修复 + walkthrough 措辞归类 + 包重建复验；或按 PLAN"提前清空队列"清单从加载/操作/稳定性追查继续。
