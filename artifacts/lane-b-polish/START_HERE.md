# START HERE — lane-b-polish v7 候选速览（含 2026-09-20 证据补修）

> 全量细节见 `DELIVERY.md` / `RESULT.json`；本文件只回答"东西在哪、怎么开、信什么"。
> 证据补修（B7-R1/R2）后的运行基线与清单为本文件所述版本；建筑/物理结论未变。

## 是什么

B 弄收口 + 双弄堂运行基线候选 `world/fangbang-temple-v7`（基线 `ec2ab2f` 派生，A 弄字节不动）。
修复了 v6 上实测的 B 口两处坐标缺陷与地面空洞，B 模块按 SPEC 精修并把 8044 降到 3770 tris；
运行基线在主控复核后**撤回重做**：旧工具转向读错维度从未完成约定环路，已修工具并两配置重测。

## 30 秒打开

```bash
cd workspace
npx vite --host 127.0.0.1 --port 5402 --strictPort
# 浏览器: http://localhost:5402/fangbang.html?ds=fangbang-temple-v7
# 全开:   ...&skins=1&props=1
```

看 B 弄：出发后沿主街东行至 x≈57，南拐进入 B 弄口（对照机位 `lane-b-street-mouth`）。
A 弄照旧（x≈43.5 北拐）。

## 信什么（证据链）

1. **缺陷先证后修**：`baseline/measure-before.json`（v6 上 5 FAIL）→ `verify/measure-after.json`（6 PASS）。
2. **能走**：`verify/walktest-v7.json` — 生产 WalkController+Rapier，26 项测试 0 失败，覆盖网格 1209 采样 0 空洞，接缝台阶 ≤2cm；含 A 弄回归原坐标（主控已复验冻结）。
3. **A 没动**：接口 A 区 691 三角（顶点/UV/材质）与 v6 全等 + lane-a GLB sha 不变（`tests/lane-b-polish.test.mjs` 断言）。
4. **预算是真的**：页面自计数 694430（默认 ≤700k）/ 708066（全开单列），dist 独立运行复现同数。
5. **运行基线（补修后）**：`runtime-baseline.json` + `evidence-repair/raw/` 全量原始样本——两配置**实际走完**
   主街西行→A 弄进出→回东→B 弄进出→返回起点的 230m 环路（default 338.1s / all-on 390.8s 有效连续行走，
   107/107 航点、0 暂停 0 跌落）；加载时钟 timeOrigin 口径三字段可复算；帧统计由原始样本独立重算
   （SwiftShader 软件基线 P50 350/433ms，开放街景真实负载，**不**据此宣称硬件 60FPS）。
   旧结论已撤回：`evidence-repair/previous/`（原因：转向读 `tgt[2]` 恒 NaN，从未完成约定负载）。
6. **清单是真的**：`delivery-manifest.json` 由 `tools/lane_b_delivery_manifest.mjs` 生成并逐条实校验，
   排除自身无哈希循环；SHA 见外层收据 `evidence-repair/delivery-receipt.json`。

## 常用复验

```bash
node --test tests/lane-b-evidence.test.mjs   # 证据补修 13 项（转向负例/卡住判定/样本复算/清单正负例）
node --test tests/*.test.mjs                 # 116/116
node tools/lane_b_polish_runtime.mjs         # 两配置真实路线重测（~13 分钟）
node tools/lane_b_delivery_manifest.mjs verify
```

## 停在哪

`delivered_for_lead_review`，ownerAdopted=false；主控尚未复验补修结果。机主看图/报告后决定采用或继续。
本批不再自动推进、无监视进程。
