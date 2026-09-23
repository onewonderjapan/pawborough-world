# DELIVERY — 集市摊位套件（43 摊 + 8 凳 + 16 街块檐棚）

包 `pawborough-w1-bazaar-stalls-20260922` · 2026-09-23 · GLM-Flash wave-1
分支 `work/w1-bazaar-stalls-20260922`（未 push）· RESULT.json: `delivered_for_lead_review`, ownerAdopted=false

## 交付物

**模块 GLB（`scene-authoring/yuyuan-area/out-bazaar-stalls/`，镜像在 artifacts/bazaar-stalls/）**

| 模块 | tris | 字节 | 内容 |
|---|---|---|---|
| stall-steam.glb | 364 | 30,836 | 木柜台 1.6×0.7×0.9 + 展示柜单元（搁板面 1.16=点心 case 位，顶面 1.31=蒸笼面）+ 托盘面 1.01 + 柱上后搁板 + 备用蒸笼叠 + 奶白帆布棚（前缘 2.2）+ 空节点 socket_tray / socket_steamer / socket_case |
| stall-grill.glb | 416 | 38,856 | 钢烤炉箱（炉面 1.13）+ 集烟罩 + 烟囱 + 串签架 + 酒红帆布 + socket_tray / socket_grill |
| stall-drink.glb | 460 | 40,192 | 0.9 宽玻璃门柜（alpha 0.25，杯架面 1.31）+ 水壶叠 + 靛蓝帆布 + socket_tray / socket_cup |
| bench.glb | 72 | 7,352 | 1.6×0.45×0.5 四腿木凳 |
| awnings/*.glb ×16 | 24.3–30.6 tris/m | 6–40 KB | 每街块最长前边一条：墙侧 2.72 → 街侧 2.4 @15°，挑出 1.2，0.5 m 扇贝边，铁托架 1.5 m 间距（2 per 3 m），帆布酒红/靛蓝/奶白轮换 |

**placements**
- `placements.json`：43 摊（type 由 foodUse 驱动：蒸煮/点心→steam 23，烤制→grill 11，饮品→drink 9；extras.slots 逐字复刻冻结布局）+ 8 凳，含碰撞盒（摊 2.0×0.7 h2.2，凳 1.6×0.45 h0.5，檐棚不可达不设碰撞）
- `awning-placements.json`：16 条边中点 / dir / lenM / outward / rotY

**验证（全绿）**
- Khronos validator 20/20：0 errors，0 warnings（info 为 socket 空节点 UNUSED_OBJECT/NODE_EMPTY，属设计）
- GLB 重导入核对 20/20：socket 空节点位置与布局局部偏移完全一致、无图像节点、包围盒/三角数/sha 匹配
- `tests/test_bazaar_stalls.py` 18/18 PASS（exit 0）：43 摊类型与 slots、8 凳、16 檐棚长度 ±0.05、预算、validator 0、sha256、渲染守卫
- 渲染 Cycles CPU（-t 4，单进程）：空白帧守卫 0 空白；mock row（cluster 1 六摊+凳按冻结位姿）socket 世界坐标 4/4，err=0.0，与 out/food-sockets.json 数值一致

## 关键假设（详见 PROGRESS.assumptions）
1. 点心→steam 类型（spec 原文）；蒸汽模块用"搁板面 1.16 + 顶盖面 1.31"一个柜体同时满足点心展示与蒸笼挂载，slot 位姿逐字精确。
2. "16 bazaarBlock front edges" = 每块取其最长前边（主街面），恰得 16 条；全部 ≥5.3 m，<1.5 m 回退未触发。
3. "one awning strip module" = 一个参数化生成器出 16 个按边定长的 GLB（不做实例缩放，避免扇贝/托架失真）。
4. 帆布"交替色"按类型实现（模块单材质）；檐棚条按边序轮换三色。
5. 摊位碰撞盒 2.0×0.7 h2.2 一并覆盖柱与棚前缘；饮品柜台深 0.8（spec 只限定蒸煮柜台尺寸）。
6. 纯常数色 PBR，无贴图/无 PIL 图 → 无 map-authoring.json。

## 给 lead 的接入说明
- 坐标契约：GLB Y-up 世界系 = (map_x, height, map_z)，实例 = position(map) + R_y(rotY)；摊位局部 +Z 朝人流。已用 mock row 实例化并与食品 socket 现有世界坐标核对到 0 误差。
- 槽位语义：slot 的 ly 为食品道具安放面高度，面以下家具归模块；食品线只往 socket 面上放道具（与现有 food-placement 兼容）。
- 檐棚：每 GLB 原点在墙线中点地面，局部 +X 沿 dir、+Z 朝街外，直接用 awning-placements.json 的 midpoint/rotY 摆放。

## 记录
- PROGRESS.json：阶段实录 + 9 条假设 + 构建期修复清单
- manifest.json / validator-report.json / reimport-report.json / renders/render-report.json
- 复审图：renders/contact-sheet.png（六格中文标签）、mock-row-cluster1.png
