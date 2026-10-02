import * as THREE from 'three';

/**
 * Strips trailing Blender numeric suffix (e.g., 'btk-wood.001' -> 'btk-wood').
 */
function stripBlenderSuffix(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\.\d+$/, '');
}

/**
 * Computes world-space Box3 for a mesh's geometry.
 */
function getMeshWorldBox(mesh) {
  if (!mesh.geometry) return null;
  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox();
  }
  if (!mesh.geometry.boundingBox) return null;
  return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
}

/**
 * Checks if a 3D box intersects any of the scopes defined in style.scopes.
 */
function isMeshInScope(box, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return true;
  for (const scope of scopes) {
    if (!Array.isArray(scope.boundsXZ) || scope.boundsXZ.length < 4) continue;
    const sMinX = Math.min(scope.boundsXZ[0], scope.boundsXZ[2]);
    const sMaxX = Math.max(scope.boundsXZ[0], scope.boundsXZ[2]);
    const sMinZ = Math.min(scope.boundsXZ[1], scope.boundsXZ[3]);
    const sMaxZ = Math.max(scope.boundsXZ[1], scope.boundsXZ[3]);

    if (box.max.x >= sMinX && box.min.x <= sMaxX &&
        box.max.z >= sMinZ && box.min.z <= sMaxZ) {
      return true;
    }
  }
  return false;
}

/**
 * Applies frozen world art material styles to the given root Three.js object.
 *
 * @param {THREE.Object3D} root - World root object (already transformed).
 * @param {Object} options
 * @param {Object} options.style - Frozen style config from world-art-style.json.
 * @param {Map} [options.sharedMaterials=new Map()] - Shared material cache across roots.
 * @returns {{ dispose: Function, stats: { matchedMeshes: number, uniqueVariants: number, appliedFamilies: string[] } }}
 */
export function applyWorldArtStyle(root, { style, sharedMaterials = new Map() } = {}) {
  const emptyStats = { matchedMeshes: 0, uniqueVariants: 0, appliedFamilies: [] };
  if (!root || !style || style.enabled === false) {
    return { dispose: () => {}, stats: emptyStats };
  }

  // Ensure world matrices are current
  if (root.updateMatrixWorld) {
    root.updateMatrixWorld(true);
  }

  // Build lookup map from base material name to family definition
  const familyByMatName = new Map();
  if (Array.isArray(style.families)) {
    for (const fam of style.families) {
      if (Array.isArray(fam.materialNames)) {
        for (const name of fam.materialNames) {
          if (!familyByMatName.has(name)) {
            familyByMatName.set(name, fam);
          }
        }
      }
    }
  }

  const ownedEntries = new Set();
  const meshRestorations = [];
  const appliedFamiliesSet = new Set();
  let matchedMeshCount = 0;

  root.traverse(obj => {
    // Skip non-mesh and SkinnedMesh
    if (!obj.isMesh || obj.isSkinnedMesh) return;
    if (!obj.geometry || !obj.material) return;

    // Compute mesh world XZ Box3 bounds
    const box = getMeshWorldBox(obj);
    if (!box) return;

    // Pilot scope check
    if (style.mode === 'pilot' || (style.scopes && style.scopes.length > 0)) {
      if (!isMeshInScope(box, style.scopes)) {
        return; // Out of scope
      }
    }

    const spanX = Math.abs(box.max.x - box.min.x);
    const spanZ = Math.abs(box.max.z - box.min.z);
    const maxMeshSpan = Math.max(spanX, spanZ);

    const isArray = Array.isArray(obj.material);
    const originalMats = isArray ? obj.material : [obj.material];
    let meshChanged = false;
    const targetMats = isArray ? obj.material.slice() : null;
    let singleTargetMat = null;

    for (let i = 0; i < originalMats.length; i++) {
      const origMat = originalMats[i];
      if (!origMat || typeof origMat.name !== 'string') continue;

      const baseName = stripBlenderSuffix(origMat.name);
      const family = familyByMatName.get(baseName);
      if (!family) continue; // Unknown material: skip

      // Skip mesh if XZ max span exceeds family limit
      if (typeof family.maxMeshSpanM === 'number' && maxMeshSpan > family.maxMeshSpanM) {
        continue;
      }

      // Shared cache key: original material UUID + style ID + family ID
      const styleId = style.id || '';
      const cacheKey = `${origMat.uuid}:${styleId}:${family.id}`;

      let entry = sharedMaterials.get(cacheKey);
      if (!entry) {
        // Clone original material
        const clone = origMat.clone();

        // Keep original properties unchanged
        clone.name = origMat.name;
        clone.opacity = origMat.opacity;
        clone.transparent = origMat.transparent;
        clone.map = origMat.map;

        // Frozen tint lerp
        if (origMat.color && clone.color && family.tint) {
          const blend = typeof family.colorBlend === 'number' ? family.colorBlend : 0;
          clone.color = origMat.color.clone().lerp(new THREE.Color(family.tint), blend);
        }

        // Frozen roughness / metalness
        if (typeof family.roughness === 'number' && 'roughness' in clone) {
          clone.roughness = family.roughness;
        }
        if (typeof family.metalness === 'number' && 'metalness' in clone) {
          clone.metalness = family.metalness;
        }

        entry = {
          material: clone,
          clone: clone,
          refCount: 0,
          key: cacheKey,
          family: family
        };
        sharedMaterials.set(cacheKey, entry);
      }

      // Increment reference count once per root application
      if (!ownedEntries.has(entry)) {
        entry.refCount++;
        ownedEntries.add(entry);
      }

      appliedFamiliesSet.add(family.id);
      meshChanged = true;

      if (isArray) {
        targetMats[i] = entry.material;
      } else {
        singleTargetMat = entry.material;
      }
    }

    if (meshChanged) {
      meshRestorations.push({
        mesh: obj,
        originalMaterial: obj.material
      });

      if (isArray) {
        obj.material = targetMats; // New array without mutating original
      } else {
        obj.material = singleTargetMat;
      }
      matchedMeshCount++;
    }
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;

    // Restore exact original material references on all affected meshes
    for (const record of meshRestorations) {
      record.mesh.material = record.originalMaterial;
    }
    meshRestorations.length = 0;

    // Decrement reference count on owned entries and dispose only when last root releases
    for (const entry of ownedEntries) {
      entry.refCount--;
      if (entry.refCount <= 0) {
        if (entry.material && typeof entry.material.dispose === 'function') {
          entry.material.dispose();
        }
        sharedMaterials.delete(entry.key);
      }
    }
    ownedEntries.clear();
  };

  const stats = {
    matchedMeshes: matchedMeshCount,
    uniqueVariants: ownedEntries.size,
    appliedFamilies: Array.from(appliedFamiliesSet)
  };

  return { dispose, stats };
}
