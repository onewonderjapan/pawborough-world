# 豫园入口门楼候选（yuyuan-entry-gate-candidate）— 交付说明

日期 2026-09-21 ｜ 执行：独立 Claude 会话 ｜ `ownerAdopted=false`，未接入任何世界/场景，不改原项目。
参照：`../references/`（照片 PBR-SH-0005-015 被树枝遮挡；G20–G24 为已核验推理图，非史料）。年份/许可见 `../references/INDEX.json`。

## 实物
| 文件 | 说明 |
|---|---|
| `model.glb` | 门楼主资产：**15,808 tris**，3,331,596 bytes（贴图 1,747,547 bytes，10 张，全部 1K）。11 个图元 / 7 材质。sha256 ee3ace8f4f32f1e6… |
| `ground.glb` | 地面展示板（18×14 m 石板+缝），独立文件，不焊进门楼：420 tris，362,988 bytes |
| `model.blend` | 可重开源场景，贴图已打包（含 GLB_REIMPORT_CHECK 场景） |
| `build.py` | 全部造型脚本（参数在文件头 `D=dict(...)`），`blender -b -t 4 --python build.py` 约 5 s 重建 |
| `recipe.json` `materials.json` `collision.json` `measurements.json` `reimport-check.json` `check-report.json` `inspection.json` | 设计值、材质来源、粗碰撞代理（**未接入世界**）、检查结果 |
| `render.py` → `shots/*.jpg` | Cycles CPU 4 线程 64 spp 1600×1000：front / left-3q / right-3q / side / back / through-door / eave-close；`left-3q-clay.jpg` 同机位灰模。**back、side 为推断视图**（无背面实拍；侧面仅 G22 斜视） |
| `preview/` | 独立三.js 旋转预览页（vendor 复制自主线 node_modules/three，只读复制）。`./preview/serve.sh` 起 127.0.0.1:5445，`?view=1..4` 或按键 1–4 切机位。`preview/capture.mjs` 用 headless Chromium 截图 + 空白帧守卫 → `shots/preview-*.png`（已跑：三视图非空白，HUD 实测 15,808 tris / 11 几何 / 7 材质 / 10 贴图，load+parse ≈0.2 s localhost） |

## 设计尺寸（全部 design_inference，不是测绘）
比例尺：门洞净宽 2.2 m × 净高 3.0 m（机主冻结）。其余按 G20 正面像素比推算：
- 砖砌主体 8.0 宽 × 5.33 高 × **2.8 进深（推断）**；石台基 0.52 高、出 0.10；石门套 0.70 宽、门楣 0.45；门洞两端 0.40 深石内衬（衬后净 2.2×3.0），前端顶角两级石雀替（|x|>0.78, y 2.76–3.0 区域，设计意图，记入 check-report 例外）。
- 回纹带 y 3.62–3.90 / 4.90–5.19（正面真实几何回纹，背面素带）；空白匾额凹口 3.55×0.71，退 0.06，**留空无字**；檐口线脚 5.19–5.33。
- 檐下：牌科式叠涩三层，正/背各 9 组、侧各 3 组（形制推断）；檐枋、顶枋、檐板、椽头、瓦当。
- 屋面：四坡（庑殿式）真实曲面，檐口 6.45、正脊 7.72、出檐 1.05、翘角抬 1.35 + 外挑 0.45，戗脊 4 条、嫩戗 4 根；平面 10.1×4.9 m，正脊 5.5 m；含翘角总宽 11.73 m，最高点 8.72 m。

## 已知推断与取舍
- 背面：同体量闭合、素带、素匾凹、无回纹、无雀替（无背面参照）；侧面只依据 G22 斜视。
- 砖雕仅做带状回纹与线脚层次，没有逐块雕花；匾额空白；无任何文字、无雕像。
- 贴图：源自 `../source-kit`（ambientCG CC0 Bricks061 / PaintedPlaster017 / Wood092 法线 + 项目自制 roof 与 wood 颜色）；仅通过 baseColorFactor 调色（砖 b4bac2、石 d8d4c8 等），未新造贴图，未把参照照片贴成蒙皮。
- 米制 UV：所有盒体按世界坐标投影，砖缝跨盒连续；屋面按檐口周长/坡长展开。
- tris 15.8k 在 15k–25k 目标内；面数大头是屋面曲面 5.6k、檐下叠涩与回纹。

## 一次集中检查（`check_glb.py` → `check-report.json`）
- 轴向：地面 y=0 ✓、x 对称 ✓、正面檐口 +Z 1.88、背面 −4.68（门洞在原点，+Z 朝街）。
- 门洞贯通：净空体内 0 顶点 / 0 三角形；中心走廊 0 遮挡（雀替例外已声明）。
- 背面闭合：888 个采样点 0 个漏空。
- 法线：30,729 条单位长度、无 NaN；导出后重导入 7 材质贴图连接完整（`reimport-check.json`），baseColorFactor 已随 GLB 导出（`check-report.materials`）。
- 未做：glTF Validator（本包未接主线 node 脚本）、走动/碰撞实测、性能浸泡、整城巡游。

## 公共代码 vs 自制
- 复用：`../source-kit/helpers.py`（box_glb 连通盒 + 米制 loop UV，与 Skill 同源）；three.js vendor；渲染灯光/相机写法沿用本人小笼店批次。
- 自制：`build.py` 全部造型（面层/芯体分块留洞、门套内衬与雀替、回纹生成器、叠涩、四坡曲面 loft + 翘角/戗脊/嫩戗/瓦当/椽/檐板）、`render.py`、`check_glb.py`、`preview/index.html`、`preview/capture.mjs`。

## 真实耗时（本会话钟）
- 读参照、定尺寸：20:29–20:37（8 min）
- 脚本开发 + 首个灰模 GLB/3/4 图：20:37–20:47（10 min，首版 29.9k tris，屋面呈鞍形）
- 修形 4 轮（翘角衰减、重叠面黑块、叠涩去倒角、曝光/世界光、门楣缝）：20:47–21:00（13 min）
- 全套 7 视图 + 灰模渲染：21:00–21:08（8 min，单张 ≈40–60 s，CPU 4 线程）
- 检查脚本 + 预览页 + headless 截图：21:08–21:15（7 min）
- 合计约 46 min；生成本身每次 ≈5 s。

不自报审美分，形体/比例由机主看实物决定。
