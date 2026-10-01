# Pawborough v1.0 版本接收与取证

本页为 S1 执行交付说明，管理正本仍在 W2。v1.0 已于 2026-10-01 封版，源码与标签已推送；三地标已逐项采用，W2 已完成真 GPU 自动巡游实测。测试构建、范围和限制见 [V1-RELEASE.md](V1-RELEASE.md)。9/19 的历史 adopt_all 不适用于本版，Windows 离线包启动仍未实测。

## 打开本版场景

从仓库根执行 `OUT_DIR=out-zone npm run area:serve`，默认端口 5486。若使用独立工单运行时，再由主控明确对应 OUT_DIR 与端口。入口与查看器共用区域服务器，使用实际打印的地址；不用旧 localStorage 端口。

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

## 已有验收与后续复核

1. **W2 性能与巡游**：2026-09-30 已完成 RTX 3080 Laptop、Chrome headless 真 GPU、1080p、main→gold 60 秒自动巡游。机主已批准以此代替亲手步行，见 [OWNER_DECISION-w2walk-20260930.json](OWNER_DECISION-w2walk-20260930.json) 与 [W2 实测记录](perf/W2-RESULTS-20260930.md)。该构建早于最终封版，不扩展为所有路线或新构建的性能证明。
2. **地标采用**：湖心亭、大假山已于 2026-09-30 采用，修改后的九曲桥已于 2026-10-01 采用，见 [地标决定](OWNER_DECISION-landmarks-20260930.json) 与 [九曲桥决定](OWNER_DECISION-jiuqu-20261001.json)。不重复请求已完成的采用；新角色和新美术仍按新范围确认。
3. **资产归档**：本版登记资产和回执引用见 [MIGRATION-ASSETS.json](MIGRATION-ASSETS.json)，已有同机隔离恢复演练。后续下载或上传需使用当次已获授权的身份；SSO 是否有效现场检查，不把旧过期记录当成当前状态。

需要复核步行时，按方浜街段 → 山门 → 庙内后院 → 原山门返出 → 商城 → 豫园入口及返程检查。不使用调试传送，不假定已有庙后门；只复核受改动影响的路线，并记录构建、输出清单、位置和原始证据。

### 入口待办文案的已知滞后

`tools/candidate-entry/generate.mjs` 仍默认生成封版前的 `ownerTasks`，并将 `adoption` / `archive` 标为 pending。这些字段不自动同步远端标签或机主决定；当前本版入口也保留这一旧文案。封版已完成，应以 `v1.0` 标签、版本记录、逐项决定与归档回执为准，不因页面文案重做采用或推送。后续若修生成工具，应另验证状态绑定规则，不能直接将所有新候选标成已采用。

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
