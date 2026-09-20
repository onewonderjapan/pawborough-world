# 便携包启动器写入缺陷与修正（world-ten-hour 2026-09-21）

## 缺陷（继承自基线 9e5d5c40，本批首次实跑包内启动器时暴露）

`scripts/build_playable_package.mjs` 的 `ensureFile` 用 `typeof content === 'string'` 区分
"文本内容"与"源文件路径"，但两个启动器的调用传的正是**源文件路径字符串**——于是
`writeFile` 把路径字符串本身写进了包内 `start-world-playable.py` / `.mjs`（一行文本，
执行即 SyntaxError）。`git show 9e5d5c40:scripts/build_playable_package.mjs` 可复核
基线上代码原样相同。

影响：**20260920 便携包起，包内自带启动器从未可用过**。当时 RESULT.json 的
"served by its own launcher on 5413" 与已提交生成器不可复现（当时的验证应以其他方式
供服，原记录保留不改，此处如实登记）。包内网页/闭包/清单不受影响（逐字节校验一直通过）。

## 修正（本批，生成器在允许修改范围内）

- 启动器改走 `ensureCopy`（真实字节复制）；`ensureFile` 仅用于 README 文本。
- 修正前的坏产物保留未删（不删文件原则）：`dist-world-ten-hour-20260921/`、
  `restore-world-ten-hour-20260921/`、`delivery/world-ten-hour-20260921.zip`
  （sha256 2381cc3e…，已被新收据标注 SUPERSEDED）。
- 修正后以**新目录**重建：`dist-world-ten-hour-20260921-r2/`，ZIP 与收据见
  `delivery/`（world-ten-hour-20260921-r2.zip），解包复验目录
  `restore-world-ten-hour-20260921-r2/` 由**包内自带启动器**真实供服并通过全部 smoke。

## 原版快照

修正前生成器原文 = git 历史：`git show c411ffc:scripts/build_playable_package.mjs`
（第 129–137 行 ensureFile 与两个 ensureFile 调用）；基线版本
`git show 9e5d5c40:scripts/build_playable_package.mjs`（第 126–134 行，缺陷原点）。
