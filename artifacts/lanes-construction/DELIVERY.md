# DELIVERY — 两处支弄精修 + 两处弄口连接（lanes-construction 20260920）

状态：**delivered_for_lead_review，ownerAdopted=false**。等待机主实机看后采用；历史采用内容一律未动。

## 看什么

- **v5 候选世界入口**：`fangbang.html?ds=fangbang-temple-v5`（默认入口不变；`?compressed=0` 与否均为原始字节，v5 无 cm 清单，整数据集保持原始变体）
- **v4 基线对照**：`fangbang.html?ds=fangbang-temple-v4`
- 8 个机位按钮（A弄×4 / B弄×4）已加入 v5 页面；「路线巡游检查（自动）」覆盖主街回归

## 实测数字（交付承诺）

| 项 | 规格 | 实测 | 满足 |
|---|---|---|---|
| lane A 深度（原封墙后） | 目标 8m / 可收 6m | **8.0m**（尽端墙内面 s=8.0） | ✓ |
| lane A 净宽 | 目标 2.2m / 最窄 1.5m | **2.2m**（内面 ±1.10） | ✓ |
| lane B 总深 | 目标 10m / 保底 5.5m | **10.0m**（背立面 s=10.06，口袋 3.6m） | ✓ |
| 弄门洞净高（A/B） | ≥2.3m | **2.3m**（A）/ **2.3m**（B，冻结构件） | ✓ |
| 接地高差 | ≤0.02m | 实测胶囊跨缝 **0.013m** | ✓ |
| lane A 三角 | ≤30k | **7,290** | ✓ |
| lane B 三角 | ≤30k | **8,044** | ✓ |
| 弄口合计三角 | ≤20k | **876** | ✓ |
| 新增合计 | ≤80k | **16,210** | ✓ |
| 新贴图 | 0 | **0**（全部复用冻结 mb_lib palette） | ✓ |
| 全候选场景 | ≤700k | 703,049（**超 0.44%**，见下） | ✗ 如实记录 |

**700k 上限说明**：v4 已采用底座本身 686,876 三角；本批新增 16,210 后全场景 703,049。超出的 3,049（0.44%）源于底座规模而非本批构件超标——本批各分项都在预算内。交机主裁量：采用时可删减本批构件或调整口径，本批不擅自缩规格。

## 各模块文件

| 模块 | 建造脚本 | 输出 | 共享交付 |
|---|---|---|---|
| lane A | `kit/build_lane_a.py` | `kit/out/lanes-v2/lane-a/`（model.glb/blend、collision、materials、measurements） | `world/lanes-v2/lane-a/`（glb + 世界坐标碰撞侧车） |
| lane B v2 | `kit/build_lane_b_v2.py`（派生自冻结的 `kit/build_lane_b.py`；旧输出字节不动） | `kit/out/lanes-v2/lane-b-v2/` | `world/lanes-v2/lane-b-v2/` |
| 弄口接口 | `kit/build_lanes_interfaces.py` | `kit/out/lanes-v2/interfaces/` | `world/lanes-v2/interfaces/` |
| 配置 | `kit/lanes-v2.config.json` | — | — |
| v5 装配/数据集 | `tools/lanes_x1_v5_assembly.mjs` | `world/fangbang-temple-v5/`（7 文件 + `street-reviewed-lanes.glb`） | — |
| 场景派生 | `kit/assemble_lanes_scene.py` + `kit/render_lanes_scene.py` | `artifacts/lanes-construction/scene-lanes-v1.blend`（+ .assets.json 资产版本） | — |

**三个可复用细部模块**（`kit/lanes_v2_components.py`，几何/材质共享、UV 按米标定）：`rear_service_door`（后门墙片，A 西墙 s4.9 与 B 东墙 s7.3 两处实例）、`high_window`（高窗墙片，A 弄 7 樘两节奏 + B 侧窗）、`corner_cap`（山墙转角/砖基收口，A 尽端两角 + B 口袋后两角）。

## 弄口差异（非镜像）

- **A 弄口**强调窄门洞进入的纵深：街面一对转角壁墩 → 1.4m 宽走廊（既有 N05/N06 侧墙夹持）→ 2.2m 门厅 → 8m 直弄、尽端墙收束
- **B 弄口**强调向内渐宽与回望通透：1.5m 净门洞 → 漏斗 2.4m → 3.6m 口袋直至 s=10 背立面，回望见主街
- 沿街招牌留空，未发明历史店名

## 实机验证（真实胶囊、同一物理链，非传送）

`artifacts/lanes-construction/x3-live-report.json`：
- 主街巡游回归 PASS（复用 v4 契约，未重写）
- `laneAExcursion` 往返 7 段全达、`laneBExcursion` 往返 11 段全达、无坠落
- 关闭后门阻挡（capsule 顶在门 bay）✓；两侧弄口进出 ✓
- 地面接缝高度差 0.013m（契约 0.02m）✓
- 碰撞随真实开口拆分：A 弄门厅通、后门 bay 实体、B 门洞 1.5m 通；可走高度 0–2.4m 的墙/柱全部有碰撞（模块侧车 25 条世界坐标 OBB）

## 前后对照（4 对，同机位）

`artifacts/lanes-construction/comparison/`：`before-*.png`（v4 页面同姿态）vs `after-*.png`（v5）
- A 弄口（街面望入：占位地面+黑门 → 石板走廊+门厅+弄身）
- B 弄口（街面望入：占位墙 → 门厅+渐宽口袋）
- A 弄内回望（占位端墙 → 尽端墙+8m 弄身+门厅框景）
- B 弄内回望（占位 → 口袋端回望主街）

## 离线渲染（4 张，资源空闲时段）

`artifacts/lanes-construction/blender/`：`scene-lanes-v1.blend` 重开后用其内相机渲染（Cycles CPU / 4 线程 / 24 样本 / AgX）。blend 由 v5 GLB 派生装配，`.assets.json` 记录全部资产 SHA；无任何冻结场景文件被改。

## S 阶段旧尾项

- v3 `westshops-strips.cm.glb`：按现源 SHA 重建（候选链：隔离构建→生产加载器解码验证 PASS→安装），旧字节 retired
- v3 `lions.cm.glb`：超容差（0.5624%>0.1%，回退前浏览器复测确认）→ manifest 回退原始 GLB，缺陷件 retired；注册表同步
- clipA：守望终态 partial（7040/8781，renderer_exited_early）→ 成片复制+ffprobe+hash 一致，未补渲、未改称 full
- 详见 `tails/S1-result.json`、`tails/S2-clipA-result.json`

## 工单未完成项 / 已知偏差

1. 全候选 703,049 > 700k 上限（+0.44%，底座原因，见上表）——机主裁量
2. N05/N06/S07 可视面与冻结碰撞面 1–2.3m 既有偏差（v4 已采用状态）：接口地面按可视面铺设，可走域由冻结碰撞界定；修齐需动冻结碰撞，超出本批授权
3. clipA partial 1741 帧缺失（守望终态，未补渲）
4. 弄口沿街招牌留空（按规格）
5. v1 冻结 lions.cm 与 v4/temple-axis-v3 lions 缺 cm：维持 closeout 记录的 fallback 原状（非本批范围）

## 保护与边界

- `world/street-reviewed.glb` 一字节未动（手术只写 v5 副本）；`world/fangbang-temple-v4/**`、`world/laneb/**`、`kit/out/lane-b/**` 字节冻结
- 未删除任何文件（ retired 目录保留旧字节）；无 merge/push/发布；无新自动任务
- 未触碰：玄扈台、照壁、新神殿、角色、Unity、付费生成、长视频渲染
