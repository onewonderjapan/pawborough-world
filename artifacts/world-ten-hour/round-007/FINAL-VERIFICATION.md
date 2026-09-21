# round-007 · 最终收口核验（finalize）

核验时刻：2026-09-21T10:05:59+09:00（系统时钟）。本轮为收口核验轮，无新施工——round-6
台账 nextTask 指定：核对树干净 @02d518ff、ZIP 哈希复验、四组 smoke 证据存在性，然后在
WORK_LEDGER 声明最终交付。以下全部为本轮实际重做的核验，非引用。

## 核验结果（全部通过）

| 项 | 结果 |
| --- | --- |
| 工作树 / HEAD | 干净（0 未提交项）；HEAD `02d518ff`，分支 `work/world-ten-hour-20260921` |
| 交付 ZIP | `artifacts/world-ten-hour/round-005/delivery/world-ten-hour-20260921-r3.zip` 本轮重算 sha256 `4bb52f16…2209f75db`、165,413,931 B，与外置收据 `package-zip-sha256-r3.json` 逐字一致 |
| 游戏 smoke | `package-game-smoke.json` 复算 **26/26 ok**，pass=true，预算 694430/708066 |
| 首页 smoke | `preview-1280.png` / `preview-390.png` 在位（round-005 记录 15/15） |
| 取景 smoke | `framing-package/framing-browser.json` 复算 **27/27 ok** |
| 错误恢复探针 | `error-recovery/error-recovery.json` 复算 **16/16 ok** |
| 世界锁定区 | `git diff 9e5d5c40..HEAD -- world/ building/ kit/ src/player` = **空**（自基线零改动） |
| 已提交树核验 @最终 HEAD | `tests/lane-b-evidence.test.mjs` 本轮在 02d518ff 复跑 **14/14**（含“74 文件交付清单对新 HEAD 导出逐哈希核验”） |

## 全套测试口径

全套 139/139 @ `2e50daf2`（干净树，round-5 收口）。其后 round-6/7 仅新增 artifacts 与文档，
零 src/HTML/工具改动；按“不重复未变 PASS”纪律不重跑全套，改为本轮对唯一以“已提交树”为
验证范围的 lane-b-evidence 在最终 HEAD 复跑转绿（见上表）。机器可读版：
`final-verification.json`。

## 最终交付位置

- **可玩包**：`world-ten-hour-20260921-r3.zip`（sha256 收据外置同目录；解包即玩：
  `python3 start-world-playable.py`）。坏启动器初版与 -r2 包保留未删，收据链完整。
- **机主入口文档**：`artifacts/world-ten-hour/round-003/START_HERE.md`（30 秒开玩指南，
  含 round-006 附记）、`REVIEW.md`（验收清单 + 已知问题 + 尚需机主决定）。
- **长测原始数据**：round-002..006 `longrun/`（11 场景：逐帧原始 gap 对 + 逐 2s 样本），
  结论见各轮 `FINDINGS.md`；非泄漏判定覆盖五个独立条件；全部为 SwiftShader 软件基线口径。
- **源工程索引**：`round-003/source-index.json`（74 源 .blend、Blender 无头重开 3/3）。

## 留待机主决定（本批不做主）

ownerAdopted=false；「全开」超 8,066 三角形处置；虚空坠落防护两处 + ms-303 楔点
（几何施工超本批授权，证据链含三视口复现）；庙前出生朝向；真实 GPU 机器实测。

时长口径：执行器会计为准——第 7 轮开工时累计 36,106.6s（最低 36,000s 已满，本轮为
允许超时的收口轮）；工人不自报时长。
