# 三穗堂细化模块（T2）— 2026-09-23

主控灰模（`pawborough-sansuitang-greymodel-20260923`，剖面冻结，原 README 存为 `README-greymodel.md`）的施工细化 + 豫园接入实例模块。
灰模原构建保留于 `reference-greymodel-build.py`。

## 实物
- `build.py`：细化构建（灰模逐值继承 + 五项细化），`blender -b -t 4 --python-exit-code 1 -P modules/sansuitang/build.py`
- `model.glb`：**22,114 tris / 1.75 MB，validator 0 错**（`validation.json`）；重导入核对 `reimport.json` 0 issue
- `model.blend`；`collision.json`（实例/本地坐标，盒结构沿用灰模）；`measurements.json`；`recipe.json`（材质/细化/重锚记录）
- `render.py` + `shots/`（front/left-3q/side/back/porch/interior/aerial，Cycles CPU `-t 4` 40 spp）

## 细化项（灰模 README「交 GLM 细化时的要求」逐条）
| 项 | 实现 |
| --- | --- |
| 格扇格心 | 解析 alpha 贴图 1 张（`textures/lattice-core-alpha.png`，1 m = 8×8 方格+斜格），格扇 16 扇 + 梢间半窗 2 + 上层格纹带 4 面 + 屏门 4 扇共用；glTF alphaMode=MASK cutoff 0.5 |
| 次间栏杆望柱栏板 | 望柱（0.14 方柱+青石柱帽）×3/间 + 栏板 + 下枋 + 扶手，两梢间 |
| 檐下椽头与檐枋 | 方椽 0.09×0.75 @0.30 m 沿上下两檐口 512 根；前后左右额枋补齐 + 上檐檐枋一圈 |
| 瓦当滴水 | 上下檐口 512 组：8 边瓦当盘 + 三角滴水盘 |
| 正脊吻/垂脊/戗脊收头 | 正脊两端四段递进吻 + 顶珠；垂脊下端/戗脊檐角端各 4 处小斗+顶珠（取 loft 端环沿脊向延伸） |

## 材质（source-kit，`recipe.json.materials`）
灰瓦 `roof-color.jpg`+`roof-normal.png`；深红栗木 `wood-stain-color.jpg` tint `6a2e22` + `Wood092` 法线；白墙 `PaintedPlaster017` tint `f2efe8`；青石 `Bricks061` tint `8b9089`。纹理目录：主仓 `asset-authoring/yuyuan-entry/source-kit/textures`。

## 冻结剖面（未改）
台基 0.55（外出前 1.0/侧后 0.6）、柱网 6 线（廊柱 Ø0.30）、下檐口 4.35、上檐口 6.6、脊 9.4、面宽 17.0 = 3.2/3.4/3.8/3.4/3.2、进深 13.7 = 廊 2.4 + 堂 11.3。

## 坐标与接入契约
- GLB Y-up，立面 +Z 朝园水；**原点 = 台基外包平面中心**（灰模原点在前廊柱列中心，导出前整体 +6.65 GLB z 重锚，`REANCHOR`）。y=0 = 园内地面，台基面 y=0.55。
- 接入：`SANSUITANG=1` 时 build-scene 跳过程序化 hall `bld-428179901`；assemble 导入 `out-garden-kits/sansuitang-bld-428179901/model.glb` 为实例模块，位置 = `baseline/layout.json` footprint 形心，`rotY = atan2(facade.dir.x, facade.dir.z)`。
- 碰撞：`collision.json` 为实例坐标（含重锚）；总装世界坐标 = 实例位姿变换后。

## 已知取舍
山花仍为平三角面（无博风板/悬鱼，灰模冻结取舍）；吻为四段递进体块（非雕件）；门为关闭状态（实心背板 + alpha 格心，不透室内）；椽头在翘角区随檐口起翘、角部有交叠。
