# 控制层导出（WP11）— AI 视频条件输入

把豫园 3D 场景导出成 AI 视频生成（机主走 AI 视频，3D 只当参考/控制层）的四通道逐帧条件输入：
beauty / depth / normal / segmentation，加每帧相机内外参与分割 LUT。

## 产物

`3 镜头 × 24 帧 × 4 通道 + cameras + LUT`，落在工单包 `artifacts/control/`（**不进仓库**；仓库只进脚本与本文档）：

```
artifacts/control/
├── segmentation-lut.json        # layout id ↔ RGB 双向映射
├── timings.json                 # 每帧各通道渲染耗时
├── fangbang-westbound/          # ① 方浜中路沿街西行，停步山门前 6 m，末 6 帧转向山门
├── habao-plaza-pan/             # ② 华宝楼前中心广场沿弧线环视（R1；round 0 是定点 360° 环视）
│   ├── beauty/frame-000.png     # 参考/构图参考（Workbench，默认 AA）
│   ├── depth/frame-000.png      # 16-bit 灰度
│   ├── normal/frame-000.png     # 8-bit RGB
│   ├── segmentation/frame-000.png
│   └── cameras/frame-000.json   # 每帧内外参
└── jiuqu-to-huxinting/          # ③ 九曲桥上走向湖心亭（R1：升高机位、注视锁定湖心亭）
```

R1 重出的 ②③ 在 `artifacts/r1/control/`（默认程序化体块）与 `artifacts/r1/control-towers/`
（`BAZAAR_TOWERS=1` 华宝楼套件，只出②）；①沿用 round 0 产物（路径未变）。

镜头路径不在代码里写死，由 `scripts/build-control-shots.py` 从冻结源重算：
`baseline/layout.json`（对象/footprint/polyline、山门实例锚）+ `out-zone/fangbang-route.json`
（方浜中路 mainStreet）+ `out-zone/commercial-route.json`（源数据存在性校验）。

## 用法

前置：先过公共验收全流程重建（`OUT_DIR=out-zone … bash scripts/rebuild-review.sh`），产物齐全。

```bash
# 1) 推导三镜头相机路径 -> $OUT_DIR/control-shots.json（python3，无需 Blender）
python3 scripts/build-control-shots.py --out-zone out-zone

# 2) 渲染四通道（Blender CPU，-t 4；输出目录在仓库外，图不进仓库）
blender -b -t 4 --python scripts/render-control-passes.py -- \
    --scene out-zone/scene-areas.glb \
    --cameras out-zone/control-shots.json \
    --out <工单包>/artifacts/control

# 3) 校验 + RESULT.json（C3）
python3 scripts/check-control-passes.py \
    --control <工单包>/artifacts/control --report <RESULT.json 路径>
```

华宝楼塔楼变体：先 `BAZAAR_TOWERS=1 OUT_DIR=out-zone-towers … bash scripts/rebuild-review.sh`，再
`BAZAAR_TOWERS=1 python3 scripts/build-control-shots.py --out-zone out-zone-towers`，渲染用
`--scene out-zone-towers/scene-areas.glb --cameras out-zone-towers/control-shots.json --shots habao-plaza-pan`；
测试 `BAZAAR_TOWERS=1 OUT_DIR=out-zone-towers node tests/control-shots-test.mjs`。

`--shots id1,id2` 可只渲子集（调试用）。相机 json 也可手写：格式见
`scripts/render-control-passes.py` 头注释（含 `out-zone/tour.json` 风格的固定机位 `p`/`t` 写法）。

## 场景来源（二选一，写明）

**用 `out-zone/scene-areas.glb` 重导入**（不用 assemble 末尾的 scene.blend）。
理由：scene-areas.glb 是全流程重建链的最终产物（含 assemble-food 增量、坐标准回
glTF Y-up），重导入不依赖中间 .blend 的版本兼容性，且与浏览器/校验链看到的是同一份几何。
节点命名是分割归属的依据（见下）。

## 通道编码规范（1280×720，每镜头 24 帧）

| 通道 | 引擎 | 文件 | 编码 |
|---|---|---|---|
| beauty | Workbench（TEXTURE+STUDIO，Standard 视图变换，AA=8） | 8-bit RGB PNG | 参考图，无特殊编码；背景=天灰 |
| depth | Cycles 1 spp + RenderLayers **Depth** pass → MapRange → BW 16-bit PNG | 16-bit 灰度 PNG | `gray = round(65535·clamp((z−near)/(far−near), 0, 1))`；z = 视轴 z 深度（米，沿相机 −Z 轴的**平面距离**，非欧氏线距，已用探针实测确认）；near=0.3 / far=300 写进每帧 cameras json；背景=clip_end=far → 65535；无 AA（filter_size=0） |
| normal | Cycles 1 spp + material_override 自发光 `(n+1)/2` | 8-bit RGB PNG | `rgb = round(255·(n+1)/2)`；n = **glTF Y-up 世界系**单位法线（着色器里从 Blender Z-up 做 (x, z, −y) 置换；地面向上 = (128, 255, 128)）；背景/无效 = (0,0,0)；无 AA |
| segmentation | Workbench（FLAT 光照 + OBJECT 色，Raw 视图变换，无 AA） | 8-bit RGB PNG | 每个 layout 对象一个 LUT 色，**逐字节精确**（Workbench 输出抖动有 ±1 LSB，反查容差 ±2）；未归属几何与空背景 = unassigned |

每镜头三段连续渲染（beauty → seg → normal+depth），引擎各只切换一次，
`use_persistent_data` 让 Cycles BVH 跨帧复用（实测稳态 ~1.6 s/帧/镜头，含三通道）。

## 相机 json（每帧 `<shot>/cameras/frame-###.json`）

- `width/height`、`fovXDeg/fovYDeg`、`K`（像素单位，OpenCV 排布）、`principalPoint`。
- `worldToCameraOpenGL` / `worldToCameraOpenCV`：4×4，**世界系 = glTF Y-up**（three.js；即地图
  `[x, y高度, z]`，与 GLB/tour.json 同系）。相机局部系 +X 右 +Y 上、看 −Z。
  OpenCV 版 = diag(1,−1,−1)·OpenGL 版，可直接 `u=fx·x/z+cx, v=fy·y/z+cy`。
- `cameraPositionWorld/targetWorld`（地图系，调试用）、`depthNearM/depthFarM`。
- `blenderMatrixWorld`（调试用）。

坐标契约：地图 (x,z) → Blender (x, −z, y)（同 assemble.py）；glTF Y-up 世界 = 地图 `[x, y高度, z]`。

## 分割归属与 LUT

对重导入后每个 mesh 对象取 layout id（按优先级）：

1. 节点名管道式 `zone|id|kind|lod`（程序化分区件）→ 第 2 段；`food|<socket>` 顶层名 → 伪 id `<socket>`；
2. 沿父链找名字在 layout id 集合（objects ∪ instances）里的锚空节点（L2 模块/站点件/树）；
3. 锚名 `awning-<layoutid>-<k>`（檐棚）→ 归属 `<layoutid>`（所属建筑）；
4. 锚名 `fangbang-*`（方浜中路 v7 件，非 layout 对象）→ 伪 id（如 `fangbang-street-ground`、`fangbang-N03-cloth_shop`）；
5. 其余 = unassigned 固定色 (255,0,255)。

`segmentation-lut.json`：`idToRgb` + `rgbToId` 双向映射（生成时校验可逆），
颜色由 md5(id) 派生、碰撞重哈希，跨次运行确定性一致。

## 已知限制

- 分割色有 ±1 LSB 抖动（Workbench FLAT 内建 dither，无开关），反查用切比雪夫距离 ≤2 的最近邻。
- depth/normal 的 clip_end=far=300 m：300 m 外几何在这两通道不可见（beauty 同 far，天际线一致裁剪）。
- beauty 用 Workbench：材质/贴图的简化渲染，作构图/运动参考，不是最终画质。
- 空白帧守卫：beauty 用 COMMON 口径（亮度 std<2/255 或主色>95%）；segmentation 为平面色图、
  明度方差天然低，按主色占比>98% 判；normal/depth 动态范围窄，用更严的近常数判据（std<0.2 或主值>98%）。

## R1 镜头取景（2026-09-25 主控复验返修）

round 0 只验了「非空白」，没验「看得见目标」：②大半帧对着墙，③被墙和桥栏尖挡住。R1 起每个镜头在
`control-shots.json` 里声明取景目标 `targetId`，并可带焦距 `lensMm`（36 mm 横幅传感器，缺省 50 mm）。

| 镜头 | 目标 | 相机 | 焦距 |
|---|---|---|---|
| ① fangbang-westbound | `temple-shanmen` 城隍庙山门 | 不变（round 0 路径逐字节相同） | 50 mm |
| ② habao-plaza-pan | `bld-428202599` 华宝楼 | 绕楼 footprint 包围盒中心 R=40 m 弧线，方位 +6°→−24°（东南→西南，30°，移动 20.9 m），眼高 1.6 m，逐帧注视楼 footprint 棱柱角点的角度中点（整楼居中） | 18 mm |
| ③ jiuqu-to-huxinting | `huxin-ting` 湖心亭 | 机位高 4.0 m（桥面 0.55 + 3.45），桥中线 ±2.5 m 滑动平均切角（离中线 ≤0.6 m），桥头→离亭形心 22 m，注视锁定亭形心 3.5 m 高 | 35 mm |

**为什么②用 18 mm**：中心广场是围合院落，44 m 宽的临广场立面前只有 ~25 m 进深。眼高 1.6 m 在广场内
要整座楼入画，24 mm 只能在 R=43 m、16° 的弧上做到（塔楼变体 24.3 m 高时 0 帧），18 mm 在 R=40 m、30°
弧上两变体逐帧整楼入画、离碰撞盒 ≥2.3 m。超广角的透视拉伸是这块场地的代价；cameras json 的 K/fov 如实记录。
**塔楼变体**：`BAZAAR_TOWERS=1` 时目标高 = `modules/bazaar-tower-kit/params/huabao-bld-428202599.json`
的 max(`roof.ridgeHeightM`, `pavilion.finial.topM`) = 24.3 m（程序化体块 = layout height 13.6 m），
机位弧线两变体相同、注视点随目标高上移。

### 可见性断言（`tests/control-shots-test.mjs` R1-2，渲染前、几何代理）

度量在 `scripts/control-shot-visibility.mjs`（CLI 可逐帧打印），几何原语复用 `scripts/tour-visibility.mjs`
（与 tour-test R1 同一套碰撞集 / 目标盒 / 遮挡判定）；控制层另用渲染相机的真实 fov（1280×720、`lensMm`）。

- 每帧三条：目标包围盒 9 采样点 ≥5 点视线不被碰撞盒挡；目标投影**裁到画面后**占比 ≥8%
  （wave3-tourfix T1 起 tour-test / compute-area-tour 与控制层共用同一个 `screenAreaFrac`，都裁画框；旧导览不裁口径在目标出画时也会得出大面积）；
  相机离最近可遮挡碰撞盒（顶 ≥1.6 m）≥1.5 m。
- 终点帧三条全满足；每连续 6 帧至少 3 帧满足。**例外**：①是行进揭示镜头（GOAL「①不变」），
  山门在庙前转角后才露出，窗口规则对①只查末 6 帧；终点帧规则照常。
- ②另查：机位沿弧线移动（≥10 m、半径变化 ≤1 m、扫角 ≥20°），整座楼（footprint 棱柱，高 = 变体目标高）逐帧全部在画面内。
- ③另查：机位在桥面上（离中线 ≤0.85 m；桥栏内侧 0.89 m），终点离湖心亭形心 15–25 m，
  画面下 1/3 被 10 m 内桥栏挡住的射线 ≤15%（桥栏按 layout 折线 ±1.01 m、桥面起到柱头尖顶 +1.23 m 的实心带重建，保守上界）。
- 新断言先在 round 0 镜头上跑过：71 条 FAIL（②窗口 2–18、非弧线、整楼 0 帧；③窗口 6–17、桥栏 20–100%），①通过。

### 渲染侧取景（`scripts/check-control-passes.py`，渲染后真值）

cameras json 带 `targetId` 时，逐帧统计取景目标（本体 + `facadeBay.parentBuilding` 指向它的立面开间）
在分割图上的像素占比，终点帧 <5% 报错；另记画面下 1/3 的九曲桥栏像素占比（分割=jiuqu-bridge 且法线竖直）。
碰撞盒只是代理：round 0 ①前 20 帧碰撞盒判「7/9 点未挡」，渲染里山门像素却是 0（街角店块几何不在碰撞集）。

### 已知限制（R1）

- 湖心亭（`huxin-ting`，layout tower L1）渲染是两层素面体块 + 歇山顶，不像亭；另有同一 OSM way 228035340
  派生的 `bld-228035340`（outerBuilding，5 m）与它 footprint 重合、包住下层——镜头能看到目标，但目标本身读不出亭。
  这是场景/布局问题，不在本工单范围。
- ②超广角（18 mm）边缘透视拉伸明显；若要常规焦距，需要机位出广场（越过南侧建筑）或接受只拍局部立面。

## wave3-tourfix（2026-09-25）按默认场景（湖心亭模块 + 20 栋厅堂）重出

- 相机路径未变：`build-control-shots.py` 在新场景上的输出与 R1 `control-shots.json` 逐字节相同（路径只依赖
  layout / fangbang-route 冻结源）；变的是场景——湖心亭换成站点模块，与它同 footprint 的 `bld-228035340` 不再渲染。
- `check-control-passes.py` 新增两条：
  - 终点帧目标像素门槛按镜头加严：`TARGET_END_MIN_BY_SHOT`，③ `jiuqu-to-huxinting` ≥ 10%（其余仍 5%）；
  - 重复件：layout 里 footprint 覆盖目标 footprint ≥ 50%、高度 > 0 的其他对象，逐帧分割像素占比必须 < 0.1%
    （R1 渲染上 ③ 24 帧全部报错：`bld-228035340` 露出 7–15%；新场景 0%）。
- 投影占比：wave3 T1 起 tour-test 与控制层共用裁画框的 `screenAreaFrac`（无选项，只有一种口径）。
- 已知：③终帧机位离亭形心 22 m、注视 3.5 m 高、35 mm，新模块屋顶高于旧体块，终帧屋脊与宝顶出画（亭身与檐口完整）。
