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
