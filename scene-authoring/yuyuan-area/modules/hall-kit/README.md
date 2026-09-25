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

接入开关 `HALL_KIT`（**默认开**，2026-09-25 机主「厅堂套件默认开启吧」；`HALL_KIT=0` 关闭）：`build-scene.mjs` 让位占位（why=`hall-kit`）、
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

`tests/hallkit-test.mjs`（`npm test` 链内；默认启用，HALL_KIT=0 时跳过）：锚点位置/朝向、
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
- 配色：框料底色 = sRGB `timberSrgb`（wave3 W0 起 #8a4030，原 #6a2e22——格扇立面偏暗，同色相提亮），不乘贴图；
  格心背衬 `latticeBackSrgb`（#55483c）、格心棂条同框料色，图 `lattice-core-alpha` 160×160 全部共享。
- 渲染：`render_hall.py --compare --ids …` 在 after 总装里按射线可见度挑机位；`contact_sheet.py` 出联系表（图只进工单包）。

## wave3 K1：共享边按段限位（2026-09-25，wave3-towerkit）

- wave2 把有共享边的一侧**整侧**限位（得月楼正立面整体内收 1.835 m、腰檐只剩檐线）。现在硬山的前 / 后侧改为**按段**：
  `frame.side_intervals` 给出该侧的限位区间 = 共享边条带（重叠段沿外法线外推 `sharedStripReachM`，斜边也罩住）∪ 邻栋占位
  （共享边所连邻栋 footprint 在切向每 `sharedScanStepM` 一格、离矩形中心的最小外向距离 < 该侧正常最远构件的格），外扩
  `sharedSegMarginM`，离端点 / 间隔 < `sharedSnapM` 并掉。
- 区间内：檐口截到限位线（同一剖面截断），台基齐边不外挑；墙线越界才**局部凹口**（墙线 = lim − 0.22，凹口块为白墙隔墙、无窗无格扇无平座，
  块边界加两层通高回墙并封住平座端头；柱网按分块各自排开间，回墙落在柱线上）。区间外：照常出檐 1.0、台基外扩 0.2、腰檐外伸 0.8。
- 段端收头：正檐两块出檐不同处在长檐一侧放白墙端板（墀头式，封住屋面上皮 / 瓦头 / 封檐板 / 檐底断面）；腰檐环线在段外让出 over，
  凸角翼角斜切落在条带外（eave_kit.eave_skirt 支持凹多边形）。斗拱出挑按每柱所在处的檐口外缘分组。
- 区间或凹口盖满整侧时退回 wave2 整侧规则（仰山堂 / 三穗堂：三穗堂的边在共享段外偏出 0.05 容差继续贴着仰山堂背面）。歇山、两山侧仍整侧。
- 测试（hallkit-test 2c）：同侧非共享段（离共享段两端 ≥ 1.2 m）台基外扩 ≥ 0.15、正檐 ≥ 0.97、两层楼腰檐 ≥ 0.795（墙线 = 矩形边 − wallInset，
  腰檐带 = 二层楼面 platformY + height/storeys 下 0.05–1.0 m，全从 layout 重算、GLB 实测）；共享边所连邻栋 footprint 内无构件（> 0.05 m）。

## wave3 K2：楼阁批量准备（只出诊断，未接入）

- 其余 9 座两层楼逐栋跑生成器（`--out out-tower-prep/hallkit-<id>`，不改 `ids.json`），`tower_prep.py` 出 `tower-batch-prep.json`：
  覆盖率 / 凹角 / 共享边段与处理方式 / 正立面边与 facade.dir 夹角 / 层高（layout height / storeys）/ 三角面 / 与会渲染建筑 footprint 互穿 /
  台基压园路、水面（阈值 = 已接入 20 栋同一诊断的最大值，`--calib`）/ 正立面前净空（机位）/ 建议 direct·special·skip。
  ```bash
  python3 -X utf8 modules/hall-kit/tower_prep.py --ids <20 栋> --gen-dir out-garden-kits --out <calib.json>
  python3 -X utf8 modules/hall-kit/tower_prep.py --ids <9 栋> --calib <calib.json>
  ```
- 薄楼（designInference）：墙线进深 − upperSetback < `minUpperFloorDepthM`(2.0) 时，二层后退缩为 max(`minUpperSetbackM` 0.3, 进深 − 2.0)，
  记 recipe.upperSetback / measurements.section.upperSetbackInferred（观涛楼 / 延清楼）。已接入 20 栋不受影响。

## wave3 W0：20 栋微调（2026-09-25，wave3-towers）

- **格扇提亮**（W0-1）：园内眼高渲染里格扇立面平均 HSV 明度验收线从 0.18 提到 0.22（`render_hall.py` facade_check，
  不合格 exit 3）。改 hall-kit 材质参数：框料 / 棂条底色 `timberSrgb` #6a2e22 → **#8a4030**（色相保持深红），
  格心背衬 `latticeBackSrgb` #2a2522 → **#55483c**；灯光不动。整改后 20 栋实测 0.240–0.418。
- **小歇山翼角封顶**（W0-2）：外接矩形短边 < 5 m 的歇山，翼角起翘（檐口角点比檐口直段高出的量 = qiao，GLB 实测）
  ≤ `xieshan.wingLiftCapM`(0.33)，验收线 ≤ 0.35（hallkit-test 3c）。起翘由 0.60 按 √比例缩后仍 0.38–0.49 的小轩
  （两宜轩 / 可以观 / 洞天福地 / 别有天 / 古戏台）统一压到 0.33，记 recipe.xieshanScaled.capped。
- **斗拱不穿屋面**（W0-3）：斗拱叠块顶原为檐高 −0.02，外挑端顶高出檐底斜面 ~0.16 m（斜俯图檐线上露小红块）。
  现顶 = 檐底（墙线 +soffitRise → 檐口 −drop−tileH−boardH 线性斜面）在外挑深度处 −0.03，随出挑分组各自下压；
  斗拱 part 由 hall-frame 改名 **hall-bracket**（独立成组，测试按名取顶点）。验收：任何斗拱顶点不高于其正上方
  屋面 / 檐底 +0.01 m（hallkit-test 3b，GLB 竖直射线实测，20 栋全数 −0.03）。
- 断言先在未修改产物上跑出失败（3c 五栋 0.379–0.491 / 3b 旧产物无独立节点，part 改名后按旧 z 复现）再修。
- **楼阁 9 栋接入**（wave3-towers，w1/w2/w3 三批）：会景楼 / 万花楼 / 藏书楼（w1）、涵碧楼 / 藏宝楼 / 快楼（w2）、
  观涛楼 / 延清楼 / 还云楼（w3），ids.json `batches` 记 w1–w3。`render_hall.py` 眼高机位选位增补：不落进别的建筑
  外扩矩形、6 轴向贴墙检测、阳光直射可达、立面投影面积 ≥15000 px²（正面贴邻栋的观涛 / 延清 / 还云，
  可见度单指标会把机位挤进楼缝拍成黑框）。这三栋正面在固定光位下背阳，场景级格扇检色低于 0.22 属场地光照
  条件（不许改灯），材质门以模块级同光照实测为准（0.374 / 0.413 / 0.407）。
