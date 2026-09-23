# wave1-walk-20260923 · 全域候选第一人称步行（WP4）总结

分支 `work/wave1-walk-20260923`（起点 main @ 0d1ebd68），三个独立提交，全部队列项 done，无 blocked。

## 各项结果

### W1 碰撞导出 — done（bb324d16）
新 `scripts/export-collision.mjs`，挂入 `rebuild-review.sh`（connectivity/route 产物之后，`WALK_COLLISION=0` 跳过），按冻结格式 `docs/AREA-COLLISION-FORMAT.md` 生成 `out-zone/collision-{garden,pond,temple,bazaar,outer}.json`。位置一律从 `baseline/layout.json` 重算：建筑 footprint 每边薄墙（厚 0.3）、园墙/庙墙 16+25 段（厚 0.45、高 2.9/2.6）、五亭（pavilion-kit 局部记录 + layout 形心/facade 位姿）、三穗堂（与 assemble 输出逐条复核 maxDelta<0.05m）、假山世界盒、月洞墙（garden-kit 3 盒）、庙区 244 条 temple-v3 记录按 layout 实例位姿叠加、水面每边 1.2m 挡墙、六锚点 spawns。
- **庙区对应关系核实**（GOAL 指定写进 RESULT）：根仓 `world/collision-world.json` 是街铺模块，不含庙区；庙区碰撞实际在 `resources/temple-v3/collision-world.json`，16 组记录名前缀↔layout 实例 id（`court`↔`temple-entrycourt` 等）已逐一对上，见 `artifacts/walk/RESULT.json` templeMapping。
- 老街三块非凸块的 14 条街口边（路线 0.55m 内）不留墙、记 openings；九曲桥跨水面 2 边记 openings。纯数据推导，未删真实墙。
- 出口：`area-collision-contract` 实现前 exit 2 → **1175 pass / 0 fail（1039 colliders）**。

### W2 浏览器步行 — done（1e5864aa）
`web/walk.js`（`main.js` 仅一行 import + install + 循环里 `walk.tick()` 三处挂钩）：`?walk=1&at=<锚点>` 直入第一人称 WASD + 指针锁定；工具栏「步行/轨道」切换、锚点下拉、「回到锚点」；默认轨道模式完全不变。物理懒构建：collision-<zone>.json → `buildPhysicsWorld`（Rapier）；地面按 zones-manifest 拉原始分区 GLB，经 `src/walkGround.js`（按各分区 groundNodeRe/extraGroundNodes 选网 → 别名 → 仓库根 `collectGroundTriangles`，可复用件零改动，浏览器与节点测试共用同一层）。`server.mjs` 加只读路由 `/vendor/`（仓库根 node_modules，Rapier 0.19.0 以符号链接回参考仓，未 npm install）与 `/vendor-src/`（仓库根 src/ 可复用件）。
- 回归：`zone-browser-check` EXIT 0（std255 54.5，重建后复跑仍绿）。

### W3 机器人巡游 — done（835a01cb）
`tests/zone-walk-check.mjs`（`npm run test:walk`）：CruiseDriver 只经 WalkController 输入链走完 `commercial-route.json` **全部 5 条**路线（GOAL 说三条，文件实有五条，全绿）。断言：每采样帧脚点 ≥ 支撑面−0.05m、胶囊不与任何建筑 OBB 相交、终点误差 ≤1.0m、全程无 NaN。**allPass=true**：终点误差 0.87–0.90m，最大横向偏离 ≤0.8m，最低离地 ≥−0.005m。产物 `artifacts/walk/WALK-CHECK.json` + 每条路线起点/中点/终点眼高截图 15 张。新测试先在未实现产物上跑过：ENOENT `collision-garden.json`，exit 1（先于实现有效）。

## 公共验收
- `OUT_DIR=out-zone PYTHONPATH=… SITE_MODULES=1 STALL_KIT=1 GARDEN_KITS=1 SANSUITANG=1 ZONE_SPLIT=1 bash scripts/rebuild-review.sh` → **EXIT 0**（管线内含 export-collision 与全部既有测试）。
- `npm test`：geo 101 / coverage-negative 4 / sansuitang 16 / rockery 28 / awning 49 全绿；`test:garden-kit`（44）与 `check-food`（9）此前已绿且未触及。
- 分区 GLB 上限 PASS 全部 ≤12MB；无新 GLB。
- 交付：`artifacts/walk/{RESULT.json, WALK-CHECK.json, shots/, before-orbit-default.png, after-walk-eye-main.png}`、`artifacts/NEW-ASSETS.json`（5 个 collision JSON 的 sha256/bytes，可由管线再生）、`artifacts/PROGRESS.json`。

## Partial / 待主控决策
- 园廊 3 条 + 复廊 + 听涛阁水廊无碰撞源文件，未建碰撞（可穿廊柱）；树、摊位/长凳/檐棚、street-furniture 未建；门楼（yuyuan-gate-v2）无 sidecar、须留通道，未建墙——均记入 RESULT.json partial[]。
- pavilion-kit 的 obb 背栏带（2.3m 径向容差标记）不能直译薄盒，跳过（seat/post 盒已挡开敞面）。
- 机主 W2 亲手走一遍（决策 D8）与 WP12 性能实测待主控安排。

## 关键数字
1039 导出 colliders / 运行时墙 1216 · 地面 34606 三角（194 网格）· 契约 1175 pass · 5 路线全通 · 街口边 14 · 水面 openings 2 · 提交 3 个（bb324d16 / 1e5864aa / 835a01cb）。
