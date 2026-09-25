// hall-kit 放置 / 朝向公式的 JS 版（与 modules/hall-kit/frame.py 同式；scripts/export-collision.mjs 用）。
// 位置 = footprint 多边形面积形心；朝向（defaults.orient）："footprint-side" = 最小面积外接矩形四边里外法线与
// facade.dir 点积最大的一边（边长 < frontMinSideM 罚 frontShortPenalty，同 build-scene pickEdge）；
// "facade-dir" = 旧样板行为（rotY 直接取 facade.dir）。tests/hallkit-test.mjs 另有独立实现，不引用本文件。
export function ring(fpRaw) {
  const a = fpRaw[0], b = fpRaw[fpRaw.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? fpRaw.slice(0, -1) : fpRaw;
}

export function areaCentroid(fp) {
  const n = fp.length;
  const a2 = fp.reduce((s, p, i) => s + p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1], 0) / 2;
  if (Math.abs(a2) < 1e-6) return [fp.reduce((s, q) => s + q[0], 0) / n, fp.reduce((s, q) => s + q[1], 0) / n];
  const cr = (p, i) => p[0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * p[1];
  return [fp.reduce((s, p, i) => s + (p[0] + fp[(i + 1) % n][0]) * cr(p, i), 0) / (6 * a2),
          fp.reduce((s, p, i) => s + (p[1] + fp[(i + 1) % n][1]) * cr(p, i), 0) / (6 * a2)];
}

function hull(pts) {
  const s = [...new Set(pts.map((p) => `${p[0]},${p[1]}`))].map((k) => k.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (const p of s.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function hallFrame(obj, defaults) {
  const fp = ring(obj.geometry.footprint);
  const fd = (obj.facade && obj.facade.dir) || defaults.facadeDir;
  const fl = Math.hypot(fd[0], fd[1]) || 1;
  const fx = fd[0] / fl, fz = fd[1] / fl;
  const H = hull(fp);
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const [x1, y1] = H[i], [x2, y2] = H[(i + 1) % H.length];
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 1e-9) continue;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const us = H.map((p) => (p[0] - x1) * ux + (p[1] - y1) * uy);
    const vs = H.map((p) => -(p[0] - x1) * uy + (p[1] - y1) * ux);
    const area = (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs));
    if (!best || area < best.area) best = { area, ax: ux, az: uy, ha: (Math.max(...us) - Math.min(...us)) / 2, hb: (Math.max(...vs) - Math.min(...vs)) / 2 };
  }
  const { ax, az, ha, hb } = best;
  const bx = -az, bz = ax;
  let n, rotY;
  if ((defaults.orient || 'footprint-side') === 'facade-dir') {
    if (ha >= hb) n = bx * fx + bz * fz >= 0 ? [bx, bz] : [-bx, -bz];
    else n = ax * fx + az * fz >= 0 ? [ax, az] : [-ax, -az];
    rotY = Math.atan2(fx, fz);
  } else {
    const minSide = defaults.frontMinSideM ?? 3.2, pen = defaults.frontShortPenalty ?? 0.6;
    const cands = [[[bx, bz], 2 * ha], [[-bx, -bz], 2 * ha], [[ax, az], 2 * hb], [[-ax, -az], 2 * hb]];
    let bs = -Infinity;
    for (const [nn, side] of cands) {
      const sc = nn[0] * fx + nn[1] * fz - (side < minSide ? pen : 0);
      if (sc > bs) { bs = sc; n = nn; }
    }
    rotY = Math.atan2(n[0], n[1]);
  }
  const centroid = areaCentroid(fp);
  const delta = Math.acos(Math.max(-1, Math.min(1, n[0] * fx + n[1] * fz))) * 180 / Math.PI;
  return { centroid, front: n, rotY, facadeDeltaDeg: delta };
}
