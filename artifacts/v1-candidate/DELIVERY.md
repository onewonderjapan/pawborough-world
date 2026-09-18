# C 包交付 — v1.0 候选包（C0–C6），停在机主决策门

批次：pawborough-v1-candidate-night-20260918 · 状态：delivered_stopped_at_owner_gate · ownerAdopted 全部 false

本批连做三包（A 主街可见面全量外皮 → B 西延带 17 占位升级 → C v1.0 候选包），C6 交付后按纪律停止。GATE.md 十项决策原样附在本文件末尾——施工者未进入其中任何一项。

## C 包交付物

| 项 | 交付 | 状态 |
| --- | --- | --- |
| 入口 | `index-v1.html`：页面/数据集/机位/ownerAdopted 原样（与 VERSION.json 同源生成） | ✓ |
| 版本清单 | `VERSION.json`：head、world/** 287 文件 + building/** 62 文件逐件 sha256、12 数据集摘要、工具版本、39 项测试清单 | ✓ |
| 一条命令 | `tools/verify_all.sh`：install → 39 测试 → sha 对账 → dist 构建 → 双 preview headless 巡航；首跑 8/8 绿 | ✓ |
| 视频源 | `kit/out/scene-v1/scene-v1.blend`：v3 全实例 + skins + 打包贴图 + 26 机位；重开缺图=0 / 机位=26；CPU 24spp：aerial 30.7s、shanmen-from-road 23.6s、court2-pair 8.7s | ✓ |
| 压缩变体 | `tools/build_compressed_dist.mjs` → `dist-compressed/`（?compressed=1）：185 GLB 全压 0 失败，314.4MB→168.8MB（0.537 ≤ 0.6）；实测传输 167.5→111.3MB（−33.6%），双态 routeCheck 全过 | ✓ |
| 恢复检查 | `tools/restore_check.sh`：clone → git lfs pull → 新环境 verify_all 全绿 | ✓ |

证据：`webgl/index-v1-hub.png`（入口页实测截图）、`blender/scene-v1-{aerial,shanmen-from-road,court2-pair}-cpu.png`；报告 `verify-report.json` / `restore-report.json` / `compressed-report.json` / `video-source-report.json`。

## 施工中发现与处理（如实）

- **git LFS**：仓库 GLB 走 LFS。restore 的 `--shared` clone 拿到指针桩 → restore_check 现在先 `git lfs pull` 并做魔数哨兵校验（`building/plain-v1/model.glb` 必须是 `glTF`）。
- **gltfpack -kn 结构副作用**：量化迫使 gltfpack 把 mesh 挂到无名去量化子节点上，破坏页面按节点名抽取可行走地面的契约。地面命名 GLB（street-kit__/sctail__/laneb__/temple-ground__ 前缀检测）改用 `-vpf -vt14`（浮点位置，mesh 直挂命名节点，−75% 依旧成立）。
- **量化塌缩**：压缩后 28/567,764（≈0.005%）退化三角形被塌缩。压缩态完整性检查放 0.1% 容差（fangbangMain，允许改动文件），超限照常报错。
- **dist/ 是 gitignore 的构建产物**（先前误判为已提交产物）：verify_all 负责重建并补齐 world/building；vite preview 对缺失路径返回 SPA fallback（HTML 当 JSON），故新数据集日常验证走 dev server（本批 5304；5302 被既有进程占用按 fallback #8）。
- **GPU**：NVIDIA GB10 检查时占用 96%（忙）→ 按 spec『GPU 空闲则再渲』跳过 CUDA 对比，CPU 计时为准。

## A/B 包要点（此前各自提交）

- **A（f4fdec0）**：119 可见面→去重 52 墙→21 外皮实例（10 M 冻结件 sha 不变 + 11 A 共享皮）；41 面 party-wall/blocked 按 fallback #2 跳过并逐条记因；`?skins=1` 共享 GLB 逐面 clone。
- **B（e3b7f64）**：西延带 17 占位 → 冻结模块实例（category→module，只引用 building/），前线落位+切向移位+3 条院墙 strip；blocks.json replacedBy 一键回滚；westShopsBlock 188,706 / 180,000（超 4.8%，如实记录）；v2 页面行为原样。

## 端口备忘

v3 验证 dev 5304（5302 占用走 fallback）；verify preview 默认 5306/5307（`PREVIEW_PORT_A/B` 可覆盖）；compressed 预览 5308；restore clone 内 5316/5317。既有 5284–5301 只读未动。

## VERSION 说明

VERSION.json 的 head 字段为本内容定稿提交（C6 内容提交）；其后的“版本清单提交”仅含 VERSION.json / index-v1.html 自身刷新，避免自引用悖论。

---

# GATE — C 包交付后停止，以下每一项都要机主裁决（施工者不得自行进入）

| # | 决策 | 选项 | 影响 |
| --- | --- | --- | --- |
| G1 | **视觉采用**：九批（街道 13 模块、东端、130–133、山门、入口组、大殿、桥接、庙扩展、西延带升级）逐批 ownerAdopted | 采用 / 返修（指出机位）/ 否决（lifecycle revoke） | 决定 v1.0 候选包最终内容 |
| G2 | **玄扈台形制**：G25–G28 四张零证据研究图选一或全否 | 选 A/B/C/D + 修改意见 / 暂不建（v1.0 只留前庭） | 选定后主控冻结 DESIGN_SPEC，再开夜批 |
| G3 | **照壁**：是否建在方浜路对面（需跨路占地 + 路南占位处理） | 建 / 不建 / 改为山门旁短照壁 | 影响桥接世界路南 |
| G4 | **西延带升级**（B 包）：是否保留 category→module 映射结果 | 保留 / 改映射 / 回到灰盒 | revoke 一键可回 |
| G5 | **东延带**：街尾 133 以东占位是否也升级（同 B 包规则） | 做 / 不做 | 新夜批 |
| G6 | **压缩变体**：v1.0 候选默认用原始还是压缩 dist | 原始 / 压缩（若报告通过） | 影响加载体验与解码器依赖 |
| G7 | **v1.0 封版范围**：是否把三进院+城隍殿、戏楼计入 v1.0（还是留 v1.1） | 计入 / 留 | 影响 VERSION 与入口页 |
| G8 | **合并与软链**：合并 `work/v1-candidate-20260918` 到 main；`~/pawborough-world` 改指 main 工作区；停旧 5284–5301 服务 | 执行 / 缓 | 主控无权限执行 |
| G9 | **Unity U0 一次性导入检查**（W2 上） | 做 / 跳过 | 路线图保留项 |
| G10 | **外部工程审查回执**（ChatGPT，基于 81a68d3）是否等待 | 等 / 不等 | 若有 P1 另派小修 |
