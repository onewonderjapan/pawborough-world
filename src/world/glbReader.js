// Minimal GLB reader for node-side tests and collision precomputation.
// Returns the glTF scene graph geometry (positions, indices, baked world
// transforms) WITHOUT decoding images — enough to build collision data and
// verify triangle totals against the manifest. The browser uses three's
// GLTFLoader for rendering; this reader exists so production collision math
// can be exercised against the real street-reviewed.glb bytes in tests.

export function readGlb(input) {
  // Accept an ArrayBuffer or a Uint8Array/Buffer view over one.
  const buf = input instanceof ArrayBuffer ? input : input.buffer;
  const base = input instanceof ArrayBuffer ? 0 : input.byteOffset;
  const view = new DataView(buf, base, input instanceof ArrayBuffer ? input.byteLength : input.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB chunk 0 is not JSON');
  const decoder = new TextDecoder('utf8');
  const gltf = JSON.parse(decoder.decode(new Uint8Array(buf, base + 20, jsonLen)));
  let off = 20 + jsonLen;
  let bin = null;
  const total = view.byteLength;
  while (off < total) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    if (type === 0x004e4942) bin = new Uint8Array(buf, base + off + 8, len);
    off += 8 + len;
  }
  if (!bin) throw new Error('GLB has no BIN chunk');

  const accessor = (i) => {
    const a = gltf.accessors[i];
    const bv = gltf.bufferViews[a.bufferView];
    const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const comp = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
    if (a.componentType === 5126) {
      return new Float32Array(bin.buffer, bin.byteOffset + start, a.count * comp);
    }
    if (a.componentType === 5125) return new Uint32Array(bin.buffer, bin.byteOffset + start, a.count * comp);
    if (a.componentType === 5123) return new Uint16Array(bin.buffer, bin.byteOffset + start, a.count * comp);
    throw new Error(`unsupported componentType ${a.componentType}`);
  };

  const nodeMatrix = (ni, parent = identity()) => {
    const n = gltf.nodes[ni];
    const local = n.matrix
      ? n.matrix.slice()
      : trsToMatrix(n.translation, n.rotation, n.scale);
    const world = multiply(parent, local);
    const out = [];
    for (const ci of n.children ?? []) out.push(...nodeMatrix(ci, world));
    if (n.mesh !== undefined) out.push({ node: n, matrix: world });
    return out;
  };

  const meshes = [];
  for (const rootIndex of gltf.scenes[gltf.scene ?? 0].nodes) {
    for (const { node, matrix } of nodeMatrix(rootIndex)) {
      const mesh = gltf.meshes[node.mesh];
      for (const prim of mesh.primitives) {
        const positions = accessor(prim.attributes.POSITION).slice();
        const indices = accessor(prim.indices).slice();
        meshes.push({ name: node.name ?? '', positions, indices, matrix });
      }
    }
  }
  const totalTriangles = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  return { gltf, meshes, totalTriangles, bin };
}

export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function trsToMatrix(t, r, s) {
  const [x = 0, y = 0, z = 0] = t ?? [];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = r ?? [];
  const [sx = 1, sy = 1, sz = 1] = s ?? [];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sy, (xz - wy) * sz, 0,
    (xy - wz) * sx, (1 - (xx + zz)) * sy, (yz + wx) * sz, 0,
    (xz + wy) * sx, (yz - wx) * sy, (1 - (xx + yy)) * sz, 0,
    x, y, z, 1,
  ];
}

export function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
