# facadeBay 稳定唯一身份迁移说明（goal-identity-20260927）

状态：delivered_for_lead_review（不等于采用/云端归档）。基线：1224b416。

## 缺陷
冻结基线 `baseline/layout.json` 中 175 个 `facadeBay` 只有 7 个 distinct id
（facade-16×62、facade-2×45、facade-33×36、facade-15×12、facade-1×8、facade-0×7、facade-24×5）。
根因：`src/layout.mjs` `emitFacadeBays` 只在被埋没（suppressed）开间上 `facadeId++`，
rendered 路径不递增，导致大量开间共享同一 id，身份不可追溯、无法定位单间。
修前证据：`outbox/pawborough-goal-identity-20260927/artifacts/evidence/facade-identity-before.json`。

## 新 id 方案（facade-v2-parent-geomfp）
```
id = facade-{parentShort}-{base36(FNV-1a32(parentBuilding|px|pz|rYm|wm))}
px/pz = position×1000 四舍五入（毫米）；rY = rotY×1000（毫弧度）；wm = width×1000（毫米）
```
- 只依赖 parentBuilding + 自身几何（毫米级规范化）→ 同输入重跑 id 稳定；
  插入无关建筑不重排既有 id；不是全局 counter 重编号。
- 重复 / 无法区分（同 parent 同指纹）在生成期与迁移期一律失败，不静默去重。
- helper：`src/facade-identity.mjs`（facadeBayId / facadeBaySignature / legacyDoorVariant / registerFacadeId）。

## 门型 variant（防「换 id 改门窗」）
`buildFacadeBay` 旧逻辑 `doorX = hashStr(id)%2===0 ? 0 : -w*0.22` —— id 变了门窗就会变。
对策：
- 每个开间写入显式 `doorVariant`（`center` 居中 / `offsetLeft` 偏左），值 = 旧 `hashStr(旧id)%2` 推导，
  与冻结基线画面逐位相等；`buildFacadeBay` 优先读 `doorVariant`，未迁移旧文件按旧 id 回退（行为不变）。
- 旧计数 id 保留为 `legacyId` 字段（含 suppressed 递增的旧语义，与基线逐位对齐）；
  顶层新增 `facadeIdentity.legacyAliases`：旧歧义 id → 新 id 列表的**一对多清单**（7 个旧 id → 175 个新 id），
  不把旧歧义 id 偷偷映射到任意一间。
- `trade` 仍按旧 counter 表达式，招牌色不变。

## 改动面
- 新增：`src/facade-identity.mjs`、`scripts/migrate-facade-identity.mjs`、
  `tests/facade-identity-test.mjs`、`tests/facade-identity-geometry-test.mjs`、本说明。
- 修改：`src/layout.mjs`（emitFacadeBays 身份+variant+守卫+facadeIdentity 对账块）、
  `src/build-scene.mjs`（buildFacadeBay 读 variant 两行 + extras 透传）、
  `baseline/layout.json`（仅 facadeBay 的 id/legacyId/doorVariant + 顶层 facadeIdentity，其余字节语义不变）、
  `package.json`（+test:facade-identity）。
- 不变：坐标/几何/其他 kind/门洞数值/通路/恢复工具零改动；商业路线 pin 字节不变；
  4 个既有 sealed-door 不碰；既有云端回执（docs/MIGRATION-ASSETS.json）不改。

## 迁移与复现
```bash
cd scene-authoring/yuyuan-area
node scripts/migrate-facade-identity.mjs --check   # 幂等；已迁移则 0 renamed
node scripts/migrate-facade-identity.mjs           # 已执行（2026-09-27）
node tests/facade-identity-test.mjs                # 生成器↔基线全等/别名/负例
OUT_DIR=out-identity PRE_OUT_DIR=out node tests/facade-identity-geometry-test.mjs
OUT_DIR=out-identity node tests/facade-bay-fit-test.mjs   # 复用窗体 fit 回归
```
全链重建（本单证据）：
```bash
OUT_DIR=out-identity ZONE_SPLIT=1 ZONE_CM=1 SANSUITANG=1 GARDEN_KITS=1 SITE_MODULES=1 STALL_KIT=1 \
  flock /home/baibai/outbox/pawborough-goal-20260927/run/heavy.lock bash scripts/rebuild-review.sh
```
（attempt1 因缺 SANSUITANG=1 在 export-collision 失败，证据见 artifacts/evidence/rebuild-attempt1-failure.log；
该环境开关与冻结基线 out-night-final 的已验证产物一致，非本单改动引起。）

## 验证结论（详见 RESULT.json）
- 175/175 唯一；生成器重跑与迁移基线 id/legacyId/doorVariant/几何全等；legacyAliases 双向覆盖。
- procedural-bazaar.glb：175 节点名 `bazaar|<新id>|facadeBay|L1` 唯一可定位；extras 含
  id/legacyId/doorVariant/trade；zone-bazaar*.glb / .cm.glb（gltfpack `-kn -ke`）name+extras 保留。
- 修前/修后 GLB 按空间签名逐 bay 配对：顶点数、(顶点,顶点色) 多重集、门位逐一相等
  （不要求整文件同 hash——元数据差异合法；也不以 hash 不同跳过几何比对）。
- 负例：单一移动（签名配对失败）、doorVariant 篡改（门位失配+真实重建门位移动）均被抓。
