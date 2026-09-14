// East-edge candidate world: build the derived dataset that replaces the real
// shop-128 / shop-129 placeholders with the two refined standalone GLBs.
//
// Replacement rides the existing block contract: the two placeholders get
// replacedBy = "block-east-edge-shops" (suppression is evaluated by
// BlockManager at load time, so applying the block hides the gray boxes AND
// their collision, revoking restores both). The refined assets load at
// runtime through blockViews.makeAssets — nothing is merged into
// street-reviewed.glb, so each standalone GLB carries its own embedded
// textures: the manifest records the honest combined download bytes and the
// unique-image count across assets (no runtime auto-sharing is claimed).
//
// Derived only: world/*.json frozen inputs are read, never written. Cameras
// C0/C1 come from the task package CAMERAS.json (C0 = measured cruise-end
// original direction; no flattering re-angling).
//
// Run: node scripts/build_eastedge_world.mjs
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'world/east-edge');
const SPEC = '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/east-edge-design-20260914/DESIGN_SPEC.json';
const CAMERAS_SPEC = '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/east-edge-design-20260914/CAMERAS.json';
const BLOCK_ID = 'block-east-edge-shops';

const sha = (u8) => createHash('sha256').update(u8).digest('hex');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

await mkdir(OUT, { recursive: true });

const spec = await readJson(SPEC);
const specSha = sha(await readFile(SPEC));
const camsSpec = await readJson(CAMERAS_SPEC);
const buildings = spec.buildings;
if (buildings.length !== 2) throw new Error(`expected 2 buildings in DESIGN_SPEC, got ${buildings.length}`);

// ---- per-asset files: GLB + world-space collision sidecar ----------------
const assets = [];
for (const b of buildings) {
  const src = resolve(root, `kit/out/${b.id}`);
  const dst = resolve(OUT, b.id);
  await mkdir(dst, { recursive: true });
  const glbBytes = await readFile(resolve(src, 'model.glb'));
  const local = await readJson(resolve(src, 'collision.json'));
  const measurements = await readJson(resolve(src, 'measurements.json'));
  await copyFile(resolve(src, 'model.glb'), resolve(dst, 'model.glb'));
  await copyFile(resolve(src, 'collision.json'), resolve(dst, 'collision-local.json'));

  const [ox, oy, oz] = b.frontOriginXYZ;
  const theta = b.yawRad;
  const c = Math.cos(theta), s = Math.sin(theta);
  const colliders = local.colliders.map((col) => {
    if (col.type !== 'box') throw new Error(`asset ${b.id}: unsupported collider type ${col.type}`);
    const [cx, cy, cz] = col.center;
    const [sx, sy, sz] = col.size;
    // world-space obb: local center rotated by yaw about +Y, then translated
    // to the asset origin (same math as collisionAdapter.obbToWorld consumes)
    const wx = ox + c * cx + s * cz;
    const wz = oz - s * cx + c * cz;
    // conservative world AABB from the four rotated footprint corners
    const corners = [[sx / 2, sz / 2], [sx / 2, -sz / 2], [-sx / 2, sz / 2], [-sx / 2, -sz / 2]]
      .map(([lx, lz]) => [c * lx + s * lz, -s * lx + c * lz]);
    const hx = Math.max(...corners.map(p => Math.abs(p[0])));
    const hz = Math.max(...corners.map(p => Math.abs(p[1])));
    return {
      name: `${b.id}:${col.name}`, module: b.id, type: 'box',
      min: [+(wx - hx).toFixed(4), +(oy + cy - sy / 2).toFixed(4), +(wz - hz).toFixed(4)],
      max: [+(wx + hx).toFixed(4), +(oy + cy + sy / 2).toFixed(4), +(wz + hz).toFixed(4)],
      obb: { pos: [+ox.toFixed(6), +oy.toFixed(6), +oz.toFixed(6)], theta, center: col.center, size: col.size },
    };
  });
  const sidecar = {
    axis: 'glTF Y-up; obb.pos = asset front-wall origin (world), theta = yawRad; center/size = asset-local',
    assetId: b.id,
    replacesBaseIds: b.replacesBaseIds,
    origin: b.frontOriginXYZ, yawRad: b.yawRad,
    doors: local.doors,
    colliders,
    noGroundCollider: true,
    notIntegratedOrWalkingTested: true,
  };
  await writeFile(resolve(dst, 'collision.json'), JSON.stringify(sidecar, null, 2) + '\n');
  assets.push({
    id: b.id,
    glb: `./world/east-edge/${b.id}/model.glb`,
    collision: `./world/east-edge/${b.id}/collision.json`,
    positionGlb: b.frontOriginXYZ,
    rotationYRad: b.yawRad,
    replacesBaseIds: b.replacesBaseIds,
    bytes: glbBytes.byteLength,
    sha256: sha(glbBytes),
    triangles: measurements.triangles,
  });
}
const assetBytes = assets.reduce((t, a) => t + a.bytes, 0);
if (assetBytes > 5_000_000) throw new Error(`combined asset bytes ${assetBytes} exceed the 5MB budget`);
if (assets.reduce((t, a) => t + a.triangles, 0) > 24_000) throw new Error('combined triangle budget exceeded');

// ---- blocks.json: same layout, two placeholders replaced by the block -----
const blocks = await readJson(resolve(root, 'world/blocks.json'));
for (const ph of blocks.placeholders) {
  if (assets.some(a => a.replacesBaseIds.includes(ph.id))) {
    if (ph.replacedBy && ph.replacedBy !== BLOCK_ID) throw new Error(`placeholder ${ph.id} already replaced by ${ph.replacedBy}`);
    ph.replacedBy = BLOCK_ID;
  }
}
if (blocks.blocks.some(b => b.id === BLOCK_ID)) throw new Error(`${BLOCK_ID} already present`);
blocks.blocks.push({
  id: BLOCK_ID,
  kind: 'assets',
  replacesBaseIds: assets.flatMap(a => a.replacesBaseIds).sort(),
  autoApply: true,
  assets: assets.map(({ id, glb, collision, positionGlb, rotationYRad }) =>
    ({ id, glb, collision, positionGlb, rotationYRad })),
  persistent: false,
});
blocks.generatedBy = 'scripts/build_eastedge_world.mjs (derived candidate; frozen world/blocks.json untouched)';
await writeFile(resolve(OUT, 'blocks.json'), JSON.stringify(blocks, null, 2) + '\n');

// ---- manifest: frozen assembly stays; assets recorded honestly ------------
const manifest = await readJson(resolve(root, 'world/review-manifest.json'));
manifest.generatedBy = 'scripts/build_eastedge_world.mjs (derived candidate; frozen dataset untouched)';
manifest.worldAssembly = { ...manifest.worldAssembly, path: './world/street-reviewed.glb' };
manifest.eastEdgeAssets = {
  blockId: BLOCK_ID,
  assets,
  combinedDownloadBytes: assetBytes,
  combinedTriangleCount: assets.reduce((t, a) => t + a.triangles, 0),
  runtimeTextureSharing: 'none claimed — standalone GLBs embed their own image copies; unique images by content sha are counted in evidence',
  designSpec: { path: SPEC, sha256: specSha, snapshot: './design-spec.snapshot.json' },
};
await writeFile(resolve(OUT, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(SPEC, resolve(OUT, 'design-spec.snapshot.json'));

// ---- frozen pass-through inputs ------------------------------------------
for (const f of ['instances.json', 'collision-world.json', 'route.json']) {
  await copyFile(resolve(root, `world/${f}`), resolve(OUT, f));
}

// ---- cameras: frozen views + C0/C1 + per-building front/west --------------
const cameras = await readJson(resolve(root, 'world/cameras.json'));
const c0 = camsSpec.C0;
const c1 = camsSpec.C1;
// C1 pins a 45deg VERTICAL fov at its 1280x720 framebuffer; the app derives
// fov from lens/sensor at the live aspect, so convert once for sensor 36 H-fit
const aspect = c1.framebuffer[0] / c1.framebuffer[1];
const halfTanV = Math.tan(c1.verticalFovDegrees * Math.PI / 360);
const lensC1 = 18 / (halfTanV * aspect);
const H = (v) => v.map(x => +x.toFixed(4));
cameras.cameras.push(
  {
    id: 'east-czero', positionGlb: H(c0.position), targetGlb: H(c0.target),
    lensMm: c0.blenderLensMMForHorizontalFit, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    source: 'CAMERAS.json C0: measured cruise-end original direction; comparison camera, not a display angle',
  },
  {
    id: 'east-cone', positionGlb: H(c1.position), targetGlb: H(c1.target),
    lensMm: +lensC1.toFixed(3), sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
    source: 'CAMERAS.json C1: separate 3/4 display view; must not pose as the original cruise line',
  },
);
for (const b of buildings) {
  const [ox, , oz] = b.frontOriginXYZ;
  const theta = b.yawRad;
  const [sx, sz] = [Math.sin(theta), Math.cos(theta)];   // facade outward normal (world XZ)
  const [tx, tz] = [Math.cos(theta), -Math.sin(theta)];  // facade tangent (local +X)
  const depth = b.sourcePlaceholder.depthM;
  const cx = ox - sx * depth / 2, cz = oz - sz * depth / 2; // footprint centre = glbPoint
  if (Math.hypot(cx - b.sourcePlaceholder.glbPoint[0], cz - b.sourcePlaceholder.glbPoint[1]) > 0.01)
    throw new Error(`${b.id}: front origin transform does not reproduce the placeholder footprint centre`);
  const westSign = b.dominantSideFromC0.localX > 0 ? 1 : -1;
  const [wx, wz] = [Math.cos(theta) * westSign, -Math.sin(theta) * westSign]; // west gable outward
  const width = b.sourcePlaceholder.widthM;
  const gx = cx + wx * width / 2, gz = cz + wz * width / 2; // west gable mid-point
  // West views stand in the two open pockets that actually exist next to the
  // site (checked clear of the reviewed street mass and of the neighbour):
  // E128 from the south-east pocket past E129's corner, E129 from the open
  // ground south of the street end. Front views are alley-mouth near shots —
  // the facades face each other across a ~3m alley, no open straight-on front.
  const westCam = b.id.endsWith('128') ? [82.58, 3.4, 7.81] : [77.5, 5.5, 24.0];
  cameras.cameras.push(
    {
      id: `east-front-${b.id.endsWith('128') ? 'a' : 'b'}`,
      positionGlb: H([ox + tx * -2.6 + sx * 3.8, 1.7, oz + tz * -2.6 + sz * 3.8]),
      targetGlb: H([ox, 2.4, oz]),
      lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
      source: `design evidence view: ${b.id} storefront near view from the alley mouth (facades face each other; no open straight-on front exists)`,
    },
    {
      id: `east-west-${b.id.endsWith('128') ? 'a' : 'b'}`,
      positionGlb: H(westCam),
      targetGlb: H([gx, 5.2, gz]),
      lensMm: 35, sensorWidthMm: 36, sensorFit: 'HORIZONTAL',
      source: `design evidence view: ${b.id} west gable from the site's open pocket (the side C0 actually sees); full square-on elevation in the Blender evidence set`,
    },
  );
}
await writeFile(resolve(OUT, 'cameras.json'), JSON.stringify(cameras, null, 2) + '\n');

console.log('EASTEDGE_WORLD_READY', OUT);
console.log(`assets: ${assets.map(a => `${a.id} ${a.triangles}tris ${(a.bytes / 1e6).toFixed(2)}MB`).join(', ')}; combined ${(assetBytes / 1e6).toFixed(2)}MB`);
