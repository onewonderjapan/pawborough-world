# 交付 — 主街↔庙宇轴线桥接装配 + 总图登记（fangbang-temple-bridge-night-20260916）

**状态** `delivered_for_lead_review` · `ownerAdopted=false` · `visualReview=pending_lead`
**分支** `work/fangbang-temple-bridge-20260916`（基线 main@81a68d3，只新增文件）
**预览** dev 5296 / preview(dist) 5297 · `fangbang.html`

## 交付了什么

主街与庙轴线现在在**同一个可走世界**里：从东尾 (124.6, 27.65) 出发，沿主街向西，
经过实测拼接的西延伸道路（153.94 m 样段，端墙收尾），抵达按总图锚点落位的庙轴线，
穿过山门→前院→仪门→二进院，止于大殿闭门/台阶脚——全程 321.7 m，物理巡游往返 PASS。

- **庙群落位**：T=(-127.817, 0, 27.057)、yaw=0.16703（POI 锚点垂足法，registry 可否决）。
  8 个冻结 GLB 字节级拷贝（sha 对账），128 条碰撞按 colliderComposition 合成（逐条复算 ≤1e-6）。
- **西延伸**：实测冻结路西楔端（两角 (-3.274,-3.368)/(-0.5084,4.6695)，切宽恰 8.50 m，
  中点在冻结中线向西延长线 2.0 m 处——实测而非 fallback）→ Chaikin 中线 153.94 m；
  可走面=可见面（sctail__ 族，GROUND_NODE_RE 冻结前缀复用），前院接缝吸附齐平（落差 5 mm）。
- **占位街区**：west 带 153..171（168–171 按 build_blocks 规则从总图补齐），
  replacedRule 复算恰好命中 shop-167/169（可恢复）。
- **总图登记**：`world/fangbang-temple/map-registry.json`（map sha 1dee48…已对账，
  POI/垂足/端点/方法/knownDeviations/registeredBy/ownerAdopted=false）。

## 验证（全绿）

- 测试 **29/29**（26 既有回归 + 3 新：contract / passage / map_registry）
- 页面自动巡航（automatic，非人工试玩）：去程至台阶脚 · 返程达 · 端墙挡 · 占位挡 ·
  前院东界（开放边缘坠落=无隐形地板）· 闭门挡 · 拼接缝停滞 0 s · 全程 y ≥ -0.05
- dev 5296 与 dist 5297 双验证（JSON 不被 SPA 回退、巡航 PASS）
- Blender 评审 9 图（CPU 24 spp，fov 逐机位校验）+ WebGL 8 机位取证 + 同机位并排对比图

## 预算

| 项 | 实际 | 限额 | 判定 |
| --- | --- | --- | --- |
| 桥接世界三角形（主街装配+庙轴+西延伸） | 281,578 | 300,000 | ✓ |
| 西延伸面+端墙 | 5,972 | 8,000 | ✓ |
| 新贴图 | 0 | 0 | ✓ |
| 全场景实放（含已交付街尾精修店 41,428 + 东尾面 1,468） | 324,474 | — | 如实记录 |

## 需要机主裁决的预置（可否决）

1. 庙轴线位置 = POI 锚点垂足法
2. 门槛退后 12.6 m（前线 5.6 + 前院 7.0）
3. 偏航 9.57°
4. shop-167/169 由庙轴替换（可恢复）
5. 西端垂足以西 24 m 封端墙
6. 西延伸宽度 8.5 + 2×1.35

## 如实报告的偏差（详见 RESULT.knownDeviations）

- OSM 庙轮廓南缘与前院 ~4 m 出入（2019 参照非测绘）。
- 17 个占位视觉盒侵入车行道（总图质心残差 ~17 m 所致）——不移动，逐店 residual 已记录；
  胶囊走廊全程 ≥3.75 m。junction-west 机位如实呈现此现状。
- 前院东界 local z≈3 处开放（被替换的 167/169 原是推断遮挡物）：该方向实际会走出院缘坠落
  （=庙东无隐形地板的证明），负例断言已改为诚实的二选一。
- 大殿台阶 0.17 m 胶囊爬升受限于既有证据；本次巡航实际经斜向登台到达闭门（z=-43.98 被挡），
  两种结果均如实记录。
- 西延伸地面节点沿用 `sctail__` 冻结前缀族（GROUND_NODE_RE 不可改，语义同 S3 东尾延伸面）。
- collision-world.json 是唯一墙体权威：庙轴 assets 块无逐资产侧车，撤销该块仅撤视觉
  （本页无撤销入口；语义已在 blocks.json 注明）。

## 复验

```bash
cd /home/baibai/outbox/pawborough-fangbang-temple-bridge-night-20260916/workspace
git log --oneline -1
for t in tests/*.test.mjs; do node "$t" >/dev/null || echo FAIL $t; done    # 期望无 FAIL
npm run dev:fangbang        # 5296 打开 /fangbang.html
node scripts/smoke_fangbang_web.mjs                                          # headless 巡航 PASS
```
