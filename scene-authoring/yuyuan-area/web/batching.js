// wave4-drawcalls：运行时按材质合批（three.js BatchedMesh），分区 GLB 与导出管线不动。
//
// 为什么在运行时、不在导出时：
//   - 分区 GLB 的节点身份（zone|id|kind|lod 名、父链上的 layout 锚、extras）是好几个消费者的正本：
//     控制层分割（render-control-passes.py 读 scene-areas.glb）、步行地面选网（walk.js / zone-walk-check 读原始分区 GLB）、
//     导览目标着色（target-mask.js 在浏览器里按节点父链认 layout id）、点选溯源、屋顶开关。导出时合并就要给
//     每个消费者补一套「三角区间 → 对象」映射；运行时合批则 GLB 字节、节点树原样保留，首载字节不变。
//   - 代价：合批几何是 Float32（展开量化、烘焙世界变换），CPU/GPU 顶点内存比量化原件大；加载后多一步合批耗时。
//     两个数都由 window.__batchStats() 报告。
//
// 做法（每个分区件加载后调用 batchGroup(grp)）：
//   1. 收集件内可合批网格：普通 Mesh（非 Instanced/Skinned/Batched、单材质、不透明、无 morph、世界矩阵行列式 > 0）；
//   2. 按 (材质对象, 顶点属性集合, 是否有索引) 分组；组内 ≥ 2 个才合批；
//   3. 每个成员的几何烘焙到分区组坐标系（位置 × 相对矩阵，法线 × 法线矩阵）后作为独立几何加入 BatchedMesh，
//      实例矩阵全是单位阵；按遍历顺序加入 → 索引区间首尾相接；
//   4. 每个实例的包围球 = 原网格 geometry.boundingSphere × 原相对矩阵 —— 与 three 对原网格的逐对象视锥剔除
//      完全同一判据，所以每帧画的三角面与合批前相同；
//   5. sortObjects=false（保持区间顺序），渲染前在 BatchedMesh 算出的可见区间上把首尾相接的区间并成一段：
//      全部可见时一组只剩 1 段，部分被剔除时按连续段数计。于是 WebGL 调用（multiDraw 算 1）与子绘制数都降下来，
//      没有 WEBGL_multi_draw 时 three 逐段 drawElements 也同样受益；
//   6. 原网格留在场景树里（身份不动），只把它们的 layers 挪到 ORIGINAL_LAYER，主相机（layer 0）不再画它们：
//      - 点选：main.js 的 Raycaster 打开全部 layers，合批网格 raycast 置空，命中的仍是原网格；
//      - 导览目标着色：wrapTargetMask 在掩膜渲染那一次隐藏合批、相机临时打开 ORIGINAL_LAYER，按原网格着色；
//      - 屋顶开关等改原网格 visible 的逻辑：之后调 syncVisibility()，按原网格（含父链）可见性 setVisibleAt。
// ?batch=0 关闭合批（= 改前渲染路径），用于同机位对照。
import * as THREE from 'three';

export const ORIGINAL_LAYER = 7;

function eligible(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return false;
  const m = o.material, g = o.geometry;
  if (!m || Array.isArray(m) || m.transparent) return false;
  if (!g || !g.attributes.position || g.groups.length > 1) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  if (o.layers.mask !== 1 || o.renderOrder !== 0 || !o.frustumCulled) return false;
  if (o.matrixWorld.determinant() <= 0) return false;
  if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  return true;
}
function signature(g) {
  return Object.keys(g.attributes).sort().map(k => `${k}:${g.attributes[k].itemSize}`).join(',') + (g.index ? '|idx' : '|noidx');
}

const _v = new THREE.Vector3();
const _n = new THREE.Matrix3();
// 源几何（可能交错 / 量化 / 归一化）→ Float32 烘焙几何（相对分区组坐标系）
function bakeGeometry(src, rel) {
  _n.getNormalMatrix(rel);
  const out = new THREE.BufferGeometry();
  const count = src.attributes.position.count;
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name], k = a.itemSize;
    const arr = new Float32Array(count * k);
    if (name === 'position') {
      for (let i = 0; i < count; i++) { _v.fromBufferAttribute(a, i).applyMatrix4(rel); arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z; }
    } else if (name === 'normal') {
      for (let i = 0; i < count; i++) { _v.fromBufferAttribute(a, i).applyMatrix3(_n).normalize(); arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z; }
    } else if (name === 'tangent') {
      for (let i = 0; i < count; i++) { _v.set(a.getX(i), a.getY(i), a.getZ(i)).transformDirection(rel); arr[i * 4] = _v.x; arr[i * 4 + 1] = _v.y; arr[i * 4 + 2] = _v.z; arr[i * 4 + 3] = a.getW(i); }
    } else {
      for (let i = 0; i < count; i++) for (let c = 0; c < k; c++) arr[i * k + c] = a.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  if (src.index) out.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array.subarray(0, src.index.count)), 1));
  return out;
}

// BatchedMesh 算完可见区间后，把首尾相接的区间并成一段（实例矩阵全为单位阵，gl_DrawID 取哪一个都一样）
function coalesce(batch, geometry) {
  const starts = batch._multiDrawStarts, counts = batch._multiDrawCounts;
  const indirect = batch._indirectTexture.image.data;
  const bpe = geometry.index ? geometry.index.array.BYTES_PER_ELEMENT : 1;
  const n = batch._multiDrawCount;
  let w = 0;
  for (let k = 0; k < n; k++) {
    if (w > 0 && starts[w - 1] + counts[w - 1] * bpe === starts[k]) { counts[w - 1] += counts[k]; continue; }
    starts[w] = starts[k]; counts[w] = counts[k]; indirect[w] = indirect[k]; w++;
  }
  batch._multiDrawCount = w;
}
function onBeforeRenderCoalesced(renderer, scene, camera, geometry, material, group) {
  THREE.BatchedMesh.prototype.onBeforeRender.call(this, renderer, scene, camera, geometry, material, group);
  coalesce(this, geometry);
}

export function installBatching({ camera, enabled = true }) {
  const batches = [];   // { mesh, zone, members: [{ obj, instanceId }] }
  const stats = { enabled, groups: 0, batches: 0, batchedMeshes: 0, leftAlone: 0, vertices: 0, indices: 0, float32Bytes: 0, buildMs: 0, perZone: {} };

  function batchGroup(grp) {
    if (!enabled) return null;
    const t0 = performance.now();
    grp.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
    const groups = new Map();
    let total = 0;
    grp.traverse(o => {
      if (!o.isMesh) return;
      total++;
      if (!eligible(o)) return;
      const key = o.material.uuid + '#' + signature(o.geometry);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    });
    const zs = { meshes: total, batched: 0, batches: 0, vertices: 0 };
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const baked = members.map(o => {
        const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        return { obj: o, geo: bakeGeometry(o.geometry, rel), sphere: o.geometry.boundingSphere.clone().applyMatrix4(rel) };
      });
      const nv = baked.reduce((s, b) => s + b.geo.attributes.position.count, 0);
      const ni = baked.reduce((s, b) => s + (b.geo.index ? b.geo.index.count : 0), 0);
      const batch = new THREE.BatchedMesh(baked.length, nv, ni, members[0].material);
      batch.name = 'BATCH-' + String(grp.name || '') + '-' + batches.length;
      batch.sortObjects = false;             // 保持区间顺序，相邻区间才能并段
      batch.perObjectFrustumCulled = true;   // 逐成员视锥剔除（包围球同原网格）
      batch.raycast = () => {};              // 点选命中原网格（身份在原网格上）
      batch.onBeforeRender = onBeforeRenderCoalesced;
      const rec = { mesh: batch, zone: grp.name, members: [] };
      for (const b of baked) {
        const gid = batch.addGeometry(b.geo);
        batch._geometryInfo[gid].boundingSphere = b.sphere;   // 剔除判据 = 原网格包围球 × 相对矩阵
        const iid = batch.addInstance(gid);
        rec.members.push({ obj: b.obj, instanceId: iid });
        b.obj.layers.set(ORIGINAL_LAYER);
        b.geo.dispose();
      }
      grp.add(batch);
      batches.push(rec);
      zs.batched += members.length; zs.batches++; zs.vertices += nv;
      stats.vertices += nv; stats.indices += ni;
      stats.float32Bytes += nv * Object.values(baked[0].geo.attributes).reduce((s, a) => s + a.itemSize * 4, 0) + ni * 4;
    }
    stats.groups++; stats.batches += zs.batches; stats.batchedMeshes += zs.batched; stats.leftAlone += total - zs.batched;
    zs.ms = +(performance.now() - t0).toFixed(1);
    stats.buildMs += zs.ms;
    stats.perZone[grp.name + '#' + stats.groups] = zs;
    syncVisibility();
    return zs;
  }

  function effectiveVisible(o) {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  }
  // 原网格（或其父链）visible 改动后调用：把可见性同步到合批实例
  function syncVisibility() {
    for (const b of batches) for (const m of b.members) {
      const v = effectiveVisible(m.obj);
      if (b.mesh.getVisibleAt(m.instanceId) !== v) b.mesh.setVisibleAt(m.instanceId, v);
    }
  }

  // 导览目标着色掩膜：那一次渲染隐藏合批、画原网格（身份在原网格上），结束恢复
  function wrapTargetMask() {
    const inner = window.__targetMask;
    if (typeof inner !== 'function' || inner.__batchWrapped) return;
    const wrapped = (spec) => {
      const shown = batches.filter(b => b.mesh.visible);
      for (const b of shown) b.mesh.visible = false;
      const hadLayer = camera.layers.isEnabled(ORIGINAL_LAYER);
      camera.layers.enable(ORIGINAL_LAYER);
      try { return inner(spec); } finally {
        if (!hadLayer) camera.layers.disable(ORIGINAL_LAYER);
        for (const b of shown) b.mesh.visible = true;
      }
    };
    wrapped.__batchWrapped = true;
    window.__targetMask = wrapped;
  }

  window.__batchSync = syncVisibility;   // 测试 / 外部改原网格 visible 后同步用
  window.__batchStats = () => ({ ...stats, buildMs: +stats.buildMs.toFixed(1), float32MB: +(stats.float32Bytes / 1048576).toFixed(1), perZone: { ...stats.perZone } });
  return { batchGroup, syncVisibility, wrapTargetMask, get batches() { return batches; } };
}
