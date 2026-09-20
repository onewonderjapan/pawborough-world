# 任务B走查结论（2026-09-21，round 1）

真实浏览器走查（Playwright + 系统 Chrome + SwiftShader，vite dev 127.0.0.1:5420），
工具：`tools/world_ten_hour_walkthrough.mjs`，原始事件/截图：本目录 `walkthrough/`。

覆盖路径：首页(1280/1920/390) → 选点 → 开始探索 → W行走（脚底位移实证）→ P暂停/恢复
→ V取景 ↔ 行往复 → 场景总览返回 → 浏览器后退再入 → 非法?entry → 图库（滚动后8/8加载）
→ A弄/B弄/庙前三入口出生实测（13/14-*.png）。

## 列出的问题（≤3）与处置

### 1. 取景↔行走往返重置姿态（已修，UP-B1）
- 现象：V退出行走（提示「点击『行走』从当前位置继续」、帮助面板写「V 保留所在位置」），
  但点头部「行走」后玩家被重置回入口锚点（走查实测 124.0,27.5 → 124.6,27.6，提示变回
  「从『主街』开始探索」）。
- 根因：`src/player/walkSession.js` `beginWalk` 的 pending-anchor 分支
  （URL ?entry 首次进入必经）漏设 `everWalked=true`，下一次进入走"首次进入"分支按
  最近锚点重落。与该文件头注与 `tests/fangbang_walk_session.test.mjs` 头注的契约
  （"a mode switch is not a new game"）相悖；pending→restore 序列恰无测试覆盖。
- 处置：`src/player` 在保护基线锁定区（byte-exact），修复落在未锁最小修改窗口
  `src/fangbangMain.js` enterWalk()：explicit-choice 落地后补 `walk.everWalked = true`，
  注明锁定核补偿原因。
- 回归：走查断言 PASS（`feetBeforeV`==`feetBack`，horizDistM=0，提示「继续上一次的位置行走」）。

### 2. 行走/暂停中鼠标被指针锁占用，HUD未提示Esc（已修，UP-B2）
- 现象：行走与暂停态指针锁保持（暂停也不放鼠标），头部按钮可见但不可点；HUD只写
  「P 暂停 · V 返回取景」，未写如何唤回鼠标；Esc 仅在「操作说明」面板中有文档。
  走查脚本尝试点击头部按钮被canvas拦截（同一机制，实证不可点）。
- 处置：`src/fangbangMain.js` HUD两态文案补「Esc 释放鼠标」（纯提示文案，不改输入处理）。
- 回归：走查断言 PASS（HUD = `位置 … · P 暂停 · V 返回取景 · Esc 释放鼠标`）。

### 3. 庙前入口：取景正望山门，行走落点背对山门（记录，不改动）
- 现象：intro 取景机位 shanmen-from-road 正望「保障海隅」门额（与首页承诺一致，
  13-templeFront-intro.png）；点开始探索后落点 (-127.8, 27.1) 朝向街对面店铺，
  山门在身后（14-templeFront-spawn.png）。
- 为什么不改：落点坐标/朝向来自上游按实测行走路线推导的 validated anchors
  （`src/player/entryAnchors.js`，锁定区；yaw 属路线推导数据，与四入口统一的
  route-derived 设计一致）；改朝向=改路线数据+解锁区，超出本批授权。
- 缓解现状：intro 机位已兑现承诺；玩家转身数米即到山门广场；HUD 快捷点可显式定位。
- 留给机主/后续批决定是否调整 anchor yaw（需连同保护基线一起重出）。

## 走查中排除的疑点（查证为非问题）
- 图库两张 street-mouth 图 naturalWidth=0：懒加载未滚动触发；滚动后 8/8 加载（w=1280）。
- intro 取景中段深处黑色块：段西封墙/尽端正式几何，1920 首页 hero 同物，非占位。
- `review-manifest.cm.json` 404：压缩模式探测，页内已知容忍（world-playable RESULT
  knownBenign），玩家不可见。
- 浏览器后退再入游戏页：全新装载、无残留指针锁/幽灵按键（pointerLocked:false）。
- 非法 `?entry=bogus-anchor`：安全回退主街锚点，ready 正常，无 fatal。
- 390 窄屏：首页/游戏intro无横向溢出，关键操作不被遮挡；触屏只承诺浏览（页面按
  桌面键鼠给说明，未假称移动端可走）。

## 验证
- fangbang/preview 相关测试 35/35（walk_session、entry_anchors、canvas_fit、
  anchor_probe、world_inputs、world-preview、map_registry、result_json）。
- 保护基线：locked 区 0 漂移（fangbang.html / src/fangbangMain.js / vite.config.js
  为计划允许的最小修改窗口，本次只动了 src/fangbangMain.js 与新工具/文档）。
- 全套 124+ 留最终集中跑一次。
