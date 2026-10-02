# Pawborough 文档与目录导航

从 v1.0 交付和当前模块开始接手；历史材料保留用于查来源，不据此恢复任务、覆盖冻结输入或重算完成状态。

## 下一轮：整图美术与全国寻味

2026-10-02 机主要求准备长任务计划，换模型后执行。当前 **24 味 / 8 章本地候选已完成验收**；上一轮近景美术与公开站点状态见 [美术方向](ART-DIRECTION-20261002.md)。

- [24 味验收与交付](NATIONAL-SNACK-ATLAS-20261003.md)：实际证据、运行方法、资源恢复和后续状态。
- [换模型启动交接](LONG-RUN-HANDOFF-20261002.md)：真实基线、阅读顺序、可复制启动指令。
- [产品与美术规格](superpowers/specs/2026-10-02-national-snack-atlas-design.md)：24 味/8 章、全图分布、图鉴、四类动作、旧档与性能边界。
- [长任务实施计划](superpowers/plans/2026-10-02-world-art-snack-atlas.md)：M00–M14 按 6→12→24 交付本地完整候选；后续发布和其他四只角色另列。
- [食品候选表](plans/national-snacks-20261002/content-candidates.json) / [任务状态](plans/national-snacks-20261002/task-state.json)：全部 24 味模型与缩略图已采用；24 点实际互动、连续路线与旧档兼容已验收。

## 当前交付

| 需要确认的事项 | 入口 |
| --- | --- |
| 本版能力、验收范围和 v1.1 技术待办 | [V1-RELEASE.md](V1-RELEASE.md) |
| 构建源、首载口径、资产数量与控制层 | [VERSION-v1.json](../VERSION-v1.json) |
| 项目模块、范围与发布标签 | [PROJECT.json](../PROJECT.json) |
| 接手顺序与当前命令 | [CLAUDE_HANDOFF.md](../CLAUDE_HANDOFF.md) |
| v1.0 范围决定 | [V1-REDEFINITION-20260923.md](V1-REDEFINITION-20260923.md) |
| 入口状态生成、W2 查看及证据限制 | [CANDIDATE-HANDOFF.zh-CN.md](CANDIDATE-HANDOFF.zh-CN.md) |
| W2 已实测性能与测试条件 | [perf/W2-RESULTS-20260930.md](perf/W2-RESULTS-20260930.md) |

`VERSION-v1.json` 与 `V1-RELEASE.md` 表示本版。根目录 `VERSION.json` / `DELIVERY.md` 表示 2026-09-19 街段版；历史路线图快照不能覆盖后来确认的 v1.0 范围。

## 机主决定

- [v1.0 主体范围](OWNER_DECISION-v1-redefinition.json)
- [湖心亭和大假山采用及九曲桥返修](OWNER_DECISION-landmarks-20260930.json)
- [W2 自动巡游代替亲手步行](OWNER_DECISION-w2walk-20260930.json)
- [修改后的九曲桥采用](OWNER_DECISION-jiuqu-20261001.json)

角色与完整玩法不在封存的 v1.0 内。后续已按机主选择接入直立灰猫、骑行和三味逛吃；当前公开试玩与新一轮规划分别记录在 PROJECT.json 的 development 和 planning，不能用历史 v1.0 范围否定已确认的新工作。

## 资产与工具

| 内容 | 入口与边界 |
| --- | --- |
| 资产恢复 | [ASSET-RESTORE.md](ASSET-RESTORE.md)，仅使用已获授权的身份 |
| 当前迁入输入与云回执引用 | [MIGRATION-ASSETS.json](MIGRATION-ASSETS.json) |
| 原街段历史 LFS 清单 | [ASSET-MANIFEST.json](ASSET-MANIFEST.json)，不等同迁入清单 |
| 历史便携包恢复 | [PORTABLE-RESTORE.md](PORTABLE-RESTORE.md)，按对应包版本使用 |
| 单体制作源 | [asset-authoring/README.md](../asset-authoring/README.md) |
| 全域制作与预览 | [scene-authoring/yuyuan-area/README.md](../scene-authoring/yuyuan-area/README.md) |
| 第三方许可与来源 | [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) |

当前全域命令为 `area:rebuild` / `area:verify` / `area:serve`，验证和预览显式设置 `OUT_DIR=out-zone`。根目录 `tools/verify_all.sh` 与 `tools/make_version.mjs` 属于街段版本流程，不作为全域 v1.0 默认验收入口。根目录旧冻结契约的三条已知失败见交付书第 6 节，不擅自放宽或重新盖章。

## 历史材料

- [2026-09-22 迁移说明](MIGRATION-20260922.md)：来源、模块搬迁与当时的验证。
- [2026-09-27 整合收据](handoff-20260927/CONSOLIDATION.json)、[当时工作区清单](handoff-20260927/WORKTREE_INDEX.md)、[推进明细](handoff-20260927/PROGRESS_FACTS.md)：旧候选版的整合证据。
- [历史路线图快照](ROADMAP.snapshot.md)及[早期机主决定快照](OWNER_DECISION.snapshot.json)：只作历史查证。
- `migrations/`：按日期留存资产归档与迁移回执，不覆盖旧收据。
- `skills-snapshot/`：可复现的只读技能快照，不是第二份可编辑规则正本。
- 根仓 `artifacts/`：历史施工、测量和验收记录，已有 LFS 指针仍保留；新图片、模型和渲染产物走独立交付目录与资产清单。

## 目录整理边界

全域代码在 `scene-authoring/`，单体制作在 `asset-authoring/`，原街段客户端与来源在 `src/`、`world/`、`building/`、`kit/`。这些目录仍有管线和清单引用，不能仅按文件年代移动或删除。依赖、生成输出和本机运行目录由 `.gitignore` 管理，忽略规则不会移除已经跟踪的历史文件。

2026-10-01 整理仅更新入口、导航与状态说明，保留目录和冻结记录；没有重新构建、部署或删除资产。

- [灰猫游玩反馈补修](PLAY-FEEDBACK-20261001.md)：倒车、骑姿、Esc镜头与封闭门面的验证和恢复。

- [2026-10-02 小吃摊碰撞与手持修复](SNACK-FEEDBACK-20261002.md)
- [独立 CloudFront 试玩发布](CLOUDFRONT-TRIAL.md)

- [Gemini 独立试玩与地面防陷修复](GEMINI-PLAYTEST-20261002.md)
