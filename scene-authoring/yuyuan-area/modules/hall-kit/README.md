# hall-kit —— 园区厅/楼/轩/台统一生成器（Fable WP8）

园区 30 座程序化厅/楼/轩/台以后由**同一个生成器**按 layout 字段批量升级。本模块是生成器 +
第一栋样板（仰山堂 `bld-428179902`）；主控看过样板渲染与测试后再放行批量。

## 运行

```bash
# 生成一栋（参数全部来自 layout 对象字段，缺省值在 defaults.json）
blender -b -t 4 --python-exit-code 1 -P modules/hall-kit/build_hall.py -- --id bld-428179902
# 全流程（rebuild-review.sh 在 HALL_KIT=1 时自动先跑生成器再总装）
OUT_DIR=out-zone SITE_MODULES=1 STALL_KIT=1 GARDEN_KITS=1 SANSUITANG=1 HALL_KIT=1 ZONE_SPLIT=1 bash scripts/rebuild-review.sh
```

接入开关 `HALL_KIT`（**默认关**）：`build-scene.mjs` 让位占位（why=`hall-kit`）、
`assemble.py` 实例放置、`export-collision.mjs` 换用模块碰撞记录。只挂了
`bld-428179902`（`HALL_KIT_IDS`）；批量放行后往该集合加 id 即可。

## 冻结规格（GOAL wave1-hallkit）

- **参数**：footprint、height、eave、rise、roofMode、storeys、facade.dir 来自 layout
  对象；platformY 及全部构造常数缺省取 `defaults.json`。生成器内不写任何一栋楼的专有数字。
- **平面**：footprint 取最小面积外接矩形（旋转卡壳）作主体；墙线内缩 0.3；台基 = 矩形外扩
  0.2、高 platformY（缺省 0.45）。柱网开间压在 3.2–3.8 m（开间数 = round(墙线宽/3.5) 微调）。
- **屋面**：必须用 `modules/shared/eave_kit.py`（主控构件，只读）。
  - `roofMode=gabled` → **硬山**：两坡凹曲屋面（u 到 ±墙线，与山墙齐平）、两端白山墙封到
    屋面线、出檐只在前后两坡。eave_kit 没有硬山闭环构件（eave_skirt 是四边闭合环，硬山两端
    不能出檐），两坡主体与前后檐口断面在本文件实现，断面比（drop/tileH/boardH/soffitRise）
    与 kit 同参；正脊端部起翘用 `eave_kit.smooth_kernel`。
  - `hip` / 其他 → **歇山**：`eave_kit.xieshan_roof` 全套（下檐腰檐 + 上段两坡 + 山花博风 +
    正脊戗脊）。未知 roofMode 一律落歇山。
  - 出檐 1.0；起翘 0.6 只给歇山，硬山不起翘。斗拱简化用 `eave_kit.brackets`（两种屋面都放，
    顶压在坡面之下避免穿出）。
- **立面**：facade.dir 一侧整面格扇（每开间 6–8 扇自适应，深红木框 + 格心 alpha MASK），
  另三面白墙 + 少量格心半窗（背墙每开间一樘 + 两山墙各一樘）+ 青砖勒脚；檐下额枋一道。
- **预算**：单栋 ≤ 10k tris（样板 2056）；validator 0 错；无散件（按 part×material 合并，
  节点 ≤ 16）。
- **放置**：位置 = footprint **多边形面积形心**（GOAL 冻结，注意不是顶点均值），朝向
  facade.dir，rotY = atan2(dir.x, dir.z)。模块原点已重锚到面积形心（生成器内完成，
  measurements.json 记 `reanchorLocalUV`）。

## 坐标 / 碰撞契约

GLB Y-up、立面 +Z 朝 facade.dir、原点 = footprint 面积形心。`collision.json` 为实例坐标
（同 sansuitang 契约），assemble 同式变换写 `OUT/hallkit-collision-world.json`，
export-collision 复核（差 > 0.05 m 即 fail）。

## storeys ≠ 1

wave2 B4 起按两层剖面生成（见下「wave2 批量」）。

## 依赖

- `modules/shared/eave_kit.py`（主控构件，只读，随主控合并登记）
- source-kit 贴图（asset-authoring/yuyuan-entry/source-kit/textures，本仓与本机主仓两路查找）
- `textures/lattice-core-alpha.png` 由 build_hall.py 生成并 pack（提交在模块目录，可再生成）

## 测试

`tests/hallkit-test.mjs`（`npm test` 链内；HALL_KIT=1 时启用，否则跳过）：锚点位置/朝向、
几何平面中心 vs 外接矩形中心、本地系尺寸、validator 0 错、预算、节点数、格心 MASK、
程序化让位、碰撞世界记录、zone-garden ≤ 12MB——全部从 baseline/layout.json 重算对账。

## wave2 批量（2026-09-25，wave2-hallbatch）

- **id 列表**唯一来源 `ids.json`（`ids` = HALL_KIT=1 默认接入的 20 栋，`batches` 记 b0–b4）；build-scene / assemble /
  export-collision / rebuild-review / hallkit-test 都读它。
- **放置 / 朝向**公式在 `frame.py`（JS 版 `frame.mjs`）：位置 = footprint 面积形心；正立面 = 外接矩形上外法线最接近
  facade.dir 的一边（同 build-scene pickEdge），几何与 footprint 对齐。facade.dir 是「形心→最近水面」方向，
  与所选边的夹角记在 measurements.facadeDeltaDeg（本单 12 栋 >5°，最大 45°）。`defaults.orient = "facade-dir"` 可退回旧行为。
- **共享边**：与其他会渲染建筑 footprint 重合的边（≤0.05 m、重叠 ≥0.3 m，从 layout 检出）所在一侧，台基齐边、
  檐口截到边线、墙线按需内收（recipe.sides）；hallkit-test 断言任何三角越界 ≤ 0.02 m。
- **kind 组合**（defaults.kinds）：hall/xuan 正面格扇；waterside 临水开敞 + 落地栏杆、陆侧格扇；stage 台基 1.2 m
  （designInference）三面开敞；tower storeys≥2 走 build_storey 两次 + 腰檐（eave_kit.eave_skirt）+ 平座栏杆 + 二层格扇后退。
- **designInference 规则**：屋面坡度夹 17.5°–33°、面宽 < 6.5 m 时檐高上限、小歇山起翘范围按最短边封顶，均记 recipe。
- 配色：框料底色 = sRGB `timberSrgb`（#6a2e22），不乘贴图；格心图 `lattice-core-alpha` 160×160 全部共享。
- 渲染：`render_hall.py --compare --ids …` 在 after 总装里按射线可见度挑机位；`contact_sheet.py` 出联系表（图只进工单包）。
