
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

## wave11-lighting（2026-09-27）：灯光预设 / 太阳阴影 / 夜间点光的成本

查看器灯光由 `web/lighting.js` 按 `lighting/presets.json` 建（`?light=day|dusk|night`，默认 day；`?shadow=0` 关阴影）。
测量脚本 `scripts/lighting-perf.mjs`（每配置一个新页面；每帧调用 = 独立 WebGL 计数，含阴影通道；渲染 = 强制连续 render 20 次、
每次 readPixels 1 像素后的中位数）。**headless swiftshader，且测量时同机另有训练 / 其他浏览器检查在跑，帧时只作同一次运行内的相对比较**：

| 配置 | 核心首屏 每帧调用 / 子绘制 / 三角面 | 华宝楼导览 调用 / 渲染中位 ms | 三穗堂导览 调用 / 渲染中位 ms |
|---|---|---|---|
| 改前（2afa10db） | 262 / 303 / 88 万 | 255 / —（rAF 567） | 73 / —（rAF 1117） |
| day `?shadow=0` | 263 / 304 / 88 万 | 256 / 795 | 74 / 272 |
| day（默认，阴影开） | 479 / 550 / 187 万 | 379 / 1142 | 178 / 574 |
| dusk | 479 / 541 / 187 万 | 392 / 1170 | 202 / 408 |
| night `&plights=0`（只有自发光） | 479 / 547 / 187 万 | 386 / 1023 | 190 / 477 |
| night（默认 8 盏点光） | 479 / 547 / 187 万 | 386 / 1259 | 190 / 821 |
| night `&plights=16` | 479 / 547 / 187 万 | 386 / 1804 | 190 / 865 |

- **阴影**：一张 2048² PCFSoft 太阳阴影贴图，正交阴影相机跟随取景焦点（轨道 = 注视点，半宽 = 距离 × 0.9，夹在 40–420 m；
  步行 = 中心在视点水平视线前方 27 m、半宽 45 m）。代价 = 多画一遍投影网格：核心首屏每帧调用 263 → 479、三角面 ×2.1；合批的 BatchedMesh 直接投影，
  所以阴影通道的调用数也是合批后的量级（仍 ≤ 1200 预算，`tests/lighting-check.mjs` S4）。swiftshader 下渲染耗时约 +45%（华宝楼 795 → 1142 ms）。
- **点光**：three 的点光按灯数展开进每个着色器（改灯数要重编译，逐像素逐灯计算），所以夜间用固定大小的「点光池」：
  灯数只在切换预设时变，池里的灯每 15 帧（或焦点跳变 > 11 m 时当帧）分给离取景焦点最近的候选（灯笼材质聚类 75 处 + 摊位 51 处）。
  实测相对只开自发光：8 盏 +23%（华宝楼 1023 → 1259 ms）、16 盏 +76%（→ 1804 ms），**上限定为 8**（`presets.json pointLights.max`，
  lighting-check S0 断言 ≤ 8）。点光不投影。
- **自发光**（灯笼 / 店招 / 店面后壁 / 窗玻璃 / 格扇背板 / 摊柜）：只改共用材质的 emissive，合批网格同步生效，不增加绘制调用。
- **天空**：运行时生成 256×128 等距柱状 DataTexture，不下载贴图。首载非场景字节 7,535,696 → 7,561,279（+25.6 KB：
  `web/lighting.js` 16.5 KB + `lighting/presets.json` 6.0 KB + main / index / perf 改动），在 ≤ 50 KB 的预算内。
- **预设读取**（R1）：分区加载排在 `lighting/presets.json` 之后，读取上限 3 s（`PRESETS_TIMEOUT_MS`）。超时 / 404 / 解析失败 /
  字段不全 → 旧灯光（无阴影、ACES 1.05）照常加载；超时不取消请求，迟到的合法应答会再切到预设（`__lighting.state().lateApplied`，初始化成功后才置 true）。
  等待期间在下拉框选的预设会被记下，迟到升级按它初始化；下拉框与地址栏 `?light=` 随每次成功应用同步（R2）。
  swiftshader + 高负载下实测过一次本地 6 KB 文件 15.6 s 才轮到回调（lighting-check R1 日志），所以 W2 上若首屏偶见旧灯光一闪属此机制。
- `?perf=1` 的 `renderer.drawCalls / triangles` 现在是**含阴影通道的一整帧**（three r180 在 `render()` 里先画阴影贴图、后清零
  `renderer.info`，旧读法开阴影后只剩主通道，P1 对账会差一半）；另报 `renderer.shadowPass`（阴影通道那部分）、`renderer.includesShadowPass: true`（口径标记：
  字段缺失时口径未知——wave11 之前的报告不含阴影通道，2df32f06–200bb246 之间的报告已含阴影通道但尚无此字段，需结合版本或原始记录判断）与 `lighting`（预设 / 阴影 / 点光数）。W2 上核心首屏应看到 drawCalls 约 480、其中 shadowPass 约 215。

在 W2 上请再各跑一次并把 JSON 发回（与上面 wave4 那两份同一页面、同一机位）：

1. `http://127.0.0.1:5489/?perf=1`（day + 阴影，默认）
2. `http://127.0.0.1:5489/?perf=1&shadow=0`（关阴影对照）
3. `http://127.0.0.1:5489/?perf=1&light=night`（夜间 8 盏点光 + 自发光）

要看的字段：`orbit.p50Ms / p95Ms`、`walk.p50Ms / p95Ms`（1 对 2 = 阴影成本，1 对 3 = 夜间成本）、`renderer.shadowPass`、`lighting.pointLights`。
未核实：W2 真显卡上阴影的相对成本（swiftshader 的 +45% 主要是光栅化，真显卡上通常小得多）；若 W2 上阴影明显拖慢步行，
可先把 `viewer.shadow.mapSize` 降到 1024，或让阴影贴图只在焦点移动时重画（`shadow.autoUpdate=false` + 按需 `needsUpdate`，本波未做）。
