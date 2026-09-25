// 共享几何/多边形工具：X 东、Z 南、单位米、Y 上。
// layout.json 是唯一坐标源；3D、2D 标注图、分区清单都从这里派生。
import * as THREE from 'three';

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- 多边形基本量 ----------
export function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function centroid(pts) {
  const a = polyArea(pts);
  if (Math.abs(a) < 1e-9) {
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }
  let cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f; cz += (z1 + z2) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function pointInPoly(pt, poly) {
  const [x, z] = pt;
  let inside = false;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) inside = !inside;
  }
  return inside;
}

export function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

export function polyIntersectsPoly(p1, p2) {
  for (const p of p1) if (pointInPoly(p, p2)) return true;
  for (const p of p2) if (pointInPoly(p, p1)) return true;
  for (let i = 0; i < p1.length; i++)
    for (let j = 0; j < p2.length; j++)
      if (segIntersect(p1[i], p1[(i + 1) % p1.length], p2[j], p2[(j + 1) % p2.length])) return true;
  return false;
}

// 顶点在 zone 内的数量（用于多数归属）
export function vertsInside(poly, zone) {
  let n = 0;
  for (const p of poly) if (pointInPoly(p, zone)) n++;
  return n;
}

export function dist2d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function distToPolyline(p, pts) {
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, distToSeg(p, pts[i], pts[i + 1]));
  return m;
}

// M3：两端都悬空（tol 内无任何邻段端点）的孤立墙段 —— temple-wall 第 19 段这类
// 空地薄板（见 wave0 包 artifacts/c-temple-slab/FINDINGS.md）。返回保留的段。
// 范围由调用方声明（只用于 temple-wall；garden-wall 的自由端是龙墙设计特征，不动）。
export function dropFloatingSegments(segments, tol = 0.5) {
  const touches = (p, self) => segments.some((s, j) => j !== self && (dist2d(p, s[0]) <= tol || dist2d(p, s[1]) <= tol));
  return segments.filter((s, i) => touches(s[0], i) || touches(s[1], i));
}

// 主方向（PCA 简化：协方差主轴），返回 [dirX, dirZ, len, width, angle]
export function principalAxis(pts) {
  const c = centroid(pts);
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) {
    const dx = x - c[0], dz = z - c[1];
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
  }
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const dir = [Math.cos(theta), Math.sin(theta)];
  let minT = Infinity, maxT = -Infinity, minU = Infinity, maxU = -Infinity;
  for (const [x, z] of pts) {
    const dx = x - c[0], dz = z - c[1];
    const t = dx * dir[0] + dz * dir[1];
    const u = -dx * dir[1] + dz * dir[0];
    minT = Math.min(minT, t); maxT = Math.max(maxT, t);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
  }
  return { c, dir, len: maxT - minT, width: maxU - minU, angle: theta };
}

// 多边形外扩(正)/内缩(负)：沿角平分线移动顶点的块体近似。
// 注意：d 的符号按绕序解释——本函数内部先把环统一为正 shoelace 面积
// （x-z 平面数学逆时针），此时 +d 外扩、-d 内缩，与输入绕序无关。
export function offsetPoly(ptsIn, d) {
  const pts = orientRing(ptsIn);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
    const l2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const n1 = [(p[1] - a[1]) / l1, -(p[0] - a[0]) / l1];
    const n2 = [(b[1] - p[1]) / l2, -(b[0] - p[0]) / l2];
    let nx = n1[0] + n2[0], nz = n1[1] + n2[1];
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const cosHalf = Math.max(0.35, (nx * n1[0] + nz * n1[1] + nx * n2[0] + nz * n2[1]) / 2);
    out.push([p[0] + (nx * d) / cosHalf, p[1] + (nz * d) / cosHalf]);
  }
  return out;
}

// 面向 offsetPoly 的向内收缩（朝质心）
export function shrinkPoly(pts, d) { return offsetPoly(pts, -d); }

// ---------- 环规范化与合法三角化 ----------
// 去连续重复点与首尾闭环重复点
export function normalizeRing(pts, eps = 1e-6) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop(); else break;
  }
  return out;
}

// 统一绕序：normalizeRing + 保证正 shoelace 面积（x-z 数学逆时针）
export function orientRing(ptsIn) {
  const pts = normalizeRing(ptsIn);
  return polyArea(pts) < 0 ? pts.slice().reverse() : pts;
}

// 凹环（可带洞环）合法三角化：earcut via THREE.ShapeUtils。返回坐标三角数组。
// 输入环/洞环均会被去重；洞环方向不影响结果（earcut 内部处理）。
export function triangulateRing(ringIn, holesIn = []) {
  const ring = normalizeRing(ringIn);
  const holes = holesIn.map(h => normalizeRing(h)).filter(h => h.length >= 3 && Math.abs(polyArea(h)) > 1e-9);
  if (ring.length < 3 || Math.abs(polyArea(ring)) < 1e-9) return [];
  const contour = ring.map(p => new THREE.Vector2(p[0], p[1]));
  const hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  const faces = THREE.ShapeUtils.triangulateShape(contour, hs);
  const verts = [...ring];
  for (const h of holes) verts.push(...h);
  const tris = [];
  for (const f of faces) {
    const t = [verts[f[0]], verts[f[1]], verts[f[2]]];
    // 退化三角丢弃
    if (Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) < 1e-9) continue;
    tris.push(t);
  }
  return tris;
}

// 凸分解：earcut 三角 → 贪心合并保持凸性（Hertel–Mehlhorn 简化版）。
// 凹环拆成少量凸块（屋顶"翼部"）；凸环原样返回单块。不支持洞环（调用方处理）。
export function convexDecompose(ringIn) {
  const ring = orientRing(ringIn);
  if (ring.length < 3) return [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const isConvex = (p) => {
    let pos = false, neg = false;
    for (let i = 0; i < p.length; i++) {
      const cr = cross(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length]);
      if (cr > 1e-9) pos = true; else if (cr < -1e-9) neg = true;
    }
    return !(pos && neg);
  };
  if (isConvex(ring)) return [ring];
  const polys = triangulateRing(ring).map(t => [[...t[0]], [...t[1]], [...t[2]]]);
  // 贪心合并：共享反向边且合并后仍凸
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const p = polys[i], q = polys[j];
        for (let a = 0; a < p.length; a++) {
          for (let b = 0; b < q.length; b++) {
            const pA = p[a], pB = p[(a + 1) % p.length];
            const qC = q[b], qD = q[(b + 1) % q.length];
            const touch = Math.hypot(pA[0] - qD[0], pA[1] - qD[1]) < 1e-6 &&
              Math.hypot(pB[0] - qC[0], pB[1] - qC[1]) < 1e-6;
            if (!touch) continue;
            // 并环：p[0..a] + q 从 qD(=pA) 前进到 qC(=pB) 之间顶点 + p[b..]
            const m = [...p.slice(0, a + 1)];
            for (let k = 2; k <= q.length; k++) m.push(q[(b + k) % q.length]);
            m.push(...p.slice(a + 1));
            const mr = normalizeRing(m);
            if (mr.length >= 3 && isConvex(mr)) {
              polys.splice(j, 1);
              polys[i] = mr;
              merged = true;
              break outer;
            }
          }
        }
      }
    }
  }
  return polys;
}

// 两个简单多边形（可凹、无洞）的交集面积：各自凸分解后，逐对凸块做 Sutherland–Hodgman 裁剪求面积再求和
//（凸分解块互不重叠，所以求和是精确值）。用于判定「两份 footprint 是否是同一栋」。
function clipConvex(subject, clip) {
  // clip 须为 CCW 凸环；subject 为凸环
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const P = inp[k], Q = inp[(k + 1) % inp.length];
      const sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  return out;
}

export function polyIntersectionArea(polyA, polyB) {
  const pa = convexDecompose(polyA).map(orientRing), pb = convexDecompose(polyB).map(orientRing);
  let area = 0;
  for (const a of pa) for (const b of pb) {
    const c = clipConvex(a, b);
    if (c.length >= 3) area += Math.abs(polyArea(c));
  }
  return area;
}

// 对称差面积 = |A| + |B| - 2|A∩B|
export function polySymDiffArea(polyA, polyB) {
  return Math.abs(polyArea(orientRing(polyA))) + Math.abs(polyArea(orientRing(polyB))) - 2 * polyIntersectionArea(polyA, polyB);
}

// 自交检测（忽略相邻边共享端点）
function ringSelfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      const o1 = o(a1, a2, b1), o2 = o(a1, a2, b2), o3 = o(b1, b2, a1), o4 = o(b1, b2, a2);
      if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
    }
  }
  return false;
}

// 带防护的偏移：自交/尖刺/面积翻转时逐步钳制 d，仍失败则保留原环。
// 返回 { pts, method: 'offset' | 'clamped' | 'original', usedD }
export function offsetPolySafe(ptsIn, d) {
  const base = orientRing(ptsIn);
  if (base.length < 3 || d === 0) return { pts: base, method: 'original', usedD: 0 };
  const a0 = Math.abs(polyArea(base));
  const tryD = (dd) => {
    const c = offsetPoly(base, dd);
    if (c.length < 3) return null;
    const a = Math.abs(polyArea(c));
    if (a < 1e-6) return null;
    if (ringSelfIntersects(c)) return null;
    // 外扩必须增面积，内缩必须减面积且不出负/翻转
    if (dd > 0 && a <= a0 + 1e-9) return null;
    if (dd < 0 && a >= a0 - 1e-9) return null;
    // 边长无尖刺
    for (let i = 0; i < c.length; i++) {
      if (dist2d(c[i], c[(i + 1) % c.length]) < 0.02) return null;
    }
    return c;
  };
  const first = tryD(d);
  if (first) return { pts: first, method: 'offset', usedD: d };
  // 二分钳制：逐步缩小 |d| 直到合法
  let lo = 0, hi = d;
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    if (tryD(mid)) hi = mid; else lo = mid;
  }
  if (Math.abs(hi) > 0.02) {
    const c = tryD(hi);
    if (c) return { pts: c, method: 'clamped', usedD: hi };
  }
  return { pts: base, method: 'original', usedD: 0 };
}

// ---------- THREE 几何 ----------
const _colorCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!_colorCache.has(key)) {
    _colorCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.92, metalness: 0, flatShading: true, ...opts.extra }));
  }
  return _colorCache.get(key);
}

// 平面多边形网格（y 固定）。注意：Shape 在 XY 平面，rotateX(-π/2) 会把 +Y 映到 -Z，
// 因此输入取 (x, -z)，翻转后才是地图系 +Z（南）。
export function shapeMesh(pts, y, color, name) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const m = new THREE.Mesh(g, mat(color));
  m.name = name;
  return m;
}

// ShapeGeometry 便捷：数据坐标 (x,z) 直接成平面
export function shapeGeo(pts, y) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1]))));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y ?? 0, 0);
  return g;
}

// 垂直墙体环：footprint 点列 + 高度；底 y0 顶 y1。
// 非索引几何 + 每面外向硬边法线（相邻面不共享顶点/法线），单面材质即可正确受光。
export function wallRing(ptsIn, y0, y1, color, name) {
  const pts = orientRing(ptsIn); // 正面积绕序：边 (a→b) 的外向法线 = (dz, -dx)
  const pos = [], nrm = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    const nx = dz / l, nz = -dx / l;
    // 两个三角 ×3 顶点，全部写同一面法线（硬边）。
    // 顶点顺序 (a0,b1,b0)/(a0,a1,b1)：绕序面法线 = 外向 (dz,0,-dx)，与属性法线一致。
    for (const [p, y] of [[a, y0], [b, y1], [b, y0], [a, y0], [a, y1], [b, y1]]) {
      pos.push(p[0], y, p[1]);
      nrm.push(nx, 0, nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(g, mat(color));
  m.name = name;
  return m;
}

// ---------- 屋面：真实脊线 + 合法三角化 ----------
// 半平面裁剪（Sutherland–Hodgman）：保留有向直线 a→b 左侧（含线上）部分。
// 返回 { ring, holes }（洞环同样裁剪；被裁空的洞丢弃）。
function clipHalfPlane(part, a, b) {
  const eps = 1e-9;
  const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); // >0 在左
  const inter = (p, q) => {
    const dp = side(p), dq = side(q);
    const t = dp / (dp - dq);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const clip = (ring) => {
    if (ring.length < 3) return [];
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const sp = side(p), sq = side(q);
      if (sp >= -eps) out.push(p);
      if ((sp > eps && sq < -eps) || (sp < -eps && sq > eps)) out.push(inter(p, q));
    }
    return out;
  };
  return { ring: clip(part.ring), holes: part.holes.map(clip).filter(h => h.length >= 3) };
}

// 三角形面法线（未归一）
function triNormalY(t) {
  const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
  const w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

// eave = 檐口高，rise = 屋脊抬升，mode = 'gabled'(双坡，脊全长) | 'hip'(四坡，脊收短)。
// 返回 Group（屋面 + 檐口带 + 脊饰）。
// 构造：凹轮廓先凸分解为可解释的屋顶翼部，每块沿自身主轴做半平面裁剪 + earcut 合法三角化；
// 脊线顶点提到 eave+rise，其余边界保持 eave——双坡得到连续真脊，四坡得到脊+坡折。
// 凹轮廓不越界；带洞环（院落）时不分解，直接按脊轴裁剪保留洞。
export function makeRoof(ptsIn, opts) {
  const { eave, rise, mode = 'hip', name = 'roof', tileColor = 0x4a4a4f, eaveColor = 0x5b4232, overhang = 0.38, holes = [] } = opts;
  const base = orientRing(ptsIn);
  const off = offsetPolySafe(base, overhang);
  const roofRing = off.pts;
  const ridgeY = eave + rise;

  // 单块凸环 -> 裁剪分块（环上脊轴顶点升高，其余 eave）
  const wingParts = (ring) => {
    const pa = principalAxis(ring);
    const ridgeHalf = mode === 'gabled' ? pa.len / 2 + 0.4 : Math.max(0.5, (pa.len / 2) * 0.82);
    const r0 = [pa.c[0] - pa.dir[0] * ridgeHalf, pa.c[1] - pa.dir[1] * ridgeHalf];
    const r1 = [pa.c[0] + pa.dir[0] * ridgeHalf, pa.c[1] + pa.dir[1] * ridgeHalf];
    const full = { ring, holes: [] };
    const parts = [];
    if (mode === 'gabled') {
      parts.push(clipHalfPlane(full, r0, r1), clipHalfPlane(full, r1, r0));
    } else {
      const perp0 = [r0[0] + pa.dir[1], r0[1] - pa.dir[0]];
      const perp1 = [r1[0] + pa.dir[1], r1[1] - pa.dir[0]];
      const mid = clipHalfPlane(clipHalfPlane(full, r0, perp0), perp1, r1);
      parts.push(
        clipHalfPlane(mid, r0, r1), clipHalfPlane(mid, r1, r0),
        clipHalfPlane(full, perp0, r0), clipHalfPlane(full, r1, perp1),
      );
    }
    return { parts, r0, r1 };
  };

  const allParts = [];
  const ridgeSegs = [];
  if (holes.length) {
    // 洞环（院落）保留：不分解，整环按脊轴裁剪
    const full = { ring: roofRing, holes };
    const pa = principalAxis(roofRing);
    const ridgeHalf = mode === 'gabled' ? pa.len / 2 + 0.4 : Math.max(0.5, (pa.len / 2) * 0.82);
    const rr0 = [pa.c[0] - pa.dir[0] * ridgeHalf, pa.c[1] - pa.dir[1] * ridgeHalf];
    const rr1 = [pa.c[0] + pa.dir[0] * ridgeHalf, pa.c[1] + pa.dir[1] * ridgeHalf];
    let ps;
    if (mode === 'gabled') {
      ps = [clipHalfPlane(full, rr0, rr1), clipHalfPlane(full, rr1, rr0)];
    } else {
      const perp0 = [rr0[0] + pa.dir[1], rr0[1] - pa.dir[0]];
      const perp1 = [rr1[0] + pa.dir[1], rr1[1] - pa.dir[0]];
      const mid = clipHalfPlane(clipHalfPlane(full, rr0, perp0), perp1, rr1);
      ps = [clipHalfPlane(mid, rr0, rr1), clipHalfPlane(mid, rr1, rr0),
        clipHalfPlane(full, perp0, rr0), clipHalfPlane(full, rr1, perp1)];
    }
    allParts.push(...ps);
    ridgeSegs.push([rr0, rr1]);
  } else {
    for (const wing of convexDecompose(roofRing)) {
      if (Math.abs(polyArea(wing)) < 0.25) continue; // 分解碎屑不成翼
      const { parts, r0, r1 } = wingParts(wing);
      allParts.push(...parts);
      ridgeSegs.push([r0, r1]);
    }
  }

  // 高度：落在脊线段上的顶点 = eave+rise，其余 = eave
  const heightOf = (p) => {
    for (const [a, b] of ridgeSegs) if (distToSeg(p, a, b) < 1e-4) return ridgeY;
    return eave;
  };

  const pos = [], nrm = [];
  for (const part of allParts) {
    if (part.ring.length < 3) continue;
    for (const tri of triangulateRing(part.ring, part.holes)) {
      // 丢弃裁剪捏点产生的退化薄片
      const a2 = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1])) / 2;
      if (a2 < 0.01) continue;
      let t = tri.map(p => [p[0], heightOf(p), p[1]]);
      if (triNormalY(t)[1] < 0) t = [t[0], t[2], t[1]]; // 统一顶面法线朝上（单面渲染正确）
      const n = triNormalY(t);
      const l = Math.hypot(...n) || 1;
      for (const p of t) { pos.push(p[0], p[1], p[2]); nrm.push(n[0] / l, n[1] / l, n[2] / l); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const group = new THREE.Group();
  group.name = name;
  const roof = new THREE.Mesh(g, mat(tileColor));
  roof.name = name + ':surface';
  group.add(roof);
  // 檐口带：沿外沿一圈薄环（外向法线）
  const band = wallRing(roofRing, eave - 0.28, eave + 0.06, eaveColor, name + ':eave');
  group.add(band);
  // 脊饰：每翼一条明确正脊（gabled 脊全长略出檐，hip 为收短的脊段）
  for (const [a, b] of ridgeSegs) {
    const ridgeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.hypot(b[0] - a[0]), 0.16, 0.34),
      mat(0x3a3a40));
    ridgeMesh.position.set((a[0] + b[0]) / 2, ridgeY + 0.02, (a[1] + b[1]) / 2);
    ridgeMesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    ridgeMesh.name = name + ':ridge';
    group.add(ridgeMesh);
  }
  return group;
}

// 沿折线的路带（quad strip）
export function ribbon(pts, width, y, color, name) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const nx = -dz * width / 2, nz = dx * width / 2;
    pos.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = (i + 1) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(color));
  m.name = name;
  return m;
}

// 沿折线的廊：柱列 + 窄双坡顶
export function corridor(pts, width, name, opts = {}) {
  const g = new THREE.Group();
  g.name = name;
  const floor = ribbon(pts, width, 0.32, 0x8a7a63, name + ':deck');
  g.add(floor);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += dist2d(pts[i], pts[i + 1]);
  const nCols = Math.max(2, Math.round(total / 2.8));
  let acc = 0, seg = 0, segAcc = 0;
  for (let k = 0; k <= nCols; k++) {
    const target = (total * k) / nCols;
    while (seg < pts.length - 1 && segAcc + dist2d(pts[seg], pts[seg + 1]) < target) {
      segAcc += dist2d(pts[seg], pts[seg + 1]); seg++;
    }
    const t = (target - segAcc) / (dist2d(pts[seg], pts[seg + 1]) || 1);
    const x = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t;
    const z = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t;
    const a = pts[Math.max(0, seg - 1)], b = pts[Math.min(pts.length - 1, seg + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.5, 6), mat(0x6b4a33));
      c.position.set(x - dz * s * (width / 2 - 0.12), 0.32 + 1.25, z + dx * s * (width / 2 - 0.12));
      c.name = name + ':col';
      g.add(c);
    }
  }
  const roofPts = offsetPoly(pts, 0.35).map((p, i, arr) => p);
  // 窄廊顶：两块斜面板组成的折线双坡
  const rf = roofAlongPath(pts, width + 0.7, 0.32 + 2.62, 0.85, name + ':roof');
  g.add(rf);
  return g;
}

// 折线双坡顶（中央脊带 + 两侧斜面 quad strip）；非索引 + 逐面朝上法线，单面可用
export function roofAlongPath(pts, width, yBase, rise, name) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    const w = width / 2;
    // 左檐、脊、右檐
    pos.push(
      pts[i][0] + nx * w, yBase, pts[i][1] + nz * w,
      pts[i][0], yBase + rise, pts[i][1],
      pts[i][0] - nx * w, yBase, pts[i][1] - nz * w
    );
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 3, b = (i + 1) * 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1);       // 左坡
    idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2); // 右坡
  }
  const src = new THREE.BufferGeometry();
  src.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  src.setIndex(idx);
  // 展开为非索引，逐三角保证法线朝上（坡面朝外侧上方）
  const p = src.attributes.position;
  const out = [];
  for (let i = 0; i < idx.count; i += 3) {
    let order = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    let t = order.map(k => [p.getX(k), p.getY(k), p.getZ(k)]);
    if (triNormalY(t)[1] < 0) { order = [order[0], order[2], order[1]]; t = [t[0], t[2], t[1]]; }
    const n = triNormalY(t);
    const nl = Math.hypot(...n) || 1;
    for (const k of order) out.push(p.getX(k), p.getY(k), p.getZ(k), n[0] / nl, n[1] / nl, n[2] / nl);
  }
  const flatPos = [], flatNrm = [];
  for (let i = 0; i < out.length; i += 6) { flatPos.push(out[i], out[i + 1], out[i + 2]); flatNrm.push(out[i + 3], out[i + 4], out[i + 5]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(flatPos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(flatNrm, 3));
  const m = new THREE.Mesh(g, mat(0x4a4a4f));
  m.name = name;
  return m;
}

// 低面岩石：icosahedron 顶点扰动
export function rock(cx, cz, size, h, name, seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < p.count; i++) {
    const f = 0.72 + rnd() * 0.55;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * (0.55 + rnd() * 0.75), p.getZ(i) * f);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(0x6f6a60));
  m.scale.set(size, h, size * (0.75 + rnd() * 0.4));
  m.position.set(cx, h * 0.42, cz);
  m.rotation.y = rnd() * Math.PI;
  m.name = name;
  return m;
}

// 简化树：干 + 双层冠
export function tree(cx, cz, h, name) {
  const g = new THREE.Group();
  g.name = name;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, h * 0.45, 5), mat(0x5d4630));
  trunk.position.set(cx, h * 0.225, cz);
  trunk.name = name + ':trunk';
  const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.34, 0), mat(0x5c7a4a));
  c1.position.set(cx, h * 0.62, cz);
  c1.name = name + ':crown';
  const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.26, 0), mat(0x6b8a54));
  c2.position.set(cx + h * 0.08, h * 0.88, cz - h * 0.05);
  c2.name = name + ':crown';
  g.add(trunk, c1, c2);
  return g;
}

// 轴对齐盒（中心 xz、底 y）
export function box(cx, y, cz, w, h, d, color, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(cx, y + h / 2, cz);
  m.name = name;
  return m;
}

// 旋转容器：绕 Y 轴把局部模型（面 +Z）放到世界
export function placed(group, x, z, rotY) {
  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  return group;
}
