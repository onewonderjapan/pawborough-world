# 入口组交付指针 (N6)

完整交付产物在本任务包目录（仓库外）：
`/home/baibai/outbox/pawborough-temple-shanmen-20260915/artifacts/temple-entry/`
- RESULT.json — taskId=pawborough-temple-entry-next, status=delivered_for_lead_review,
  ownerAdopted=false, visualReview=pending_lead, budgets/tests/evidence/inferences
- DELIVERY.md — 主控看图入口与各阶段说明
- PROGRESS.json — N0–N6 分阶段记录（无中途等待主控）
- webgl/ blender/ shanmen-n1-webgl/ — 实拍与复渲证据副本

可复现链：kit/yimen.config.json + kit/build_yimen.py / kit/entry-court.config.json +
kit/build_entry_court.py / kit/build_temple_shanmen.py(N1) → scripts/build_temple_entry_world.mjs
→ world/temple-entry/ → temple-entry.html (5292/5293)。测试 20/20：
`for t in tests/*.test.mjs; do node $t; done`
