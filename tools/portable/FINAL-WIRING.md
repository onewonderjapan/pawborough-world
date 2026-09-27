# 最终候选接线（主控执行一次）

附加运行项配置：`tools/portable/world-v1-runtime-paths.json`。`--runtime-paths` 是现有 R1–R6 闭包的附加项；每项 path/why 记录为 R7，仍须真实文件/hash、相对安全路径、缺件非零。不会替换原闭包或靠 viewer 假 fetch 扩充。

本版源码配置：`tools/portable/world-v1-source-paths.json`。包含既有 area/src、G5根入口/说明/生成器、控制层相机/渲染/校验源码、冻结布局、塔楼参数及第三方许可；不含旧 artifacts、截图、LFS指针或个人配置。控制层复导源码在包内不等于已经安装 Blender/Python 或已经在 W2 渲染。

先确保 `FINAL_OUT/candidate-version.json`、`fangbang-route.json`、`control-shots.json` 真实存在。候选描述可保留 restore pending，不能为封包提前填写恢复 PASS。最终描述生成命令见 `docs/CANDIDATE-HANDOFF.zh-CN.md`，构建源码 HEAD 与本次打包 HEAD 分开。

变量由主控填写：`SOURCE_REPO`、`FINAL_HEAD`（所有源码合并后的完整SHA）、`FINAL_OUT`（已冻结运行时）、`PKG_DIR`（不存在/空）、`RESTORE_DEST`（真正空目录）、`EVIDENCE_DIR`、`NPM_CACHE`（已授权本机缓存）、`CHROME1234`（明确浏览器可执行文件）。

```bash
node "$SOURCE_REPO/tools/portable/pack.mjs" --repo "$SOURCE_REPO" --head "$FINAL_HEAD" --out-dir "$FINAL_OUT" --manifest "$FINAL_OUT/zones-manifest.json" --out "$PKG_DIR" --source-paths "$SOURCE_REPO/tools/portable/world-v1-source-paths.json" --runtime-paths "$SOURCE_REPO/tools/portable/world-v1-runtime-paths.json" --source-cache "$NPM_CACHE" --tar

node "$SOURCE_REPO/tools/portable/verify.mjs" --package "$PKG_DIR.tar" --report "$EVIDENCE_DIR/package-verify.json" --keep-work

node "$SOURCE_REPO/tools/portable/restore.mjs" --package "$PKG_DIR.tar" --dest "$RESTORE_DEST" --source-cache "$NPM_CACHE" --port 5606 --browser-executable "$CHROME1234" --evidence-dir "$EVIDENCE_DIR/restore" --keep-tar-work --check-and-exit

RESTORED_OUT="$RESTORE_DEST/scene-authoring/yuyuan-area/$(basename "$FINAL_OUT")"
node "$RESTORE_DEST/_restore/portable/candidate_walk_smoke.mjs" --root "$RESTORE_DEST" --out-dir "$RESTORED_OUT" --port 5606 --browser-executable "$CHROME1234" --evidence-dir "$EVIDENCE_DIR/candidate-fangbang" --package-head "$FINAL_HEAD"
```

短 smoke 自己启动并记录唯一服务子 PID，结束只停这个子进程；headless 不继承 DISPLAY，不搜用户 display 或尝试额外浏览器。检查同源 candidate/state 实际200、状态清单hash/打包HEAD绑定、production WalkController 方浜锚点与6区物理齐备、资产/模块无错误。只验证起步，不调用巡游或输入链，不复跑 G2 完整路线；pending 的技术/人工状态不会被 smoke 自动提升。

若本次独立恢复后才更新 restore 收据/描述，旧封包里的描述仍是原字节。主控须将变化的描述重新纳入封包清单与 hash，并只补这处状态接线证明；不能把未打入包的新状态称为已恢复，也不需要仅因描述变化重跑不变路线/控制层。

fixture 留存：原113行日志实物在本单 artifacts/portable-fixtures-record-original.jsonl，源文件取消Git跟踪但未删除；以后 portable 测试写 ART_DIR 或 os.tmpdir()/pawborough-portable-retained。parity selftest 保留本次微型样本及记录；原worker已删除的旧微型文件无法声称仍在，可由生成代码复现。G3旧成功证据按真实 `restore-report-8.json` / `core-cold-load-7.json` 引用，不用错误的手写-3或手填时间。
