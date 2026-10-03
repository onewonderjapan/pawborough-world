# Pawborough 技术 Skill 调查

调查日期：2026-10-03（Asia/Tokyo）
范围：浏览器试玩与问题记录、Three.js/Rapier 操控参考、GLB/纹理/渲染性能、阶段式升级。只研究，不安装、不修改产品或 Skill。

## 结论

当前最值得继续使用的是本机已安装的 OpenAI Game Studio 三项 Skill：`game-playtest`、`three-webgl-game`、`web-3d-asset-pipeline`。它们对浏览器截图试玩、plain Three.js + Rapier + GLB 和资产交付流程有明确步骤，并且仓库源码与本机缓存都可读。当前项目已经用上 Playwright、Three.js、Rapier、GLTFLoader、Meshopt、KTX2/Basis，因此属于对已定栈的工作流补充，不构成引擎迁移理由。

这些通用 Skill 没有 Pawborough 的骑车控制器、相机跟随参数、门洞碰撞契约或本地验证命令。此类工作优先遵循仓库已有的 `pawborough-game-client` 与 `pawborough-static-architecture`；Rapier 官方指南用于 API 核对。阶段式升级方面，`web-game-foundations` 可按需查阅其“模拟状态/渲染/UI”分层思想；项目现有 PROJECT.json、路线文档和 handoff 已经给出足够的阶段边界，无需另添一套总控框架。

## 候选与建议

| 候选 | 来源、维护者、许可 | 适配与成熟证据 | 代价与建议 |
|---|---|---|---|
| **game-playtest（已安装）** | [可读 SKILL.md](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/game-playtest/SKILL.md)；维护者 OpenAI；Game Studio 插件清单标 MIT。 | 明确要求真实启动、执行玩家主要操作、截取代表状态、分开查 UI 与 WebGL 画面、按严重度给复现步骤。其 3D 检查项覆盖相机复位、WebGL context loss、材质灯光、GLB/贴图卡顿、碰撞代理和性能悬崖。仓库同时提供 playtest checklist 和 WebGL 调试参考；本机已有 Playwright 1.63.0，几乎无运行代价。 | 不生成测试脚本或 Pawborough 路线；检查范围需绑定到这次工单。**建议：后续真实浏览器试玩任务直接使用；复用现有 Playwright，不另装工具。** |
| **three-webgl-game（已安装）** | [可读 SKILL.md](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/three-webgl-game/SKILL.md)；维护者 OpenAI；Game Studio 插件清单标 MIT。 | 其目标技术栈就是 imperative Three.js、Vite、GLB、Rapier、KTX2/Meshopt、DOM HUD 和低层 WebGL 调试；也强调模拟状态独立于 Three 对象、相机边界明确、资源释放与成本测量。与当前客户端结构高度相符。 | 主要面向 runtime 新功能/结构设计；推荐目录形状可能比当前仓库更模块化，不应据此搬家或重写。它没有 Pawborough 的骑行手感、路线、玩家尺度和相机标定值。**建议：仅在新增/调整一个运行时子系统时按需查阅。** |
| **web-3d-asset-pipeline（已安装）** | [可读 SKILL.md](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/web-3d-asset-pipeline/SKILL.md)；维护者 OpenAI；Game Studio 插件清单标 MIT。 | 清晰区分资产制作与 runtime，覆盖 Blender → glTF/GLB → glTF Transform → 命名/轴心/尺度/材质预算/碰撞/LOD → runtime 校验。推荐 Meshopt 和 KTX2/Basis，正好对应当前 MeshoptDecoder、KTX2/Basis 资源链。 | glTF Transform 是流程建议，不代表项目已安装或当前资产一定需要重压缩；会与仓库已有生成器、清单和检查脚本重叠。**建议：有新资产、压缩或传输预算决策时作为 checklist；先复用项目工具与已通过资产，不引入第二套流水线。** |
| **web-game-foundations（已安装；阶段参考）** | [可读 SKILL.md](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/web-game-foundations/SKILL.md)；维护者 OpenAI；Game Studio 插件清单标 MIT。 | 用于定义模拟/渲染/UI 的责任边界，并为多领域游戏任务作架构规划；官方 Game Studio 将它定位为共享架构路线。可供后续大型增量做小范围核对。 | 主要解决早期架构/引擎选择。Pawborough 栈、v1 范围和当前发布状态已经冻结，因此从头套完整流程会重复决策。**建议：参考具体边界，不将其作为每次补丁的强制前置。** |

> 许可证说明：MIT 来自上游 Game Studio 插件 `plugin.json` 的 license 字段（版本 0.1.2），不是单独为每个 `SKILL.md` 标注的许可。精确 Skill 文件最后修改时间、单项自动化评估成绩，本次没有核实；因此未把仓库热度或 star 数当质量证据。OpenAI 插件仓库概览显示截至 2026-09-16 有整体更新，说明仓库仍在维护，但不能替代逐文件变更记录。

## 项目内应保留的专用依据

- [pawborough-game-client](/home/baibai/.codex/skills/pawborough-game-client/SKILL.md)：当前项目的 Three.js/Rapier 客户端入口，明文要求 Rapier 校正后的唯一位移权威、镜头不直接驱动角色、相机/取景区分、路线/碰撞/摄像头交互复验、资源释放与实际性能证据。这是角色/车辆/相机变更的首选 Skill。
- [pawborough-static-architecture](/home/baibai/.codex/skills/pawborough-static-architecture/SKILL.md)：有本项目米制轴向、门洞与碰撞关系、材质/GLB 导出后检验、真实浏览器图与离线渲染区分等约束。
- [3d-asset-reuse](/home/baibai/.agents/skills/3d-asset-reuse/SKILL.md)：要求先盘点已验收模型/材质，按用途和总集成成本判断复用或定制；不强迫外部采购或下载。

这些项目内文件不是公开候选，也未发现它们在本任务中存在可确认的独立开放许可证；作为组织内部工作依据使用即可。

## 官方技术参考（文档，不是 Skill）

- [Rapier JavaScript Character Controller](https://www.rapier.rs/docs/user_guides/javascript/character_controller/)：官方 API 指南，说明 Kinematic Character Controller 的移动校正、穿透恢复、台阶和斜坡配置。适合核对现有实现和做小型碰撞实验；它不提供完整骑车系统或 Pawborough 相机方案。
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)：官方文档列出 Meshopt、KTX2/BasisU 等扩展装配接口，也提醒 image bitmap 资源需要显式释放；与当前加载链相符。
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)：`renderer.info` 提供 draw calls、triangles、geometries、textures 计数；适用于阶段对比，但这些计数不能单独证明 FPS 或 GPU 时间。
- [glTF Transform](https://gltf-transform.dev/)：资产转换/优化工具文档。只在压缩或 GLB 资源整理需要时参考；它不是 Skill，也不证明运行时收益。
- [Khronos glTF 2.0 规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)：格式及扩展的权威来源。

## 阶段式升级建议

保持一轮只动一个可观察子系统，使用现有项目阶段记录：

1. **确定当前现场**：从 PROJECT.json 读取当前 stage、入口、资产 manifest、通过记录及待处理阶段；只核对本次改动相关的代码与验证证据。
2. **冻住一个小目标**：例“中心/小吃街/桥段的暖光与材质统一”，固定 GLB、相机、时间、分辨率及交互路线。不要同时改几何、光照和控制器。
3. **先留同条件基线**：同相机、同设备、同路线截取浏览器图；保存控制台错误、加载/帧时信息和 `renderer.info` 计数。几何离线截图应另标，不能替代真实 WebGL 试玩。
4. **只做局部候选**：一个区域或一个运行时动作为限，沿用项目现有数据契约、输入与输出目录；原始 GLB 只读，候选保持候选态。
5. **复验受影响范围**：用 `game-playtest` 的关键路径/截图方法，加仓库相关检查。确认几何、碰撞、存档和交互哪一项确实受影响；其余范围复用现有 PASS。
6. **对比并交接**：同视角 before/after，记录资源计数或时序变化及已知边界，候选状态、未验证点和下一步都写入现有 handoff；采用、公开部署或恢复定时任务仍沿项目门禁处理。

对当前阶段最小实验：选“中心—桥段”作为暖光/材质小样，只动材质参数与灯光，固定一条步行/骑行路线和一个 Playwright 浏览器视口；比较同机截图、控制台、draw calls/triangles/texture 数和实测帧间隔。遇到外观变化先看截图，遇到性能归因不明再用浏览器性能面板或 SpectorJS。该实验能同时验证 Skill 对材质可读性、性能测量及截图取证是否真能给 Pawborough 带来帮助，而不触碰已完成资产或全域结构。

## 来源时点和未核实项

- 本报告于 2026-10-03 浏览在线来源并阅读本机已安装缓存。
- Game Studio 本机插件版本为 0.1.2；上游清单同样显示 0.1.2、OpenAI、MIT。
- GitHub 的 Skill `SKILL.md` 页面及 Raw 当前版本均可读；仓库概览显示整体最近更新于 2026-09-16。单一 Skill 的最后提交时间本次无法从 GitHub commit-history 页面确认。
- 本机确认已有 Playwright、Vite、Three.js、Rapier、GLTFLoader/Meshopt/KTX2/Basis 路线。未检查 Playwright 当前配置是否覆盖各入口/各设备；该项需下一次针对性试跑验证。
- 未核对 Rapier 0.19.0 相对于线上“latest”页面的 API 变更；落地前应以锁定版本包内 API/示例及项目自身测试为准。
- 本轮没有运行项目构建/试玩，也没有安装工具或改变项目状态。

## 来源索引

- OpenAI Game Studio 插件清单（维护者、版本、MIT）：https://raw.githubusercontent.com/openai/plugins/main/plugins/game-studio/.codex-plugin/plugin.json
- OpenAI Plugins 仓库总体维护日期参考：https://github.com/openai/plugins
- OpenAI Game Studio Skills: `game-playtest`, `three-webgl-game`, `web-3d-asset-pipeline`, `web-game-foundations`（上文各 Skill 链接）
- Rapier、Three.js、glTF Transform、Khronos 规范（上文官方文档链接）
