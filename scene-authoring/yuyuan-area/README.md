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

## play 模式与玩法资产（?play=1）

`OUT_DIR=out-zone` 服务启动后，打开 `/?play=1&at=center` 进入直立灰猫游玩：实际街道小地图、三处免费试吃和「尝遍三味」集章。WASD 步行2.6m/s，Shift跑4.2m/s；R上/下车，W加速、A/D转向、S/空格刹车，巡航5.5m/s、Shift最高7m/s；E取食、F吃、P暂停。角色吃完有满足表情，手持食物上车进车篮、下车回手。地图可点击选择目标；「取景」/「回到游玩」保留位置。「新散步」只重置本游戏进度。

角色 GLB 不入 Git：按 `inputs/play-character.json` 恢复到 `resources/characters/gray-cat/character.glb`（来源 `onewonderjapan/ow-character-lab@87105b2` 的 `tripo-20260929/hybrid-biped-cat/final/cat.glb`，SHA256 `5f60f225f8c46515119007023268c95a0cb904363c830b580cce70c0ad613981`，5256700 字节）。页面加载时会重新校验该 SHA；文件缺失或不符时显示中文恢复指引并停留在取景模式，不会用占位模型顶替。`resources/` 整体在 .gitignore，恢复后也不会误提交。

食品按 `inputs/play-foods.json` 的 SHA 恢复 `resources/foods/handheld/{xiaolongbao,congyoubing,youdunzi}.glb`。派生车恢复到 `resources/vehicles/play-bicycle.glb`，本次 SHA为 `4b6b774cc196b98820ed87ad57a7f5f25321f49ccf8952d7ece4ea24672ada8a`，79592字节、708三角面。也可在模块目录执行：

```bash
blender -b --factory-startup -t 4 -P scripts/build-play-bicycle.py -- \
  --out /your/outbox/play-bicycle --workspace ../..
```

生成结果和测量元数据进入指定outbox，脚本把GLB复制到工作区忽略目录。若Blender环境导致生成字节变化，核对测量结果并更新 `inputs/play-vehicle.json` 的SHA/bytes；不能把GLB或截图加入Git。

保存键为 `pawborough.play.walk.v1`：位置/视角、手中或车篮食品、已吃品种、目标和车位置/模式。坏JSON、旧版本、无地面、墙内或不安全车辆位置会给说明并回安全点；进食中刷新可恢复剩余计时。原相机存储独立。

检查入口：模块目录 `npm run test:play`，覆盖12组核心契约，包括速度、地图投影、距离/隔墙、进食暂停/独立集章、版本化保存、车辆转向/地面/刹车/生命周期及共享食品资源。`window.__play.status()` 提供只读状态。真实路线验收使用普通出生与W/A/D等输入，存档预置只用于定点视觉和负例，不能算可达证据。自动化要核对实际GL renderer及RAF节拍；空闲显示限帧与游戏速度分开诊断，解除测试窗口限帧不改变物理参数。W2尚未复测新玩法性能。

本节是本地玩法开发交付，角色美术待世界内审阅；VERSION-v1及v1.0 tag继续记录原封版世界。
