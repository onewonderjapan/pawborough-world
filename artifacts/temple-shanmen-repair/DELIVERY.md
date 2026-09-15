# 山门返修 T1–T3 交付（待主控看图）

taskId `pawborough-temple-shanmen-repair` · status `delivered_for_lead_review` · ownerAdopted `false` · visualReview `pending_lead` · base `fc66f69` · 分支 `work/temple-shanmen-20260915`

依据 `../artifacts/lead-review-20260915/REVIEW.md` 与 `DESIGN_REVISION.json`（本轮补充优先于旧屋面参数）。三件事按顺序全部完成，未中途停工。**本交付只主张几何/物理数值验证；不声称任何视觉通过——渲染图与WebGL实测图仅供主控审查。**

## T1 / P1 匾额：真实遮挡已修

**修法**：一张暗漆基底板（z 0.005–0.055）+ 四边框两级真实退台（外框环 z=0.155 贴匾外轮廓、中框环 z=0.105、文字面内凹 z=0.06）+ 四条金边线骑在外框环正面。原三层整块实心板与整片金fillet全部删除。贴图、+Z朝向、右起读法（隅海障保 / 保障海隅）不变，未换字体未改材质。

**数值证据**（对导出temple.glb全三角形做Möller–Trumbore，含节点变换）：
- 文字面在GLB中是唯一贴图四边形：`shanmen-plaque__temple-plaque-lacquer` 恰好2三角形。
- 字区网格 15×13，从方位 0°/+20°/−20°：三个方向各 **195/195** 条射线最近命中均为文字面；**0** 条被任何整面板遮挡（旧实心台阶板会100%命中框体材质）。

## T2 / P1 翼墙：渲染/装饰/瓦帽/碰撞统一到一个右手局部基

**修法**：`make_oriented` 返回唯一右手基（lx, +Y, lz=lx×ly）+ 观者侧符号；`obox` 用GLB同号偏航（`rotation_euler=(0,0,+yaw)`，即评审指出的 GLB+Y yaw ↔ Blender 同号+Z）。墙体、基座、压顶、分格框、浮雕板、菱花条、角饰、瓦帽、OBB碰撞全部由该基生成；左翼不再翻转lz成左手系。

**数值证据**（GLB真实顶点 vs collision.json OBB，不以OBB自洽代替）：
- OBB轴向端点与配置起终点距离 **d=0.000m**（两翼）。
- 墙板顶点实测范围 vs OBB尺寸：u 0.000–5.062 / 5.062，vMax 3.550 / 3.55，|w|max 0.165 / 0.16。
- 浮雕板出挑正面 **0.015m**；石饰最大出挑 **0.060m**（设计带0.03–0.06）；背面泄漏顶点 **0**。
- 瓦帽脊滚两端环位于墙轴线上（dA=dB=0.005m），轴向与墙轴 **cos=1.00000**。
- 真实Rapier负例重跑：翼墙拦停穿行、主通道3×3.1通行不变；`collision-world.json` 与返修前逐字节一致（碰撞盒本就正确，错的是渲染侧符号）。

## T3 / P2 肩屋面：局部起翘 + 瓦垄 + 接缝封口

**修法**：肩壳改按修订方程 `baseY(t)=7.0−(7.0−5.95)·drop(t)`；`y=baseY+(outline(|x|)−5.95)·smoothstep(0.5,1,t)²`；后檐保留0.18m落差；**全式无 max(ridgeY,outline)**。檐底按曲面法线偏移成真壳。另修正左肩取边错误（旧构建把内缝封环装在外缘、翘角封边板装在内缝——即主控看到的水平长板），新增接缝裙板封死中央/肩部交接。前坡加39根连续半圆瓦垄（r=0.05、间距0.24m、8段，檐口圆头收头）。

**数值证据**：
- 双肩前后坡共 **484/484** 网格顶点与方程采样一致，最大偏差 **0.0000m**。
- 脊带 z=−1.8 顶面 **7.000**（最低6.880为檐底）；t≤0.5 各行横向高差 ≤0.0177m、帘幕顶点0（旧 max() 写法此处会抬高0.5–1.0m）。
- 方程面以上悬浮顶点 **0**；瓦垄顶点2255、垄三角形 **3978 ≤ 8000**。
- 接缝水平射线 **32/32** 在封口处被拦截。
- 前檐每结点等于outline（1e-9断言）、后檐=outline−0.18。

**附带修复**：中心屋面 `top_y` 平滑步进未夹紧（裙板采样越界时爆到y=61，被bounds契约测试拦截）；16–24mm薄饰条倒角在旋转框上产生零长度切线（glTF validator错误）→ 薄条去倒角。

## 预算与验证

| 项 | 实际 | 上限 |
|---|---|---|
| 主体+墙 tris | 19800 | 50000 |
| 全套 tris | 25112 | 60000 |
| temple.glb | 3.44MB | 8MB |
| 新增贴图 | 2（匾/法线，未变） | 2 |
| 瓦垄 tris | 3978 | 8000 |

测试：`TEMPLE_REPAIR_PASS` / `TEMPLE_CONTRACT_PASS`（4个GLB validator **0错误**）/ `TEMPLE_PASSAGE_PASS` / `TEMPLE_WEB_PASS`（8机位 cameraCheck dPos=0 dFov=0，页面内门洞通行检查通过）。

## 看图入口与证据

- **可审看**：本worktree `http://127.0.0.1:5290/temple.html`（dev）与 `:5291`（preview），主街5284/5285不受影响。
- **真实图**：`kit/out/temple-shanmen-repair/renders/`（8张评审机位含灰模对、6张匾额近景=射线方位0°/±20°×PBR/灰模、native-vs-GLB同机位对照）与 `kit/out/temple-shanmen-repair/web/`（8张真实WebGL+遥测json）。
- **对照保留**：旧构建/旧渲染/主控验收WebGL图未删（`kit/out/temple-shanmen/`、`kit/out/temple-shanmen-renders/`）。
- 石狮/鱼龙吻仍为粗候选，未称精修。色系未改、未做旧。

## 复跑命令

见 `RESULT.json.buildChain`（构建→同步→三测试→渲染→WebGL取证）。

---
*GLM-5.3本体施工，未换模型、未调用外部生成服务。最终视觉采用由主控决定。*
