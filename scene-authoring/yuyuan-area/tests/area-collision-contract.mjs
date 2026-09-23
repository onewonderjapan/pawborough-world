// 全域候选碰撞世界契约测试（WP4.1，格式见 docs/AREA-COLLISION-FORMAT.md）。
// 先于实现编写：碰撞文件还不存在时以退出码 2 报「未实现」；实现后必须全绿。
// 用法：OUT_DIR=out-zone node tests/area-collision-contract.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { obbToWorld } from '../../../src/world/collisionAdapter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const ZONES = ['garden', 'pond', 'temple', 'bazaar'];
const BUILDING_KINDS = new Set(['hall', 'tower', 'xuan', 'stage', 'waterside', 'pavilion', 'bazaarBlock']);
const R = 0.35, BODY = [0.3, 1.9], STEP = 0.5;

const missing = ZONES.filter(z => !fs.existsSync(path.join(OUT, `collision-${z}.json`)));
if (missing.length) {
  console.log(`area-collision-contract: NOT IMPLEMENTED — missing ${missing.map(z => `collision-${z}.json`).join(', ')} in ${OUT}`);
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const layoutBuf = fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'));
const layoutSha = crypto.createHash('sha256').update(layoutBuf).digest('hex');
const layout = JSON.parse(layoutBuf.toString('utf8'));
const nav = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8')).routes;

const boxes = [];            // world OBBs from all zones
const names = new Set();
const openings = new Set();
const spawns = {};
for (const z of ZONES) {
  const f = JSON.parse(fs.readFileSync(path.join(OUT, `collision-${z}.json`), 'utf8'));
  ok(`${z}: zone field`, f.zone === z);
  ok(`${z}: axis field`, typeof f.axis === 'string' && f.axis.includes('Y-up'));
  ok(`${z}: sourceLayoutSha256 matches baseline/layout.json`, f.sourceLayoutSha256 === layoutSha);
  ok(`${z}: colliders array`, Array.isArray(f.colliders) && f.colliders.length > 0);
  for (const c of f.colliders || []) {
    let w;
    try { w = obbToWorld(c); } catch (e) { ok(`${z}: ${c.name} converts`, false, e.message); continue; }
    const good = c.type === 'box' && typeof c.name === 'string' && typeof c.module === 'string'
      && w.halfExtents.every(v => Number.isFinite(v) && v > 0) && w.center.every(Number.isFinite) && Number.isFinite(w.yaw);
    ok(`${z}: ${c.name} well-formed`, good);
    boxes.push({ ...w, name: c.name });
    names.add(c.name);
  }
  for (const o of f.openings || []) openings.add(o.name);
  Object.assign(spawns, f.spawns || {});
}

const has = prefix => { for (const n of names) if (n.startsWith(prefix)) return true; return false; };
for (const o of layout.objects) {
  if (!ZONES.includes(o.zone)) continue;
  const g = o.geometry || {};
  if ((BUILDING_KINDS.has(o.kind) || (o.kind === 'outerBuilding' && o.zone === 'bazaar')) && g.footprint)
    ok(`cover ${o.zone}/${o.kind} ${o.id}`, has(`${o.id}:`));
  if (o.kind === 'wall' && Array.isArray(g.segments))
    g.segments.forEach((_, i) => ok(`cover wall ${o.id}:seg-${i}`, has(`${o.id}:seg-${i}`)));
  if (o.kind === 'water' && g.footprint) {
    let fp = g.footprint;
    if (fp[0][0] === fp.at(-1)[0] && fp[0][1] === fp.at(-1)[1]) fp = fp.slice(0, -1);
    let total = 0, covered = 0;
    fp.forEach((p, i) => {
      const q = fp[(i + 1) % fp.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      total += L;
      const n = `water-${o.id}:edge-${i}`;
      if (names.has(n) || openings.has(n)) covered += L;
    });
    ok(`water ${o.id} perimeter guarded ${(100 * covered / (total || 1)).toFixed(0)}% ≥ 80%`, total > 0 && covered / total >= 0.8);
  }
}

// capsule (radius R, body band) vs world OBB, in plan with the y-band overlap
function hits(x, z) {
  for (const b of boxes) {
    const y0 = b.center[1] - b.halfExtents[1], y1 = b.center[1] + b.halfExtents[1];
    if (y1 < BODY[0] || y0 > BODY[1]) continue;
    const dx = x - b.center[0], dz = z - b.center[2];
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    // inverse of obbToWorld's rotation (wx = c*lx + s*lz, wz = -s*lx + c*lz)
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const qx = Math.max(Math.abs(lx) - b.halfExtents[0], 0), qz = Math.max(Math.abs(lz) - b.halfExtents[2], 0);
    if (Math.hypot(qx, qz) < R) return b.name;
  }
  return null;
}

for (const [k, [x, z]] of Object.entries(nav.anchors)) {
  ok(`spawn ${k} present`, Array.isArray(spawns[k]));
  const h = hits(x, z);
  ok(`spawn ${k} clear`, !h, h || '');
}
for (const r of routes) {
  let bad = null, n = 0;
  for (let i = 0; i + 1 < r.points.length && !bad; i++) {
    const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
    const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / STEP));
    for (let j = 0; j <= k && !bad; j++) {
      const t = j / k; n++;
      const h = hits(ax + t * (bx - ax), az + t * (bz - az));
      if (h) bad = `${h} at (${(ax + t * (bx - ax)).toFixed(2)}, ${(az + t * (bz - az)).toFixed(2)})`;
    }
  }
  ok(`route ${r.from}→${r.to} walkable (${n} samples)`, !bad, bad || '');
}
console.log(`area-collision-contract: ${pass} pass, ${fail} fail; ${boxes.length} colliders`);
process.exit(fail ? 1 : 0);
