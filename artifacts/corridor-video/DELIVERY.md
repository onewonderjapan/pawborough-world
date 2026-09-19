# DELIVERY — F 包：光照统一 + 机位修正 + 巡游视频 + 26 静帧

包 ID：`pawborough-corridor-video-night-20260919` · F0–F5 · 2026-09-19

## F0 光照统一

`kit/light_rig.py`（DESIGN_SPEC packageF.lightRig）：
- Sun 3.0 @ (55°, 0, −35°)，角径 1.5°；World 灰 0.55 强度 1.0
- Fill 面光 60W，随活动相机后上方 8 m（每机位重摆）
- AgX Base Contrast；Cycles 阴影/GI 全开；非 rig 光源（scene-v1 遗留 sun/fill）一律关闭
- 接入路径：`build_world_v2_scene.py`（构建时）/ `render_scene_views.py`（重开时，`--no-rig` 可关）/ `render_walkthrough.py` + `render_orbit.py`（逐帧）
- 场景-v1 blend 已冻结（不在 allowedModifiedFiles），故"三处统一"的实现口径 = 同一模块应用于三条渲染路径（构建 / 重开静帧 / 巡游+轨道），同机位两两像素差实测 **0.000%**（≤2% 达标，见 `render-log.json`）

## F1 数据集与场景

- `world/fangbang-temple-v4/`（`scripts/build_fangbang_v4_world.mjs`）：桥接 v3 + 庙轴 v3 变体替换（狮子v2/方窗v2/前院v3 + 4 樟树）+ 绕鼎点带入世界路线 + propsBlock 引用（默认不加载，`?props=1` 加载）。`?ds=fangbang-temple-v4` 选择（机制来自扩展批，页面零改动）。
- `kit/out/scene-v2/scene-v2.blend`：v4 全实例装配 blend（街道 + 15 庙轴 v3 资产 + 17 西延模块 + skins + 38 道具 + 4 树，26 契约机位）。

## F1 机位修正（temple:axis-aerial）

- spec 姿态（local [−36,46,−8]→[0,2,−46] fov48）实测非背景占比 **0.22–0.26**，达不到其自带的 ≥40% 验收线（天空占 74%）。
- 调整为同结构低高度姿态（local [−36,26,−8]→[0,0,−28] fov48），实测 **0.435** 过线。新旧对比图：`kit/out/scene-v2/camera-fix__axis-aerial-{old,new}-cpu.png`。偏差原因与数值已记录 PROGRESS.json（G14 可裁决）。
- 重要：机位修正包含**继承 bug 修复**——scene-v1 构建器把 temple: 机位（庙轴本地坐标）当世界坐标使用，v1-candidate 提交的 scene-v1 全部 temple: 视角实际渲染主街以南空地（提交的 court2-pair 证据图即纯灰）。本批 before/after 两侧统一按桥接变换渲染。

## F2 静帧

26 机位全部重渲（1600×900，CPU 24 spp + OIDN，统一灯光）→ `artifacts/corridor-video/stills/`，空白守卫 0 失败。记时见 `stills/render-log.json`。

## F3 clipA 巡游视频

- 路线：fangbang-temple-v4 世界路线（东尾 → 西延伸 → 山门 → 前院绕鼎 → 仪门 → 配殿院 → 大殿门前 → 侧通道 → 三进院 → 城隍殿门前），402.2 m
- 等弧长采样 + Catmull-Rom 平滑，眼高 1.6，前视点 6 m，1.4 m/s（转弯减速），24 fps，1280×720，16 spp + OIDN
- preflight 5 帧（0/25/50/75/97%）姿态核对通过（`preflight/`）
- 设备策略：启动与每 200 帧 nvidia-smi；GPU 基准 8.8–12.2 s/帧 vs CPU 4.5–6.2 s/帧 → 维持 CPU（记录于 render-log）
- 产出：`clipA.mp4`（libx264 crf 18 yuv420p）+ 片头 2 s 诚实声明卡 + `frames/` PNG 序列

## F4 clipB 庙轴环绕

- 24 s @ 24 fps，绕庙轴中点 r=55 m h=40 m 一周（spec 轴本坐标经 T+yaw 变换），目标 (0,4,−45)
- GPU 渲染 576 帧（平均 5.08 s/帧）→ `clipB.mp4`

## 预算

渲染墙钟上限 9 h（自 04:01 clipA 启动起算，13:01 到点）。到点未完成部分按已渲帧数出 mp4 并标 partial（见 render-log.json 的 mp4 块）。

## GATE

G14：clipA/clipB 是否作为 v1.0 候选包附件 —— 机主裁决（含 axis-aerial 调整姿态的追认）。
