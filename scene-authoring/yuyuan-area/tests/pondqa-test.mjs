// wave10-pondqa 池带验收（Q2）：池岸驳岸、桥端台阶实心落地、池西步道不压水，以及不许退化的池带既有性质。
// 位置 / 高度一律从 baseline/layout.json 重算（水池多边形、水面高、桥折线、台阶锚），被测对象是 OUT_DIR 的真实分区 GLB；
// 不拿产物和自己比。POND_QA=0 构建（或 wave10 之前的产物）上 1–3 组应失败。
// 用法：OUT_DIR=out-zone node tests/pondqa-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as Q from './pondqa-lib.mjs';
import { crossIntersect, backfaces } from './templeqa-lib.mjs';

const OUT = path.resolve(Q.ROOT, process.env.OUT_DIR || 'out-zone');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? ' :: ' + detail : ''}`); };

const W = Q.loadWorld(OUT, { files: JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8')).zones.filter((z) => z.id !== 'fangbang').map((z) => z.file) });
const xs = Q.WATER_POLY.map((p) => p[0]), zs = Q.WATER_POLY.map((p) => p[1]);
const REGION = [Math.min(...xs) - 12, Math.min(...zs) - 12, Math.max(...xs) + 12, Math.max(...zs) + 12];
const G = new Q.VGrid(W.nodes, { cell: 1.0, region: REGION });
const isWater = (n) => n.id === Q.POND_WATER_ID && n.kind === 'water';
const isRevet = (n) => n.kind === 'revetment';
const isBridge = (n) => n.id === 'jiuqu-bridge' || (n.name || '').startsWith('jiuqu-bridge__');
const isHT = (n) => n.id === 'huxin-ting' || /huxin-ting__/.test(n.name || '');
const isStructure = (n) => isBridge(n) || isHT(n);
const GROUND_Y = -0.4;   // layout 'ground'（外围地面）在 build-scene 的固定高度
const REVET_BAND = 0.35; // 驳岸压顶宽（向池内），与 build-scene REVET.band 同值的设计常数

// ---------------- 1) 池岸：每 0.5 m 岸点必须有竖向岸面，压顶高于水面 ----------------
{
  const S = Q.shoreSamples(0.5);
  let open = 0, below = 0, copeLow = 0;
  const worst = [];
  for (const s of S) {
    // 岸点内外 ±0.6 m 水平线段，在「水面 → 岸上地面 / 压顶」之间的中间高度找近竖直面
    const land = [s.p[0] + s.n[0] * 0.3, s.p[1] + s.n[1] * 0.3];
    const top = G.column(land[0], land[1]).find((h) => h.ny > 0.2 && h.y <= 0.6 && !isStructure(h.node));
    const landY = top ? top.y : GROUND_Y;
    if (landY < Q.WATER_Y - 0.01) below++;
    const lo = Math.min(landY, Q.WATER_Y), hi = Math.max(landY, Q.WATER_Y);
    let walled = true;
    if (hi - lo > 0.01) {
      for (const f of [0.25, 0.5, 0.75]) {
        const y = lo + (hi - lo) * f;
        const a = [s.p[0] - s.n[0] * 0.6, y, s.p[1] - s.n[1] * 0.6], b = [s.p[0] + s.n[0] * 0.6, y, s.p[1] + s.n[1] * 0.6];
        const cand = G.near(a[0], a[2], b[0], b[2]).filter((t) => Math.abs(t.ny) < 0.5 && t.y0 <= y && t.y1 >= y && !isStructure(t.node));
        if (!Q.segHit(cand, a, b)) { walled = false; break; }
      }
    }
    if (!walled) { open++; if (worst.length < 5) worst.push(`s=${s.s} landY=${landY.toFixed(2)}`); }
    // 岸点向池内 0.15 m 的最高朝上面 = 压顶，须高于水面 ≥ 0.15（压顶 / 铺面 / 台基都算）
    const inn = [s.p[0] - s.n[0] * 0.15, s.p[1] - s.n[1] * 0.15];
    const c = G.column(inn[0], inn[1]).find((h) => h.ny > 0.2 && h.y <= 0.6 && !isStructure(h.node));
    if (!c || c.y < Q.WATER_Y + 0.15) copeLow++;
  }
  ok(`池岸 ${S.length * 0.5} m：水面与岸面之间都有竖向岸面（无岸面岸段 ${open * 0.5} m = 0）`, open === 0, worst.join('; '));
  ok(`池岸内沿 0.15 m 处都有高出水面 ≥ 0.15 m 的压顶 / 铺面（不足 ${copeLow * 0.5} m = 0）`, copeLow === 0);
  console.log(`INFO 岸上地面低于水面的岸段 ${below * 0.5} m（须被岸墙封住，见第一条）`);
}

// ---------------- 2) 桥端台阶：每级实心落到下方地面（外围地面 / 铺面），踏面顶不变 ----------------
for (const o of Q.STEPS) {
  const g = o.geometry, n = g.stepCount, rise = (g.topY - g.bottomY) / n;
  const fwd = [Math.sin(g.rotY), Math.cos(g.rotY)], across = [Math.cos(g.rotY), -Math.sin(g.rotY)];
  let hollow = 0, maxVoid = 0, topBad = 0, samples = 0;
  for (let i = 1; i < n; i++) for (const a of [-0.9, 0, 0.9]) {
    const d = -(0.18 + i * 0.32);
    const x = g.position[0] + fwd[0] * d + across[0] * a, z = g.position[1] + fwd[1] * d + across[1] * a;
    const col = G.column(x, z);
    const mine = col.filter((h) => h.node.id === o.id);
    samples++;
    const want = g.topY - rise * i;
    if (!mine.length || Math.abs(mine[0].y - want) > 0.003) { topBad++; continue; }
    const bottom = mine[mine.length - 1].y;                                   // 本件最低面
    const under = col.find((h) => h.y < bottom - 1e-4 && h.ny > 0.2 && h.node.id !== o.id && !isStructure(h.node));
    const groundY = under ? under.y : GROUND_Y;
    const gap = bottom - Math.max(groundY, GROUND_Y);
    if (gap > 0.01) { hollow++; maxVoid = Math.max(maxVoid, gap); }
  }
  ok(`${o.id}：踏面顶 = layout topY − rise·i（${samples - topBad}/${samples}）`, topBad === 0);
  ok(`${o.id}：每级实心落地，板底离下方地面空高 ≤ 0.01 m（空心 ${hollow}/${samples}，最大 ${maxVoid.toFixed(3)} m）`, hollow === 0);
}

// ---------------- 3) 池西步道不压水 ----------------
{
  let over = 0;
  for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x += 0.25) for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z += 0.25) {
    if (!Q.pointInPoly([x, z], Q.WATER_POLY)) continue;
    if (G.column(x, z).some((h) => h.node.id === 'pond-west-link')) over++;
  }
  ok(`pond-west-link 压在水池多边形内的面积 ${(over / 16).toFixed(2)} m² ≤ 0.05`, over / 16 <= 0.05);
  const pwl = Q.OBJ.get('pond-west-link');
  const nodes = W.nodes.filter((nd) => nd.id === 'pond-west-link');
  const ys = nodes.flatMap((nd) => Array.from({ length: nd.P.length / 3 }, (_, i) => nd.P[i * 3 + 1]));
  ok(`pond-west-link 面高 = layout height ${pwl.height}（实测 ${Math.min(...ys).toFixed(3)}..${Math.max(...ys).toFixed(3)}）`, nodes.length > 0 && Math.abs(Math.min(...ys) - pwl.height) < 1e-3 && Math.abs(Math.max(...ys) - pwl.height) < 1e-3);
  // 岸上部分不许被裁：步道中线在水池外 ≥ 0.9 m（半宽）处的采样点都还有步道面
  let lost = 0, checked = 0;
  const L = Q.polylineLength(pwl.geometry.polyline);
  for (let s = 0; s <= L; s += 0.5) {
    const a = Q.alongPolyline(pwl.geometry.polyline, s);
    if (Q.pointInPoly(a.p, Q.WATER_POLY) || Q.distToPolyline(a.p, Q.WATER_POLY, true).d < pwl.width / 2 + 0.05) continue;
    checked++;
    if (!G.column(a.p[0], a.p[1]).some((h) => h.node.id === 'pond-west-link' && Math.abs(h.y - pwl.height) < 1e-3)) lost++;
  }
  ok(`pond-west-link 岸上部分完整（中线采样 ${checked} 点缺 ${lost}）`, checked > 30 && lost === 0);
}

// ---------------- 4) 不许退化：水面、桥端接缝、穿水、背面、站点模块未动 ----------------
{
  const water = W.nodes.filter(isWater);
  const ys = water.flatMap((n) => Array.from({ length: n.P.length / 3 }, (_, i) => n.P[i * 3 + 1]));
  ok(`池水网格在、高度 = layout ${Q.WATER_Y}（${water.length} 节点，y ${Math.min(...ys)}..${Math.max(...ys)}）`, water.length === 1 && Math.abs(Math.min(...ys) - Q.WATER_Y) < 1e-4 && Math.abs(Math.max(...ys) - Q.WATER_Y) < 1e-4);
  let holes = 0, inside = 0, visible = 0;
  for (let x = Math.ceil(Math.min(...xs) * 2) / 2; x <= Math.max(...xs); x += 0.5) for (let z = Math.ceil(Math.min(...zs) * 2) / 2; z <= Math.max(...zs); z += 0.5) {
    if (!Q.pointInPoly([x, z], Q.WATER_POLY)) continue;
    inside++;
    const col = G.column(x, z);
    if (!col.some((h) => isWater(h.node))) holes++;
    const top = col.find((h) => h.ny > 0.2 && h.y <= 0.3 && !isStructure(h.node));
    if (top && isWater(top.node)) visible++;
  }
  ok(`池水无洞（${inside} 点缺 ${holes}）`, holes === 0);
  ok(`池水从上方露出 ≥ 88%（${(100 * visible / inside).toFixed(1)}%；驳岸压顶只占沿边一圈）`, visible / inside >= 0.88);
  // 除桥墩、湖心亭桩与驳岸池壁外没有三角穿过水面
  const toTris = (nodes) => { const out = []; for (const n of nodes) { const { P, T } = n; for (let t = 0; t < T.length; t += 3) { const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]]; const mn = [0, 1, 2].map((c) => Math.min(A[c], B[c], C[c])), mx = [0, 1, 2].map((c) => Math.max(A[c], B[c], C[c])); if (mx[0] < REGION[0] || mn[0] > REGION[2] || mx[2] < REGION[1] || mn[2] > REGION[3]) continue; out.push({ A, B, C, node: n.file + ' ' + n.id, min: mn, max: mx }); } } return out; };
  const TO = toTris(W.nodes.filter((n) => !isWater(n) && !isStructure(n) && !isRevet(n))).filter((t) => t.min[1] < Q.WATER_Y && t.max[1] > Q.WATER_Y);
  const x = crossIntersect(toTris(water), TO, 1.0);
  ok(`除桥墩 / 湖心亭桩 / 驳岸池壁外无三角穿过水面（${x.crossings}）`, x.crossings === 0, x.pairs.slice(0, 3).map((p) => p.pair).join('; '));
  // 桥端接缝（09-27 Sol 岸端修复）：桥端 ±0.6 m、横向 -1.1..1.1 顶面剖面无缺口、无错台
  const struct = new Q.VGrid(W.nodes.filter((n) => isBridge(n) || /jiuqu-bridge-step/.test(n.id || '') || n.id === 'east-landing-access-apron'), { cell: 0.5 });
  for (const [id, e, inner] of [['jiuqu-bridge-step-w', Q.BRIDGE_LINE[0], Q.BRIDGE_LINE[1]], ['jiuqu-bridge-step-e', Q.BRIDGE_LINE.at(-1), Q.BRIDGE_LINE.at(-2)]]) {
    const into = [inner[0] - e[0], inner[1] - e[1]], L = Math.hypot(...into); into[0] /= L; into[1] /= L;
    const side = [-into[1], into[0]];
    let holes2 = 0, jumps = 0;
    for (const a of [-1.1, -0.6, 0, 0.6, 1.1]) {
      let prev = null;
      for (let d = -0.35; d <= 0.6001; d += 0.02) {
        const top = struct.column(e[0] + into[0] * d + side[0] * a, e[1] + into[1] * d + side[1] * a).find((h) => h.ny > 0.2 && h.y <= Q.DECK_Y + 0.05);
        const y = top ? top.y : null;
        if (y === null) holes2++;
        if (prev !== null && y !== null && Math.abs(y - prev) > 0.005) jumps++;
        prev = y;
      }
    }
    ok(`${id} 与桥端接缝：剖面缺口 ${holes2}、错台 ${jumps}`, holes2 === 0 && jumps === 0);
  }
  // 池带程序化件绕序与法线一致（驳岸 / 步道 / 台阶 / 水面）
  const flat = W.nodes.filter((n) => isWater(n) || isRevet(n) || ['pond-west-link', 'jiuqu-bridge-step-w', 'jiuqu-bridge-step-e'].includes(n.id));
  let mism = 0, inv = 0;
  for (const n of flat) { const b = backfaces({ nodes: [{ ...n, material: { doubleSided: n.doubleSided } }] })[0]; mism += b.windingVsNormal.tris; inv += b.closed.invertedIslands + b.closed.inwardTris; }
  ok(`池带程序化件 ${flat.length} 节点：绕序 / 法线不一致 ${mism}、反向闭合块 / 朝内面 ${inv}`, mism === 0 && inv === 0);
  // 本单不动的站点模块：九曲桥 GLB、湖心亭模块（sha 与基线一致）
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  ok('九曲桥站点模块未动（staged/site-modules/jiuqu-bridge.glb sha256 61499669…）', sha(path.join(Q.ROOT, 'staged', 'site-modules', 'jiuqu-bridge.glb')).startsWith('61499669ecf00f4f'));
}

// ---------------- 5) 驳岸自身：压顶高、落地、不碰桥与湖心亭 ----------------
{
  const rv = W.nodes.filter(isRevet);
  if (!rv.length) ok('驳岸网格存在（kind=revetment）', false);
  else {
    const ys = rv.flatMap((n) => Array.from({ length: n.P.length / 3 }, (_, i) => n.P[i * 3 + 1]));
    const top = Math.max(...ys), bot = Math.min(...ys);
    ok(`驳岸网格存在（${rv.map((n) => n.file + ':' + n.name).join(',')}）`, rv.every((n) => n.file.startsWith('zone-pond')));
    ok(`驳岸压顶 ${top.toFixed(3)} 高出水面 ≥ 0.15、低于桥面底 0.37`, top >= Q.WATER_Y + 0.15 && top < 0.37);
    ok(`驳岸岸墙落到外围地面 ${GROUND_Y}（实测底 ${bot.toFixed(3)}）`, Math.abs(bot - GROUND_Y) < 1e-3);
    // 朝向：压顶朝上；竖面按几何法线外推 0.1 m —— 外岸墙的点落在水池多边形外，池壁的点落在池内且离岸线 > 0.35 m
    let wrong = 0, faces = 0;
    for (const n of rv) {
      const { P, T } = n;
      for (let t = 0; t < T.length; t += 3) {
        const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]];
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...nr);
        if (l < 1e-9) continue;
        faces++;
        const c = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
        if (nr[1] / l > 0.9) continue;                                         // 压顶：朝上即可
        if (nr[1] / l < -0.1) { wrong++; continue; }                           // 驳岸不该有朝下的面
        const q = [c[0] + nr[0] / l * 0.1, c[2] + nr[2] / l * 0.1];
        const inPool = Q.pointInPoly(q, Q.WATER_POLY), dEdge = Q.distToPolyline([c[0], c[2]], Q.WATER_POLY, true).d;
        const outerWall = dEdge < 0.05;                                        // 外岸墙贴水池边线
        if (outerWall ? inPool : !(inPool && Q.distToPolyline(q, Q.WATER_POLY, true).d > REVET_BAND)) wrong++;
      }
    }
    ok(`驳岸 ${faces} 面朝向：压顶朝上、外岸墙朝岸、池壁朝池心（错 ${wrong}）`, faces > 100 && wrong === 0);
    const toTris = (nodes) => { const out = []; for (const n of nodes) { const { P, T } = n; for (let t = 0; t < T.length; t += 3) { const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]]; out.push({ A, B, C, node: n.name, min: [0, 1, 2].map((c) => Math.min(A[c], B[c], C[c])), max: [0, 1, 2].map((c) => Math.max(A[c], B[c], C[c])) }); } } return out; };
    const xh = crossIntersect(toTris(rv), toTris(W.nodes.filter(isHT)), 1.0);
    ok(`驳岸 × 湖心亭 互穿 ${xh.crossings}`, xh.crossings === 0);
    const xb = crossIntersect(toTris(rv), toTris(W.nodes.filter(isBridge)), 1.0);
    // 桥墩柱落在驳岸带上是石墩穿压顶（结构上合理），只允许墩柱（y<0.37）与之相交，桥面 / 栏杆不许
    const bad = xb.pairs.filter((p) => p.max[1] !== null && p.max[1] > 0.37);
    ok(`驳岸只与桥墩柱相交、不碰桥面 / 栏杆（交线 ${xb.lenM} m，桥面以上 ${bad.length} 组）`, bad.length === 0);
  }
}

console.log(`\npondqa-test: ${pass} pass, ${fail} fail (${OUT})`);
process.exit(fail ? 1 : 0);
