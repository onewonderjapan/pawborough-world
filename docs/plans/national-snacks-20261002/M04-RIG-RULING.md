# M04 灰猫派生臂链施工裁决

状态：方法经主控与机主授权的 Astra 审查确认；**新绑定和自然拿勺/持筷尚未制作验收**。此裁决把 M04 拆成纯派生绑定、profile/道具驱动和实景验收，避免并发修改 avatar/install。

## 已实测的输入

- 原 GLB SHA `5f60f225f8c46515119007023268c95a0cb904363c830b580cce70c0ad613981`；原件仍为12骨、5个SkinnedMesh共用Skeleton。armL/R是spine下叶骨；+Y上、+Z前，右臂x<0。
- 肩 L=(.1914,.4274,.1278)、R=(-.1914,.4274,.1278)；固定真实爪样本质心 L=(.25727,.20768,.05567)、R=(-.25752,.20876,.05590)，肩掌长约.240/.239m。嘴中立质心约(0,.584,.294)，进食 clip 会使嘴明显上下动，不能冻结嘴点。
- 原始臂权≥.3的顶点只有59/66；现有骑姿补丁修了1946顶点。应先使用已验收planRideSkinFix，再固定cupPalmVertices IDs，再做原肩平滑，最后分臂链权重。不能在分权后再次用原肩平滑或按旧臂权重重选爪点。

## 冻结方案

1. 食品模式只让body使用派生geometry/Skeleton；另四个脸部mesh继续原Skeleton。追加armL_forearm/armL_wrist/armR_forearm/armR_wrist，索引12–15；原12骨对象、顺序和inverse-bind逐字保留。
2. 新骨相对父骨的rest矩阵C，其inverse-bind=`inverse(C) × parentInverseBind`。使用完整矩阵，不在动画/平移/转身后calculateInverses，不调用省略bindMatrix的mesh.bind。body原bindMatrix/bindMatrixInverse不改写。
3. 新关节由修复后固定爪顶点的bind空间位置确定；肘位于肩掌段.55，腕位于.93。新骨rest只在父臂坐标系添加偏移，保留原微小scale。绑定点不使用原始armSegments.tip代替真实爪点。
4. 四槽采用**保留非臂质量、按空槽决定硬/软分段**：合并同骨重复槽；按非零影响计槽，不静默丢微小权重；另一侧arm视为必须保留的非目标槽。非臂槽3个时原臂质量映射到一个臂段；非臂≤2时才平滑分到相邻两段。不得先总和再截断，不能增至5槽。焊接同位置顶点使用相同投影和分配规则。
5. 权重改动仅限已有目标臂影响且明确臂区；脸/尾/腿/臂区外保持原属性逐字不变。此处对照基底是同一份ride修复+肩平滑后的geometry，并非未经修复的原GLB。
6. 激活与归还同时检查body.geometry和body.skeleton的所有权；一项被其他owner接管时不能单方面恢复或释放。骑车前先归还原二者、复位新关节；派生geometry/Skeleton由同一handle申请/释放，原geometry/Skeleton/贴图不dispose。
7. profile可控制原肩旋转及新肘腕；保持肩位置与骨长不变。每帧从保存底姿施加绝对目标，不能与旧_applyCupArms累加。碗由托碗爪支承，工具独立跟另一爪，工具真实bite点贴嘴，不能靠整食品AABB代替入口证明。
8. 派生记录为runtimeOnly、算法版本与原SHA、16骨；原输入清单的SHA与skinJoints:12不改成新GLB已经采用。

## 必要验收

- 新关节rest：同基底逐顶点中立与idle/walk/eat多个相位在数值容差内；非零世界位置/yaw再测，原inverse-bind和bindMatrix不变。
- 四槽总质量、合法索引、焊接缝一致、受保护区逐字不变、固定爪IDs不重选。
- 四profile及勺/筷连续3.2秒；托底、入口、脸/眼/碗不交穿，暂停/取消不留弯腕，三视连续画面与真实接触分别记录。
- 食品→篮→骑车→下车→食品循环，原骑姿契约不变；申请归还重复不留骨/重复dispose。

硬分段可能让肘腕弯曲偏硬；只有实际连续画面失败时才转同网格同16骨的离线局部重绑/单个肘修形，不重做角色或缩减碗装范围。旧骑姿的整簇均值PASS不能改述为掌垫贴把PASS。

## 2026-10-03 measured pose correction

The first nominal target paths were unreachable with actual weighted paw samples. The source eat clip shoulder translations are retained, but the legacy single-hand overlay must be skipped for custom profiles. Wrapped bread now has width0.18m, support anchors±0.075m, exposed bite (0,.085,.030), pitch+.25; hold origin (0,mouthY-.20,mouthZ-.035). Skewer pitch+.65/roll-.06, hold origin(.01,mouthY-.18,mouthZ-.09) keeps the handle close to the body. Bowl bite tool direction normalizes(.70,.70,+.35), bringing its handle down and toward the body. Original .03m palm / .025m mouth / .004m stable bowl bounds remain unchanged.

CCD uses a per-joint effective pivot from actual weighted skin contributions; cached bind-space sums preserve non-arm mass and morph signature. Direct double-precision bone world/inverse matrices match per-vertex centroid below1e-7m. Astra measured maximum5.37e-9m centroid error and5.66e-9m effective pivot prediction error, nonzero position/yaw invariant. All32 source-GLB proxy frames pass; current maximum paw gap.01547m bowl at.8s. Container/wrapper/tool retain scale; edible consumption starts after contact phase. Runtime visual and food-to-bike acceptance still pending.
