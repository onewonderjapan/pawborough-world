// 外围套件测试共用：读 Blender 导出的原始 zone-outer.glb（无压缩），按带 extras.id 的节点收集世界坐标三角 / 法线 / UV。
// 供 tests/outer-kit-test.mjs 与 tests/outer-kit-clash-test.mjs 使用；只读产物，不读生成器。
import fs from 'node:fs';

export function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bin = b.subarray(20 + jl + 8);
  return { json, bin };
}
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
export function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const [T, sz] = CT[a.componentType], n = NC[a.type];
  const stride = bv.byteStride || sz * n, off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const pos = off + k * stride + c * sz;
    out[k * n + c] = T === Float32Array ? g.bin.readFloatLE(pos) : T === Uint32Array ? g.bin.readUInt32LE(pos) : T === Uint16Array ? g.bin.readUInt16LE(pos) : T === Uint8Array ? g.bin.readUInt8(pos) : T === Int16Array ? g.bin.readInt16LE(pos) : g.bin.readInt8(pos);
  }
  return { data: out, n, count: a.count };
}
function mat4(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0], [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// → Map(key → {id, extras, name, tris:[{v:[3×xyz], n:[3×xyz]|null, uv:[3×uv]|null}], materials:Set, attrs:Set})
export function glbEntries(file) {
  const g = readGlb(file);
  const nodes = new Map();
  function walk(ni, parentM, owner) {
    const nd = g.json.nodes[ni];
    const M = mul(parentM, mat4(nd));
    let own = owner;
    if (nd.extras && nd.extras.id) { own = { id: nd.extras.id, extras: nd.extras, name: nd.name, tris: [], materials: new Set(), attrs: new Set() }; nodes.set(own.id + '#' + ni, own); }
    if (nd.mesh !== undefined && own) {
      const R = [M[0], M[1], M[2], 0, M[4], M[5], M[6], 0, M[8], M[9], M[10], 0, 0, 0, 0, 1];
      for (const pr of g.json.meshes[nd.mesh].primitives) {
        own.materials.add(pr.material);
        for (const k of Object.keys(pr.attributes)) own.attrs.add(k);
        const P = accessor(g, pr.attributes.POSITION), N = pr.attributes.NORMAL !== undefined ? accessor(g, pr.attributes.NORMAL) : null;
        const UV = pr.attributes.TEXCOORD_0 !== undefined ? accessor(g, pr.attributes.TEXCOORD_0) : null;
        const I = pr.indices !== undefined ? accessor(g, pr.indices).data : Array.from({ length: P.count }, (_, k) => k);
        for (let k = 0; k + 2 < I.length; k += 3) {
          const ix = [I[k], I[k + 1], I[k + 2]];
          const v = ix.map(j => xf(M, [P.data[j * 3], P.data[j * 3 + 1], P.data[j * 3 + 2]]));
          const n = N ? ix.map(j => xf(R, [N.data[j * 3], N.data[j * 3 + 1], N.data[j * 3 + 2]])) : null;
          const uv = UV ? ix.map(j => [UV.data[j * 2], UV.data[j * 2 + 1]]) : null;
          own.tris.push({ v, n, uv });
        }
      }
    }
    for (const c of nd.children || []) walk(c, M, own);
  }
  for (const s of g.json.scenes) for (const r of s.nodes) walk(r, I4, null);
  return { g, entries: [...nodes.values()] };
}
