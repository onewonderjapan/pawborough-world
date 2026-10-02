import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installStreetLife } from '../scene-authoring/yuyuan-area/web/street-life.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// 1. Manifest Validation & Strict Finite Bounds (manifestinvalidfinitefail)
test('manifest validation: null or invalid manifest throws', () => {
  const scene = new THREE.Scene();
  assert.throws(() => installStreetLife({ scene, manifest: null }), /Invalid manifest/);
  assert.throws(() => installStreetLife({ scene, manifest: {} }), /items must be an array/);
  assert.throws(() => installStreetLife({ scene, manifest: { items: 'bad' } }), /items must be an array/);
});

test('manifest validation: non-finite position coordinates throw (no magic fallback)', () => {
  const scene = new THREE.Scene();

  // NaN in x
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'item-1', sourceId: 's1', kind: 'lantern', position: [NaN, 1.2, 0] }
        ]
      }
    });
  }, /Non-finite position coordinate/);

  // Infinity in y
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'item-2', sourceId: 's1', kind: 'lantern', position: [0, Infinity, 0] }
        ]
      }
    });
  }, /Non-finite position coordinate/);

  // -Infinity in z
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'item-3', sourceId: 's1', kind: 'lantern', position: [0, 1.2, -Infinity] }
        ]
      }
    });
  }, /Non-finite position coordinate/);

  // Missing coordinate
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'item-4', sourceId: 's1', kind: 'lantern', position: [0, 1.2] }
        ]
      }
    });
  }, /Invalid position/);

  // Missing position entirely
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'item-5', sourceId: 's1', kind: 'lantern' }
        ]
      }
    });
  }, /Invalid position/);
});

test('manifest validation: duplicate item IDs throw strictly', () => {
  const scene = new THREE.Scene();
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'dup-1', sourceId: 's1', kind: 'lantern', position: [0, 1.2, 0] },
          { id: 'dup-1', sourceId: 's2', kind: 'lantern', position: [1, 1.2, 0] }
        ]
      }
    });
  }, /Duplicate item id/);
});

test('manifest validation: non-finite yaw throws strictly', () => {
  const scene = new THREE.Scene();
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'item-yaw', sourceId: 's1', kind: 'lantern', position: [0, 1.2, 0], yaw: NaN }
        ]
      }
    });
  }, /Non-finite yaw/);
});

test('manifest validation: unknown kind skips cleanly or errors clearly', () => {
  const scene = new THREE.Scene();
  // By default skips unknown kinds
  const owner = installStreetLife({
    scene,
    manifest: {
      items: [
        { id: 'good-1', sourceId: 's1', kind: 'lantern', position: [0, 2.5, 0] },
        { id: 'bad-kind', sourceId: 's2', kind: 'flying-carpet', position: [1, 2.5, 0] }
      ]
    }
  });
  assert.equal(owner.stats.items, 1, 'unknown kind was skipped without breaking valid items');
  owner.dispose();

  // If strictUnknown option is enabled, it throws a clear error
  assert.throws(() => {
    installStreetLife({
      scene,
      manifest: {
        items: [
          { id: 'bad-kind-strict', sourceId: 's2', kind: 'flying-carpet', position: [1, 2.5, 0] }
        ]
      },
      options: { strictUnknown: true }
    });
  }, /Unknown decoration kind/);
});

// 2. Owner Layer Group & Scene Preservation
test('owner layer: group contains only its meshes, raycast is noop, unrelated scene preserved', () => {
  const scene = new THREE.Scene();
  const unrelatedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  unrelatedMesh.name = 'stall-counter-1';
  scene.add(unrelatedMesh);

  const manifest = {
    items: [
      { id: 'sign-1', sourceId: 'stall-1', kind: 'vendor-sign', position: [0, 1.2, 0], yaw: 0, label: '小笼包', chapterId: 'ch1' },
      { id: 'lantern-1', sourceId: 'stall-1', kind: 'lantern', position: [0, 2.5, 0], yaw: 0 },
      { id: 'bunting-1', sourceId: 'stall-1', kind: 'bunting', position: [0, 2.3, 0], yaw: 0 },
      { id: 'flower-1', sourceId: 'stall-1', kind: 'counter-flower', position: [0, 0.9, 0], yaw: 0 }
    ]
  };

  const owner = installStreetLife({ scene, manifest });
  assert.equal(scene.children.length, 2, 'scene has unrelated mesh plus owner layer group');
  assert.equal(scene.children[1], owner.group, 'owner group was added to scene');

  // Verify all objects in owner layer have raycast = noop
  let objectCount = 0;
  owner.group.traverse(obj => {
    objectCount++;
    assert.equal(typeof obj.raycast, 'function');
    // Calling raycast should be a no-op (no side effects, no hits)
    const raycaster = new THREE.Raycaster();
    const intersects = [];
    obj.raycast(raycaster, intersects);
    assert.equal(intersects.length, 0, 'street-life object raycast must produce no intersects');
  });
  assert.ok(objectCount > 0, 'owner group contains decoration meshes');

  owner.dispose();
  assert.equal(scene.children.length, 1, 'owner group was removed from scene on dispose');
  assert.equal(scene.children[0], unrelatedMesh, 'unrelated mesh was preserved');
});

// 3. Shared Resources & Mesh Family Bounds (max 12 draw mesh families)
test('resource sharing: shared geometries and materials stay within draw family bounds (<= 12 families)', () => {
  const scene = new THREE.Scene();
  const items = [];

  // Generate 40 items (10 of each kind) across multiple stalls
  for (let i = 0; i < 10; i++) {
    items.push({ id: `sign-${i}`, sourceId: `s-${i}`, kind: 'vendor-sign', position: [i * 2, 1.2, 0], yaw: 0, label: `Stall ${i % 3}`, chapterId: 'ch1' });
    items.push({ id: `lantern-${i}`, sourceId: `s-${i}`, kind: 'lantern', position: [i * 2, 2.5, 0], yaw: 0 });
    items.push({ id: `bunting-${i}`, sourceId: `s-${i}`, kind: 'bunting', position: [i * 2, 2.4, 0], yaw: 0 });
    items.push({ id: `flower-${i}`, sourceId: `s-${i}`, kind: 'counter-flower', position: [i * 2, 0.9, 0], yaw: 0 });
  }

  const owner = installStreetLife({ scene, manifest: { items } });
  assert.equal(owner.stats.items, 40);

  // Count InstancedMesh families in owner layer
  let instancedMeshCount = 0;
  owner.group.traverse(obj => {
    if (obj.isInstancedMesh) {
      instancedMeshCount++;
    }
  });

  assert.ok(instancedMeshCount <= 12, `Instanced mesh families count ${instancedMeshCount} must be <= 12`);
  assert.ok(owner.stats.geometryCount < 20, `geometries are shared, not individually cloned (count: ${owner.stats.geometryCount})`);
  assert.ok(owner.stats.materialCount < 20, `materials are shared, not individually cloned (count: ${owner.stats.materialCount})`);

  owner.dispose();
});

// 4. Vendor Sign & Label Caching (reusedlabeltextureonce, makeLabelTexture injection, owned: false)
test('label texture caching: identical label reuses texture and disposes exactly once', () => {
  const scene = new THREE.Scene();
  let makeLabelCalls = 0;
  let labelDisposedCount = 0;

  const makeLabelTexture = ({ label, chapterId }) => {
    makeLabelCalls++;
    return {
      isTexture: true,
      label,
      chapterId,
      dispose() {
        labelDisposedCount++;
      }
    };
  };

  const manifest = {
    items: [
      { id: 'sign-a', sourceId: 's1', kind: 'vendor-sign', position: [0, 1.2, 0], label: '生煎馒头', chapterId: 'c1' },
      { id: 'sign-b', sourceId: 's2', kind: 'vendor-sign', position: [2, 1.2, 0], label: '生煎馒头', chapterId: 'c1' },
      { id: 'sign-c', sourceId: 's3', kind: 'vendor-sign', position: [4, 1.2, 0], label: '排骨年糕', chapterId: 'c1' }
    ]
  };

  const owner = installStreetLife({ scene, manifest, makeLabelTexture });

  // Two signs had the exact same label and chapterId, one had different
  assert.equal(makeLabelCalls, 2, 'makeLabelTexture called once per unique label/chapter pair');
  assert.equal(owner.stats.textureCount, 2, 'two unique owned textures tracked');

  owner.dispose();
  assert.equal(labelDisposedCount, 2, 'shared label texture disposed exactly once across multiple signs');
});

test('external unowned texture: descriptor { texture, owned: false } is not disposed', () => {
  const scene = new THREE.Scene();
  let externalDisposedCount = 0;

  const externalTexture = {
    isTexture: true,
    dispose() {
      externalDisposedCount++;
    }
  };

  const makeLabelTexture = ({ label, chapterId }) => {
    return {
      texture: externalTexture,
      owned: false
    };
  };

  const manifest = {
    items: [
      { id: 'sign-ext', sourceId: 's1', kind: 'vendor-sign', position: [0, 1.2, 0], label: '外置纹理', chapterId: 'c1' }
    ]
  };

  const owner = installStreetLife({ scene, manifest, makeLabelTexture });
  assert.equal(owner.stats.textureCount, 0, 'externally supplied texture is not counted as owned');

  owner.dispose();
  assert.equal(externalDisposedCount, 0, 'externally supplied unowned texture must not be disposed by street-life');
});

// 5. Lantern & PointLight Pooling (2lightmax / selection / paused no advance)
test('lantern lights: at most 2 PointLights pooled, no shadows, identity array preserved', () => {
  const scene = new THREE.Scene();
  const manifest = {
    items: [
      { id: 'lan-1', sourceId: 's-1', kind: 'lantern', position: [0, 2.5, 0] },
      { id: 'lan-2', sourceId: 's-2', kind: 'lantern', position: [10, 2.5, 0] },
      { id: 'lan-3', sourceId: 's-3', kind: 'lantern', position: [20, 2.5, 0] },
      { id: 'lan-4', sourceId: 's-4', kind: 'lantern', position: [30, 2.5, 0] }
    ]
  };

  const owner = installStreetLife({ scene, manifest });
  assert.equal(owner.stats.lightCount, 2, 'at most 2 PointLights pooled regardless of lantern count');
  assert.equal(owner.lanterns.length, 4, 'all 4 lanterns kept in identity array');
  assert.equal(owner.lanterns[0].sourceId, 's-1');
  assert.equal(owner.lanterns[0].position.x, 0);

  // Check light shadow setting
  const lights = [];
  owner.group.traverse(obj => {
    if (obj.isPointLight) {
      lights.push(obj);
      assert.equal(obj.castShadow, false, 'lantern lights must not cast shadows');
    }
  });
  assert.equal(lights.length, 2);

  // Day: intensity must be 0
  owner.update({ feet: [0, 0, 0], dt: 0.1, paused: false, timeOfDay: 'day' });
  assert.equal(lights[0].intensity, 0);
  assert.equal(lights[1].intensity, 0);

  // Night: lights assigned to nearest 2 lanterns (lan-1 at 0, lan-2 at 10)
  owner.update({ feet: [0, 0, 0], dt: 0.1, paused: false, timeOfDay: 'night' });
  assert.ok(lights[0].intensity > 0, 'lights on at night');
  assert.ok(lights[1].intensity > 0, 'lights on at night');
  assert.equal(lights[0].position.x, 0, 'light 0 at lan-1');
  assert.equal(lights[1].position.x, 10, 'light 1 at lan-2');

  // Throttling: advancing dt by 0.1 (< 0.5s) to far location should NOT reassign nearest lights yet
  owner.update({ feet: [30, 0, 0], dt: 0.1, paused: false, timeOfDay: 'night' });
  assert.equal(lights[0].position.x, 0, 'light 0 still at lan-1 due to 0.5s throttle');
  assert.equal(lights[1].position.x, 10, 'light 1 still at lan-2 due to 0.5s throttle');

  // Advancing beyond 0.5s total: should reassign to lan-4 (at 30) and lan-3 (at 20)
  owner.update({ feet: [30, 0, 0], dt: 0.45, paused: false, timeOfDay: 'night' });
  assert.equal(lights[0].position.x, 30, 'light 0 moved to nearest lan-4');
  assert.equal(lights[1].position.x, 20, 'light 1 moved to nearest lan-3');

  // Paused: dt advances must NOT update clock or reassign lights
  owner.update({ feet: [0, 0, 0], dt: 1.0, paused: true, timeOfDay: 'night' });
  assert.equal(lights[0].position.x, 30, 'light position frozen while paused');
  assert.equal(lights[1].position.x, 20, 'light position frozen while paused');

  owner.dispose();
});

// 6. Owner Unload Twice / Idempotent Resource Disposal (ownerunload twice disposes ownedresources exactlyonce)
test('owner unload twice: disposes owned resources exactly once and preserves stats', () => {
  const scene = new THREE.Scene();
  let labelDisposeCount = 0;

  const makeLabelTexture = () => ({
    isTexture: true,
    dispose() {
      labelDisposeCount++;
    }
  });

  const manifest = {
    items: [
      { id: 's1', sourceId: 'src-1', kind: 'vendor-sign', position: [0, 1.2, 0], label: '测试', chapterId: 'c1' },
      { id: 'l1', sourceId: 'src-2', kind: 'lantern', position: [0, 2.5, 0] },
      { id: 'b1', sourceId: 'src-3', kind: 'bunting', position: [0, 2.3, 0] },
      { id: 'f1', sourceId: 'src-4', kind: 'counter-flower', position: [0, 0.9, 0] }
    ]
  };

  const owner = installStreetLife({ scene, manifest, makeLabelTexture });
  const initialStats = { ...owner.stats };

  assert.equal(owner.stats.items, 4);
  assert.ok(owner.stats.geometryCount > 0);
  assert.ok(owner.stats.materialCount > 0);
  assert.equal(owner.stats.textureCount, 1);
  assert.equal(owner.stats.lightCount, 1); // 1 lantern -> 1 light
  assert.deepEqual(owner.stats.sourceIds, ['src-1', 'src-2', 'src-3', 'src-4']);

  // First unload
  owner.dispose();
  assert.equal(labelDisposeCount, 1, 'texture disposed once');
  assert.equal(owner.group.parent, null, 'group detached from scene');

  // Second unload must be a strict no-op
  owner.dispose();
  assert.equal(labelDisposeCount, 1, 'texture was NOT disposed a second time');

  // Stats remain readable after unload
  assert.equal(owner.stats.items, initialStats.items);
  assert.equal(owner.stats.geometryCount, initialStats.geometryCount);
  assert.equal(owner.stats.materialCount, initialStats.materialCount);
  assert.equal(owner.stats.textureCount, initialStats.textureCount);
  assert.equal(owner.stats.lightCount, initialStats.lightCount);
});

console.log(`\nALL ${passed} PLAY_STREET_LIFE TESTS PASSED`);
