# 2026-09-26—27 Pawborough 推进事实稿（供 Claude 交接引用）

这是既有证据的只读摘录，不是本次“合并所有分支/worktree”的完成报告；新合并 HEAD、dirty/资产归位由 Codex 主控另交。管理正本仍在 W2。最终 CLOSEOUT/LEAD_REVIEW 优先于阶段 PLAN/jobs 的 queued、早期“仍在进行”或手填时间。

**净推进口径**：在 Claude 等前任已有世界上完成断点收尾、精修返修、跨区可走与交付闭环，不能重算为新建整城。301 栋外围是既有打磨范围；20 栋厅堂、四区主体、既有 5 条商业路线不计为这两天新创。11 镜头是已有定义的当版重导。

**分工**：Codex 主控派工、冻结边界、源码/图证/资产审查、定向返修、合并与最终独立恢复。Sol/high 实施桥端、G2、入口/接线/tar/启动小修；GLM-5.3-Flash 实施夜班四包/收尾、店面、G1/G3/G4（goal 工单为 max，实际请求见模型收据）。G2 的 Git author 误继承 Flash 配置；实际 Sol/high 已在主控记录披露，不能按 author 判施工模型。不同任务的主观评分不构成通用模型排名。

## 每项实际变化

|项 / 施工者|接手或修前真实状态|本次实际变化|验收证据 / 可引用路径|代码提交|边界 / 待办|
|---|---|---|---|---|---|
|接手与夜班编排 / Codex主控|已有 fefb6ee5 世界与旧三态检查；部分本机资产缺失/不同|368项旧资产hash核对，86项本机缺失/不同资产同步；两个串行队列、四个限定收尾包|[夜计划]；[lane A]、[lane B]实际结束记录|旧基线 `fefb6ee5`；阶段整合 `cac3747a` 等|同步不等于新增模型；旧队列已 stopped，不能按 jobs 的 queued 自动重开|
|共享贴图 / GLM Flash|A1断点收尾；运行件重复内嵌相同贴图|51项声明资产核hash；同输入包 18,574,796→12,815,599 B，省5,759,197 B；同机位core像素0差|[夜计划]20:18；[夜最终结果] shared-texture 引用与HTTP实测|`f44f1f61`|此数字仅共享包同输入口径，不能充当最终整合体积或W2性能|
|既有外围打磨 / GLM Flash|既有外围L0/图集收尾，非新建301栋|v2图集接入；17/16项两态检查、图集hash及前后图审查；cm增量198,224 B|[夜计划]19:19；[lane B] outerpolish receipt路径|`9f6f6de0`、`c8262d82`|301是本批既有范围；限定读取资料未给逐栋净改动数，不宣称新增301栋或全部精修|
|商城剩余目标与自由段玻璃 / GLM Flash|登记12→15时曾失败；553893868自由段玻璃原40%、严谨口径39%低于50%；3项曾落part5|剩余3个既有商城目标套件接入；玻璃39%→69%，门槛仍50%；3项回part4，14分件；15/15塔楼检查exit0|[夜最终总结]1–3；[夜最终结果] test10b负例、15/15、75/0|`56b895fe`；定向收尾 `93c84f12`|不是新增3处地理footprint；v0覆盖79%→69%仍通过；14座重复walk子项复用同OUT独立通过证据|
|亭子/摊位小修 / GLM Flash|B2八项限定问题与已有外围整合后待验收|11项专项/公共检查通过；23项声明hash，19项活动资产变更接入；檐棚/烤架/亭角三组对照审查|[夜计划]21:17；[lane B] smallfix receipt路径；[夜最终总结]联合检查|`f5faecac`|19是资产变更数，非新建19模型；3项停用檐棚保留旧文件/hash，不装配|
|九曲桥两端 / Sol high|原GLB 89/311桥端采样失败，台阶错向/断接|只修既有桥端台阶；311/311通过，6条GLB/Rapier巡游通过，同编码传输+252 B|[晨间比较] Sol段|`e04f26e4`|原石桥/锚点不变；该桥上起步PASS不能代替后续道路→台阶接入证明|
|程序化店面 / GLM Flash2|侧/背墙门洞与窗型不匹配、有越界；重复id当时仅记录|175开间真实GLB检查，184断言通过，最差越界降到0；同环境运行时+16,904 B，无新贴图|[晨间比较] Flash2段|`30991050`|是既有开间几何修复；当时仅3件变更资产，不是完整闭包；4个既有封死门面未偷偷新开洞|
|首次三路联合 / Codex主控|单包通过不代表新组合通过|本地1224组合首次默认重建exit0；22项受影响检查/GLB验证0失败；core/bazaar与5条原商业巡游通过；372输入/76闭包hash匹配|[夜计划]03:40；[晨间比较]整合状态|`1224b416`|核心首载13,606,096 B；这是夜班组合，不是完整方浜跨区证据；当时main仍fefb6ee5、未采用/云归档|
|G1身份 / GLM Flash max|175 facadeBay 只有7种共享id，不能稳定逐开间追溯|175稳定唯一id；门型/位置/真实几何保全；初版资产账补正|[G1审查]；[身份资产账]|`e6e8dd85`|仅身份元数据，不计新增175开间；不因同件hash不同宽泛SKIP|
|G2完整跨区 / Sol high|原5路不含方浜；按需加载重建controller会回锚点；真实接口缺面与园门垫选网遗漏|增量物理保留同controller；2个可见小补面及既有门垫分类修正；完整正向+返程、无中途传送、自然加载边界通过|[G2审查]明确引用 `THROUGH-WALK-CHECK-13.json`、`THROUGH-BROWSER-CHECK.json`、缺面/前后图；[goal观察]说明|`1546a18c`|真实拓扑：方浜→山门→庙后院→**原山门返出**→商城/豫园入口→返程；没有新后门。早期raw补面输出14.46MB不能传播成最终压缩体积|
|G4当版控制层 / GLM Flash max；Codex主控审查|已有11镜头定义与旧输出，需绑定当前身份/补面版本|16运行分件当版导出；11×24×4=1,056 PNG、264相机JSON，检查0错误；16件有向几何与9份物理/路线元数据保持证明后复用G2|[G4审查]；[有向几何对账]；[路线元数据对账]|`e37c7fb5`、`5dec3d37`；整合 `5c8eadf3`|是重导已有11镜头，不是新创11个；离线控制输入不等于W2性能/最终画质采用|
|G3恢复与最终接线 / GLM Flash max + Sol high；Codex主控最终封存|早期全仓打包、归档校验/留存/浏览器诊断与动态依赖接线有缺口|白名单代码、严格归档、真实空目录恢复；Sol补R7的3个动态运行文件、source配置、短起步smoke、日志留存与UTF8 ustar切点；最终107源码/90运行文件封后逐字节匹配、97HTTP探针/冷启动/候选绑定/方浜生产起步通过|[G3审查]真实 report-8 / cold-load-7；[最终CLOSEOUT]及其列出的最终报告；[最终入口说明]|G3 `2daa408e`→`e028dddc`；Sol `6e330d8a`→`a4c91ec4`|不能用错误手写-3或未来时间；过宽pgrep误停他人服务已由主控处理；原worker删掉的微型样本不可冒充仍留存；这不是W2恢复实测|
|G5唯一候选入口 / Sol high|index-v1仍是9/19 adopt_all/旧head/旧端口信息|同源candidate与方浜链接；显式build/package HEAD和4类receipt/hash；缺证/清单不符未核实，历史采用不传播；11生成器/12HTTP页面检查|[G5审查]；[最终入口说明]当前真实绑定|`d60d7fe3`|开发fixture不是最终发布；最终实际绑定由主控做；采用/归档仍pending|
|现场“加载场景” / Sol high；Codex主控CUA复验|IAB在场景fetch前WebGL构造器失败，旧页永久loading；独立Chrome原已能加载|中文失败/当前URL复制与重试、隐藏无效控件；6个真实DOM夹具通过；现场IAB正确显示错误，独立Chrome新tab正常显示|[启动补丁审查]；[最终入口说明]最后补充|`601d42a2`|**仅本地客户端补丁**；a4 sealed包字节不动。IAB图形能力未修复；Chrome6.5s/5.1s不是性能对照基准|

## 最终可核对数字（不要混用阶段产物）

|指标|最终收据事实|口径/界限|
|---|---|---|
|核心视觉首载|**13,628,009 B = 11,820,800 GLB + 1,807,209 唯一外置贴图**|与夜班组合13,606,096 B相比+21,913 B；不含JS/WASM、步行raw物理GLB；20MB门槛未放宽|
|运行分件|14→**16**|多出的2件是小补面分件，不是扩建2个区域|
|单件上限|最大raw **9,941,820 B**；商城4 **8,959,668 B**|raw12MB、商城4 10MB门槛保持|
|最终运行候选包|**188,667,904 B**；SHA `485face2f9a0f1ad55da7003181ca41d662ee43afd9ec9bb90dd6e154dca15a2`|[最终CLOSEOUT]：a4源码包，107源码/90运行文件；是闭包数，不是新增模型数|
|控制层本地包|**615,331,840 B**；SHA `2f8057f906342e7b5c2caac1a301200fcb33cd5a4986144a3ec68856e04964b5`|11既有镜头重导，1,056 PNG/264相机JSON；不是视频发布|
|完整跨区证据|完整正向、完整返程；同controller，无中途传送|最终复用前明确证16件有向几何与物理/路线数据保持；本稿限定读取资料不另填3万步原报告里的细分误差数|
|S1冷加载|core ready **16.91s**|SwiftShader；不能据此填写W2真GPU FPS/帧时或宣称硬件性能通过|

## Claude接续边界

1. a4封存包（资产构建源0c8dc196）与601本地预览补丁分开；后者未重封，不自动改变前者checksum。用户这次新的全分支/worktree合并状态由主控另给。
2. 当前收据仍：W2真GPU/亲手完整巡游、湖心亭/九曲桥/大假山采用、S3登录与本版归档待办；未公开部署。CLOSEOUT里的main=fefb6ee5、mainPushed=false是当时快照，不代替新合并结果。
3. 不因新源码HEAD或重写元数据就重复旧全路线/控制层；先对账真实几何/碰撞/通路与闭包。不启动已stopped夜队列或旧heartbeat/goal。
4. 本稿没有完成百分比、总模型排名、虚构新建楼栋数或未测W2结论。没有在本轮摘录中重新检查Git/资产、构建、测试、浏览器或外部材料。

[夜计划]: /home/baibai/outbox/pawborough-night-20260926/PLAN.md
[lane A]: /home/baibai/outbox/pawborough-night-20260926/control/lane-a.json
[lane B]: /home/baibai/outbox/pawborough-night-20260926/control/lane-b.json
[夜最终总结]: /home/baibai/outbox/pawborough-night-integrate-20260926/artifacts/SUMMARY.md
[夜最终结果]: /home/baibai/outbox/pawborough-night-integrate-20260926/artifacts/RESULT.json
[晨间比较]: /home/baibai/outbox/pawborough-parallel-20260927/MORNING_REVIEW.md
[G1审查]: /home/baibai/outbox/pawborough-goal-20260927/control/G1_LEAD_REVIEW.json
[身份资产账]: /home/baibai/outbox/pawborough-goal-20260927/control/IDENTITY_ASSET_AUDIT.json
[G2审查]: /home/baibai/outbox/pawborough-goal-20260927/control/G2_LEAD_REVIEW.json
[goal观察]: /home/baibai/outbox/pawborough-goal-20260927/control/MODEL_DELIVERY_OBSERVATIONS.md
[G3审查]: /home/baibai/outbox/pawborough-goal-20260927/control/G3_LEAD_REVIEW.json
[G4审查]: /home/baibai/outbox/pawborough-goal-20260927/control/G4_LEAD_REVIEW.json
[G5审查]: /home/baibai/outbox/pawborough-goal-20260927/control/G5_LEAD_REVIEW.json
[有向几何对账]: /home/baibai/outbox/pawborough-goal-20260927/control/CURRENT_RUNTIME_ORIENTED_PARITY.json
[路线元数据对账]: /home/baibai/outbox/pawborough-goal-20260927/control/CURRENT_ROUTE_METADATA_PARITY.json
[最终CLOSEOUT]: /home/baibai/outbox/pawborough-goal-integrate-20260927/delivery/CLOSEOUT.json
[最终入口说明]: /home/baibai/outbox/pawborough-goal-integrate-20260927/delivery/START_HERE.md
[启动补丁审查]: /home/baibai/outbox/pawborough-webgl-startup-20260927/artifacts/LEAD_REVIEW.json
