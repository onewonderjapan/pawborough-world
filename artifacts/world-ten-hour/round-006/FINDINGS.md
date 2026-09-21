# round-006 FINDINGS（第6轮：矩阵最后两个建议组合补角）

日期：2026-09-21（时间戳为系统记录，长测全程 SwiftShader 软件基线，headless Chrome，linux arm64）。
本轮零 src/ 代码改动（纯证据轮）；工作是 ledger 下一项指定的两个未跑矩阵组合：
S10 allOn+1920（最重视觉配置 × 最大视口，此前 allOn 只在 1280、1920 只在 default 跑过）与
S11 warm+templeFront（暖启动 × 庙前入口）。复用 longrun_driver.mjs 现成参数，--gc 与 S4/S5/S8/S9 同口径。

## S10 — allOn（skins+props），1920×1080，laneALoop，冷启动，30:03（s10-laneALoop-allon-1920）

- 路线：**97/97 航点（100%）全程完成**，339.3m。laneA 弄环线出去走回、再沿主街向西走到 terminus——
  西端终点按既有"台阶脚即到达"规则（dist=3.0m，与 routeCheck 同规则）在约 +10min 完成轨道，
  驱动松开 W，剩余 ~18 分钟为**主街西端最重视角站立浸泡**（每 5 分钟 P/V/失焦循环）。
  站立期脚位逐样本不变属轨道完成后的合法状态（帧计数每段持续爬升 1964→4392，非页面冻结）。
- 帧真值（软件基线）：p50=483.3ms、p99=966.6ms、max=5266.5ms（max 在 +9s 启动 routeCheck 相位，与全部前轮一致）。
  停顿桶：250ms-1s 3174 帧、1-5s 仅 36 帧、>5s 仅启动 1 帧。对照 S5（allOn@1280）p50=250ms →
  像素 2.4× 帧时 ~1.9×；对照 S8（default@1920 对 default@1280 的 2.8×）——allOn 的 CPU 侧
  （draw call/遍历）占比更高、像素缩放占比更低的复合表现，符合软件光栅预期，两方向对照互相自洽。
- 堆（post-GC，MiB）：启动段 81.25 → seg-001 起 79.19 平台 → 末段 79.54，全程斜率 **-0.986 MiB/h**
  （前后半 -4.691 → +0.106，趋平）。**第五个独立条件支持 round-3"非泄漏"判定**
  （此前四条件：default1280 S4、allOn1280 S5、default1920 S8、templeFront1280 S9）。
- 预算：708066 三角形全程精确锁定（allOn 口径）；资源 648/563/518 恒定（与 S2/S5 完全一致）。
- 转换与异常：5P/5V/5失焦全部干净；**零异常**（无坠落、无 walkStall、无 fatal、无 pageerror）。
- 截图：t+5m…final 共 6 张，final 为西端墙前站立健康帧（HUD 位置 -139.7,-42.2、skins count 21、无 fatal）。

## S11 — warm 暖启动，templeFront 入口，templeLoop 轨道，default，1280×900，12:01（s11-templeFront-tloop-warm）

- 暖启动门（longrun.json warmStart 字段）：同浏览器上下文先冷加载 ready **9593ms**，reload（暖 HTTP 缓存）
  测量跑 ready **9490ms**——暖缓存仅省 ~100ms（1%），与 S6 在 mainStreet 的结论一致
  （冷 8469 vs 暖 8463ms）：**本地 ready 门由 routeCheck+解析主导，暖 HTTP 缓存不移动它**。
  该结论现已在两个入口（mainStreet、templeFront）成立；对"网络受限场景暖缓存是否受益"不做声称（无该环境实测）。
- 路线：2/2 航点（100%），约 1 分钟走完（庙前广场本就只有 ms-301→ms-302 两个航点，round-2 记录的空间事实），
  其余 ~11 分钟为庙前山门最重视角站立浸泡 + 2P/2V/2失焦循环。
- 帧真值：p50=166.7ms、p99=216.6ms、max=6333.1ms（唯一 >5s 帧 = reload 后启动 routeCheck 相位）。
  4072 帧中仅 2 帧落 250ms-1s 桶——与 S9（p50=166.6ms）一致，庙前朝向视锥剔除后是最轻的连续渲染视角，
  再次支持"庙前适合低配机器取景"的导览信息。
- 堆（post-GC）：79.20→79.29MB，斜率 +0.75MB/h（12 分钟短跑段数少，无前后半斜率；平台平坦为信号），
  与 S9 同条件冷启动（+0.476MB/h）同量级。资源 496/476/346 恒定，694430 精确锁定。
- 零异常；截图 t+5m/t+10m/final 共 3 张。

## 结论与下一项

- **矩阵覆盖现状**：S1–S11 共 11 个长测场景，两个 ledger 建议的未跑组合（allOn+1920、warm+templeFront）
  本轮全部补齐且全绿。长测条件覆盖：default/allOn × 1280/390/1920 × 冷/暖 × mainAB/laneALoop/templeLoop/四入口轮转，
  外加失败恢复注入（S2）。无已知未跑的组合剩余需要本轮补角（allOn+390、warm+allOn 等属可选扩展，
  收益边际——allOn 软件基线帧时已在三个条件确立，warm 门已在两个入口确立）。
- **非泄漏判定现覆盖五个独立条件**（S4 default1280、S5 allOn1280、S8 default1920、S9 templeFront1280、
  S10 allOn1920），前后半斜率全部趋平；S11 平台平坦同量级。
- **零代码改动轮**：无 src/ 变更 → 按纪律不重建便携包（-r3 仍为当前代码态的包），全套测试不重跑
  （引用 round-5 收口的 139/139 @2e50daf2 干净树）。世界锁定区零改动。
- 世界边界类缺陷（桥东虚空、中街北缘、ms-303 楔点）本轮无新复现（S10 未走 mainAB 折返段，
  laneALoop 西行沿途含 ms-303 附近区域顺利通过）——证据链维持 round-3/4 状态，留机主。
- 本轮结束时最低 10h 时长已满。当前态即为 delivered_for_lead_review 依据：
  包 -r3（zip sha256 4bb52f16…，外置收据）+ round-003 START_HERE/REVIEW + round-001..006 各轮 FINDINGS
  + 11 个长测场景原始数据。ownerAdopted=false，采用与发布由机主决定。
