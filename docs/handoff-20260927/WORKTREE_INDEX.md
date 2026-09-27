# Pawborough 分支与 worktree 合并索引 · 2026-09-27

所有下列分支 HEAD 均包含在 `601d42a27b0d3552a9800f328f6ea2e050153072`，已 fast-forward 到规范主仓 main；此表记录源码合并时刻，main 后续另有交接文档提交。原 worktree、分支和历史输出均保留。

完整合并前盘点（含 ignored 输出和未跟踪项）：`/home/baibai/outbox/pawborough-claude-handoff-20260927/INVENTORY_BEFORE.json`。没有 stashes，没有未提交源码；23 个未跟踪项是环境链接。当前需要的 372 输入和 90 运行文件已归主仓；未采用/失败/旧中间输出留原路径作证据，不装配。

|分支|源码 HEAD|保留 worktree 路径|已包含|
|---|---|---|---|
|`main`|`601d42a2`|[规范主仓](/home/baibai/work/onewonderjapan/pawborough-world)|是|
|`work/flash-facade-20260927`|`30991050`|[pawborough-flash-facade-20260927](/home/baibai/outbox/pawborough-flash-facade-20260927/workspace)|是|
|`work/goal-control-20260927`|`5dec3d37`|[pawborough-goal-control-20260927](/home/baibai/outbox/pawborough-goal-control-20260927/workspace)|是|
|`work/goal-delivery-20260927`|`a4c91ec4`|[pawborough-goal-delivery-20260927](/home/baibai/outbox/pawborough-goal-delivery-20260927/workspace)|是|
|`work/goal-entry-20260927`|`d60d7fe3`|[pawborough-goal-entry-20260927](/home/baibai/outbox/pawborough-goal-entry-20260927/workspace)|是|
|`work/goal-identity-20260927`|`e6e8dd85`|[pawborough-goal-identity-20260927](/home/baibai/outbox/pawborough-goal-identity-20260927/workspace)|是|
|`work/goal-integrate-20260927`|`601d42a2`|[pawborough-goal-integrate-20260927](/home/baibai/outbox/pawborough-goal-integrate-20260927/workspace)|是|
|`work/goal-restore-20260927`|`e028dddc`|[pawborough-goal-restore-20260927](/home/baibai/outbox/pawborough-goal-restore-20260927/workspace)|是|
|`work/goal-route-20260927`|`1546a18c`|[pawborough-goal-route-20260927](/home/baibai/outbox/pawborough-goal-route-20260927/workspace)|是|
|`work/night-bazaar-20260926`|`56b895fe`|[pawborough-night-bazaar-20260926](/home/baibai/outbox/pawborough-night-bazaar-20260926/workspace)|是|
|`work/night-integrate-20260926`|`1224b416`|[pawborough-night-integrate-20260926](/home/baibai/outbox/pawborough-night-integrate-20260926/workspace)|是|
|`work/night-smallfix-20260926`|`f5faecac`|[pawborough-night-smallfix-20260926](/home/baibai/outbox/pawborough-night-smallfix-20260926/workspace)|是|
|`work/sol-bridge-20260927`|`e04f26e4`|[pawborough-sol-bridge-20260927](/home/baibai/outbox/pawborough-sol-bridge-20260927/workspace)|是|
|`work/wave1-bazaar-refs-20260923`|`8a7d18d2`|[pawborough-wave1-bazaar-refs-20260923](/home/baibai/outbox/pawborough-wave1-bazaar-refs-20260923/workspace)|是|
|`work/wave1-fangbang-20260923`|`3db99ffd`|[pawborough-wave1-fangbang-20260923](/home/baibai/outbox/pawborough-wave1-fangbang-20260923/workspace)|是|
|`work/wave1-integrate-20260923`|`fefb6ee5`|[pawborough-wave1-integrate-20260923](/home/baibai/outbox/pawborough-wave1-integrate-20260923/workspace)|是|
|`work/wave1-paving-20260923`|`a1556c79`|[pawborough-wave1-paving-20260923](/home/baibai/outbox/pawborough-wave1-paving-20260923/workspace)|是|
|`work/wave1-tour-20260923`|`408c9279`|[pawborough-wave1-tour-20260923](/home/baibai/outbox/pawborough-wave1-tour-20260923/workspace)|是|
|`work/wave1-walk-20260923`|`5f1809a3`|[pawborough-wave1-walk-20260923](/home/baibai/outbox/pawborough-wave1-walk-20260923/workspace)|是|
|`work/wave1-walkr1-20260923`|`a36239c3`|[pawborough-wave1-walkr1-20260923](/home/baibai/outbox/pawborough-wave1-walkr1-20260923/workspace)|是|
|`work/wave8-bazaar-batch-glm-20260926`|`de1886d1`|[pawborough-wave8-bazaar-batch-glm-20260926](/home/baibai/outbox/pawborough-wave8-bazaar-batch-glm-20260926/workspace)|是|
|`work/wave8-smallqa-glm-20260926`|`1af8aa28`|[pawborough-wave8-smallqa-glm-20260926](/home/baibai/outbox/pawborough-wave8-smallqa-glm-20260926/workspace)|是|
|`work/wave9-outerpolish-20260926`|`c8262d82`|[pawborough-wave9-outerpolish-20260926](/home/baibai/outbox/pawborough-wave9-outerpolish-20260926/workspace)|是|
|`work/wave9-sharedtex-20260926`|`f44f1f61`|[pawborough-wave9-sharedtex-20260926](/home/baibai/outbox/pawborough-wave9-sharedtex-20260926/workspace)|是|
|`work/webgl-startup-20260927`|`601d42a2`|[pawborough-webgl-startup-20260927](/home/baibai/outbox/pawborough-webgl-startup-20260927/workspace)|是|
|`work/zone-split-20260923`|`28616b55`|[pawborough-zone-split-20260923](/home/baibai/outbox/pawborough-zone-split-20260923/workspace)|是|

## 远端引用

|引用|HEAD|已包含|
|---|---|---|
|`refs/remotes/origin/backup/pre-claude-20260921-201636`|`bb45ca6f`|是|
|`refs/remotes/origin/main`|`fefb6ee5`|是|
|`refs/remotes/origin/work/zone-split-20260923`|`28616b55`|是|

合并不等于清理授权。未删除/移动 worktree、未删分支、未 reset/stash/clean/prune，也未推送 main。
