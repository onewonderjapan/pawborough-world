# 社区 Three.js Skill 补充调查

调查日期：2026-10-03。限读 1 个社区 Skill 仓库及其两份真实 `SKILL.md`、LICENSE 和仓库 README；没有安装、拷贝或运行任何内容。

## 结论

发现一个值得“按需阅读、暂不安装”的社区候选：[Majid Manzarpour 的 Three.js Game Skills](https://github.com/majidmanzarpour/threejs-game-skills)。其中 `threejs-gameplay-systems` 给出 plain Three.js 的玩法增量、输入/相机/物理边界；`threejs-aaa-graphics-builder` 给出模型、材质、灯光、LOD、动画检查及性能预算流程。它对后续玩法或美术大改有参考价值，但对现有 Pawborough 的边际收益有限：项目专用 Skills 已有更细的相机/骑车/碰撞契约；OpenAI Game Studio 已覆盖浏览器试玩、vanilla Three.js 和 GLB 资产管线。

**建议级别：可参考但暂不安装。** 只在后续具体工单需要玩法手感/镜头节奏或较大美术升级时挑对应段落阅读。不要安装整套 director 或把空项目脚手架复制进现仓。

## 核对对象

**threejs-gameplay-systems** — [上游真实 SKILL.md](https://raw.githubusercontent.com/majidmanzarpour/threejs-game-skills/main/skills/threejs-gameplay-systems/SKILL.md)。维护者：Majid Manzarpour（仓库 README）。许可证：仓库 [LICENSE](https://github.com/majidmanzarpour/threejs-game-skills/blob/main/LICENSE) 明示 MIT，Copyright 2026 Majid Manzarpour。

- **plain Three.js：适配。** Skill 说明使用 Three.js modules、官方 `three/addons/...`、Vite；物理需要真实仿真时默认 Rapier。其方向与 imperative Three.js 接近，但示例工程使用 TypeScript + Vite，Pawborough 现有 JS 仓不应为此改语言或结构。
- **交互/相机/碰撞：有内容。** 明列 input、camera、collision、physics、vehicles 和 character controller 场景；要求确定更新次序与状态所有权，针对大改建立玩法 brief / loop contract / encounter plan；窄机制修复则沿用现有设计。实现按可玩小步推进，并在目标镜头尺度下验证代表场景。
- **阶段方法：有用但要缩小使用。** “小步可玩、先一个代表场景、后扩展内容”适合 Pawborough 的现有阶段节奏。三份设计工件只针对 broad creation/substantial design change；微小改动沿现有文档，这一点与当前项目边界相符。
- **GLB：此 Skill 本身未给出 loader/压缩契约。** README 说明套件另有 3D generator、asset/QA 专家 Skill，但本次没有读它们，所以不据此宣称 GLB 支持细节已通过审查。应继续使用已装 `web-3d-asset-pipeline` 和 Pawborough 资产契约。
- **代价/风险：** 若从空目录开始，Skill 引导运行脚手架生成命令；README 说明 `--force` 会覆盖与脚手架重名文件。套件另包含 Tripo、Gemini、ElevenLabs 的可选付费 API 工作流，需凭据；当前任务不需要也不授权调用。仓库面向“高质完整浏览器游戏”的部分流程可能把 Pawborough 小型材质/互动增量扩成不必要的设计文档或验收清单。

**threejs-aaa-graphics-builder** — [上游真实 SKILL.md](https://raw.githubusercontent.com/majidmanzarpour/threejs-game-skills/main/skills/threejs-aaa-graphics-builder/SKILL.md)。维护者与 MIT 许可证同上。

- **材质/灯光：较高适配。** 顺序是先构造有作者意图的模型，再处理材质，再做灯光与效果；要求先从真实 active-play 截图识别弱项，针对需改变的范围加载参考资料，不以 glow 替代形体。
- **性能/渲染：有明确意识。** 引用 technical art budgets、材质库、VFX、instancing/LOD、导入资产清理、shader 和 post-processing；要求升级后用量化指标复评分。
- **动画：有目检要求。** 动态模型要在实际玩法画面查看 locomotion、blend transitions、脚接触、受击时机和 secondary motion。
- **边界：不等于 Pawborough 的验收契约。** 其 visual scorecard 的高级档位和“每类达到门槛”的升级流程可能比用户当前定的局部检查过重。仓库自己的截图打分工具没有在本轮试跑，指标有效性与 Three.js r180 兼容均未确认。

## 维护证据与成熟度边界

仓库 README 当前列出 9 个职责分开的 Skill、脚本/参考资料，以及 5 个可试玩 demo 页面；README 声称包含 Vite + TypeScript + Three.js scaffold、Playwright smoke/visual regression/bot playtest templates。GitHub 仓库页面显示 11 commits，另列 2 issues 和 3 pull requests。LICENSE 是标准 MIT 文本。

这些是可见的交付证据，不是独立质量评估：仓库页面没有展示发布版本或 CI 通过记录；精确最新提交时间本次未确认，demo 未逐个试玩，脚手架测试也未运行。这里不以 stars 数量判断成熟度。README 的“production-grade / AAA”等描述属于作者自述。

## 与已装 Skill 的关系

| 需要 | 现有优先依据 | 社区候选增加的内容 |
|---|---|---|
| 浏览器试玩、真实截图和问题复现 | `game-playtest` | QA-release README 声称有 canvas pixel 和 bot playtest 模板；尚未读/试 QA-release Skill，暂不计作已核实流程 |
| plain Three + GLB/贴图压缩/LOD | `three-webgl-game` + `web-3d-asset-pipeline` | gameplay skill侧重游戏设计/镜头/手感；这次读到的两个 Skill 没有更完整 GLB loader 合约 |
| 相机/骑车/碰撞事实 | `/home/baibai/.codex/skills/pawborough-game-client/SKILL.md` | 更通用的游戏手感语言；不能代替项目已有米制/路线/碰撞与相机行为契约 |
| 建筑材质、贴图和真实导出 | `/home/baibai/.codex/skills/pawborough-static-architecture/SKILL.md` 及 `/home/baibai/.agents/skills/3d-asset-reuse/SKILL.md` | 形体→材质→光照→效果的视觉升级次序、动画试玩观察表 |

## 可验证的小试验

下一次确有镜头/玩法手感变更时，选现有单一路线只调一个变量（例如镜头跟随响应或自行车转向）；保持速度/输入、Rapier碰撞、相机起点和浏览器视口固定，沿项目既有 Playwright 路线留同条件截图与录像。使用本 Skill 的小步迭代提示，但仍用 Pawborough 专用检查作通过依据。若能减少复现歧义且不增加重复工件，才考虑把某个方法摘入项目专用 Skill；本研究不代替那次实测。

## 已核实来源

- [仓库 README](https://github.com/majidmanzarpour/threejs-game-skills)：用途、套件构成、9 个 Skill、公开 demo、credential/API/安装范围、脚手架与检查说明。
- [threejs-gameplay-systems SKILL.md](https://raw.githubusercontent.com/majidmanzarpour/threejs-game-skills/main/skills/threejs-gameplay-systems/SKILL.md)：玩法/相机/输入/物理/增量约束。
- [threejs-aaa-graphics-builder SKILL.md](https://raw.githubusercontent.com/majidmanzarpour/threejs-game-skills/main/skills/threejs-aaa-graphics-builder/SKILL.md)：视觉升级、材质/灯光/LOD/性能和动画检查。
- [LICENSE](https://github.com/majidmanzarpour/threejs-game-skills/blob/main/LICENSE)：MIT License / © 2026 Majid Manzarpour。
