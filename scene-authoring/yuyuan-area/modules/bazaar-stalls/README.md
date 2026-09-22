# bazaar-stalls 套件模块

1990 年代城隍庙市集摊位套件：3 种摊位 + 1 凳 + 街块檐棚条，作为实例模块与 placements 交付。
数值权威 = 包 DESIGN_SPEC.json；冻结布局 = `../baseline/layout.json`（只读）。

- 产物（gitignore）：`../../out-bazaar-stalls/` — 4 个套件 GLB + 16 个檐棚 GLB、placements.json、awning-placements.json、验证/重导入报告、渲染
- 记录（提交）：`records/` — PROGRESS / RESULT / DELIVERY / placements / 报告
- 复审图（提交，≤400KB）：`review/`
- 测试（提交）：`tests/test_bazaar_stalls.py`（系统 python3，18 项出口门槛）

## 重建

```
blender -b -t 4 -P build_bazaar_stalls.py     # 建全部 GLB + placements + manifest
blender -b -t 4 -P reimport_check.py          # 重导入核对（节点/socket/材质/包围盒/sha）
blender -b -t 4 -P render_stalls.py           # Cycles CPU 渲染 + 空白帧守卫 + mock row socket 核对
python3 contact_sheet.py                      # 联络表（PIL，中文标签）
python3 tests/test_bazaar_stalls.py           # 出口门槛
```

坐标契约、槽位语义与全部假设见 records/DELIVERY.md 与 records/PROGRESS.json。
管线接入是 lead 后续步骤；本模块不改 build-scene.mjs / assemble.py / rebuild-review.sh / package.json / 既有测试。
