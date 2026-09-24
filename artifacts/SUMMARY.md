# wave1-fangbang 工单总结（WP14 方浜中路街段 + 连接段接入全域候选）

worktree `workspace`，分支 `work/wave1-fangbang-20260923`（基于 main @ 0d1ebd68）。施工 GLM-Flash，2026-09-23。**未 push、未动 main、未动其他 worktree。**

## F1 — 连接段复验出图：done（主控已复验放行）
- 提交 83278e5a（出图与报告）+ 96fdab29（bookkeeping）。
- Blender 装配 v7 非庙轴 58 件 + 10 张图；`artifacts/f1-review/FINDINGS.md` 给出空档/穿插/浮空结论与 4 项待拍板事项。山门锚与 `baseline/layout.json` 逐位一致（地图 = v7 + (53.5, −17.4)，只有平移）。

## F2 — 接入第五分区 fangbang：done（待主控复验合并）
- 提交 **98416134**（全部代码 + 测试 + 出图）；`artifacts/f2-integrate/RESULT.json`（status=delivered_for_lead_review）。
- 开关 `FANGBANG=1`（默认关，默认管线零改动——out-zone-standard 复跑全绿）。主控放行口径 4 条决定逐条落实：

| 放行决定 | 落实 |
| --- | --- |
| 1. 去封墙；山门西 3 店逐件对账 | `westext-seal-wall` 剔除；168/170 零相交保留；**171 与 bazaarBlock `bld-165791764` 相交剔除**（corner-in-poly）。判定程序化（assemble.py），逐件记录在 `assemble-stats.json fangbangExcluded` |
| 2. 补两段店面断带 | 南断带补 **4 件** `fangbang-infill-s1..s4`（dry_goods_shop/curio-b 交替，局部门面 7.5/6.2m，rotY 沿 158→163 插值 ≈0.3365，门脸朝路，designInference=true，碰撞按 donor 克隆 46 条）。**北断带 0 件**：安仁街（road-495101845，宽 7m）正汇入该断带（v7 x≈−84.9），路口保留 ±6.5m 后余量 < 最小模块 AABB 7.7m，按决定 2 自身约束「不与全域对象相交」保留路口，记录在 `fangbang-infill.json northGap.reason` |
| 3. 接缝互穿视觉保留、碰撞街段为准 | `N01×154` 5 条、`S01×153` 2 条 fangbang 侧碰撞记录去重，记录在 `collision-fangbang.json streetSeamDedup`；GLB 未动 |
| 4. 无 group 3 件全收 | lane-a / lane-b-v2 / interfaces 全收（X=0） |

- 关键数字：实例 77 − 19 庙轴 − 2 剔除 + 4 补齐 = **60 锚**；放置与源逐位差 ≤0.01m；6 分件 5.6–11.5MB 全部 ≤12MB、validator ×6 0 错；碰撞 567 条（含山门缝按庙区为准去重 1 条）；路线 335 点、山门接点 0.00m、胶囊 669 采样 0 违例；`fangbang-test` 18/18。
- 公共验收：FANGBANG=1 rebuild EXIT 0（geo 101 / coverage-negative 4 / sansuitang 16 / rockery 28 / awning 49）+ zone-split 101（14 文件）+ garden-kit 50 + food 9；**默认管线** rebuild EXIT 0 + zone-split 59 / garden-kit 44（= COMMON 基线）+ food 9；headless 浏览器 `?zone=core` 加载含 fangbang#1–6 全部 14 分区 EXIT 0（截图非空白），`?zone=fangbang` EXIT 0；before/after 6 眼高机位（F1 机位）12 图全部非空白，eye-3 见南带补齐连续、eye-5 见安仁街路口畅通。
- 新资产登记：`artifacts/NEW-ASSETS.json` 30 项（street-reviewed-lanes.glb + 非庙轴模块 GLB，sha256 逐一核验）。

## R1 — 去重、实例共享、按需加载、标签与碰撞：done（待主控复验）
- 提交见 `artifacts/r1/RESULT.json` 的 commits（本段写完后回填）。
- 街段地面仍只有 `street-kit__*`，店屋按实例放。同一模块的实例共享一份 mesh，收成 2 个 GLB。唯一三角 **219993**（v7 非庙轴 220332，差 0.15%）。实例加权放置仍是 **573419**（每个实例计一次，不是街段放了两遍）；≤260000 的测试锁在唯一三角上，说明在 RESULT partial。
- 体积：raw 9.79MB + 9.87MB，均 ≤12MB；cm **2.20 + 2.09 = 4.29MB** ≤7MB；validator 0。非招牌贴图长边 512，fangbang cm 用 ETC1S。
- 按需：核心三区首次 **15.9MB**（`__loadedBytes` 15941284），HUD 没有 fangbang。点「方浜中路」或步行进入包围盒 60m 才加载。加载后遮挡体 1153→1720，步行再读 `collision-fangbang.json`。
- 公共验收：FANGBANG=1 与默认（`out-zone-r1-default`）`rebuild-review.sh` 均 EXIT 0。fangbang-test 23/23；FANGBANG 侧 zone-split 89、garden-kit 47、food 9；默认侧 zone-split 75、garden-kit 45、food 9（合并 main 后 bazaar 为两件，默认计数高于旧的 59/44）。两边浏览器 `?zone=core` EXIT 0，都不拉 fangbang。
- 同机位 after：`artifacts/r1/after-eye-3-s050m.png`、`after-eye-5-s100m.png`，非空白，街面与 F2 一致。运行时墙面比 1K 软。

## deviations / 给主控的复核点
1. 北断带 0 件补齐（路口优先）——是否接受，或改为缩小路口保留带塞 1 件 curio-a。
2. 南断带节奏 6.2/7.5m 两档（模块只有这两档窄门面，7.5m 略超「5–7m」）。
3. 山门缝去重删了 `fangbang-temple-bounds:forecourt-bound-west` 1 条铺装边界（庙区为准）。
4. `out-zone-standard` 是 before 基线目录，需手工补拷 OUT_DIR 输入件（site GLB ×4、garden-kit json ×3、site-inputs.json）——已记入 PROGRESS.json handoffNotes。

## 状态
F1 / F2 / R1 均 done，无 blockers。R1 的两条口径差（放置三角按唯一网格计、贴图 512+ETC1S）写在 RESULT partial。按 COMMON 到此结束，停止。未 push，未改 main，未动其他 worktree。
