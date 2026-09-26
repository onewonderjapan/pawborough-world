// Bridge-only evidence helper, adapted from garden-kit-test.mjs.
import fs from "node:fs";
export function parseGlb(file) {
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
      const v = new Arr(bin.buffer, bin.byteOffset + o, nc);
      out.push(Array.from(v));
    }
    return out;
  }
  // 节点树展开（应用 TRS/矩阵），收集每 primitive 的三角形世界坐标
  const meshes = json.meshes || [];
  const tris = [];      // {v0,v1,v2, mat, meshName}
  const verts = [];     // [x,y,z]
  const triMats = [];
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix; // glTF 列主序 4x4
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    // 标准 glTF 列向量旋转矩阵（与 sansuitang-test 同式；此前这里是转置版，纯 Y 旋转会反向）
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    // 列主序 4x4
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mulVec(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  { // 自检：绕 +Y 90°（q=[0,sin45°,0,cos45°]）时 (0,0,1) → (1,0,0)
    const h = Math.SQRT1_2;
    const r = mulVec(nodeMatrix({ rotation: [0, h, 0, h] }), [0, 0, 1]);
    if (Math.abs(r[0] - 1) > 1e-6 || Math.abs(r[1]) > 1e-6 || Math.abs(r[2]) > 1e-6) {
      console.error('FAIL nodeMatrix self-check: +Y 90° maps +Z to', r); process.exit(1);
    }
  }
  function walk(ni, pm) {
    const n = json.nodes[ni];
    const m = pm ? mul4(pm, nodeMatrix(n)) : nodeMatrix(n);
    if (n.mesh !== undefined) {
      const mesh = meshes[n.mesh];
      for (const p of mesh.primitives) {
        const pos = accessor(p.attributes.POSITION).map((v) => mulVec(m, v));
        const idx = p.indices !== undefined ? accessor(p.indices).map((v) => v[0]) : pos.map((_, i) => i);
        const base = verts.length;
        verts.push(...pos);
        for (let i = 0; i < idx.length; i += 3) {
          tris.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
          triMats.push(p.material !== undefined ? json.materials[p.material].name : null);
        }
      }
    }
    for (const c of n.children || []) walk(c, m);
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  const scene = json.scenes[json.scene || 0];
  for (const ni of scene.nodes) walk(ni, null);
  const images = (json.images || []).map((i) => i.uri || i.mimeType);
  const mats = (json.materials || []).map((m) => ({
    name: m.name,
    baseTex: !!(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture),
    normalTex: !!m.normalTexture,
  }));
  const matIdxByName = new Map((json.materials || []).map((m, i) => [m.name, i]));
  const usedImages = new Set();
  for (const m of json.materials || []) {
    const texs = [];
    if (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture) texs.push(m.pbrMetallicRoughness.baseColorTexture.index);
    if (m.normalTexture) texs.push(m.normalTexture.index);
    if (m.occlusionTexture) texs.push(m.occlusionTexture.index);
    for (const ti of texs) {
      const src = json.textures[ti].source;
      if (src !== undefined) usedImages.add(src);
    }
  }
  return { json, tris, verts, triMats, images, mats, usedImages, matIdxByName, binLen: bin ? bin.length : 0 };
}

function triCount(g) { return g.tris.length; }

// ---------- 射线（Möller–Trumbore），返回最近命中距离或 null ----------
export function raycast(g, o, d, maxDist = 1e9, maxHitY = 1e9) {
  let best = null;
  const [ox, oy, oz] = o, [dx, dy, dz] = d;
  for (let t = 0; t < g.tris.length; t++) {
    const [ia, ib, ic] = g.tris[t];
    const a = g.verts[ia], b = g.verts[ib], c = g.verts[ic];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-9 && det < 1e-9) continue;
    const inv = 1 / det;
    const sx = ox - a[0], sy = oy - a[1], sz = oz - a[2];
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-6 && dist < maxDist && oy + dy * dist <= maxHitY && (best === null || dist < best)) best = dist;
  }
  return best;
}

// ---------- 布局数据 ----------