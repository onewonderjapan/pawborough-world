# START HERE — lane-b-polish v7 候选速览

> 全量细节见 `DELIVERY.md` / `RESULT.json`；本文件只回答"东西在哪、怎么开、信什么"。

## 是什么

B 弄收口 + 双弄堂运行基线候选 `world/fangbang-temple-v7`（基线 `ec2ab2f` 派生，A 弄字节不动）。
修复了 v6 上实测的 B 口两处坐标缺陷与地面空洞，B 模块按 SPEC 精修并把 8044 降到 3770 tris；
新增两配置真实运行基线与独立 dist。

## 30 秒打开

```bash
cd workspace
npx vite --host 127.0.0.1 --port 5400 --strictPort
# 浏览器: http://localhost:5400/fangbang.html?ds=fangbang-temple-v7
# 全开:   ...&skins=1&props=1
```

看 B 弄：出发后沿主街东行至 x≈57，南拐进入 B 弄口（对照机位 `lane-b-street-mouth`）。
A 弄照旧（x≈43.5 北拐）。

## 信什么（证据链）

1. **缺陷先证后修**：`artifacts/lane-b-polish/baseline/measure-before.json`（v6 上 5 FAIL）→ `verify/measure-after.json`（6 PASS）。
2. **能走**：`verify/walktest-v7.json` — 生产 WalkController+Rapier，26 项测试 0 失败，覆盖网格 1209 采样 0 空洞，接缝台阶 ≤2cm；含 A 弄回归原坐标。
3. **A 没动**：接口 A 区 691 三角（顶点/UV/材质）与 v6 全等 + lane-a GLB sha 不变（`tests/lane-b-polish.test.mjs` 断言）。
4. **预算是真的**：页面自计数 694430（默认 ≤700k）/ 708066（全开单列），dist 独立运行复现同数。
5. **运行基线**：`runtime-baseline.json` — SwiftShader 软件基线，P50 16.7/P95 16.8ms，加载阶段/首帧/资源循环全录；**不**据此宣称硬件 60FPS。

## 常用复验

```bash
node --test tests/lane-b-polish.test.mjs   # 本批 9 项
node tools/lane_b_polish_walktest.mjs      # 双弄堂行走
python3 tools/lane_b_polish_measure.py --phase after
```

## 停在哪

`delivered_for_lead_review`，ownerAdopted=false。机主看图/报告后决定采用或继续（P5/P6 另批）。
本批不再自动推进、无监视进程。
