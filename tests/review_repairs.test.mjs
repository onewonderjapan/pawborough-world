import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import { addWallCollider } from '../src/world/physics.js';
import { obbToWorld } from '../src/world/collisionAdapter.js';

const json = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
await R.init();
test('original ground-height wing-wall crossing is blocked on both sides', () => {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  try {
    for (const c of json('world/temple-axis-v3/collision-world.json').colliders) addWallCollider(R, w, c);
    w.step();
    for (const side of [-1, 1]) {
      const hit = w.castShape({ x: side * 2.4, y: 1.01, z: -27.085 },
        { x: 0, y: 0, z: 0, w: 1 }, { x: side, y: 0, z: 0 },
        new R.Capsule(.6, .35), 0, 1.3, true);
      assert.ok(hit, `visible ground-height wing wall ${side} must block capsule`);
    }
    assert.equal(w.castShape({ x: 0, y: 1.01, z: -27.085 },
      { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: -1 },
      new R.Capsule(.6, .35), 0, 1.3, true), null, 'central passage stays open');
  } finally { w.free(); }
});
test('every v4 AABB retains world-space vertical translation', () => {
  for (const c of json('world/fangbang-temple-v4/collision-world.json').colliders) {
    const o = obbToWorld(c);
    assert.ok(Math.abs(c.min[1] - (o.center[1] - o.halfExtents[1])) < 1e-5, c.name + ' minY');
    assert.ok(Math.abs(c.max[1] - (o.center[1] + o.halfExtents[1])) < 1e-5, c.name + ' maxY');
  }
});
test('bridge world blocks the same wing walls after temple placement', () => {
  const w = new R.World({ x: 0, y: 0, z: 0 });
  try {
    for (const c of json('world/fangbang-temple-v4/collision-world.json').colliders) addWallCollider(R, w, c);
    w.step();
    const c = Math.cos(.16703), s = Math.sin(.16703);
    for (const side of [-1, 1]) {
      const x=side*2.4, z=-27.085;
      const hit=w.castShape({x:-127.817+c*x+s*z,y:1.01,z:27.057-s*x+c*z},
        {x:0,y:Math.sin(.16703/2),z:0,w:Math.cos(.16703/2)},
        {x:c*side,y:0,z:-s*side},new R.Capsule(.6,.35),0,1.3,true);
      assert.ok(hit, `bridge ground wing ${side}`);
    }
    const strips=json('world/fangbang-temple-v4/collision-world.json').colliders.filter(r=>/^(westshops|eastshops)-strips:/.test(r.name));
    assert.equal(strips.length,8);
    for(const r of strips) assert.deepEqual([r.min[1],r.max[1]],[0,2.9],r.name);
  } finally { w.free(); }
});
