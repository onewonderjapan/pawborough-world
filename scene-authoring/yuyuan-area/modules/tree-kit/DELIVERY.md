# DELIVERY — 树种套件（樟/柳/桂）+ 46 棵映射（R1 返修版）

包ID `pawborough-w1-tree-kit-20260922` · 返修单 `pawborough-w1-tree-kit-r1-20260923` · 分支 `work/w1-tree-kit-20260922`（worktree，基于 33a3bd72）· 2026-09-23 交付待主控审查。`ownerAdopted=false`。

## 一句话

园林区 46 棵 icosahedron 树冠占位 → 三个低模树种（樟/柳/桂）× 大小两档 = 6 个独立 GLB + 逐棵 `tree-placements.json` + 每树种 trunk 碰撞盒 + 自有测试 **10/10** 通过（8 项既有 + 2 项 R1 新增）。R1 返修完成：① 桂树干伸进树冠 0.35 m（≥0.30 要求）悬空消除；② 柳树冠改 4 个伞形簇 + 垂条从裙沿均匀垂到 0.8 m，实心体积占比 0.334/0.292（≤0.50）；③ 本包 `artifacts/tree-kit/` 补齐 RESULT/DELIVERY/PROGRESS/tests.log 与 before/after 同机位渲染。**未改冻结布局、build-scene.mjs / assemble.py / rebuild-review.sh / package.json / 任何既有测试；接入主管线仍是主控后续步骤。**

## R1 三项返修对照

| # | 返修单所见 | 施工结果 | 验证 |
|---|---|---|---|
| 1 | 桂树干顶与树冠底之间 0.5–1.2 m 空隙 | 建模顺序反转：先建树冠并缩放到冠顶基高，量出树冠最低点，树干/分叉按其定位，树干顶 = 最低点 + 0.35 m | builder 硬断言 + `test_osmanthus_trunk_reaches_into_crown`（从 GLB 材质分组解析：bark 顶点 y ≥ 树冠最低点 + 0.30）。实测小 2.325/1.975、大 3.458/3.108 |
| 2 | 柳树冠是实心椭球块，柳条只挂下沿 | 重写 `build_willow`：4 个伞形簇（1 顶簇 + 3 裙簇，每簇小头在大裙之上，无实心核心）；垂条 12/14 根，等方位角间距、同一挂点半径/高度（从实测裙沿量取），底端统一 0.8 m | builder 内体积自检 + `test_willow_crown_structure`（GLB 解析：实心连通体 6–8 = 3–4 簇 × 2、垂条 10–14、底端 0.8±0.06、实心体积/冠包络 ≤ 0.50）。实测占比 0.334（小）/ 0.292（大） |
| 3 | RESULT.json / DELIVERY.md 未写进 artifacts/tree-kit/（DELIVERY 误写在 workspace/ 根） | 本包 `artifacts/tree-kit/` 现含 RESULT.json、DELIVERY.md、PROGRESS.json、tests.log、renders/before+after 及全量生成物；gtree-2 fallback 超限如实写入 RESULT.partial | 见本目录 RESULT.json `partial[0]` |

柳树"实心体积占比"口径（design_inference，已记录 PROGRESS）：实心簇网格体积 / 冠部几何（叶簇+垂条）包围盒椭球体积（π/6·bbox）。
"均匀下垂"实现：等方位角间距 + 全部垂条同一挂点半径（0.93×实测裙沿半径）与同一挂点高度，底端齐平 0.8 m 线。

## 实际数字（R1 后）

| 项 | 值 |
|---|---|
| GLB | 6 个，全部 Khronos validator 0 错 0 警；重导入核对（贴图连接/sRGB/MASK alpha/法线/边界）ALL PASS |
| tris/变体 | 樟 830/954（未改），柳 1736/1752（簇化后），桂 1048/1052（未改；预算 ≤2600） |
| GLB 字节 | manifest.json 全量 sha256 |
| 冠宽 | 樟 6.08/6.47 m（spec 6–7）；桂 3.69/3.86 m（spec 3.5–4）；柳 5.83/6.73 m（垂帘形，spec 未定宽，较上版加宽） |
| 冠顶 | 每变体基高精确 5.2 / 6.6 m；46 棵 scale 0.871–1.133 → canopy top = layout height（±10% 富余） |
| 树种分布 | 樟 23 / 柳 11 / 桂 12（不变；S3 摆放映射未动） |
| 解析贴图 | 4 张 512²（未改，map-authoring.json 已记录） |
| 渲染 | after 12 张变体视图 + 航拍 1500×2000 正交（相机与上一版逐参数一致）+ contact sheet + before/after 对比表；Cycles CPU `-t 4`，全过空白帧守卫 |
| 工时 | R1 返修单窗口内完成（Blender 并发 ≤2、每进程 4 线程遵守） |

## 交付物位置（本包 = R1 返修包）

- **本包** `pawborough-w1-tree-kit-r1-20260923/artifacts/tree-kit/`：RESULT.json、本文件、PROGRESS.json、tests.log、`renders/before/`（上一版 12 张 + 旧航拍，同机位）、`renders/after/`（本版 12 张 + 新航拍 + 守卫记录）、glb/、textures/、blends/、manifest.json、validator-report.json、reimport-check.json、build-report.json、contact-sheet、before-after-sheet
- 源码/记录（已提交原分支）：`…/modules/tree-kit/` — scripts/（s0–s4 + r1_before_after_sheet）、tests/test_tree_kit.py（10 测试）、site-inputs.json、tree-placements.json、collision.json、map-authoring.json、PROGRESS.json、RESULT.json、本文件、review/ 三张 <400 KB 图
- 生成物（不入库）：`scene-authoring/yuyuan-area/out-tree-kit/`（gitignored）

## 同机位说明

s4a 原按导入 GLB 包围盒自动取景，几何一变机位即变。R1 的 after 渲染改为从**上一版 reimport-check 的包围盒**（`out-tree-kit/r1-cam-bounds.json`）取相机参数，因此 before/after 每张图相机逐参数一致；樟树未改动，其 before/after 图像素级可对（见对比表第 5–6 行）。航拍相机只依赖摆放范围（未变），天然同机位。

## 集成提示（给主控）

- GLB 为 Y-up、原点在干基、单位米；摆放 = `position(x,z) + rotY(弧度) + scale`。collision 盒为方形（rotY 不变），halfExtent 与 yMax 按放置 scale 缩放。
- 柳树干倾斜 ≤8°（实建 5.96/5.92°）；摆放 rotY 随机化倾斜方向，碰撞盒 halfExtent 0.5 已覆盖。
- 柳冠加宽至 ~5.8/6.7 m：近水 placements 间距下柳冠可能轻微相邻交叠（垂帘树常态），如需避让由主控在摆放侧缩放/间距调整。
- MASK 材质 cutoff 为 glTF 默认 0.5；引擎侧如需显式 cutoff 请自行写入 0.5。
- 桂树可见干高变为 2.33 m（小）/ 3.46 m（大）：为满足 R1"树干进冠 ≥0.3 m"，原 spec 注记"低干 1.2 m"让位于返修要求，已记录 PROGRESS.assumptions。

## 假设与偏差（详见 PROGRESS.assumptions）

1. **layout 高度 4.53–7.48 m** 超出 DESIGN_SPEC 注记 4.5–5.7；以冻结 layout 为准（冠顶 = layout height ±10%）。
2. **hall/xuan 按字面**取 layout kind hall+xuan（16 个）计桂树规则。
3. **fallback 超限 1 例（partial）**：gtree-2 深入水体 water-428179908 2.32 m，1.0 m 上限无法出水，按最小退出距离移动 2.371 m 满足"无一棵位于 footprint/水体内"硬测试；其余 8 棵越界树移动 ≤1.0 m。原 S3 引入，R1 未改摆放，仅按返修单补记入 RESULT.partial。
4. 树皮两版着色（中性 + oxblood）出自同一程序图（樟对齐 temple-v3 参考）。
5. R1 新增：桂"低干 1.2 m"注记被返修要求取代（见上）；柳冠加宽与实心占比口径属 design_inference。
6. R1 过程修正：测试新增的连通体计数器初版并查集合并有陈旧根缺陷（会把垂条误计为 24），已修复并以 12 垂条真值核验。
