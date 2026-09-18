# DELIVERY — 庙宇轴线扩展批（第一包）

批ID `pawborough-temple-expansion-night-20260917` · 2026-09-17 夜间施工（GLM-Flash）
状态 `delivered_for_lead_review` · `ownerAdopted=false` · `visualReview=pending_lead`
基线 4031561（work/fangbang-temple-bridge-20260916）→ 分支 `work/temple-expansion-20260917`

## 交付了什么

**第一包：庙轴线从"山门→大殿"扩成"山门→仪门(背面戏楼)→配殿院→大殿→侧通道→三进院→城隍殿"。**

- `world/temple-axis-v2/` — 13 GLB：7 件冻结拷贝（sha 对账逐字节）+ 二进院变体 + 5 个新模块
  （peidian 11,432 tris / gallery 1,134 / yimen-stage 7,212 / court3 4,552 / houdian 15,944）。
  246 条世界系碰撞（123 旧减去侧墙/北端墙/stub + 123 新，含 yaw ±π/2 四角复算 6 采样 ≤1e-6）。
  路线 22 冻结点 + 6 负例；10 机位照 CAMERAS.json 原样。
- `world/fangbang-temple-v2/` — 桥接世界 v2：街道/西延伸/占位原样，庙块换 15 资产 v2（同 T/yaw），
  457 条碰撞，路线延长到城隍殿前（temple-local z −71.8±0.4），blocks.json 庙块同步为 v2。
- 页面 `temple-v2.html + src/templeV2Main.js`（5298/5299）；`fangbang.html?ds=fangbang-temple-v2`
  （默认行为不变，实测默认回归 PASS）。
- 测试 6 套新增全绿：peidian/houdian/stage 合同、axis-v2 世界、axis-v2 通行（Rapier 全程+6 负例+返程+掉地）、
  桥接 v2 合同。全套 35 套：32 就位绿 + 3 套桥接套布局性失败（见下）。
- 证据：Blender 14+2 图（CPU 24spp AgX，fov 守卫，native-vs-GLB compare ×2）、WebGL 15 张
  （temple-v2 ×12 含 2 clay + 桥接 v2 ×3，cameraCheck dPos=0）、perf-v2.json（routePass、重载稳定）。
- dist：`scripts/build_temple_v2_dist.mjs`（标准 build + 两 v2 数据集，48 必需文件硬门），
  5299/5301 preview headless 双 PASS。

## 主控可否决预置（DESIGN_SPEC.ownerVetoablePresets 照录）

配殿硬山（不抄观音兜）· 城隍殿单檐硬山（G36 歇山读感未采用）· 戏楼贴仪门背面/台面 2.6/不可达 ·
边界墙 x±16.4 + 北端墙 −84.0（样段语言，非历史）· 三进院宽 32.8 · 匾额全部无字素板。

## 如实记录（knownDeviations，细节见 RESULT.json）

1. **Blender 焊接差异（fallback #6 类）**：二进院默认重跑与已交付 GLB 几何等价
   （三角形数/唯一顶点集/包围盒/17 条碰撞数值全等）但字节不同——本机 Blender 构建
   （git 快照 28c0962c45ac aarch64）对倒角角点的重复顶点焊接数不同（±2~4）。
   builder/helpers 自交付提交以来零改动（git log 为空）。
2. **戏楼净宽 5.74**：规格自己的"柱内侧 ±2.87"即 5.74；计划文本的"≥5.8"为同一冻结数字的圆整。
3. **负例 n3b 走 z=−26.6 柱排线**：规格写的 z=−27.5 恰从两排柱之间穿过，不可能被柱挡；
   意图（柱挡东行）保留并在 x=2.5 实测阻挡。
4. **court3 补铺两类地面**（设计推断填充，冻结数值无冲突）：开口带 z −41..−39.1 从楼梯边铺到
   街廊边（冻结路线 (0,−40.2)→(6,−40.2) 必经，否则悬空）；北条带 z −83.86..−72.2 铺地防坠落
   （与死角口袋同语言）。
5. **路线折线插入 z=−38.6 无挡墙走廊**：楼梯 cheek（x ±3..3.55）使折线反向必卡死；
   route.spec 保留冻结原点，dataset mainStreet 为可双向走的派生线。
6. **vite.config.js（允许修改文件）**：加 temple-v2.html 构建入口；evidence 命名正则放宽允许数字
   （数据集 id 含数字；超集改动，既有名称不受影响）。
7. **build_fangbang_v2_scene.py / tools/fangbang_v2_perf.mjs 为新建副本**：计划写的是给已交付脚本加
   --ds，但纪律禁止改这四个文件以外的已交付文件——纪律优先，已交付脚本零改动。
8. **G36 不可读**（root-owned，机主预检可选项未执行），城隍殿屋面按其余参照+主控裁决。
9. **桥接 v2 三角两口径**：156,250（按实例计，配殿/廊庑×2）与 143,976（按唯一资产计），两预算均守。
10. **端口**：5296/5297 被上一批会话残留服务占用 → 本批桥接 v2 用 5300/5301（fallback #9）；
    temple-v2 的 5298/5299 正常。

## 复跑指南

```bash
blender -b --factory-startup -t 4 -P kit/build_peidian.py    -- --config kit/peidian.config.json    --out kit/out/peidian
blender -b --factory-startup -t 4 -P kit/build_gallery.py    -- --config kit/gallery.config.json    --out kit/out/gallery
blender -b --factory-startup -t 4 -P kit/build_yimen_stage.py-- --config kit/yimen-stage.config.json --out kit/out/yimen-stage
blender -b --factory-startup -t 4 -P kit/build_court3.py     -- --config kit/court3.config.json     --out kit/out/court3
blender -b --factory-startup -t 4 -P kit/build_houdian.py    -- --config kit/houdian.config.json    --out kit/out/houdian
blender -b --factory-startup -t 4 -P kit/build_dadian_court.py -- --config kit/dadian-court-v2.config.json --out kit/out/dadian-court-v2
node scripts/build_temple_axis_v2_world.mjs && node scripts/build_fangbang_v2_world.mjs
node --test 'tests/*.test.mjs'   # 35 套（32 直接绿 + 3 布局性，见上）
```
