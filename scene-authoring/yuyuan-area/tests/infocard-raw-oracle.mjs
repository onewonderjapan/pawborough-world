// wave11-infocard R4：拾取 oracle 的两半（REVIEW-astra-R3 必修 1/2）。
//
// 浏览器半边（installPageOracle）：只做「测量」，不做判定——
//   1. 在 THREE.Raycaster.prototype.setFromCamera 上挂被动记录：被测实现每次点选算出的射线（origin/direction）
//      与相机对象记到 window.__oraLastRay / window.__oraCamera（原函数照常执行，不改实现行为）；
//   2. window.__oraHits(ray, K, forUuid)：用测试自己 new 的 THREE.Raycaster（layers.enableAll，与 main.js 点选同口径）
//      沿同一条射线求全部命中，返回前 K 个命中的：three 对象 uuid、自身+父链是否全部可见、命中三角形的世界坐标三顶点。
//      不调用 web/infocard.js 的任何函数。
// Node 半边（RawGlbIndex）：独立解析 OUT_DIR 的 raw 分区 GLB（未压缩件，manifest zones[].file），
//   把命中三角形按世界坐标三顶点对回 raw GLB 的具体节点（file + node 下标），再沿 raw GLB 父链取
//   layout id（extras.id 或 `zone|id|kind|lod` 管道名）与最近的 extras.module。
//   期望值 = 「第一个父链全部可见、且 raw 父链上有 layout id 的命中」对应的 raw 节点 → id / module。
import fs from 'node:fs';
import path from 'node:path';

// ---------------- Node 半边：raw GLB 三角形索引 ----------------
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const idFromPipe = (name) => { const p = String(name || '').split('|'); return p.length >= 4 ? p[1] : null; };

export class RawGlbIndex {
  constructor(outDir) {
    const mf = JSON.parse(fs.readFileSync(path.join(outDir, 'zones-manifest.json'), 'utf8'));
    this.files = [...new Set(mf.zones.filter(z => z.file).map(z => z.file))];
    this.prims = [];   // { file, node, name, wpos: Float32Array, idx, min, max }
    this.glb = {};     // file -> { nodes, par }
    for (const f of this.files) this._load(path.join(outDir, f), f);
  }
  _load(full, f) {
    const b = fs.readFileSync(full);
    if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${f}: not GLB`);
    const jsonLen = b.readUInt32LE(12);
    const g = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
    const binStart = 20 + jsonLen + 8;
    const par = new Array(g.nodes.length).fill(null);
    g.nodes.forEach((n, i) => (n.children || []).forEach(c => { par[c] = i; }));
    const world = new Array(g.nodes.length);
    const W = (i) => world[i] || (world[i] = par[i] == null ? trs(g.nodes[i]) : mul4(W(par[i]), trs(g.nodes[i])));
    this.glb[f] = { nodes: g.nodes, par };
    const view = (accIdx, Ctor, comps) => {
      const a = g.accessors[accIdx];
      const bv = g.bufferViews[a.bufferView];
      const off = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
      const stride = bv.byteStride || Ctor.BYTES_PER_ELEMENT * comps;
      if (stride !== Ctor.BYTES_PER_ELEMENT * comps) throw new Error(`${f}: interleaved accessor ${accIdx} 不支持`);
      return new Ctor(b.buffer.slice(b.byteOffset + off, b.byteOffset + off + a.count * stride));
    };
    g.nodes.forEach((n, ni) => {
      if (n.mesh === undefined) return;
      const w = W(ni);
      for (const p of g.meshes[n.mesh].primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        const pa = g.accessors[p.attributes.POSITION];
        if (pa.componentType !== 5126 || pa.type !== 'VEC3' || pa.sparse) throw new Error(`${f}: 非 float VEC3 POSITION`);
        const pos = view(p.attributes.POSITION, Float32Array, 3);
        const wpos = new Float32Array(pos.length);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < pa.count; v++) {
          const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
          const X = w[0] * x + w[4] * y + w[8] * z + w[12];
          const Y = w[1] * x + w[5] * y + w[9] * z + w[13];
          const Z = w[2] * x + w[6] * y + w[10] * z + w[14];
          wpos[v * 3] = X; wpos[v * 3 + 1] = Y; wpos[v * 3 + 2] = Z;
          if (X < min[0]) min[0] = X; if (Y < min[1]) min[1] = Y; if (Z < min[2]) min[2] = Z;
          if (X > max[0]) max[0] = X; if (Y > max[1]) max[1] = Y; if (Z > max[2]) max[2] = Z;
        }
        let idx;
        if (p.indices !== undefined) {
          const ia = g.accessors[p.indices];
          idx = ia.componentType === 5125 ? view(p.indices, Uint32Array, 1) : ia.componentType === 5123 ? view(p.indices, Uint16Array, 1) : view(p.indices, Uint8Array, 1);
        } else { idx = new Uint32Array(pa.count); for (let i = 0; i < pa.count; i++) idx[i] = i; }
        this.prims.push({ file: f, node: ni, name: n.name ?? null, wpos, idx, min, max });
      }
    });
  }
  // raw 父链：layout id（extras.id / 管道名）与最近 extras.module
  chain(file, node) {
    const { nodes, par } = this.glb[file];
    let id = null, module = null;
    const names = [];
    for (let c = node; c != null; c = par[c]) {
      const n = nodes[c];
      names.push(n.name ?? `#${c}`);
      if (id == null) {
        if (n.extras && n.extras.id != null) id = String(n.extras.id);
        else { const pid = idFromPipe(n.name); if (pid) id = pid; }
      }
      if (module == null && n.extras && n.extras.module != null) module = String(n.extras.module);
    }
    return { id, module, path: names.reverse().join(' > ') };
  }
  // 世界坐标三角形（three 端测得，已扣除测试受控位移）→ raw GLB 节点。
  // 得分 = 三个顶点各自到候选三角形最近顶点的距离取最大（与顶点顺序无关）；< tol 才算对上。
  // 同分（≤ 1e-4 m）而节点不同 → ambiguous（重合几何），调用方按需处理。
  matchTriangle(tri, point, tol = 0.06) {
    let best = null, second = null;
    for (const P of this.prims) {
      if (point[0] < P.min[0] - tol || point[0] > P.max[0] + tol || point[1] < P.min[1] - tol || point[1] > P.max[1] + tol
        || point[2] < P.min[2] - tol || point[2] > P.max[2] + tol) continue;
      const { wpos, idx } = P;
      for (let t = 0; t + 2 < idx.length; t += 3) {
        let score = 0;
        for (let k = 0; k < 3 && score < tol; k++) {
          const vx = tri[k][0], vy = tri[k][1], vz = tri[k][2];
          let dmin = Infinity;
          for (let j = 0; j < 3; j++) {
            const q = idx[t + j] * 3;
            const dx = wpos[q] - vx, dy = wpos[q + 1] - vy, dz = wpos[q + 2] - vz;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < dmin) dmin = d;
          }
          const d = Math.sqrt(dmin);
          if (d > score) score = d;
        }
        if (score >= tol) continue;
        const cand = { file: P.file, node: P.node, name: P.name, score };
        if (!best || score < best.score) {
          if (best && (best.file !== cand.file || best.node !== cand.node)) second = best;
          best = cand;
        } else if ((best.file !== cand.file || best.node !== cand.node) && (!second || score < second.score)) second = cand;
      }
    }
    if (!best) return null;
    const ambiguous = !!(second && second.score - best.score <= 1e-4);
    return { ...best, ambiguous, second: ambiguous ? { file: second.file, node: second.node, name: second.name } : null, ...this.chain(best.file, best.node) };
  }
  // 由浏览器 __oraHits 的命中列表求期望：第一个「父链全部可见 + raw 父链有 layout id」的命中。
  // 同时给出第一个被跳过的「不可见且有 id」命中（用于同 id 反例统计）。
  expect(hits) {
    const out = { id: null, module: null, uuid: null, raw: null, firstHidden: null, skipped: [], error: null };
    for (const h of hits) {
      if (!h.tri) { if (h.threeId) { out.error = `命中 ${h.uuid}（three id ${h.threeId}）不是三角网格，无法对回 raw GLB`; return out; } continue; }
      const m = this.matchTriangle(h.tri, h.point);
      if (!h.visible) {
        if (!out.firstHidden && m && m.id) out.firstHidden = { uuid: h.uuid, id: m.id, module: m.module, raw: `${m.file}#${m.node} ${m.name}`, roof: h.roof };
        out.skipped.push({ uuid: h.uuid, why: 'hidden' });
        continue;
      }
      if (!m) {
        if (h.threeId) { out.error = `可见命中 ${h.uuid}（three id ${h.threeId}）在 raw GLB 里对不上任何三角形`; return out; }
        out.skipped.push({ uuid: h.uuid, why: 'not-in-raw-glb-no-id' });
        continue;
      }
      if (!m.id) { out.skipped.push({ uuid: h.uuid, why: 'raw-chain-no-id' }); continue; }
      if (m.ambiguous) {
        const c2 = this.chain(m.second.file, m.second.node);
        if (c2.id !== m.id || c2.module !== m.module) { out.error = `命中三角形在 raw GLB 里有两处重合且身份不同：${m.file}#${m.node}(${m.id}/${m.module}) vs ${m.second.file}#${m.second.node}(${c2.id}/${c2.module})`; return out; }
      }
      if (h.threeId && h.threeId !== m.id) { out.error = `three 父链 id ${h.threeId} != raw 父链 id ${m.id}（${m.file}#${m.node}）`; return out; }
      Object.assign(out, { id: m.id, module: m.module, uuid: h.uuid, raw: { file: m.file, node: m.node, name: m.name, path: m.path, score: +m.score.toFixed(4), ambiguous: m.ambiguous, second: m.second } });
      return out;
    }
    return out;
  }
}

// ---------------- 浏览器半边 ----------------
// 在页面里装被动射线记录与独立射线测量函数（幂等）。
export async function installPageOracle(page) {
  const ok = await page.evaluate(async () => {
    const THREE = await import('three');
    if (!THREE.Raycaster.prototype.__oraPatched) {
      const orig = THREE.Raycaster.prototype.setFromCamera;
      THREE.Raycaster.prototype.setFromCamera = function (coords, camera) {
        const r = orig.call(this, coords, camera);
        window.__oraCamera = camera;
        window.__oraLastRay = { o: this.ray.origin.toArray(), d: this.ray.direction.toArray(), n: (window.__oraLastRay ? window.__oraLastRay.n : 0) + 1 };
        return r;
      };
      THREE.Raycaster.prototype.__oraPatched = true;
      THREE.Raycaster.prototype.__oraOrigSetFromCamera = orig;
    }
    const idOf = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.id) return n.userData.id; const p = String(n.name || '').split('|'); if (p.length >= 4) return p[1]; } return null; };
    const vis = (node) => { for (let n = node; n; n = n.parent) if (n.visible === false) return false; return true; };
    const roofRe = /roof|pan-tile/i;
    const isRoofish = (node) => { for (let n = node; n; n = n.parent) { if (n.userData && n.userData.roof) return true; if (roofRe.test(n.name || '') || roofRe.test((n.userData && n.userData.name) || '')) return true; } return false; };
    // 受控位移登记：{ uuid: [dx,dy,dz] 世界位移 }，命中其子树的三角形扣回位移后再对 raw GLB
    window.__oraUndo = window.__oraUndo || {};
    const undoOf = (node) => { for (let n = node; n; n = n.parent) if (window.__oraUndo[n.uuid]) return window.__oraUndo[n.uuid]; return null; };
    const triOf = (h) => {
      const o = h.object;
      if (!h.face || !o.geometry || !o.geometry.attributes.position) return null;
      const pos = o.geometry.attributes.position;
      const m = new THREE.Matrix4().copy(o.matrixWorld);
      if (o.isInstancedMesh && h.instanceId != null) { const im = new THREE.Matrix4(); o.getMatrixAt(h.instanceId, im); m.multiply(im); }
      const u = undoOf(o);
      return [h.face.a, h.face.b, h.face.c].map(i => {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m);
        if (u) v.sub(new THREE.Vector3(u[0], u[1], u[2]));
        return v.toArray();
      });
    };
    const mk = (h) => {
      const u = undoOf(h.object);
      const p = h.point.clone(); if (u) p.sub(new THREE.Vector3(u[0], u[1], u[2]));
      return { uuid: h.object.uuid, visible: vis(h.object), threeId: idOf(h.object), roof: isRoofish(h.object), dist: +h.distance.toFixed(3), point: p.toArray(), tri: triOf(h) };
    };
    const rayOf = (ray) => { const rc = new THREE.Raycaster(); rc.layers.enableAll(); rc.ray.origin.fromArray(ray.o); rc.ray.direction.fromArray(ray.d); return rc; };
    window.__oraHits = (ray, K = 16) => rayOf(ray).intersectObjects(window.__scene.children, true).slice(0, K).map(mk);
    // 某个具体对象（被测实现报告的命中节点）沿同一射线的命中三角形 + 父链可见性
    window.__oraNodeHit = (ray, uuid) => {
      const o = window.__scene.getObjectByProperty('uuid', uuid);
      if (!o) return { found: false };
      const hs = rayOf(ray).intersectObject(o, false);
      return { found: true, visibleChain: vis(o), threeId: idOf(o), roof: isRoofish(o), hit: hs.length ? mk(hs[0]) : null };
    };
    // 以当前相机为任意像素求射线（只供「默认状态可达性」扫描用，不点击）
    window.__oraPixelRay = (x, y) => {
      if (!window.__oraCamera) return null;
      const rc = new THREE.Raycaster();
      THREE.Raycaster.prototype.__oraOrigSetFromCamera.call(rc, new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), window.__oraCamera);   // 不经记录补丁
      return { o: rc.ray.origin.toArray(), d: rc.ray.direction.toArray() };
    };
    return true;
  });
  if (!ok) throw new Error('installPageOracle failed');
}
