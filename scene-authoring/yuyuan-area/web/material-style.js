import * as THREE from 'three';
import {
  retainGlassDepthTexture,
  releaseGlassDepthTexture,
  retainLacquerTexture,
  releaseLacquerTexture,
  disposeWorldArtPilotTextures
} from './world-art-pilot.js';
import { createScopedGeometry } from './scoped-material.js';

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
    if (typeof mesh.geometry.computeBoundingBox === 'function') {
      mesh.geometry.computeBoundingBox();
    }
  }
  if (!mesh.geometry.boundingBox) return null;
  const matrix = mesh.matrixWorld || new THREE.Matrix4();
  return mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
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
  let totalInsideTriangles = 0;

  root.traverse(obj => {
    // Skip non-mesh and SkinnedMesh
    if (!obj.isMesh || obj.isSkinnedMesh) return;
    if (!obj.geometry || !obj.material) return;

    // Compute mesh world XZ Box3 bounds
    const box = getMeshWorldBox(obj);
    if (!box) return;

    // Global style-level pilot scope check
    if (style.mode === 'pilot' || (Array.isArray(style.scopes) && style.scopes.length > 0)) {
      if (!isMeshInScope(box, style.scopes)) {
        return; // Out of global scope
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
      if (family.matchMeshNames && !family.matchMeshNames.includes(obj.name)) continue;

      // Family-level scopes check (incremental pilot per family)
      const hasFamilyScopes = Array.isArray(family.scopes) && family.scopes.length > 0;
      if (hasFamilyScopes) {
        if (!isMeshInScope(box, family.scopes)) {
          continue; // Mesh outside this family's allowed scopes
        }
      }

      // Check maxMeshSpanM
      const exceedsSpan = typeof family.maxMeshSpanM === 'number' && maxMeshSpan > family.maxMeshSpanM;
      if (exceedsSpan) {
        // If family has no scopes, skip large mesh (baseline global protection)
        if (!hasFamilyScopes) {
          continue;
        }
        // Batched mesh with family.scopes: support mesh span > limit only if single material and no existing groups
        if (isArray || (obj.geometry.groups && obj.geometry.groups.length > 0)) {
          continue;
        }
      }

      // Resolve actual eligible triangles before retaining shared resources.
      const split = hasFamilyScopes && (exceedsSpan || family.triangleColor || family.preciseScope);
      let scoped = null;
      if (split) {
        if (isArray || obj.geometry.groups.length) continue;
        const trianglePredicate = family.triangleColor ? ({ c0, c1, c2, p0, p1, p2, normal }) =>
          Math.abs(normal.y) < 0.2 && [p0,p1,p2].every(p => p.y >= 0.15 && p.y <= 2.25) &&
          [c0,c1,c2].every(c => c && c.every((v,k) => Math.abs(v-family.triangleColor[k]) <= (family.colorTolerance ?? 0.006))) : null;
        scoped = createScopedGeometry(obj, family.scopes, { trianglePredicate });
        if (!scoped.applied) continue;
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

        // Procedural depth/backing for glass and closed doors if original has no map
        let proceduralType = null;
        if (!origMat.map) {
          if (family.id === 'shop-glass' || family.proceduralTexture === 'shop-glass') {
            clone.map = retainGlassDepthTexture();
            proceduralType = 'shop-glass';
            if (family.id === 'center-window-pilot' || family.triangleColor) { clone.vertexColors = false; clone.color.set('#f1f1ed'); }
          } else if (family.id === 'closed-door-lacquer') {
            clone.map = retainLacquerTexture();
            proceduralType = 'closed-door-lacquer';
            // 避黑上加黑：带程序漆木 map 时，inside clone.color 用中性/温暖较亮 base，夜灯仍原光照
            clone.color = new THREE.Color('#d8c8b8');
          }
        }

        entry = {
          material: clone,
          clone: clone,
          refCount: 0,
          key: cacheKey,
          family: family,
          proceduralType
        };
        sharedMaterials.set(cacheKey, entry);
      }

      if (scoped) {

        if (!ownedEntries.has(entry)) {
          entry.refCount++;
          ownedEntries.add(entry);
        }

        appliedFamiliesSet.add(family.id);
        totalInsideTriangles += scoped.insideTriangleCount;
        matchedMeshCount++;

        meshRestorations.push({
          mesh: obj,
          originalMaterial: origMat,
          originalGeometry: obj.geometry,
          clonedGeometry: scoped.geometry
        });

        if (scoped.outsideTriangleCount > 0) {
          obj.material = [origMat, entry.material];
        } else {
          obj.material = [entry.material];
        }
        obj.geometry = scoped.geometry;
        meshChanged = false; // Already applied and recorded
        break; // Single-material batched mesh finished
      }

      // Increment reference count once per root application
      if (!ownedEntries.has(entry)) {
        entry.refCount++;
        ownedEntries.add(entry);
      }

      appliedFamiliesSet.add(family.id);
      meshChanged = true;

      // Track inside triangle count for small mesh
      const triCount = obj.geometry.index ? (obj.geometry.index.count / 3) : (obj.geometry.attributes.position ? obj.geometry.attributes.position.count / 3 : 0);
      totalInsideTriangles += triCount;

      if (isArray) {
        targetMats[i] = entry.material;
      } else {
        singleTargetMat = entry.material;
      }
    }

    if (meshChanged) {
      meshRestorations.push({
        mesh: obj,
        originalMaterial: obj.material,
        originalGeometry: null,
        clonedGeometry: null
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

    // Restore exact original material and geometry references on all affected meshes
    for (const record of meshRestorations) {
      record.mesh.material = record.originalMaterial;
      if (record.clonedGeometry) {
        record.mesh.geometry = record.originalGeometry;
        record.clonedGeometry.dispose();
      }
    }
    meshRestorations.length = 0;

    // Decrement reference count on owned entries and dispose only when last root releases
    for (const entry of ownedEntries) {
      entry.refCount--;
      if (entry.refCount <= 0) {
        if (entry.material && typeof entry.material.dispose === 'function') {
          entry.material.dispose();
        }
        if (entry.proceduralType === 'shop-glass') {
          releaseGlassDepthTexture();
        } else if (entry.proceduralType === 'closed-door-lacquer') {
          releaseLacquerTexture();
        }
        sharedMaterials.delete(entry.key);
      }
    }
    ownedEntries.clear();
  };

  const stats = {
    matchedMeshes: matchedMeshCount,
    uniqueVariants: ownedEntries.size,
    appliedFamilies: Array.from(appliedFamiliesSet),
    insideTriangleCount: totalInsideTriangles
  };

  return { dispose, stats };
}
