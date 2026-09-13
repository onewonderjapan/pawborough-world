---
name: pawborough-game-client
description: Integrate Pawborough world assets into a Three.js and Rapier exploration client, including collision, input, cameras, loading lifecycle and meaningful runtime checks. Read project scope before adding gameplay; world v1 does not require pet characters or Unity.
---

# Pawborough 世界客户端

先读 [项目入口](references/project-entry.md) 与 PROJECT.json。当前V01–V10/P0–P6为主线，角色及任务／阵营扩展不默认进入世界版。主控设计和复验，生产代码由ZCode依机主手动启动的当前工单连续执行。

## 先让已有世界真正可走

- 资产层输出GLB、instances、碰撞和route；客户端消费数据，不另写一套程序化房屋替代精修世界。第一步可加载已验收street-reviewed.glb保留18图共享；模块模式需另测纹理缓存，不能一开始恢复161纹理对象。
- GLTF模型是多网格／多材质层级，不能直接当一个InstancedMesh。先按ID组织普通clone共享资源，重复图元满足条件后再实例化。
- collision-world已有局部OBB时，用其旋转、中心和半尺寸生成静态碰撞；世界AABB只用于宽相筛选，不能把斜门洞封死。地面取自实际可行走面，不以覆盖全城的隐形平板掩盖缺地面。
- 先用普通胶囊或无可见身体巡游，不等待猫模型。米制尺度、脚底、胶囊半高、眼高及台阶须一致。当前旧猫控制器的尺寸是样本，不可照抄为人眼相机。
- 保留固定步长／单一位移权威；输入请求位移，由Rapier校正后回写角色与相机。相机不能自己改角色世界位置。路线指引或自动巡游必须走相同物理链，跳机位不作行走证据。

## 输入与相机

复用已存在且与猫身份无耦合的输入边沿、暂停／失焦清键原则；不要直接移植整个带伙伴和任务的main。正常WASD、视角、暂停，以及明确标识的取景模式即可。

预设相机经controls.update之后比对真实位置／target／FOV；支持平视与仰视，镜头不能被极角限制抬高。取景与行走切换要定义落点和碰撞校正，不把摆拍写成走到目标。保存截图对应当前资产哈希。

## 2D总图与3D数据一致性

总图驱动实例、编辑变换或做精修替换时，读取 [共享世界文档](references/shared-world-document.md)。2D、Three与Rapier消费同一份带稳定ID的布局；不要在三个系统分别维护可变坐标。该方法映射到N6，两区块先验证，不要求先做完整编辑器。

## 资源与性能

实例复用几何／材料／图像并有所有者；进入退出时释放实例私有资源，共享资源最后使用者释放。合成件和单体不重复加载两份房屋。异步结果晚到要校验generation，再激活或回收。

记录设备、画质、分辨率、实际renderer、真实帧间隔、加载与资源计数；没有连续渲染就不计算FPS。每帧CPU提交不是GPU完成。至少观察同路线往返后的资源平台，不能用其他项目的数据背书。

## 仅恢复游戏功能时才启用

GameSession与领域状态拥有伙伴、食物、据点和委托；UI／网格不另存权威状态。奖励有账本，旧档严格解析，调试传送不能通过到达门槛。旧玩法数据与行为fixtures可复用，TS不是自动变成C#。这些规则暂为G段，不作为世界浏览的依赖。

## 验证与交付

单元检查用真实加载／转换函数和针对性负例；浏览器主控检查从真实出生点走到节点、碰墙、过门槛、回到起点以及视角切换。工人离线模拟、自动巡游、主控键盘短测分别命名。产出、实机通过、机主采用分别记录。
