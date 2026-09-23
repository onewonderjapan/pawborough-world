# 全域候选碰撞世界格式（冻结 2026-09-23，WP4.1）

步行模式（WP4）的碰撞数据。由 `src/build-scene.mjs` / `scripts/assemble.py` 导出，每个分区一个文件：`<OUT_DIR>/collision-<zone>.json`，zone ∈ {garden, pond, temple, bazaar, outer}。浏览器按分区加载时一起读。

记录格式与仓库根 `src/world/collisionAdapter.js` 的 **形式 (a)** 完全一致，`obbToWorld()` 不改；这样 Rapier 建世界（`src/world/physics.js`）与节点测试可以直接复用。

```json
{
  "axis": "glTF Y-up; X east, Z south; heights from ground y=0",
  "zone": "garden",
  "sourceLayoutSha256": "<sha256 of baseline/layout.json>",
  "colliders": [
    { "name": "bld-428179902:edge-0", "module": "footprint", "type": "box",
      "obb": { "pos": [x0, 0, z0], "theta": 0.0, "center": [cx, cy, cz], "size": [sx, sy, sz] } }
  ],
  "openings": [ { "name": "water-w1:edge-3", "reason": "jiuqu-bridge crossing" } ],
  "groundNodeRe": "^(garden|pond)\\|[^|]+\\|(road|plaza|path|paving|steps|ground)\\|",
  "extraGroundNodes": ["jiuqu-bridge*", "pavilion-*/floor*", "sansuitang*/platform*"],
  "spawns": { "main": [-191.0, 0, 36.25] }
}
```

- `obb.pos` 为模块原点（世界），`theta` 为绕 +Y 的偏航（弧度），`center` 为模块局部中心，`size` 为**全尺寸**。`min/max` 可省略，由 `obbToWorld` 派生。
- `name` 规则（契约测试按前缀对账）：
  - 建筑 footprint 每条边一个薄墙：`<layoutId>:edge-<i>`，厚 0.3 m，高 = 对象高度（缺省 6 m）。`module: "footprint"`。
  - 套件件用自己的碰撞：`<layoutId>:<part>`，`module` 写来源（如 `sansuitang`、`garden-kit:garden-wall`、`rockery-kit`）。
  - 墙（`wall.segments`）每段一个：`<layoutId>:seg-<i>`。
  - 水面每条边一个隐形挡墙：`water-<layoutId>:edge-<i>`，高 1.2 m，厚 0.2 m，`module: "water-guard"`。路线或桥跨过的边不放挡墙，改记在 `openings`（写原因）。
  - 庙区模块复用根仓 `world/collision-world.json` 的记录，按实例位姿变换后改名 `<templeAnchorId>:<原记录名>`。
- 地面不进这个文件：浏览器把分区 GLB 里命中 `groundNodeRe` 的节点与 `extraGroundNodes` 交给 `collectGroundTriangles()` 建 trimesh。
- `spawns` 取 `out-zone/nav-gap.json` 的 anchors；y 由运行时向下射线取地面。

## 契约（`tests/area-collision-contract.mjs`）
1. 四个核心分区文件都存在，字段齐全，`sourceLayoutSha256` 等于当前 `baseline/layout.json`。
2. 每个 collider 都能被 `obbToWorld` 转换，尺寸全为正、有限。
3. 覆盖：该分区每个有 footprint 的建筑类对象（hall / tower / xuan / stage / waterside / pavilion / bazaarBlock / 商城区的 outerBuilding）至少有一条 `<id>:` 记录；每段墙有 `:seg-` 记录；每个水面至少 80% 的边长被挡墙或 `openings` 覆盖。
4. 出生点：六个锚点都在 `spawns` 里，且半径 0.35 m 的胶囊（身体带 y 0.3–1.9 m）不与任何 collider 相交。
5. 可走：`out-zone/commercial-route.json` 三条路线每 0.5 m 取样，同一个胶囊不与任何 collider 相交（桥、门洞必须留开口）。

实现前运行契约测试会以退出码 2 报「未实现」；实现后必须全绿，才算 WP4 第一步完成。第二步是 headless 机器人巡游测试 `tests/zone-walk-check.mjs`（贴地、不穿墙、终点误差 ≤1 m），另行编写。
