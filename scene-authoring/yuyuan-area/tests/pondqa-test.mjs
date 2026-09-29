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
  const TO = toTris(W.nodes.filter((n) => !isWater(n) && !isStructure(n) && !isRevet(n) && n.kind !== 'bridgeHead')).filter((t) => t.min[1] < Q.WATER_Y && t.max[1] > Q.WATER_Y);
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
  // wave10 第二轮起桥 GLB 由生成器重出（主控批准）：staged 副本须等于 docs/MIGRATION-ASSETS.json 登记的最新 sha（待归档段优先）
  const mig = JSON.parse(fs.readFileSync(path.join(Q.ROOT, '..', '..', 'docs', 'MIGRATION-ASSETS.json'), 'utf8'));
  const rel = 'scene-authoring/yuyuan-area/staged/site-modules/jiuqu-bridge.glb';
  const pend = (mig.wave10PondqaPendingLeadArchive?.changedStagedAssets || []).find((f) => f.path === rel);
  const reg = pend || mig.files.find((f) => f.path === rel);
  const cur = sha(path.join(Q.ROOT, 'staged', 'site-modules', 'jiuqu-bridge.glb'));
  ok(`九曲桥站点模块 = MIGRATION-ASSETS 登记（${pend ? 'wave10 待归档段' : 'files[]'} ${reg?.sha256?.slice(0, 12)}，实际 ${cur.slice(0, 12)}）`, reg && cur === reg.sha256);
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

// ================= wave10-pondqa 第二轮（主控 2026-09-27 定 #1 #4 #5 #6 #8 #9 与东接驳垫）=================
const MAN = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const toTris = (nodes) => { const out = []; for (const n of nodes) { const { P, T } = n; for (let t = 0; t < T.length; t += 3) { const A = [P[T[t] * 3], P[T[t] * 3 + 1], P[T[t] * 3 + 2]], B = [P[T[t + 1] * 3], P[T[t + 1] * 3 + 1], P[T[t + 1] * 3 + 2]], C = [P[T[t + 2] * 3], P[T[t + 2] * 3 + 1], P[T[t + 2] * 3 + 2]]; out.push({ A, B, C, node: n.name, min: [0, 1, 2].map((c) => Math.min(A[c], B[c], C[c])), max: [0, 1, 2].map((c) => Math.max(A[c], B[c], C[c])) }); } } return out; };
const BR_HALF = (Q.BRIDGE.width ?? 2.4) / 2, EDGE_IN = 0.19;
// 桥栏线 = 桥面边线内缩 0.19（望柱心线），斜接按本侧法线（layout 重算，不读桥 GLB）
function mitreHalf(i, side, half) {
  const pts = Q.BRIDGE_LINE, n = pts.length;
  const nr = (k) => { const dx = pts[k + 1][0] - pts[k][0], dz = pts[k + 1][1] - pts[k][1], l = Math.hypot(dx, dz); return [-dz / l, dx / l]; };
  if (i <= 0) { const q = nr(0); return [pts[0][0] + q[0] * side * half, pts[0][1] + q[1] * side * half]; }
  if (i >= n - 1) { const q = nr(n - 2); return [pts[n - 1][0] + q[0] * side * half, pts[n - 1][1] + q[1] * side * half]; }
  const n0 = nr(i - 1), n1 = nr(i);
  let cx = (n0[0] + n1[0]) * side, cz = (n0[1] + n1[1]) * side, cl = Math.hypot(cx, cz);
  if (cl < 1e-6) { cx = n1[0] * side; cz = n1[1] * side; cl = 1; }
  cx /= cl; cz /= cl;
  const m = Math.min(half / Math.max((cx * n1[0] + cz * n1[1]) * side, 0.35), 1.9);
  return [pts[i][0] + cx * m, pts[i][1] + cz * m];
}
// 湖心亭抱厦开口（layout 重算：footprint 面积形心 + 最长边主轴，+v 临桥；开口 = 抱厦中心线 ±0.75，湖心亭一侧）
const HTF = (() => {
  const fp = Q.HT_POLY, n = fp.length; let a2 = 0, cx = 0, cz = 0;
  for (let k = 0; k < n; k++) { const p = fp[k], q = fp[(k + 1) % n], c = p[0] * q[1] - q[0] * p[1]; a2 += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c; }
  cx /= 3 * a2; cz /= 3 * a2;
  let best = null; for (let k = 0; k < n; k++) { const p = fp[k], q = fp[(k + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (!best || L > best[0]) best = [L, p, q]; }
  let ux = (best[2][0] - best[1][0]) / best[0], uz = (best[2][1] - best[1][1]) / best[0]; if (ux < 0) { ux = -ux; uz = -uz; }
  return { cx, cz, ux, uz, vx: uz, vz: -ux };
})();
const htLocal = (x, z) => [(x - HTF.cx) * HTF.ux + (z - HTF.cz) * HTF.uz, (x - HTF.cx) * HTF.vx + (z - HTF.cz) * HTF.vz];
const bridgeNodes = W.nodes.filter(isBridge);
const BG = new Q.VGrid(bridgeNodes, { cell: 0.5 });

// ---------------- 6) #5 栏杆不透光：板脚 / 板柱之间没有缝，且整排栏杆在桥面上 ----------------
{
  const pts = Q.BRIDGE_LINE;
  let samples = 0, see = 0, openSee = 0, openSamples = 0; const where = [];
  const heights = [0.02, 0.4, 0.75];
  for (let i = 0; i + 1 < pts.length; i++) for (const side of [-1, 1]) {
    const a = mitreHalf(i, side, BR_HALF - EDGE_IN), b = mitreHalf(i + 1, side, BR_HALF - EDGE_IN);
    const el = Math.hypot(b[0] - a[0], b[1] - a[1]); if (el < 0.3) continue;
    const ed = [(b[0] - a[0]) / el, (b[1] - a[1]) / el];
    const nrm = [-ed[1], ed[0]];
    for (let t = 0.12; t <= el - 0.12; t += 0.005) {
      const p = [a[0] + ed[0] * t, a[1] + ed[1] * t];
      const [lu, lv] = htLocal(p[0], p[1]);
      const cNear = Q.distToPolyline(p, pts).at;
      const htSide = (p[0] - cNear[0]) * (HTF.cx - cNear[0]) + (p[1] - cNear[1]) * (HTF.cz - cNear[1]) > 0;   // 栏杆线在桥中线的湖心亭一侧
      // 开口 = 抱厦中心线 ±0.75（两侧望柱心）：|u| < 0.5 必须通透；0.5–0.70 是望柱半弦过渡带，两项都不计
      const nearOpen = htSide && Math.abs(lu) < 0.70 && lv > 0 && lv < 9;
      const inOpen = nearOpen && Math.abs(lu) < 0.5;
      for (const h of heights) {
        const y = Q.DECK_Y + h;
        // 横穿栏杆线的水平线段：从桥面一侧 0.30 m（在望柱 0.22 方柱外）到外侧；板脚高度只到 +0.06（不碰桥面边石）
        const out = h < 0.07 ? 0.06 : 0.30;
        const A = [p[0] - nrm[0] * 0.30 * side, y, p[1] - nrm[1] * 0.30 * side], B = [p[0] + nrm[0] * out * side, y, p[1] + nrm[1] * out * side];
        const hit = Q.segHit(BG.near(A[0], A[2], B[0], B[2]).filter((tr) => tr.y0 <= y && tr.y1 >= y), A, B);
        if (inOpen) { openSamples++; if (!hit) openSee++; continue; }
        if (nearOpen) continue;
        samples++;
        if (!hit) { see++; if (where.length < 4) where.push(`span${i}/${side} t${t.toFixed(2)} h${h}`); }
      }
    }
  }
  ok(`#5 栏杆线（桥面边内缩 0.19，layout 重算）不透光：板脚 +0.02 / 板中 +0.40 / 扶手下 +0.75 三个高度每 5 mm 采样 ${samples}，透光 ${see}`, see === 0, where.join('; '));
  ok(`#1 抱厦正对处栏杆开口：开口内采样 ${openSamples}，通透 ${openSee}（≥ 95%）`, openSamples > 0 && openSee / openSamples >= 0.95);
  // 开口两侧望柱：开口端点（抱厦中心线 ±0.75，湖心亭一侧栏杆线上）0.06 m 内有望柱（桥面 +0.5 处水平截到柱）
  let postsOk = 0;
  for (const su of [-0.75, 0.75]) {
    const x = HTF.cx + HTF.ux * su, z = HTF.cz + HTF.uz * su;
    // 从抱厦中心线沿 v 找到栏杆线：湖心亭一侧栏杆线 = 桥中线 − (1.2 − 0.19)
    const near = Q.distToPolyline([x, z], pts);
    const dir = [near.at[0] - x, near.at[1] - z], L = Math.hypot(...dir);
    const q = [near.at[0] - dir[0] / L * (BR_HALF - EDGE_IN), near.at[1] - dir[1] / L * (BR_HALF - EDGE_IN)];
    const col = BG.column(q[0], q[1]).filter((h) => h.y > Q.DECK_Y + 0.9 && h.y < Q.DECK_Y + 0.97);
    if (col.length) postsOk++;
  }
  ok(`#1 开口两侧各有望柱（${postsOk}/2）`, postsOk === 2);
}

// ---------------- 7) #1 湖心亭让桥：桥栏顶以下不进桥面、行走带 +2.2 m 以下无构件、与桥无互穿 / 共面 ----------------
{
  const ht = W.nodes.filter(isHT);
  let low = 0, head = 0;
  for (const n of ht) for (let i = 0; i < n.P.length / 3; i++) {
    const x = n.P[i * 3], y = n.P[i * 3 + 1], z = n.P[i * 3 + 2];
    if (y < -0.1) continue;
    const d = Q.distToPolyline([x, z], Q.BRIDGE_LINE).d;
    if (y < Q.DECK_Y + 1.23 && d < BR_HALF - 0.005) low++;
    if (y < Q.DECK_Y + 2.2 && d < BR_HALF - 0.30) head++;
  }
  ok(`#1 桥栏顶（桥面 +1.23）以下湖心亭顶点不进桥面（${low}）`, low === 0);
  ok(`#1 桥面 +2.2 m 以下湖心亭顶点不进栏杆内行走带（${head}）`, head === 0);
  const x = crossIntersect(toTris(ht), toTris(bridgeNodes), 1.0);
  // 共面重叠按面积量：0.05 m 网格上两者都在同一高度（±3 mm）有朝上面 = z-fight 面积
  const HGt = new Q.VGrid(ht, { cell: 0.5 });
  let both = 0;
  const hx = Q.HT_POLY.map((p) => p[0]), hz = Q.HT_POLY.map((p) => p[1]);
  for (let gx = Math.min(...hx) - 4; gx <= Math.max(...hx) + 4; gx += 0.05) for (let gz = Math.min(...hz) - 4; gz <= Math.max(...hz) + 4; gz += 0.05) {
    const hs = HGt.column(gx, gz).filter((q) => q.ny > 0.2); if (!hs.length) continue;
    const bs = BG.column(gx, gz).filter((q) => q.ny > 0.2);
    if (hs.some((a) => bs.some((b) => Math.abs(a.y - b.y) < 0.003))) both++;
  }
  ok(`#1 湖心亭 × 九曲桥 三角互穿 ${x.crossings}、朝上共面重叠 ${(both * 0.0025).toFixed(3)} m²`, x.crossings === 0 && both === 0, x.pairs.slice(0, 3).map((p) => p.pair).join('; '));
}

// ---------------- 8) #4 桥东端岸上段：实心桥头台把岸上桥墩全包住，台不越桥面边、不高过桥面底 ----------------
{
  const head = W.nodes.filter((n) => n.kind === 'bridgeHead');
  ok(`#4 桥头台网格存在（${head.map((n) => n.file + ':' + n.name).join(',') || '无'}）`, head.length === 1 && head[0].file.startsWith('zone-pond'));
  if (head.length) {
    const ys = head.flatMap((n) => Array.from({ length: n.P.length / 3 }, (_, i) => n.P[i * 3 + 1]));
    ok(`#4 桥头台顶 ${Math.max(...ys).toFixed(3)} ≤ 桥面底 ${(Q.DECK_Y - 0.18).toFixed(2)}，底 = 外围地面 ${Math.min(...ys).toFixed(3)}`, Math.max(...ys) <= Q.DECK_Y - 0.18 + 1e-3 && Math.abs(Math.min(...ys) - GROUND_Y) < 1e-3);
    // 台的每个顶点向桥中线收 0.02 m 后，正上方必须是桥面（台不越出桥面轮廓）
    const DG = new Q.VGrid(bridgeNodes.filter((n) => /deck-stone/.test(n.mat)), { cell: 0.5 });
    let out = 0;
    // 收向「两端各缩 0.05 m 的桥中线」上的最近点（桥端角点不会沿端线滑）
    const BL = Q.BRIDGE_LINE.map((p) => p.slice());
    for (const [e, f] of [[0, 1], [BL.length - 1, BL.length - 2]]) { const d = [BL[f][0] - BL[e][0], BL[f][1] - BL[e][1]], l = Math.hypot(...d); BL[e] = [BL[e][0] + d[0] / l * 0.05, BL[e][1] + d[1] / l * 0.05]; }
    for (const n of head) for (let i = 0; i < n.P.length / 3; i++) {
      const p = [n.P[i * 3], n.P[i * 3 + 2]], c = Q.distToPolyline(p, BL).at, d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
      const q = [p[0] + (c[0] - p[0]) / d * 0.02, p[1] + (c[1] - p[1]) / d * 0.02];
      if (!DG.column(q[0], q[1]).some((h) => h.ny > 0.2 && Math.abs(h.y - Q.DECK_Y) < 0.01)) out++;
    }
    ok(`#4 桥头台不越出桥面轮廓（越出顶点 ${out}）`, out === 0);
  }
  // 驳岸内沿（看得见的水边）以外的桥墩：墩柱四角与中心都落在桥头台或桥端台阶（实心落地）的平面里 = 从任何方向都看不见
  const { islands } = await import('./templeqa-lib.mjs');
  const cover = new Q.VGrid([...head, ...W.nodes.filter((n) => /^jiuqu-bridge-step-/.test(n.id || ''))], { cell: 0.5 });
  let landPiers = 0, exposed = 0; const ex = [];
  for (const n of bridgeNodes.filter((m) => /grey-stone/.test(m.mat))) {
    for (const L of islands(n).list) {
      if (!(L.min[1] < -0.3 && L.max[1] <= Q.DECK_Y - 0.17)) continue;
      const c = [(L.min[0] + L.max[0]) / 2, (L.min[2] + L.max[2]) / 2];
      if (Q.pointInPoly(c, Q.WATER_POLY) && Q.distToPolyline(c, Q.WATER_POLY, true).d > 0.35) continue;       // 在看得见的水里
      landPiers++;
      const corners = [[L.min[0], L.min[2]], [L.max[0], L.min[2]], [L.min[0], L.max[2]], [L.max[0], L.max[2]], c];
      const miss = corners.filter(([x, z]) => !cover.column(x, z).some((h) => h.ny > 0.5 && h.y >= Q.DECK_Y - 0.19));   // 覆盖面顶 ≥ 墩顶（桥面底 0.37）
      if (miss.length) { exposed++; if (ex.length < 4) ex.push(c.map((v) => v.toFixed(2)).join(',')); }
    }
  }
  ok(`#4 驳岸内沿以外的桥墩 ${landPiers} 根全部包在桥头台 / 实心台阶里（露出 ${exposed}）`, landPiers >= 12 && exposed === 0, ex.join('; '));
}

// ---------------- 9) 东接驳垫：面片顶面不变（y 0.02），下方实心落到外围地面 ----------------
{
  const ap = W.nodes.filter((n) => n.id === 'east-landing-access-apron');
  const tops = ap.filter((n) => n.kind === 'paving');
  const tys = tops.flatMap((n) => Array.from({ length: n.P.length / 3 }, (_, i) => n.P[i * 3 + 1]));
  ok(`东接驳垫步行面片在（${tops.length} 件，y ${tys.length ? Math.min(...tys).toFixed(3) + '..' + Math.max(...tys).toFixed(3) : '-'} = 0.02）`, tops.length === 1 && Math.abs(Math.min(...tys) - 0.02) < 1e-3 && Math.abs(Math.max(...tys) - 0.02) < 1e-3);
  const AG = new Q.VGrid(ap, { cell: 0.5 });
  let hollow = 0, n = 0;
  const T = tops[0];
  if (T) {
    const xs2 = [], zs2 = []; for (let i = 0; i < T.P.length / 3; i++) { xs2.push(T.P[i * 3]); zs2.push(T.P[i * 3 + 2]); }
    const cx = xs2.reduce((a, b) => a + b) / xs2.length, cz = zs2.reduce((a, b) => a + b) / zs2.length;
    for (const f of [0, 0.3, 0.6]) for (let k = 0; k < xs2.length; k++) {
      const x = cx + (xs2[k] - cx) * f, z = cz + (zs2[k] - cz) * f;
      const col = AG.column(x, z); n++;
      const lowest = col.length ? col[col.length - 1].y : null;
      if (lowest === null || lowest > GROUND_Y + 0.01) hollow++;
    }
  }
  ok(`东接驳垫实心落地（${n} 点中下方未到 ${GROUND_Y} 的 ${hollow}）`, n > 0 && hollow === 0);
}

// ---------------- 10) #9 池水归池带 / #6 池水材质 ----------------
{
  const pondFiles = new Set(MAN.zones.filter((z) => z.id === 'pond').map((z) => z.file));
  const waterIn = W.nodes.filter((n) => n.id === Q.POND_WATER_ID && n.kind === 'water').map((n) => n.file);
  ok(`#9 池水（layout.zones.pond.polygon 即其轮廓）只在池带分件（实际在 ${waterIn.join(',') || '无'}）`, waterIn.length === 1 && pondFiles.has(waterIn[0]));
  const w = W.nodes.find((n) => n.id === Q.POND_WATER_ID && n.kind === 'water');
  const { readGlbRaw } = await import('./templeqa-lib.mjs');
  let mat = null;
  if (w) { const { json } = readGlbRaw(path.join(OUT, w.file)); mat = (json.materials || []).find((m) => m.name === w.mat); }
  // wave13-nightbalance N2 改约：池水不再用 #4a665c / rough 0.35 平色材质（Cycles 夜景把天空/点光
  // 聚成亮青绿镜面、白天团状高光斑），改走 water 槽贴图材质——paving-water（深墨绿基色贴图，线性
  // 平均 ~0.058，由 tests/nightbalance-albedo-test.py C5 独立把关）+ 程序化缓波法线 + roughness 0.5
  // （两端同参数：scripts/export-zones.py water_material / scripts/render-control-passes.py water_slot_material）。
  const pbr = mat?.pbrMetallicRoughness || {};
  const hasBase = !!pbr.baseColorTexture, hasNormal = !!mat?.normalTexture;
  const rough = pbr.roughnessFactor ?? 1;
  ok(`#6 池水材质 = water 槽（名 paving-water、基色贴图 + 法线贴图、粗糙度 ${rough.toFixed(2)} = 0.5）`,
     mat?.name === 'paving-water' && hasBase && hasNormal && Math.abs(rough - 0.5) < 0.01);
  // wave13-nightbalance R1（astra 必修5）：#6 只查「有贴图」不够——补连接关系：
  //   1) 水面 primitive 实际引用 paving-water（不是只有同名材质挂在文件里）；
  //   2) 该 primitive 有 TEXCOORD_0（贴图无 UV 等于没贴）；
  //   3) 材质引用的基色 / 法线贴图字节 = 磁盘 resources/textures/paving/water*.jpg（C5「磁盘贴图即所用贴图」的
  //      连接端；均值口径：贴图实测线性均值 ~0.058 由 nightbalance-albedo-test.py C5 把关，RECIPE 里 #3d5348
  //      基色估算 ~0.067 是另一口径，两者都不得混写成一个数）；
  //   4) normalTexture.scale = 0.55（双端同参数的另一半）。
  if (w && mat) {
    const { json, bin } = readGlbRaw(path.join(OUT, w.file));
    const matIdx = (json.materials || []).findIndex((m) => m.name === 'paving-water');
    const prims = [];
    for (const mesh of json.meshes || []) for (const prim of mesh.primitives || [])
      if (prim.material === matIdx) prims.push({ mesh: mesh.name, prim });
    ok(`#6b 水面 primitive 实际引用 paving-water（${prims.length} 个 primitive）`, prims.length >= 1);
    const noUv = prims.filter((x) => !x.prim.attributes || x.prim.attributes.TEXCOORD_0 === undefined);
    ok(`#6c 水面 primitive 全部带 TEXCOORD_0（缺 UV ${noUv.length} 个）`, prims.length >= 1 && noUv.length === 0);
    const imgBytes = (texIdx) => {
      const tex = (json.textures || [])[texIdx];
      const im = (json.images || [])[tex?.source];
      if (!im || im.bufferView === undefined) return null;
      const bv = json.bufferViews[im.bufferView];
      return bin.subarray((bv.byteOffset || 0), (bv.byteOffset || 0) + bv.byteLength);
    };
    const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
    const disk = (f) => fs.readFileSync(path.join(Q.ROOT, 'resources', 'textures', 'paving', f));
    const baseB = imgBytes(pbr.baseColorTexture?.index), normB = imgBytes(mat.normalTexture?.index);
    ok(`#6d 基色贴图字节 = 磁盘 water.jpg（${baseB ? sha(baseB).slice(0, 12) : '无'} vs ${sha(disk('water.jpg')).slice(0, 12)}）`,
       !!baseB && sha(baseB) === sha(disk('water.jpg')));
    ok(`#6e 法线贴图字节 = 磁盘 water-normal.jpg（${normB ? sha(normB).slice(0, 12) : '无'} vs ${sha(disk('water-normal.jpg')).slice(0, 12)}）`,
       !!normB && sha(normB) === sha(disk('water-normal.jpg')));
    const ns = mat.normalTexture?.scale;
    // gltfpack 把 0.55 写成 float32 十进制（0.550000012），与 JS 字面量 0.55 不是 ===。
    ok(`#6f normalTexture.scale ${ns} = 0.55（export-zones / render-control-passes 双端同参数，float32 容差）`,
       typeof ns === 'number' && Math.abs(ns - 0.55) < 1e-5);
  }
}

// ---------------- 11) #8 池内没有路面 ----------------
{
  let over = 0; const by = new Map();
  for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x += 0.25) for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z += 0.25) {
    if (!Q.pointInPoly([x, z], Q.WATER_POLY)) continue;
    for (const h of G.column(x, z)) if (['road', 'plaza'].includes(h.node.kind)) { over++; by.set(h.node.id, (by.get(h.node.id) || 0) + 1 / 16); break; }
  }
  ok(`#8 池水轮廓内的路面 ${(over / 16).toFixed(2)} m² ≤ 0.05`, over / 16 <= 0.05, JSON.stringify(Object.fromEntries([...by].map(([k, v]) => [k, +v.toFixed(2)]))));
}

console.log(`\npondqa-test: ${pass} pass, ${fail} fail (${OUT})`);
process.exit(fail ? 1 : 0);
