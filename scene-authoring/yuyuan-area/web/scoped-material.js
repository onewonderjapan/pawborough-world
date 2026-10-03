import * as THREE from 'three';

/**
 * Checks if a 2D/3D point's XZ lies inside a scope's boundsXZ.
 *
 * @param {{ x: number, z: number }} p
 * @param {{ boundsXZ: number[] }} scope
 * @returns {boolean}
 */
export function isPointInScope(p, scope) {
  if (!scope || !Array.isArray(scope.boundsXZ) || scope.boundsXZ.length < 4) return false;
  const sMinX = Math.min(scope.boundsXZ[0], scope.boundsXZ[2]);
  const sMaxX = Math.max(scope.boundsXZ[0], scope.boundsXZ[2]);
  const sMinZ = Math.min(scope.boundsXZ[1], scope.boundsXZ[3]);
  const sMaxZ = Math.max(scope.boundsXZ[1], scope.boundsXZ[3]);
  return p.x >= sMinX && p.x <= sMaxX && p.z >= sMinZ && p.z <= sMaxZ;
}

/**
 * Checks if all three vertices of a triangle in world XZ are contained
 * entirely within a SINGLE scope in the provided scopes list.
 * Any triangle crossing a scope boundary remains outside (false).
 *
 * @param {THREE.Vector3} p0
 * @param {THREE.Vector3} p1
 * @param {THREE.Vector3} p2
 * @param {Array<{ boundsXZ: number[] }>} scopes
 * @returns {boolean}
 */
export function isTriangleInScope(p0, p1, p2, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  for (let i = 0; i < scopes.length; i++) {
    const sc = scopes[i];
    if (isPointInScope(p0, sc) && isPointInScope(p1, sc) && isPointInScope(p2, sc)) {
      return true;
    }
  }
  return false;
}

/**
 * Creates a scoped cloned geometry for a batched mesh.
 * Triangles inside family.scopes receive projected procedural UVs
 * and are placed into group 1 (materialIndex 1).
 * Outside triangles preserve original properties/UVs in group 0 (materialIndex 0).
 *
 * Original GLB geometry and attributes are NEVER mutated.
 *
 * @param {THREE.Mesh} mesh
 * @param {Array<{ boundsXZ: number[] }>} scopes
 * @param {Object|Function} [options={}] - Optional options object or triangle predicate function
 * @param {Function} [options.trianglePredicate] - Optional predicate (info) => boolean
 * @returns {{
 *   applied: boolean,
 *   geometry: THREE.BufferGeometry|null,
 *   insideTriangleCount: number,
 *   outsideTriangleCount: number
 * }}
 */
export function createScopedGeometry(mesh, scopes, options = {}) {
  const emptyResult = {
    applied: false,
    geometry: null,
    insideTriangleCount: 0,
    outsideTriangleCount: 0
  };

  if (!mesh || !mesh.geometry) return emptyResult;
  const origGeom = mesh.geometry;

  let trianglePredicate = null;
  if (typeof options === 'function') {
    trianglePredicate = options;
  } else if (options && typeof options.trianglePredicate === 'function') {
    trianglePredicate = options.trianglePredicate;
  }

  // Ensure world matrix is up-to-date
  mesh.updateMatrixWorld(true);
  const matrix = mesh.matrixWorld || new THREE.Matrix4();

  // Convert to non-indexed clone so triangles have independent vertices (vertexdup),
  // preventing any UV or attribute pollution across scope boundaries.
  const clonedGeom = origGeom.index ? origGeom.toNonIndexed() : origGeom.clone();
  const vertCount = clonedGeom.attributes.position ? clonedGeom.attributes.position.count : 0;
  const triCount = Math.floor(vertCount / 3);

  if (triCount === 0) {
    clonedGeom.dispose();
    return emptyResult;
  }

  // Ensure UV attribute exists
  if (!clonedGeom.attributes.uv) {
    clonedGeom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertCount * 2), 2));
  }

  const posAttr = clonedGeom.attributes.position;
  const uvAttr = clonedGeom.attributes.uv;
  const colAttr = clonedGeom.attributes.color;

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const insideTriangles = [];
  const outsideTriangles = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = 3 * t;
    const i1 = 3 * t + 1;
    const i2 = 3 * t + 2;

    p0.fromBufferAttribute(posAttr, i0).applyMatrix4(matrix);
    p1.fromBufferAttribute(posAttr, i1).applyMatrix4(matrix);
    p2.fromBufferAttribute(posAttr, i2).applyMatrix4(matrix);

    let inScope = isTriangleInScope(p0, p1, p2, scopes);

    if (inScope && trianglePredicate) {
      e1.subVectors(p1, p0);
      e2.subVectors(p2, p0);
      normal.crossVectors(e1, e2).normalize();

      const c0 = colAttr ? [colAttr.getX(i0), colAttr.getY(i0), colAttr.getZ(i0)] : null;
      const c1 = colAttr ? [colAttr.getX(i1), colAttr.getY(i1), colAttr.getZ(i1)] : null;
      const c2 = colAttr ? [colAttr.getX(i2), colAttr.getY(i2), colAttr.getZ(i2)] : null;

      inScope = !!trianglePredicate({
        p0, p1, p2,
        normal,
        c0, c1, c2,
        triangleIndex: t,
        mesh
      });
    }

    if (inScope) {
      insideTriangles.push(t);

      // Procedural UV projection for inside triangles along dominant horizontal normal axis:
      // U = world x or z / 1.5, V = world y / 2.5
      e1.subVectors(p1, p0);
      e2.subVectors(p2, p0);
      normal.crossVectors(e1, e2);

      const useZ = Math.abs(normal.x) > Math.abs(normal.z);
      const u0 = (useZ ? p0.z : p0.x) / 1.5;
      const v0 = p0.y / 2.5;
      const u1 = (useZ ? p1.z : p1.x) / 1.5;
      const v1 = p1.y / 2.5;
      const u2 = (useZ ? p2.z : p2.x) / 1.5;
      const v2 = p2.y / 2.5;

      uvAttr.setXY(i0, u0, v0);
      uvAttr.setXY(i1, u1, v1);
      uvAttr.setXY(i2, u2, v2);
    } else {
      outsideTriangles.push(t);
      // Outside vertices keep their existing UVs (preserved by toNonIndexed)
    }
  }

  const insideCount = insideTriangles.length;
  const outsideCount = outsideTriangles.length;

  // If no inside triangles exist, do not modify geometry
  if (insideCount === 0) {
    clonedGeom.dispose();
    return {
      applied: false,
      geometry: null,
      insideTriangleCount: 0,
      outsideTriangleCount: triCount
    };
  }

  // Reorder indices into at most 2 contiguous groups:
  // [0, outsideCount * 3) -> group 0 (outside)
  // [outsideCount * 3, triCount * 3) -> group 1 (inside)
  const totalIndices = triCount * 3;
  const IndexArray = totalIndices > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(totalIndices);

  let ptr = 0;
  for (let i = 0; i < outsideCount; i++) {
    const t = outsideTriangles[i];
    indices[ptr++] = 3 * t;
    indices[ptr++] = 3 * t + 1;
    indices[ptr++] = 3 * t + 2;
  }
  for (let i = 0; i < insideCount; i++) {
    const t = insideTriangles[i];
    indices[ptr++] = 3 * t;
    indices[ptr++] = 3 * t + 1;
    indices[ptr++] = 3 * t + 2;
  }

  clonedGeom.setIndex(new THREE.BufferAttribute(indices, 1));
  clonedGeom.clearGroups();

  if (outsideCount > 0 && insideCount > 0) {
    clonedGeom.addGroup(0, outsideCount * 3, 0);
    clonedGeom.addGroup(outsideCount * 3, insideCount * 3, 1);
  } else if (outsideCount === 0) {
    clonedGeom.addGroup(0, insideCount * 3, 0);
  }

  clonedGeom.computeBoundingBox();
  clonedGeom.computeBoundingSphere();

  return {
    applied: true,
    geometry: clonedGeom,
    insideTriangleCount: insideCount,
    outsideTriangleCount: outsideCount
  };
}

/**
 * Applies scoped material to a mesh by creating cloned geometry with split groups.
 *
 * @param {THREE.Mesh} mesh
 * @param {Object} options
 * @param {Array<{ boundsXZ: number[] }>} options.scopes
 * @param {THREE.Material} options.insideMaterial
 * @param {THREE.Material} [options.outsideMaterial]
 * @param {Function} [options.trianglePredicate]
 * @returns {{
 *   applied: boolean,
 *   insideTriangleCount: number,
 *   outsideTriangleCount: number,
 *   restore: Function
 * }}
 */
export function applyScopedMaterial(mesh, { scopes, insideMaterial, outsideMaterial, trianglePredicate } = {}) {
  const origGeom = mesh.geometry;
  const origMat = mesh.material;

  const scoped = createScopedGeometry(mesh, scopes, { trianglePredicate });
  if (!scoped.applied) {
    return {
      applied: false,
      insideTriangleCount: 0,
      outsideTriangleCount: scoped.outsideTriangleCount,
      restore: () => {}
    };
  }

  const outMat = outsideMaterial || origMat;
  if (scoped.outsideTriangleCount > 0) {
    mesh.material = [outMat, insideMaterial];
  } else {
    mesh.material = [insideMaterial];
  }
  mesh.geometry = scoped.geometry;

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    mesh.geometry = origGeom;
    mesh.material = origMat;
    scoped.geometry.dispose();
  };

  return {
    applied: true,
    insideTriangleCount: scoped.insideTriangleCount,
    outsideTriangleCount: scoped.outsideTriangleCount,
    restore
  };
}
