# 证据索引 · temple-shanmen

全部位于本worktree内并随分支提交（LFS）。WebGL=浏览器真实输出；Blender=Cycles CPU 离线渲染；两者相机同源（world/temple-shanmen/cameras.json）。

## Blender 渲染（kit/out/temple-shanmen-renders/）

| 文件 | 大小 | 说明 |
|---|---|---|
| `kit/out/temple-shanmen-renders/doorway-pbr-glb.png` | 1434 KB | 门洞通行内景 |
| `kit/out/temple-shanmen-renders/front-clay-glb.png` | 1223 KB | 正面·灰模（四要素同读检查） |
| `kit/out/temple-shanmen-renders/front-pbr-glb.png` | 1471 KB | 正面·材质（GLB重导入几何） |
| `kit/out/temple-shanmen-renders/front-pbr-native.png` | 1471 KB | 正面·native blend（与GLB版同机位对照） |
| `kit/out/temple-shanmen-renders/quarter-left-clay-glb.png` | 1234 KB | 三分之四左·灰模 |
| `kit/out/temple-shanmen-renders/quarter-left-pbr-glb.png` | 1569 KB | 三分之四左·材质 |
| `kit/out/temple-shanmen-renders/quarter-left-pbr-native.png` | 1569 KB | 三分之四·native blend（同上） |
| `kit/out/temple-shanmen-renders/rear-inferred-pbr-glb.png` | 1389 KB | 背面（推断设计） |
| `kit/out/temple-shanmen-renders/roof-pbr-glb.png` | 1398 KB | 檐角/屋顶（脊吻候选剪影） |
| `kit/out/temple-shanmen-renders/street-eye-pbr-glb.png` | 1499 KB | 街面平视 |

同机位对照结论：mean|d|=0.057/255（front）、0.05/255（quarter-left），>8级差异像素≤0.003%。

## WebGL 实测图（kit/out/temple-shanmen/web/，随图遥测JSON）

最新PASS轮8张（每张同名.json为页面遥测：相机核验 dPos=0/dFov=0、资源量、通行检查结果）：

| 文件 | 说明 |
|---|---|
| `kit/out/temple-shanmen/web/temple-doorway-pbr-1789439817991.jpg` | doorway · 材质（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-front-clay-1789439814196.jpg` | front · 灰模（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-front-pbr-1789439812961.jpg` | front · 材质（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-quarter-left-clay-1789439816027.jpg` | quarter · 灰模（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-quarter-left-pbr-1789439815126.jpg` | quarter · 材质（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-rear-inferred-pbr-1789439819630.jpg` | rear · 材质（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-roof-pbr-1789439816983.jpg` | roof · 材质（页面保存实测图） |
| `kit/out/temple-shanmen/web/temple-street-eye-pbr-1789439818797.jpg` | street · 材质（页面保存实测图） |

另有首轮同文件名更早时间戳（页面通行判据bug轮，几何相同）一并保留为失败记录；两轮差异见 DELIVERY.md。

## 侧车与数据

| 文件 | 内容 |
|---|---|
| `kit/out/temple-shanmen/measurements.json` | 四目标 tris/bytes/sha + 预算实绩 |
| `kit/out/temple-shanmen/collision.json` | 29条碰撞体（世界OBB格式）+ 净走廊断言 |
| `kit/out/temple-shanmen/reimport-check.json` | 逐GLB重导入：材质/贴图连接/色彩空间/边界 |
| `kit/out/temple-shanmen/config-used.json` | 施工所用配置全文+sha |
| `kit/out/temple-shanmen/materials.json` | 材质与贴图来源（含匾额字体来源） |
| `world/temple-shanmen/review-manifest.json` | 数据集清单（页面/测试/构建白名单消费） |
| `world/temple-shanmen/perf-notes.json` | 页面真实载入遥测 |
| `kit/out/temple-shanmen-renders/cameras.json` | Blender review侧车（每机位验证fov） |
| `kit/out/temple-shanmen-renders/compare-cameras.json` | native对照侧车 |

复跑命令见 artifacts/temple-shanmen/RESULT.json 的 rerun 段。

