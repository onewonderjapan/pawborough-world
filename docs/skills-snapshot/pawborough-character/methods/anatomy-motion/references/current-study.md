# 当前实测入口

日期：2026-09-11。研究包：`/home/baibai/outbox/pawborough-tripo-official-route-20260911/learning-run`。

- 机主授权上限 300 积分；已完成 4 个形体样本、1 次重拓扑、1 次四足绑定、1 个步行动作、免费绑骨检查。实际消耗 245；见 `LEDGER.json`。
- 原始任务文件：`generated/tripo-out/`；输入图在上一层 `inputs/`。来源模型为 Tripo 官方 v3.1，图像由本会话内置 image_gen 制作，非 Google Imagen。
- 研究预览：`http://localhost:5256/`，源文件 `review/`。地址可能离线，先检查实际服务器状态。
- 四样本信息：`analysis/FOUR_MODELS.json`；材质对照：`analysis/A-material-ablation/`。
- 原始自动动作问题：`analysis/WALK_DIAGNOSIS.json`。其中最早按固定坐标四分脚区的采样有一组为空，后续使用实际足端骨骼轨迹和脚掌聚类，不能把旧脚区标签当成真实左右判断。
- 站姿对齐：`analysis/PAW_ALIGNMENT.json`。中性网格与完整本地骨架：`motion-repair/neutral-standing.blend`、`neutral-bound.blend`。
- 本地步行修正版：`motion-repair/local-corrected-walk.blend`、`.glb`；过程与测量：`MOTION_REPAIR.json`、`EXPORTED_WALK_CHECK.json`。
- 本轮形体修复代码：`scripts/build_neutral_rig.py`、`bake_repaired_walk.py`；代码中的坐标仅为这个样本适配，换猫应重新测量。
- 独立体块制作实验：`local-reconstruction/` 与 `local-reconstruction-v2/`。没有导入 Tripo 或第三方顶点，但这不代表其审美达到参考；看实际图再使用。
- 开放模型参照：`/home/baibai/outbox/pawborough-open-cat-model-search-20260911`。Bicolor Cat/Toon Cat FREE 为 CC BY 4.0，Quaternius Cat 为 CC0。保留模型自己的署名，不套用 demo 仓库许可证。

本轮重拓扑的实际 FBX 含 9,512 个四边面和 1,269 个三角面，未精确达到请求的 8,000 面。局部拆解有价值，不能称全四边面或手工拓扑。

参考原则：
- Blender 重网格与重拓扑：https://docs.blender.org/manual/en/dev/modeling/meshes/retopology.html
- 猫科解剖补充：https://pressbooks.umn.edu/dogcatanatomylabguide/back-matter/appendix/

未来只读分析、本地编辑与任何付费任务分别按当前用户请求处理。本文件不延续已结束批次的积分授权。

机主后续反馈“这个我看上去挺好”：A 本地步行修正版已作为当前形体/步行基准留档，见研究包 `baseline/A-local-walk-owner-approved/OWNER_APPROVAL.json`。新角色仍按新样本审查。图片驱动的 GLM 实作试验见 `../../pawborough-image-to-cat/SKILL.md`。
