// A2 — assemble/extend the street-sidefaces dataset (world/street-sidefaces/):
//   M batch (frozen): 10 baked-in-world skins, byte/sha unchanged
//   A package (new):  shared centered skins (geometry at box-local origin) +
//                     one instance per visible face (obbToWorld semantics)
//   collision-world.json  M-batch colliders (world) + per-instance slabs (obb)
//   instances.json        M-batch identity entries + per-face transforms
//   cameras.json          evidence cameras (M-batch poses kept verbatim)
//   review-manifest.json  shared/instanced counts, budgets, build chain
//
// Run: node scripts/build_sidefaces_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/sidefaces');           // M batch (frozen)
const KIT_FULL = resolve(root, 'kit/out/sidefaces-full'); // A package centered skins
const OUT = resolve(root, 'world/street-sidefaces');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const cfg = JSON.parse(await readFile(resolve(root, 'kit/gable-skin.config.json'), 'utf8'));
const faces = JSON.parse(await readFile(resolve(KIT, 'faces.json'), 'utf8'));
const plan = JSON.parse(await readFile(resolve(root, 'kit/out/sidefaces/plan-full.json'), 'utf8'));
const fullFaces = JSON.parse(await readFile(resolve(KIT_FULL, 'faces.json'), 'utf8'));

await mkdir(resolve(OUT, 'skins'), { recursive: true });

// --- obbToWorld / world-center helper (production semantics) -----------------
const worldOf = (obb) => {
  const c = Math.cos(obb.theta), s = Math.sin(obb.theta);
  return [obb.pos[0] + c * obb.center[0] + s * obb.center[2],
          obb.center[1] + (obb.pos[1] ?? 0),
          obb.pos[2] - s * obb.center[0] + c * obb.center[2]];
};

// --- M batch (frozen): copy verbatim, byte/sha checked ------------------------
const mSkins = [];
{
  const seen = new Set();
  for (const f of faces.faces) {
    if (seen.has(f.faceId)) continue;
    seen.add(f.faceId);
    const src = resolve(KIT, 'skins', `${f.faceId}.glb`);
    const bytes = await readFile(src);
    if (sha(bytes) !== f.sha256) throw new Error(`skin ${f.faceId} drifted from its build record`);
    await copyFile(src, resolve(OUT, 'skins', `${f.faceId}.glb`));
    const target = cfg.targets.find((t) => t.id === f.target);
    const rec = faces.colliders.find((c) => c.name === `gableskin:${f.faceId}`);
    mSkins.push({
      id: f.faceId, glb: `./world/street-sidefaces/skins/${f.faceId}.glb`,
      bytes: bytes.byteLength, sha256: sha(bytes), triangles: f.tris,
      kind: f.kind, module: f.module, moduleRecord: f.rec,
      bakedPlacement: target.placement, place: target.id,
      batch: 'M', outward: rec?.outward ?? null,
    });
  }
}

// --- A package: centered shared skins ----------------------------------------
const aSkins = [];
const skinById = new Map(); // skinId -> collider template (box-local: pos=[0,0,0], center=[0,0,0])
{
  const seen = new Set();
  for (const f of fullFaces.faces) {
    if (seen.has(f.faceId)) continue;
    seen.add(f.faceId);
    const src = resolve(KIT_FULL, 'skins', `${f.faceId}.glb`);
    const bytes = await readFile(src);
    if (sha(bytes) !== f.sha256) throw new Error(`skin ${f.faceId} drifted from its build record`);
    await copyFile(src, resolve(OUT, 'skins', `${f.faceId}.glb`));
    aSkins.push({
      id: f.faceId, glb: `./world/street-sidefaces/skins/${f.faceId}.glb`,
      bytes: bytes.byteLength, sha256: sha(bytes), triangles: f.tris,
      kind: f.kind === 'rear' ? 'rear' : 'gable', batch: 'A',
    });
  }
  // collider templates from the full build: pos/center are [0,0,0]-based
  const seenC = new Set();
  for (const c of fullFaces.colliders) {
    if (seenC.has(c.name)) continue;
    seenC.add(c.name);
    skinById.set(c.name.replace('gableskin:', ''), c);
    skinById.set(c.name.replace('gableskin:', '').split('|')[0], c); // dims-only alias
  }
}

// --- instances: one per plan instance; transform = box world center + yaw ----
const instances = {
  axis: 'glTF Y-up. M-batch skins: baked in world coords, identity placement. A-batch centered skins: geometry at box-local origin; positionGlb = world center of the record box (obbToWorld semantics), rotationYRad = module yaw.',
  instances: [],
};
for (const s of mSkins) {
  instances.instances.push({
    id: `skin-${s.id}`, module: `sideface-${s.id}`, skin: s.id,
    positionGlb: [0, 0, 0], rotationYRad: 0, batch: 'M',
    bakedFrom: { module: s.module, placement: s.bakedPlacement },
  });
}
const aColliders = [];
for (const i of plan.instances) {
  // world center of the record box under the module placement (obbToWorld)
  const obb = { pos: i.placement.pos, theta: i.placement.yaw,
                center: i.localBox.center, size: i.localBox.size };
  const [wx, wy, wz] = worldOf(obb);
  const tpl = skinById.get(i.skinId) ?? skinById.get(i.skinId.split('|')[0]);
  if (!tpl) throw new Error(`no collider template for skin ${i.skinId}`);
  // per-instance collider: template box (centered) rotated by yaw at (wx, wz);
  // offsetOverride already baked into the template's y/z center offsets.
  const tc = tpl.obb.center, ts = tpl.obb.size;
  // template obb is built centered-at-origin with yaw=0: its center already
  // encodes the outward offset in the box-local frame. The instance obb is
  // pos = wall-box world center, center = template center (local), theta = yaw.
  const rec = {
    name: `gableskin:${i.module}:${i.record}`, group: 'gableskin', type: 'box', batch: 'A',
    obb: { pos: [+wx.toFixed(6), +wy.toFixed(6), +wz.toFixed(6)],
           theta: i.placement.yaw, center: tc, size: ts },
    outward: worldNormal(i),
  };
  { // AABB about the TRUE obb world center (pos + R(theta)*center)
    const co = Math.cos(i.placement.yaw), si = Math.sin(i.placement.yaw);
    const ox2 = wx + co * tc[0] + si * tc[2];
    const oz2 = wz - si * tc[0] + co * tc[2];
    const corners = [[ts[0]/2, ts[2]/2], [ts[0]/2, -ts[2]/2], [-ts[0]/2, ts[2]/2], [-ts[0]/2, -ts[2]/2]]
      .map(([lx, lz]) => [co * lx + si * lz, -si * lx + co * lz]);
    const hx = Math.max(...corners.map((p) => Math.abs(p[0])));
    const hz = Math.max(...corners.map((p) => Math.abs(p[1])));
    rec.min = [+ox2.toFixed(6) - hx, +wy.toFixed(6) - ts[1] / 2, +oz2.toFixed(6) - hz];
    rec.max = [+ox2.toFixed(6) + hx, +wy.toFixed(6) + ts[1] / 2, +oz2.toFixed(6) + hz];
  }
  aColliders.push(rec);
  instances.instances.push({
    id: `skin-${i.module}-${i.faceType}`, module: `sideface-cs-${i.faceType}`, skin: i.skinId,
    positionGlb: [+wx.toFixed(6), +wy.toFixed(6), +wz.toFixed(6)],
    rotationYRad: i.placement.yaw, batch: 'A',
    from: { module: i.module, record: i.record, localBox: i.localBox },
  });
}
function worldNormal(instance) {
  // outward = thickness axis direction of the record box, signed away from the
  // module origin — computed from the module placement + local box
  const yaw = instance.placement.yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lc = instance.localBox.center, ls = instance.localBox.size;
  const tAxis = ls[0] <= ls[2] ? 0 : 2;
  const outSign = lc[tAxis] >= 0 ? 1 : -1;
  if (tAxis === 0) return [+(c * outSign).toFixed(6), +(-s * outSign).toFixed(6)];
  return [+(s * outSign).toFixed(6), +(c * outSign).toFixed(6)];
}

await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n');

const collision = {
  axis: 'glTF Y-up; WORLD records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'street-sidefaces',
  instances: instances.instances,
  colliders: [
    ...faces.colliders.map((c) => ({ ...c, type: 'box' })),
    ...aColliders,
  ],
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(collision, null, 2) + '\n');

// --- evidence cameras: M-batch poses verbatim + a few A-batch slot shots ------
{
  const world = JSON.parse(await readFile(resolve(root, 'world/collision-world.json'), 'utf8'));
  const all = [...world.colliders];
  for (const dir of ['world/east-edge', 'world/street-completion']) {
    for (const f of await readdir(resolve(root, dir))) {
      if (!f.startsWith('east-shop-')) continue;
      const c = JSON.parse(await readFile(resolve(root, dir, f, 'collision.json'), 'utf8'));
      all.push(...c.colliders);
    }
  }
  all.push(...collision.colliders);
  const boxes = all.map((r) => {
    const o = r.obb ?? {};
    if (!o.pos) return null;
    const co = Math.cos(o.theta), si = Math.sin(o.theta);
    return { name: r.name,
      c: [o.pos[0] + co * o.center[0] + si * o.center[2], o.center[1] + (o.pos[1] ?? 0),
          o.pos[2] - si * o.center[0] + co * o.center[2]],
      yaw: o.theta, half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] };
  }).filter(Boolean);
  const hitT = (p, q, box) => {
    const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
    const px = p[0] - box.c[0], pz = p[2] - box.c[2];
    const qx = q[0] - box.c[0], qz = q[2] - box.c[2];
    const pl = [c * px - s * pz, p[1] - box.c[1], s * px + c * pz];
    const ql = [c * qx - s * qz, q[1] - box.c[1], s * qx + c * qz];
    const d = [ql[0] - pl[0], ql[1] - pl[1], ql[2] - pl[2]];
    let tmin = 0, tmax = 1;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (Math.abs(pl[a]) > box.half[a]) return null; }
      else {
        let t1 = (-box.half[a] - pl[a]) / d[a], t2 = (box.half[a] - pl[a]) / d[a];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  };
  const firstHit = (eye, target) => {
    let best = { name: null, t: Infinity };
    for (const b of boxes) {
      const t = hitT(eye, target, b);
      if (t !== null && t < best.t) best = { name: b.name, t };
    }
    return best;
  };
  // keep the 10 M-batch cameras verbatim, add 8 A-batch evidence cameras
  // (one per A4 spec view) aimed at representative skins
  const mCam = [];
  {
    // regenerate the M poses exactly as the frozen dataset had them
    const oldCam = JSON.parse(await readFile(resolve(OUT, 'cameras.json'), 'utf8').catch(() => null));
    if (oldCam?.cameras) mCam.push(...oldCam.cameras.filter((c) => c.skinCollider &&
      !c.skinCollider.includes('cs-')));
  }
  const evidenceViews = [
    ['junction-west', 'N01-plain-v1', 'side-w'],
    ['west-road-mid', 'S02-photo_shop', 'side-w'],
    ['placeholder-band', 'N05-restaurant-a', 'rear'],
    ['aerial-overview', 'N02-pharmacy_shop', 'side-w'],
    ['west-road-mid', 'N03-cloth_shop', 'rear'],
    ['placeholder-band', 'N08-plain-v2', 'side-w'],
    ['aerial-overview', 'S04-restaurant-b', 'rear'],
    ['west-road-mid', 'N10-plain-v3', 'side-e'],
  ];
  const aCam = [];
  for (const [view, mod, ft] of evidenceViews) {
    const inst = plan.instances.find((x) => x.module === mod && x.faceType === ft);
    if (!inst) continue;
    const obb = { pos: inst.placement.pos, theta: inst.placement.yaw,
                  center: inst.localBox.center, size: inst.localBox.size };
    const [wx, , wz] = worldOf(obb);
    // camera south of the module front, elevated for readability
    const eye = [wx + Math.sin(inst.placement.yaw) * -8 + 4, 6.5,
                 wz + Math.cos(inst.placement.yaw) * -8 + 10];
    const id = `full-${view}-${mod}-${ft}`;
    aCam.push({
      id,
      positionGlb: eye.map((v) => +v.toFixed(3)),
      targetGlb: [wx, 2.6, wz],
      verticalFovDegrees: 55,
      labelZh: `全量外皮取证 · ${mod} ${ft}（${view}）`,
      skinCollider: `gableskin:${mod}:${inst.record.split('+')[0]}`,
      evidenceView: view,
    });
    void firstHit;
  }
  await writeFile(resolve(OUT, 'cameras.json'),
    JSON.stringify({ framebuffer: [1280, 960],
      cameraPolicy: 'M-batch poses verbatim + A-batch evidence views (street-side elevated)',
      cameras: [...mCam, ...aCam] }, null, 2) + '\n');
}

// --- manifest ------------------------------------------------------------------
const allSkins = [...mSkins, ...aSkins];
const uniqueTris = aSkins.reduce((s, k) => s + k.triangles, 0);
const instancedTris = plan.instances.length * (aSkins.reduce((s, k) => s + k.triangles, 0) / aSkins.length);
const manifest = {
  datasetId: 'street-sidefaces',
  title: '主街可见山墙/背面外皮（M 批 10 件冻结 + A 批全量共享/实例化）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  skins: allSkins,
  counts: {
    mBatchSkins: mSkins.length,
    aBatchSharedSkins: aSkins.length,
    instancesTotal: instances.instances.length,
    mBatchInstances: mSkins.length,
    aBatchInstances: instances.instances.length - mSkins.length,
    surveyVisibleFaces: plan.surveyVisibleFaces,
    dedupedWalls: plan.wallCount,
  },
  placedTriangles: mSkins.reduce((s, k) => s + k.triangles, 0) + plan.instances.length * 0
    + Math.round(instancedTris),
  triangleAccounting: {
    uniqueSkinsTris: { actual: uniqueTris, limit: 30000 },
    instancedPlacedTris: { actual: Math.round(instancedTris), limit: 120000 },
    formula: 'instanced = instanceCount × meanUniqueSkinTris (shared geometry, per-instance transforms)',
  },
  budgets: { perFaceTrisMax: 1500, newTextures: 0 },
  mBatchFrozen: { skins: mSkins.map((s) => s.id), note: 'ids/shas unchanged from the M batch' },
  placementContract: 'M batch baked in world coords (identity instances); A batch centered skins with per-face instances (positionGlb = record-box world center via obbToWorld, rotationYRad = module yaw)',
  buildChain: 'find_visible_side_faces.mjs -> plan-full.json -> gable-skin-full.config.json -> build_gable_skins.py (centered) -> build_sidefaces_world.mjs',
  generatedBy: 'scripts/build_sidefaces_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`SIDEFACES_FULL_READY skins=${allSkins.length} (M ${mSkins.length} + A ${aSkins.length}) `
  + `uniqueTris=${uniqueTris}/30000 instancedTris≈${Math.round(instancedTris)}/120000 `
  + `instances=${instances.instances.length} colliders=${collision.colliders.length}`);
