# 交付 · 方浜市声统一试玩首页 + 便携包（world-playable-night 20260920）

执行：ZCode GLM-5.3-Flash · 分支 `work/world-playable-night-20260920` · 基线 `68f10ea`
范围：只做入口/图库/便携包；**world/**、building/、kit/、物理与控制器核心零改动**（保护核验 locked 0 mismatch）。ownerAdopted=false，未合并/未push/未发布。

## 机主明早怎么看

1. 解压或直接用 `dist-world-playable/`（或 sha256 树等价的 `restore-world-playable/`）：
   `python3 start-world-playable.py`（127.0.0.1:5411，端口占用会明确报错，不会杀进程）。
2. 打开 `http://127.0.0.1:5411/world-preview.html` —— 首页第一屏即懂：标题、一句导语、真实街景宽幅图。
3. 四个出发点（主街 / A弄 / B弄 / 庙前）可点选、导览图可点击/键盘选；「开始探索」带 `?entry=` 直达所选锚点；「先看场景」看图库与修整前后对照。
4. 手动试玩顺序建议见 `artifacts/world-playable/REVIEW.md`（主街 → A弄往返 → B弄往返 → 庙前）。

## 通过项（本机 Chrome + SwiftShader 软件渲染，无硬件帧率宣称）

| 项 | 结果 |
| --- | --- |
| 首页冒烟（dev 与包内各一次） | 15/15：四入口、导览图、CTA 映射、全开选项仅附加 flags、图库、无绝对路径、1280/390 无横向溢出 |
| 入口衔接（dev 实载 entry=laneA） | ready · 巡游自检 PASS · 694430 三角 · 取景机位 lane-a-street-look-in · 显式定位计入 relocation 而非行走证据 |
| 包内四入口 | 26/26：每入口 ready + 自动巡游 PASS + relocation 记录；默认预算 694430 精确 |
| 全开配置 | ready + 巡游 PASS，预算 708066 精确（超 700k 目标 8,066，如实标注，不冒充默认） |
| 场景总览往返 / 图库 | 游戏页页头「场景总览」回首页；图库可直接进入 |
| 缺 WebGL 环境 | 游戏页出可操作面板（说明+折叠明细+重试+返回总览），首页/图库照常可用 |
| 便携性 | restore-world-playable（树哈希等价副本，自启动器，端口 5413）重跑四入口 26/26 |
| 测试 | 124 项：123 过，1 败 = 上游继承缺口 UP-G1（非本批引入，见下） |
| 保护清单 | 788 文件（锁定 785）：锁定区 0 漂移；fangbang.html / src/fangbangMain.js / vite.config.js 为计划允许的最小修改窗口 |

## 交付物路径

- 便携包：`dist-world-playable/`（133 文件）· ZIP：`artifacts/world-playable/delivery/world-playable-night-20260920.zip`
- ZIP SHA-256：`67ab5562ced3ca2a40a47cd1c21c3ffe93d0e237383225a69623bbb1fd9dd795`（收据在 ZIP 外：`delivery/package-zip-sha256.json`；包内 manifest 不含自身哈希）
- 包内闭包 154,315,745 字节，与上游已验证 dist-lane-b-polish 闭包字节数一致；不含 .blend/视频
- 证据：`artifacts/world-playable/{RESULT,PROGRESS,UPSTREAM-INHERIT}.json`、`package-run.json`、`restore-run.json`、`captures/`、`protection/protected-baseline.json`

## 未完成 / 缺口（如实）

1. **UP-G1（上游继承）**：上游 lane-b-polish 交付清单含两个 gitignore 的 `.blend1` 备份条目，对其已提交树验清单失败（真实负载全部字节相符）；`tests/lane-b-evidence.test.mjs` 12/13 同因。本批不代改上游证据，已在 `UPSTREAM-INHERIT.json` 精确登记，由机主/上游决定是否重出清单。
2. 全开预算 708,066 > 700,000 目标（维持上游结论，本批未改几何）。
3. 主街/庙源工程只有历史批次状态，未假称统一重打；包内无 Blender 源（留在工作区）。
4. 性能：验证环境仅 SwiftShader 软件渲染，页面不显示帧率；W2/Unity 未触及。

---

## 附记（2026-09-21，world-ten-hour 批）

上文是 20260920 批收口时的原始记录，保留不改。其后 PLAN §A 授权本 worktree
修复继承的 lane-b-polish 清单/生成器，**缺口 1（UP-G1）已解决**：

- 修正前原版清单/收据快照保留在 `artifacts/lane-b-polish/evidence-repair/previous/upg1-manifest/`（含修正原因 README）。
- 生成器改为 git 跟踪文件口径（`git ls-files`），备份文件一律排除；清单标明 `scopeKind: committed-source`；portable-payload（dist 闭包）保持独立构建校验口径。
- `delivery-manifest.json` 与外层收据已按新口径重新生成；提交树验证改为把 HEAD 导出到新目录（`git worktree add`，LFS 本地 smudge）后实际核验，含篡改/缺文件负例与"修正前快照必须仍失败"的反向证据。
- 上表"测试 123 过 1 败"为当时状态；该文件现于本 worktree 全绿（全套以最终集中跑为准）。
