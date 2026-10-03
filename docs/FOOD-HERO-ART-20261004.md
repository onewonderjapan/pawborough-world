# 八款招牌美食精修 — 2026-10-04

机主批准：在48味首轮基础上继续八款招牌的连续几何、材质贴图与实际吃法精修。本批始于2026-10-03，2026-10-04收口；线上未发布，另外40味和三张独立摄影图鉴保持上一轮内容。

## 本轮交付

小笼包收口褶皱与软肚、虾饺闭合半月皮/连续梳子褶、肠粉软卷边/层切口、葱油饼薄酥边/融入表面的烙斑、肉夹馍自然烤色/肉馅夹层、钵钵鸡蓝边钵碗/混合串物/红油芝麻、螺蛳粉白米粉/青菜酸笋/汤油分层、葡式蛋挞酥皮杯/奶黄烤色。

Flash提供三组连续造型与静态PBR颜色/粗糙度图。根用真实基准节点修复冻结抓握点，保留密集源网格，并执行真实Cycles selected-to-active NORMAL烘焙。高细节源与运行GLB分别保存；GLB只含低运行网格。肉夹馍/虾饺最终使用网格法线，重叠UV上的法线bake保留作制作证据而不启用；其他六款使用低强度烘焙法线。未声称所有颜色贴图都来自高低模烘焙。

内置image_gen生成两张独立颜色纹理：奶黄自然焦斑与白吉馍自然烙色；属美术颜色图，非实拍或测量albedo。原PNG、512WebP、完整提示词和SHA已保留，未覆盖原材质源。提示词见 asset-authoring/snacks/hero/prompts.json。

## 实际验收及修复

- 模型对照原冻结世界节点检查，修复施工样板的support/content/bite偏移。
- 小笼包原先筷尖距离正确但实物距嘴83mm；将工具包本体置于真正夹点。小笼包、钵钵鸡实际三角表面到嘴复核约5.69mm/1.03mm，不只检查锚点或包围盒。
- 加强真实toolFood边界到嘴断言，保留实际RED/GREEN证据。选中段只有一处持有，回落时不重现；器皿固定，UUID复用。
- 修复Blender材质槽clear重绑令poly.material_index归零：保存并恢复polygon索引，螺蛳粉/钵钵鸡不再全部同色。新增实际primitive材质检查与全归红油的阴性对照。
- 葱油饼手持厚度回归至15mm以内；虾饺截面改为spine正交，消除包皮交叠和前侧裸馅；肉夹馍改自然烤色与连续投影，移除放射纹。
- 八款GLB格式/低模/内嵌贴图/20k三角形、1.5MiB、8材质预算通过；真实48GLB吃法必要回归、原客户端构建和图鉴/静态导出检查通过。
- 八款实际F进食录屏与两款夜间效果无页面错误。艺术查看使用隔离测试取食入口，未声称重新走完48摊位路线或全城物理验证。

Codex sol初审发现入口与材质退步，后因模型capacity转已获机主授权的Astra收口；原报告与失败保留。限定复核无剩余阻塞。非阻塞余项：更细的熟粉皮、肉丝/馅料体积、自然酥皮剥落和汤油反光，未将本批写成全部48味最终美术定稿。

## 观看与恢复

审阅页与原始证明：`/home/baibai/outbox/pawborough-food-refinement-20261003/hero/review.html`，含八款实际前后、吃法录屏与恢复说明。source/high .blend及bake图位于该目录final-v2；原施工与返修版本保留。

恢复清单：docs/FOOD-HERO-ASSETS-20261004.json。runtimeAssets复制至runtimeModule，sourceAssets复制至仓库根；核SHA后使用。所有生成二进制另存outbox，未仅留在临时worktree。源码与冻结inputs在 asset-authoring/snacks/hero。

重建：先运行三组dough.py/crisps.py/wet.py，再运行finalize.py，均使用已安装Blender4.5与显式--python-exit-code1。真实bake和最后材质选择按finalize.py执行。检查命令：`npm --prefix scene-authoring/yuyuan-area run test:hero-foods`。
