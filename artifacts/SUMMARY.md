# wave1-walkr1 SUMMARY — 步行模式补碰撞 + 截图时机修正（2026-09-23）

worktree `/home/baibai/outbox/pawborough-wave1-walkr1-20260923/workspace`，分支 `work/wave1-walkr1-20260923`（起点 main @ 09d11cdd）。状态：**K1 done / K2 done**，无 blocked。（上一单 walk 的总结见 git 历史，其交付物在 `artifacts/walk/`。）

## 提交
| sha | 内容 |
|---|---|
| 1e7e4093 | K1 园林套件碰撞导出 + 新契约测试 |
| 38a512bf | K2 walk-check 中点时机/朝向修正 + 15 张截图重拍 + artifacts/walkr1 交付物 |
| 2acddf0e | walkr1: RESULT.json 回填提交号（K1=1e7e4093, K2=38a512bf） |

## K1 园林套件碰撞 — done
`scripts/export-collision.mjs` 新增段 9–13；`module` 记来源。全部从 `baseline/layout.json`（复廊用 `modules/double-corridor/double-corridor-record.json` 的 centreline，其 sha256 与部署 GLB 一致）重算，柱位逐根经 `out-garden-kits/*.glb` 实际几何确认（±0.12 m、y 0.1–2.6 有顶点）后才出盒：

- **园廊 3 条**：bld-553893874 48 柱 + 4 美人靠；bld-428179906（环形）40 柱 + 4；bld-428179920（听涛阁水廊）38 柱 + 4 + 端亭台基 1 盒 + 底层柱 24 根（module `corridor-kit`）。
- **复廊 bld-428186469**（module `double-corridor`）：部署 GLB 实测 **6 柱** + 4 栏（首末跨留空=入口）+ 4 中墙段。设计记录写 `columns: 10`，与 GLB 不符——按 GOAL『用各自 GLB 的实际几何』弃 4 个无柱候选位，避免隐形墙（见 RESULT partial）。
- **门楼 garden-gate**（module `yuyuan-gate-v2`）：`inputs/yuyuan-gate-v2.glb` 的 gate-wall 实体两面 Pier（2.3×5.33×3.0），**门洞净宽 3.26 m ≥ 2.2 m**（新测试在通道深度 3 站位两侧射线测）。折起门扇/脊饰/檐/瓦不建（身体带以上同理檐棚）。
- **树** 46 棵（module `tree-kit`）：0.4×2.0×0.4 树干盒，位置=tree-placements（含 9 棵避让移位）。
- **摊位/长凳** 51 件（module `bazaar-stalls`）：每件一个 GLB 包围盒盒；16 条街块檐棚不建（身体带以上）。
- **openings**：廊栏/墙与商业路线或园路相交时不建并记 openings——数据核验 0 相交，openings 与上一版逐条一致（bazaar 16 / pond 2 / garden 0）。
- 碰撞总数 **1216 → 1492**。

## K2 截图时机 — done
`tests/zone-walk-check.mjs`：
1. 中点按**路线长度**取（累计弧长 ≥ 半长触发；旧代码是『中点 waypoint 索引』），眼位=路线中点地面+1.6 m，朝向=该处**路线切线**（yaw=atan2(−tx,−tz)）。5 条路线的 midStation 全部记入 WALK-CHECK.json。
2. **根因修复（超出 GOAL 字面、为满足『中点图不再对墙』验收所必需）**：预览页轨道模式渲染循环每帧 `controls.update()` 强制 `camera.lookAt(controls.target)`，旧 `eyeView` 只设位置/四元数——**任何 yaw 从未生效**，截图永远从眼位盯住轨道目标点（这才是旧中点图整帧怼墙的机制；GOAL 归因的『上一段航向』实际也从未上屏）。截图改走页面既有 `__viewAt(p,t)`，target=眼位+前向 25 m，15 张全部按步行方向取景。

## 新测试（先行证明）
`tests/corridor-gate-collision-test.mjs`（`npm run test:corridor-gate`）：每条廊 ≥N 个柱盒（N=GLB 实际几何确认数）且逐柱对位 ±0.2 m；门楼 Pier 对上 GLB 实体、通道中线两侧射线净宽 ≥2.2 m 且两侧必有命中；46 树干、51 摊凳逐件对位。
- 上一版产物（walk 单的 out-zone）上跑：**7 pass / 20 fail，exit 1** ✓ 先行有效。
- 本单产物：**29 pass / 0 fail**。

## 公共验收
| 项 | 结果 |
|---|---|
| 全流程重建 | `OUT_DIR=out-zone PYTHONPATH=$PWD/.python-deps SITE_MODULES=1 STALL_KIT=1 GARDEN_KITS=1 SANSUITANG=1 ZONE_SPLIT=1 bash scripts/rebuild-review.sh` → **EXIT 0** |
| npm test | geo 101 / coverage-negative 4 / sansuitang 16 / rockery 28 / awning 49 全绿 |
| zone-split | 75 pass / 0 fail（COMMON 写 59 为旧计数，现版检查更多；拆件三角对账 PASS） |
| check-food | 9 pass / 0 fail |
| 契约测试 | 1451 pass / 0 fail（上版 1175；三条商业路线+六锚点在新碰撞下全可走） |
| zone-walk-check | allPass=true，5 路线 exit 0：终点误差 0.87–0.9 m、横向偏差 ≤0.8 m、贴地 −0.005 m、不穿新墙 |
| 分区 GLB ≤12 MB | PASS（最大 zone-garden.glb 9,543,004 B） |
| headless 浏览器 | 默认轨道 `?zone=core&cam=oblique` EXIT 0，std255 54.4（上一版 54.5，无回归）；服务用 5491，已关 |

## 交付物
`artifacts/walkr1/`：RESULT.json、WALK-CHECK.json（新）+ WALK-CHECK-before.json（旧）、shots-after/×15、shots-before/×15（上一单同机位）、before/after-orbit-default.png。`artifacts/NEW-ASSETS.json` 碰撞文件 sha 已更新为 walkr1 重建后现值（无新 GLB/贴图）。

## 备注 / 移交主控
- 复廊 6 柱与设计记录 10 柱的差异见 RESULT.json partial；若后续换 corridor-kit R1 重建复廊，重跑导出即可，新测试按 GLB 确认数自适应。
- 门楼折起门扇不建碰撞（建则通道 2.1 m < 2.2 m），现按墙体实体 3.26 m。
- 机主亲手走一遍（D8）与 WP12 性能实测仍属主控/机主动作。
