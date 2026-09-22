# DELIVERY — 树种套件（樟/柳/桂）+ 46 棵映射

包ID `pawborough-w1-tree-kit-20260922` · 分支 `work/w1-tree-kit-20260922`（worktree，基于 33a3bd72）· 2026-09-23 交付待主控审查。`ownerAdopted=false`。

## 一句话

园林区 46 棵 icosahedron 树冠占位 → 三个低模树种（樟/柳/桂）× 大小两档 = 6 个独立 GLB + 逐棵 `tree-placements.json`（树种规则、精确冠顶缩放、确定性 rotY）+ 每树种 trunk 碰撞盒 + 自有测试 8/8 通过。**未改 build-scene.mjs / assemble.py / rebuild-review.sh / package.json / 任何既有测试；接入主管线是主控后续步骤。**

## 实际数字

| 项 | 值 |
|---|---|
| GLB | 6 个，全部 Khronos validator 0 错 0 警；导出后重导入核对（贴图连接/sRGB/MASK alpha/法线/边界）ALL PASS |
| tris/变体 | 樟 830/954，柳 456/472，桂 1048/1052（预算 ≤2600/棵） |
| GLB 字节 | 119–224 KB/个（贴图已内嵌 PNG） |
| 冠宽 | 樟 6.08/6.47 m（spec 6–7）；桂 3.69/3.67 m（spec 3.5–4）；柳为垂帘形（spec 未定宽） |
| 冠顶 | 每变体基高精确 5.2 / 6.6 m；46 棵 scale 0.871–1.133 → canopy top = layout height（±10% 富余） |
| 树种分布 | 樟 23 / 柳 11 / 桂 12（规则：距水边 ≤8 m 柳，距厅/轩 ≤6 m 桂，其余樟；测试从 layout 多边形独立复算） |
| 解析贴图 | 4 张 512²（bark-neutral、bark-oxblood、broadleaf_cluster、willow_strip），PIL 程序生成有种子，无照片，map-authoring.json 已记录 |
| 渲染 | 12 张变体视图 + 航拍 mock 1500×2000 正交（46 棵实例 + 10 m 地面网格），Cycles CPU `-t 4`，全部过空白帧守卫 |
| 工时 | 单晚并发窗口内完成（Blender 并发 ≤2、每进程 4 线程遵守） |

## 交付物位置

- 生成物（不入库）：`scene-authoring/yuyuan-area/out-tree-kit/`（已 gitignore）= 包内 `artifacts/tree-kit/` 有全量拷贝
- 源码/记录（已提交分支）：`scene-authoring/yuyuan-area/modules/tree-kit/` — scripts/（s0 提取、s1 贴图、s1s2 建模、s2 重导入核对+manifest、s3 摆放、s4a/s4b 渲染、s4c contact sheet）、tests/test_tree_kit.py、site-inputs.json、tree-placements.json、collision.json、map-authoring.json、PROGRESS.json、RESULT.json、本文件、review/ 两张 <400 KB 图

## 集成提示（给主控）

- GLB 为 Y-up、原点在干基、单位米；摆放 = `position(x,z) + rotY(弧度) + scale`（layout z 南 → 场景 z）。collision 盒为方形（rotY 不变），halfExtent 与 yMax 按放置 scale 缩放。
- 柳树干倾斜 ≤8° 已含在 GLB 内（建 4–6°），摆放 rotY 会随机化倾斜方向——碰撞盒 halfExtent 0.5 已覆盖。
- MASK 材质 cutoff 为 glTF 默认 0.5；引擎侧如需显式 cutoff 请自行写入 0.5。

## 假设与偏差（详见 PROGRESS.assumptions）

1. **layout 高度 4.53–7.48 m** 超出 DESIGN_SPEC 注记的 4.5–5.7；以冻结 layout 为准（spec 硬规则 canopy top = layout height ±10%），变体按小/大基高两档覆盖。
2. **hall/xuan 按字面**取 layout kind hall+xuan（16 个）；pavilion/corridor/stage 未计入桂树规则。
3. **fallback 超限 1 例**：gtree-2 深入水体多边形 2.32 m，1.0 m 上限无法出水，按最小退出距离移动 2.37 m（满足"无一棵位于 footprint/水体内"硬测试）；其余 8 棵越界树移动 ≤1.0 m。全部记录在 placements.fallbackMove。
4. 树皮做两版着色（中性 + oxblood 染色）出自同一程序图，樟树对齐 temple-v3 参考的染色木风格。
5. 主仓误建空目录已在 S0 当场清除（无仓库文件被触碰）。
