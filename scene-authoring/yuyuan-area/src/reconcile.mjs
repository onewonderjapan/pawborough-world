// 对账库：layout 对象/实例 <-> 实际导出 GLB 节点 的可执行对账。
// coverage.mjs（正常对账）与 tests/coverage-negative-test.mjs（负例）共用同一实现。
import fs from 'node:fs';

export function parseGlbJson(buf) {
  const jl = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
}

export function nodeNamesOf(glbJson) {
  return new Set((glbJson.nodes || []).map(n => n.name || ''));
}

// 期望清单：每个 layout 对象/实例要么在 GLB 有对应节点，要么有明确的"不在场原因"。
// 对象节点命名（build-scene/assemble 约定）：
//   程序化对象: `${zone}|${id}|${kind}|${lod}`（两层楼/庙堂另有 `...|roofpart`）
//   实例锚点:   锚 empty 名 = 实例 id（garden-gate / strow-* / shoprow-* / shopunit-* / temple-*）
export function buildExpectations(layout, proceduralStats) {
  const deferredMap = new Map((proceduralStats?.deferred || []).map(d => [d.id, d]));
  const expectations = [];
  const kindOf = {};
  for (const o of layout.objects) {
    kindOf[o.id] = o.kind;
    if (o.kind === 'ground' || o.kind === 'road') {
      // ground 单独节点；road 为 ribbon merged 节点；skipRender(并入九曲桥)必须缺席
      if (o.skipRender) expectations.push({ id: o.id, expect: 'absent', reason: o.reason || o.disposition });
      else expectations.push({ id: o.id, expect: 'present', match: (nm) => nm.includes(`|${o.id}|`) || nm.endsWith(`|${o.id}`) || nm === `${o.zone}|${o.id}|${o.kind}|${o.lod}` });
      continue;
    }
    if (o.kind === 'templeAnchor') {
      expectations.push({ id: o.id, expect: 'present', match: (nm) => nm === o.id || nm.startsWith(o.id + '.'), note: 'Blender 总装实例锚 empty' });
      continue;
    }
    if (o.kind === 'osmTempleOutline') {
      expectations.push({ id: o.id, expect: 'absent', reason: 'layout-only ground-source record (replaced-by-design, not extruded)' });
      continue;
    }
    if (o.kind === 'routeConstraint') {
      expectations.push({ id: o.id, expect: 'absent', reason: 'layout-only constraint record (not a renderable object)' });
      continue;
    }
    if (o.kind === 'shopAnchor' && o.id.startsWith('strow-') || o.kind === 'shopAnchor' && o.id.startsWith('shoprow-')) {
      expectations.push({ id: o.id, expect: 'present', match: (nm) => nm === o.id || nm.startsWith(o.id + '.'), note: '店屋实例锚（店面基面=连续铺装+模型自身，无独立垫座节点）' });
      continue;
    }
    // 其余（含 shopunit-* plinth / gateAnchor / facadeBay / 植物等）：按 zone|id| 节点匹配
    expectations.push({
      id: o.id, expect: 'present',
      match: (nm) => nm.includes(`|${o.id}|`) || nm === o.id || nm.startsWith(o.id + '.') ||
        (deferredMap.has(o.id) && false),
      deferredReason: deferredMap.get(o.id)?.why,
    });
  }
  // 实例锚点
  for (const inst of layout.instances) {
    expectations.push({ id: `instance:${inst.id}`, expect: 'present', match: (nm) => nm === inst.id || nm.startsWith(inst.id + '.') });
  }
  return expectations;
}

export function reconcile(expectations, names) {
  const missing = [], present = [];
  for (const e of expectations) {
    if (e.expect === 'absent') continue;
    let found = false;
    for (const nm of names) if (e.match(nm)) { found = true; break; }
    if (found) present.push(e.id);
    else missing.push({ id: e.id, hint: e.deferredReason || e.note || null });
  }
  const unexpectedPresent = [];
  for (const e of expectations) {
    if (e.expect !== 'absent') continue;
    for (const nm of names) {
      if (nm.includes(`|${e.id}|`) || nm === e.id || nm.startsWith(e.id + '.')) unexpectedPresent.push({ id: e.id, node: nm });
    }
  }
  return { expected: expectations.length, present: present.length, missing, unexpectedPresent };
}

// 三角计数：unique = mesh 级；placed = 节点层级实例化后
export function triangleCounts(glbJson) {
  const j = glbJson;
  const meshTris = (j.meshes || []).map(m => m.primitives.reduce((s, p) => {
    if (p.indices !== undefined) return s + Math.floor(j.accessors[p.indices].count / 3);
    return s + Math.floor(j.accessors[p.attributes.POSITION].count / 3);
  }, 0));
  const unique = meshTris.reduce((s, t) => s + t, 0);
  // 节点树遍历（scene 层级，含重复引用）
  const scenes = j.scenes || [{ nodes: (j.nodes || []).map((_, i) => i) }];
  let placed = 0;
  const visited = new Set();
  const walk = (ni) => {
    if (visited.has(ni)) return; // 防御循环引用；GLB 场景正常为树
    visited.add(ni);
    const n = j.nodes[ni];
    if (n && n.mesh !== undefined) placed += meshTris[n.mesh] || 0;
    for (const c of (n && n.children) || []) walk(c);
  };
  for (const s of scenes) for (const ni of (s.nodes || [])) walk(ni);
  return { unique, placed };
}
