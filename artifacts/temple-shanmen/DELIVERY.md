# 城隍庙山门＋短前庭 · 独立样板交付（待主控审看）

taskId `pawborough-temple-shanmen-main` · status `delivered_for_lead_review` · ownerAdopted `false` · visualReview `pending_lead`
分支 `work/temple-shanmen-20260915`（基线 10df12a）。机主手动单会话连续执行，无中途审批等待；本会话为文本模型，**不宣称任何视觉通过**——全部图像仅供主控审看，数值结论均有测试/记录支撑。

## 交付物

| 产物 | 位置 | 实测 |
|---|---|---|
| 门楼+两翼+匾额 GLB | `world/temple-shanmen/temple.glb` | 16,322 tris / 3.05MB / validator 0错0警 |
| 前场+通道地面 GLB | `world/temple-shanmen/ground.glb` | 360 tris / 0.86MB（可见面=物理地面） |
| 石狮候选（一对） | `world/temple-shanmen/lions.glb` | 1,324 tris/只（限1,800） |
| 鱼龙吻/肩饰候选 | `world/temple-shanmen/ornaments.glb` | 粗轮廓，可整体替换 |
| 源blend+全部侧车 | `kit/out/temple-shanmen/` | scene.blend、config-used、collision、materials、measurements、reimport-check |
| 独立预览入口 | `temple.html`（npm run dev:temple → 5290；build+preview:temple → 5291） | 真实载入21,634 tris；主世界5284/5285未动 |
| Blender 6机位渲染 | `kit/out/temple-shanmen-renders/` | 6×PBR 1280×960 + 正面/三分之四灰模 + native对照2张 + 可复用scene.blend |
| WebGL 8张实测图 | `kit/out/temple-shanmen/web/` | 每张附页面自身遥测（相机核验/资源量/通行检查） |
| 新增贴图（仅两张） | `kit/textures/temple-plaque.png`、`temple-relief-normal.png` | 匾额2048×720 sRGB（Noto Serif CJK Bold，SIL OFL，来源已记）；浮雕法线1024 Non-Color，本地程序生成 |

## 关键数值结论

- **净开口 3.0×3.1m 三路验证**：配置三字段交叉校验；导出 GLB 顶点在净走廊（x±1.42, y0.3–2.8, z−3.5..−0.1）内零占用；Rapier 胶囊沿轴线穿门（横向漂移 **1mm**，通道内落地，穿出后于庙后坠落——顺带证明无隐形地面）。
- **预算**：主体+两翼 16,322/50,000 tris；全套 21,634/60,000；主 GLB 3.05/8MB；地面 0.86/2MB；新图 2/2。
- **相机忠实执行**：6机位 WebGL `dPos=0, dFov=0`（页面在 controls.update 后自校验）；Blender 侧 fov 先测后校，`degrees(angle)==合同值`（首轮被防弧度护栏拦下 Blender 4.5 垂直fit等效24mm传感高问题，修复而非放宽）。
- **GLB往返**：native blend ↔ GLB重导入同机位像素对照 mean|d|=0.057/255、>8级差异0.003%（纹理重编码量级），无黑帧。
- **回归**：15/15 测试套件 PASS（新增 temple contract 33项 + passage 11项；既有13套全绿）。

## 预设现场决策的执行

- 背面无参考 → 暗木框+灰墙+真开门洞（保持3.0m贯通），无假匾文，标 design_inference。
- 屋面交接：肩壳内缘伸入中央壳下 0.25m（配置设计值，校验带 0.10–0.30m），内缘另有收口条；未用大面积 doubleSide 遮法线。
- 雕饰难点：鱼龙吻/石狮为独立候选 GLB，随包可换，未阻塞主体与导出链。
- GPU 不抢：渲染全部 Cycles CPU（samples 24）；GB10 未占用渲染队列。

## 主控审看建议入口

1. `npm run dev:temple` → 打开 `http://127.0.0.1:5290/temple.html`（服务器可能已在本会话中运行）。
2. 先看 **正面灰模**（页面"灰模"按钮，或 `kit/out/temple-shanmen-renders/front-clay-glb.png`）：中央门洞、短脊+脊端饰、两肩起翘、两翼低墙四要素是否同读。
3. 再切材质看匾额右起读法（保障海隅）、翼墙菱形花瓣框浮雕、檐角下表面。
4. 候选剪影：`roof-pbr-glb.png`（鱼龙吻/肩饰）、页面"雕饰候选"开关对照石狮。

## 诚实记录

- 首轮 WebGL 取证的页面内通行判据有bug（胶囊穿出后要求仍落地）——几何未变，修正后全套PASS；两轮截图均保留未删。
- 翼墙物理负例的语义是"法向被挡、沿斜面滑行合法"；若 AABB 化会提前拦停、缺碰撞则直接穿墙，两种错误都被测试排除。
- FPS 未采样，不报告；277ms 加载为 localhost 数字。
- 匾额贴图文字用系统 Noto Serif CJK Bold 排印（OFL 许可，来源记录于 `kit/textures/temple-textures.json`）；边框/锦地/浮雕全部程序原创，无参考照片像素。
