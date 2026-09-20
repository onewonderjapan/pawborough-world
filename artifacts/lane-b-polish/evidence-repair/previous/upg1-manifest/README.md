# UP-G1 修正快照（2026-09-21，world-ten-hour 批）

这里保存的是 lane-b-polish 交付清单与其外层收据的**修正前原版**，未做任何改写：

- `delivery-manifest.pre-fix.json` — sha256 `ccc2774e0957a25c35425e8537640524a86689a7d607e618310818112aa55261`（73 files，84662429 B）
- `delivery-receipt.pre-fix.json` — sha256 `ada47e58b2a5f264b4900a9ca66f118e38506323ffafd8868ddd53322f9bdfe6`

## 修正原因（UP-G1）

上游 lane-b-polish 批（worktree `pawborough-lane-b-polish-20260920`，提交 68f10ea）的
`tools/lane_b_delivery_manifest.mjs` 按文件系统目录扫描生成清单，把
`world/lane-b-polish/{interfaces,lane-b}/model.blend1` 两个 **gitignore 的 Blender
自动备份**（`.gitignore:31`）也列为交付条目。这些文件从不进入提交树，因此清单对
已提交树验证必然失败（2 条 missing + totalBytes 差额 13002238 B）；真实负载
（GLB/JSON/blend，71620191 B）全部字节相符。当时以 UP-G1 如实登记未代改
（见 `artifacts/world-playable/UPSTREAM-INHERIT.json`）。

## 本批修正内容（world-ten-hour-20260921，经机主 PLAN §A 授权）

PLAN 明确授权："可修本worktree里继承的artifacts/lane-b-polish清单/报告和生成器，
旧工作区不改；保存原版快照并写清修正原因"。本目录即该快照。修正范围：

1. 生成器改为以 **git 跟踪状态**为依据（`git ls-files`），并显式排除 `*.blend1`
   等临时备份；清单元数据标明 `scopeKind: "committed-source"`。
2. 重新生成 `delivery-manifest.json` 与外层收据：两个 .blend1 条目移除，
   计数/总字节改为真实可验值（71 个交付文件 + 本快照 3 个文件）。
3. `tests/lane-b-evidence.test.mjs` 提交树测试改为：工作树 clean 前提下，
   用 `git worktree add` 把 HEAD 导出到新目录（LFS 由本地 store smudge），
   对该导出树做正例验证 + 篡改/缺文件负例。
4. 未删除任何检查；负例（缺文件/坏哈希/自包含/路径逃逸）全部保留且新增
   "清单含未跟踪文件必须失败" 的 UP-G1 类负例。

修正只发生在**本 worktree**；上游工作区 `pawborough-lane-b-polish-20260920`
未做任何改动。
