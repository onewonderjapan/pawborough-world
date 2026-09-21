// Ground support sampler (world-reliability 20260921, REL-01) — a read-only
// spatial query over the SAME triangle soup the production ground extractor
// feeds to the physics world (collectGroundTriangles output). Answers the one
// question the safe-fall recovery may not guess: "is there REAL walkable
// ground here, with margin, at this height?" — the ground faces only qualify
// through GROUND_NODE_RE, so wall tops, roofs, props and out-of-world void
// are never "support", and the player capsule plays no part in the answer.
//
// DOM-free and physics-free: node tests drive it on hand-built triangle soup.
export function createGroundSampler(triangleSoups, { cellM = 2 } = {}) {
  const grid = new Map();   // "cx|cz" -> [{ ax,az,ay, bx,bz,by, cx2,cz2,cy }]
  let minY = Infinity;
  const cellKey = (cx, cz) => cx + '|' + cz;
  const insert = (tri) => {
    minY = Math.min(minY, tri.ay, tri.by, tri.cy);
    const x0 = Math.min(tri.ax, tri.bx, tri.cx2), x1 = Math.max(tri.ax, tri.bx, tri.cx2);
    const z0 = Math.min(tri.az, tri.bz, tri.cz2), z1 = Math.max(tri.az, tri.bz, tri.cz2);
    for (let cx = Math.floor(x0 / cellM); cx <= Math.floor(x1 / cellM); cx++)
      for (let cz = Math.floor(z0 / cellM); cz <= Math.floor(z1 / cellM); cz++) {
        const k = cellKey(cx, cz);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(tri);
      }
  };
  for (const soup of triangleSoups) {
    const { positions, indices } = soup;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      insert({
        ax: positions[a], ay: positions[a + 1], az: positions[a + 2],
        bx: positions[b], by: positions[b + 1], bz: positions[b + 2],
        cx2: positions[c], cy: positions[c + 1], cz2: positions[c + 2],
      });
    }
  }
  if (!grid.size) throw new Error('groundSampler: no triangles');

  // interpolated surface height at (x,z), or null when no ground face covers it
  function sampleY(x, z) {
    const arr = grid.get(cellKey(Math.floor(x / cellM), Math.floor(z / cellM)));
    if (!arr) return null;
    let best = null;
    for (const t of arr) {
      // barycentric coordinates in the XZ plane (signed areas)
      const area = (p1x, p1z, p2x, p2z, p3x, p3z) =>
        (p2x - p1x) * (p3z - p1z) - (p3x - p1x) * (p2z - p1z);
      const total = area(t.ax, t.az, t.bx, t.bz, t.cx2, t.cz2);
      if (!total) continue;
      const w0 = area(x, z, t.bx, t.bz, t.cx2, t.cz2) / total;
      const w1 = area(t.ax, t.az, x, z, t.cx2, t.cz2) / total;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * t.ay + w1 * t.by + w2 * t.cy;
      if (best === null || y > best) best = y; // highest supporting face wins (curbs, platforms)
    }
    return best;
  }

  // real support at a feet position: ground within tol of feetY at the point
  // AND at the four margin offsets (so a return here cannot re-fall)
  function hasSupport(x, y, z, { marginM = 0.6, tolM = 0.45 } = {}) {
    const pts = [[x, z], [x + marginM, z], [x - marginM, z], [x, z + marginM], [x, z - marginM]];
    for (const [px, pz] of pts) {
      const gy = sampleY(px, pz);
      if (gy === null || gy < y - tolM || gy > y + tolM) return false;
    }
    return true;
  }

  return {
    sampleY,
    hasSupport,
    minY: () => (minY === Infinity ? null : minY),
    triangleCount: [...grid.values()].reduce((s, a) => s + a.length, 0) / 3,
  };
}
