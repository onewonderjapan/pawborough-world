# Pawborough v1.0 交付书（豫园区域全域版）

封版日期：2026-10-01｜范围依据：[v1.0 改账（机主 2026-09-23 签字）](V1-REDEFINITION-20260923.md)｜版本记录：[`VERSION-v1.json`](../VERSION-v1.json)

v1.0 是**可移交版本**，不是对外公开发布：浏览器里可以进入、观看、互动的豫园区域三维场景，外加一套供 AI 视频生成使用的控制层素材。仓库根 `VERSION.json` / `DELIVERY.md` 是 2026-09-19 街段版的记录，保留作历史，不代表本版。

## 1. 范围

主体五个分区：豫园（garden）、城隍庙（temple）、豫园商城（bazaar）、池带（pond），以及方浜中路街段与其到城隍庙山门的连接段（fangbang，按需加载）。外围（outer）为 L0 体块背景，延后加载。

不包含：外围体块精修、方浜中路其余路段精修、历史测绘精度、角色与玩法、Unity。

## 2. 能力与证据

| 能力 | 结果 | 证据 |
| --- | --- | --- |
| 分区流式加载，首载 ≤ 20 MB | 核心视觉首载 15,688,354 B（14 件压缩分区 GLB + 唯一外置贴图；不含 JS/WASM、其他数据及步行模式额外下载的物理 GLB）；外围延后、方浜按需；全部分区视觉资源 20,853,846 B | `scene-authoring/yuyuan-area/out-zone/zones-manifest.json`；检查 `tests/shared-texture-test.mjs`、`tests/zone-split-test.mjs` |
| 第一人称步行 | 5 条冻结商业路线（main→jiuqu、main→gold、main→center、old-south→old-north、gold→jiuqu）Rapier 物理巡游全部通过；签字稿写的 R1/R2/R3 与这 5 条尚无编号对照记录。方浜往返：街段→山门→庙内后院，再经原南山门返回、沿道路去商城与豫园（无新增后院出口），去返程均通过。以上命令行巡游在同源（7cb61aef）另一重建实例上运行；本版输出另做了真 GPU 浏览器往返复核，通过 | `tests/route-pin-test.mjs`、`tests/zone-walk-check.mjs`、`tests/fangbang-through-walk-check.mjs`、`tests/fangbang-through-browser-check.mjs` |
| W2 实机性能 | 测试机 RTX 3080 Laptop、Chrome headless 真 GPU、1080p，构建 2e4dc3bf（早于本版），main→gold 60 秒自动巡游：步行 P50 24.3 ms / P95 32.6 ms（约 41 fps）；核心首载 3.4–4.8 s，核心 + 延后外围加载完成 3.8–5.3 s；页面错误 0。机主决定以此代替亲手步行 | [perf/W2-RESULTS-20260930.md](perf/W2-RESULTS-20260930.md) |
| 固定机位导览 | 11 个导览机位；浏览器画面检查 11/11，6 个锚点亮度门通过（真 GPU 口径） | `out-zone/tour.json`；`tests/tour-test.mjs`、`tests/tour-render-check.mjs`、`tests/tour-anchor-picture-check.mjs` |
| 控制层导出 | 16 镜 / 78 s / 1872 帧，每帧 beauty + depth + normal + segmentation + 相机，逐镜守卫全过 | S1 outbox `pawborough-pv-v1-20260930`（渲染产物不入库） |
| 一条命令重建 / 验证 | `npm run area:rebuild`（重建到 `out-zone` + 默认 72 段测试）；验证本版输出用 `OUT_DIR=out-zone npm run area:verify`（需已装 Blender 与 Python 依赖） | `scene-authoring/yuyuan-area/scripts/rebuild-review.sh` |
| 新环境恢复 | 同机隔离目录的干净克隆按清单从私有 S3 恢复 390/390 件，重建 EXIT 0、72 段测试全过；顶层 GLB 41 件与本版逐字节一致、8 件仅元数据或三角顺序不同（未在全新机器上验证工具链安装） | [MIGRATION-ASSETS.json](MIGRATION-ASSETS.json)；恢复演练 2026-10-01（源 8b525cce） |

## 3. 视觉底线

- 园区精修建筑 29 栋（要求 ≥ 20），另有庙东跨院 5 栋、三穗堂与湖心亭独立模块。
- 商城 15 栋楼，其中 5 座命名大楼（华宝、天裕、和丰、悦宾、老饭店），临街底层店面精修。
- 四区地面均有铺装材质。
- 三地标经机主看图采用：湖心亭、大假山（2026-09-30）；九曲桥修改后采用（2026-10-01）。

## 4. 机主决定记录

| 日期 | 决定 | 记录 |
| --- | --- | --- |
| 2026-09-23 | v1.0 主体改为豫园区域，接入方浜中路街段与连接段 | [OWNER_DECISION-v1-redefinition.json](OWNER_DECISION-v1-redefinition.json) |
| 2026-09-30 | 湖心亭、大假山采用；九曲桥改镂空石栏杆 + 石墩 | [OWNER_DECISION-landmarks-20260930.json](OWNER_DECISION-landmarks-20260930.json) |
| 2026-09-30 | W2 自动巡游实测代替亲手步行 | [OWNER_DECISION-w2walk-20260930.json](OWNER_DECISION-w2walk-20260930.json) |
| 2026-10-01 | 修后九曲桥采用 | [OWNER_DECISION-jiuqu-20261001.json](OWNER_DECISION-jiuqu-20261001.json) |

## 5. 使用方法

```bash
npm ci && npm --prefix scene-authoring/yuyuan-area ci
npm run area:rebuild      # 标准重建 + 默认测试（需先按 MIGRATION-ASSETS 恢复资产）
npm run area:serve        # 本地预览；入口页 index-v1.html
```

资产恢复需要有授权的 AWS 身份，见 [ASSET-RESTORE.md](ASSET-RESTORE.md) 与 `tools/restore_migration_assets.py`。

## 6. 已知边界（v1.1 待办）

- 阴影 pass 约占每帧三角数的一半、draw call 的近一半；关阴影步行约 51 fps。目标默认档步行 ≥ 55 fps。
- 商城 `zone-bazaar-3.glb` 距 10 MB 分区上限只剩约 0.12 MB，再往商城加内容前要先拆分。
- 导览锚点亮度门现分两套基线：原 headless 软件渲染口径（S1 已不可用）与 v1.0 真 GPU 口径（`GPU_WEBGL=1`）；两套不可混比。
- 同源重建有少量非字节一致输出（元数据里的绝对路径、湖心亭球体三角顺序），不影响画面。
- 仓库根 `node --test tests/*.test.mjs` 中三条 2026-09-19 街段冻结契约失效，不在 v1.0 验收链内，需重定基线或退役：dadian、yimen 两条是材质白名单未收录 2026-09-25 庙区格扇新增的衬板材质；shanmen_v2 是山门 29 条碰撞记录与 9/19 交付件不一致（几何等价仍通过），尚未归因。
- 待办造型项：殿宇歇山山花、店招、青石铺装色调、方浜夜景灯笼光池观感对照。
- 老饭店外观只有文字依据，缺实拍参考。
