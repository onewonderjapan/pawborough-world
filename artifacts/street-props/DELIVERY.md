# DELIVERY — E 包：街道生活道具层（可撤销）

38 件 1990 年代街道道具 · `?props=1` 加载，默认关 · 整块可 revoke（G12）

## 内容
- 12 自行车（28 寸，沿墙停放）、10 板条箱（含 1 叠层）、6 竹篓、4 竹椅、6 顶布雨棚（仅 plain/curio/cloth 门面，y 2.85 无碰撞）
- 材质零新贴图；bamboo (#b8a468) 为 spec 准许的新单色材质
- 位置：39 门面锚定，距墙 0.25–0.9 m，路线走廊 ±1.2 m 外，每门面 ≤2 件，与 208 个世界碰撞体 SAT 零相交（E1 规划器 + P4 测试双验证）

## 数据
- `world/street-props/`：5 GLB（validator 0 错误；unique ≤1500）+ instances.json + collision.json + manifest
- placed 11,176 / 20,000 tris

## 页面
`fangbang.html?props=1&skins=1` 加载 38 件（页内 propsStats 可核）；默认不带参数 = 无道具层；三角形完整性校验仅在加载时计入 props。

## 测试
46/46 绿（+props_contract / +props_visibility：4 机位定向射线首命中道具）

## 证据
- `artifacts/street-props/web/`：4 视角 WebGL（真实页面）
- `artifacts/street-props/*.png`：2 视角 Blender（scene-v2 --props）

## GATE
G12：保留 / revoke / 改数量位置 —— 机主裁决。
