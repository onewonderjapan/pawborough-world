# 世界 v1 候选：人工接收与取证

本页为 S1 执行交付说明，管理正本仍在 W2。当前候选未采用；9/19 的历史 adopt_all 不适用于本版。Windows 启动与真 GPU 性能尚未实测，以下为待机主执行步骤。

## 打开当前候选

先连接 S1，并取得主控指定的最终源码工作目录和完整运行时 OUT_DIR。入口与查看器共用区域服务器，使用服务器实际打印的地址；不用旧 localStorage 端口。

S1 在区域模块目录执行（示例端口由本单指定为 5605；最终交付可显式改 PORT）：

```bash
OUT_DIR=/绝对路径/最终运行时 PORT=5605 node scripts/server.mjs
```

W2 若已有到 S1 的 SSH 授权，可建立本地隧道。服务器保持 localhost，不需要开放公网：

```powershell
ssh -N -L 5605:127.0.0.1:5605 baibai@172.72.0.1
```

然后在 **W2 本机、开启硬件加速的 Chrome/Edge** 打开 `http://127.0.0.1:5605/candidate/`。连接失败时保存报错，请主控核对既有 SSH 授权和打印端口；不要另外启动未知服务器或批量终止进程。

若用主控提供的离线候选包在 W2 本地启动，先按该包的恢复说明验证完整文件和 hash，再使用兼容的 Node.js（本次 S1 验证为 22.23.2）及项目锁定依赖。PowerShell 只负责设置环境和启动：

```powershell
$env:OUT_DIR = 'C:\机主指定目录\完整运行时'
$env:PORT = '5605'
node scene-authoring/yuyuan-area/scripts/server.mjs
```

此路径和 Windows 执行尚未实测。不要新建知识库副本，不把生成物或未脱敏客户数据加入源码仓。

## 三项人工确认

1. **真 GPU 与亲走**：从候选入口“浏览核心区域”确认范围，再打开同源 `/?zone=core&perf=1`。等待页面完成既有性能采样，保存“复制 JSON”结果、renderer 字符串、浏览器/分辨率/日期及截图。检查 renderer 是 W2 真实 GPU；软件渲染或 S1 数字不算 W2 性能证明。既有自动性能巡游只覆盖它声明的商业路线。
   另外从入口“方浜街段开始步行”用 WASD 亲走：街段 → 山门 → 庙内后院 → 原山门返出 → 商城 → 豫园入口，然后返程。鼠标点击画面控制视角；轨道取景、回到锚点或调试传送不能算走通。记录卡住/掉地/穿墙位置、截图和最终候选标识。没有批准的庙后门，不穿墙直达园区。
2. **地标采用**：逐一确认湖心亭、九曲桥、大假山。技术 PASS 不等于美术采用；把机主的选择与当前候选标识记录到 W2 管理正本。
3. **S3 登录与归档**：历史 profile/bucket 已确认，但当前 SSO 过期。本单不执行云端操作。由机主登录既有身份，主控核对本版上传/下载/hash 回执后更新归档记录；历史回执不能充当本版归档。

## 版本状态生成（主控）

工具只写 `OUT_DIR/candidate-version.json`，不把本次最终 hash 硬编码进仓库 VERSION。`--build-head` 是运行资产构建的源 Git HEAD；`--package-head` 是本次打包源码 HEAD，可不同。缺证据默认显示未核实；`--strict` 在四类证据或文件 hash 不完整时非零退出。`--fixture` 显著标为验证样例，不能作为最终采用证明。

一类审查对应一份小收据：

```json
{
  "schemaVersion": 1,
  "kind": "walk",
  "candidateId": "机主指定候选标识",
  "buildHead": "完整40位构建源码hash",
  "manifestSha256": "最终zones-manifest.json的sha256",
  "status": "passed",
  "reusedFrom": "旧PASS的版本标识（如复用）",
  "reason": "明确说明几何保持证明和复用范围；不要求仅因源码head变化重走",
  "evidence": [{ "path": "原始PASS或几何保持证明路径", "sha256": "实际文件hash" }]
}
```

`kind` 为 technical/walk/control/restore；`status` 为 passed/pending/failed。证据路径可相对收据或显式绝对路径。工具验证当前候选/HEAD/manifest 绑定与引用文件 hash；主控负责审查结论及几何不变复用的合理性。不会把旧 ownerAdopted、adopt_all 或云回执直接传播到本版。

最终真实绑定的一条命令（变量由主控按真实交付填写）：

```bash
node tools/candidate-entry/generate.mjs --candidate-id "$CANDIDATE_ID" --build-head "$BUILD_HEAD" --package-head "$PACKAGE_HEAD" --out-dir "$FINAL_OUT" --manifest "$FINAL_OUT/zones-manifest.json" --technical-receipt "$TECH_REVIEW" --walk-receipt "$WALK_REVIEW" --control-receipt "$CONTROL_REVIEW" --restore-receipt "$RESTORE_REVIEW" --output "$FINAL_OUT/candidate-version.json" --strict
```

刷新同源 `/candidate/` 检查版本。原 `/` 查看器不依赖 candidate-version.json；状态文件缺失时仍可打开查看器，候选页显示未核实。
