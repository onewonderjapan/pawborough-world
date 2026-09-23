# 全域场景制作

本模块继承已交付 G5 布局，并包含 review-repair 补修。baseline/ 是冻结输入，inputs/ 是底图与来源清单；resources/ 与 out/ 从根仓 docs/MIGRATION-ASSETS.json 恢复，均不提交生成二进制。

不要退回 src/layout.mjs 的早期 G3 默认状态而丢失 G5 插槽终态。npm run layout 使用 baseline/layout.json；实际再生用 scripts/rebuild-review.sh 并显式指定新的 OUT_DIR。通路验收必须使用最终 GLB 投影SHA和射线，不把source conflict当可通行。
