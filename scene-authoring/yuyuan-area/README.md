# 全域候选制作与预览

本模块接续已交付G5布局与review-repair补修；不是重启旧Goal。

1. 从根仓 `docs/MIGRATION-ASSETS.json` 恢复 `out/`、`resources/`、图片及输入GLB。
2. `npm ci`。
3. `npm run server`（localhost:5486），打开 `/review.html` 看同机位离线对照，`/` 看全域3D。
4. `npm run verify` 检查现有输出。通路复算需要 `python3 -m pip install --target .python-deps -r requirements.txt`，再运行 `OUT_DIR=out python3 -X utf8 scripts/check-commercial-route.py`。

需要再次制作时，在新的outbox目录显式设置 `OUT_DIR` 后运行 `scripts/rebuild-review.sh`。`baseline/layout.json` 保留G5插槽终态；不要直接调用早期地图生成器并覆盖采用后的布局。原门楼及食品来源保持只读。生成不是迁移的前置，本次未重新生成模型或渲染。

源代码与锁定清单随仓库维护，生成物不重复提交。原始源SHA与迁移记录见根仓 docs/MIGRATION-20260922.md。候选未自动采用；当前全域路线证据不等于原客户端已完成地图合并。
