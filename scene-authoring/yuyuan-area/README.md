# 豫园区域场景制作

本模块是 Pawborough v1.0 的全域场景工程，覆盖园、庙、商城、池带与方浜街段连接，外围作为背景。范围与验收结论见根仓[v1.0 交付书](../../docs/V1-RELEASE.md)。原 G5 布局与补修已经接续，不从旧 Goal 重开施工。

## 从仓库根启动

先按[资产恢复指南](../../docs/ASSET-RESTORE.md)及[迁入资产清单](../../docs/MIGRATION-ASSETS.json)恢复登记输入，并准备 Blender、Python 依赖及两级 Node 依赖。

```bash
npm run area:rebuild
OUT_DIR=out-zone npm run area:serve
```

标准重建输出到本模块 `out-zone/`，末尾运行默认 72 段测试。默认预览端口 5486；`/candidate/` 是版本入口，`/` 是 3D 查看器。服务本身必须带 `OUT_DIR=out-zone`，否则会读取旧 `out/`。

已有本版输出时，从仓库根运行 `OUT_DIR=out-zone npm run area:verify`。只重建或检查受影响内容，不为接手重复全量生成。`/review.html` 和历史 `out/` 保留用于早期离线对照，不能代替本版输出。

## 在模块目录执行

```bash
npm ci
python3 -X utf8 -m pip install --target .python-deps -r requirements.txt
npm run rebuild:v1
OUT_DIR=out-zone npm run server
OUT_DIR=out-zone npm run verify
```

新施工输出指定到独立工单目录，不覆盖封存交付。湖心亭站点模块默认开启；`HUXINTING=0` 会退回程序化占位，不作为当前标准重建。`baseline/layout.json` 与 `baseline/commercial-route.pinned.json` 是冻结输入，不能用早期地图生成器覆盖。

生成模型、图片及入口状态文件不提交 Git；预生成输入变化按资产清单登记和回执流程处理。重建后的入口收据绑定见[版本接收说明](../../docs/CANDIDATE-HANDOFF.zh-CN.md)。真实 GPU 检查、物理路线验证与离线图的证据范围分别说明。

## play 模式与角色资产（?play=1，阶段1 工单）

`OUT_DIR=out-zone` 服务启动后，打开 `/?play=1` 进入直立灰猫游玩模式：真实 out-zone 地图、同一 Rapier 静态世界，WASD 移动、鼠标视角、第三人称相机（碰墙回缩）、P 暂停；「取景」切轨道环视，「回到游玩」原位恢复（脚点与朝向连续，只有「回到锚点」类显式动作会移动出生位置）。默认不带 `?play=1` 的页面仍是原 viewer，行为与检查契约不变。

角色 GLB 不入 Git：按 `inputs/play-character.json` 恢复到 `resources/characters/gray-cat/character.glb`（来源 `onewonderjapan/ow-character-lab@87105b2` 的 `tripo-20260929/hybrid-biped-cat/final/cat.glb`，SHA256 `5f60f225f8c46515119007023268c95a0cb904363c830b580cce70c0ad613981`，5256700 字节）。页面加载时会重新校验该 SHA；文件缺失或不符时显示中文恢复指引并停留在取景模式，不会用占位模型顶替。`resources/` 整体在 .gitignore，恢复后也不会误提交。

检查入口：模块目录 `npm run test:play`（控制器生命周期 / 会话连续性 / 第三人称相机数学 / 真实 GLB 资产契约 / 入口配置与失败态）。浏览器侧 `window.__play.status()` 提供只读字段（ready、actorId、assetSha256、mode、paused、feet、yaw、animation、cameraMode、assetError）供验收复验。本节为阶段1 工单交付，不是 v1.1 封版；VERSION-v1 与 tag 不变。
