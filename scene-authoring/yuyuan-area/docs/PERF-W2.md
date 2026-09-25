
## wave4-drawcalls（2026-09-25）：W2 实机要看的数字

改动：`web/batching.js` 运行时按材质合批（three `BatchedMesh`，相邻可见区间并段），分区 GLB 与导出管线不动，
首载 GLB 字节不变；`?batch=0` 关闭合批（= 改前渲染路径），同一台机器上可直接 A/B。
`web/perf.js` 的 `renderer.drawCalls / triangles` 已改为**一帧**口径（旧值是两帧之和 = 2 × 每帧）。

headless swiftshader 下的口径参照（1400×900，同一 out-zone 产物；帧时不代表真实性能）：

| 视图 | 每帧 WebGL 调用 改前 → 改后 | multiDraw 子绘制 | 每帧三角面（改前 = 改后） |
|---|---|---|---|
| 核心首屏 `?zone=core&cam=oblique` | 2787 → 161 | 270 | 441,786 |
| 园区 `?zone=garden&cam=oblique`（其余分区照常全部加载） | 2787 → 161 | 270 | 441,786 |
| 导览 华宝楼（最重的机位） | 3635 → 194 | 305 | 629,315 |

注：当前首屏机位是按「最先加载完的分区 = garden」取景的，所以核心首屏与园区视图同一机位、数字相同。

在 W2 上请各跑一次并把两份 JSON 都发回：

1. `http://127.0.0.1:5489/?perf=1`（合批，默认）
2. `http://127.0.0.1:5489/?perf=1&batch=0`（改前渲染路径）

要看的字段：

- `renderer.drawCalls` / `renderer.triangles`：一帧口径；W2 上应与上表同量级（drawCalls 约 160，三角面约 44 万）。
  `drawCalls` 是 WebGL API 调用数，一次 `multiDraw` 算 1。
- `batching`：`batches`（批数）、`batchedMeshes`、`buildMs`（加载后合批耗时，swiftshader 约 160 ms）、
  `float32MB`（合批顶点 / 索引缓冲，约 45 MB——原件是量化数据，合批后是 Float32，显存占用会比改前大）。
- `orbit.p50Ms / p95Ms`、`walk.p50Ms / p95Ms`：两次运行对比，看合批后帧时是否下降。
- `gpu.renderer`：确认是 W2 的真显卡（ANGLE D3D11 字样），不是 SwiftShader。
- `loadCompleteMs`：合批会让加载多出 `buildMs` 左右。

未核实：W2 的 Chrome 是否暴露 `WEBGL_multi_draw`（swiftshader 下有）。没有时 three 会把每个 BatchedMesh 拆成逐段
`drawElements`，因为相邻区间已并段，调用数约等于上表「子绘制」列（核心首屏约 270），仍远低于改前。
ANGLE D3D11 上 multiDraw 在驱动层可能仍按段下发，所以驱动层绘制数也按「子绘制」列估计。
