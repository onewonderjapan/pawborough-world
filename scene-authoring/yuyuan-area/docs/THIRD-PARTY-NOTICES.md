# 第三方素材来源说明（yuyuan-area）

本文件记录场景管线直接读取的外部来源素材；程序化生成的素材同样列明生成方式，便于合并与上传登记核对。

## 地面铺装贴图（wave1-paving P2，2026-09-23）

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `resources/textures/paving/paving-fine-cobble.jpg` | 本仓库程序化生成 | `scripts/bake-paving-textures.py`（Blender + numpy，固定种子 20260923），弹格路小方石，1024²，无外部素材 |
| `resources/textures/paving/paving-grey-brick.jpg` | 本仓库程序化生成 | 同上，青砖一顺一丁，1024² |
| `resources/textures/paving/paving-pebble.jpg` | 本仓库程序化生成 | 同上，卵石铺面，1024² |
| `resources/textures/paving/paving-blue-stone.jpg` | 本仓库程序化生成 | 同上，青石板 2×2 每米，1024² |
| `resources/textures/paving/paving-asphalt.jpg` | 本仓库程序化生成 | 同上，沥青灰，1024² |

以上 5 张均为纯 numpy 像素合成（周期噪声 + 解析铺装图案），不包含照片、扫描或任何第三方图库内容；可复现（重跑脚本字节一致，JPEG 编码由 Blender 固定参数输出）。

## 其余素材

- `asset-authoring/yuyuan-entry/source-kit/textures/`（Bricks061 / PaintedPlaster017 / Wood092 / roof / wood-stain）来源与许可见业务仓 `docs/MIGRATION-ASSETS.json` 登记条目；本次铺装未直接引用该目录（目录内无青石/弹格路/青砖可用图）。
- 庙区 v3 模块、店屋、摊位/檐棚、亭/廊/树等模块 GLB 的内嵌贴图来源见各自模块目录的 README / 登记清单，本次未改动。
