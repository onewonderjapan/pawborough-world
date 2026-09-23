# DELIVERY — 攒尖亭套件（5 座）

packageId `pawborough-w1-pavilion-kit-20260922` · 分支 `work/w1-pavilion-kit-20260922`（base 33a3bd7）· 2026-09-23

**状态：`delivered_for_lead_review`（ownerAdopted=false，partial=[], blockers=[]）**

## 交付物

| 项 | 路径 |
|---|---|
| 参数化生成器 | `scene-authoring/yuyuan-area/modules/pavilion-kit/build_pavilion.py`（Blender 脚本，n 边/矩形两种变体） |
| 编排 | 同目录 `run_all.py`（顺序 Blender -t 4、validator 0 错门槛、空白帧守卫、placements/manifest） |
| 验收测试 | 同目录 `test_pavilion.py` → **ALL TESTS PASSED (5/5)**，exit 0 |
| 5 座模块 GLB | `scene-authoring/yuyuan-area/out-pavilion-kit/pavilion-<bld>/model.glb`（gitignored），二进制副本在 `artifacts/pavilion-kit/pavilion-<bld>/` |
| placements.json | `out-pavilion-kit/placements.json`（assemble.py instance 字段同构：position=footprint 质心，rotY=atan2(dx,dz)，sha256） |
| 记录 | `modules/pavilion-kit/records/`（site-inputs / 每座 build-report、collision、materials、reimport-check、render-log、validator）+ `review/contact-sheet.png`(322KB) |
| 渲染 | 每座 front/three-quarter/top/under-eave 1200×900 48spp Cycles CPU；全尺寸 contact sheet 在 artifacts |

## 实测数字（预算 tri≤6000 / GLB≤700KB，全部通过）

| 亭 | id | 变体 | tris | GLB |
|---|---|---|---|---|
| 听鹂亭 | bld-428179924 | n=4 rect（四坡+短脊 fallback） | 3462 | 437KB |
| 挹秀亭 | bld-428186467 | n=4 正方形（菱位拟合 R=2.198） | 3522 | 434KB |
| 流觞亭 | bld-428196085 | n=6（样本先行） | 4020 | 458KB |
| 凤凰亭 | bld-428196091 | n=6 | 4308 | 482KB |
| 耸翠亭 | bld-428196098 | n=6 | 4260 | 475KB |

每座：validator **0 errors / 0 warnings**；重导入核对材质-贴图连接（roof color sRGB + normal Non-Color、wood、2 张解析挂落 alpha）；节点树 root=`<bld-id>` → body/roof/rail；碰撞顶点级检查（y 0–2.4，0.01 容差）**0 泄漏**，入口 bay 无栏杆；sha256 与 manifest 一致；20 张渲染全部过空白帧守卫（亮度方差+主色占比+量化色数）。总 Blender 用时 ≈9.5 min（顺序，−t 4，≤1 并发）。

## 结构与材质

平台(0–0.3)+三步踏跺(宽1.2)+柱础+12棱柱(0.22×2.75)+额枋(0.14×0.22)+檐檩(0.16)+挂落(alpha 镂空，万字/直棂交替，全 bay，底 2.70)+美人靠(座 0.42×0.32，靠背 0.45 外倾 12°)+攒尖凹曲屋面(8 环×每面 6 列，sag 0.12，角部起翘 0.55 沿檐衰减 1.2)+戗脊(r0.07)+宝顶(葫芦 0.65+座 0.25，rect 变体为正脊)+瓦当(φ0.10@0.24)+封檐(0.14)+椽头(0.06×0.06@0.28)+顶棚。材质：source-kit roof-color+roof-normal(1.44×1.36m/tile)、wood-stain×factor(乘积均值恰为 6a2e22)、灰石/黑漆常量、2 张新解析贴图(512²，唯一新增贴图)。

## 主要假设（全量见 PROGRESS.json）

1. **rotY 约定**：由 assemble.py 推导 rotY=atan2(dx,dz)；placements.json 已含此字段，lead 直接并入 instances。
2. **听鹂亭 rect**：用 footprint 自身矩形(5.20×1.91)内收 0.15 定 Rx/Rz 并随 footprint 长轴取向（map 轴 bbox 5.49×2.96 是旋转矩形的包络，不可直接作为建筑矩形）；屋面按 PLAN fallback 用短脊(长边 40%)四坡+正脊。
3. **cornerReach 1.2** = 角部起翘沿檐口的衰减距离（build.py tipReach 语义），径向不外挑——否则与 spec 自身 bounds 公式矛盾。
4. **bounds 测试执行**：因 rotY 随水向、亭体相对 map bbox 旋转，字面 bbox+2×0.9±10% 公式对菱位正方形/斜置矩形自相矛盾；改为「extent 覆盖 footprint bbox + 结构上限」+「檐口半径=R+0.9 精确实现」双锁。
5. rise=clamp(0.5×檐半径,1.1,1.6)；无倒角（预算）；顶棚平面封檐下视线；挂落含入口 bay（底 2.70>2.4 可达带）。
6. collision.json 盒体带 rotYDeg yaw 字段 + obb(p0/p1/width/thick)，约定已写入文件头；顶点级检查为权威验证。

## 已知视觉极限（预算内接受）

角部起翘采样每面 6 列（spec 8x6），角线略直；椽头个别位置与瓦当有 1–2cm 交叠；rect 变体无宝顶（以正脊替代）。

## 复核入口

1. `artifacts/pavilion-kit/contact-sheet.png`（5 座全家福）
2. 每座 `renders/` 4 机位
3. `python3 modules/pavilion-kit/test_pavilion.py` 复跑验收（需 out-pavilion-kit/ 产物在位）
