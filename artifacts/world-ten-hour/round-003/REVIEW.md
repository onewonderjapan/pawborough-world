# REVIEW · world-ten-hour 批最终交付（2026-09-21，round 3 收口）

执行：ZCode GLM-5.3-Flash；分支 `work/world-ten-hour-20260921`（基线 `9e5d5c40`）；
三阶段连续施工（round 1 = A/B/C/D/E，round 2 = F 第一遍，round 3 = F 第二遍 + G）。
机主采用与否（ownerAdopted=false）待您决定；未合并、未发布。

## 怎么验收（30秒）

1. 解压 `delivery/world-ten-hour-20260921-r3.zip`（SHA 见同目录收据）到新目录，
   `python3 start-world-playable.py` → `world-preview.html`。当前交付为 -r3
   （round-005 重建：favicon 一行修复；-r2 与坏启动器初版保留在盘，收据链完整）。
2. 或在工作区 `npm run dev` 打开首页。四入口、双配置（普通/全开）、取景工具、
   错误面板均可试。

## 本批改了什么（全部在世界/几何零改动前提下）

| 项 | 内容 | 证据 |
|---|---|---|
| A 继承缺口 | UP-G1 清单改已提交树口径并 HEAD 导出核验 | round-1 `commits 3207ad4..5c4fc09`，evidence 测试 14/14 |
| B 玩家走查 | 姿态保持修复、Esc 提示；庙前朝向留机主 | round-1 walkthrough 12截图 |
| C 取景工具 | 保存/恢复/导出/6预设，localStorage 命名空间 | 单测 8/8 + 浏览器 27/27 |
| D 加载优化 | 唯一资产单飞缓存：请求 −32%、就绪 −24%、零像素漂移 | round-1 load-measure 前后数据 |
| E 错误恢复 | 16/16 探针（资源失败指名、单次重试、失焦清键、dt 无突跳） | round-1 error-recovery |
| F 稳定性 | 11 场景长测矩阵闭环（35min×3 + 62min×2 + 30min×3 + 12min×3），全部原始数据提交 | round-2/3/4/6 FINDINGS |
| G 便携交付 | 包重建（含启动器缺陷修正）、ZIP+收据、解包复验、源工程索引 | 本轮 delivery/ 与 source-index.json |

世界锁定区（world/**、building/**、kit/**、几何/碰撞/路线/相机契约、src/player）零改动；
保护基线 locked 0 mismatch（各轮提交时校验）。

## 长测结论（本轮新增，全部数字为 SwiftShader 软件基线口径）

1. **泄漏判定（round-2 遗留）：非泄漏**。default 62min post-GC 堆 +0.46MB/h、allOn 62min
   +0.32MB/h，前后半程斜率均减半趋平（+0.89→+0.18、+0.65→+0.12）；资源计数全程恒定、
   双预算精确锁定。
2. **帧口径修正**：round-2「60fps vs 2fps」是视图阶段错配；同口径 default p50=183ms vs
   allOn p50=250ms（1.4×）；loadavg 高企经 top 实证是 SwiftShader 自身多核光栅化，非外部干扰
   （round-002 FINDINGS 附记含两处诚实修正，原文保留）。
3. **暖启动**：本地同机下暖 HTTP 缓存不移就绪门（8,469 vs 8,463ms）——瓶颈在自检+解析。
4. **390 窄屏**：功能全正常；新发现低帧率中街北缘（x≈76–84）两次坠落（世界边界缺陷加重证据）。
5. **可复现楔点**：ms-303（[-130.5,28.1]）本轮 3/3 卡住，需后退绕行；driver 按玩家规则跳过。

> **矩阵收口更新（round-004/006 附记，原文保留）**：矩阵最终 11 场景闭环，含新条件
> default1920（S8）、templeFront 浸泡（S9）、allOn1920（S10：97/97 航点全完成、p50=483ms、
> 堆斜率 -0.986MiB/h 趋平——非泄漏第五独立条件）与 warm+templeFront（S11：暖门 9593→9490ms，
> 暖缓存结论在第二入口成立）。零代码变更；详见 round-004/round-006 FINDINGS。

## G 交付物清单

- 便携包：`dist-world-ten-hour-20260921-r3/`（构建器拒绝覆盖、可 `--repair` 只增修复）；
  ZIP + 外置 SHA 收据 `delivery/package-zip-sha256-r3.json`（round-005 重建，取代 -r2：
  唯一差异为三张页面 HTML 的 favicon data-URI 一行修复，消除每页一条无害 404 控制台噪音；
  -r2 收据与坏启动器初版产物保留未删，见 `delivery/LAUNCHER-DEFECT-FIX.md`）。
- 解包复验：`restore-world-ten-hour-20260921-r3/` 133 文件与 dist 逐字节一致，由**包内自带
  启动器**供服，smoke 全绿：游戏 26/26（四入口/预算 694430·708066 精确/无 WebGL 可操作
  fatal）、首页 15/15（双宽度无溢出、无绝对路径泄漏）、取景 27/27（保存/恢复/导出/6预设）、
  错误恢复探针 16/16（round-005 对 -r3 复跑；证据在 round-005 目录）。
- 源工程索引：`source-index.json`——74 源 .blend（0 未跟踪）、35 .blend1 备份单列、
  首页制作资料 4 项 SHA 全符、**Blender 无头重开实证 3/3**。
- 全套测试：139 用例，138 过；唯一失败是 evidence 测试的「工作树必须干净」诚实门在 G 成果
  提交前运行所致，提交后复跑通过。

## 尚需机主决定

1. 是否采用 fangbang-temple-v7（ownerAdopted）；「全开」超预算 8,066 三角形如何处置。
2. **虚空坠落防护**（本批最高优先建议）：桥东末端 + 中街北缘两处实证，建议 WalkSession
   落地安全网（y<-0.5 复位最后安全落点，同 routeCheck 规则）或街缘不可见边界；几何施工超
   本批授权。
3. 庙前出生朝向（round-1 B3）、ms-303 卡点街缘几何，随世界方批次处理。
4. 长测全部在无 GPU 软件基线完成；硬件实测需真实 GPU 机器，本批不代宣称。

## 已知边界

- 本机验证：headless Chrome + SwiftShader；帧率/停顿数字不代表硬件表现（页面也因此不作
  帧率宣传）。
- 触屏未扩展为移动控制；窄屏如实标注「需要桌面键鼠」。
- 网络场景（远程加载）的暖缓存收益未测，不宣称。
