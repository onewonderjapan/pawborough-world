// wave13-templefix R3（审查必修3/5）：pv05 fmid 相机与查看器口径射线工具。
// 模块回归（temple-eave-leak-test.mjs，默认链）与交付守卫（temple-eave-zones-test.mjs，
// 独立脚本）共用，保证两处口径不再漂移（R2 教训：默认测试与 pv05-zone-raycheck 各写一份）。
//
// 相机是固定常量（R3 必修3：不再读 OUT_DIR/pv-cameras.json——npm run build 不生成该文件，
// 生成目录可变不进测试输入）：取 pv05-dadian-rise 第 48 帧（96 帧中点 = fmid）的
// out-zone/pv-cameras.json 生成值原样固化。FOV 46° 垂直（web/main.js
// PerspectiveCamera(46, ...)）、1400×900（与 r1/after 截图同尺寸）。
export const PV05_CAM = {
  eye: [-79.7535, 3.8348, -22.5879],
  tgt: [-81.7984, 7.3142, -34.7167],
  fovY: 46,
  width: 1400,
  height: 900,
};

// 审查三漏点像素 + 前檐中段三点（1400×900）。
export const PV05_PIXELS = [[100, 440], [200, 440], [1250, 440], [500, 440], [700, 440], [900, 440]];

// dadian 封板/基座特征锚点（审查口径 + GLB 实测，两测试共用）：
// 基座悬空带 y 5.43–5.80；上檐条带内缘钳到墙顶线下 2cm = 6.98；基座裙板面
// |x|≈11.16 / |z|≈12.01 / 前沿 z≈0.01。
export const DD = { bandLo: 5.43, bandHi: 5.80, capY: 6.98, apronX: 11.16, apronRearZ: -12.01, apronFrontZ: 0.01 };

// 查看器口径像素→方向。R3 必修3：right 必须归一化——旧版 right=[-fwd.z,0,fwd.x]
// 长度 = fwd 水平分量（本机位 ≈0.9622），NDC 公式按单位基推导，未归一化使声明像素与
// 实际射线差最大 ~23px（审查实测 (100,440) 实际对应 (122.66,440.38)），局部细缝漏检。
// right ⟂ fwd 且单位 → up = right × fwd 自动单位。
export function pv05Dir(eye, tgt, px, py) {
  const ndcX = (px / PV05_CAM.width) * 2 - 1, ndcY = 1 - (py / PV05_CAM.height) * 2;
  let fwd = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
  const fl = Math.hypot(fwd[0], fwd[1], fwd[2]);
  fwd = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
  const rl = Math.hypot(fwd[0], fwd[2]);
  const right = [-fwd[2] / rl, 0, fwd[0] / rl];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const th = Math.tan(((PV05_CAM.fovY / 2) * Math.PI) / 180), aspect = PV05_CAM.width / PV05_CAM.height;
  const d = [
    fwd[0] + right[0] * ndcX * th * aspect + up[0] * ndcY * th,
    fwd[1] + right[1] * ndcX * th * aspect + up[1] * ndcY * th,
    fwd[2] + right[2] * ndcX * th * aspect + up[2] * ndcY * th,
  ];
  const dl = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / dl, d[1] / dl, d[2] / dl];
}

// N0 口径自证（R3 必修3）：把 pv05Dir(px,py) 射线上距 eye L 处的点，用 Three.js
// PerspectiveCamera（与查看器同参）反投影回像素，返回每像素 {px,py,ref,errPx}。
// 误差必须 <0.5px 才算「声明的像素真的被测到」。
export async function pv05PixelErrors(L = 30) {
  const THREE = await import('three');
  const cam = new THREE.PerspectiveCamera(PV05_CAM.fovY, PV05_CAM.width / PV05_CAM.height, 0.1, 2 * L + 100);
  cam.position.set(PV05_CAM.eye[0], PV05_CAM.eye[1], PV05_CAM.eye[2]);
  cam.lookAt(PV05_CAM.tgt[0], PV05_CAM.tgt[1], PV05_CAM.tgt[2]);
  cam.updateMatrixWorld(true);
  return PV05_PIXELS.map(([px, py]) => {
    const d = pv05Dir(PV05_CAM.eye, PV05_CAM.tgt, px, py);
    const v = new THREE.Vector3(
      PV05_CAM.eye[0] + d[0] * L, PV05_CAM.eye[1] + d[1] * L, PV05_CAM.eye[2] + d[2] * L,
    ).project(cam);
    const rx = ((v.x + 1) / 2) * PV05_CAM.width, ry = ((1 - v.y) / 2) * PV05_CAM.height;
    return { px, py, ref: [rx, ry], errPx: Math.hypot(rx - px, ry - py) };
  });
}

// 通用 GLB → 世界三角（节点变换应用；meshopt 压缩 bufferView 解压，浏览器同款字节）。
// 分区件/压缩件是总装产物：节点带变换、坐标已是世界系。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function readSceneWorldTris(file) {
  const { MeshoptDecoder } = require('three/addons/libs/meshopt_decoder.module.js');
  await MeshoptDecoder.ready;
  const buf = fs.readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl));
  const bin = 28 + jl < buf.length ? buf.subarray(28 + jl, 28 + jl + buf.readUInt32LE(20 + jl)) : null;
  const decCache = new Map();
  const viewBytes = (bvi) => {
    if (decCache.has(bvi)) return decCache.get(bvi);
    const bv = json.bufferViews[bvi];
    const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
    let out;
    if (ext) {
      const src = bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength);
      out = Buffer.alloc(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter || 'NONE');
    } else out = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    decCache.set(bvi, out);
    return out;
  };
  const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const acc = (ai) => {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
    const Arr = COMP[a.componentType], nc = NC[a.type];
    const bytes = viewBytes(a.bufferView);
    const stride = bv.byteStride || Arr.BYTES_PER_ELEMENT * nc;
    const off = a.byteOffset || 0;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rd = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o) }[a.componentType];
    const out = new Float64Array(a.count * nc);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) out[i * nc + c] = rd(off + i * stride + c * Arr.BYTES_PER_ELEMENT);
    return out;
  };
  const matOf = (n) => {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], sc = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      (1 - (yy + zz)) * sc[0], (xy + wz) * sc[0], (xz - wy) * sc[0], 0,
      (xy - wz) * sc[1], (1 - (xx + zz)) * sc[1], (yz + wx) * sc[1], 0,
      (xz + wy) * sc[2], (yz - wx) * sc[2], (1 - (xx + yy)) * sc[2], 0,
      t[0], t[1], t[2], 1,
    ];
  };
  const mulMat = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r2 = 0; r2 < 4; r2++)
      for (let k = 0; k < 4; k++) o[c * 4 + r2] += a[k * 4 + r2] * b[c * 4 + k];
    return o;
  };
  const xf = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
  const out = [];
  const walk = (ni, m) => {
    const n = json.nodes[ni];
    const mm = n.matrix ? mulMat(m, n.matrix) : mulMat(m, matOf(n));
    if (n.mesh !== undefined) {
      for (const pr of json.meshes[n.mesh].primitives) {
        const P = acc(pr.attributes.POSITION);
        const T = pr.indices !== undefined ? acc(pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
        for (let k = 0; k + 2 < T.length; k += 3) {
          out.push({
            A: xf(mm, [P[T[k] * 3], P[T[k] * 3 + 1], P[T[k] * 3 + 2]]),
            B: xf(mm, [P[T[k + 1] * 3], P[T[k + 1] * 3 + 1], P[T[k + 1] * 3 + 2]]),
            C: xf(mm, [P[T[k + 2] * 3], P[T[k + 2] * 3 + 1], P[T[k + 2] * 3 + 2]]),
          });
        }
      }
    }
    for (const c of n.children || []) walk(c, mm);
  };
  for (const ni of json.scenes[json.scene || 0].nodes) walk(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}

// FrontSide 最近命中（带命中面法线）。
export function rayFrontFull(tris, o, d) {
  let best = null;
  for (const t of tris) {
    const e1 = [t.B[0] - t.A[0], t.B[1] - t.A[1], t.B[2] - t.A[2]], e2 = [t.C[0] - t.A[0], t.C[1] - t.A[1], t.C[2] - t.A[2]];
    const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0];
    const det = e1[0] * px + e1[1] * py + e1[2] * pz;
    if (det <= 1e-12) continue;
    const inv = 1 / det, tx = o[0] - t.A[0], ty = o[1] - t.A[1], tz = o[2] - t.A[2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1[2] - tz * e1[1], qy = tz * e1[0] - tx * e1[2], qz = tx * e1[1] - ty * e1[0];
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const s2 = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
    if (s2 > 1e-6 && (!best || s2 < best.s)) {
      best = { s: s2, p: [o[0] + d[0] * s2, o[1] + d[1] * s2, o[2] + d[2] * s2],
        n: [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]] };
    }
  }
  return best;
}
