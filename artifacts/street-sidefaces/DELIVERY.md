# DELIVERY — 主街可见侧背面补件（第二包）

批ID `pawborough-temple-expansion-night-20260917` 包 2 · 2026-09-17 夜间施工（GLM-Flash）
状态 `delivered_for_lead_review` · `ownerAdopted=false` · `visualReview=pending_lead`

## 交付了什么

给主街从可走路线上真能看见的山墙/背面做**外皮件**（不改任何冻结模块 GLB）：

- `world/street-sidefaces/` — 10 件外皮（6 处：N01 西山墙、支弄 A 口两侧、支弄 B 口两侧、东尾 133 东山墙；
  每处"口两侧"含山墙面 + 背面首段 6m）。总 1,080 tris（预算 8,000；单件 ≤180 ≤1,500）。
  语言：plaster 面 + 砖基座 0.9 + 木腰带 0.12 + 灰瓦压顶 0.28；背面加小窗 0.6×0.8（sill 1.8）+ 后门 0.9×2.0（设计推断）。
  厚 0.06、外偏 0.05（133 因基础带外凸 0.06 改从基础带外面起偏）；每件一个薄盒碰撞。
- 加载方式：`fangbang.html?ds=fangbang-temple-v2&skins=1`（`?skins=1` 默认关；不带参数的世界完全不变，已实测）。
- 证据：WebGL 10 张（真实页面 + skins=1，巡游 PASS 随记录）；Blender 10 图（模块 GLB 按实例变换 + 外皮，
  自校准机位）；每相机附首命中证据。

## 判定方法（M1）

`scripts/find_visible_side_faces.mjs`：桥接路线每 2m 取眼点（高 1.6），对每面侧墙/背面/山墙盒的 3×2 网格采样点
做射线，遮挡体为**全部**实体碰撞记录（精确 2D SAT OBB + y 区间）。全量 119 面 technically 沿街走廊远望均"可见"，
交付集取计划点名的 5 处切片（6 地点/10 面）；全量普查保留在 `kit/out/sidefaces/targets.json` 作证据。

## 如实记录

1. 支弄口山墙位于 ~2m 缝内：近观为窄条缝视，取证相机按"首命中=皮件"自校准至 1.5–6m（每相机记录距离）。
2. 133 基础带（0.34 厚）比墙面外凸 0.06 → 该面 offsetOverrideM=0.06，其余 9 面标准 0.05。
3. 外皮 GLB 内嵌共享调色板贴图（单件 ~0.78MB，合计 ~7.9MB）——仅 `?skins=1` 时加载。
4. fangbangMain 增加了 `__fangbangView` 取证钩子与证据名 label 覆盖（仅在显式调用时生效）。

## 复跑

```bash
blender -b --factory-startup -t 4 -P kit/build_gable_skins.py -- --config kit/gable-skin.config.json --out kit/out/sidefaces
node scripts/build_sidefaces_world.mjs
node tests/sideface_contract.test.mjs && node tests/sideface_visibility.test.mjs
```
