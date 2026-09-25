# PERF-W2：在 W2 上跑 Pawborough 性能采样（?perf=1）

M4 新增：viewer 支持 `?perf=1`，自动完成「首次加载计时 → 60 s 轨道 → 60 s 巡游步行
（CruiseDriver，与步行同一条 WalkController 输入链）」的帧时采样，结束时在页面右下角
显示结果并提供「复制 JSON」按钮。实现：`web/perf.js`（挂接点 `web/main.js` / `web/walk.js`）。

## 采样内容

- `loadCompleteMs`：从导航开始到分区加载完成（`window.__ready`）的毫秒数。
- `orbit` / `walk`：各 60 s 的逐帧间隔（rAF 间隔，含 vsync/合成），
  给出 `frames / p50Ms / p95Ms / meanMs / minMs / maxMs / fpsP50`，阶段结束时的 JS 堆内存。
- `gpu`：`WEBGL_debug_renderer_info` 的 renderer / vendor 字符串 + WebGL 版本。
- `memory`：`performance.memory`（Chromium 系才有；其他浏览器为 null）。
- `renderer`：稳定后一帧的 drawCalls / triangles。
- `walkRoute`：巡游走的商业路线（`commercial-route.json` 里最长的一条，默认 `main` 出发）。

总耗时 ≈ 加载 + 2 分钟。结果同时挂在 `window.__perfResult()` 供脚本取。

## W2 上怎么打开

前提：W2 上已有仓库工作副本（含 `scene-authoring/yuyuan-area/out-zone` 产物与
`node_modules`）。5489 是 W2 的惯用端口。

```bash
# 1) 在 W2 上起服务（已起着服务可跳过）
cd <仓库>/scene-authoring/yuyuan-area
PORT=5489 OUT_DIR=out-zone node scripts/server.mjs

# 2) 在你的电脑上建 SSH 隧道（推荐，不用把服务暴露到网上）
ssh -L 5489:localhost:5489 <w2主机>

# 3) 本机浏览器打开
http://127.0.0.1:5489/?perf=1
```

不想用隧道时的临时办法：在 W2 上临时绑外网地址
`PORT=5489 HOST=0.0.0.0 OUT_DIR=out-zone node scripts/server.mjs`，
防火墙只对你的 IP 放行 5489，采完即关（viewer 不写任何数据，只有只读 GET）。
若 `server.mjs` 不支持 `HOST` 变量，用 `socat TCP-LISTEN:5490,fork TCP:127.0.0.1:5489` 类似方式临时转发。

## 怎么把结果发回

1. 采样结束（右下角出现结果面板）→ 点 **「复制 JSON」** → 粘贴给主管 / 存进工单；
2. 或者在控制台 `copy(JSON.stringify(window.__perfResult(), null, 1))`（DevTools）；
3. 或直接截图右下角面板。

## 注意

- **swiftshader / 转发环境下的数字不代表真实性能**（软件渲染 + 无 vsync，帧时会明显偏离）。
  看真实性能要在 W2 的实体/真 GPU 环境开硬件加速跑。
- 采样期间不要动页面（轨道相位会接管相机；步行相位是自动巡游）。
- 巡游需要物理碰撞世界（首次进入步行会构建，多花几秒到几十秒，不影响帧时统计——它发生在计时开始前）。
- `?perf=1` 可以和其他参数叠加（如 `?perf=1&zone=all`），但协议默认值是 core 视图。
