// Shared collision transform math — THE production definition of how a
// collision-world.json record becomes a world-space oriented box.
// Used identically by the browser (Rapier collider creation) and by node
// tests, so render, collision and tests can never disagree about axes,
// rotation or half-sizes.
//
// Record shape (world/collision-world.json), two supported forms:
//   a) { name, module, min, max, type: 'box',
//        obb: { pos: [x,y,z] world module origin, theta: yaw rad about +Y,
//               center: [x,y,z] module-local, size: [x,y,z] FULL size } }
//      — 201 module wall records, rotated with their instance.
//   b) { name, type: 'box', min, max } — 7 world-aligned seal walls (lane-A /
//      lane-B end walls, plaza walls...): derived as theta=0 from min/max.
//
// GLB axis: Y-up, X east, Z south. Heights start at ground y=0.

export function obbToWorld(record) {
  if (record.obb) {
    const { pos, theta, center, size } = record.obb;
    const c = Math.cos(theta), s = Math.sin(theta);
    // rotate module-local center by yaw about +Y, then translate to world
    const wx = pos[0] + c * center[0] + s * center[2];
    const wz = pos[2] - s * center[0] + c * center[2];
    return {
      center: [wx, center[1] + (pos[1] ?? 0), wz],
      halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2],
      yaw: theta,
    };
  }
  const { min, max } = record;
  if (!min || !max) throw new Error(`collider ${record.name}: neither obb nor min/max present`);
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    halfExtents: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
    yaw: 0,
  };
}

// Y-rotation matrix (column-major 4x4, WebGL convention).
export function yawMatrix(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

// Unit heading vector for walking yaw (0 = -Z "north into the street grid",
// matching THREE camera forward -Z).
export function headingVector(yaw) {
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}

// Conservative checks a WorldLoader performs on its JSON inputs before any
// physics exists. Throws with a precise message on the first inconsistency.
// blocks is a REQUIRED input: the block-lifecycle dataset must exist and be
// coherent, or the load fails — it must never degrade to a silently
// block-less scene (R3).
export function validateWorldInputs({ manifest, instances, collision, route, blocks }) {
  if (!manifest || !Array.isArray(manifest.modules) || manifest.modules.length === 0)
    throw new Error('world input: manifest.modules missing or empty');
  if (typeof manifest.placedTriangles !== 'number' || manifest.placedTriangles <= 0)
    throw new Error('world input: manifest.placedTriangles missing');
  if (!manifest.worldAssembly?.sha256) throw new Error('world input: manifest.worldAssembly.sha256 missing');

  if (!instances || !Array.isArray(instances.instances) || instances.instances.length === 0)
    throw new Error('world input: instances.instances missing or empty');
  const moduleIds = new Set(manifest.modules.map(m => m.id));
  for (const inst of instances.instances) {
    if (!moduleIds.has(inst.module))
      throw new Error(`world input: instance ${inst.id} references unknown module ${inst.module}`);
    if (!Array.isArray(inst.positionGlb) || inst.positionGlb.length !== 3)
      throw new Error(`world input: instance ${inst.id} positionGlb malformed`);
    if (typeof inst.rotationYRad !== 'number')
      throw new Error(`world input: instance ${inst.id} rotationYRad missing`);
  }

  if (!collision || !Array.isArray(collision.colliders) || collision.colliders.length === 0)
    throw new Error('world input: collision.colliders missing or empty');
  const instanceIds = new Set(instances.instances.map(i => i.id));
  for (const col of collision.colliders) {
    if (col.type !== 'box') throw new Error(`world input: collider ${col.name} type ${col.type} unsupported`);
    const hasObb = col.obb?.pos && col.obb?.center && col.obb?.size;
    const hasMinMax = Array.isArray(col.min) && Array.isArray(col.max);
    if (!hasObb && !hasMinMax)
      throw new Error(`world input: collider ${col.name} has neither obb nor min/max`);
    const instId = col.name.split(':')[0];
    if (hasObb && !instanceIds.has(instId))
      throw new Error(`world input: collider ${col.name} references unknown instance ${instId}`);
  }

  if (!route || !Array.isArray(route.mainStreet) || route.mainStreet.length < 2)
    throw new Error('world input: route.mainStreet missing or too short');
  if (!route.entries?.west) throw new Error('world input: route.entries.west missing');

  if (!blocks || !Array.isArray(blocks.blocks) || blocks.blocks.length === 0)
    throw new Error('world input: blocks.blocks missing or empty');
  if (!Array.isArray(blocks.placeholders))
    throw new Error('world input: blocks.placeholders missing');
  if (!Array.isArray(blocks.streetExtentX) || blocks.streetExtentX.length !== 2 ||
      !(blocks.streetExtentX[0] < blocks.streetExtentX[1]))
    throw new Error('world input: blocks.streetExtentX malformed');
  const placeholderIds = new Set(blocks.placeholders.map(p => p.id));
  const blockIds = new Set();
  for (const b of blocks.blocks) {
    if (!b.id || blockIds.has(b.id)) throw new Error(`world input: block id missing or duplicated (${b.id})`);
    blockIds.add(b.id);
    for (const phId of b.placeholderIds ?? []) {
      if (!placeholderIds.has(phId))
        throw new Error(`world input: block ${b.id} references unknown placeholder ${phId}`);
    }
    for (const baseId of b.replacesBaseIds ?? []) {
      if (!placeholderIds.has(baseId))
        throw new Error(`world input: block ${b.id} replaces unknown placeholder ${baseId}`);
    }
  }
  for (const ph of blocks.placeholders) {
    if (ph.replacedBy && !blockIds.has(ph.replacedBy))
      throw new Error(`world input: placeholder ${ph.id} replacedBy unknown block ${ph.replacedBy}`);
    if (!Array.isArray(ph.glbPoint) || ph.glbPoint.length !== 2 ||
        typeof ph.angleRad !== 'number' || !(ph.widthM > 0) || !(ph.depthM > 0) || !(ph.heightM > 0))
      throw new Error(`world input: placeholder ${ph.id} geometry malformed`);
  }
  if (!blocks.blocks.some(b => b.kind === 'reviewed'))
    throw new Error('world input: blocks dataset has no reviewed street block');
  return true;
}

// Ground meshes are the street-kit road/paving/stone faces verified by the
// lead review, plus (only in the lane-B candidate dataset) the derived lane
// floor node emitted by scripts/build_laneb_world.mjs. Nothing else qualifies
// — no invisible slab substitutes.
export const GROUND_NODE_RE = /^street-kit__(quiet-gray-asphalt|paving-frontage|worn-stone)$|^laneb__floor$/;
