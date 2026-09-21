# round-005 FINDINGS（第5轮：favicon 404 修复 + 走查措辞归类 + 便携包 -r3 重建复验）

日期：2026-09-21（时间戳为系统记录；浏览器验证全程 headless Chrome + SwiftShader 软件基线）。
本轮代码改动 = 接续 round-004 FINDINGS 的两项候选修复（favicon + 走查汇总措辞），
并按「HTML 改动必须与包同批」的既定纪律重建便携包。世界锁定区零改动。

## 1. favicon 404 修复（round-004 归因的落地）

round-004 已实证：每轮长测恰好 1 条 console-error = `/favicon.ico` 404（三张页面 HTML 均无
`<link rel="icon">`，浏览器自动请求所致，纯噪音）。

修复：`index.html` / `fangbang.html` / `world-preview.html` 各加同一行 data-URI SVG icon
（深木 #372f27 圆角底 + 纸白 #f7f4ec 爪印，站内既有配色；无外部请求、无新资源文件）。
data-URI 经解码后为 well-formed XML（287 字节，本轮脚本验证）。

**验证（对 dev 5420 跑全套玩家走查）**：
- `artifacts/world-ten-hour/round-005/walkthrough/`：12 截图 + 事件 JSON。
- 与 round-004 walkthrough-final 基线**逐事件对比：唯一差异就是那条 console-error 404 消失**
  （round-4: {console-error:1, shot:9, info:19, requestfailed:4, PASS:2} →
  round-5: {shot:9, info:19, requestfailed:4, PASS:2}）。
- UP-B1（取景↔行走姿态保持 horizDistM=0.000）与 UP-B2（HUD「Esc 释放鼠标」）复验 PASS；
  390/1920 overflowX=0；tris 694430 精确不变。

## 2. 走查工具汇总措辞归类（不改判定逻辑）

`tools/world_ten_hour_walkthrough.mjs` 末行原把 pageerror+requestfailed 全部计成
"hard errors"——其中 4 条 requestfailed 实为 `review-manifest.cm.json` HEAD 探测
（`src/world/compressedState.js` 设计内行为，round-004 已归因）。现改为：

    WALKTHROUGH DONE — 12 shots, 0 hard errors (pageerror/unexpected requestfailed),
    4 by-design cm.json HEAD probes (expected)

事件记录本身逐字节不变（与 round-1 基线的逐事件对齐能力不受影响）；各阶段 PASS/FAIL
判定逻辑零改动。本轮实测输出即上行所示（0 hard + 4 by-design）。

## 3. 便携包 -r3 重建与全链复验（HTML 改动随批，包/源一致）

按 round-3 的 G 流程原路重建（坏产物一律保留不删，新目录新路径）：

| 步骤 | 结果 |
|---|---|
| `scripts/build_playable_package.mjs --out dist-world-ten-hour-20260921-r3 --title world-ten-hour-20260921-r3` | PLAYABLE_PACKAGE_READY：133 文件，verified=132（清单不含自身），closureBytes=154,315,745（与 -r2 完全一致） |
| 构建产物含 favicon | world-preview/fangbang/index 三个 dist HTML 各 1 条 `rel="icon"` |
| `tools/playable_package_zip.py … 2026-9-21` | 133 文件，165,413,931 B，sha256 `4bb52f161815bda09e3c462a6994454d639a84ccb6e6bdd608b8e732209f75db` |
| 外置收据 | `delivery/package-zip-sha256-r3.json`（标注取代 -r2 及原因） |
| 解包 `restore-world-ten-hour-20260921-r3/` | 133 文件与 dist **逐字节一致**（0 mismatch / 0 missing / dist 无未入包文件） |
| 包内自带启动器供服 127.0.0.1:5411 | 见下三组 smoke + 错误探针 |

**对包构建产物的浏览器复验（全部经包自带启动器，非 dev 服）**：
- 游戏 smoke `delivery/package-game-smoke.json`：**26/26**（四入口 ready+routeCheck+显式重定位、
  双预算 694430/708066 精确、无 WebGL 可操作 fatal、首页/图库可用）。
- 首页 smoke（截图 preview-390/1280.png）：**15/15**（含「无页面错误/失败请求」——favicon 修复后
  此项在包构建上同样干净）。
- 取景工具 `framing-package/`：**27/27**（保存/恢复 drift=0.0000/增量导入+异数据集跳过/两步可取消
  删除/PNG=画布 1280×829/reload 持久化/6 预设非空渲染）。
- 错误恢复探针 `error-recovery/`：**16/16**（资源失败指名+单次尝试、单次重试单 canvas、
  中途返回无错误风暴、快速切换落最后选择、失焦清键残余 0.000m、3s 暂停 dt 无突跳、无 WebGL fatal）。

## 4. 服务与边界

- vite dev 5420、包启动器 5411 均本轮内启停，无遗留服务。宿主上其它项目进程未触碰。
- 世界锁定区（world/**、building/**、kit/**、src/player）零改动；三角形预算 694430/708066
  在全部验证中精确不变。
- -r2 及更早的坏包产物按纪律保留在盘（收据链：坏启动器版 → -r2 → -r3）。

## 结论与下一项

round-004 遗留的两项候选修复已落地并随包复验，全链绿。剩余候选工作（若执行器续派）：
按 PLAN「提前清空队列」从本批实测最严重的加载/操作/稳定性问题继续追查，或扩矩阵未跑组合
（allOn+1920、warm+templeFront 等，不重跑已过组合）；世界边界类缺陷继续留证待机主。
