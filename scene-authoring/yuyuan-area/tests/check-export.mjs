// A4 复检：1) 全场屋面越界采样（复现主控 roof-cases 方法，覆盖所有带屋面对象，不只13例）
//         2) 导出 GLB 垂直三角"朝上法线"审计（复现主控 normal-check 方法）
// 用法：node tests/check-export.mjs [OUT_DIR=out-v2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeRoof, orientRing, normalizeRing, pointInPoly, distToPolyline,
  offsetPolySafe, polyArea,
} from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));

// ---------- 1) 屋面越界复检 ----------
function maxOutside(ring, footprint, overhangTol) {
  let worst = 0;
  const ringN = orientRing(normalizeRing(footprint));
  const closed = [...ringN, ringN[0]];
  const seen = new Set();
  for (const p of ring) {
    const key = p.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!pointInPoly([p[0], p[2]], ringN)) {
      const d = distToPolyline([p[0], p[2]], closed);
      if (d > overhangTol) worst = Math.max(worst, d);
    }
  }
  return worst;
}

const ROOF_KINDS = new Set(['tower', 'hall', 'pavilion', 'xuan', 'waterside', 'stage', 'bazaarBlock']);
const cases = [];
for (const o of layout.objects) {
  if (o.skipRender) continue;
  const fp = o.geometry && o.geometry.footprint;
  if (!fp || fp.length < 3) continue;
  if (!ROOF_KINDS.has(o.kind) && o.id !== 'huxin-ting') continue;
  const mode = o.kind === 'bazaarBlock'
    ? (o.roofMode === 'mansard' ? 'hip' : 'hip')
    : (o.roofMode === 'gabled' ? 'gabled' : 'hip');
  // 与 build-scene 相同的两种调用形态：本体 + 两层楼的收分上环
  const rings = [{ ring: fp, tag: 'base' }];
  if (o.kind === 'tower' || o.storeys === 2) {
    if (o.id === 'huxin-ting') rings.push({ ring: offsetPolySafe(fp, -0.9).pts, tag: 'upper' });
    else rings.push({ ring: offsetPolySafe(fp, -0.9).pts, tag: 'upper' });
  }
  if (o.kind === 'bazaarBlock' && o.roofMode === 'mansard') {
    rings.push({ ring: offsetPolySafe(fp, -Math.max(1.2, Math.min(Math.abs(fp[1][0] - fp[0][0]), 30) * 0.06)).pts, tag: 'mansard-upper' });
  }
  for (const { ring, tag } of rings) {
    const g = makeRoof(ring, { eave: 4, rise: 1.9, mode, name: 'chk' });
    const surf = g.children.find(c => c.name === 'chk:surface');
    const pos = surf.geometry.attributes.position;
    const verts = [];
    for (let i = 0; i < pos.count; i++) verts.push([pos.getX(i), pos.getZ(i)]);
    // 三角质心也采样
    for (let i = 0; i < pos.count; i += 3) {
      verts.push([
        (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
        (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
      ]);
    }
    const m = maxOutside(verts, fp, 0.38 * 1.5);
    if (m > 0) cases.push({ id: o.id, name: o.name || null, kind: o.kind, tag, maxOutsideM: +m.toFixed(3) });
  }
}
cases.sort((a, b) => b.maxOutsideM - a.maxOutsideM);
console.log('roof leak recheck: objects with footprint leakage beyond overhang tolerance =', cases.length);
for (const c of cases.slice(0, 10)) console.log('  ', JSON.stringify(c));

// ---------- 2) GLB 垂直三角法线审计 ----------
function glbJson(buf) {
  const jl = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
}
function accessorData(j, buf, binOff, accIdx) {
  const acc = j.accessors[accIdx];
  const bv = j.bufferViews[acc.bufferView];
  const compSize = { SCALAR: 1, VEC2: 2, VEC3: 3 }[acc.type];
  const arrType = acc.componentType === 5126 ? Float32Array : acc.componentType === 5123 ? Uint16Array : Uint32Array;
  const start = binOff + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return new arrType(buf.buffer.slice(start, start + acc.count * compSize * arrType.BYTES_PER_ELEMENT));
}
function auditVerticalNormals(file) {
  const p = path.join(OUT, file);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  const j = glbJson(buf);
  const binOff = 20 + buf.readUInt32LE(12) + 8;
  let vertical = 0, badUp = 0, badSkew = 0;
  for (const mesh of j.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes.NORMAL === undefined || prim.attributes.POSITION === undefined) continue;
      const P = accessorData(j, buf, binOff, prim.attributes.POSITION);
      const N = accessorData(j, buf, binOff, prim.attributes.NORMAL);
      const I = prim.indices !== undefined ? accessorData(j, buf, binOff, prim.indices) : null;
      const nTri = (I ? I.length : P.length / 3) / 3;
      for (let t = 0; t < nTri; t++) {
        const i0 = I ? I[t * 3] : t * 3, i1 = I ? I[t * 3 + 1] : t * 3 + 1, i2 = I ? I[t * 3 + 2] : t * 3 + 2;
        const ux = P[i1 * 3] - P[i0 * 3], uy = P[i1 * 3 + 1] - P[i0 * 3 + 1], uz = P[i1 * 3 + 2] - P[i0 * 3 + 2];
        const wx = P[i2 * 3] - P[i0 * 3], wy = P[i2 * 3 + 1] - P[i0 * 3 + 1], wz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
        let fn = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
        const fl = Math.hypot(...fn) || 1; fn = fn.map(v => v / fl);
        if (Math.abs(fn[1]) > 0.1) continue; // 只审垂直面
        vertical++;
        for (const vi of [i0, i1, i2]) {
          const ny = N[vi * 3 + 1];
          if (ny > 0.7) { badUp++; break; }
          const dot = fn[0] * N[vi * 3] + fn[1] * ny + fn[2] * N[vi * 3 + 2];
          if (dot < 0.5) { badSkew++; break; }
        }
      }
    }
  }
  return { file, verticalTriangles: vertical, withUpwardNormals: badUp, withSkewedNormals: badSkew };
}
const audits = ['procedural-bazaar.glb', 'procedural-garden.glb', 'procedural-outer.glb', 'procedural-pond.glb']
  .map(auditVerticalNormals).filter(Boolean);
for (const a of audits) console.log('normal audit:', JSON.stringify(a));

const okRoof = cases.length === 0;
const okNormals = audits.every(a => a.withUpwardNormals === 0 && a.withSkewedNormals === 0);
fs.writeFileSync(path.join(OUT, 'roof-leak-recheck.json'), JSON.stringify({ ok: okRoof, cases }, null, 1));
fs.writeFileSync(path.join(OUT, 'normal-audit.json'), JSON.stringify({ ok: okNormals, audits }, null, 1));
console.log('roof-leak', okRoof ? 'OK' : 'FAIL', '| normals', okNormals ? 'OK' : 'FAIL');
if (!okRoof || !okNormals) process.exit(1);
