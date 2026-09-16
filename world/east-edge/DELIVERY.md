# 东端两栋施工交付（E128 小酒楼 / E129 饭馆店宅）

`delivered_for_lead_review` · `ownerAdopted:false` · 分支 `work/east-edge-shops-20260914`（自 bcc787b）· 日期 2026-09-15

按 CONSTRUCTION_HANDOFF.md 完成两栋候选：真实 shop-128/129 占位在派生数据集 `world/east-edge/` 中被替换，撤回可恢复。两栋到此停止，130/131 未动。

## 主控复审四件事的答案

1. **原终点视线中的山墙**：C0 同机位对照（规格 1280×572、竖直 45° 精确复现）— `web-evidence/east-edge-east-czero-pbr-ph-*.jpg` 两个时间戳文件即灰盒/候选一对（JSON 内 `blocks.activeIds` 与三角形计数机器可辨：171,464 → 184,904 = +13,440）。
2. **材质一致**：全部沿用 `mb_lib.build_materials` 冻结贴图/颜色乘数/粗糙度/米制 UV；唯一新增是共享通用店名图集一张。无做旧。
3. **占位是否被真实替换**：`?world=east-edge` 下 shop-128/129 灰盒与其碰撞在 assets 块应用期间不生成，撤回恢复（27 项生命周期测试，真实 Rapier）；F3 占位开关不触及精修对象（测试断言）；其余占位保留并在 C0 画面中可见。
4. **同灯光 WebGL 完整性**：C0/C1/店面近景/西山墙/灰模共 9 张，全部占位显示 ON，页内 `record()` 遥测随图保存。

## 打开方式

```bash
npm run dev            # 127.0.0.1:5284
# 候选：  http://127.0.0.1:5284/?world=east-edge
# 原灰盒： http://127.0.0.1:5284/?world=east-edge&assets=off   （占位勾选框置 ON）
```

## 预算与校验

| 项 | 实测 | 限额 |
|---|---|---|
| 三角形合计 | 13,440 | ≤24,000 |
| 独立 GLB 下载字节合计 | 3.39 MB | ≤5 MB |
| 新增图片 | 1 张（通用招牌图集） | ≤1 |
| gltf-validator | 0 错误 / 0 警告（9 条 info 逐条在 validation.json） | 0 错误 |

两 GLB 各自内嵌贴图副本；未声称运行时自动共享，unique-by-content 图像数在 `validation.json`。

## 共享构件库新增（旧默认零改动）

- **planar 屋顶**（mb_lib.planar_roof）：真正两片平面坡，脊平行正面，前后出檐 0.30m / 山墙端 0.25m；坡体为封闭实体（檐底可见），山墙五边形独立平面无共面；唯一附件脊滚 ≤+0.20m（E128 完工顶 8.985 ≤ 9.0）。
- **开洞墙系统**（components.wall_with_openings）：真实洞口分段（窗/门/橱窗），0.10–0.12m 凹深内为窗框/玻璃/门板实体，不是外墙面黑矩形；门框按宽/高/凹深生成，E129 侧门门板闭合带碰撞。
- **分段基脚**：连续砖石基脚 −0.20~0.60，遇门分断并做石门槛。
- **直雨棚**（straight_canopy，E129）与侧墙落水管（含 3 卡箍）。
- **通用店名图集**：小酒楼/饭馆为新图集行，未映射任何既有真实商号行，未建中文几何字。
- **客户端 assets 块契约**：BlockManager 泛化 `kind:'assets'`（无 E128/E129 硬编码），应用/撤回与相邻占位同步；GLB 经生产解码路径加载；碰撞与渲染共用 obbToWorld 一套数学；无新增地面碰撞。
- build_sample.py（样板A）与其余 13 模块路径零改动；起始配置文件未被覆写（完整最终配置为 kit/east-shop-12{8,9}.config.json）。

## 规格偏差（已记录于 config 的 specAdjustments）

- E128 招牌 3.15→2.96：让过 3.4m 下横梁。
- E129 雨棚 2.85→2.74、招牌 3.15→3.16：雨棚顶与墙裙底之间放不下 0.68m 招牌板，避让穿插。
- 正面图为弄巷口近景：两立面隔 ~3m 相对，不存在开阔直视正面；全身立面由 C1 与 Blender 同机位渲染承担。
- 通用招牌图集实际 1024×2048，原设计为一张 1K（1024×1024）：按主控复审意见保留现有图像、不做无意义重建；明确记录为像素尺寸偏差，新增图片计数仍为 1 张，不以张数满足掩盖分辨率差别。

## 证据索引

- Blender 同机位（Cycles CPU，AgX，与 segment 渲染同护栏）：`kit/out/east-shop-12{8,9}/evidence/{blend,reimport}/`（正面/西侧/三qtr PBR + 西侧灰模，cameras.json sidecar 证明同机位；重导入组即 GLB 实物渲染）。
- WebGL（审看客户端实拍，页内遥测随图）：`world/east-edge/web-evidence/`（9 张 jpg + 9 个 record json）。
- 格式与预算：`world/east-edge/validation.json`。

## 未声称事项

历史测绘准确（historicalPositionVerified 保持 false）、机主采用、人工全程行走、Unity 验证、FPS——均无证据不标注。WebGL 与 Blender 渲染分开目录分开标注。

## 过程失败记录（全部修复，未删除）

键名 KeyError ×2；前脸基脚凸出方向反向；橱窗柜台面齐平偏黑；雨棚过薄；view 模式东侧块不加载导致对照空景；证据相机三轮撞体（最终以 collision-world.json 实测点位固定）。详见 RESULT.json。
