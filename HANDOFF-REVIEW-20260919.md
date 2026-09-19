# HANDOFF / REVIEW — Pawborough 世界版 v1.0 候选 · 四批合并前工程审查交接书

给外部审查者（ChatGPT）· 2026-09-19 · 主控（Claude）备妥
本文档事实均可用文末命令独立复验；审查是**只读**的。

## 0. 你的角色与红线（先读）

- 你做**工程审查**：核事实、核验证链、核越界；**不做视觉验收**——画面采用与否机主已裁决（全部采用），不要替他判美感。
- **只读**。不修改任何文件、不创建分支、不 push、不安装会改系统状态的东西（仓库内 `npm install` 可以）。
- 绝对不许动：`/home/baibai/pawborough-world`（现指向 main 工作区）、各 `outbox/*/artifacts`、`/home/baibai/.grok`、图库目录。
- 发现问题请输出：编号 / 严重度(P1–P3) / 文件与行号或数据路径 / 复现命令 / 期望 vs 实际。不输出改好的代码。
- 本项目验收以**确定性检查**（测试/数据集/哈希）为准；机器视觉只做技术筛查。

## 1. 项目一分钟

1990–2000 上海老城隍庙/方浜中路一带的 3D 世界复刻，v1.0 口径 = 「世界与取景版」，角色后置。上一次外部交接（2026-09-16，基于 81a68d3）之后又交付了四批，本次审查的是它们合并前的终态 **`work/corridor-video-20260919` @ 8c55d6b**（线性包含全部四批）：

1. 桥接批（4031561）：主街↔庙轴线装进同一可走世界；西延伸道路 154 m；总图登记；R1 占位退线 + 前院矮墙。
2. 庙轴线扩展（37b6e13）：配殿×2 + 廊庑×2 + 仪门背面戏楼 + 三进院 + 城隍殿；R1 七项（戏楼实心木箱、角柱冲顶、Blender 旋转模式、空白帧守卫…）。
3. v1.0 候选连做（8fa1bcc）：侧背面外皮全量、西延带 17 占位升级为冻结模块、入口页/VERSION/verify_all/scene-v1/压缩变体/新环境恢复；R1 四项（前线 5.6 m 重算、生命周期、预算、证据）。
4. 走廊/视频（8c55d6b）：狮子 v2、方形漏窗、香道、前院铜鼎、樟树×4、街道道具层 38 件、统一灯光、两段巡游视频、before/after 对照。

重要口径：**所有尺寸是主控冻结的设计值，不是测绘**；不做旧；总图只负责定位；生成参照图（GEN）不是史料。

## 2. 仓库与拓扑

- git 根：`/home/baibai/outbox/pawborough-temple-shanmen-20260915/workspace`
- `main` = fb844f7（已含 37b6e13）；待合并 `work/corridor-video-20260919` @ 8c55d6b（含 8fa1bcc）。**审查用 worktree**：`/home/baibai/outbox/pawborough-corridor-video-night-20260919/workspace`（在 8c55d6b）。
- 其它 worktree 勿动：lane-b（fix 分支）、shanmen（1231834）、dadian（main）、bridge（4031561）、expansion（37b6e13）、v1-candidate（8fa1bcc）。
- GLB 走 git LFS；`--shared` clone 拿到的是指针桩，`tools/restore_check.sh` 已含 `git lfs pull` 与魔数哨兵。

## 3. 数据集与端口

| 数据集 | 内容 | 页面 / 端口 |
| --- | --- | --- |
| `world/fangbang-temple` | 桥接世界 v1（街道 + 西延伸 + 庙轴 + 占位 + 端墙） | `fangbang.html` 5296/5297 |
| `world/fangbang-temple-v2` | + temple-axis-v2（配殿/戏楼/三进院/城隍殿） | `?ds=fangbang-temple-v2` |
| `world/fangbang-temple-v3` | + 西延带 17 店屋（block-west-shops） | `?ds=fangbang-temple-v3` 5302/5303 |
| `world/fangbang-temple-v4` | + temple-axis-v3 变体（狮/窗/香道/鼎/树）+ props 块（默认关） | `?ds=fangbang-temple-v4` 5308/5309；`&skins=1&props=1` |
| `world/temple-axis-v2 / v3` | 庙轴线独立页 | `temple-v2.html` 5298/5299；`temple-v3.html` 5306/5307 |
| `world/street-sidefaces` | 主街可见侧背面外皮（53 墙 / 54 实例） | `?skins=1` |
| `world/street-props` | 1990s 道具 38 件 | `?props=1` |
| 压缩变体 | `dist-compressed/`（meshopt，0.537） | `?compressed=1` |

## 4. 审查重点（建议顺序）

1. **测试真实性**：46 套件是否真绿；重点抽查三处历史上出过"同义反复"的测试是否已改成真断言——`tests/westshops_contract.test.mjs` W2（对已建中线复算前线 5.6±0.05）、`tests/stage_contract.test.mjs`（台基下净空区无网格，顶点级）、`tests/peidian_contract` / `houdian_contract` C8（角带顶点 y_max 对局部屋面线）。
2. **几何等价证明链**：`kit/build_dadian_court.py`、`build_entry_court.py`、`build_temple_shanmen.py` 都加了默认值开关；默认重跑必须与已交付 GLB 几何等价（accessor bounds/count/顶点集），字节可不同（多线程焊接次序）。核对各批 RESULT 的等价记录与实际重跑。
3. **冻结件哈希**：`VERSION.json` 列出 world/** 461+ 与 building/** 75 文件 sha；`tools/verify_all.sh` 的 sha_reconcile 步骤应能独立复现；抽查 `world/temple-entry/court.glb`（c5fe9efb…）与 `world/temple-dadian/*.glb` 从未被改写（`git log --all -- <path>` 只有新增）。
4. **碰撞合成**：`world/fangbang-temple-v4/collision-world.json` 中庙轴记录（T=(-127.817,0,27.057), yaw=0.16703）与 yaw=±π/2 的配殿/廊庑记录，用 `src/world/collisionAdapter.js` 的 `obbToWorld` 复算；注意物理墙按 AABB 建，斜置长条会膨胀（v1-candidate R1 已把条带收到 1.5–8 m）。
5. **可见即可挡**：任取 3 个新模块（戏楼、配殿、樟树）做顶点级检查：y 0–2.4 内的可见顶点是否都在某碰撞盒内或契约不可达区。
6. **诚实性标签**：grep `design_inference`、`notHistoricalEvidence`、`automatic`、`partial`；clipA 是 91% partial（6341/6895 帧），RESULT 应如实；scene-v1（v1-candidate）庙内机位曾按原始坐标渲染成空图，走廊批已修并记录。
7. **越界检查**：`git diff --name-status 81a68d3..8c55d6b | grep -v '^A'` 的修改项应只落在各批 DESIGN_SPEC.allowedModifiedFiles 内。
8. **预算**：各 manifest 的 triangleAccounting 两口径；westShopsBlock 188,898/200,000（主控重定预算，RESULT 有记录）。

## 5. 已知偏差（审"是否如实标注"，不裁对错）

- 庙位置为总图 POI 垂足推定，OSM 轮廓南缘与前院有 ~4 m 出入。
- 配殿/城隍殿硬山（GEN 显示观音兜/歇山读感，主控裁决不采）；匾额全部素板无字。
- 戏楼台面 2.6 m 不可达；台阶 0.17 m 胶囊可登（旧记录已更新）。
- 樟树 v1 只用 568/2600 tris，机主已决定重建（下一批）；东延带 9 占位仍是灰盒（下一批升级）。
- 本机 Cycles 动画 CUDA 8.8 s/帧 > CPU 5.0 s/帧，动画默认 CPU。

## 6. 复验命令速查（在审查 worktree）

```bash
cd /home/baibai/outbox/pawborough-corridor-video-night-20260919/workspace
git log --oneline -1                       # 8c55d6b
npm install
for t in tests/*.test.mjs; do node "$t" >/dev/null || echo "FAIL $t"; done   # 期望无 FAIL
bash tools/verify_all.sh                   # 8 步；报告 artifacts/v1-candidate/verify-report.json
git diff --name-status 81a68d3..HEAD | grep -v '^A'
node -e "const {obbToWorld}=await import('./src/world/collisionAdapter.js');" 2>/dev/null || true
ffprobe -v error -show_entries stream=nb_frames,duration -of csv=p=0 artifacts/corridor-video/clipA.mp4
```

## 7. 交付物指针

- 各批工件：`artifacts/{fangbang-temple,temple-expansion,street-sidefaces,sidefaces-full,westshops,v1-candidate,corridor,street-props,corridor-video}/{RESULT,DELIVERY,PROGRESS}.json|md`
- 机主决策记录：`/home/baibai/outbox/pawborough-corridor-video-night-20260919/OWNER_DECISION-20260919.json`
- 上一次交接书：`HANDOFF-REVIEW-20260916.md`（仓库根，基于 81a68d3）

（完）

---

# 2026-09-19 夜批增量（pawborough-adoption-east-night-20260919）

分支 `work/adoption-east-20260919`（自 main 5edc10c，含 8c55d6b）。本节为上文交接书的**增量**，上文事实结构不变，数值以下节为准。审查仍只读；本批工单 `pawborough-adoption-east-night-20260919`（outbox）。

## N1. 机主裁决落地（H）

- 采用记录：本树 10 个 `artifacts/*/RESULT.json` 置 `ownerAdopted=true`（decisionFile=OWNER_DECISION-20260919.json）；跨树 5 批在 `VERSION.json.adoption.historicalBatches` 登记，未跨树改文件。机主视觉采用 ≠ 工程验收，两轨分记。
- 压缩默认：`src/world/compressedState.js` —— 默认加载 `*.cm.glb`，`?compressed=0` 回原始；per-dataset 探针（无 cm manifest 的数据集整组保持原始，禁止混态）；fetch 重指带 HTML-fallback 守卫。temple-v2/v3 页首次接入压缩链路。
- **v4 数据集修复（重要）**：基线 5edc10c 上 `?ds=fangbang-temple-v4` 页面从未被浏览器加载过，压缩默认的浏览器 smoke 暴出四层既有缺陷，全部已修并写入管线：
  1. collision-world 残留 6 条错前缀 `court:` 墙（与 entrycourt-open 精度级重复）+ 3 条香炉改名 `entrycourt-open:`（681→675）；
  2. 树碰撞在数据集文件里但树实例缺 instances.json/manifest.modules → 已补；
  3. 三个**过期压缩 GLB**（court-open/lions/ornaments，走廊批换变体后未重压缩——压缩态本会以真实 sha 服务错误几何）已删除，变体保持原始字节；
  4. `tools/make_cm_manifest.mjs`（新）：从当前原始 manifest 重生成单数据集 cm manifest（旧的还引用 v3 时代路径）。
- `tools/verify_all.sh` 的 pkill 改用覆盖端口（不再误杀走廊 worktree 的 5306/5307 驻留服务）。

## N2. 樟树 v2（I，G12）

`kit/build_tree.py --version v2`：1936 tris（预算 1800–2600），9–12 瓣椭球冠（固定种子 20260919），双叶色 #4a5d3a/#56683f，冠底 y≥3.2（实测 4.5），碰撞盒 0.55×3.0×0.55。temple-axis-v3 与 fangbang-temple-v4 就地替换。取景规则（三机位中央 60%×60% 树冠占比=0）以**全场景黑树 mask 渲染**落盘 `artifacts/adoption-east/frame-rule.json` 全过。规格偏差：court2-w 规格点在路线摆点上，最小净移 1.90 m（超 1.5 m 上限，已记录，无更小净移）；court3-e 移 1.41 m（合规内）。

## N3. 东延伸 + 东延带（J，G5）

- 道路：`kit/build_east_extension_surface.py`，中线 = 街尾端 [124.6,27.65] → OSM 238219464 设计复用控制点 → x=236 截止（113.5 m）。衔接：起始断面**实测自已建街尾 surface.glb 端边角点**，中心偏差 0.00 / 宽 4.0±0.00 / 高差 0.00；方向 6 m 融合入 spec。宽 4.0→8.5（8 m 过渡）；路灯/25 m、排水沟/40 m；`sctail__` 地面契约；端墙 11.2×3.4×0.3（样段端墙，非历史）。表面 4388 tris（≤8000），validator 0/0。
- 店屋：9 占位（shop-134..142）按西带 R1 规则退线到**已建**东中线 5.6 m 前线 + 冻结模块升级（block-east-shops，可 `?revoke=block-east-shops` 回灰盒）；零 SAT 重叠；3 条院墙 strip（1.5–8 m 缺口）。预算 eastShopsBlockTris 107472≤110k、fullSceneV4Tris 453062≤700k。
- 路线：mainStreet 东端延至端墙前 3 m（114→335 点，512.2 m）。
- **第三次装配修正（重要）**：v4 管线的轴碰撞组合此前的两步 strip+re-anchor 把**实例锚点丢给所有非原点实例**（yimen/dadian/peidian/gallery/houdian/树 ~180 条记录全部挤在山门附近）；且轴记录 center 为**模块自身坐标系**（yawed 配殿/廊庑未转）。现为：锚 = axisToWorld(obb.pos)，模块 yaw 折入（YAW+o.theta）。走廊批的 passage「通过」是在墙错位状态下取得的，本批 v4 passage 以修正后物理重验（见 N5）。
- 店屋 AABB Y 域对账（GPT 复验项）：所有 obb 记录 min/max Y = center±size/2（160 条修正——西店屋记录曾把二层楼板 y3.49..3.71 压平到 0..0.22、柜台/门槛/帽墙全部错位）。
- 戏楼侧翼墙碰撞（GPT 复验项）：可见木侧板 x±3.015 / y2.40..3.21 / 长 3.81 原无碰撞，补 2 条（stage_contract 契约改 4 柱+1 栏+2 翼墙）。

## N4. 视频（K，G14）

- `kit/out/scene-v3/scene-v3.blend`（v4 全实例 + skins + props 默认开 + 树 v2 + 东延带 + 29 机位 + 统一灯光）；29 张静帧（1600×900、24 spp、OIDN、CPU）**0 空白**；3 新东段机位 east-junction / east-road-mid / east-end-wall；axis-aerial 用追认 H 姿态。
- clipA：新路线全程（512.2 m，预计 ≈8780 帧 @24fps）CPU 重渲，preflight 5 帧过（起点即东延带实景，非灰盒），11 h 墙钟守望（只管本批进程、启动失败 10 min 报警、到点出 partial）；每 200 帧 GPU 复查（仅 CUDA < CPU×0.8 才切）。
- clipB：orbit 576 帧 GPU（树 v2 在框内、东延带远景）。
- contact sheets：12 视图 before（走廊批）/after（本批），东段 3 机位标注 NEW。

## N5. 验证链（本批强化）

- `tools/verify_all.sh` 现为 **9 步**：`freeze_check`（先对 HEAD 的冻结清单校验 world/building sha，授权就地更新数据集 v3/v4 豁免并计数）→ make_version → sha 对账 → dist → preview×2 → **浏览器总验门** `tools/full_browser_gate.mjs`：v4+skins+props 两态、v3 两态、temple-v2、temple-v3（dev）共 7 场景；**预览服务必须 byte 级等于本构建 dist**（防误接旧服务）；**record.routeCheck.pass 不为 true 即 FAIL**（无 routeCheck 不算通过）。
- 测试 50 文件：+compressed_default / east_extension_contract / eastshops_contract / fangbang_v4_passage（修正后物理：东端起点→城隍殿门前 localZ −71.63、返程 1.6 m 内、端墙/店面/strip 3 负例）。
- 复验命令：`cd /home/baibai/outbox/pawborough-adoption-east-night-20260919/workspace && PREVIEW_PORT_A=5312 PREVIEW_PORT_B=5313 bash tools/verify_all.sh`；`node --test tests/*.test.mjs`；`node scripts/build_fangbang_v4_world.mjs`（重生成 v4）。

## N6. 边界与状态

- G2 玄扈台 / G3 照壁未动；不做旧；未合并、未 push；building/** 与 v1/v2/v3 数据集只读（v3/v4 就地更新限授权项）。
- 工程验收状态：`delivered_for_lead_review`（主控复验 pending）；机主视觉采用记录保留在 RESULT/VERSION（两轨分记）。
- 已知残留：v4 换装变体的压缩 GLB 未重打（默认态走原始字节，诚实回退）；street-props 无压缩件（两态均原始）。clipA 若 11 h 到点为 partial（fallback #6）。
