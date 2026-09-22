# DELIVERY — 园廊套件（3 廊 + 听涛阁水廊）· corridor-kit

包 `pawborough-w1-corridor-kit-20260922` · GLM-Flash wave-1 · 2026-09-23 完工
分支 `work/w1-corridor-kit-20260922`（基线 33a3bd72）· 状态 `delivered_for_lead_review`，ownerAdopted=false

## 交付了什么

冻结 G5 布局地图系下的站点模块 GLB（原点=地图(0,0)，Y-up 世界坐标，无实例变换），替换程序化廊子盒体。**不含管线集成**（build-scene.mjs / assemble.py 未动，集成是 lead 后续步骤）。

| 模块 | 对象 | GLB | tris | bytes |
|---|---|---|---|---|
| 园廊 | bld-553893874 | corridor-bld-553893874.glb | 5,572 | 593,836 |
| 环形园廊（out-and-back） | bld-428179906 | ring-corridor-bld-428179906.glb | 4,732 | 534,848 |
| 复廊（双廊+中墙漏窗） | bld-428186469 | double-corridor-bld-428186469.glb | 4,068 | 502,052 |
| 听涛阁水廊+端亭 massing | bld-428179920 | waterside-gallery-bld-428179920.glb | 5,533 | 597,168 |
| **合计** | | | **19,904 / 45,000** | **2,227,904 / 2,500,000** |

构件口径（spec 权威值）：柱 Ø0.20 高 2.55 到枋（每段均分 ≈2.5m）；石板地面 0.12 厚；檐口 2.85、屋脊 3.55、出挑 0.55（瓦面+木望实心 0.10、瓦当行 0.30 间距、屋脊滚筒顶 3.59）；美人靠（坐面 0.42+背扶手 0.95，逐段水侧/背厅面）；复廊整幅屋面 4.6m、中墙 0.2m 厚带 1.1×0.9 漏窗（解析 alpha 格栅，≥3.0m 间距）；端亭 10.1×6.4 两层四坡顶 massing（柱网 6×4，≤9k 预算实际约 1.5k）。材质：瓦 roof-color+normal、木 wood-stain 染 6a2e22、石 PaintedPlaster017 染 9d9a92（source-kit 512/256px 派生集，见 map-authoring.json）。

## 验证（29 pass / 0 fail）

- 柱位贴线 ±0.05（对自己段，worst 0.001m，漏柱 0，且 GLB 顶点在场）
- 中线 y1.6 步进 0.5m 可通行（±0.8m 带 5 射线/站；复廊验 ±1.2 双廊；角区 1.2m 结点区跳过并注明）
- 屋面连续：y3.72 下射全段命中 2.85–3.6（含穿端亭段，命中其 3.05–3.58 腰檐）
- 预算（总量+单体）、包围盒 ±10%、Khronos validator 4×0 错、Blender 重导入无 issue、贴图色彩空间 sRGB/Non-Color、格栅材质在场、manifest.json sha256

## Fallback 使用记录（PLAN）

- fallback 1（尖角→戗角）：复廊外圈尖长>2.75m 顶点使用；920 v1 内缘为细条戗角
- fallback 2（gpath 穿越开口）：gardenRouteAudit 9 段全 ok，无 gpath 穿越复廊，**未触发**
- fallback 3（端亭降级）：未触发（远低于预算）

## 已知限制（lead 审查关注点）

1. **复廊鸟瞰屋面在 S 弯腰部呈折面**：环宽 ≤8m 与 5.7m 屋面带物理性交叠；spec 屋宽 4.6 为权威值故保留。侧视/沿廊正确。
2. 复廊沿廊视图偏暗（中墙+檐下光），几何可读；提亮属集成后光照课题。
3. 法线贴图未导出切线（validator 3 警告 GENERATED_TANGENT_SPACE 同款）：引擎由 UV 生成，与 garden-kit 同口径。
4. 屋面为 L1 低模读法（连续、不漏水、轮廓正确），无滴水斗拱等细作。

## 耗时与产物位置

墙钟约 1.5h（含等待并发批 CPU：负载曾 22/20，Blender 全程 -t 4、同时 ≤1 进程；渲染 3 轮，前两轮为迭代）。产物：`artifacts/corridor-kit/{glb/,validator/,renders/,contact-sheet.jpg,PROGRESS.json,RESULT.json,DELIVERY.md,tests.log,catalog,collision,reimport,manifest,site-inputs}`；源码+测试+记录+小图已提交至工作分支 `modules/corridor-kit/`。生成物 out-corridor-kit/ 按 out-* 规则不提交。

## 假设（全部 design_inference，详见 PROGRESS.json / catalog.assumptions）

美人靠侧别规则（6m 内水面取水侧，否则背向最近厅堂；环廊取朝环外面）；复廊内圈天井式内坡（缩放 0.28）；复廊地面分段条带+转角补丁；瓦当间距 0.30；听涛阁端部延伸 0.35m、远端山墙封口、亭侧开敞；柱距均分规则；家具角部内缩 1.4m（转折>50°）。
