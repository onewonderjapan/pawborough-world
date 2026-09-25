// WP11/R1 控制层镜头取景度量（control-shots-test 与 CLI 共用；阈值只在测试里定）。
// 几何原语全部复用 scripts/tour-visibility.mjs（与 tour-test R1 同一套碰撞集 / 目标盒 / 遮挡判定），
// 另加两条控制层专用口径（导览不用）：
//   - 画面 = 渲染相机（1280×720，Blender 焦距 lensMm，36 mm 横幅传感器，与 render-control-passes.py 同式）；
//   - 9 采样点「可见」沿用 tour-test R1 口径（视线不被碰撞盒挡）；另记「画面内且未挡」点数 inFrameVis；
//   - 投影占比 = 凸包裁到画面矩形后的面积（目标出画 → 0；tour-test 的不裁口径目标在画外也会得大面积）。
// 目标盒：layout 对象有 footprint/rocks/polyline 时用 targetBox；锚点型（城隍庙山门 temple-shanmen 是
// templeAnchor，只有 position）用管线碰撞记录里同 id 的盒并集 AABB（collision-temple.json，模块实际几何）。
// 九曲桥栏遮挡（碰撞集里没有桥栏）：按 layout jiuqu-bridge 折线 + garden-kit 桥栏尺寸重建两侧栏带
// （中线外 ±1.01 m，桥面 0.55 m 起、柱头尖顶 +1.23 m 止，按实心带算 = 保守上界），
// 对画面下 1/3 网格采样射线，统计打到栏带的射线占比（railNear = 只计相机 10 m 内的栏 = 前景遮挡；railLowerThird = 全距离）。
//
// CLI：OUT_DIR=out-zone node scripts/control-shot-visibility.mjs [control-shots.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadColliders, targetBox, viewFromLens, visiblePointCount, framedVisiblePointCount, screenAreaFrac, nearestColliderDist,
} from './tour-visibility.mjs';

export const RAIL = { offsetM: 1.01, bottomAboveDeck: 0.0, topAboveDeck: 1.23, extendM: 0.12, nearM: 10 };

// 镜头声明的目标 → 目标盒
export function shotTargetBox(targetId, layout, boxes) {
  const o = layout.objects.find(x => x.id === targetId);
  const g = o && o.geometry;
  if (g && (g.footprint || g.rocks || g.polyline)) return targetBox(o);
  // 锚点型对象（templeAnchor 只有 position）/ layout 实例：用同 id 碰撞记录并集
  const inst = (layout.instances || []).find(x => x.id === targetId);
  if (!o && !inst) throw new Error(`目标 ${targetId} 不在 layout objects/instances 里`);
  const own = boxes.filter(b => b.id === targetId);
  if (!own.length) throw new Error(`实例目标 ${targetId} 无碰撞记录，无法定包围盒`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of own) {
    const a = b.aabb;
    min[0] = Math.min(min[0], a.x0); min[1] = Math.min(min[1], a.y0); min[2] = Math.min(min[2], a.z0);
    max[0] = Math.max(max[0], a.x1); max[1] = Math.max(max[1], a.y1); max[2] = Math.max(max[2], a.z1);
  }
  return { id: targetId, min, max };
}

// 九曲桥两侧栏带（竖直四边形，按段偏移、两端各延 extendM 补转角缝）
export function railPanels(bridge) {
  const pts = bridge.geometry.polyline, deck = bridge.deckY ?? 0.55;
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-6) continue;
    const dx = (bx - ax) / l, dz = (bz - az) / l, nx = -dz, nz = dx;
    for (const s of [-1, 1]) {
      const o = s * RAIL.offsetM, e = RAIL.extendM;
      out.push({ a: [ax + nx * o - dx * e, az + nz * o - dz * e], b: [bx + nx * o + dx * e, bz + nz * o + dz * e],
        y0: deck + RAIL.bottomAboveDeck, y1: deck + RAIL.topAboveDeck });
    }
  }
  return out;
}

// 画面下 1/3 被栏带挡住的射线占比（cols×rows 网格，像素中心）
export function railLowerThirdFrac(cam, look, view, panels, { cols = 64, rows = 16, maxDistM = Infinity } = {}) {
  const f = norm(sub(look, cam)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const tanY = Math.tan(view.fovDeg / 2 * Math.PI / 180), tanX = tanY * view.width / view.height;
  let hit = 0, n = 0;
  for (let j = 0; j < rows; j++) {
    const py = view.height * (2 / 3 + (j + 0.5) / rows / 3);          // 画面下 1/3
    const sy = -((py / view.height) * 2 - 1) * tanY;
    for (let i = 0; i < cols; i++) {
      const px = view.width * (i + 0.5) / cols;
      const sx = ((px / view.width) * 2 - 1) * tanX;
      const d = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
      n++;
      for (const p of panels) {
        // 射线 xz 与栏段 a→b 求交：cam + t·d = a + s·(b−a)
        const ex = p.b[0] - p.a[0], ez = p.b[1] - p.a[1];
        const den = d[0] * ez - d[2] * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = p.a[0] - cam[0], wz = p.a[1] - cam[2];
        const t = (wx * ez - wz * ex) / den, s = (wx * d[2] - wz * d[0]) / den;
        if (t <= 0 || s < 0 || s > 1 || t * Math.hypot(d[0], d[2]) > maxDistM) continue;
        const y = cam[1] + d[1] * t;
        if (y >= p.y0 && y <= p.y1) { hit++; break; }
      }
    }
  }
  return hit / n;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 单镜头逐帧度量
export function evaluateShot(shot, layout, boxes) {
  const view = viewFromLens(shot.lensMm ?? 50);
  const box = shotTargetBox(shot.targetId, layout, boxes);
  if (shot.targetHeightM) box.max[1] = shot.targetHeightM;   // 变体目标高（BAZAAR_TOWERS=1 华宝楼套件），由调用方给
  const bridge = layout.objects.find(o => o.kind === 'zigzagBridge');
  const panels = shot.railCheck && bridge ? railPanels(bridge) : null;
  const frames = [];
  for (let k = 0; k < shot.eye.length; k++) {
    const cam = shot.eye[k], look = shot.target[k];
    const vis = visiblePointCount(boxes, cam, box);                       // tour-test R1 同口径：未被碰撞盒挡
    const inFrameVis = framedVisiblePointCount(boxes, cam, look, box, view); // 另记：画面内且未挡
    const area = screenAreaFrac(box, cam, look, view, { clipToFrame: true });
    const near = nearestColliderDist(boxes, cam);
    const fr = { k, vis, inFrameVis, area, clearance: near.dist, clearanceName: near.name };
    if (panels) {
      fr.railLowerThird = railLowerThirdFrac(cam, look, view, panels);                       // 全距离（含远处桥段）
      fr.railNear = railLowerThirdFrac(cam, look, view, panels, { maxDistM: RAIL.nearM });   // 前景 10 m 内
    }
    fr.dist = Math.hypot((box.min[0] + box.max[0]) / 2 - cam[0], (box.min[2] + box.max[2]) / 2 - cam[2]);
    frames.push(fr);
  }
  return { id: shot.id, targetId: shot.targetId, lensMm: view.lensMm, fovYDeg: view.fovDeg, box, frames };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
  const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
  const doc = JSON.parse(fs.readFileSync(process.argv[2] || path.join(OUT, 'control-shots.json'), 'utf8'));
  const boxes = loadColliders(ROOT, path.relative(ROOT, OUT));
  const fallback = { 'fangbang-westbound': 'temple-shanmen', 'habao-plaza-pan': 'bld-428202599', 'jiuqu-to-huxinting': 'huxin-ting' };
  const res = [];
  for (const s of doc.shots) {
    const shot = { ...s, targetId: s.targetId || fallback[s.id], railCheck: s.railCheck ?? s.id === 'jiuqu-to-huxinting' };
    const ev = evaluateShot(shot, layout, boxes);
    res.push(ev);
    console.log(`${ev.id} -> ${ev.targetId} lens ${ev.lensMm} mm fovY ${ev.fovYDeg.toFixed(1)}°`);
    for (const f of ev.frames) {
      console.log(`  f${String(f.k).padStart(2, '0')} vis ${f.vis}/9 (in-frame ${f.inFrameVis}) area ${(f.area * 100).toFixed(1)}% clr ${f.clearance.toFixed(2)} m (${f.clearanceName})` +
        ` dist ${f.dist.toFixed(1)} m` + (f.railLowerThird != null ? ` rail⅓ near ${(f.railNear * 100).toFixed(0)}% all ${(f.railLowerThird * 100).toFixed(0)}%` : ''));
    }
  }
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(res, null, 1) + '\n');
}
