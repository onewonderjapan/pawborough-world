# lane-b-polish 2026-09-20 交付（v7 候选）

状态：**delivered_for_lead_review**（ownerAdopted=false；Codex 与机主交付后审，非阶段门）
基线 `ec2ab2f`（分支 `work/lane-b-polish-20260920`）；候选数据集 `world/fangbang-temple-v7`。

## 一句话

B弄口两大坐标缺陷（quad 三元组塌陷 + B_RIGHT 的 +Y 旋转符号反）按生产 `obbToWorld` 语义实测修复，
弄口铺地/排水/门墩按 S05/S07 实测墙线重建，漏斗区可达空隙用限域短墙闭合；B 模块近景精修
（真凹口窗、环框侧门、檐口端帽、墙脚返边、法线 0.35、8044→3770 tris）；双弄堂真实行走/覆盖/
剖面全 PASS，运行基线两配置实测（SwiftShader 软件基线），独立 dist 两配置运行门 OK。
A 弄成果字节不动，接口 A 区 691 三角逐顶点/UV/材质与 v6 全等。

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
node tools/lane_b_polish_walktest.mjs                   # WALKTEST_V7_PASS
node tools/lane_b_polish_capture.mjs --phase both       # CAPTURE_PASS
node tools/lane_b_polish_runtime.mjs                    # RUNTIME_BASELINE_PASS
blender -b --factory-startup -t 4 -P kit/build_lane_b_polish_review_scene.py
node scripts/build_lane_b_polish_dist.mjs               # DIST_RUN_OK
node --test tests/*.test.mjs                            # 103/103
```

## 关键数字（全部实测）

| 项 | 数值 |
|---|---|
| B 模块 | 3770 tris（≤4500 目标 PASS；v2 为 8044，含新增漏斗墙） |
| 混合接口 | 911 tris（≤1000 目标 PASS；A 区与 v6 全等） |
| 默认全场 | 694430 ≤ 700000（v6 698704 → −4274） |
| 全开 skins+props | 708066（单列；v6 712340 → −4274；超基线上限 +8066，如实记录非默认配置失败） |
| 行走验证 | 26 项控制器测试、810 墙记录+11006 地面三角、覆盖 1209 采样 0 空洞 0 高度异常、5 剖面 maxStep ≤ 0.020m |
| 运行基线 | ready 7936/8968ms；首有效帧 9549/9297ms；≥90s 循环 P50 16.7ms / P95 16.8ms（两配置；SwiftShader 软件基线，非 60FPS 硬件宣称）；3 次 P/V+A/B 往返资源零增长 |
| 独立 dist | 95 文件 154,315,745 B；两配置 ready/routeCheck/三角数精确复现 |
| 测试 | 103/103（新增 lane-b-polish 9 项） |

## 证据索引（artifacts/lane-b-polish/）

- `baseline/measure-before.json` — v6 六项定向检查（1 过 5 败：变换对账锚定 + 塌陷/镜像/空洞/门槛/衣布实证）
- `verify/measure-after.json` — v7 六项全过；`verify/walktest-v7.json` — 双弄堂全部行走/边界/覆盖/剖面 + A 回归
- `before/*.png` + `after/*.png` — 同机位 4 对（取景按钮去卡）；`after/window-oblique.png` 斜视进深补充；`after-allskins/`
- `blender/*.png` — 4 张 Cycles CPU 静帧（`world/lane-b-polish/review/scene.blend` 可重开，52 网格+S04/S05/S07 上下文）
- `web-capture.json` — 两配置页面实测预算与 routeCheck
- `runtime-baseline.json` — 加载阶段/首帧/帧间隔原始样本/环境信息/资源循环

## 遗留（如实）

1. 全开配置超 700k 基线上限 +8066（单列配置，非默认失败；较 v6 的 +12340 已降）。
2. 门洞东角 y>2.65 露向 S07 南立面（v6 现状保留，未新增临街构筑）。
3. 后门凹龛盒体伸入不可见背巷 0.25m（v2 构件按 SPEC 原样保留）。

## 范围与保护

仅新增：`world/fangbang-temple-v7/**`、`world/lane-b-polish/**`、本批 kit/scripts/tools/tests、
`artifacts/lane-b-polish/**`。旧 building/旧 world/lane-a-polish/v6 及更早只读（git 0 修改旧文件，
`git diff --check` 干净）；W2 正本未访问未写入（字节未复核）。未 merge/push/发布/切统一入口；
无子代理、无监视/定时任务；本批服务进程均为 localhost 自启自止。
