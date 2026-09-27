// wave10-pondqa 机位：九曲桥每 10 m 眼高 1.6 m 双向、池岸 6 处眼高、2 处斜俯、1 处正俯 + 问题近景。
// 机位全部从 baseline/layout.json 重算（桥折线 / 水池多边形 / 湖心亭 footprint），岸上眼高 = 该点实测地面 + 1.6。
// 输出 shots JSON 给 tests/pondqa-render.py（地图系 x 东 z 南 y 上）。
// 用法：OUT_DIR=out-zone node tests/pondqa-shots.mjs --out <shots.json> [--tag before]
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './pondqa-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const OUT = path.resolve(Q.ROOT, process.env.OUT_DIR || 'out-zone');
const TAG = opt('--tag', 'before');
const EYE = 1.6;
const man = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const glbs = man.zones.filter((z) => z.id !== 'fangbang').map((z) => path.join(OUT, z.file));
const W = Q.loadWorld(OUT, { files: man.zones.filter((z) => z.id !== 'fangbang').map((z) => z.file) });
const G = new Q.VGrid(W.nodes, { cell: 1.0, region: [-200, -190, -100, -85] });
const groundAt = (x, z) => { const h = G.column(x, z).find((q) => q.ny > 0.2 && q.y < 1.0); return h ? h.y : -0.4; };
// 机位净空：该点竖直线上地面以上 0.15 m 起没有任何面（不在楼里 / 檐下 / 树冠下），周围 0.6 m 四点同样
const clear = (x, z, y) => [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].every(([dx, dz]) => {
  const g = groundAt(x + dx, z + dz);
  return !G.column(x + dx, z + dz).some((h) => h.y > g + 0.15);
});
// 视线：机位到目标之间（去掉目标端 0.8 m）没有遮挡面
const los = (p, t) => {
  const L = Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2]), k = Math.max(0, (L - 0.8) / L);
  const q = [p[0] + (t[0] - p[0]) * k, p[1] + (t[1] - p[1]) * k, p[2] + (t[2] - p[2]) * k];
  return !Q.segHit(G.near(p[0], p[2], q[0], q[2]), p, q);
};
const shots = [];
const add = (name, pos, tgt, lens = 30, note = '') => shots.push({ name: `${name}-${TAG}`, group: name.split('-')[0], pos: pos.map((v) => +v.toFixed(3)), tgt: tgt.map((v) => +v.toFixed(3)), lens, note });

// ---- 桥上：每 10 m 一站，眼高 = 桥面 0.55 + 1.6；前向看 s+12、后向看 s-12 ----
const Lb = Q.polylineLength(Q.BRIDGE_LINE);
for (let s = 0, k = 0; s <= Lb + 1e-6; s += 10, k++) {
  const a = Q.alongPolyline(Q.BRIDGE_LINE, Math.min(s, Lb - 0.3));
  const y = Q.DECK_Y + EYE;
  const f = Q.alongPolyline(Q.BRIDGE_LINE, Math.min(Lb, s + 12)), b = Q.alongPolyline(Q.BRIDGE_LINE, Math.max(0, s - 12));
  const tf = s + 12 > Lb ? [a.p[0] + a.dir[0] * 12, a.p[1] + a.dir[1] * 12] : f.p;
  const tb = s - 12 < 0 ? [a.p[0] - a.dir[0] * 12, a.p[1] - a.dir[1] * 12] : b.p;
  add(`bridge-s${String(s).padStart(2, '0')}-fwd`, [a.p[0], y, a.p[1]], [tf[0], y - 0.9, tf[1]], 24, `bridge station s=${s} m, looking toward the east end`);
  add(`bridge-s${String(s).padStart(2, '0')}-back`, [a.p[0], y, a.p[1]], [tb[0], y - 0.9, tb[1]], 24, `bridge station s=${s} m, looking toward the west end`);
}

// ---- 池岸 6 处眼高：水池边界 6 等分点，沿外法线上岸 3 m，看湖心亭形心 ----
const S = Q.shoreSamples(0.5);
const hc = Q.HT_POLY.reduce((a, p) => [a[0] + p[0] / Q.HT_POLY.length, a[1] + p[1] / Q.HT_POLY.length], [0, 0]);
for (let k = 0; k < 6; k++) {
  // 6 等分点起，沿边界前后挪、沿外法线上岸 2..10 m，取第一处净空的点
  let pick = null;
  for (let di = 0; di < 40 && !pick; di++) for (const sg of [1, -1]) {
    const s = S[(Math.floor((k + 0.5) * S.length / 6) + sg * di + S.length) % S.length];
    for (let d = 2; d <= 10 && !pick; d += 1) {
      const x = s.p[0] + s.n[0] * d, z = s.p[1] + s.n[1] * d, gy = groundAt(x, z);
      if (clear(x, z, gy + EYE)) pick = { s, x, z, gy, d };
    }
    if (pick) break;
  }
  add(`shore-${k + 1}`, [pick.x, pick.gy + EYE, pick.z], [hc[0], 1.0, hc[1]], 28, `shore eye level, ground ${pick.gy.toFixed(2)}, ${pick.d} m inland of s=${pick.s.s} m of the water outline`);
}

// ---- 斜俯 2 处（西北 / 东南）+ 正俯 1 处 ----
add('aerial-nw', [hc[0] - 55, 38, hc[1] + 42], [hc[0], 0, hc[1]], 30, 'oblique from the north-west (bazaar side)');
add('aerial-se', [hc[0] + 50, 34, hc[1] - 48], [hc[0], 0, hc[1]], 30, 'oblique from the south-east (garden side)');
{
  const cx = (Math.min(...Q.WATER_POLY.map((p) => p[0])) + Math.max(...Q.WATER_POLY.map((p) => p[0]))) / 2;
  const cz = (Math.min(...Q.WATER_POLY.map((p) => p[1])) + Math.max(...Q.WATER_POLY.map((p) => p[1]))) / 2;
  add('top', [cx, 95, cz + 0.01], [cx, 0, cz], 26, 'straight down over the pond');
}

// ---- 问题近景 ----
// 湖心亭抱厦 × 桥栏：桥折线上离湖心亭形心最近的点（抱厦在主轴中段、临桥一侧）
{
  const near = Q.distToPolyline(hc, Q.BRIDGE_LINE);
  let sAt = 0; for (let i = 0; i < near.seg; i++) sAt += Math.hypot(Q.BRIDGE_LINE[i + 1][0] - Q.BRIDGE_LINE[i][0], Q.BRIDGE_LINE[i + 1][1] - Q.BRIDGE_LINE[i][1]);
  sAt += Math.hypot(near.at[0] - Q.BRIDGE_LINE[near.seg][0], near.at[1] - Q.BRIDGE_LINE[near.seg][1]);
  const a = Q.alongPolyline(Q.BRIDGE_LINE, sAt), side = [-a.dir[1], a.dir[0]];
  const toHT = [hc[0] - a.p[0], hc[1] - a.p[1]];
  const sg = side[0] * toHT[0] + side[1] * toHT[1] > 0 ? -1 : 1;   // sg*side = 远离湖心亭的一侧（水面）
  add('close-htporch-bridge', [a.p[0] + side[0] * sg * 7 - a.dir[0] * 3, 2.4, a.p[1] + side[1] * sg * 7 - a.dir[1] * 3], [a.p[0] - side[0] * sg * 1.5, 1.2, a.p[1] - side[1] * sg * 1.5], 30, `bridge rail at the huxinting porch, s=${sAt.toFixed(1)} m, from the water side`);
  add('close-htporch-deck', [a.p[0] - a.dir[0] * 6, Q.DECK_Y + EYE, a.p[1] - a.dir[1] * 6], [a.p[0] - side[0] * sg * 2.5, 1.0, a.p[1] - side[1] * sg * 2.5], 24, 'on the bridge deck west of the porch, looking at where bridge and porch meet');
  add('close-htporch-high', [a.p[0] + side[0] * sg * 5 - a.dir[0] * 6, 7.5, a.p[1] + side[1] * sg * 5 - a.dir[1] * 6], [a.p[0] - side[0] * sg * 1.0, 0.6, a.p[1] - side[1] * sg * 1.0], 30, 'bridge × huxinting platform from above');
}
// 东桥端落在岸上一段 + 东台阶
{
  const e = Q.BRIDGE_LINE.at(-1), p = Q.BRIDGE_LINE.at(-2);
  const d = [(e[0] - p[0]), (e[1] - p[1])], L = Math.hypot(...d); d[0] /= L; d[1] /= L;
  const side = [-d[1], d[0]];
  add('close-east-end', [e[0] + side[0] * 7 - d[0] * 2, 1.4, e[1] + side[1] * 7 - d[1] * 2], [e[0] - d[0] * 4, 0.1, e[1] - d[1] * 4], 30, 'east bridge end on land, east steps and ground');
}
// 东台阶侧面：台阶横向外 4 m、低机位，看台阶底与地面
{
  const g = Q.OBJ.get('jiuqu-bridge-step-e').geometry;
  const fwd = [Math.sin(g.rotY), Math.cos(g.rotY)], across = [Math.cos(g.rotY), -Math.sin(g.rotY)];
  const c = [g.position[0] - fwd[0] * 0.6, g.position[1] - fwd[1] * 0.6];
  let pick = null;
  for (const sg of [1, -1]) for (const d of [4, 5, 3.5, 6, 7, 8]) { const x = c[0] + across[0] * sg * d - fwd[0] * 1.5, z = c[1] + across[1] * sg * d - fwd[1] * 1.5, gy = groundAt(x, z); if (!pick && clear(x, z, gy + 1.0) && los([x, gy + 1.0, z], [c[0], 0.05, c[1]])) pick = [x, gy + 1.0, z]; }
  add('close-east-steps', pick, [c[0], 0.05, c[1]], 32, 'east steps from the side, camera 1.0 m above the ground');
}
// 栏板脚：桥面上离栏杆 0.8 m、高 1.0 m，斜看前方 3 m 处的栏板底
{
  const a = Q.alongPolyline(Q.BRIDGE_LINE, 26.5), side = [-a.dir[1], a.dir[0]];
  add('close-panel-foot', [a.p[0] - side[0] * 0.2 - a.dir[0] * 0.8, Q.DECK_Y + 1.0, a.p[1] - side[1] * 0.2 - a.dir[1] * 0.8], [a.p[0] + side[0] * 1.0 + a.dir[0] * 1.6, Q.DECK_Y + 0.1, a.p[1] + side[1] * 1.0 + a.dir[1] * 1.6], 30, 'balustrade foot from the deck (panel bottom vs deck), s=26.5 m');
}
// 西桥端台阶：桥端外侧，沿岸找净空机位
{
  const e = Q.BRIDGE_LINE[0], p = Q.BRIDGE_LINE[1];
  const d = [(e[0] - p[0]), (e[1] - p[1])], L = Math.hypot(...d); d[0] /= L; d[1] /= L;
  const side = [-d[1], d[0]];
  let pick = null;
  for (const [a, b] of [[6, 1], [-6, 1], [5, -2], [-5, -2], [7, 3], [-7, 3], [4, -4], [-4, -4]]) {
    const x = e[0] + side[0] * a + d[0] * b, z = e[1] + side[1] * a + d[1] * b, gy = groundAt(x, z);
    if (clear(x, z, gy + EYE)) { pick = [x, gy + EYE, z]; break; }
  }
  add('close-west-end', pick, [e[0] + d[0] * 1.2, 0.3, e[1] + d[1] * 1.2], 30, 'west bridge end and west steps');
}
// 栏板底缝：桥外侧（水面上方）低机位，垂直看一跨栏板底
{
  const a = Q.alongPolyline(Q.BRIDGE_LINE, 25), side = [-a.dir[1], a.dir[0]];
  add('close-panel-gap', [a.p[0] + side[0] * 3.2, 0.62, a.p[1] + side[1] * 3.2], [a.p[0] + side[0] * 1.0, 0.62, a.p[1] + side[1] * 1.0], 35, 'balustrade panel bottoms from the water side, eye at deck height, s=25 m');
}
// 岸线：外围地面 -0.40 岸段、广场 0.04 岸段各一处低近景；池西步道压水段
{
  const rows = S.map((s) => { const x = s.p[0] + s.n[0] * 0.3, z = s.p[1] + s.n[1] * 0.3; return { s, gy: groundAt(x, z) }; });
  const runs = (pred) => { let best = null, cur = null; for (const r of rows) { if (pred(r.gy)) { cur = cur ? { first: cur.first, n: cur.n + 1 } : { first: r, n: 1 }; if (!best || cur.n > best.n) best = cur; } else cur = null; } return best; };
  const shoreShot = (name, pred, note) => {
    // 同类岸段（pred 判岸上地面高）的全部采样点，按离最长连续段中点的距离排序，逐个找净空机位
    const run = runs(pred), i0 = rows.indexOf(run.first) + (run.n >> 1);
    const cand = rows.map((r, i) => ({ r, i })).filter(({ r }) => pred(r.gy)).sort((a, b) => Math.abs(a.i - i0) - Math.abs(b.i - i0));
    let pick = null;
    for (const { r } of cand) {
      const s = r.s;
      for (const d of [4, 5, 6, 3, 7, 8]) { const x = s.p[0] + s.n[0] * d, z = s.p[1] + s.n[1] * d, gy = groundAt(x, z); if (clear(x, z, gy + EYE)) { pick = { s, x, z, gy }; break; } }
      if (pick) break;
    }
    const t = [pick.s.p[0] - pick.s.n[0] * 1.0, -0.2, pick.s.p[1] - pick.s.n[1] * 1.0];
    const along = [-pick.s.n[1], pick.s.n[0]];
    add(name, [pick.x + along[0] * 2, pick.gy + EYE, pick.z + along[1] * 2], t, 32, `${note}, s=${pick.s.s} m`);
  };
  shoreShot('close-shore-ground', (g) => g < -0.3, 'shore where the land is the outer ground at -0.40');
  shoreShot('close-shore-plaza', (g) => g > -0.05 && g < 0.1, 'shore where the land is plaza / path paving at 0.04-0.05');
  const pwl = Q.OBJ.get('pond-west-link').geometry.polyline;
  let worst = null;
  const Lp = Q.polylineLength(pwl);
  for (let s = 0; s <= Lp; s += 0.25) { const a = Q.alongPolyline(pwl, s); const dd = Q.distToPolyline(a.p, Q.WATER_POLY, true).d * (Q.pointInPoly(a.p, Q.WATER_POLY) ? -1 : 1); if (!worst || dd < worst.dd) worst = { a, dd }; }
  const n = [-worst.a.dir[1], worst.a.dir[0]];
  let pick = null;
  for (const [u, v] of [[-5, -3], [5, -3], [-5, 3], [5, 3], [-3, -6], [3, -6]]) { const x = worst.a.p[0] + n[0] * u + worst.a.dir[0] * v, z = worst.a.p[1] + n[1] * u + worst.a.dir[1] * v, gy = groundAt(x, z); if (clear(x, z, gy + 1.8)) { pick = [x, gy + 1.8, z]; break; } }
  add('close-westlink-water', pick, [worst.a.p[0], 0, worst.a.p[1]], 32, 'pond-west-link where it runs over the water');
}
fs.writeFileSync(opt('--out'), JSON.stringify({ tag: TAG, outDir: OUT, glbs, shots }, null, 1));
console.log(shots.length, 'shots ->', opt('--out'));
