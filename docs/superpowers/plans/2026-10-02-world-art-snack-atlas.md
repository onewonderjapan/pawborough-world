# Pawborough 整图美术与全国小吃图鉴实施计划

> **For agentic workers:** 使用 `superpowers:executing-plans` 逐任务实施；已有机主授权允许 ZCode/GLM 承担施工，是否并行按下文文件所有权决定。不要自动启动额外 reviewer。本文只准备计划，本次全部任务尚未执行。

**Goal:** 在既有地图完成毛绒电影感美术统一、24 味/8 章全国寻味与可持久保存的发现/品尝图鉴。

**Architecture:** 以独立食品注册表取代三味硬编码，GameState 保持唯一游戏状态，食物模型按需加载，图鉴只消费快照。材质与光照样板通过后推广全图，小摊车视觉/碰撞/顾客点同源；保存的收藏与世界位姿分开迁移。

**Tech Stack:** 已安装的 JavaScript ES modules、Three.js 0.180.0、Rapier 0.19.0、现有 Blender/Python 资产管线、Node 测试、真实浏览器 WebGL。沿用 DOM/CSS HUD，不引入 React/新游戏引擎。

**Spec:** [产品与美术规格](../specs/2026-10-02-national-snack-atlas-design.md)；[启动交接](../../LONG-RUN-HANDOFF-20261002.md)；[候选数据](../../plans/national-snacks-20261002/content-candidates.json)；[检查点](../../plans/national-snacks-20261002/task-state.json)。

## Global Constraints

- 首辑 24 味、8 章、每章 3 味；分批 6→12→24；所有原三味 ID 与收藏保留。
- 美术为“柔软、精致、温暖的毛绒上海小城”；原建筑身份、v1.0 标签和原始 GLB 不改写。
- 拿取半径 1.8m；发现 XZ≤8m、垂直差≤2m、无遮挡；默认吃食 3.2 秒，只有完成事件增加品尝集合。
- 动作 profile 固定为 cupped/wrapped/skewer/bowl，碗装必须真实托碗，汤/甜品用勺、面/粉类用筷，不用统一抬物进嘴替代。
- 运行注册表与制作候选表分离；未有资产、核实文案和可用 vendor 的食物不能激活为必需收藏。
- 图鉴 B/按钮打开，Esc 优先关闭，恢复先前暂停/骑行状态；不开 24 个 WebGL 预览。
- 新存档 key `pawborough.play.walk.v2`，旧 v1 保留；位姿过期不清空收藏。
- 食品模型稳定驻留≤8、下载并发≤2、暂态≤10、出生首批≤3；24 味新增模型≤24 MiB，缩略图≤2 MiB。
- 同条件 p95 帧时目标≤基线×1.2；只能用实测证据报告性能，软件渲染不能充当 GPU 验收。
- 生成资产先在 outbox；按清单采用，公开包无私有路径/凭证。文字 UTF-8 无 BOM、LF；Python `-X utf8`。
- 本轮 M00–M14 为本地完整候选；R01 发布另列但不增加审批层次，按已有明确授权执行。没有授权的付费/账号动作不得推断。

## Review Focus

1. 老玩家旧三味全齐、正手持或在车上刷新：收藏不丢、物品不复制、扩展后总数正确。M02/M08 覆盖。
2. 厚墙/跨水面附近触发发现、摊位站位全部失败：不能隔墙取食或把不可达食品列为必需目标。M06/M12 覆盖。
3. 骑行按 B→Esc、帮助嵌套、失焦后恢复：镜头不跳、车不自行冲出、吃食不偷跑。M07/M08 覆盖。
4. 弱网单模型失败、载入中离开/重开、缓存淘汰手持物：局部失败可恢复、资源只释放一次、集合不误完成。M01/M05/M14 覆盖。
5. 远景漂亮但手与碗穿模、材质克隆破坏合批、存档配额满：真实动作和性能/持久化分别验收。M02/M04/M09/M14 覆盖。

## 执行约定、路径与检查命令

`A` 在本文展开为 `scene-authoring/yuyuan-area`，`P` 展开为 `docs/plans/national-snacks-20261002`。这些是文档缩写，不是要求设成环境变量。文件列表中的“新增”都是计划路径；未在本次创建。

基线：`31bae61f002a7bf5e04aac2c82b526909b87e78b`，运行版本 `20261002-main-cc89c58e`。接手先核对当前 HEAD；规划文档提交领先于此基线是正常现象。已有测试入口：

```bash
# 在仓库根：玩法契约；只在变更范围需要时跑整组
npm --prefix scene-authoring/yuyuan-area run test:play
# 全域最终必要检查；不要每个材质微调都重跑
OUT_DIR=out-zone npm run area:verify
# 根客户端被改动或最终交付需要时
npm run build
# 全域服务：优先复用 5492，确认没有服务后才启动新实例
OUT_DIR=out-zone PORT=5492 npm run area:serve
```

每任务按“写必要行为回归→确认旧实现失败→实施→受影响检查→记录实景/产物→提交”进行；纯文案/色彩调整不写镜像测试。下面新增测试命令仅在对应文件创建后可执行。现有全域检查若有历史失败，先以同一基线小范围复现并记录；不擅自改阈值，不把历史问题掩盖成新增任务通过。

主控串行维护 `install.js`/`state.js`/`web/main.js` 和任务状态；其他工人不修改这些共享入口。可并行 M03 与 M01/M02；M04 与 M07 的独立文件；M09 与 M10/M11 的资产输出。接口变化先更新当前任务的契约，再通知依赖方；不并发提交到同一工作树。

## M00 — 确认基线、资源与可达区域

**依赖：** 无。**产出：** 下一步可直接施工的基线证据，而不是再写一份开放式路线图。

**Files:** 读取 `PROJECT.json`、`A/out-zone/layout.json`、`food-sockets.json`、`A/inputs/play-*.json`、`asset-authoring/snacks/DESIGN_SPEC.json`、`asset-authoring/snacks/tabletop/catalog.json`；修改 `P/content-candidates.json` 的核实字段；新增 `P/baseline.json`、`P/asset-reuse.json`、`P/route-candidates.json`。截图/原始性能数据写本轮 outbox。

**Interfaces:** 输入当前 Git/部署/布局；输出 `baseline{sourceHead,assetHashes,renderer,viewport,route,frameTimes,resourceCounts}`，资产条目 `{path,sha256,reuseRole,status}`，候选位置 `{vendorId,zone,sourceStallId,placementStatus,evidence}`。不把这些制作字段上传公开站点。

- [ ] 核对 Git/工作树/运行中的工人及 5492 服务；保留其他人的改动，复用有效进程。取既有 47 项证据，列出本轮受影响范围，不无条件全跑。
- [ ] 读取实际 43 摊位/86 挂点及 27 模型；确认候选 18 个 stallId 存在、原三味映射不变；将 6 个新点定位到真实可达平地的候选范围。
- [ ] 给候选 24 味各补一条官方/可靠一手来源和形态参考，核实地区表述。四条研究种子见规格；无可靠唯一源流时写“常见于”，不编历史。
- [ ] 在同设备真实浏览器记录三样板 day/dusk 机位、短走/骑路线、p50/p95 帧时、绘制/几何/纹理数、首载字节。不能创建 WebGL 时明确环境阻塞，不冒报实景。
- [ ] 明确可复用器皿与待做 21 味；记录资产 SHA 和预算基线。提交 `docs: freeze snack atlas execution baseline`，状态证据引用真实提交和 outbox 文件。

## M01 — 食品注册表与按目录驱动的状态

**依赖：** M00。**Files:** 新增 `A/web/play/catalog.js`、`A/inputs/food-catalog.json`、`A/inputs/play-vendors.json`、`A/inputs/food-pose-profiles.json`、`tests/play_food_registry.test.mjs`；修改 `A/web/play/state.js`、`interaction.js`、`stalls.js`、`install.js`、`tests/play_state.test.mjs`。初次只激活已存在的 3 味，完整目标仍为 24。

**Interfaces:** `createFoodRegistry({catalog,assets,vendors,profiles}) -> Registry`；失败抛带字段路径的 `CatalogError`。Registry 提供 `foodsById/vendorsById/profilesById/requiredFoodIds/vendorsFor(foodId)`。GameState 新增 `configureCatalog(registry)`（仅 ready 前一次）、`discover(foodId):boolean`、`track(foodId,vendorId):boolean`；`collectionSnapshot()` 返回去重集合/进度/目标只读快照。旧 constructor 的 `foods` 测试适配保留，不留第二份全局 ID 集合。

- [ ] 写回归：重复 ID/缺 asset/缺 vendor/错误 profile 拒绝；新增第四个 ID 能 take/eat；空目录 `complete=false`；重复品尝不增加 unique；chapter/count 使用 requiredFoodIds。
- [ ] 运行 `node tests/play_food_registry.test.mjs` 与 `node tests/play_state.test.mjs`，确认旧硬编码不能满足新增食品用例。
- [ ] 实现注册表与状态，移除模块级 FOOD_IDS；同步返回 install 生命周期，新增 metadata ready gate，存档等配置完成再应用。模型加载失败不等同元数据失败。
- [ ] 回归旧三味拿取/品尝与现有 core/bind 调用；错误目录显示可读状态，不误报全齐。运行上述两测试及 `node tests/play_interaction.test.mjs`、`node tests/play_stalls.test.mjs`。
- [ ] 提交 `feat: drive snack play state from validated food registry`。

## M02 — v1 存档迁移、集合与安全持久化

**依赖：** M01。**Files:** 新增 `A/web/play/save-migration.js`、`tests/play_save_migration.test.mjs`；修改 `state.js`、`install.js` 及现有存储适配实际所在文件（M00 用引用定位，不假设另有 storage.js）。

**Interfaces:** `decodePlaySave(raw,{registry,sceneVersion})->{save,warnings}|null`；`migrateV1ToV2(v1,{registry,sceneVersion})->{save,warnings}`；`persistPlaySave(storage,save)->{ok,error}`。实现位置在 save-migration.js，调用者不得重复迁移。新 key 与字段按规格第8节。

- [ ] 写固定 fixture：空旧档、三味全齐、held/basket、骑行、合法 eating.elapsed、坏 JSON、非有限位置、scene 过期、未知 ID、重复 ID、损坏 v2 但有效 v1、storage quota failure。
- [ ] 断言旧3章保留却不是新版完成；tasted⊆discovered；goalIndex映射稳定；未知收藏保存在 orphanedProgress；场景不兼容只回安全出生点；两次迁移/读回不追加奖励。
- [ ] `node tests/play_save_migration.test.mjs` 先失败，再实现写后读回/保留 v1；把“新散步”与清空收藏 action 分开。
- [ ] 用真实 localStorage 复制 v1 到候选站点一次，刷新/骑车/取食各一次；确认自动保存和错误提示。测试中 mock 配额异常，真实浏览器不灌满用户存储。
- [ ] 提交 `feat: migrate legacy snack saves without losing collections`。

## M03 — 三处全图美术样板

**依赖：** M00。**Files:** 新增 `A/inputs/world-art-style.json`、`A/web/material-style.js`；修改 `A/web/lighting.js`、`A/lighting/presets.json`、`A/web/main.js` 的 prepare/batch 接缝；必要时新增 `tests/play_world_art_materials.test.mjs` 检查共享/卸载行为，不检查某个颜色字面量。

**Interfaces:** `applyWorldArtStyle(root,{style,sharedMaterials})->{dispose}`，在 `batcher.batchGroup(grp)` 前调用；样板条目只针对明确材质族/区域，未知材质沿用原值。输出 light/material 配置和三处相同机位图片。

- [ ] 按规格木/石/瓦/墙/水统一光照与粗糙度；灰猫和食物在亮/暗背景都清楚。先完成广场、三味街、桥岸；不整城重导出。
- [ ] 若更改材质生命周期，写“同族共享材质、卸载不提前释放其他区域材质”回归并验证。保留原材质还原路径。
- [ ] 跑 `npm --prefix scene-authoring/yuyuan-area run test:lighting` 和 `test:lighting-fallback`；拍 day/dusk 前后对照，确认封闭店面、路面高差可读。
- [ ] 对比同路线帧时/绘制数，无材质爆量后冻结样板配方。主控做一次审美验收；记录具体不足再修，不自动派 reviewer。
- [ ] 提交 `feat: establish warm plush world lighting and material samples`。

## M04 — 灰猫四类食物动作与资产接口

**依赖：** M01。**Files:** 修改 `A/web/play/avatar.js`、`foods.js`、`plush-skin.js`、`rider-fit.js`、`A/inputs/play-character.json`、`food-pose-profiles.json`；新增 `A/web/play/food-pose.js`、`tests/play_food_profiles.test.mjs`；必要派生 rig 制作源在 `asset-authoring/` 合适角色子目录，二进制先 outbox。

**Interfaces:** `sampleFoodPose({profile,t,rig,anchors,presentation})->PoseTargets`；`applyFoodPose(avatar,foodInstance,targets)`；`FoodInstance` 暴露 `{root,anchors,parts,setBiteProgress,dispose}`，parts 语义为 edible/container/utensil/wrapper/skewer。返回的 hand/mouth/bowl 参考点是坐标空间明确的真实骨骼/表面点。

- [ ] 以真实灰猫+四个占位原型写行为检查：托底点不漂移、入口点到嘴的距离、工具/盛器分离、t=0/中段/结束平滑、暂停固定、回落后骑行接触恢复。阈值先由米制资产尺寸与已通过基线确定，不为通过随意放宽。
- [ ] 实现四 profile 的准备/入口/回落；补足肩肘腕的局部绑定/修形。保留当前脸型/毛色；派生 rig 独立版本与 SHA，原模型只读。
- [ ] 跑 `node tests/play_food_profiles.test.mjs`、`node tests/play_food_cupping.test.mjs`、`node tests/play_plush_skin.test.mjs`、`node tests/play_bike_visual.test.mjs`；必要时有依据地更新真实新 rig fixture，保留旧基线证据。
- [ ] 正侧后连贯录像确认碗不穿脸、勺或筷夹取的一口食物真正入口、签不刺眼、纸包不被一起吞掉。两种 utensilKind 分别检查；骑行不能拿食物又抓把手；卸载无幽灵件。
- [ ] 提交 `feat: add four grounded snack handling and eating profiles`。

## M05 — 六味资产与按需资源库

**依赖：** M01、M04。**Files:** 新增 `A/web/play/food-library.js`、`tests/play_food_library.test.mjs`；修改 `foods.js`、`A/inputs/play-foods.json`；制作源扩展 `asset-authoring/snacks/handheld/`，三种新增食物模型/缩略图放 outbox 后按清单采用。本任务不擅自修改世界入口。

**Interfaces:** `new FoodLibrary({registry,loader,maxResident:8,maxConcurrent:2})`，`acquire(foodId,ownerToken):Promise<FoodInstance>`、`release(foodId,ownerToken)`、`getStatus(foodId)`、`dispose()`；ownerToken 重复申请不能重复计数，晚到 promise 用 generation 失效。`foods.js` 适配旧 hand/display 调用，手持→车篮不另造同食物实例。

- [ ] 写 fake loader 回归：同 ID 并发只下载一次；失败仅影响该 ID；释放不误杀另一实例；pin 的手持不被淘汰；重置后晚到结果释放；稳定≤8、并发≤2、暂态≤10；所有 pinned 时推迟预取。
- [ ] `node tests/play_food_library.test.mjs` 先失败，再实现库与按距离加载。注册表轻数据一次就绪，模型出生首批≤3。
- [ ] 完成肉夹馍/糖葫芦/双皮奶，优化原三味作为统一样板；每味有 GLB/SHA/缩略图/尺寸/握持与入口挂点/合法文案。为碗装提供容器和勺，复用已有器皿前做尺寸核对。
- [ ] 用正常游戏镜头拍六味陈列与入口；校验模型/图片预算与透明/阴影；通过后由主控连同 M06 激活六味 edition。
- [ ] 提交 `feat: stream six distinct snacks with owned resource lifetimes`。

## M06 — 摊点、发现与小地图跟踪

**依赖：** M00、M01、M05。**Files:** 新增 `A/web/play/discovery.js`、`vendor-layer.js`、`tests/play_food_discovery.test.mjs`、`tests/play_vendor_routes.test.mjs`；修改 `stalls.js`、`minimap.js`、`interaction.js`、`install.js`、`A/inputs/play-vendors.json`。新增摊车模型/碰撞代理由清单管理。

**Interfaces:** `deriveVendors({registry,layout,sockets,world})->VendorRuntime[]`，runtime 含 `{vendorId,foodId,displayAnchor,customerPoint,enabled,reason}`；`findDiscoveries({feet,mode,world,vendors,knownIds})->foodId[]`；`setTrackedVendor(vendorId|null)` 给 map/marker。实体无可用站位时 enabled=false，禁止 fallback 到无效坐标。

- [ ] 写边界/负例：7.99/8.01m、垂差1.99/2.01m、墙后/对岸/头顶、无地面支撑、透明特效遮挡；只有符合几何条件才发现。1.8m 取食门限沿用。
- [ ] 实现三个旧摊与新增三味候选点，摊车至少把路线引到一个原三味街之外的街区；另 18 点可为已勘测 inactive 数据，不能冒称可玩。
- [ ] 将 food→vendor 一对多显式化，当前目标用 ID，移除数组索引耦合。顾客站位/模型/碰撞共用位姿；卸载同时销毁模型/碰撞/提示。
- [ ] `node tests/play_food_discovery.test.mjs`、`node tests/play_vendor_routes.test.mjs`、`node tests/play_stalls.test.mjs`、`node tests/play_map.test.mjs` 通过；实际从六个摊前后左右接近、退出，包含自行车停放后取食。
- [ ] 提交 `feat: discover reachable food vendors across the town`。

## M07 — 图鉴、模态交互与收藏转移

**依赖：** M01、M02。**Files:** 新增 `A/web/play/atlas.js`、`atlas.css`、`overlay-controller.js`、`collection-transfer.js`、`tests/play_atlas.test.mjs`、`tests/play_collection_transfer.test.mjs`；修改 `hud.js`、`play.css`、`install.js` 和 `web/main.js` 必要摄像机更新门。新增浏览器脚本 `A/tests/snack-atlas-browser-check.mjs`。

**Interfaces:** `mountAtlas({root,registry,getSnapshot,actions,overlay})->{open,close,render,dispose}`；actions 仅 `track/exportCollection/importCollection/resetCollection`。`overlay.open(id,{returnFocus})` 返回可释放 token；最后 token 释放才恢复捕获的原状态。`exportCollection(snapshot)->string`；`importCollection(text,{registry,current})->{collection,warnings}`，64 KiB 上限，未知字段不写入运行状态。

- [ ] 写三态/筛选/计数与 import fixture：合法并集、重复幂等、>64KiB、坏 JSON、伪位置/原型字段、未知食品；错误保持原集合。未知收藏可进 orphanedProgress，不伪造当前必需 ID。
- [ ] 实现章节页、食品卡与详情、追踪按钮，未发现不显示精确位置。HUD 单目标+总进度；静态图懒载。完成里程碑与清空确认；新散步保持收藏。
- [ ] 实现 B/Esc、焦点限制/返回、帮助/图鉴暂停所有权；世界摄像机和动作时间统一门控；关闭时清除按键积压并恢复坐骑状态。
- [ ] 运行两个单元测试；通过 `BASE=http://127.0.0.1:5492 OUT_DIR=out-zone node scene-authoring/yuyuan-area/tests/snack-atlas-browser-check.mjs` 做真实 UI 检查（脚本需在本任务创建）。覆盖步行/骑行/已暂停/观察模式、Esc/B、失焦、360×800与1280×720布局、键盘与减少动态。
- [ ] 提交 `feat: add discoverable food atlas and safe collection transfer`。

## M08 — 六味完整闭环验收与可试玩交付

**依赖：** M02、M03、M04、M05、M06、M07。**Files:** 主控整合 `install.js`；新增 `P/milestone-six.md`，更新 task-state；实景证据 outbox。

**Interfaces:** 产出可恢复的六味候选 sourceHead、资产清单 SHA、预览地址与下一批接口版本；没有通过此门不复制到 24 味。

- [ ] 从新档按正常操作拿/吃六味，发现与品尝分别增长；测试追踪、小地图、图鉴、六味里程碑。
- [ ] 从旧三味存档刷新后继续三味，测试两次品尝、暂停进度、车篮转移、骑行 B→Esc 镜头、刷新还原。
- [ ] 弱网/一个模型404/开图鉴未加载/离开重进各一例；食物不凭空盖章、不阻塞步行、不泄漏旧对象。
- [ ] 运行 `npm --prefix scene-authoring/yuyuan-area run test:play` 和新增本轮行为测试一次；记录三美术样板和四动作短片。失败只回到负责模块修复。
- [ ] 提交 `docs: accept six-snack vertical slice` 并提供真实可试玩入口；首批是中间交付，整体任务继续。

## M09 — 全图美术推广与街区生活感

**依赖：** M03、M08。**Files:** 修改 `A/inputs/world-art-style.json`、`A/web/material-style.js`、`A/lighting/presets.json`；新增 `A/inputs/street-life.json`、`A/web/street-life.js` 及必要 `tests/play_street_life.test.mjs`；`web/main.js` 仅主控接入。

**Interfaces:** `installStreetLife({scene,world,manifest,resourcePool})->{update,dispose}`；装饰/灯光以区域和来源 ID 管理；不可通行实体才配真实 collider，小飘带/蒸汽不碰撞、不截交互射线。

- [ ] 从三个样板配方推广 bazaar/pond/garden/temple/fangbang，outer 只调远景层次。给连接段增加少量路牌、陈列、暖灯、窗格层次；保留上海招牌与地标识别。
- [ ] 摊位功能提示统一：可取食的主打展示/招牌清楚，封闭商场没有假入口；池岸和窄巷留清楚路缘、桥头和退让空间。
- [ ] 对新增资源生命周期/光池/碰撞同源写最小必要测试；不为每个色值写测试。旧场景 GLB SHA 不变，材质实例与 draw calls 不异常增长。
- [ ] 各可达区域同条件实景核对，夜景抽查可见路缘；记录帧时相对基线。技术通过后一次主控美术检查，把剩余微调清楚列出，不无限追加巡审。
- [ ] 提交 `feat: carry plush town art direction across all playable districts`。

## M10 — 扩到十二味与八章初开

**依赖：** M08。**Files:** 食品制作源、`A/inputs/food-catalog.json`、`play-foods.json`、`play-vendors.json`、表现参数；新增 `P/milestone-twelve.md`；不为每味改 avatar 或 state。

**Interfaces:** 沿用 M01/M04/M05 已冻结的食品条目与实例接口；新增六味 IDs 严格取候选表 wave=12。

- [ ] 制作烤冷面/黏豆包/鲜花饼/热干面/鸡蛋仔/葡式蛋挞；独立轮廓和适配动作，器皿复用不影响食物辨识。
- [ ] 逐味导出/尺寸/SHA/缩略图/文案/掛点；只跑新增资产验证与动作 profile 相关用例，不重做原六味未改变资产。
- [ ] 为新增六味确认实际可达摊点，八章节至少各有一味；从六味旧档继续，进度为6/12且已有收藏/奖励保留。
- [ ] 正常骑行走一条跨区线，拿/吃新增六味，拍食物接触表及图鉴页；验收十二味里程碑。
- [ ] 提交 `feat: expand the food trail to twelve tastes and eight chapters`。

## M11 — 补足二十四味内容与模型

**依赖：** M10。**Files:** 同 M10；新增 `P/milestone-twenty-four-assets.md`、汇总资产尺寸报告。食品批量生产可拆为每工单3–4味，输出目录独立，主控一次集成。

**Interfaces:** 补齐 wave=24 的12味；不新增第五种临时动作模型来绕开已有 profile。特殊形态用已有 profile 的表现参数/工具子件表达。

- [ ] 按章节补剩余12味：煎饼果子/驴打滚/吉林煎粉/凉皮/羊肉串/担担面/红油抄手/臭豆腐/胡辣汤/肠粉/清补凉/凤梨酥。
- [ ] 每味有模型、缩略图、来源文案、形态差异、合法抓握与入口、完整 manifest。用模型接触表和四类代表动作检查，不逐味追加无关全图QC。
- [ ] 注册表校验24唯一ID、8章×3、全体资产引用存在、总预算≤24MiB/2MiB；四 profile 内容不退化成同一种捧团动作。
- [ ] 激活食品前与 M12 逐点通路确认联动；某味不可达或模型失败先保留 inactive，不能发出24味完成报告。
- [ ] 提交 `feat: complete the twenty-four snack asset collection`。

## M12 — 全图二十四点路线、节奏与完整收藏

**依赖：** M09、M11。**Files:** 修改 `A/inputs/play-vendors.json`、目录的 locationHint/requiredFoodIds；新增 `A/tests/snack-trail-browser-check.mjs`、`P/final-route.json`、`P/play-loop-result.md`。

**Interfaces:** 路线证据 `{sourceHead,assetManifestSha,renderer,steps:[{vendorId,approachPath,take,taste,retreat}],collectionBefore,collectionAfter}`；路径是实际输入/坐标轨迹，不把瞬移当通过。内部 fixture 可定位几何负例，必须与实走证据分开。

- [ ] 完成18旧摊+6摊车的实际布点，必要时替换不合格候选而不改 foodId；更新候选表的采用证据与原因。确保至少覆盖三味商业街、中心连接、方浜、池岸、园林外入口、庙外商业连接这些探索区。
- [ ] 清除死路目标、隔墙发现和摊前穿模；停自行车后能取食且能退回道路。有限宽度处提示下车，不砍掉原道路/地面检查。
- [ ] `BASE=http://127.0.0.1:5492 OUT_DIR=out-zone node scene-authoring/yuyuan-area/tests/snack-trail-browser-check.mjs`：真实游玩模式从正常入口依次发现/拿取/品尝24味；不使用测试直接改 tasted 代替。
- [ ] 实测初体验/章节/整轮用时与空白路段，调整食摊线索/装饰位置和目标提示，不擅自重调已稳定移动/单车速度；收集6/12/24奖励与刷新后24/24。
- [ ] 提交 `feat: connect every snack to a playable town exploration route`。

## M13 — 可移交静态包、资产闭包与发布工具

**依赖：** M12。**Files:** 修改 `tools/export_play_site.py`；新增 `tests/play_export_catalog.test.py`、`tools/publish_play_site.py`、`tools/verify_play_site.mjs`（复用现有 outbox 安全逻辑，先审读再迁入）；修改部署文档。包与回滚清单 outbox。

**Interfaces:** 导出器仅从已验证公共清单遍历引用；每文件 `{path,sha256,bytes,contentType,cacheControl}`。发布器 `--dry-run` 默认只出清单，显式 `--apply` 才写云端；目标从已核实项目部署配置读，凭证只在内存/既有身份链，不写报告。验证器接 base URL 与 manifest，读回必要字段和 SHA。

- [ ] 写负例：模型有引用但缺失/哈希不符、thumbnail遗漏、带 `../`/外部URI、私有路径或制作字段、未知内容类型；所有应在导出时失败。
- [ ] `python3 -X utf8 tests/play_export_catalog.test.py` 先失败，再扩展公共字段白名单与资源遍历。公开包包括图鉴 CSS/JS、catalog、vendor、pose、新装饰和缩略图；不扫整个资源目录。
- [ ] 迁入现有发布工具的安全闭包、CSP、依赖先传/入口最后/不删远端文件/保留域名与证书参数逻辑；`--dry-run` 校验，不在本任务 apply。
- [ ] 本地静态服务器从导出包启动实测入口与每一类新资源，不依赖源码服务或 ow-character-lab 绝对路径；核对全部 SHA、缓存策略和回滚入口。
- [ ] 提交 `build: export a self-contained snack atlas release package`。

## M14 — 最终验收、性能与接手材料

**依赖：** M13。**Files:** 新增 `P/ACCEPTANCE.md`、`P/DELIVERY.json`；更新 `PROJECT.json` 的真实 development 状态、docs入口与 task-state；生成 outbox 对照页/截图/视频/完整候选包。不覆盖旧部署版本事实。

**Interfaces:** `DELIVERY.json` 记录 sourceHead、manifestSHA、localPreview、checks及真实计数、knownIssues、acceptedFoodIds、saveMigration、performance、releaseStatus。M00–M14 全部 verified 才能写 overall=local_candidate_complete。

- [ ] 合并后运行新增行为测试、`test:play`、`OUT_DIR=out-zone npm run area:verify`；根客户端受影响或包交付要求时跑 `npm run build`。已通过且字节未变的历史资产证据复用。
- [ ] 真 GPU 下覆盖步行/跑步/自行车前后退/上下车/开图鉴Esc/取食吃食/存档恢复/桥头池岸/封闭店面；24味实走可复用M12同HEAD或证明无相关差异的结果。
- [ ] 同M00设备/视口/路线采集p95和资源数，连续两圈与重开无持续增长；模拟单食品失败/弱网；核对首载≤3模型、缓存与总预算。差异超过阈值先定位最大增量，不开启无边界性能重写。
- [ ] 形成可看的“升级前后/全地图代表画面/24味图鉴/四动作”对照页，附明确试玩说明与已知不足；技术与美术状态分开写。四只其他角色清楚列为P2未执行。
- [ ] 提交推送本轮代码/清单/交接。仅清理本轮已合并施工分支/受管工作树，保留资产原件；核对最终HEAD/远端一致和主工作区状态。交付本地完整候选，不把云端旧版本写成已更新。

## R01 — 可选：沿既有授权更新独立站点

**依赖：** M14。不计入本次计划生成，也不计入本地候选的完成门。若当前执行会话已有明确站点更新授权，复用它，不重复询问；若没有，完成可审阅包后才请求具体发布许可。

- [ ] 读取 `docs/CLOUDFRONT-TRIAL.md` 和当前云配置，验证目标仍为 Pawborough 独立站点、已授权身份与 bucket；只部署 M14 已验收包。
- [ ] 使用 M13 工具先 dry-run，资源上传后切入口；保留现有域名/证书/CSP，刷新入口缓存，不删除旧资源。
- [ ] 从公开域名读回版本/入口/关键资源 SHA，实际打开图鉴、吃一味、刷新旧档、骑行B→Esc。记录失效/回滚方式与真实云回执。
- [ ] 更新 PROJECT 部署状态和交接，推送 docs 提交。任何失败保留上一入口，不报告发布成功。

## P2 — 后续包：其余四只直立角色

**依赖：** M14；属于后续包，当前不派工。沿原先机主“灰猫先打通、再接四只”的方向保留。

在 `/home/baibai/ow-character-lab` 当前清单中逐一确认角色 ID 与已采用 upright 模型，不能从旧候选目录猜名字或采用状态。复用 M04 肩肘腕/四profile/自行车挂点/入口规范，为每角色建立自身尺度参数与角色切换后的收藏共用规则。每只完成后验证步行、骑行、四类进食与存档；不重新设计整套玩法，不覆盖原始角色文件。

## 长任务工单与恢复协议

每份给施工层的工单必须包含：taskId、sourceHead、目标一句话、可写文件/输出目录、不可变接口、输入资产 SHA、依赖任务、具体完成测试、产物路径、停止条件。默认一个工单一个可提交交付物；食品资产每包3–4味。不能给“持续美化直到满意”这种无界任务。

每工单建议 60–120 分钟检查点、同一失败最多两次修复尝试；这是检查/重派界限，不是总工程时长保证。达到界限留下失败证据并让主控缩小问题，不能启动无限重试。无需等待期间反复轮询日志；主控推进独立任务，出现有意义结果再收取。

`task-state.json` 每任务状态为 not_started/running/implemented/verified/blocked；implemented 只说明有产物，verified 需要验收证据。状态更新包含实际 sourceHead/resultCommit、evidencePaths、lastCheck、nextAction、blocker。全局 currentTask 与 lastUpdated 同时维护。未运行就不填成功、预计时长不冒充耗时。

恢复顺序：读取任务状态→查 Git 与对应 worker 是否仍在运行→核对产物 SHA/最后验收→从第一个依赖满足的未完成任务继续。不要凭聊天“idle”重启工人；不要重做 verified 且未被后续改动影响的任务。变更关键共享模块时只使受影响任务的验收失效，并写原因。

可选 long-long-run 只在下一执行会话正式开始后配置自己的有限目标与会话绑定，不创建定时自动化，不复用旧会话状态。模型切换不等于已有后台任务在运行。

## 本计划自查

- 所有规格目标都有对应任务；内容/动作/地图/收藏/性能/交付各有完成证据。
- 24味列表、8章、三批增量、18旧摊+6新点、四动作数据与依赖DAG用本次计划校验确认；候选坐标、未来帧率、未来任务成功不冒报。
- 没有以静态图或测试改状态代替真实走动/取食；没有借此次计划启动模型施工/云发布。
- 剩余具体设计选择只在已约束范围内留给执行者：确切摊车坐标、材质参数微调、食品造型细节、rig局部制作方式。核心范围与接口不需要执行者重新提案。
