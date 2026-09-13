# 项目入口与当前范围

先在本次工单指定工程根读取 PROJECT.json；已有工程时从当前目录向上定位，或读 /home/baibai/pawborough-world/PROJECT.json（该链接只是S1统一入口）。文件中的 projectId 必须为 pawborough-world。

读取 canonicalRoadmap、phase、runtime、assets、evidence 和 capabilities；端口、资产与当前工单路径都从这里取得，不使用历史Skill中的旧端口。没有PROJECT时，只能按明确的bootstrap工单建立它，不能回退到某个过时current-project.json继续施工。

当前机主决定是世界与取景版v1.0：V01–V10、P0–P6。角色后置G1；完整游戏M0–M7、Unity U0–U2为远期参考。Unity仅保留一次W2导入验证，不能阻挡S1的任何世界工单。原始决定由当前PROJECT.ownerDecision指向；建仓前为 /home/baibai/outbox/pawborough-repo-review-20260913/OWNER_DECISION.json。

S1只统一工程工作仓；W2的管理正本/评审权限没有迁移。代码Git版本、资产导出SHA清单、人工采用状态各有用途，不能互相替代。主控负责设计、Skill与审查，ZCode负责施工，夜班窗口读取当前工单而不是Skill里永久保留旧授权。

当前机主改为亲自调用ZCode：主控只准备设计、Skill和工单，不自动启动或定时复验。执行时读取PROJECT.implementation.executionPolicy；本轮无工时、截止、段数上限，不从历史文件恢复午夜窗口。技术上就绪的任务连续推进；缺主控设计的内容先记阻塞，不自行扩范围。
