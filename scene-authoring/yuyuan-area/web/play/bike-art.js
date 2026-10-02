// bike-art.js — Pawborough 小城单车视觉精修（毛绒电影感）
// 冻结模块：只替换观感，不动锚点/骑姿socket/物理/原GLB几何。
// installBikeArt(rig) → { dispose() }；幂等；dispose 恢复原可见性与材质，
// 仅释放本模块新建/克隆的几何与材质，不 dispose 共享 GLB 的原始资源。

import * as THREE from 'three';

const FLAG = '__pawboroughBikeArtV1';
const WHEEL_R = 0.17; // 冻结：原轮外半径（米）

function norm(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function isAncestor(a, b) {
  let p = b.parent;
  while (p) {
    if (p === a) return true;
    p = p.parent;
  }
  return false;
}

function topmost(nodes) {
  return nodes.filter((n) => !nodes.some((m) => m !== n && isAncestor(m, n)));
}

// 按冻结的分件名归一化匹配；找不到的部件安静跳过，由主控验收兜底。
function classify(root) {
  const buckets = { front: [], rear: [], frame: [], fork: [], handle: [], saddle: [], grips: [], basket: [] };
  root.traverse((o) => {
    const n = norm(o.name);
    if (!n) return;
    if (n === 'front-wheel' || (n.includes('front') && n.includes('wheel'))) buckets.front.push(o);
    else if (n === 'rear-wheel' || (n.includes('rear') && n.includes('wheel'))) buckets.rear.push(o);
    else if (n === 'frame') buckets.frame.push(o);
    else if (n === 'fork' || n.startsWith('fork-')) buckets.fork.push(o);
    else if (n.includes('grip')) buckets.grips.push(o);
    else if (n === 'handlebar' || n === 'handle' || (n.includes('handle') && n.includes('bar'))) buckets.handle.push(o);
    else if (n.includes('saddle')) buckets.saddle.push(o);
    else if (n.includes('basket') && !n.includes('socket')) buckets.basket.push(o);
  });
  return {
    front: topmost(buckets.front)[0] || null,
    rear: topmost(buckets.rear)[0] || null,
    frame: topmost(buckets.frame)[0] || null,
    fork: topmost(buckets.fork)[0] || null,
    handle: topmost(buckets.handle)[0] || null,
    saddle: topmost(buckets.saddle),
    grips: topmost(buckets.grips),
    basket: topmost(buckets.basket)[0] || null,
  };
}

// 子树在世界坐标下的包围盒，换算回 node 的局部空间。
function localBox(node) {
  node.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  box.applyMatrix4(new THREE.Matrix4().copy(node.matrixWorld).invert());
  return box;
}

// 原轮children在轮group局部下的中心（圆盘应在轴心，量一下做保险）。
function wheelLocalCenter(wheel) {
  wheel.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(wheel.matrixWorld).invert();
  const out = new THREE.Vector3();
  let has = false;
  const box = new THREE.Box3();
  for (const c of wheel.children) {
    const b = new THREE.Box3().setFromObject(c);
    if (b.isEmpty()) continue;
    b.applyMatrix4(inv);
    if (!has) {
      box.copy(b);
      has = true;
    } else {
      box.union(b);
    }
  }
  if (has) box.getCenter(out);
  return out;
}

export function installBikeArt(rig) {
  const root = rig && rig.isObject3D ? rig : rig && (rig.root || rig.group || rig.object || rig.scene);
  if (!root || !root.isObject3D) throw new Error('bike-art: installBikeArt 需要 Object3D 根节点');
  if (root.userData[FLAG]) return root.userData[FLAG]; // 幂等

  root.updateMatrixWorld(true);

  const geoms = new Set();
  const mats = new Set();
  const hidden = []; // { obj, visible }
  const painted = []; // { mesh, material }
  const added = []; // { parent, child }

  const newMat = (params) => {
    const m = new THREE.MeshStandardMaterial(params);
    mats.add(m);
    return m;
  };
  const newGeo = (g) => {
    geoms.add(g);
    return g;
  };
  const hideOriginals = (node) => {
    for (const c of node.children.slice()) {
      hidden.push({ obj: c, visible: c.visible });
      c.visible = false;
    }
  };
  const attach = (parent, child) => {
    added.push({ parent, child });
    parent.add(child);
  };

  // —— 共享材质（全部本模块新建）——
  const paintMat = newMat({ color: 0x699f98, roughness: 0.38, metalness: 0.16 }); // 青瓷玉绿烤漆
  const creamMat = newMat({ color: 0xf3ecdd, roughness: 0.55, metalness: 0.02 }); // 乳白点缀
  const leatherMat = newMat({ color: 0x8a5a3b, roughness: 0.7, metalness: 0.04 }); // 皮革棕
  const tireMat = newMat({ color: 0x35302c, roughness: 0.92, metalness: 0.0 }); // 温润深炭，非纯黑
  const steelMat = newMat({ color: 0xc9cdd2, roughness: 0.32, metalness: 0.85 });
  const brassMat = newMat({ color: 0xb08d3e, roughness: 0.3, metalness: 0.85 });
  const woodMat = newMat({ color: 0xb98d5f, roughness: 0.8, metalness: 0.0 });
  const rattanMat = newMat({ color: 0x8a5a30, roughness: 0.85, metalness: 0.0 });

  // —— 共享几何（前后轮复用同一套；环面绕轮轴 localX）——
  const tireGeo = newGeo(new THREE.TorusGeometry(WHEEL_R - 0.018, 0.018, 14, 44).rotateY(Math.PI / 2));
  const rimGeo = newGeo(new THREE.TorusGeometry(0.133, 0.0065, 10, 40).rotateY(Math.PI / 2));
  const spokeGeo = newGeo(new THREE.CylinderGeometry(0.0022, 0.0022, 0.112, 6, 1));
  const hubGeo = newGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.052, 10, 1).rotateZ(Math.PI / 2));
  const flangeGeo = newGeo(new THREE.CylinderGeometry(0.027, 0.027, 0.006, 10, 1).rotateZ(Math.PI / 2));
  const capGeo = newGeo(new THREE.CylinderGeometry(0.013, 0.013, 0.008, 10, 1).rotateZ(Math.PI / 2));

  const parts = classify(root);

  function buildWheel(wheel) {
    if (!wheel) return;
    hideOriginals(wheel);
    const g = new THREE.Group();
    g.name = 'bike-art-wheel';
    g.position.copy(wheelLocalCenter(wheel));
    g.add(new THREE.Mesh(tireGeo, tireMat));
    g.add(new THREE.Mesh(rimGeo, steelMat));
    g.add(new THREE.Mesh(hubGeo, steelMat));
    for (const s of [-1, 1]) {
      const flange = new THREE.Mesh(flangeGeo, steelMat);
      flange.position.x = s * 0.023;
      g.add(flange);
      const cap = new THREE.Mesh(capGeo, creamMat); // 乳白轴帽点缀
      cap.position.x = s * 0.03;
      g.add(cap);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, steelMat);
      spoke.position.set(0, Math.cos(a) * 0.078, Math.sin(a) * 0.078);
      spoke.rotation.x = a;
      g.add(spoke);
    }
    attach(wheel, g); // 挂原轮group：转向/滚动继续由原节点继承
  }

  // 材质克隆成目标观感；同源材质共享一个克隆，原件记录待恢复。
  const cloneMap = new Map();
  function repaint(mesh, base) {
    if (!mesh.isMesh || mesh.userData.__bikeArtDone) return;
    mesh.userData.__bikeArtDone = true;
    const src = mesh.material;
    const key = `${src && src.uuid} > ${base.uuid}`;
    let c = cloneMap.get(key);
    if (!c) {
      c = src.clone();
      if ('color' in c) c.color.copy(base.color);
      if ('roughness' in c) c.roughness = base.roughness;
      if ('metalness' in c) c.metalness = base.metalness;
      mats.add(c);
      cloneMap.set(key, c);
    }
    painted.push({ mesh, material: src });
    mesh.material = c;
  }

  // 轮/篮/鞍/把套子树不参与车架烤漆，避免把皮革/藤木也喷绿。
  const excluded = new Set();
  for (const n of [parts.front, parts.rear, parts.basket, ...parts.saddle, ...parts.grips]) {
    if (n) n.traverse((o) => excluded.add(o));
  }
  function paintTree(node, base) {
    if (!node) return;
    node.traverse((o) => {
      if (!o.isMesh || (excluded.has(o) && base === paintMat)) return;
      repaint(o, base);
    });
  }

  buildWheel(parts.front);
  buildWheel(parts.rear);
  paintTree(parts.frame, paintMat);
  paintTree(parts.fork, paintMat);
  paintTree(parts.handle, paintMat);
  for (const n of parts.saddle) paintTree(n, leatherMat);
  for (const n of parts.grips) paintTree(n, leatherMat);

  // 藤篮：沿用原basket边界，底板 + 开口藤色边框 + 10条细木条（8–12条）。
  function buildBasket(basket) {
    if (!basket) return;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(basket).applyMatrix4(root.matrixWorld.clone().invert());
    if (!box) return;
    hidden.push({obj:basket,visible:basket.visible});basket.visible=false;
    const g = new THREE.Group();
    g.name = 'bike-art-basket';
    const w = Math.max(0.02, box.max.x - box.min.x);
    const d = Math.max(0.02, box.max.z - box.min.z);
    const h = Math.max(0.02, box.max.y - box.min.y);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const bottom = new THREE.Mesh(newGeo(new THREE.BoxGeometry(w * 0.92, 0.008, d * 0.92)), woodMat);
    bottom.position.set(cx, box.min.y + 0.007, cz);
    g.add(bottom);
    const railX = newGeo(new THREE.BoxGeometry(w, 0.011, 0.011));
    const railZ = newGeo(new THREE.BoxGeometry(0.011, 0.011, d * 0.96));
    const ry = box.max.y - 0.008;
    for (const s of [-1, 1]) {
      const r1 = new THREE.Mesh(railX, rattanMat);
      r1.position.set(cx, ry, cz + ((s * d) / 2) * 0.96);
      g.add(r1);
      const r2 = new THREE.Mesh(railZ, rattanMat);
      r2.position.set(cx + ((s * w) / 2) * 0.96, ry, cz);
      g.add(r2);
    }
    const slat = newGeo(new THREE.BoxGeometry(0.013, h * 0.98, 0.008));
    const longIsX = w >= d;
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(slat, woodMat);
        const t = ((i + 0.5) / 5 - 0.5) * (longIsX ? w : d) * 0.92;
        const y = (box.min.y + box.max.y) / 2;
        if (longIsX) m.position.set(cx + t, y, cz + ((s * d) / 2) * 0.94);
        else m.position.set(cx + ((s * w) / 2) * 0.94, y, cz + t);
        g.add(m);
      }
    }
    // Two light horizontal bindings make the slats read as a woven basket.
    for(const fraction of[.32,.63])for(const side of[-1,1]){
      const a=new THREE.Mesh(railX,rattanMat);a.scale.y=.45;a.position.set(cx,box.min.y+h*fraction,cz+side*d*.49);g.add(a);
      const b=new THREE.Mesh(railZ,rattanMat);b.scale.y=.45;b.position.set(cx+side*w*.49,box.min.y+h*fraction,cz);g.add(b);
    }
    attach(root, g);
  }
  buildBasket(parts.basket);

  // Mount small details in vehicle Y-up coordinates while inheriting steering.
  const steering=rig.steering??root.getObjectByName('steering')??root;
  function steeringDetail(group,position){
    root.updateMatrixWorld(true);
    group.position.copy(steering.worldToLocal(root.localToWorld(new THREE.Vector3(...position))));
    group.quaternion.copy(steering.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(root.getWorldQuaternion(new THREE.Quaternion())));
    attach(steering,group);
  }
  const bell=new THREE.Group();bell.name='bike-art-bell';
  bell.add(new THREE.Mesh(newGeo(new THREE.SphereGeometry(.016,12,8,0,Math.PI*2,0,Math.PI/2)),brassMat));
  steeringDetail(bell,[.13,.405,-.14]);
  const lamp=new THREE.Group();lamp.name='bike-art-lamp';
  const housing=new THREE.Mesh(newGeo(new THREE.CylinderGeometry(.023,.021,.03,16).rotateX(Math.PI/2)),creamMat);
  const lens=new THREE.Mesh(newGeo(new THREE.CircleGeometry(.018,16)),newMat({color:0xffecc2,roughness:.25,emissive:0x6d5428,emissiveIntensity:.25,side:THREE.DoubleSide}));
  lens.position.z=-.016;lamp.add(housing,lens);steeringDetail(lamp,[0,.255,-.395]);

  const handle = {
    dispose() {
      if (root.userData[FLAG] !== handle) return;
      for (const { mesh, material } of painted) {
        mesh.material = material;
        delete mesh.userData.__bikeArtDone;
      }
      for (const { obj, visible } of hidden) obj.visible = visible;
      for (const { parent, child } of added) parent.remove(child);
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      geoms.clear();
      mats.clear();
      hidden.length = 0;
      painted.length = 0;
      added.length = 0;
      delete root.userData[FLAG];
    },
  };
  root.userData[FLAG] = handle;
  return handle;
}
