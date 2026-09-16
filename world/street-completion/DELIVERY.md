# 方浜中路街道完善整包交付（street-completion-night-20260915）

`delivered_for_lead_review` · `ownerAdopted:false` · 分支 `work/street-completion-20260915`（自 4a2e76f）· 2026-09-15

机主手动启动单会话连续执行 S0–S6。前序返修会话（R1–R3）活跃期间按预设降级先行完成 S5（独立产物目录），其退出后取真实 HEAD 承接，无中途审批停顿。

## 打开方式

```bash
npm run build && npm run preview   # 127.0.0.1:5285（已重建并验证）
# 候选：  http://127.0.0.1:5285/?world=street-completion
# 对照：  http://127.0.0.1:5285/?world=street-completion&assets=off
# 默认 / laneb / east-edge 数据集均实测可载入
```

## 六栋连续街尾

- 新增四栋 `east-shop-130..133`（棉布/绸缎/绣品/皮货），设计尺寸取自 NEXT_FOUR_DESIGN.json，立面语言沿用 128/129 种子；四种业态通过凹龛陈列+招牌宽窄+木板闭合明确区分。
- 派生数据集 `world/street-completion/`：`block-east-edge-shops`（128/129）**逐字携带且漂移受检**，新块 `block-street-completion-shops` 替换 130–133；撤回可恢复、F3 不触及精修对象、晚到资产不残留（28 项契约测试，真实 Rapier）。
- 通用招牌图集新增行 2–5（布行/绸庄/绣坊/皮货），行 0–1 像素级未动。

## 真实街面边界（S3）

- 从装配 GLB 实测冻结路面楔形东端 ((84,21.45)-(88.5,14.31)) 起铺 39.6m 连通街尾，经三对前墙走廊中线，宽 8.44→4.0m；不铺全城平板。
- 可见面=物理地面：surface.glb 节点命名进 `GROUND_NODE_RE`，地面三角网直接取自该网格；界外坠落负例证明无隐形地板。
- 逐栋边缘间隙硬校验 ≥0.10m（最紧 130 号 0.137m）；路缘石连续、2 落水口+1 井盖有位置依据。
- 自动物理巡游（标注 auto）：西入口→街尾端点→返回全程落地，8/8 抽样站位 settle；碰墙/闭门/界外三个负例全部成立。

## 取景与证据（S4）

- 8 个固定机位：sc-czero（原C0终点方向，灰盒/候选同机位对照）、sc-roof-north/south（两侧屋面连续）、sc-ground-seam（近地接缝，衔接无痕）、sc-pair-cloth-silk、sc-pair-embroidery-leather（业态对街）、sc-lane-b、sc-catwall（支弄B/猫墙保留）。
- WebGL 11+2 张（客户端自身遥测随图）；Blender scene.blend+相机侧车可复用（pair 视角黑帧已如实降级记录）。审看后修正 2 处机位，前后坐标留档。

## 城隍庙资料包（S5，本批尾项）

`artifacts/street-completion/temple-entry-reference/`：8 个优先图逐图辨认（山门/仪门/大殿/非庙宇本体四类，湖心亭误标签已排除并加 warning）；山门正面六类要素像素标注+标注叠图；unknown（侧背面、1990年代、实测尺寸、仪门匾文）如实列出，不阻断。主控可直接据此设计"山门+短前庭"样板。

## 预算与校验

| 项 | 实测 | 限额 |
|---|---|---|
| 四栋三角形合计 | 27,988 | ≤48,000 |
| 单栋 GLB | ≤1.79 MB | ≤10 MB |
| gltf-validator | 0 错 / 0 警（4 GLB） | 0 错 |
| 街面边缘间隙 | ≥0.137 m | ≥0.10 m |
| 测试 | 全套 13 套 PASS（含新增 2 套 41 项） | 全过 |
| preview | 候选/对照/默认/laneb/east-edge 全部载入 | 全过 |

## 待主控审看（不构成本批阻塞）

1. 四栋业态可辨度与陈列密度（sc-pair-* 两张 WebGL 图）。
2. 130/131 走廊 0.137/0.187m 间隙接受度。
3. E128/E129 既有橱窗碰撞缺口（继承问题，本批未动）的处置。
4. Blender pair 视角黑帧的复原（scene.blend 已在库可复现）。
5. S5 资料包→下一批"山门+短前庭"样板设计。
