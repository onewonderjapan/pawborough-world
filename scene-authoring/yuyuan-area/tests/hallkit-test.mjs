// 厅堂套件测试（WP8，HALL_KIT=1）：modules/hall-kit/ids.json 里的每一栋逐项核对。
// 位置/朝向只认 baseline/layout.json（+ modules/hall-kit/defaults.json 输入参数）重算值，与总装产物实测对比；
// 本文件的外接矩形/朝向实现是独立一份，不引用 modules/hall-kit/frame.{py,mjs}，不读模块自报的 measurements。
//   位置 = footprint 多边形面积形心；朝向 = 外接矩形四边里外法线与 facade.dir 点积最大的一边
//   （边长 < frontMinSideM 罚 frontShortPenalty，同 build-scene pickEdge）。与 facade.dir 的夹角只打印（INFO），
//   facade.dir 是「形心→最近园内水面」方向，不保证垂直于 footprint 任何一边。
// 用法：OUT_DIR=out-zone HALL_KIT=1 node tests/hallkit-test.mjs（无产物或开关未开时跳过）
//   可选 HALL_KIT_BASE_OUT=<HALL_KIT=0 的产物目录>：核对核心区首次加载 meshopt 增量 ≤ 1.0 MB。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const HK = path.join(ROOT, 'modules', 'hall-kit');
const IDS = JSON.parse(fs.readFileSync(path.join(HK, 'ids.json'), 'utf8')).ids;
const DEF = JSON.parse(fs.readFileSync(path.join(HK, 'defaults.json'), 'utf8'));
const glbOf = (id) => path.join(ROOT, 'out-garden-kits', 'hallkit-' + id, 'model.glb');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}
function skip(name, why) { skipped++; console.log('SKIP', name, '-', why); }

if (process.env.HALL_KIT === '0' || !fs.existsSync(path.join(OUT, 'garden.glb'))) {
  console.log(`hallkit artefacts not found or HALL_KIT=0 (OUT_DIR=${OUT}) — skipping`);
  process.exit(0);
}
// 开关开着却缺某栋模块 GLB = 失败（不静默跳过）
const missingGlb = IDS.filter((id) => !fs.existsSync(glbOf(id)));
if (missingGlb.length) { console.log('FAIL 模块 GLB 缺失:', missingGlb.join(', ')); process.exit(1); }

// ---------- GLB 解析（节点世界矩阵 + 子树顶点收集，与 sansuitang-test 同实现） ----------
function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen));
  let bin = null;
  if (28 + jsonLen < buf.length) {
    const binLen = buf.readUInt32LE(20 + jsonLen);
    bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  }
  const comp = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function accessor(ai) {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const [bsize, Arr] = comp[a.componentType];
    const nc = ncomp[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || bsize * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) {
      const o = off + i * stride;
      out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + o, nc)));
    }
    return out;
  }
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function mulVec(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  const nodesByName = new Map((json.nodes || []).map((n, i) => [n.name || `node${i}`, { n, i }]));
  const parentOf = new Map();
  for (const [i, n] of (json.nodes || []).entries()) for (const c of n.children || []) parentOf.set(c, i);
  function worldMatrixOf(ni) {
    let m = null, cur = ni;
    while (cur !== undefined) { m = m ? mul4(nodeMatrix(json.nodes[cur]), m) : nodeMatrix(json.nodes[cur]); cur = parentOf.get(cur); }
    return m || nodeMatrix(json.nodes[ni]);
  }
  function subtreeVerts(rootName, filter = null) {
    const entry = nodesByName.get(rootName);
    if (!entry) return null;
    const verts = [];
    const w = (ni, pm) => {
      const n = json.nodes[ni];
      const m = pm ? mul4(pm, nodeMatrix(n)) : worldMatrixOf(ni);
      if (n.mesh !== undefined && (!filter || filter(n))) {
        for (const p of json.meshes[n.mesh].primitives) {
          for (const v of accessor(p.attributes.POSITION)) verts.push(mulVec(m, v));
        }
      }
      for (const c of n.children || []) w(c, m);
    };
    w(entry.i, null);
    return verts;
  }
  // 子树全部三角（世界坐标）：共享边越界检查用
  function subtreeTris(rootName) {
    const entry = nodesByName.get(rootName);
    if (!entry) return null;
    const tris = [];
    const w = (ni, pm) => {
      const n = json.nodes[ni];
      const m = pm ? mul4(pm, nodeMatrix(n)) : worldMatrixOf(ni);
      if (n.mesh !== undefined) {
        for (const p of json.meshes[n.mesh].primitives) {
          const P = accessor(p.attributes.POSITION).map((v) => mulVec(m, v));
          const I = p.indices !== undefined ? accessor(p.indices).map((x) => x[0]) : P.map((_, i) => i);
          for (let k = 0; k + 2 < I.length; k += 3) tris.push([P[I[k]], P[I[k + 1]], P[I[k + 2]]]);
        }
      }
      for (const c of n.children || []) w(c, m);
    };
    w(entry.i, null);
    return tris;
  }
  function imageDims(img) {
    const bv = json.bufferViews[img.bufferView];
    const b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    return null;
  }
  return { json, nodesByName, subtreeVerts, subtreeTris, imageDims, nodeCount: (json.nodes || []).length, materials: json.materials || [] };
}

// ---------- layout 重算（唯一权威来源）：面积形心 + 最小面积外接矩形 + 正立面边 ----------
function hullOf(pts) {
  const s = [...new Set(pts.map((p) => `${p[0]},${p[1]}`))].map((k) => k.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (const p of s.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function expectFrame(obj) {
  const fpRaw = obj.geometry.footprint;
  const fp = fpRaw[0][0] === fpRaw.at(-1)[0] && fpRaw[0][1] === fpRaw.at(-1)[1] ? fpRaw.slice(0, -1) : fpRaw;
  const n = fp.length;
  const a2 = fp.reduce((s, p, i) => s + p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1], 0) / 2;
  const cx = fp.reduce((s, p, i) => s + (p[0] + fp[(i + 1) % n][0]) * (p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1]), 0) / (6 * a2);
  const cz = fp.reduce((s, p, i) => s + (p[1] + fp[(i + 1) % n][1]) * (p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1]), 0) / (6 * a2);
  const H = hullOf(fp);
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const [x1, y1] = H[i], [x2, y2] = H[(i + 1) % H.length];
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 1e-9) continue;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const us = H.map((p) => (p[0] - x1) * ux + (p[1] - y1) * uy);
    const vs = H.map((p) => -(p[0] - x1) * uy + (p[1] - y1) * ux);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1, px: x1, py: y1 };
  }
  const { ux, uy, u0, u1, v0, v1, px, py } = best;
  const rcx = px + ((u0 + u1) / 2) * ux - ((v0 + v1) / 2) * uy;
  const rcz = py + ((u0 + u1) / 2) * uy + ((v0 + v1) / 2) * ux;
  const [fdx, fdz] = obj.facade.dir;
  const fl = Math.hypot(fdx, fdz);
  const f = [fdx / fl, fdz / fl];
  const la = (u1 - u0) / 2, lb = (v1 - v0) / 2;
  // 四边候选：外法线、边长、面宽半长 hu、进深半长 hv
  const cands = [[[-uy, ux], 2 * la, la, lb], [[uy, -ux], 2 * la, la, lb], [[ux, uy], 2 * lb, lb, la], [[-ux, -uy], 2 * lb, lb, la]];
  const minSide = DEF.frontMinSideM ?? 3.2, pen = DEF.frontShortPenalty ?? 0.6;
  let sel = null, bs = -Infinity;
  for (const c of cands) { const s = c[0][0] * f[0] + c[0][1] * f[1] - (c[1] < minSide ? pen : 0); if (s > bs) { bs = s; sel = c; } }
  const [nrm, , hu, hv] = sel;
  const facadeDelta = Math.acos(Math.max(-1, Math.min(1, nrm[0] * f[0] + nrm[1] * f[1]))) * 180 / Math.PI;
  const coverage = Math.abs(a2) / best.area;
  return { cx, cz, rcx, rcz, nrm, hu, hv, rotY: Math.atan2(nrm[0], nrm[1]), facadeDelta, coverage };
}

// 共享边（独立实现）：本栋 footprint 边与其他会渲染建筑的 footprint 边重合（对方两端点到本边直线 ≤ 0.05 m、重叠 ≥ 0.3 m）。
const SHARED_KINDS = new Set(['hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock', 'outerBuilding']);
const ringOf = (fpRaw) => (fpRaw[0][0] === fpRaw.at(-1)[0] && fpRaw[0][1] === fpRaw.at(-1)[1] ? fpRaw.slice(0, -1) : fpRaw);
function sharedEdgesOf(obj) {
  const fp = ringOf(obj.geometry.footprint);
  const a2 = fp.reduce((s, p, i) => s + p[0] * fp[(i + 1) % fp.length][1] - fp[(i + 1) % fp.length][0] * p[1], 0);
  const out = [];
  fp.forEach((a, i) => {
    const b = fp[(i + 1) % fp.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.3) return;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const n = a2 > 0 ? [uz, -ux] : [-uz, ux];
    for (const q of LAYOUT.objects) {
      if (q.id === obj.id || q.skipRender || !SHARED_KINDS.has(q.kind) || !q.geometry?.footprint) continue;
      const qf = ringOf(q.geometry.footprint);
      qf.forEach((c, j) => {
        const d = qf[(j + 1) % qf.length];
        const off = (p) => Math.abs(-(p[0] - a[0]) * uz + (p[1] - a[1]) * ux);
        if (off(c) > 0.05 || off(d) > 0.05) return;
        const tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz, td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz;
        const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(L, Math.max(tc, td));
        if (hi - lo >= 0.3) out.push({ a, ux, uz, n, lo, hi, other: q.id });
      });
    }
  });
  return out;
}
// 三角落在共享边「条带」（沿边投影在重叠段内）里越过边线的最大距离：三角按条带两端裁剪后取外法向最大值
function maxBeyond(tris, e) {
  let worst = -Infinity;
  for (const t of tris) {
    let poly = t.map((p) => { const dx = p[0] - e.a[0], dz = p[2] - e.a[1]; return [dx * e.ux + dz * e.uz, dx * e.n[0] + dz * e.n[1]]; });
    for (const [lim, sg] of [[e.lo, 1], [e.hi, -1]]) {
      const res = [];
      for (let i = 0; i < poly.length; i++) {
        const P = poly[i], Q = poly[(i + 1) % poly.length];
        const inP = sg * (P[0] - lim) >= 0, inQ = sg * (Q[0] - lim) >= 0;
        if (inP) res.push(P);
        if (inP !== inQ) { const k = (lim - P[0]) / (Q[0] - P[0]); res.push([lim, P[1] + k * (Q[1] - P[1])]); }
      }
      poly = res;
      if (!poly.length) break;
    }
    for (const p of poly) worst = Math.max(worst, p[1]);
  }
  return worst;
}

const garden = parseGlb(path.join(OUT, 'garden.glb'));
const ps = JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8'));
const cwPath = path.join(OUT, 'hallkit-collision-world.json');
const cw = fs.existsSync(cwPath) ? JSON.parse(fs.readFileSync(cwPath, 'utf8')) : null;
const lin = (h) => [0, 2, 4].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const toSrgb255 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const summary = [];

for (const HK_ID of IDS) {
  const obj = LAYOUT.objects.find((o) => o.id === HK_ID);
  if (!obj) { ok(`layout 有 ${HK_ID}`, false); continue; }
  const E = expectFrame(obj);
  const tag = `${HK_ID}(${obj.name || obj.kind})`;
  const platformY = obj.platformY ?? (DEF.kinds?.[obj.kind]?.platformY) ?? DEF.platformY;
  console.log(`\n== ${tag}: 面积形心=(${E.cx.toFixed(3)}, ${E.cz.toFixed(3)}) rect=${(2 * E.hu).toFixed(2)}×${(2 * E.hv).toFixed(2)} ` +
    `rotY=${E.rotY.toFixed(4)} coverage=${E.coverage.toFixed(2)}  INFO facade.dir 偏差 ${E.facadeDelta.toFixed(1)}°`);
  const row = { id: HK_ID, name: obj.name || null, kind: obj.kind, facadeDeltaDeg: +E.facadeDelta.toFixed(2), coverage: +E.coverage.toFixed(3) };

  // ---------- 1) 总装 garden.glb 锚点实测 ----------
  const anchorEntry = garden.nodesByName.get(HK_ID);
  ok(`${tag} garden.glb 有锚节点`, !!anchorEntry);
  if (anchorEntry) {
    const t = anchorEntry.n.translation || [0, 0, 0];
    const q = anchorEntry.n.rotation || [0, 0, 0, 1];
    const dist = Math.hypot(t[0] - E.cx, t[2] - E.cz);
    ok(`${tag} 锚点位置 = footprint 面积形心（偏差 ${dist.toFixed(3)} m ≤ 0.5）`, dist <= 0.5, `got (${t[0].toFixed(2)}, ${t[2].toFixed(2)})`);
    const yaw = 2 * Math.atan2(q[1], q[3]);
    const ang = Math.acos(Math.max(-1, Math.min(1, Math.sin(yaw) * E.nrm[0] + Math.cos(yaw) * E.nrm[1]))) * 180 / Math.PI;
    ok(`${tag} 锚点朝向 vs 正立面边外法线（夹角 ${ang.toFixed(2)}° ≤ 5）`, ang <= 5, `yaw=${yaw.toFixed(4)} want=${E.rotY.toFixed(4)}`);
    row.anchorPosErrM = +dist.toFixed(3); row.anchorYawErrDeg = +ang.toFixed(2);

    // 2) 子树几何实测：平面包围盒中心 vs 外接矩形中心；台基层（y ≤ 台基顶）在正立面系里的外廓 = 矩形外扩 platformOut
    const verts = garden.subtreeVerts(HK_ID);
    ok(`${tag} 子树有几何`, !!verts && verts.length > 300, `verts=${verts ? verts.length : 0}`);
    if (verts && verts.length) {
      const ct = Math.cos(E.rotY), st = Math.sin(E.rotY);
      const toUV = (v) => { const rx = v[0] - E.rcx, rz = v[2] - E.rcz; return [rx * ct - rz * st, rx * st + rz * ct]; };
      const low = verts.filter((v) => v[1] <= platformY + 1e-3).map(toUV);
      let uu0 = 1e9, uu1 = -1e9, vv0 = 1e9, vv1 = -1e9;
      for (const [u, v] of low) { uu0 = Math.min(uu0, u); uu1 = Math.max(uu1, u); vv0 = Math.min(vv0, v); vv1 = Math.max(vv1, v); }
      const po = DEF.platformOut;
      const tol = 0.15;
      // 各侧期望外廓 = 矩形半长 + platformOut；有共享边的一侧不超过共享边（台基齐边）
      const lim = { right: Infinity, left: Infinity, back: Infinity, front: Infinity };
      for (const e of sharedEdgesOf(obj)) {
        const nl = [e.n[0] * ct - e.n[1] * st, e.n[0] * st + e.n[1] * ct];
        const side = Math.abs(nl[0]) > Math.abs(nl[1]) ? (nl[0] > 0 ? 'right' : 'left') : (nl[1] > 0 ? 'front' : 'back');
        for (const t of [e.lo, e.hi]) {
          const [u, v] = toUV([e.a[0] + e.ux * t, 0, e.a[1] + e.uz * t]);
          const d = side === 'right' ? u : side === 'left' ? -u : side === 'front' ? v : -v;
          lim[side] = Math.min(lim[side], d);
        }
      }
      // 共享边只占该侧一段时（wave3 K1 按段限位），台基外廓最远处 = 正常外扩；整侧被邻栋占住时 = 共享边限位。两者都接受。
      const near = (x, normal, l) => Math.min(Math.abs(x - normal), Math.abs(x - Math.min(normal, l)));
      const eR = E.hu + po, eL = E.hu + po, eB = E.hv + po;
      // 踏步所在侧（defaults.kinds.<kind>.steps，输入参数）台基层会伸出踏步：该侧只要求不小于台基边
      const stepsSide = (DEF.kinds?.[obj.kind] || DEF.kinds?.hall || {}).steps || 'front';
      const dL = stepsSide === 'left' ? Math.max(0, Math.min(eL, lim.left) - -uu0) : near(-uu0, eL, lim.left);
      const dR = stepsSide === 'right' ? Math.max(0, Math.min(eR, lim.right) - uu1) : near(uu1, eR, lim.right);
      const dU = Math.max(dL, dR);
      const dBack = stepsSide === 'back' ? Math.max(0, Math.min(eB, lim.back) - -vv0) : near(-vv0, eB, lim.back);
      ok(`${tag} 台基外廓对齐 footprint 外接矩形（两山 -${eL.toFixed(2)}/+${eR.toFixed(2)} 偏差 ${dU.toFixed(3)}、背面 -${eB.toFixed(2)} 偏差 ${dBack.toFixed(3)} ≤ ${tol}）`,
        dU <= tol + 0.04 && dBack <= tol + 0.04, `u=[${uu0.toFixed(2)}, ${uu1.toFixed(2)}] vBack=${vv0.toFixed(2)}`);
      // 戏台：台面（背面台基边线处台基顶）实测高 ≥ 1.0 m（GOAL B3）
      if (obj.kind === 'stage') {
        const allUV = verts.map((v) => [...toUV(v), v[1]]);
        const edgeY = allUV.filter(([u, v, y]) => -v >= eB - 0.06 && y < 3).map((q) => q[2]);
        const top = edgeY.length ? Math.max(...edgeY) : 0;
        ok(`${tag} 戏台台面实测高 ${top.toFixed(2)} m ≥ 1.0`, top >= 1.0);
        row.stagePlatformM = +top.toFixed(3);
      }
      const eF = Math.min(E.hv + po, lim.front);
      ok(`${tag} 正立面在 +Z（台基前沿 ${vv1.toFixed(2)} ≥ ${(eF - tol).toFixed(2)}）`, vv1 >= eF - tol);
      row.platformAlignErrM = +Math.max(dU, dBack).toFixed(3);
    }
    // 2b) 共享边：任何三角不越过与邻栋共用的 footprint 边 0.02 m 以上（台基/墙/额枋/斗拱/檐口一律）
    const shared = sharedEdgesOf(obj);
    row.sharedEdges = shared.map((e) => e.other);
    if (shared.length) {
      const tris = garden.subtreeTris(HK_ID);
      for (const e of shared) {
        const mb = maxBeyond(tris, e);
        ok(`${tag} 不越过与 ${e.other} 的共享边（重叠 ${(e.hi - e.lo).toFixed(2)} m，最大越界 ${mb.toFixed(3)} m ≤ 0.02）`, mb <= 0.02);
        row.sharedEdgeMaxBeyondM = Math.max(row.sharedEdgeMaxBeyondM ?? -Infinity, +mb.toFixed(3));
      }
      // 2c) 按段限位（wave3 K1）：共享边只管真正重合的那一段；同侧非共享段照常出檐、照常放台基，两层楼腰檐照常外伸。
      //   期望值全从 layout + defaults 输入参数重算：墙线 = 外接矩形边 − wallInset；台基 = 矩形边 + platformOut；
      //   正檐 = 墙线 + eaveOver；腰檐 = 墙线 + waistEave.over，腰檐高度带 = 二层楼面 platformY + height/storeys 以下 0.05–1.0 m。
      //   只查硬山（歇山出檐由 eave_kit 四面同值，仍按整侧处理）。窗口：该侧 ±(半长 − 0.6) 内、离共享段两端 ≥ 1.2 m（收头区）。
      if (obj.roofMode === 'gabled') {
        const tris = garden.subtreeTris(HK_ID);
        const ct = Math.cos(E.rotY), st = Math.sin(E.rotY);
        const toUV = (x, z) => { const rx = x - E.rcx, rz = z - E.rcz; return [rx * ct - rz * st, rx * st + rz * ct]; };
        // 侧 → [切向, 外向] 取法
        const SIDE = {
          front: { half: E.hu, out: E.hv, tf: (u, v) => [u, v] }, back: { half: E.hu, out: E.hv, tf: (u, v) => [u, -v] },
          right: { half: E.hv, out: E.hu, tf: (u, v) => [v, u] }, left: { half: E.hv, out: E.hu, tf: (u, v) => [v, -u] } };
        const sideOf = (e) => { const nl = [e.n[0] * ct - e.n[1] * st, e.n[0] * st + e.n[1] * ct];
          return Math.abs(nl[0]) > Math.abs(nl[1]) ? (nl[0] > 0 ? 'right' : 'left') : (nl[1] > 0 ? 'front' : 'back'); };
        // 三角 → (切向 t, 外向 d, 高 y)；按 t∈[t0,t1]、y∈[y0,y1] 裁剪后取 d 最大
        const maxOut = (sd, t0, t1, y0, y1) => {
          let worst = -Infinity;
          for (const tr of tris) {
            let poly = tr.map((p) => { const [u, v] = toUV(p[0], p[2]); const [t, d] = SIDE[sd].tf(u, v); return [t, p[1], d]; });
            for (const [k, lim, sg] of [[0, t0, 1], [0, t1, -1], [1, y0, 1], [1, y1, -1]]) {
              const res = [];
              for (let i = 0; i < poly.length; i++) {
                const P = poly[i], Q = poly[(i + 1) % poly.length];
                const inP = sg * (P[k] - lim) >= 0, inQ = sg * (Q[k] - lim) >= 0;
                if (inP) res.push(P);
                if (inP !== inQ) { const f = (lim - P[k]) / (Q[k] - P[k]); res.push(P.map((c, j) => c + f * (Q[j] - c))); }
              }
              poly = res;
              if (!poly.length) break;
            }
            for (const p of poly) worst = Math.max(worst, p[2]);
          }
          return worst;
        };
        const bySide = {};
        for (const e of shared) {
          const sd = sideOf(e);
          const ts = [e.lo, e.hi].map((t) => { const [u, v] = toUV(e.a[0] + e.ux * t, e.a[1] + e.uz * t); return SIDE[sd].tf(u, v)[0]; });
          (bySide[sd] ||= []).push([Math.min(...ts), Math.max(...ts)]);
        }
        const wIn = DEF.wallInset, over = DEF.eaveOver, wo = DEF.waistEave?.over ?? 0.8;
        const storeys = obj.storeys ?? DEF.storeys;
        const z1 = platformY + (obj.height ?? DEF.height) / storeys;
        for (const [sd, ivs] of Object.entries(bySide)) {
          const S = SIDE[sd];
          const cuts = ivs.map(([a, b]) => [a - 1.2, b + 1.2]).sort((p, q) => p[0] - q[0]);
          const gaps = [];
          let cur = -S.half + 0.6;
          for (const [a, b] of cuts) { if (a > cur) gaps.push([cur, Math.min(a, S.half - 0.6)]); cur = Math.max(cur, b); }
          if (cur < S.half - 0.6) gaps.push([cur, S.half - 0.6]);
          const wins = [];
          for (const [a, b] of gaps.filter(([a, b]) => b - a >= 0.5)) for (let c = a + 0.1; c <= b - 0.1 + 1e-9; c += 0.5) wins.push(c);
          if (!wins.length) { console.log(`INFO ${tag} ${sd} 侧共享边外无 ≥0.5 m 的非共享段（共享段 ${ivs.map(([a, b]) => `[${a.toFixed(2)},${b.toFixed(2)}]`).join(' ')}），按段限位不适用`); continue; }
          const wall = S.out - wIn;
          const minOver = (y0, y1) => Math.min(...wins.map((c) => maxOut(sd, c - 0.1, c + 0.1, y0, y1))) - wall;
          const plat = minOver(-1, platformY + 1e-3) - wIn;   // 相对矩形边
          const eave = minOver(platformY + 0.3, 1e3);
          ok(`${tag} ${sd} 侧非共享段台基照常外扩（${wins.length} 窗最小 ${plat.toFixed(3)} m ≥ platformOut ${DEF.platformOut} − 0.05）`, plat >= DEF.platformOut - 0.05);
          ok(`${tag} ${sd} 侧非共享段正檐照常出挑（最小 ${eave.toFixed(3)} m ≥ eaveOver ${over} − 0.03）`, eave >= over - 0.03);
          row.segmentLimit = { ...(row.segmentLimit || {}), [sd]: { windows: wins.length, platformOutMin: +plat.toFixed(3), eaveOverMin: +eave.toFixed(3) } };
          if (storeys >= 2) {
            const waist = minOver(z1 - 1.0, z1 - 0.05);
            ok(`${tag} ${sd} 侧非共享段腰檐外伸（GLB 实测最小 ${waist.toFixed(3)} m ≥ ${wo}，墙线 = 矩形边 − ${wIn}）`, waist >= wo - 0.005);
            row.segmentLimit[sd].waistOverMin = +waist.toFixed(3);
          }
        }
        // 不穿插：本栋顶点（y > 0.05）不进入共享边邻栋的 footprint 超过 0.05 m
        const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, zi] = poly[i], [xj, zj] = poly[j];
          if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) c = !c; } return c; };
        const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz;
          const k = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
          return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dz); };
        for (const oid of [...new Set(shared.map((e) => e.other))]) {
          const qf = ringOf(LAYOUT.objects.find((q) => q.id === oid).geometry.footprint);
          let deep = 0, worst = 0;
          for (const tr of tris) for (const p of [...tr, tr.reduce((s, q) => s.map((c, j) => c + q[j] / 3), [0, 0, 0])]) {
            if (p[1] <= 0.05 || !inPoly([p[0], p[2]], qf)) continue;
            const d = Math.min(...qf.map((a, i) => segDist([p[0], p[2]], a, qf[(i + 1) % qf.length])));
            if (d > 0.05) deep++;
            worst = Math.max(worst, d);
          }
          ok(`${tag} 不穿插 ${oid}：进入其 footprint > 0.05 m 的顶点 / 三角形心 ${deep} 个（最深 ${worst.toFixed(3)} m）`, deep === 0);
          row.neighbourPenetrationM = Math.max(row.neighbourPenetrationM ?? 0, +worst.toFixed(3));
        }
      }
    }
  }

  // ---------- 3) 模块 GLB：validator 0 错 + 预算 + 节点数 + 格心 alpha 共享图 + 框料配色 ----------
  {
    const file = glbOf(HK_ID);
    const res = await validateBytes(new Uint8Array(fs.readFileSync(file)));
    ok(`${tag} 模块 GLB validator 0 错误`, res.issues.numErrors === 0, JSON.stringify(res.issues.messages?.filter((m) => m.severity === 0).slice(0, 3) || []));
    const tris = res.info?.totalTriangleCount ?? 0;
    ok(`${tag} 模块三角 ${tris} ≤ ${DEF.budgetTris}（单栋预算）`, tris > 0 && tris <= DEF.budgetTris);
    row.tris = tris;
    const bytes = fs.statSync(file).size;
    ok(`${tag} 模块字节 ${bytes} ≤ 1500000`, bytes <= 1500000);
    const g = parseGlb(file);
    ok(`${tag} 无散件：模块节点数 ${g.nodeCount} ≤ 24`, g.nodeCount <= 24, `nodes=${g.nodeCount}`);
    // 有格心的 kind（任一侧格扇 / 半窗 / 花格栏杆）才核格心；戏台（三面开敞 + 无窗背墙）没有格心
    const kc = DEF.kinds?.[obj.kind] || DEF.kinds?.hall || {};
    const hasLattice = [kc.front, kc.back].includes('lattice') || [kc.front, kc.back, kc.sides].includes('railing')
      || kc.sides === 'wall' || ([kc.front, kc.back].includes('wall') && kc.backWindows !== false);
    const lat = g.materials.find((m) => /lattice-core/.test(m.name));
    const latImgs = (g.json.images || []).filter((i) => /lattice/.test(i.name || ''));
    if (hasLattice) {
      ok(`${tag} 格心材质 alphaMode=MASK`, !!lat && lat.alphaMode === 'MASK', lat && lat.alphaMode);
      const dims = latImgs.length === 1 ? g.imageDims(latImgs[0]) : null;
      ok(`${tag} 格心图唯一且共享规格（名 lattice-core-alpha、160×160）`,
        latImgs.length === 1 && latImgs[0].name === 'lattice-core-alpha' && dims && dims[0] === 160 && dims[1] === 160,
        JSON.stringify(latImgs.map((i) => i.name)) + ' ' + JSON.stringify(dims));
    } else {
      ok(`${tag} 无格心构件的 kind（${obj.kind}）不嵌格心图（${latImgs.length}）`, latImgs.length === 0);
    }
    const wood = g.materials.find((m) => m.name === 'hk-timber-darkred');
    const bcf = wood?.pbrMetallicRoughness?.baseColorFactor;
    const want = lin(DEF.timberSrgb);
    const got = bcf ? bcf.slice(0, 3).map(toSrgb255) : null;
    const wantS = want.map(toSrgb255);
    ok(`${tag} 框料 hk-timber-darkred 底色 = sRGB #${DEF.timberSrgb}（无乘色贴图；实得 ${got ? got.map((v) => v.toFixed(0)).join(',') : '无'}）`,
      !!bcf && !wood.pbrMetallicRoughness.baseColorTexture && got.every((v, i) => Math.abs(v - wantS[i]) <= 2));
    const darkParts = (g.json.nodes || []).map((n) => n.name || '').filter((n) => n.endsWith('__hk-dark-timber')).map((n) => n.split('__')[0]);
    ok(`${tag} hk-dark-timber 只用于额枋 / 檐下阴影件（hall-frame、hall-roof；实得 ${darkParts.join(',')}）`,
      darkParts.every((p) => p === 'hall-frame' || p === 'hall-roof'));
  }

  // ---------- 4) 程序化让位 + 碰撞世界记录 ----------
  {
    const def = (ps.deferred || []).find((x) => x.id === HK_ID);
    ok(`${tag} 程序化体块已让位（why=${def ? def.why : '未推迟'}）`, !!def && def.why === 'hall-kit');
    const rec = cw && (cw.instances || []).find((r) => r.instance.id === HK_ID);
    if (rec) {
      ok(`${tag} 碰撞世界记录 ≥ 12 盒（${rec.colliders.length}）`, rec.colliders.length >= 12);
      const dist = Math.hypot(rec.instance.position[0] - E.cx, rec.instance.position[1] - E.cz);
      ok(`${tag} 碰撞实例位姿与 layout 面积形心一致（偏差 ${dist.toFixed(3)} m）`, dist <= 0.5);
      row.colliders = rec.colliders.length;
    } else skip(`${tag} 碰撞世界记录`, 'OUT_DIR 无 hallkit-collision-world.json 实例记录');
  }
  summary.push(row);
}

// ---------- 5) 分区预算 + 贴图共享：garden 分区原始 GLB ≤ 12 MB；格心图在分区里只嵌一份 ----------
{
  const m = fs.existsSync(path.join(OUT, 'zones-manifest.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8')) : null;
  if (m) {
    for (const z of m.zones.filter((z) => z.id === 'garden' && z.file)) {
      ok(`${z.file} ${z.bytes} ≤ 12000000`, z.bytes <= 12000000);
      const g = parseGlb(path.join(OUT, z.file));
      const lat = (g.json.images || []).filter((i) => /^lattice-core-alpha/.test(i.name || ''));
      const hasHall = (g.json.nodes || []).some((n) => IDS.includes(n.name));
      if (hasHall) ok(`${z.file} 格心图只嵌一份（${lat.length}）`, lat.length === 1);
    }
    const core = new Set(['garden', 'temple', 'bazaar', 'pond']);
    const coreCm = (mm) => mm.zones.filter((z) => core.has(z.id) && z.file && z.loadPolicy !== 'on-demand').reduce((s, z) => s + (z.cm ? z.cm.bytes : z.bytes), 0);
    const baseDir = process.env.HALL_KIT_BASE_OUT ? path.resolve(ROOT, process.env.HALL_KIT_BASE_OUT) : null;
    if (baseDir && fs.existsSync(path.join(baseDir, 'zones-manifest.json'))) {
      const b = JSON.parse(fs.readFileSync(path.join(baseDir, 'zones-manifest.json'), 'utf8'));
      const d = coreCm(m) - coreCm(b);
      ok(`核心区首次加载 meshopt 增量 ${(d / 1e6).toFixed(3)} MB ≤ 1.0（${coreCm(b)} → ${coreCm(m)}）`, d <= 1.0e6);
    } else skip('核心区首次加载增量', '未给 HALL_KIT_BASE_OUT（HALL_KIT=0 产物目录）');
  } else skip('zone-garden ≤ 12MB', '未导出分区');
}

fs.writeFileSync(path.join(OUT, 'hallkit-test-summary.json'), JSON.stringify(summary, null, 1));
console.log(`\nhallkit-test: ${pass} pass, ${fail} fail, ${skipped} skipped (${IDS.length} ids)`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
