// lane-b-polish batch tests — v7 candidate dataset integrity, B-scope budget
// targets, world-space collision sidecars (incl. the slanted funnel walls),
// threshold/clearance surface contracts measured from the exported GLBs,
// A-region identity between the v6 and v7 interfaces, and read-only-source
// guarantees. Runtime walk/perf evidence lives in
// tools/lane_b_polish_{walktest,runtime}.mjs artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFile(resolve(root, p));
const json = async (p) => JSON.parse(await read(p));

test('lane-b-polish: v7 manifest matches the real assembly and asset files', async () => {
  const m = await json('world/fangbang-temple-v7/review-manifest.json');
  const asm = await read('world/fangbang-temple-v7/street-reviewed-lanes.glb');
  assert.equal(asm.byteLength, m.worldAssembly.bytes);
  assert.equal(sha(asm), m.worldAssembly.sha256, 'assembly copied byte-exact from v6');
  assert.equal(m.placedTriangles, 171419);
  assert.equal(m.ownerAdopted, false);
  const blocks = await json('world/fangbang-temple-v7/blocks.json');
  const lanes = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
  assert.ok(lanes && lanes.autoApply);
  for (const a of lanes.assets) {
    const entry = m.lanesV2.assets.find((e) => e.id === a.id);
    assert.ok(entry, `asset ${a.id} missing from manifest.lanesV2`);
    const glb = await read(a.glb.replace('./', ''));
    assert.equal(sha(glb), entry.sha256, `${a.id} glb sha`);
    assert.equal(glb.byteLength, entry.bytes, `${a.id} glb bytes`);
    // manifest triangle records must equal the builder-measured sidecars
    if (a.glb.startsWith('./world/lane-b-polish/') || a.glb.startsWith('./world/lane-a-polish/')) {
      const side = await json(a.glb.replace('model.glb', 'measurements.json'));
      assert.equal(entry.triangles, side.triangles, `${a.id} triangles vs builder measurement`);
    }
  }
});

test('lane-b-polish: v7 budgets — B-scope targets + base ceiling, itemized', async () => {
  const m = await json('world/fangbang-temple-v7/review-manifest.json');
  const b = m.lanesV2.budgets;
  assert.ok(b.laneB.actual <= 4500, `lane-b ${b.laneB.actual} <= 4500`);
  assert.ok(b.interfaces.actual <= 1000, `interfaces ${b.interfaces.actual} <= 1000 (A part included)`);
  assert.equal(b.totalAdded, b.laneA.actual + b.laneB.actual + b.interfaces.actual);
  assert.ok(m.budgets.fullSceneV7Tris <= 700000, `page-default base ${m.budgets.fullSceneV7Tris} <= 700000`);
  // v7 replaced v6's lane-b-v2(8044)+interfaces(911) inside the same page total
  assert.equal(m.budgets.fullSceneV7Tris, 698704 - 8044 - 911 + b.laneB.actual + b.interfaces.actual);
});

test('lane-b-polish: skins+props all-on is a SEPARATE config, never claimed under the base ceiling', async () => {
  const cap = await json('artifacts/lane-b-polish/web-capture.json');
  const base = cap.budgets.base.triangles;
  const allOn = cap.budgets.skinsAndProps.triangles;
  assert.ok(base <= 700000, `runtime base ${base}`);
  assert.ok(allOn > base, 'all-on adds skins+props on top of base');
  assert.equal(base, 694430, 'runtime base equals the dataset accounting');
  assert.equal(allOn, 708066, 'all-on measured value (v6 was 712340; B scope reduced it by 4274)');
});

test('lane-b-polish: module sidecar is world-space obb; funnel colliders land on the wall lines', async () => {
  const side = await json('world/lane-b-polish/lane-b/collision.json');
  assert.equal(side.yawRad, -0.4818);
  assert.deepEqual(side.origin, [57.418, 0.09, 14.2485]);
  const names = side.colliders.map((r) => r.name);
  for (const n of ['lane-b:portal-pier-left', 'lane-b:portal-pier-right', 'lane-b:facade-east',
    'lane-b:pocket-wall-west', 'lane-b:back-facade', 'lane-b:funnel-east', 'lane-b:funnel-west'])
    assert.ok(names.includes(n), `${n} present`);
  // transform every obb to lane-local and check the funnel walls sit on their
  // design face lines (0.81,0)->(1.8,2.5) east, (-0.81,0)->(-1.8,3.5) west
  const toLocal = (r) => {
    const { pos, theta, center } = r.obb;
    const c = Math.cos(theta), s = Math.sin(theta);
    const wx = pos[0] + c * center[0] + s * center[2];
    const wz = pos[2] - s * center[0] + c * center[2];
    const CB = Math.cos(-0.4818), SB = Math.sin(-0.4818);
    return [CB * (wx - 57.418) - SB * (wz - 14.2485), SB * (wx - 57.418) + CB * (wz - 14.2485)];
  };
  const funE = side.colliders.find((r) => r.name === 'lane-b:funnel-east');
  const funW = side.colliders.find((r) => r.name === 'lane-b:funnel-west');
  const [ex, es] = toLocal(funE);
  const eLen = funE.obb.size[2], eTh = funE.obb.theta + 0.4818;   // wall angle in module frame
  // wall center should sit half-thickness OUTBOARD of the face-line midpoint
  const midE = [(0.81 + 1.8) / 2 + Math.cos(eTh) * 0.06, (0 + 2.5) / 2 - Math.sin(eTh) * 0.06];
  assert.ok(Math.hypot(ex - midE[0], es - midE[1]) < 0.02,
    `funnel-east center lane-local (${ex.toFixed(3)},${es.toFixed(3)}) vs design ${midE.map(v => v.toFixed(3))}`);
  const [wx, ws] = toLocal(funW);
  const wTh = funW.obb.theta + 0.4818;
  void wTh;
  // west wall normal (-0.962,-0.272): center = mid(face) + n*0.06
  const midWn = [(-0.81 - 1.8) / 2 + (-0.962) * 0.06, 3.5 / 2 + (-0.272) * 0.06];
  assert.ok(Math.hypot(wx - midWn[0], ws - midWn[1]) < 0.02,
    `funnel-west center lane-local (${wx.toFixed(3)},${ws.toFixed(3)}) vs design ${midWn.map(v => v.toFixed(3))}`);
});

test('lane-b-polish: B module threshold + drain rails <= floor + 0.02, portal clear kept', async () => {
  // measured from the exported GLB in world space (holder y=0.09): worst
  // walkable worn-stone top inside the portal band |ls| <= 0.20
  const { readGlb } = await import('../src/world/glbReader.js');
  const glb = readGlb(await read('world/lane-b-polish/lane-b/model.glb'));
  let worst = 0;
  for (const mesh of glb.meshes) {
    if (!/^lanes-v2__worn-stone$/.test(mesh.name)) continue;
    const p = mesh.positions, ix = mesh.indices;
    for (let i = 0; i < ix.length; i += 3) {
      for (const k of [ix[i], ix[i + 1], ix[i + 2]]) {
        const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
        if (Math.abs(z) <= 0.20 && Math.abs(x) <= 1.2) worst = Math.max(worst, 0.09 + y);
      }
    }
  }
  assert.ok(worst > 0.095, `a threshold/rail stone exists in the band (worst top ${worst})`);
  assert.ok(worst <= 0.09 + 0.02 + 1e-6, `portal threshold top ${worst} <= 0.11`);
  // portal clear width from the plaster piers: inner face planes at +-0.75
  // (box corner/edge vertices; y filter spans the full pier height)
  let minX = 1e9, maxX = -1e9;
  for (const mesh of glb.meshes) {
    if (!/^lanes-v2__weathered-lime-plaster$/.test(mesh.name)) continue;
    const p = mesh.positions;
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k], y = p[k + 1], z = p[k + 2];
      if (z > -0.14 && z < 0.04 && y > 0.0 && y < 2.7 && Math.abs(x) > 0.6 && Math.abs(x) < 0.95) {
        if (x > 0) minX = Math.min(minX, x);
        else maxX = Math.max(maxX, x);
      }
    }
  }
  assert.ok(Math.abs(minX - 0.75) < 0.02 && Math.abs(maxX + 0.75) < 0.02,
    `portal piers flank the 1.5 m clear opening (east ${minX.toFixed(3)}, west ${maxX.toFixed(3)})`);
});

test('lane-b-polish: clothesline cloth bottoms clear 2.2 m', async () => {
  const { readGlb } = await import('../src/world/glbReader.js');
  const glb = readGlb(await read('world/lane-b-polish/lane-b/model.glb'));
  let ymin = 1e9;
  let found = 0;
  for (const mesh of glb.meshes) {
    if (!/cotton$/.test(mesh.name)) continue;
    found++;
    for (let i = 0; i < mesh.positions.length; i += 3)
      ymin = Math.min(ymin, 0.09 + mesh.positions[i + 1]);
  }
  assert.equal(found, 2, 'two cloth pieces kept');
  assert.ok(ymin >= 2.2 - 1e-6, `cloth lowest vertex ${ymin.toFixed(3)} >= 2.2`);
});

test('lane-b-polish: interfaces A-region identical to v6 (vertices/UV/material per triangle)', async () => {
  // minimal GLB triangle extractor (positions + TEXCOORD_0 + material index,
  // node matrices applied) — readGlb does not expose UVs, and this check must
  // compare more than triangle counts
  const triSet = async (rel) => {
    const data = await read(rel);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let off = 12, js = null, binOff = 0;
    while (off < data.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4E4F534A) js = JSON.parse(data.subarray(off + 8, off + 8 + len).toString('utf8'));
      if (type === 0x004E4942) binOff = off + 8;
      off += 8 + len;
    }
    const acc = (idx) => {
      const a = js.accessors[idx], bv = js.bufferViews[a.bufferView];
      const comp = { 5126: 4, 5123: 2, 5125: 4 }[a.componentType];
      const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const base = binOff + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const stride = bv.byteStride || comp * n;
      const out = [];
      for (let i = 0; i < a.count; i++) {
        const o = base + i * stride;
        const v = [];
        for (let k = 0; k < n; k++)
          v.push(a.componentType === 5126 ? dv.getFloat32(o + k * 4, true)
            : a.componentType === 5123 ? dv.getUint16(o + k * 2, true) : dv.getUint32(o + k * 4, true));
        out.push(v);
      }
      return out;
    };
    const apply = (m, p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const mul = (a, b) => {
      const r = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += a[k * 4 + rr] * b[c * 4 + k];
        r[c * 4 + rr] = v;
      }
      return r;
    };
    const out = new Set();
    const walk = (ni, pm) => {
      const n = js.nodes[ni];
      const m = n.matrix ? mul(pm, n.matrix) : pm;   // TRS not used by these exports
      if (n.mesh !== undefined) {
        for (const prim of js.meshes[n.mesh].primitives) {
          const pos = acc(prim.attributes.POSITION);
          const uv = prim.attributes.TEXCOORD_0 !== undefined ? acc(prim.attributes.TEXCOORD_0) : null;
          const idx = acc(prim.indices);
          for (let i = 0; i < idx.length; i += 3) {
            const tri = [idx[i][0], idx[i + 1][0], idx[i + 2][0]];
            const vs = tri.map((k) => apply(m, pos[k]));
            if (!vs.every((v) => v[2] < -9.5)) continue;   // lane-A world region
            const key = [vs.flatMap((v) => v.map((q) => +q.toFixed(4))).join(','),
              uv ? tri.flatMap((k) => uv[k].map((q) => +q.toFixed(4))).join(',') : '',
              prim.material ?? -1].join('|');
            out.add(key);
          }
        }
      }
      for (const ch of n.children ?? []) walk(ch, m);
    };
    for (const root of js.scenes[0].nodes) walk(root, ident);
    return out;
  };
  const s6 = await triSet('world/lane-a-polish/interfaces/model.glb');
  const s7 = await triSet('world/lane-b-polish/interfaces/model.glb');
  assert.ok(s6.size > 600, `v6 A-region triangles present (${s6.size})`);
  assert.equal(s6.size, s7.size, `same A-region triangle count (${s6.size} vs ${s7.size})`);
  for (const k of s6) assert.ok(s7.has(k), `A-region triangle unchanged: ${k.slice(0, 60)}`);
  // A collision records identical (B records excluded by prefix)
  const c6 = (await json('world/lane-a-polish/interfaces/collision.json')).colliders.filter((r) => !r.name.startsWith('b-'));
  const c7 = (await json('world/lane-b-polish/interfaces/collision.json')).colliders.filter((r) => !r.name.startsWith('b-'));
  assert.deepEqual(c7, c6, 'A collision records byte-identical');
});

test('lane-b-polish: v7 blocks point only at the new B assets; v6/v5 sources untouched', async () => {
  const blocks = await json('world/fangbang-temple-v7/blocks.json');
  const lanes = blocks.blocks.find((b) => b.id === 'block-lanes-v2');
  const laneA = lanes.assets.find((a) => a.id === 'lane-a');
  const laneB = lanes.assets.find((a) => a.id === 'lane-b');
  const ifc = lanes.assets.find((a) => a.id === 'lanes-interfaces');
  assert.ok(laneA.glb.startsWith('./world/lane-a-polish/'), 'lane-a keeps its v6 asset');
  assert.ok(laneB.glb.startsWith('./world/lane-b-polish/'));
  assert.ok(ifc.glb.startsWith('./world/lane-b-polish/'));
  assert.deepEqual(laneB.positionGlb, [57.418, 0.09, 14.2485]);
  assert.equal(laneB.rotationYRad, -0.4818);
  assert.equal(lanes.assets.filter((a) => a.glb.includes('lanes-v2/lane-b')).length, 0,
    'the old broken B asset must not double-load');
  // the v6 dataset itself keeps pointing at the v5-era B (read-only source)
  const v6 = await json('world/fangbang-temple-v6/blocks.json');
  const v6Lanes = v6.blocks.find((b) => b.id === 'block-lanes-v2');
  assert.equal(v6Lanes.assets.find((a) => a.id === 'lane-b-v2').glb, './world/lanes-v2/lane-b-v2/model.glb');
  // lane-a bytes identical between the two datasets' references
  const a6 = await read('world/lane-a-polish/lane-a/model.glb');
  const m6 = await json('world/fangbang-temple-v6/review-manifest.json');
  const a6Entry = m6.lanesV2.assets.find((x) => x.id === 'lane-a');
  assert.equal(sha(a6), a6Entry.sha256, 'lane-a asset bytes unchanged');
});

test('lane-b-polish: walk + measure evidence artifacts exist and PASS', async () => {
  const walk = await json('artifacts/lane-b-polish/verify/walktest-v7.json');
  assert.equal(walk.coverage.misses, 0);
  assert.equal(walk.coverage.badY, 0);
  assert.ok(walk.coverage.samples >= 1000, `coverage samples ${walk.coverage.samples}`);
  for (const pr of walk.profiles) assert.ok(pr.pass, `profile ${pr.name} maxStep=${pr.maxStepM}`);
  const before = await json('artifacts/lane-b-polish/baseline/measure-before.json');
  assert.equal(before.fail, 5, 'baseline documents 5 failing checks on v6 (T1 transform agrees, defects proven)');
  assert.ok(before.checks.every((c) => c.id.startsWith('T')));
  const after = await json('artifacts/lane-b-polish/verify/measure-after.json');
  assert.equal(after.fail, 0, 'all six checks pass on v7');
});
