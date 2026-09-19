# B 包交付 — 西延带 17 占位升级为冻结街屋模块（fangbang-temple-v3）

批次：pawborough-v1-candidate-night-20260918 · 状态：delivered_for_lead_review · ownerAdopted=false

## 交付了什么

`world/fangbang-temple-v3/` = v2 桥接世界（只读）+ `block-west-shops` 资产块：

- **17 个占位升级**（shop-153..171，活跃占位全表）：按 DESIGN_SPEC category→module 映射引用 `building/` 冻结模块 GLB（药材→pharmacy、酒楼→restaurant-a、饭馆→restaurant-b、绸缎/绣品/棉花/皮货→cloth、字画/参茸→curio-a/b、银楼→curio-b、照相→photo、其余 plain-v1/v2/v3 轮换）。0 新建模、0 新贴图、只引用不复制（sha 逐一对账 building/ 原件）。
- **布设**：前墙中心沿道路法线落线；相邻重叠 >0.2m 沿切向顺序移位（plan.shiftLog 可查）；净距 >1.5m 同侧补院墙 strip ×3（h2.9、t0.28、plaster+瓦帽，`westshops-strips.glb`）。精确 SAT 复算零相邻重叠。
- **碰撞**：模块 collision 套实例变换合成，合计 666 条（street 208 + walls 3 + temple 233 + westshops/strips）。
- **lifecycle 可回滚**：blocks.json 17 占位带 `replacedBy: block-west-shops`；revoke（删资产块+清 replacedBy）即回灰盒。

## 预算（如实）

| 项 | 实测 | 限 | 判定 |
| --- | --- | --- | --- |
| westShopsBlock | 188,706 tris | ≤180,000 | **超 4.8%**（17 模块实测合计，如实记录，回滚/换模需机主裁决） |
| fullSceneV3 | 522,480 tris | ≤600,000 | ✓ |
| 新贴图 | 0 | 0 | ✓ |

## 测试与验证

- 全套 **39/39 绿**；`westshops_contract` PASS（17 资产 sha、±0.05 前线、零 SAT 重叠、3 strips、validator 0/0）；`fangbang_v3_passage` PASS（西延带中心线双向 + 立面/条带阻挡）。
- 页面三态 PASS：`?ds=fangbang-temple-v3&skins=1`（567,764 tris，route 全过）、`?ds=fangbang-temple-v3`（565,304）、默认（不变，v2 行为原样）。
- **route 契约变化（如实）**：撤下 `shop-165-placeholder` 活体负例——该占位被开放门面餐厅模块替换，"挡在占位盒外"与交付几何矛盾；店内/条带阻挡改由离线 `fangbang_v3_passage` P2/P3/P4 对 collision-world 强制（即 DESIGN_SPEC.packageB.tests 口径）。v2 页面 routeCheck 原样（占位挡✓）。

## 证据

- **WebGL 8 机位**：`web/`（?ds=fangbang-temple-v3&skins=1，cameraCheck dPos=0 dFov=0，空白帧守卫全过）。
- **Blender 4 张**：`blender/`（junction-west / west-road-mid / placeholder-band / aerial-overview；Cycles CPU 24spp AgX；含 scene.blend 与 sidecar）。
- **perf v2/v3**（SwiftShader 软件 GL，仅回归基线）：v2 5,774ms / 88.1MB / cruise P50 166.8ms；v3 8,448ms / 173MB / P50 183.3ms；两者 3×重载 stable（无资源增长）。传输 +85MB 来自 17 个模块 GLB——压缩变体在 C 包处理。
- 渲染脚本：`kit/build_westshops_v3_scene.py`（v2 场景脚本复制扩展）；装配脚本：`scripts/build_westshops_v3_world.mjs`。

## 端口说明

5302 被既有进程占用 → 按 fallback #8 用 **5304**（dev server）。vite preview 的 dist 是 git 内旧构建产物（不含 v3 数据集），验证走 dev server，与桥接批/A 批先例一致；dist 刷新在 C2 verify_all 处理。

## ownerVetoable

整块可一键 revoke 回灰盒（见上）。映射与 strip 均为设计推断（dimensionsAreDesign）。
