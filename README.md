# Pawborough 方浜市声

Pawborough 是上海老城街景的 Three.js / Rapier 浏览与取景工程。当前交付版本为 **v1.0 豫园区域全域版**，于 2026-10-01 封版，源码与 `v1.0` 标签已推送。范围覆盖豫园、城隍庙、豫园商城、池带，以及方浜中路街段与山门连接段；外围为背景体块。

本版可用于浏览、步行和视频控制层导出。角色、完整玩法与 Unity 不在本版范围内；尚未部署公开游戏服务。

- [v1.0 交付书与已知边界](docs/V1-RELEASE.md)
- [v1.0 版本与构建记录](VERSION-v1.json)
- [文档与目录导航](docs/README.md)
- [开发接手入口](CLAUDE_HANDOFF.md)

## 当前可玩开发版本

2026-10-01 已打通直立灰猫的骑车逛吃玩法：实际小地图、步行/跑步、可骑自行车、三处免费试吃、掌心持物/进食/满足表情、三味集章和保存恢复。使用 `OUT_DIR=out-zone npm run area:serve` 后打开 `/?play=1&at=center`；角色、食品和车的资产准备见[模块使用说明](scene-authoring/yuyuan-area/README.md)。

WASD 步行，Shift 跑；靠近车 R 上下车，W 加速、A/D 转向、S 刹停后倒车、空格刹车，Shift 骑得更快；靠近摊位 E 取食，F 吃，P/Esc 暂停（Esc 保持当前画面）。小地图可选目标，完成三味盖章后仍可继续逛街。

这是本地可玩开发版本，角色美术待世界内审阅。下一步按机主已定顺序接入角色库其余四只，复用当前玩法；v1.0 封版记录独立保留。

## 恢复与启动

仓库公开源码与资产清单，运行所需资产仍在私有存储。克隆代码后，先按[资产恢复指南](docs/ASSET-RESTORE.md)及[迁入资产清单](docs/MIGRATION-ASSETS.json)恢复匹配资产；只有已获授权的 AWS 身份可以下载。历史 LFS 对象与迁入资产是两套清单，不要用占位文件替代。

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/onewonderjapan/pawborough-world.git
cd pawborough-world
npm ci
npm --prefix scene-authoring/yuyuan-area ci
```

按恢复指南完成资产与 Blender / Python 依赖准备后，从仓库根执行：

```bash
npm run area:rebuild
OUT_DIR=out-zone npm run area:serve
```

重建包含默认 72 段测试。服务默认监听 `127.0.0.1:5486`，以实际启动输出为准；打开该地址下的 `/candidate/` 查看版本入口，`/` 为 3D 查看器。**服务必须显式设置 `OUT_DIR=out-zone`**，否则默认读取历史 `out/`。

已有本版输出时可直接启动服务，或执行 `OUT_DIR=out-zone npm run area:verify`。重建会清除入口状态文件；证据绑定方法见[版本接收说明](docs/CANDIDATE-HANDOFF.zh-CN.md)。

## 模块

| 目录 | 用途 |
| --- | --- |
| `scene-authoring/yuyuan-area/` | 当前全域场景制作与浏览入口 |
| `asset-authoring/` | 店屋、门楼、食品等单体制作源 |
| `src/`、`world/`、`building/`、`kit/` | 原街段客户端、资产与历史制作来源，仍有当前管线引用 |
| `tools/`、`scripts/`、`tests/` | 恢复、封包、客户端构建及检查；按模块选择命令 |
| `docs/` | 当前交付、决定、资产清单与历史证据索引 |
| `artifacts/` | 历史施工及验收记录；新截图和渲染产物不入库 |

原街段客户端继续保留，可使用 `npm run dev` / `npm run build` / `npm run preview`。它与全域 `area:*` 命令服务不同模块；历史 `VERSION.json`、`DELIVERY.md` 不能代表本版。

## 交付边界

核心视觉首载为 15,688,354 B，上限 20 MB；该口径只含分区视觉 GLB 与唯一外置贴图，不含 JS/WASM 和步行物理 GLB。W2 实测、控制层及恢复演练的范围与限制见[v1.0 交付书](docs/V1-RELEASE.md)。

源码许可证待所有者选择。第三方贴图、参考照片、模型和解码器没有统一重新许可，见[第三方说明](docs/THIRD-PARTY-NOTICES.md)。私有 S3 不是公共资产 CDN。

2026-10-02 四项反馈补修已通过：[验收与恢复记录](docs/PLAY-FEEDBACK-20261001.md)。商业展示门面已改为实心闭门和“暂不开放”牌。
