# 全国寻味图鉴本地交付

24 味、8 章已经接入上海小城。18 个原摊位与 6 台摊车形成收藏路线；灰猫可走路、跑步、骑车、拿取与品尝。B 打开图鉴，E 取餐、F 品尝、R 骑车，Shift 加速。图鉴支持发现/品尝、章节进度、目标追踪、收藏导入导出；新散步保留收藏，清空图鉴有明确确认。

## 已验收结果

- 二十四份真实模型和缩略图；四类拿取/进食动作，勺与筷分别用真实物件。包纸、签、容器不随食物吞掉。
- 24 点真实 GPU 浏览器 E/F、暂停、去重集章；24 条从中心出发并返回的真实 WalkController 连续路线。清补凉和凤梨酥从原静态候选点改到实际可达街道。
- 实测 outer/方浜约 14 毫米接缝用独立可撤回铺面连接件修补，双向走/跑/不同起步相位通过；原防坠落规则保留。
- 食物进入车篮、骑行、下车、吃完始终同一 UUID，角色资源按 16→12→16→12 归还。
- 原 v1 存档保留，自动写 v2；配额异常、损坏 v2 回退、单食物失败取消进食并可用 F 重试，收藏不丢。
- 全图已应用 10 个材质族与统一日暮光照；新招牌、灯饰、台面小花和飘带按来源管理，灯池最多 2 盏。
- 40 份原 GLB 与主仓逐字节一致。新增 21 味模型 3,784,656 字节，24 张缩略图 1,308,275 字节，分别低于 24 MiB / 2 MiB。
- 资源库最多常驻 8 种、同时下载 2 种；首批最多 3 种，包括存档恢复中的手持物。离开再返回的晚到加载不会创建重复陈列。

## 证据与复现

本轮原始证据：`/home/baibai/outbox/pawborough-national-snacks-20261002/`。

| 范围 | 证据 |
|---|---|
| 24 味实际操作 | `m12-play/`、`m14-static-play/` |
| 连续路线 | `M12-ALL-ROUTES.json` |
| 食物/骑行所有权 | `m04-cycle/M04-food-bike-cycle.json` 与视频 |
| 单资源失败恢复 | `snack-food-failure-browser-check.mjs` |
| 新功能契约 | `M14-ATLAS-TEST.log`：17 套 |
| 原玩法兼容 | `M14-PLAY-TEST.log` |
| 全域完整验证 | `M14-AREA-VERIFY-FINAL.log` |
| 同条件 GPU 对照 | `m14-performance/comparison.json` |
| 原件保留 | `M14-ORIGINAL-ASSETS.json` |
| 本地静态包/CSP | `export-trial/artifacts/` |
| 夜景/窄屏/界面 | `m14-ui/` |

性能用同一 Chrome、NVIDIA GB10、1280×720、DPR1、硬件 headless、3 秒预热及相同 W/S 路线重测：旧版和当前 p95 都为 50ms，比值 1.00。早期有窗口的 16.8ms 与本轮模式不同，不混用；不据此宣称固定 60 FPS。游戏 GPU 验证与离线材质检查分开记录。

复现：根目录 `npm run build`；全域 `npm run test:play`、`npm run test:atlas`；`OUT_DIR=out-zone npm run area:verify`。全域制作检查需要当前 authoring 缓存（out-garden-kits/out-bazaar-towers/out-bazaar-stalls/staged）、真实 Git LFS 文件与 Shapely。本轮从主仓复制同清单原件并执行 LFS checkout，独立副本，不依赖旧夜班目录。验证用独立 Python 环境并让 Blender 的离线材质检查使用 CPU；实际游戏仍核对 NVIDIA GPU。

原始资产按 `inputs/play-foods.json` 的 SHA 恢复。新食品制作源在 `asset-authoring/snacks/national/`；生成输出按 m05/m10/m11 两批清单采用。原件只读。静态导出：`python3 -X utf8 tools/export_play_site.py --output /绝对目录`，其 PUBLIC-MANIFEST 与 HEADERS 是上传依据，不上传仓库或素材目录。

## 当前交付状态

M00–M14 已完成本地交付。源码 `6767dda22df3da48a318251d8be5563325e331a0` 已合并推送 main；临时 worktree 已归档，施工分支已删除，仅主工作副本。静态运行包为 `20261003-main-6767dda2`。现有发布会话需要 AWS SSO 登录更新；R01 按原专用桶/CloudFront/域名授权执行，当前线上仍为上一版本。源模型的宽爪与腋下折痕由 Astra 三视检查记为原模型限制，未出现新增重大变形。后续四只直立角色沿 P2 单独接入。
