# 当前 GLM 实作试验

工作包 `/home/baibai/outbox/pawborough-image-to-cat-glm-20260911`。用户要求“做成skill让glm做做看”。主控已限定两条路线各一只，最多一轮针对可见问题的修订，无付费生成、无游戏/Unity/正典写入。

本次已读原模型提取 `analysis/TEACHER_MEASUREMENTS.json`，这是稀疏空间统计，不是完整顶点拷贝，也不是完整解剖分割。老师真实形体和四视图在 `teacher/`。`inputs/` 有 A/C 四视图和单猫输入。

机主认可记录：`/home/baibai/outbox/pawborough-tripo-official-route-20260911/learning-run/baseline/A-local-walk-owner-approved/OWNER_APPROVAL.json`。认可的是 A 形体/步行当前工作基准，不包括新试验结果。

路线一：`C-template`，在老师中性 A 底模上按 C 图片改比例，保留纹理作为变量控制。路线二：`A-independent`，只能依赖图片、稀疏测量、关节说明，使用新的连续网格构造，不读取老师几何/贴图。

失败基线：`analysis/previous-independent-failure.png/.py`，实际图有外贴眼球、独立球形肩膀、胯与身体接缝；该脚本不能原样再跑交差。

运行工具：
- Blender `/home/baibai/.local/bin/blender`，实测 4.5.1 LTS Release Candidate。
- Blender 内带 NumPy；系统 `python3` 没有 NumPy，不因此重装系统 Python。
- `scripts/render_review.py` 导入实际 GLB，用 Cycles CPU 六线程渲染四视图+灰模，不占其他生成队列。
- `scripts/inspect_asset.py` 读取实际资产统计，不等于审美判断。
- 浏览器 Three.js 库只读位置 `/home/baibai/outbox/pawborough-shanghai-map-night-20260909/workspace/node_modules/three/`。

GLM 运行在 ZCode 当前已配置 Coding Plan，派发记录在 `worker/`。只读研究 Skill 不会启动任务；具体清单与恢复以工作包 `TASK.md`、`STATUS.json` 和运行记录为准。

首轮 C r01 的实际问题见 `analysis/LEAD_REVIEW_C_R01.md`。后续经历中断/空结果和分步代码交付，过程已归档，当前没有待续跑 worker；具体结论以 `trial-results.md` 和试验包 RESULT.json 为准。

本轮已收尾：C r02 与 A-independent r01 均有实际模型/五视图，C 改型有进展但未采用，A 独立构造未达标。最终状态见试验包 RESULT.json 与 DELIVERY.md；长 worker 均已结束/停止，没有待执行的定期任务。最新结论见 trial-results.md。
