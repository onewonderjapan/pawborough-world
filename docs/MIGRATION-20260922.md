# 2026-09-22：本地业务工作区接续

Pawborough 继续维护于 `onewonderjapan/pawborough-world`。相邻的 `default-workspace` 只提供共享流程；本次没有把业务代码、媒体或个人配置移入共享仓。

## 入口

- 原 Three.js/Rapier 客户端：仓库根，`npm ci && npm run build`；`npm run preview` 默认 localhost:5488。
- 豫园/城隍庙/商业街全域候选：`scene-authoring/yuyuan-area/`；运行 `npm --prefix scene-authoring/yuyuan-area ci`，再运行 `npm run area:serve`，默认 localhost:5486。`/review.html` 是补修对照，`/` 是需要 WebGL 的3D预览。
- 单体制作：`asset-authoring/shops/`、`asset-authoring/yuyuan-entry/`、`asset-authoring/snacks/`。
- 新目录不依赖旧夜班目录里的上级 AGENTS/PLAN；项目状态见 PROJECT.json，模块状态见各自入口。

## 已保留的来源

原业务基线 `3271494886710135c1a750f0b6cc54d6e7845bd8`。全域补修来源 `2cbfc878f3681a9ecd98a0160a5ef51f915e909d`，店屋来源 `c7c2ac44`。独立历史保存在本机的 `refs/archive/pre-migration/{world,area,shops}/` 和独立 Git bundle，未把不相关历史盲合到主线。

旧世界尾项逐项决定见 `migrations/20260922/INTEGRATION-DECISIONS.json`。已把可靠性批中准确的启动说明接入；恢复控制器本身已存在于当前基线。旧验证工具/证据保存在历史，不自动重启长测。clipA 如实保留 partial（7040/8781帧），收据见同目录 CLIPA-RECEIPT.json。

## 资产恢复

- 原世界的 LFS 私有对象遵循 `ASSET-MANIFEST.json` 与 `ASSET-RESTORE.md`。
- 新迁入资源、最终全域 GLB/Blend、豆类修件和对照图列在 `MIGRATION-ASSETS.json`。二进制仍是独立资产，不混入新源码提交；迁移不自动改变采用状态。
- `python3 -X utf8 tools/restore_migration_assets.py` 默认只显示清单。选择 `--all` 或 `--path` 后可从负责人提供的 `--cache` 恢复；显式 `--download --profile <个人已授权profile>` 才访问专用私有 S3。
- 本机已恢复全部原基线 LFS（9396唯一对象，对应10647路径）和297项迁入资产，并在另一目录从独立缓存逐项恢复校验。云端增量仍等待有效 SSO；不能把本地恢复说成云归档完成。

## 验证与边界

原客户端构建通过，闭包包含17场景及3个被场景引用的资产库；新门保持“引用文件缺失/未分类目录即失败”，并区分 previousFile 历史记录。20项会话/恢复测试和4项构建闭包测试通过。

全域101项几何测试、4项覆盖负例、切口测试与9项食品检查通过；在新路径复算商业通路通过。最终 GLB 字节与已审补修版本一致，重用该字节对应的4989条射线证据，不重发生成/渲染。当前应用内浏览器无法创建WebGL上下文，本次没有把静态页面、HTTP字节或离线图当成浏览器试玩通过。

旧目录、旧符号链接、旧预览与暂停的定时任务保留。仅新增新路径预览。两张历史参考图因OS读取权限未能做二次副本，原文件保留；它们不影响当前运行资源闭包。W2接收路径、其他编辑器未保存缓冲仍未确认。本次没有GitHub push、公开发布或旧目录清理。
