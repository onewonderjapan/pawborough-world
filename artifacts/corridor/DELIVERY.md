# DELIVERY — D 包：街→庙走廊精修（v3 变体）

包 ID：`pawborough-corridor-video-night-20260919` · D0–D5 全部完成 · 2026-09-19

## 交付内容

| 变体 | 文件 | 预算 | 状态 |
| --- | --- | --- | --- |
| 坐狮 v2（左绣球/右幼狮，鬃盘+9 卷鬃+分面头） | `world/temple-axis-v3/lions-v2.glb` | 4064 tris（每只 ≤3500） | validator 0/0 |
| 方形漏窗 v2（1.1×1.1，石框 0.12，7 条冰裂纹直棂，背板遮盖 v1 菱纹） | `world/temple-axis-v3/ornaments-v2.glb` | 1148 tris ≤2400 | validator 0/0，design_inference（G13 可否决回 v1） |
| 前院 v3（court-open + 青石香道 + 铜鼎×0.85） | `world/temple-axis-v3/entry-court-v3.glb` | 4192 tris（鼎 872 ≤900） | 香道面 `temple-ground__worn-stone`，顶 +0.01；鼎碰撞 1.1×1.3×1.1 |
| 樟树 ×4（主干 r0.22 + 5 椭球冠，冠底 ≥3.0） | `world/temple-axis-v3/tree-camphor.glb` | 568 tris ≤2600 | 3 棵按 fallback #2 平移 ≤1.0m，manifest.placementShifts 有记录 |

- 数据集：`world/temple-axis-v3/`（14 GLB，10 件 v2 冻结件字节校验，placed 160,574 / 200,000）
- 路线：前院加绕鼎点 (−2.0,−10.5)/(−2.0,−13.5)，负例 7 条（含鼎：实测停在 z=−10.96）
- 预览：`temple-v3.html`（5306/5307，`?ds=` 未需用，BASE 直指 v3）
- 严格键：`--lionsVersion/--windowsVersion`（默认 v1，默认重跑几何等价证明落盘）；`--addIncenseRoad/--addBurner`（默认 false，court-open 等价证明落盘）

## 测试

44/44 绿（39 基线 + 新 5：shanmen_v2_contract / entry_court_v3_contract / trees_contract / temple_axis_v3_world / temple_axis_v3_passage）。passage 为真实 Rapier 行走测试：全轴正反 + 7 负例 + 掉地检测。

## 证据

- WebGL 10 机位：`artifacts/corridor/web/`（真实页面 + headless chromium/swiftshader，空白守卫全过）
- Blender 4 张：`artifacts/corridor/blender/`（shanmen-from-road / forecourt-oblique / court2-pair / court3-axis，CPU 24spp 1600×900）

## 必读（基线发现）

**继承 bug**：`build_world_v1_scene.py` 把 temple: 机位（庙轴本地坐标）当世界坐标用——v1-candidate 提交的 scene-v1 全部 temple: 视角实际渲染的是主街以南空地（提交的 court2-pair 证据图即纯灰，已核验；首轮评审"axis-aerial 95% 天空"即此 bug 的可见案例）。本批 before/after 两侧统一按桥接变换（T+yaw）渲染同一机位契约；`render_scene_views.py --fix-temple-cameras` 为 before 侧实现。

**axis-aerial 姿态**：spec 姿态达不到其自带的 ≥40% 非背景验收（实测 0.22）；调整为同结构低高度姿态（0.435），新旧对比图在 `kit/out/scene-v2/camera-fix__axis-aerial-*.png`。可在 G14 一并裁决。

## GATE

不合并、不 push、ownerAdopted=false。G12（树+鼎+香道）、G13（狮+漏窗）待机主裁决；不做旧（G11 保持）。
