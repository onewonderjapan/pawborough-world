# Lane-A polish — construct delivery (v6 candidate, ownerAdopted=false)

入口：`fangbang.html?ds=fangbang-temple-v6`（上轮玩家入口/分辨率/锚点不变，参数换数据集即可）。
基线 96b6690；一切产物均为新文件，0 个已跟踪文件被修改；v5/lanes-v2/v4/building/W2 只读未动。

## 做了什么（对照 CONSTRUCT.md 冻结单）

1. **P1 地面闭合**：接口地板沿实测墙线重切（N05 东面、N06 西面、新东墙线、模块地板边），
   显式三角形、朝上、沿用 `lanes-v2__paving-frontage` 地面契约。原 6.4 m² 空带消失：
   三个原跌落探针全部 grounded，覆盖网格 425 点 0 缺失，四条入口剖面可达走廊间隙 0.0。
   西缘刻意留 0.34 m 收边 + 凹形排水线（可读排水边线）。
2. **新东弄墙**：N06 西北角 (44.87,-14.79) → 模块东墙 (44.6393,-16.4569)，t=0.24 h=3.3，
   灰泥 + 接地砖基 + 瓦压顶，配套世界 OBB `lane-a:wall-east-mouth`；推撞停在可见面 0.374 m。
3. **门墩重锚**：两墩中心落在真实墙线（42.049 / 44.090 @z-10.2），砖基 y0..0.6 接地；
   未新增跨街门楼/牌匾。
4. **高窗真凹口**：墙体按洞口分段，四面内衬即分段墙自身面；关闭玻璃后置（西 localX≈1.168、
   东 ≈-1.232），木框/石窗台仍在外侧；位置/节奏/关闭状态不变；西墙凹深 0.08 不穿透 0.10 薄墙。
5. **后门**：环形凹口保留并细化（门楣/门槛/砖基入凹口返边）；檐下补木封檐板（三面），
   瓦压顶轮廓不变，不压净空。
6. **尽端盲壁龛**：0.13 m 真进深（四周内衬 + 后壁 + 关闭木框环），尺寸意图不变，未加神像/文字。
7. **材质**：仅新 A 两实例粉墙法线 0.65→0.35；零新贴图。
8. **预算（两种配置实测）**：新 A 2910（≤4000）、接口 911（≤950，含新东墙）；
   基础默认 698704 ≤ 700000（v5 为 703049）；skins+props 全开 712340 **单列**（超基础上限 12340，
   不冒充通过）。
9. **B 不动**：lane-b-v2 逐字加载；B 口围裙 z 塌缩缺陷按主控登记为遗留，未顺手扩大。

## 主控两条有界修正（本轮内完成）

- **门槛高差**：模块门槛顶 +0.04→+0.02、接口门槛条 0.115→0.11；新增三条表面高差剖面回归
  （门户轴线/中线/西条），相邻步长 max 0.020 m；测试断言导出 GLB 门户带石面顶 ≤0.11。
- **证据取景**：4 对前后图用页面真实「取景」按钮隐藏入口卡后重拍（不改网页源码），
  审查面板保持关闭；另加 1 张尽端斜视 after 补充图（不伪造 before）。
- **源工程**：scene.blend 裁切窗修正为 blender y=(7.5,26.5)（原负值把 N05/N06 全删了），
  现存 N05×12/N06×10 上下文，`scene.camera=street-mouth` 非空，材质预览相机视图。
- **dist**：不再复制源码 HTML 覆盖构建产物（门禁校验编译 JS 引用）；`--emptyOutDir false`
  不清目录；页面致命错误/资源 404 快速失败（.cm.json 可选探测白名单）；双配置预算写入
  `dist-lane-a-polish/lane-a-polish-dist-run.json`。

## 证据索引

- 物理：`artifacts/lane-a-polish/verify/walktest-v6.json`（WALKTEST_V6_PASS）
- 剖面：`artifacts/lane-a-polish/verify/measure-v6.json`（MEASURE_V6_PASS）
- WebGL：`artifacts/lane-a-polish/{before,after}/*.png` 4 对 + `after/end-oblique.png` 补充 +
  `after-allskins/` 全开配置；`web-capture.json`（含预算与环境）
- 离线：`artifacts/lane-a-polish/blender/*.png` 4 张 CPU 静帧；源工程
  `world/lane-a-polish/review/scene.blend`
- 测试：`tests/lane-a_polish.test.mjs`（全套 94/94）
- dist：`dist-lane-a-polish/`（95 文件闭包，DIST_RUN_OK）

## 重开/复算命令

见 `RESULT.json.commands`；生成器可重跑到新 outDir，不覆盖 v5 源资产。

## 遗留（如实）

- lane-B b-apron/b-drain-outlet z 塌缩（既有，逐字保留，主控已登记）。
- 全开配置 712340 高于 700k 基础上限（单列事实，不改默认开关达标）。

完成后停止，等 Codex 终验；不合并/push/发布，不新增定时任务。
