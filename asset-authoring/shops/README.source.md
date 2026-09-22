# 六栋沿街店屋底模量产批

交付：6栋可看可选的方浜普通店屋底模（设计变体，非历史复刻、非指定店号），24张标准视图 + 1张标注概览图 + 本地旋转预览页。**ownerAdopted=false，worldIntegration=not_started**——由机主选样后另派精修与世界安装。

## 看什么

| 入口 | 说明 |
|---|---|
| `out/overview-6units.png` | 6栋正立面概览，已标注 asset ID 与设计变体 |
| `out/<id>/views/{front,side,rear,threeq}.png` | 每栋4机位 1024×768（Cycles CPU，统一光照） |
| `preview/gallery.html` | 本地预览页：缩略图选择、Orbit旋转、灰模/材质切换、尺寸/tris、视图与GLB下载 |

启动预览（仅localhost）：

```bash
cd workspace && python3 -m http.server 5440 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:5440/preview/gallery.html
```

## 六栋与差异

| ID | 变体 | 面数 | 尺寸(宽×深/檐/脊) | 差异要点 |
|---|---|---|---|---|
| shop-01-narrow | 窄单店 | 3724 | 5.4×6.4 / 6.5 / 7.7 | 单门居中+左右窄窗；二层两组窗；右山墙高窗 |
| shop-02-double | 双店面 | 4300 | 7.2×6.4 / 6.8 / 8.0 | 两组独立门窗、中墙垛；二层三组窗 |
| shop-03-threebay | 三开间排门 | 4804 | 9.6×6.4 / 6.8 / 8.0 | 三段排门、连续檐口；留空窄招牌板 |
| shop-04-recess | 凹入门廊 | 3976 | 6.4×6.8 / 7.2 / 8.4 | 门内退0.45m浅门廊；右侧宽店窗；不对称二层窗 |
| shop-05-corner | 双面直角转角 | 4624 | 7.2×7.2 / 6.8 / 8.0 | 正面+右侧前半段均店窗/排门；街角砖枋；双坡沿正街 |
| shop-06-endcap | 端头侧门店屋 | 4036 | 6.0×6.4 / 6.5 / 7.7 | 左山墙高窗+后部小侧门；端墙压顶 |

全部≤6000 tris（转角≤8000）达标；GLB共7.2MB。每栋另带 `model.blend`、`collision.json`（粗碰撞包围+关门声明，未接入Rapier）、`materials.json`、`measurements.json`（设计尺寸/断言/SHA256）、`recipe-copy.json`。

## 方法与复用

- 一套生成器 `generator/build_shophouse.py` + 6份参数 `generator/recipes/*.json`；一条命令重建整批：`bash generator/build_all.sh out/batch-<新名>`（拒绝覆盖既有目录）。
- 语言基准：G01山墙/G02背面/G03正面与直角转角/G04屋面（lead QC pass，design_inference）；007/008为2015实拍仅取构件关系。
- 代码/贴图复用自 `pawborough-world-ten-hour-20260921`（只读），逐文件原路径+SHA256见 `source-kit/PROVENANCE.md`；贴图为既有10个图像材质，零付费生成。
- 造型契约：Y-up、正面+Z、原点前墙中底、米制；墙厚0.24、窗内退0.12、檐口出挑≤0.35m；砖脚/粉墙/深木/灰瓦；开口全部真实留洞+实体关闭；无室内、无招牌文字、无空调线缆。

## 质检

`qc-report.json`：6/6 PASS——GLB重导入材质贴图存活、边界尺寸/轴向对spec、构建断言（墙端帽随局部屋面线、开口全部实体填充）、视图齐全。已知小瑕疵见 `RESULT.json` knownIssues。

## 真实耗时

探索规格9min；脚本与kit开发17min；首件迭代16min；批量生成4s（另有两次全批重建）；24静帧359s（CPU顺序）；概览约23min（含一次渲染污染排查）；集中QC 4min；预览页验证10min。分项口径详见 `RESULT.json`。

## 边界

本轮不包含：世界安装、Rapier碰撞、便携包重打、长测、任何push/发布；未改动任何现有源产物与另一可靠性工作区。
