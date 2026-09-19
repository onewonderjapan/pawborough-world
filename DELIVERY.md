# Pawborough 世界工程收口 — 交付书（pawborough-world-closeout-night-20260919）

机主手动启动；按 M→N→O→P→Q→R 连做；R 完成即停。机主视觉采用决定不变
（OWNER_DECISION-20260919.json G1 adopt_all）；本批全部为工程收口，未新增/未回写任何审美裁决。

## 提交链

| 项 | 提交 |
|---|---|
| 固定基线（=源 adoption-east 分支 tip） | `1892e61cc63bea00ec83366885657e1fcd864ef0` |
| M 基线 | `3139366` |
| N 压缩 | `fac0844` |
| P 再生一致性 | `8953636` |
| O 正式入口/门 | `1b9033c` |
| **releaseCodeCommit** | `e1367293a43fa3ced77f39ad5d4a010ec752c24e` |
| 之后 | 仅补证据/交付记录提交（含 restore 工具日志路径修正，不影响任何交付物字节） |

分支 `work/world-closeout-20260919`；本批 workspace：
`/home/baibai/outbox/pawborough-world-closeout-night-20260919/workspace`。

## M — 基线（done）

- 源 HEAD 核对＝固定基线；worktree 从 `1892e61` 新建。
- LFS 9700 件全部实物化；`npm ci` 锁文件版本；gltfpack 1.2 实测可执行。
- 基线测试 `node --test tests/*.test.mjs`：54/54，退出码 0（本批新跑，非继承历史 PASS）。
- `artifacts/world-closeout/baseline.json`：611 文件 SHA 清单（225 原始 GLB 371.4MB / 199 既有压缩 180.2MB，
  路由/相机/实例/碰撞分类）。
- 源渲染/守望只读核对：Blender PID 3531877、守望 4023166(+4025879)，cutoff `2026-09-20T08:15:00+09:00`
  未动、未接管、未竞争。

## N — 压缩补全（done）

- 闭包（实际 manifest+blocks 解析，104 件）：100 有 cm 邻件、26 缺、1 missingOrig
  （`world/temple-axis-v3/tree-camphor.glb`——仅 `treeV2.previousFile` 溯源注记引用，页面从不加载，v2 已替代）。
- 26+2 候选在隔离目录 `artifacts/world-closeout/cm-candidates/` 生成（gltfpack -cc -kn；ground 名件 -vpf -vt14）。
- 浏览器解码验证（生产 createGLTFLoader/MeshoptDecoder）：新候选 24 过；既有 100 件中 97 过。
  **发现并替换过期变体** `world/fangbang-temple-v4/westshops-strips.cm.glb`（120→72 tris、59.4m 包围盒偏移；
  旧字节留档 `retired-cm/`）。
- 容差回退 4 件（退化三角漂移>0.1%，几何不改）：v4 狮子 0.49%、v3-axis 狮子v2 0.49%、v4 东延伸 surface 0.32%、
  v1 狮子 0.56%（冻结 v1，无页面消费）。原因写入清单 `compressedVariant.fallbacks`；
  负例钉死三条路径不得出现 cm。
- `tools/make_cm_manifest.mjs` 升级：cm-provenance.json 注册表来源 SHA 门——过期/未验证变体**永不入选**。
- 重生成清单：fangbang-temple-v4（122 repointed/5 kept）、temple-axis-v3 新建（13/1）、street-props 新建（5/0）。
- 原始资产：**225 个原始 GLB 与 M 基线逐一比对 0 变化**。
- 遗留发现（allowedChanges 未授权，未动）：`world/fangbang-temple-v3/westshops-strips.cm.glb` 过期（同 v4 症状）、
  `world/fangbang-temple-v3/temple-axis/lions.glb` 的 cm 漂移 0.56%。修复链已备好，授权后一条命令可清。

## O — 正式入口与浏览器验收（done）

- temple-v3.html 纳入 vite 正式输入；`npm run build` 官方闭包含全部 14 数据集（cm 在内）+VERSION+index-v1，
  不再依赖 verify_all 临时复制；index-v1 改站点相对 URL 与现役页面集。
- `tools/full_browser_gate.mjs` 重写：自有服务+归属核验（子进程存活/strictPort/HTML+bundle 字节一致；
  外来或遗留服务判失败——曾实际拦下本批自身遗留孤儿并已清理）、12 场景
  （preview 四页×两态 + dev 两页×两态）、routeCheck.pass===true 硬门槛、同任务空白帧守卫、网络错误分类。
- **BROWSER_GATE_PASS 12/12**；`browser-report.json` + 12 张证据截图。
- 过程修正（修脚本不移除检查）：templeV3Main 几何完整性对齐 fangbangMain 的 0.1% 压缩态容差
  （8 个退化三角差，原始态保持精确）；cm-manifest HEAD 探针的 ERR_ABORTED 判为 Chromium 日志伪影。
- 全套测试 56/56（54 基线+2 新负例）。

## P — 再生一致性（done）

- 两生成器加 `--out`+拒绝覆盖：删除"rm -rf 原地重建"默认，已采用数据集不可能被回滚。
- **树 v1 路径风险实锤并修复**：旧 axis-v3 生成器仍复制退役 `tree-camphor.glb`（kit 哈希守卫下会硬失败）；
  改为已采用 `tree-camphor-v2.glb`；TREE_POS 固定为 I2/G12 已采用庭院墙沿线坐标。
- 隔离双跑逐字节一致；与已采用数据集对照：原始 GLB/路由/相机/摆放全同；碰撞按规范形
  （世界中心+尺寸+theta+AABB，1e-5、顺序无关）全等——Codex 修复与生成器的两种 obb 分解合成为同一物理盒；
  允许差异仅历史簿记/溯源注记。
- 重建产物上五项复算全过：轴局部 (±2.4,1.01,-27.085) 两侧命中+中央通道、桥接世界两侧命中、
  v4 全部 792 AABB 的 Y=pos.y+center.y 复算零违例、八条 strips [0,2.9]、yimen-stage 侧车 9 件
  （四柱+一栏+两条高处 flank guard+两条地面灰泥 wing wall）各自独立。
- 失败负例 2/2：移除 wing wall→胶囊穿透；strips 丢 pos.y→[0,2.9] 断言必破；expected 取自生产公式。

## Q — 视频终态与便携包（done，clipA 见下）

- clipB：576/576 帧、24.000s、sha256 `462df881e36f...` 前后一致；GPU 456 帧 CUDA OOM→CPU --resume 续渲
  接缝 0 空白（沿用 adoption-east 批真实说明，未重渲）。
- clipA：见「视频状态」；不停止、不续渲、不竞争、不改原 cutoff。
- 29 静帧/12 对照页沿用既有证据。START_HERE.zh-CN.md 与 delivery-manifest.json（相对路径+字节+sha256+提交+视频态）
  生成于 `artifacts/world-closeout/`；打包 `artifacts/world-closeout/package/`（site=dist 复制+报告+视频+文档），
  给 localhost 静态服务命令，file:// 不作为可用口径。

## R — 恢复与收口（done）

- 全套测试 56/56；freeze_check 强化：非冻结数据集锁 HEAD VERSION，**授权目录（v3-axis/v4/street-props）锁本批
  M 基线**（派生 cm 由注册表门+清单字节测试约束）——不再永久豁免。
- verify_all 8 步全 PASS（tests/freeze/version/sha/dist/cruise-12场景门）。
- releaseCodeCommit `e136729`；恢复验证 `tools/closeout_restore_check.sh`：
  **无共享 alternates 的完整克隆**（--no-hardlinks）检出到该确切提交，隔离证明
  （无 alternates 文件、无源路径引用）、LFS 实物+哨兵魔数+**225 原始件与基线字节一致**、
  npm ci/构建/56 测试/12 场景浏览器门在克隆内全部重跑 PASS。
  范围口径：同机新目录恢复；不声称 W2 已测或离线新环境已验证。恢复目录保留于
  `/home/baibai/outbox/pawborough-world-closeout-night-20260919/restore/`。

## 视频状态（截至本交付书生成）

- clipA-full.status.json 尚未落盘（渲染/守望仍在合法窗口内，帧数持续增长，库存量见 video-receipt.json）。
  本批以可中断轮询等待真实终态至原 cutoff 之后；若守望在会话窗口内落盘即自动复制校验
  （`node tools/closeout_video_receipt.mjs` 可随时补跑）；若未落盘，如实记 pending blocker——
  **不写 full-complete，不把静止帧数当完成，不自动续渲**。

## 残留与下一步

1. clipA 终态：守望落盘后补跑收据（一条命令），或交由机主在源工作区查看 `clipA-full.status.json`。
2. 街道 v3 两条 cm 遗留（过期 westshops cm / 超容差 lions cm）——需机主授权改 `world/fangbang-temple-v3/**`；
   修复链（rebuild+registry 门清单再生成）已就绪。
3. 交付包：`/home/baibai/outbox/pawborough-world-closeout-night-20260919/workspace/artifacts/world-closeout/package/`
   （管理正本仍在 W2；本目录为 S1 outbox 交接包）。

停止：R 完成。未合并、未 push、未发布、未启动任何新夜班/自动任务；未删除任何文件/目录（全部保留产物已列明）。
