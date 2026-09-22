# pavilion-kit — 攒尖亭套件（5 座）

参数化 n 边攒尖亭生成器 + 冻结布局中 5 座园亭的实例模块 GLB。包ID `pawborough-w1-pavilion-kit-20260922`，数值只认包内 `DESIGN_SPEC.json`；布局输入只读 `../baseline/layout.json`（G5 冻结）。

## 文件

| 文件 | 作用 |
|---|---|
| `compute_site_inputs.py` | S0：从冻结 layout 派生 footprint/质心/facade.dir/rotY/外接圆半径拟合 → `records/site-inputs.json` |
| `make_lattices.py` | 生成 2 张解析挂落镂空 alpha 贴图（512²，仅有的新贴图）→ `textures/` |
| `build_pavilion.py` | Blender 生成器：平台/踏步/柱/柱础/额枋/檐檩/挂落/美人靠/凹曲攒尖屋面/戗脊/宝顶/瓦当/封檐板/椽头/顶棚，导出 GLB + collision + reimport 核对 + 4 机位渲染 |
| `run_all.py` | 编排：顺序 Blender 构建（-t 4）、Khronos validator（0 错门槛）、空白帧守卫、placements.json + manifest.json、拷贝 artifacts |
| `test_pavilion.py` | 验收测试（纯 python3）：柱位半径、apex/rise、bounds±10%、预算、validator 0 错、重导入贴图连接/色彩空间、碰撞 0 泄漏、入口 bay 开放、sha256 |
| `make_contact_sheet.py` | 5 座 contact sheet（zh/id/tris 标签） |
| `records/` | 提交到分支的 JSON 记录副本 + 小图（≤400KB） |

生成物（不入库）→ `../../out-pavilion-kit/`（gitignored），二进制同步到包 `artifacts/pavilion-kit/`。

## 运行

```bash
python3 compute_site_inputs.py
python3 make_lattices.py
python3 run_all.py                 # Blender x5 + validator + 守卫
python3 test_pavilion.py           # 验收
python3 make_contact_sheet.py
```

## 坐标与放置约定

- 模块 GLB：Y-up，立面（入口）+Z，原点 = 平台中心地面 y=0；节点树 root=`<bld-id>`，children `body` / `roof` / `rail`。
- 地图系（x 东，z 南）→ rotY = atan2(dx, dz)（由 `scripts/assemble.py` 的 Blender Z-yaw 推导），placements.json 直接给 `position`(质心) + `rotY`，与既有 instances 字段同构。

## 关键假设（详见 PROGRESS.json / build-report.assumptions）

1. 听鹂亭 rect 变体：以 footprint 自身矩形（5.20×1.91）内收 0.15 定 Rx/Rz 并对齐 footprint 长轴；地图轴 bbox 5.49×2.96 是旋转矩形的包络，不能直接当作可建矩形。屋面按 PLAN fallback 用短脊（长边 40%）四坡+正脊。
2. 正多边形拟合按 spec：map 轴 bbox 内最大内接 n 边形（自由旋转，0.25° 步长）−0.15；入口 bay 取局部 +Z 最近者（偏角 6.8°–38.5° 已记录），台阶置于入口 bay 中线。
3. rise = clamp(0.5×檐半径, 1.1, 1.6)。
4. 无倒角（三角预算）；顶棚平面 3.28 封住檐下视线；挂落挂于所有 bay（含入口，底 2.70 > 2.4 可达带）；碰撞含 OBB（rotYDeg/p0p1 字段）供顶点级检查。
