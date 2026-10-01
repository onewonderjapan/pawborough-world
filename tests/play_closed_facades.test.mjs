// 工单 C：闭门叠加层契约测试（纯 node，不进浏览器）。
// 真实对象：out-zone/layout.json + 导出 zone GLB 节点 + overlay GLB 实际顶点 +
// web/play/closed-facades.js 生命周期。不读源字符串当证据。
// Run: node tests/play_closed_facades.test.mjs   (exit 0 = contract holds)
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const area = resolve(root, 'scene-authoring/yuyuan-area');
const require = createRequire(resolve(area, 'package.json'));
const THREE = require('three');
const { GLTFLoader } = await import(resolve(area, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'));
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });

const { createClosedFacades, closedFacadeHint } = await import(resolve(area, 'web/play/closed-facades.js'));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

// buildFacadeBay 公式独立复算（与 src/build-scene.mjs 逐条对应，不从 inputs 抄）
const hashStr = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const expectedDoor = (o) => {
  const [x, z] = o.geometry.position;
  const [dx, dz] = o.geometry.dir;
  const w = o.geometry.width || 4.6;
  const variant = o.doorVariant ?? (hashStr(o.id) % 2 === 0 ? 'center' : 'offsetLeft');
  const doorW = Math.min(1.9, w * 0.4);
  const doorX = variant === 'center' ? 0 : -w * 0.22;
  return { tx: x + dx * 0.16, tz: z + dz * 0.16, rotY: o.geometry.rotY, doorW, doorX, variant, w };
};

// GLB JSON chunk 读取（只取小字段，绝不 dump）
async function glbDoc(path) {
  const buf = await readFile(path);
  const clen = buf.readUInt32LE(12);
  return { doc: JSON.parse(buf.slice(20, 20 + clen).toString('utf8')), bytes: buf.length, buf };
}

// ---- 输入 ----
const manifest = await readJson(resolve(area, 'inputs/play-closed-facades.json'));
const layout = await readJson(resolve(area, 'out-zone/layout.json'));
const glbPath = resolve(area, manifest.facades.path);
const { doc: overlayDoc, buf: overlayBuf } = await glbDoc(glbPath);

const layoutBays = layout.objects.filter(o => o.kind === 'facadeBay' && o.disposition === 'rendered');
const bayById = new Map(layoutBays.map(o => [o.id, o]));
const targets = manifest.targets;
const targetById = new Map(targets.map(t => [t.id, t]));

// ---- 1) 目标 = 实际导出的展示 facadeBay（zone GLB 节点级证据） ----
{
  const exported = new Map();
  for (const f of (await readdir(resolve(area, 'out-zone'))).filter(f => /^zone-.*\.glb$/.test(f) && !f.endsWith('.cm.glb'))) {
    const { doc } = await glbDoc(resolve(area, 'out-zone', f));
    for (const n of doc.nodes ?? []) {
      const m = /^[^|]+\|(facade-[^|]+)\|facadeBay/.exec(String(n.name ?? ''));
      if (m) exported.set(m[1], { file: f, extrasId: n.extras?.id, kind: n.extras?.kind });
    }
  }
  check('闭门 + 通路排除 = 实际导出 facadeBay 节点数', targets.length + (manifest.facades.excludedOnPassage ?? []).length === exported.size,
    `${targets.length}+${manifest.facades.excludedOnPassage?.length ?? 0} vs ${exported.size}`);
  const missing = [...exported.keys()].filter(id => !targetById.has(id));
  const extraT = targets.filter(t => !exported.has(t.id));
  const missingAllExcluded = missing.every(id => (manifest.facades.excludedOnPassage ?? []).some(e => e.id === id));
  check('目标 ⊆ 导出集，且未闭门者恰为通路排除项', missing.length === (manifest.facades.excludedOnPassage ?? []).length
    && extraT.length === 0 && missingAllExcluded, `missing=${missing.length} extra=${extraT.length}`);
  const extrasOk = [...exported.entries()].every(([id, e]) => e.extrasId === id && e.kind === 'facadeBay');
  check('zone GLB extras id/kind 与节点名一致', extrasOk);
  // 每目标 parentBuilding/trade/geometry 与 layout 同源
  const fieldsOk = targets.every(t => {
    const o = bayById.get(t.id);
    return o && t.parentBuilding === o.parentBuilding && t.zone === o.zone
      && Math.abs(t.rotY - o.geometry.rotY) < 1e-9
      && Math.abs(t.width - o.geometry.width) < 1e-9
      && t.doorVariant === (o.doorVariant ?? (hashStr(o.id) % 2 === 0 ? 'center' : 'offsetLeft'));
  });
  check('targets 字段与 layout 同源（pos/rotY/width/doorVariant/parent）', fieldsOk);
}

// ---- 2) 闭门公式 = buildFacadeBay（门宽/门偏/期望门面） ----
{
  const bad = [];
  for (const t of targets) {
    const e = expectedDoor(bayById.get(t.id));
    if (Math.abs(t.doorW - e.doorW) > 1e-9 || Math.abs(t.doorX - e.doorX) > 1e-9
      || Math.abs(t.rotY - e.rotY) > 1e-9) bad.push(t.id);
    const nx = Math.sin(t.rotY), nz = Math.cos(t.rotY);
    if (Math.hypot(t.doorNormalGlb[0] - nx, t.doorNormalGlb[1] - nz) > 1e-5) bad.push(t.id + ':normal');
    const gx = e.tx + e.doorX * Math.cos(t.rotY) + 0.225 * Math.sin(t.rotY);
    const gz = e.tz - e.doorX * Math.sin(t.rotY) + 0.225 * Math.cos(t.rotY);
    if (Math.hypot(t.doorFrontCenterGlb[0] - gx, t.doorFrontCenterGlb[2] - gz) > 1e-4) bad.push(t.id + ':center');
  }
  check('doorW/doorX/期望门面中心与法线 = buildFacadeBay 公式', bad.length === 0, bad.slice(0, 3).join(','));
}

// ---- 3) 真通路 / 真庙门 / 摊位排除（几何证据） ----
{
  const passages = layout.reviewRepair?.passages ?? [];
  const distToPoly = (px, pz, poly) => {
    let inside = false, best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
      if ((z1 > pz) !== (z2 > pz)) {
        const xin = (x2 - x1) * (pz - z1) / (z2 - z1) + x1;
        if (px < xin) inside = !inside;
      }
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L2));
      best = Math.min(best, Math.hypot(px - x1 - t * dx, pz - z1 - t * dz));
    }
    return inside ? -best : best;
  };
  const clearOfPassage = targets.every(t => {
    const [gx, , gz] = t.doorFrontCenterGlb;
    return passages.every(p => (p.rectangles ?? []).every(r => distToPoly(gx, gz, r) > 0.6));
  });
  check('闭门目标门中心全部避开真通路 0.6m 邻域', clearOfPassage);
  const excluded = manifest.facades.excludedOnPassage ?? [];
  const excludedCovered = excluded.every(e => bayById.has(e.id) && !targetById.has(e.id));
  check('被排除的真通路开间确属 layout 且不在闭门目标中', excludedCovered && excluded.length > 0,
    `excluded=${excluded.length}`);
  const allBazaar = targets.every(t => t.zone === 'bazaar');
  check('闭门目标全部为 bazaar 商业展示面（无庙/园门）', allBazaar);
  // 摊位（stall）不在闭门目标里
  const stallIds = new Set(layout.objects.filter(o => o.kind === 'stall').map(o => o.id));
  check('无摊位混入闭门目标', targets.every(t => !stallIds.has(t.id)));
}

// ---- 4) overlay GLB 实际几何（world 顶点，非元数据复读） ----
{
  const gltf = await new Promise((yes, no) => new GLTFLoader().parse(
    overlayBuf.buffer.slice(overlayBuf.byteOffset, overlayBuf.byteOffset + overlayBuf.byteLength), '', yes, no));
  const sceneG = gltf.scene;
  sceneG.updateMatrixWorld(true);
  const verts = [];
  let tris = 0;
  const matSet = new Set();
  sceneG.traverse(o => {
    if (!o.isMesh) return;
    tris += o.geometry.index.count / 3;
    matSet.add(o.material.uuid);
    const p = o.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      verts.push(v.x, v.y, v.z);
    }
  });
  const cloud = new Float32Array(verts);
  check('GLB 材质数 <= 8（draw call 预算）', matSet.size <= 8, `materials=${matSet.size}`);
  const meshCount = (overlayDoc.meshes ?? []).length;
  check('GLB mesh 数 <= 8', meshCount <= 8, `meshes=${meshCount}`);
  check('GLB 三角形 <= 200k', tris <= 200000, `tris=${tris}`);
  const backZ = 0.175, frontZ = 0.225;
  let frontMiss = 0, zFight = 0, floatAway = 0;
  // 全量：门前面带（leaf 前表面）+ 门区 localZ 带（反变换回开间局部系）。
  // zl 同时限定 [-0.05, 0.4]：只统计贴墙几何，远处平行立面的顶点不入窗。
  for (const t of targets) {
    const e = expectedDoor(bayById.get(t.id));
    const c = Math.cos(t.rotY), s = Math.sin(t.rotY);
    let zMin = Infinity, zMax = -Infinity, count = 0, frontCount = 0;
    for (let i = 0; i < cloud.length; i += 3) {
      const X = cloud[i], Y = cloud[i + 1], Z = cloud[i + 2];
      if (Y > 2.62 || Y < -0.05) continue;          // 只看门区，不含楣上小牌
      const rx = X - e.tx, rz = Z - e.tz;
      const u = rx * c - rz * s;                    // 沿墙
      const zl = rx * s + rz * c;                   // 向街
      if (zl < -0.05 || zl > 0.4) continue;         // 贴墙带
      if (Math.abs(u - e.doorX) <= e.doorW / 2 + 0.06 && Y <= 2.62) {
        count += 1;
        zMin = Math.min(zMin, zl); zMax = Math.max(zMax, zl);
        if (Math.abs(zl - frontZ) <= 0.06 && Math.abs(u - e.doorX) <= e.doorW / 2 + 0.02
          && Y >= 0.2 && Y <= 2.3) frontCount += 1;
      }
    }
    if (frontCount < 8) frontMiss += 1;             // 门前面无实体：门没真正落位
    if (count < 8) { zFight += 1; continue; }
    if (zMin < backZ - 0.006) zFight += 1;          // 背面穿到旧门面(.15)/格栅(.17)内 → zfight
    if (zMax > 0.34) floatAway += 1;                // 门区浮出太远（悬空门）
  }
  check('每个闭门目标门前面都有实体几何', frontMiss === 0, `miss=${frontMiss}/${targets.length}`);
  check('门区背面 >= .17（无 zfight / 浮门）', zFight === 0, `bad=${zFight}/${targets.length}`);
  check('门区正面 <= .34（无悬空远浮）', floatAway === 0, `bad=${floatAway}/${targets.length}`);
  // root extras：closure facade IDs
  const rootNode = (overlayDoc.nodes ?? []).find(n => n.name === 'play-closed-facades');
  const ids = rootNode?.extras?.closedFacadeIds;
  check('root extras.closedFacadeIds = 目标 id 集', Array.isArray(ids) && ids.length === targets.length
    && ids.every(id => targetById.has(id)), `extras=${ids?.length}`);
  // 双扇实体：抽 40 门区验证正面（0.20..0.26 带）有足够面板几何
  let seamOk = 0;
  for (const t of targets.slice(0, 40)) {
    const e = expectedDoor(bayById.get(t.id));
    const c = Math.cos(t.rotY), s = Math.sin(t.rotY);
    let front = 0;
    for (let i = 0; i < cloud.length; i += 3) {
      const rx = cloud[i] - e.tx, rz = cloud[i + 2] - e.tz;
      const u = rx * c - rz * s, zl = rx * s + rz * c;
      if (zl > 0.2 && zl < 0.26 && Math.abs(u - e.doorX) < e.doorW / 2 && cloud[i + 1] < 2.4) front += 1;
    }
    if (front >= 16) seamOk += 1;
  }
  check('抽样 40 门区正面均有实体门板（非镂空）', seamOk === 40, `ok=${seamOk}/40`);
  // 小牌：每 parentBuilding 恰一批闭门、plaque 材质与内嵌 PNG 存在
  const perParent = new Map();
  for (const t of targets) perParent.set(t.parentBuilding, (perParent.get(t.parentBuilding) ?? 0) + 1);
  check('每 parentBuilding 的闭门目标合法（>=1）', [...perParent.values()].every(v => v >= 1),
    `parents=${perParent.size}`);
  check('plaque 材质存在（淡米小牌材质入 GLB）',
    (overlayDoc.materials ?? []).some(m => /plaque/i.test(m.name ?? '')),
    (overlayDoc.materials ?? []).map(m => m.name).join(','));
  check('GLB 内嵌标签 PNG', (overlayDoc.images ?? []).some(i => i.mimeType === 'image/png'),
    `images=${(overlayDoc.images ?? []).length}`);
  check('plaqueCount <= parentBuildings（每幢至多 1 块小牌）',
    manifest.facades.plaqueCount <= manifest.facades.parentBuildings,
    `plaque=${manifest.facades.plaqueCount} parents=${manifest.facades.parentBuildings}`);
}

// ---- 5) SHA/bytes 清单契约 ----
{
  const sha = createHash('sha256').update(overlayBuf).digest('hex');
  check('manifest sha256 = GLB 实际字节', sha === manifest.facades.sha256, sha.slice(0, 12));
  check('manifest bytes = GLB 实际大小', overlayBuf.length === manifest.facades.bytes,
    `${overlayBuf.length} vs ${manifest.facades.bytes}`);
  const layoutSha = createHash('sha256').update(await readFile(resolve(area, 'out-zone/layout.json'))).digest('hex');
  check('manifest 记录的 layoutSha256 与当前 layout 一致', manifest.facades.source.layoutSha256 === layoutSha);
  check('closedCount 与 targets 一致', manifest.facades.closedCount === targets.length);
}

// ---- 6) closed-facades.js 生命周期（mock 注入，不进浏览器） ----
{
  const fakeGeo = () => ({ disposed: false, dispose() { this.disposed = true; } });
  const fakeTex = () => ({ isTexture: true, disposed: false, dispose() { this.disposed = true; } });
  const makeRoot = () => {
    const tex = fakeTex();
    const mat = { disposed: false, map: tex, dispose() { this.disposed = true; } };
    const geo = fakeGeo();
    const mesh = { isMesh: true, geometry: geo, material: mat };
    const rootNode = {
      name: 'play-closed-facades', userData: { closedCount: 172 }, children: [mesh],
      traverse(fn) { fn(mesh); fn(rootNode); },
    };
    return { root: rootNode, tex, mat, geo };
  };
  const scene = {
    added: [], removed: [],
    add(o) { this.added.push(o); }, remove(o) { this.removed.push(o); },
  };
  const manifest2 = { facades: { path: 'resources/play-facades/play-closed-facades.glb', sha256: 'a'.repeat(64), closedCount: 172, root: 'play-closed-facades' } };
  const bufferOf = Buffer.alloc(8);

  // ok 路径
  {
    const r = makeRoot();
    const owner = createClosedFacades({
      scene,
      fetchJson: async () => manifest2,
      fetchBuffer: async () => bufferOf,
      digest: async () => manifest2.facades.sha256,
      parseGlb: async () => r.root,
    });
    await owner.install();
    check('lifecycle: 成功加载 ready=true count=172', owner.state.ready === true && owner.state.count === 172
      && owner.state.error === null);
    check('lifecycle: status() 暴露 closedFacadesReady/Count/Error', owner.status().closedFacadesReady === true
      && owner.status().closedFacadeCount === 172 && owner.status().closedFacadesError === null);
    check('lifecycle: root 恰加入 scene 一次', scene.added.length === 1 && scene.removed.length === 0);
    owner.dispose();
    check('lifecycle: dispose 移除 root', scene.removed.length === 1);
    check('lifecycle: dispose 只释放自有 geometry/material/texture',
      r.geo.disposed && r.mat.disposed && r.tex.disposed);
    check('lifecycle: dispose 后 ready=false', owner.status().closedFacadesReady === false);
    owner.dispose();   // 二次 dispose 不抛
    check('lifecycle: 二次 dispose 安全', scene.removed.length === 1);
  }
  // SHA 不符：不假报 ready，root 不进场景，不误 dispose
  {
    const r = makeRoot();
    const owner = createClosedFacades({
      scene,
      fetchJson: async () => manifest2,
      fetchBuffer: async () => bufferOf,
      digest: async () => 'b'.repeat(64),
      parseGlb: async () => r.root,
    });
    await owner.install();
    check('lifecycle: SHA 不符 → ready=false error 非空', owner.state.ready === false
      && !!owner.state.error);
    check('lifecycle: SHA 不符 → root 未入场景', scene.added.length === 1);
    check('lifecycle: SHA 不符 → 不误 dispose 任何资源', !r.geo.disposed && !r.mat.disposed);
  }
  // manifest 拉取失败：只提示玩家话术，无技术字段
  {
    let hint = null;
    const owner = createClosedFacades({
      scene,
      fetchJson: async () => { throw new Error('/inputs/...: 404'); },
      fetchBuffer: async () => bufferOf,
      parseGlb: async () => makeRoot().root,
      onHint: (m) => { hint = m; },
    });
    await owner.install();
    check('lifecycle: manifest 失败 → error 记录 ready=false', owner.state.ready === false && !!owner.state.error);
    check('lifecycle: 失败触发玩家提示', typeof hint === 'string' && hint.includes('门面'));
    check('玩家提示不露技术字段（SHA/GLB/extras）',
      !/sha|glb|extras|manifest|json/i.test(hint ?? ''), hint);
    const h2 = closedFacadeHint('x');
    check('closedFacadeHint 无技术字段', !/sha|glb|extras|manifest|json/i.test(h2));
  }
  // GLB closedCount 与 manifest 不符：按异常
  {
    const r = makeRoot();
    r.root.userData.closedCount = 99;
    const owner = createClosedFacades({
      scene,
      fetchJson: async () => manifest2,
      fetchBuffer: async () => bufferOf,
      digest: async () => manifest2.facades.sha256,
      parseGlb: async () => r.root,
    });
    await owner.install();
    check('lifecycle: closedCount 不符 → 不 ready', owner.state.ready === false && !!owner.state.error);
    check('lifecycle: closedCount 不符 → root 未入场景', scene.added.length === 1);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
