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
├── habao-plaza-pan/             # ② 华宝楼前中心广场定点 360° 环视（华宝楼仍为程序化体块）
│   ├── beauty/frame-000.png     # 参考/构图参考（Workbench，默认 AA）
│   ├── depth/frame-000.png      # 16-bit 灰度
│   ├── normal/frame-000.png     # 8-bit RGB
│   ├── segmentation/frame-000.png
│   └── cameras/frame-000.json   # 每帧内外参
└── jiuqu-to-huxinting/          # ③ 九曲桥上走向湖心亭，末 8 帧注视点转向湖心亭
```

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
