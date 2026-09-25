// wave3-tourfix T1：scripts/tour-visibility.mjs screenAreaFrac 的「画面内」口径单元测试（合成几何，不读产物）。
// 导览（tour-test / compute-area-tour）与控制层镜头（control-shot-visibility）共用同一个 screenAreaFrac；
// 投影面积必须是凸包裁到画面矩形 [0,W]×[0,H] 之后的面积 —— 目标整体在画框外时为 0。
// 反证：在裁画框之前的实现上（导览默认不裁），用例 1 得到远超 8% 的面积而判通过（见 RESULT 的 red log）。
// 用法：node tests/tour-visibility-test.mjs
import { screenAreaFrac, projectPoint, boxPoints, VIEW, viewFromLens } from '../scripts/tour-visibility.mjs';

let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };
const W = VIEW.width, H = VIEW.height;
const tanY = Math.tan(VIEW.fovDeg / 2 * Math.PI / 180), tanX = tanY * W / H;
// 相机在原点眼高、望 −Z：right = +X、up = +Y、视轴深度 = −z
const cam = [0, 1.6, 0], look = [0, 1.6, -10];
const px = (x, depth) => (x / (depth * tanX) * 0.5 + 0.5) * W;
const py = (y, depth) => (-(y - 1.6) / (depth * tanY) * 0.5 + 0.5) * H;

// 1) 目标整体在画框右侧外（8 角全部投到画外、但都在相机前方）：未裁投影远超 8%，裁后必须为 0
{
  const box = { id: 'off-right', min: [12, 0, -12], max: [20, 10, -4] };
  const corners = boxPoints(box).slice(1).map(p => projectPoint(p, cam, look));
  ok('用例1 前提：8 角都在相机前方', corners.every(q => q && q[2] > 0.05));
  ok('用例1 前提：8 角全部在画框外（x > W）', corners.every(q => q[0] > W));
  // 前提：不裁剪的凸包面积（8 角投影点的凸包；本用例 12 棱无近平面裁剪）≥ 8% —— 旧口径会判通过
  const pts = corners.map(q => [q[0], q[1]]);
  const hull = (() => {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const half = (src) => { const st = []; for (const q of src) { while (st.length >= 2 && (st.at(-1)[0] - st.at(-2)[0]) * (q[1] - st.at(-2)[1]) - (st.at(-1)[1] - st.at(-2)[1]) * (q[0] - st.at(-2)[0]) <= 0) st.pop(); st.push(q); } return st; };
    return [...half(p), ...half(p.reverse()).slice(1, -1)];
  })();
  let s = 0; for (let i = 0; i < hull.length; i++) { const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length]; s += x1 * y2 - x2 * y1; }
  const unclipped = Math.abs(s / 2) / (W * H);
  ok(`用例1 前提：未裁投影 ${(unclipped * 100).toFixed(0)}% ≥ 8%`, unclipped >= 0.08);
  const frac = screenAreaFrac(box, cam, look);
  ok(`用例1 目标整体在画外，screenAreaFrac=${(frac * 100).toFixed(1)}% 应为 0`, frac === 0);
}

// 2) 目标整体在画内（正前方 18–20 m 的扁盒）：裁与不裁一致 = 前立面矩形面积（后立面投影落在其内）
{
  const box = { id: 'centre', min: [-2, 0, -20], max: [2, 3, -18] };
  const expect = ((px(2, 18) - px(-2, 18)) * (py(0, 18) - py(3, 18))) / (W * H);
  const frac = screenAreaFrac(box, cam, look);
  ok(`用例2 画内目标面积 ${(frac * 100).toFixed(3)}% ≈ 解析值 ${(expect * 100).toFixed(3)}%`, Math.abs(frac - expect) < 1e-9);
}

// 3) 目标跨右画框（薄片中心正好落在右边界上）：只算画内那一半
{
  const d = 18, xe = d * tanX;                  // 深度 18 m 处画框右边界的世界 x
  const box = { id: 'edge', min: [xe - 2, 0, -d - 1e-3], max: [xe + 2, 3, -d] };
  const expect = ((W - px(xe - 2, d)) * (py(0, d) - py(3, d))) / (W * H);
  const frac = screenAreaFrac(box, cam, look);
  ok(`用例3 跨画框目标 ${(frac * 100).toFixed(3)}% ≈ 画内一半 ${(expect * 100).toFixed(3)}%（±1%相对）`, Math.abs(frac - expect) / expect < 0.01);
}

// 4) 目标整体在相机背后 → 0（原口径已有，保持）
{
  const frac = screenAreaFrac({ id: 'behind', min: [-3, 0, 5], max: [3, 6, 12] }, cam, look);
  ok(`用例4 背后目标 ${frac} 应为 0`, frac === 0);
}

// 5) 控制层视图参数（1280×720、lensMm）走同一函数：目标在画上方外 → 0
{
  const v = viewFromLens(35);
  const frac = screenAreaFrac({ id: 'above', min: [-3, 30, -20], max: [3, 40, -14] }, cam, look, v);
  ok(`用例5 控制层视图下画框上方外的目标 ${(frac * 100).toFixed(1)}% 应为 0`, frac === 0);
}

console.log(`tour-visibility-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
