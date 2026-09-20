# lane-b-polish 2026-09-20 交付（v7 候选）+ 证据补修（B7-R1/R2）

状态：**delivered_for_lead_review**（ownerAdopted=false；主控尚未复验补修结果；Codex 与机主交付后审，非阶段门）
基线 `ec2ab2f`，建筑提交 `22ca67d`（分支 `work/lane-b-polish-20260920`）；候选数据集 `world/fangbang-temple-v7`。

## 一句话

B弄口两大坐标缺陷（quad 三元组塌陷 + B_RIGHT 的 +Y 旋转符号反）按生产 `obbToWorld` 语义实测修复，
弄口铺地/排水/门墩按 S05/S07 实测墙线重建，漏斗区可达空隙用限域短墙闭合；B 模块近景精修
（真凹口窗、环框侧门、檐口端帽、墙脚返边、法线 0.35、8044→3770 tris）；双弄堂真实行走/覆盖/
剖面全 PASS；独立 dist 两配置运行门 OK。
A 弄成果字节不动，接口 A 区 691 三角逐顶点/UV/材质与 v6 全等。

## 证据补修（2026-09-20 主控 REVIEW B7-R1/R2，同 worktree 接续提交）

**撤回**：原 `runtime-baseline.json` 的"≥90 秒主街+A/B 环路 P50/P95"不作为路线完成与性能证明。
运行脚本 loop 航点是 `[x,z]`，转向却读 `tgt[2]`（undefined），`want`/`d` 为 NaN，转向分支永不触发——
实际沿出生朝向直行，从未完成约定环路，且无到达/卡住断言；帧样本只保留排序后最快 60 个；
首帧字段口径混用；旧 16.7ms 采样自庙前直行至封端墙的被遮挡视图，不代表开放街景负载。
原数据不是伪造，但不证明约定负载。原件与说明快照保留在 `evidence-repair/previous/`（含撤回说明）。

**重做（两配置实际运行，headless Chrome + SwiftShader 软件基线）**：

- 路线全部来自 v7 `route.json` 生产坐标：主街西行 87.9m → A 弄进出 26.4m → 主街回东 20m →
  B 弄进出 30.4m → 主街回东 67.9m（约 230m，107 航点，逐点顺序推进不跳墙后点）；
  仅起步显式选择 mainStreet 安全锚点，负载内 0 次传送。
- 转向闭环：位移航向（移动时）+ 输入累计 yaw（静止时，与页面 `look()` 同算术），
  合成鼠标/键盘/pointer-lock 均明确标注为测试注入，非人工试玩（manualWalkClaim=false）。
- **两配置实际完成全部 7 段路线**：default 355.7s 墙钟 / 338.1s 有效连续行走 / 255.2m；
  skins+props 415.9s / 390.8s / 254.8m；107/107 航点、0 暂停、0 跌落、0 非有限值、最长静止 1.6s。
- 加载时钟统一 navigation timeOrigin：→ready 5092/4708ms，→首有效非空白画面 5092/4708ms
  （首帧经 3×32×32 像素块 ≥4 色的真实渲染检查，非 cpuSubmitMs>0；ready→首帧差值可复算）。
- 帧统计从**全量按时间顺序原始样本**在 Node 独立重算并与落盘数据核对（tests/lane-b-evidence.test.mjs）：
  行走段 P50 350/433ms、P95 683/783ms、max 783/950ms——SwiftShader 软件渲染开放街景的真实基线
  （软件渲染下 rAF 降至几赫兹时页面把 dt 截到 0.25s，有效步速相应下降；每步仍是完整 Rapier 链）。
  **不做任何硬件 60FPS 宣称**；加载前/自动巡游/入口/PV 段全部按相位剔除并计数。
- 3 次 P/V + A/B 显式入口循环（独立相位）：真实 mode/paused/姿态/清键断言全过；
  几何/材料/纹理计数按位置逐循环对账完全一致（default 689/667/536，all-on 841/754/708），
  blocks active 7(A)/8(B) 稳定、epoch 4→6 为真实街区切换，heap 只报波动 101.1–101.8 / 105.2–105.7MB。
- 新工具 `tools/lane_b_route_steer.mjs`（纯逻辑）+ `tests/lane-b-evidence.test.mjs`（13 项，含
  tgt[2] 形状缺维/NaN 目标必须 FAIL、卡住/未完成不能 PASS、篡改字节/缺文件/错哈希清单负例必须真失败）。
- 交付清单由 `tools/lane_b_delivery_manifest.mjs` 重新生成并逐条实校验（排除自身与收据，无哈希循环）；
  清单 SHA 写独立外层收据 `evidence-repair/delivery-receipt.json`；最终 commitHash 只写顶层 RUN_STATUS。
- 复用已冻结结论：主控已复验的 9 项新测试、生产 WalkController/Rapier 物理检查（1209 点 0 空洞、
  接缝 ≤2cm）、718 旧文件保护哈希、dist 95 文件、Blender 52 网格重开——本次未重跑全套；
  本轮 2057 项冻结资产哈希独立核验全部一致。测试 116/116（原 103 + 新 13）。

**遗留不变**：全开配置超 700k 上限 +8066（单列配置，非默认失败）；门洞东角 y>2.65 露向 S07；
后门凹龛伸入背巷 0.25m。

## 直接打开

- 开发页：`npx vite --host 127.0.0.1 --port 5400` → `http://localhost:5400/fangbang.html?ds=fangbang-temple-v7`
  （全开配置 `&skins=1&props=1`）
- 独立构建：`npx vite preview --outDir dist-lane-b-polish --host 127.0.0.1 --port 5401`
  → `http://localhost:5401/fangbang.html?ds=fangbang-temple-v7`（两配置均已过门）

## 重建命令（全部在本 workspace 根执行）

```bash
blender -b --factory-startup -t 4 -P kit/build_lane_b_v3.py -- --out world/lane-b-polish/lane-b
blender -b --factory-startup -t 4 -P kit/build_lanes_interfaces_v3.py -- --out world/lane-b-polish/interfaces
node scripts/make_fangbang_v7_dataset.mjs
python3 tools/lane_b_polish_measure.py --phase before   # v6 上 5 项 FAIL 存证
python3 tools/lane_b_polish_measure.py --phase after    # 6/6 PASS
node tools/lane_b_polish_walktest.mjs                   # WALKTEST_V7_PASS（主控已复验，冻结复用）
node tools/lane_b_polish_capture.mjs --phase both       # CAPTURE_PASS（冻结复用）
node tools/lane_b_polish_runtime.mjs                    # RUNTIME_BASELINE_PASS（补修重跑，~13 分钟两配置）
blender -b --factory-startup -t 4 -P kit/build_lane_b_polish_review_scene.py
node scripts/build_lane_b_polish_dist.mjs               # DIST_RUN_OK（冻结复用）
node --test tests/*.test.mjs                            # 116/116（原 103 + 证据补修 13）
node tools/lane_b_delivery_manifest.mjs generate        # 文档定稿后生成清单
node tools/lane_b_delivery_manifest.mjs verify
node tools/lane_b_delivery_manifest.mjs receipt
```

## 关键数字（全部实测）

| 项 | 数值 |
|---|---|
| B 模块 | 3770 tris（≤4500 目标 PASS；v2 为 8044，含新增漏斗墙） |
| 混合接口 | 911 tris（≤1000 目标 PASS；A 区与 v6 全等） |
| 默认全场 | 694430 ≤ 700000（v6 698704 → −4274） |
| 全开 skins+props | 708066（单列；v6 712340 → −4274；超基线上限 +8066，如实记录非默认配置失败） |
| 行走验证 | 26 项控制器测试、810 墙记录+11006 地面三角、覆盖 1209 采样 0 空洞 0 高度异常、5 剖面 maxStep ≤ 0.020m（主控复验冻结） |
| 运行基线（补修重测） | 两配置实际完成主街+A/B 环路：default 338.1s 有效行走/255.2m、all-on 390.8s/254.8m，107/107 航点 0 暂停；→ready 5092/4708ms、→首有效画面（像素校验）5092/4708ms；行走段帧间隔 P50 350/433ms（SwiftShader 软件基线，开放街景真实负载；非 60FPS 硬件宣称）；3 次 P/V+A/B 循环几何/材料/纹理逐循环对账一致 |
| 独立 dist | 95 文件 154,315,745 B；两配置 ready/routeCheck/三角数精确复现（冻结复用） |
| 测试 | 116/116（原 103 + 证据补修 13 项负例/自洽校验） |

## 证据索引（artifacts/lane-b-polish/）

- `baseline/measure-before.json` — v6 六项定向检查（1 过 5 败：变换对账锚定 + 塌陷/镜像/空洞/门槛/衣布实证）
- `verify/measure-after.json` — v7 六项全过；`verify/walktest-v7.json` — 双弄堂全部行走/边界/覆盖/剖面 + A 回归
- `before/*.png` + `after/*.png` — 同机位 4 对（取景按钮去卡）；`after/window-oblique.png` 斜视进深补充；`after-allskins/`
- `blender/*.png` — 4 张 Cycles CPU 静帧（`world/lane-b-polish/review/scene.blend` 可重开，52 网格+S04/S05/S07 上下文）
- `web-capture.json` — 两配置页面实测预算与 routeCheck
- `runtime-baseline.json` — 补修重测：加载时钟（timeOrigin 口径）/真实路线完成判定/帧统计（由全量原始样本重算）/P/V 循环对账/服务身份核验
- `evidence-repair/previous/` — 被撤回的原始基线与清单字节快照 + 撤回说明（不删不改）
- `evidence-repair/raw/` — 全量按时间顺序帧样本与完整轨迹（时间/脚点/yaw/目标索引/到达/静止段），测试据此独立复算
- `evidence-repair/delivery-receipt.json` — 清单外层收据（清单 SHA，无哈希循环）

## 遗留（如实）

1. 全开配置超 700k 基线上限 +8066（单列配置，非默认失败；较 v6 的 +12340 已降）。
2. 门洞东角 y>2.65 露向 S07 南立面（v6 现状保留，未新增临街构筑）。
3. 后门凹龛盒体伸入不可见背巷 0.25m（v2 构件按 SPEC 原样保留）。

## 范围与保护

仅新增：`world/fangbang-temple-v7/**`、`world/lane-b-polish/**`、本批 kit/scripts/tools/tests、
`artifacts/lane-b-polish/**`。旧 building/旧 world/lane-a-polish/v6 及更早只读（git 0 修改旧文件，
`git diff --check` 干净）；W2 正本未访问未写入（字节未复核）。未 merge/push/发布/切统一入口；
无子代理、无监视/定时任务；本批服务进程均为 localhost 自启自止。
