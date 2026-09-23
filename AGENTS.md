# Pawborough 业务工作区

先读 PROJECT.json 和 docs/MIGRATION-20260922.md，按实际模块工作：原漫游客户端在 src/，全域场景制作在 scene-authoring/yuyuan-area/，单体制作在 asset-authoring/。

- default-workspace 是相邻的共享流程入口，不是业务代码仓；本仓不依赖旧夜班目录里的上级 AGENTS/PLAN 文件。
- 已采用门楼与候选场景分别记录；迁移或测试通过不自动采用、发布或恢复旧定时任务。角色/Unity不作本次世界施工前置。
- 旧 outbox 目录、历史运行和 refs/archive/ 只用于追溯。当前输入资源从本仓清单恢复，不通过跨目录隐式依赖旧工作树。
- 模型/媒体的恢复和上传以 docs/MIGRATION-ASSETS.json 为准；生成物使用 outbox，原始资产保持只读。
- 变更后运行受影响模块的必要检查。原客户端 npm run build；全域 npm run area:verify。真实浏览器/几何/离线图的验证范围分别说明。
