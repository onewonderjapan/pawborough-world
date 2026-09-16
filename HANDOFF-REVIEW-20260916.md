# HANDOFF / REVIEW — Pawborough 庙宇轴线四批合并审查交接书

给外部审查者（ChatGPT）· 2026-09-16 · 主控方 ZCode 备妥
合并执行者声明：本文档事实均可用文末命令独立复验；审查是**只读**的。

---

## 0. 你的角色与红线（先读）

- 你做**工程审查**：核事实、核验证链、核越界；**不做视觉验收**——画面采用与否是机主（人类）的裁决，你不要替他判美感。
- **只读**。不修改任何文件、不创建分支、不 push、不安装会改系统状态的东西（`npm install` 在仓库内可以）。
- 绝对不许动：`/home/baibai/pawborough-world`（主街机主工作区）、各 `outbox/*/artifacts`（交付证据）、`/home/baibai/.grok`。
- 发现问题请输出：编号 / 严重度(P1-P3) / 文件与行号或数据路径 / 复现命令 / 期望 vs 实际。不输出改好的代码——修复由施工侧做。
- 你不能看图没关系：本项目的验收逻辑以**确定性检查**为准（测试/数据集/哈希），机器视觉仅用于技术筛查且从不作为通过依据。你也应如此。

## 1. 项目一分钟

Pawborough：上海老城（1990–2000 城隍庙/方浜中路一带）的 3D 世界复刻，v1.0 口径=「世界与取景版」（V01–V10），角色后置。本轮合并的是**庙宇轴线四批**：
1. 街道完善批（130–133 四栋+街尾连通+山门资料，基线 4a2e76f + 审查修复 6df460e）
2. 山门批（temple-shanmen，含 R1 坐狮）
3. 入口组批（前院+仪门 temple-entry，含 R1 坐狮修复线 1231834）
4. 大殿批（二进院+重檐大殿 temple-dadian，含 R1 脊梁修复 929e0ee）

重要口径：**所有建筑尺寸是主控冻结的设计值（样段），不是测绘**；不做旧化；总图只负责定位。凡「史料/实拍」相关表述必须可溯源到图库记录（见 §6）。

## 2. 仓库与拓扑（合并后）

- 仓库：`/home/baibai/outbox/pawborough-temple-shanmen-20260915/workspace`（git 根即此目录）
- `main` = `28e74ef`（merge 街道修复）← `338a983`（merge 庙宇轴线四批）← `929e0ee`（大殿 R1）
- 分支线：`3f6cacd`(街道基线) → `work/street-completion-20260915`(4a2e76f) → `fix/street-completion-review-fixes-20260915`(6df460e，独立修复线，已合入) ；`work/temple-shanmen-20260915` → `work/temple-entry-court-yimen-20260915`(1231834) → `work/temple-dadian-court-20260915`(929e0ee)，均已合入 main
- worktree：`pawborough-lane-b-night-20260914/workspace`（挂 fix 分支，勿动）、`pawborough-temple-shanmen-20260915/workspace`（入口批历史态）、`pawborough-temple-dadian-night-20260915/workspace`（当前在 main，审查用这个）
- 合并未 push（本仓库无远端配置；本地合并即交付态）

## 3. 资产与端口地图

| 数据集 | 路径 | 内容 | 预览 |
| --- | --- | --- | --- |
| 主街 91m | `world/street-*.glb` + `world/{instances,collision-world,route}.json` | 16 门面街道 | 5284/5285（主街工作区起服，勿动） |
| 街道完善 | `world/street-completion/`、`world/east-edge/`、`world/laneb/` | 130–133 四栋、东端双栋、支弄 B | 见各批 README/RESULT |
| 山门 | `world/temple-shanmen/`（temple/ground/lions/ornaments.glb） | 山门+坐狮 | 5290/5291 `/temple.html` |
| 入口组 | `world/temple-entry/`（+yimen.glb/court.glb） | 前院+仪门 | 5292/5293 `/temple-entry.html` |
| 大殿 | `world/temple-dadian/`（8 GLB，含 court-open 变体） | 全轴线：山门→仪门→二院→大殿 | 5294/5295 `/dadian.html` |

注意：`temple-dadian` 数据集内的 shanmen 4 件与 yimen 是**字节级冻结拷贝**（sha 对账见 §5）。`court-open.glb` 是入口院的无截断墙变体（几何等价证明见 §5），已交付的 `temple-entry/court.glb` 原件从未被改写。

## 4. 审查重点（建议顺序）

1. **测试真实性**：26 套件是否真的全绿；抽查 2–3 个测试的断言是否可能假通过（历史上本项目发生过"测试自己写反"——`tests/dadian_contract.test.mjs` 的 git 历史里有一次修正，可作对照样本）。
2. **冻结件完好**：§5 的哈希清单逐一复算；`git log --all --oneline -- world/temple-entry/court.glb` 应只有一次新增提交。
3. **屋面数学复算**：`world/temple-dadian/dadian-roof-surface-samples.json`——(a) 逐列单调（容差 1e-4）；(b) |x|≤9.0 内脊梁下间隙≤0.02（R1 修复项）；(c) 上檐檐口线减裙檐脊线 ≥0.85。
4. **碰撞装配一致性**：`world/temple-dadian/collision-world.json` 每条记录用 obbToWorld 语义复算（含 theta≠0 的山门斜墙：AABB 半宽 = |R|·size/2）。
5. **诚实性标签**：grep `design_inference`、`owner-pending`、`自动执行`——自动巡航必须标注 automatic；设计推断不得冒充实拍。
6. **预算**：`review-manifest.json` 的 placedTriangles=104,142 与逐 GLB 实测一致；大殿 43,826/58,000。
7. **越界检查**：合并 diff 里不应出现对 `pawborough-world`、图库目录、交付 artifacts 的任何改动。

## 5. 哈希与等价性清单（复算命令见 §7）

| 项 | 值 |
| --- | --- |
| 入口院交付件 court.glb（必须未变） | sha256 `c5fe9efb2f403f4c…`（前 16 位，完整值在 `world/temple-entry/review-manifest.json`） |
| court-open vs court | 几何等价（12/12 accessor bounds/count 一致）但字节不同——多线程浮点次序，双方记录在 `artifacts/temple-dadian/RESULT.json.knownDeviations`；这是已报备的已知差异，不是篡改 |
| 参照照片 | 大殿包 `references/SOURCE-SUPPLEMENT.json` 11 张全部带 sha256/许可/来源；图库正本 `pawborough-shanghai-reference-library-20260913/`（130+25 条，许可字段齐全） |

## 6. 设计预置与不确定项（审"是否如实标注"，不裁对错）

- 匾额「城隍廟」：实拍依据 PBR-SH-0005-004，**预置待机主否决**（原设计文「護國佑民」被实拍否定）
- 「歇山读感」：航拍 PBR-SH-0005-001 证实真殿歇山；本实现=四坡壳+山花贴面，**明确不宣称真歇山测绘**，真歇山拓扑留作 R1 候选
- 铜鼎三兽足/对联板无字/后墙素面/北端封墙非历史——全部在 `RESULT.json.uncertaintyPolicy` 有记录
- 已知未修小项（P3）：门拉环远景呈圆片；夹层侧板缝 1mm 发丝线

## 7. 复验命令速查（在 `pawborough-temple-dadian-night-20260915/workspace`，main 分支）

```bash
npm install                      # 仓库内依赖
for t in tests/*.test.mjs; do node "$t" || echo "FAIL $t"; done   # 期望 26/26

# 屋面三查（python3，读 world/temple-dadian/dadian-roof-surface-samples.json）
#   单调：逐列 y 随 t 不增（tol 1e-4）
#   脊梁支承：upper 壳 t=0 行，|x|<=9.0 内 12.40-y <= 0.02
#   层间净空：upper 檐口行(含lift) - lower t=0 行 >= 0.85

# 冻结件哈希
sha256sum world/temple-entry/court.glb world/temple-dadian/yimen.glb

# 预览（如端口未被占用）
npm run dev:dadian               # 5294
npm run preview:dadian           # 5295（需先 npx vite build && node scripts/build_dadian_dist.mjs）
```

## 8. 尚未做的事（审查边界）

- **主街↔庙轴线桥接装配**（山门前街面接方浜路缘）与**总图登记**（城隍庙锚点升级为已建样板）是下一批，不在本次合并内——main 上的街道数据集与庙宇数据集目前是**并列存在、尚未互通**，这是设计中的中间态，不是缺陷。
- 五批的 `ownerAdopted` 全部仍为 false；视觉采用待机主逐批裁决。

## 9. 交付物指针

- 大殿批：`/home/baibai/outbox/pawborough-temple-dadian-night-20260915/artifacts/temple-dadian/{RESULT,DELIVERY,PROGRESS}.json|md + webgl/ + blender/`
- 前批同类物在各自 `outbox/pawborough-*` 包内（入口组、山门、街道完善、东端）
- 本文档副本已提交至仓库根 `HANDOFF-REVIEW-20260916.md`

（完）
