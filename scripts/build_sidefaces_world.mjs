// M3 — assemble the street-sidefaces dataset (world/street-sidefaces/):
//   skins/*.glb            the built face skins (byte-checked against faces.json)
//   instances.json         the module instance transform each skin was baked with
//   collision-world.json   the 10 thin-box world colliders (obb, world frame)
//   cameras.json           one evidence camera per place, on the face normal
//   review-manifest.json   triangles/budgets/build chain
//
// Contract inputs: kit/out/sidefaces/{skins,faces.json} + kit/gable-skin.config.json.
// Run: node scripts/build_sidefaces_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(root, 'kit/out/sidefaces');
const OUT = resolve(root, 'world/street-sidefaces');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const cfg = JSON.parse(await readFile(resolve(root, 'kit/gable-skin.config.json'), 'utf8'));
const faces = JSON.parse(await readFile(resolve(KIT, 'faces.json'), 'utf8'));

await mkdir(resolve(OUT, 'skins'), { recursive: true });

const skins = [];
for (const f of faces.faces) {
  const src = resolve(KIT, 'skins', `${f.faceId}.glb`);
  const bytes = await readFile(src);
  if (sha(bytes) !== f.sha256) throw new Error(`skin ${f.faceId} drifted from its build record`);
  await copyFile(src, resolve(OUT, 'skins', `${f.faceId}.glb`));
  const target = cfg.targets.find((t) => t.id === f.target);
  skins.push({
    id: f.faceId, glb: `./world/street-sidefaces/skins/${f.faceId}.glb`,
    bytes: bytes.byteLength, sha256: sha(bytes), triangles: f.tris,
    kind: f.kind, module: f.module, moduleRecord: f.rec,
    bakedPlacement: target.placement,
    place: target.id,
  });
}

const instances = {
  axis: 'glTF Y-up; skins are authored in WORLD coordinates (the module instance placement is baked in); identity placement at load time',
  instances: skins.map((s) => ({
    id: `skin-${s.id}`, module: `sideface-${s.id}`,
    positionGlb: [0, 0, 0], rotationYRad: 0,
    bakedFrom: { module: s.module, placement: s.bakedPlacement },
  })),
};
await writeFile(resolve(OUT, 'instances.json'), JSON.stringify(instances, null, 2) + '\n');

const collision = {
  axis: 'glTF Y-up; WORLD records — obbToWorld() reproduces every box',
  adapterFormat: 'obb {pos,theta,center,size} consumed by src/world/collisionAdapter.obbToWorld',
  dataset: 'street-sidefaces',
  instances: instances.instances,
  colliders: faces.colliders.map((c) => ({ ...c, type: 'box' })),
};
await writeFile(resolve(OUT, 'collision-world.json'), JSON.stringify(collision, null, 2) + '\n');

// --- evidence cameras: one per skin slab, self-calibrated along the outward
// normal — the largest distance in [6..1.5 m] whose eye->slab ray hits the
// slab FIRST among all colliders (delivered + skins). Lane-mouth slabs sit in
// a ~2 m gap, so the honest distance there is short; open gables get 6 m.
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
  all.push(...faces.colliders.map((c) => ({ ...c, type: 'box' })));
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
  const cameras = [];
  for (const place of cfg.targets) {
    const faceColliders = faces.colliders.filter((c) => c.name.startsWith(`gableskin:${place.module}`));
    for (const c of faceColliders) {
      const { pos, theta, center, size } = c.obb;
      const co = Math.cos(theta), si = Math.sin(theta);
      const wx = pos[0] + co * center[0] + si * center[2];
      const wz = pos[2] - si * center[0] + co * center[2];
      const [nx, nz] = c.outward;
      const target = [wx, 2.6, wz];
      let chosen = null;
      for (const dist of [6, 5, 4, 3, 2.5, 2, 1.5]) {
        const eye = [wx + nx * dist, 2.4, wz + nz * dist];
        const fh = firstHit(eye, target);
        if (fh.name === c.name) { chosen = { dist, eye }; break; }
      }
      if (!chosen) chosen = { dist: 1.5, eye: [wx + nx * 1.5, 2.4, wz + nz * 1.5] };
      const id = `skin-${place.id}-${faceColliders.indexOf(c)}`;
      cameras.push({
        id,
        positionGlb: chosen.eye.map((v) => +v.toFixed(3)),
        targetGlb: target.map((v) => +v.toFixed(3)),
        verticalFovDegrees: 55,
        calibratedDistanceM: chosen.dist,
        labelZh: `侧背面外皮取证 · ${place.id}（${c.name.replace('gableskin:', '')}）`,
        skinCollider: c.name,
      });
    }
  }
  await writeFile(resolve(OUT, 'cameras.json'),
    JSON.stringify({ framebuffer: [1280, 960],
      cameraPolicy: 'self-calibrated along the outward normal: largest distance whose ray hits the skin slab first (lane-mouth slabs sit inside ~2 m gaps)', cameras }, null, 2) + '\n');
  console.log(`SIDEFACES_DATASET_READY skins=${skins.length} tris=${skins.reduce((x, k) => x + k.triangles, 0)} `
    + `colliders=${collision.colliders.length} cameras=${cameras.length}`);
}

const manifest = {
  datasetId: 'street-sidefaces',
  title: '主街可见山墙/背面外皮补件（?skins=1 追加加载）',
  status: 'delivered_for_lead_review',
  ownerAdopted: false,
  visualReview: 'pending_lead',
  skins,
  placedTriangles: skins.reduce((s, k) => s + k.triangles, 0),
  budgets: { trisMax: 8000, perFaceTrisMax: 1500 },
  placementContract: 'skins baked in world coords from the module instance placements of world/fangbang-temple/instances.json (identical in fangbang-temple-v2); the page appends them at identity with ?skins=1',
  buildChain: 'scripts/find_visible_side_faces.mjs -> kit/gable-skin.config.json -> kit/build_gable_skins.py -> scripts/build_sidefaces_world.mjs',
  generatedBy: 'scripts/build_sidefaces_world.mjs',
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`SIDEFACES_DATASET_READY skins=${skins.length} tris=${manifest.placedTriangles} `
  + `colliders=${collision.colliders.length} (cameras written by the calibration block above)`);
