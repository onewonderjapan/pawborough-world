# kit — 配置化共享构件样板（N3）

从一栋普通店宅（冻结 plain-v1 形制）做 config.json 驱动的样板，并把两个确实跨模块族
共用的构件抽为参数化组件。这是候选生产线，不自动替换 13 栋冻结基线；主控看图与机主
采用另行记录。

## 溯源

- `mb_lib.py` / `helpers.py` / `textures/`：字节级快照自
  `pawborough-world-validation-zcode-20260913/workspace/building/`（mb_lib.py sha256
  `f86ac38c8458cef6845faf309450e8e9966d0ae0bec6b4d1ac0301229c9c0638`）。原目录只读。
- 参数组织方式（单一 config + validate() 拒绝坏参数组合）参考
  `pawborough-shikumen-method-proof-20260912/research/modkit-source/scripts/kit_config.py`
  （CC0）。其默认 4m MODULE 等是通用样例参数，**不是**上海史实尺寸，未采用。
- 形制全部来自冻结构建器（plain-v1 / legacy cloth+pharmacy / corner），不新设计地标。

## 共享构件（kit/components.py）

| 构件 | 冻结出处 | 参数 |
|---|---|---|
| `street_post` | plain(2柱)/legacy(4柱)/corner(3柱) 的临街木柱（+可选柱脚石） | 位置、柱高、截面、有无柱脚石 |
| `upper_window_band` | 全部模块族的上层窗带（槛墙+窗颊墙+窗+横带墙） | 窗型 shutter/ornate、数量、窗宽高、标高 |

## 配置

- `plain-shop-a.config.json` — 与冻结 plain-v1 同参数（开间 12.0 × 深 6.4 m，檐高 6.8，
  脊高 8.0，2 层，4 樘板窗，直坡顶，主副招牌）。**复现校验：7596 三角与冻结完全一致，
  11 个碰撞件名称与中心逐一相同。**
- `plain-shop-b.config.json` — 可配置性证明：10.7 m 窄开间、3 樘 ornate 幌窗、ornate
  曲线屋顶、无招牌、脊高 8.4 → 6696 三角，形态合法。
- validate() 拒绝坏组合（层数≠2、高度栈乱序、门高于槛墙、窗带溢出、窗开口重叠、未知
  窗/顶类型、柱数≠2）。

## 运行

```bash
blender -b --factory-startup -t 4 -P kit/build_sample.py -- \
  --config kit/plain-shop-a.config.json --out kit/out/plain-shop-a
blender -b --factory-startup -t 4 -P kit/render_compare.py -- \
  --input kit/out/plain-shop-a/model.glb --output-dir kit/out/plain-shop-a/renders
# 冻结原件同机位对照：
blender -b --factory-startup -t 4 -P kit/render_compare.py -- \
  --input building/plain-v1/model.glb --output-dir kit/out/plain-v1-frozen-renders
```

输出与 13 冻结模块同约定（finalize）：model.blend/glb、collision.json、materials.json、
measurements.json（含 sha256）、reimport-check.json、config-used.json、renders/（正面/
侧面/斜视 × 写实/灰模，含 cameras.json 机位记录）。渲染为 Cycles CPU、AgX、日光，
与 scripts/render_segment.py 同口径。

## 同机位对照结论（技术离线对比，非主控验收）

- 样板 A（plain-shop-a）与冻结 plain-v1：三角数一致（7596）、碰撞件一致（11/11，中心
  ≤2cm）、同机位写实图逐像素级一致（屋顶斜视与正面均一致）。字节差 40/1953264
  （0.002%，导出元数据级）。
- 样板 B（plain-shop-b）：仅由配置产生合法窄开间变体，证明配置驱动成立。
- `kit/debug_boxdiff.py` 是排查用的逐盒计数包装器（临时工具，不属于交付管线）。

## 后续迁移（须逐个、留版本、不覆盖基线）

同类旧构件可逐个迁入共享实现；每个版本保留；机主未采用的候选不覆盖 `building/`
冻结基线。庙宇/玄扈台飞檐等缺主控形制设计的构件不在本 kit 范围。
