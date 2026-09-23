# DELIVERY — 街道家具 10 件（1990 年代上海）

包 `pawborough-w1-street-furniture-20260922` · 分支 `work/w1-street-furniture-20260922`（基线 33a3bd72）· 2026-09-23
状态：**delivered_for_lead_review**（ownerAdopted=false；未 push；无放置进世界，集成是 lead 后续步骤）

## 一句话

按 `kit/build_props.py` 的方法（单色常量材质、零贴图、GLB Y-up、原点在足迹中心、立面朝 +Z）扩展出 10 件 1990 年代上海街道家具，各自独立 GLB，未放置。

## 实测交付（GLB 重解析为准，非 builder 自报）

| id | zh | tris / 预算 | bytes | 实测 bounds [x,y,z] | spec size |
|---|---|---|---|---|---|
| street-lamp-1990 | 1990年代路灯 | 564 / 900 | 42,380 | 0.508 × 6.02 × 0.5 | 0.5/6.0/0.5 |
| post-box-green | 邮政绿邮筒 | 192 / 400 | 15,160 | 0.5 × 1.3 × 0.5 | 同 |
| phone-booth-ic | IC卡电话亭 | 352 / 700 | 31,620 | 1.04 × 2.43 × 1.04 | 1.0/2.4/1.0 |
| trash-bin-concrete | 混凝土果皮箱 | 90 / 300 | 7,668 | 0.48 × 0.88 × 0.48 | 0.5/0.9/0.5 |
| fire-hydrant | 消火栓 | 200 / 350 | 15,128 | 0.3 × 0.93 × 0.29 | 0.3/0.9/0.3 |
| utility-pole | 电线杆·变压器 | 236 / 600 | 20,544 | 0.62 × 8.0 × 0.56 | 0.6/8.0/0.6 |
| news-kiosk | 报刊亭 | 420 / 1,400 | 38,528 | 2.04 × 2.3 × 1.625 | 2.0/2.4/1.5 |
| bus-stop-sign | 公交站牌·空白牌面 | 108 / 250 | 11,104 | 0.64 × 2.6 × 0.1 | 0.6/2.6/0.1 |
| planter-box | 花坛·绿篱 | 180 / 300 | 17,220 | 1.22 × 0.495 × 0.52 | 1.2/0.5/0.5 |
| bike-rack | 自行车停放架 | 400 / 500 | 26,704 | 1.84 × 0.599 × 0.368 | 2.0/0.6/0.4 |

合计：**2,742 uniqueTris**（模块预算 6,000）、GLB 共 226,056 B、13 个单色常量材质、**0 贴图**。

## 出口门槛

- Khronos validator：10/10 GLB **0 errors、0 warnings**（主仓 `scripts/validate_all.cjs`，报告 `validation-report.json`）。
- 独立测试 `test_street_furniture.py`（系统 python3，重解析 GLB 二进制，不信任 builder 自报）：**145 项检查 0 失败** —— 边界 ±10%、原点在地面足迹中心、三角预算、零贴图、catalog sha256/字节/三角数一致、collision.json 每件一个盒（=sizeM，落地 y=0）、reimport 材质存活核对。
- 渲染：20 视图（每件 front + three-quarter），Cycles CPU `-t 4`，960×960，48 采样去噪；**20/20 过空白帧守卫**（亮度 std ≥ 2/255 且主色 ≤95%）。
- Contact sheet 1920×2630，zh/id/tris 标签（Noto Sans CJK）；分支上的 review 副本全部 ≤400 KB（sheet 283 KB）。

## 产物位置

- 分支（已提交）：`kit/props2.config.json`；`scene-authoring/yuyuan-area/modules/street-furniture/`（builder / renderer / sheet / test 四个脚本 + `records/`：PROGRESS、RESULT、本文件、catalog、collision、materials、measurements、reimport-check、validation-report、`review/` 21 张小图）；`out-street-furniture/.gitignore`（生成目录不入库）。
- 包 artifacts（未跟踪）：`artifacts/street-furniture/glb/`（10 GLB）、`artifacts/street-furniture/renders/`（20 视图 + contact sheet PNG 全尺寸）。
- 生成目录（gitignore）：`scene-authoring/yuyuan-area/out-street-furniture/`。

## 复跑方式

```bash
cd <worktree>
blender -b --factory-startup -t 4 -P scene-authoring/yuyuan-area/modules/street-furniture/build_street_furniture.py -- \
    --config kit/props2.config.json --out scene-authoring/yuyuan-area/out-street-furniture   # 可 --only 分批
python3 -X utf8 scene-authoring/yuyuan-area/modules/street-furniture/test_street_furniture.py \
    --out scene-authoring/yuyuan-area/out-street-furniture --config kit/props2.config.json
blender -b --factory-startup -t 4 -P scene-authoring/yuyuan-area/modules/street-furniture/render_street_furniture.py -- \
    --out scene-authoring/yuyuan-area/out-street-furniture --config kit/props2.config.json
python3 -X utf8 scene-authoring/yuyuan-area/modules/street-furniture/make_contact_sheet.py \
    --out scene-authoring/yuyuan-area/out-street-furniture --config kit/props2.config.json \
    --review scene-authoring/yuyuan-area/modules/street-furniture/records/review
```

## 假设（design_inference，全文见 PROGRESS.json）

1. 全部配色为设计值单色常量；邮筒/报亭绿 = 规格 2f6b3a；IC 亭蓝 46617a 为 90 年代常见珐琅蓝绿的设计推断。
2. 足迹 ±10% 下限由底座承担（路灯/邮筒 0.5 底座、消火栓 0.29、果皮箱 0.48）；灯罩缩到 r0.12 才能不越 0.5 宽度上限。
3. 电线杆：横担取 0.6 m（规格未给长度，受 x 边界约束）；变压器芯保持 0.6×0.8×0.5，散热肋使总深 0.56 以满足 z ≥ 0.54。
4. 站牌总深压在 0.10；牌面空白（无文字规则）。花坛 0.5 高 = 混凝土体 0.35 + 绿篱（顶 0.495）。
5. 报刊亭柜台窗/窗棂/卷帘/侧杂志架为类型学推断；路灯弯臂 4 段直杆近似（fallback：曲线 ≤8 段）。
6. 果皮箱内衬为开口杯（侧壁+底），保证顶部双口分隔板可读。

## 过程修正（详见 PROGRESS.stages）

KIT 导入路径少一层（已修，未触发 copy fallback）；`L.mat` 需显式注册 `L.M`；`orphans_purge()` 会误删尚无网格 user 的调色板材质（已移除）；路灯首版 BOUNDS_FAIL 0.624>0.55（缩罩）；报亭 ORIGIN_FAIL 足迹中心 +0.1425（整体回移）。

## 时间

Blender 构建 2 次 ×0.2 s；渲染 20 帧 ≈3 min（-t 4）；测试/sheet 数秒。包窗口 2026-09-23 00:21–09:35（含机主侧等待空闲）。

## 边界声明

未 push、未动 build-scene.mjs / assemble.py / rebuild-review.sh / package.json / 既有测试、未 npm ci、Blender 全程 `-t 4` 且单进程串行、未派子代理。真实浏览器加载与放置集成不在本批范围。
