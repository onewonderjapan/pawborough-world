// G4 出口一验收工具：两个 runtime 目录的 zone GLB 三角形级几何对账 + G1 稳定身份审计。
//   parity   ：逐分件比较三角形多重集（世界坐标量化 1e-4 m，winding 保留）。hash 不同不再允许
//              宽泛 SKIP —— 必须给出具体证据：三角形多重集是否一致、节点名集合差在哪、逐 prim 计数差在哪。
//              用生产碰撞链同一 readGlb（src/world/glbReader.js），不吃任何中间格式。
//   identity ：G1 稳定 facade 身份在当版 runtime 的完整性：175 个 bazaar|<newId>|facadeBay|L1 节点、
//              extras 携带 id/legacyId/doorVariant、与 baseline/layout.json 双向一一对应、id 全局唯一。
//   selftest ：工具自身微型正/负例（不触碰真实产物、不做全域遍历）。
// 比较口径（重要）：非 bay 节点按名字逐节点比较；175 个 facadeBay 节点不做任何「旧 id → 新 id」改名映射 ——
//   旧 bay 节点名只有 7 个共享计数值（facade-0/1/2/15/16/24/33），一对一改名映射不存在也不可造（那会把旧共享 id
//   指向任意一间）；真正的迁移关系是 baseline/layout.json facadeIdentity.legacyAliases 的一对多别名清单。
//   bay 侧一律按三角形质心最近邻做一一空间配对后逐 bay 比较。
// winding：三角形键只允许循环移位（ABC/BCA/CAB）；镜像翻面（ACB）按不同几何计。
// 用法：
//   node tests/runtime-parity-check.mjs parity --a <dirA> --b <dirB> [--parts f1,f2] --report <json>
//   node tests/runtime-parity-check.mjs identity --out <OUT_DIR> --report <json>
//   node tests/runtime-parity-check.mjs selftest
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../../../src/world/glbReader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = 1e4; // 世界坐标量化到 0.1 mm

const ZONE_PARTS = [
  'zone-garden.glb', 'zone-garden-2.glb', 'zone-garden-3.glb',
  'zone-pond.glb', 'zone-pond-2.glb',
  'zone-temple-1.glb', 'zone-temple-2.glb', 'zone-temple-3.glb', 'zone-temple-4.glb',
  'zone-bazaar.glb', 'zone-bazaar-2.glb', 'zone-bazaar-3.glb', 'zone-bazaar-4.glb',
  'zone-outer.glb', 'zone-fangbang-1.glb', 'zone-fangbang-2.glb',
];

function triMultiset(mesh) {
  const { positions, indices, matrix } = mesh;
  const mul = (i) => [
    matrix[0] * positions[i * 3] + matrix[4] * positions[i * 3 + 1] + matrix[8] * positions[i * 3 + 2] + matrix[12],
    matrix[1] * positions[i * 3] + matrix[5] * positions[i * 3 + 1] + matrix[9] * positions[i * 3 + 2] + matrix[13],
    matrix[2] * positions[i * 3] + matrix[6] * positions[i * 3 + 1] + matrix[10] * positions[i * 3 + 2] + matrix[14],
  ];
  const out = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const a = mul(indices[t]), b = mul(indices[t + 1]), c = mul(indices[t + 2]);
    // 顶点环序无关但保留 winding：只取循环移位 (ABC/BCA/CAB) 的最小键。三点排序会把镜像翻转
    // (ACB，法线反向的同位置三角形) 当相同 —— 禁止；翻面必须算差异。
    const vs = [a, b, c].map(v => v.map(x => Math.round(x * Q)));
    const keys = [0, 1, 2].map(s =>
      [vs[s], vs[(s + 1) % 3], vs[(s + 2) % 3]].map(v => v.join(',')).join(';'));
    const key = keys[0] <= keys[1] && keys[0] <= keys[2] ? keys[0] : (keys[1] <= keys[2] ? keys[1] : keys[2]);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

function diffMultiset(ma, mb) {
  let onlyA = 0, onlyB = 0, shared = 0;
  const samplesA = [], samplesB = [];
  for (const [k, n] of ma) {
    const nb = mb.get(k) || 0;
    if (nb >= n) shared += n;
    else { onlyA += n - nb; if (samplesA.length < 3) samplesA.push(k); }
  }
  for (const [k, n] of mb) {
    const na = ma.get(k) || 0;
    if (na < n) { onlyB += n - na; if (samplesB.length < 3) samplesB.push(k); }
  }
  return { onlyA, onlyB, shared, samplesA, samplesB };
}

function nodeNames(gltf) {
  const m = new Map();
  for (const n of gltf.nodes || []) {
    if (n.mesh === undefined) continue;
    m.set(n.name ?? '', (m.get(n.name ?? '') || 0) + 1);
  }
  return m;
}

const isBayName = (n) => String(n).split('|').length === 4 && String(n).split('|')[2] === 'facadeBay';

// bay 空间配对：旧 bay 节点名只有 7 个计数值（175 个 bay 共享），名字层面天然多对一、没有一对一映射可用；
// 与 G1 交付同口径，按 bay 世界位置最近邻一一配对后逐 bay 比较。
// 位置键 = 三角形顶点质心（GLB 导出可能把变换烘焙进顶点、节点矩阵为单位阵，不能只看 matrix 平移）。
function bayCentroid(m) {
  const { positions, indices, matrix } = m;
  const apply = (i) => [
    matrix[0] * positions[i * 3] + matrix[4] * positions[i * 3 + 1] + matrix[8] * positions[i * 3 + 2] + matrix[12],
    matrix[1] * positions[i * 3] + matrix[5] * positions[i * 3 + 1] + matrix[9] * positions[i * 3 + 2] + matrix[13],
    matrix[2] * positions[i * 3] + matrix[6] * positions[i * 3 + 1] + matrix[10] * positions[i * 3 + 2] + matrix[14],
  ];
  let x = 0, y = 0, z = 0;
  for (let t = 0; t < indices.length; t++) {
    const v = apply(indices[t]);
    x += v[0]; y += v[1]; z += v[2];
  }
  const n = Math.max(indices.length, 1);
  return [x / n, y / n, z / n];
}

function pairBays(meshesA, meshesB) {
  const B = meshesB.map((m) => ({ m, c: bayCentroid(m), used: false }));
  const pairs = [];
  const unpairedA = [];
  for (const a of meshesA) {
    const pa = bayCentroid(a);
    let best = -1, bd = Infinity;
    B.forEach((e, i) => {
      if (e.used) return;
      const d = (pa[0] - e.c[0]) ** 2 + (pa[1] - e.c[1]) ** 2 + (pa[2] - e.c[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0 || bd > 1e-6) { unpairedA.push({ name: a.name, pos: pa }); continue; }
    B[best].used = true;
    pairs.push({ a, b: B[best].m, dist: Math.sqrt(bd) });
  }
  const unpairedB = B.filter((e) => !e.used).map((e) => ({ name: e.m.name, pos: e.c }));
  let mismatched = 0;
  const samples = [];
  for (const { a, b, dist } of pairs) {
    const d = diffMultiset(triMultiset(a), triMultiset(b));
    if (d.onlyA || d.onlyB) {
      mismatched++;
      if (samples.length < 5) samples.push({ nameA: a.name, nameB: b.name, dist: +dist.toFixed(4), onlyInA: d.onlyA, onlyInB: d.onlyB });
    }
  }
  return { pairs: pairs.length, mismatched, unpairedA, unpairedB, samples };
}

function parse(file) {
  return readGlb(fs.readFileSync(file));
}

function runParity(dirA, dirB, parts = ZONE_PARTS) {
  const rows = [];
  let allPass = true;
  for (const f of parts) {
    const fa = path.join(dirA, f), fb = path.join(dirB, f);
    const row = { file: f, inA: fs.existsSync(fa), inB: fs.existsSync(fb) };
    if (!row.inA || !row.inB) {
      // 预期分件任一侧缺失都直接失败（含双方都缺——静默放过会让空目录假阳性）。
      row.verdict = (row.inA || row.inB) ? 'PART_MISSING_IN_ONE_SIDE' : 'PART_MISSING_BOTH';
      allPass = false;
      rows.push(row);
      console.error(`[parity] ${f}: ${row.verdict}`);
      continue;
    }
    const A = parse(fa), B = parse(fb);
    row.trianglesA = A.totalTriangles;
    row.trianglesB = B.totalTriangles;
    const perName = [];
    const na = nodeNames(A.gltf), nb = nodeNames(B.gltf);
    const names = new Set([...na.keys(), ...nb.keys()]);
    let nodeSetDiff = 0;
    for (const name of names) {
      if ((na.get(name) || 0) !== (nb.get(name) || 0)) { nodeSetDiff++; perName.push({ name, countA: na.get(name) || 0, countB: nb.get(name) || 0 }); }
    }
    // 非 bay 节点按名字逐节点比较；bay 节点空间配对（见 pairBays）——不存在旧→新 id 改名映射，不做改名归一。
    const meshA = A.meshes.filter((m) => !isBayName(m.name));
    const meshB = B.meshes.filter((m) => !isBayName(m.name));
    const bayA = A.meshes.filter((m) => isBayName(m.name));
    const bayB = B.meshes.filter((m) => isBayName(m.name));
    const maByNode = new Map(), mbByNode = new Map();
    for (const m of meshA) {
      if (!maByNode.has(m.name)) maByNode.set(m.name, new Map());
      merge(maByNode.get(m.name), triMultiset(m));
    }
    for (const m of meshB) {
      if (!mbByNode.has(m.name)) mbByNode.set(m.name, new Map());
      merge(mbByNode.get(m.name), triMultiset(m));
    }
    let onlyA = 0, onlyB = 0;
    const geomDiffNodes = [];
    for (const name of new Set([...maByNode.keys(), ...mbByNode.keys()])) {
      const d = diffMultiset(maByNode.get(name) || new Map(), mbByNode.get(name) || new Map());
      if (d.onlyA || d.onlyB) {
        geomDiffNodes.push({ name, onlyInA: d.onlyA, onlyInB: d.onlyB, sampleA: d.samplesA, sampleB: d.samplesB });
        onlyA += d.onlyA; onlyB += d.onlyB;
      }
    }
    // bay 一一空间配对（winding 保留多重集；换 id 不换每 bay 几何）
    const bayPairing = pairBays(bayA, bayB);
    onlyA += bayPairing.samples.reduce((s, x) => s + x.onlyInA, 0);
    onlyB += bayPairing.samples.reduce((s, x) => s + x.onlyInB, 0);
    row.nodesOnlyInA = [...na.keys()].filter(k => !nb.has(k));
    row.nodesOnlyInB = [...nb.keys()].filter(k => !na.has(k));
    row.nodeCountDiff = nodeSetDiff;
    row.bayPairing = { pairs: bayPairing.pairs, mismatched: bayPairing.mismatched,
      unpairedA: bayPairing.unpairedA.length, unpairedB: bayPairing.unpairedB.length, samples: bayPairing.samples };
    row.trisOnlyInA = onlyA;
    row.trisOnlyInB = onlyB;
    row.geomDiffNodes = geomDiffNodes.slice(0, 8);
    row.geometryIdentical = A.totalTriangles === B.totalTriangles && onlyA === 0 && onlyB === 0
      && bayPairing.pairs === bayA.length && bayPairing.unpairedA.length === 0 && bayPairing.unpairedB.length === 0;
    row.verdict = row.geometryIdentical
      ? (row.nodeCountDiff === 0 ? 'IDENTICAL_GEOMETRY_AND_NODES' : `IDENTICAL_GEOMETRY_METADATA_ONLY_DIFF(nodeNameDiff=${row.nodeCountDiff})`)
      : 'GEOMETRY_DIFF';
    if (!row.geometryIdentical) allPass = false;
    rows.push(row);
    console.error(`[parity] ${f}: triA=${row.trianglesA} triB=${row.trianglesB} onlyA=${onlyA} onlyB=${onlyB} nodeDiff=${nodeSetDiff} -> ${row.verdict}`);
  }
  return { allPass, parts: rows };
}

function parityMain(dirA, dirB, report, parts) {
  const { allPass, parts: rows } = runParity(dirA, dirB, parts);
  const doc = { tool: 'tests/runtime-parity-check.mjs parity', dirA, dirB, allPass, parts: rows,
    note: '比较口径：非 bay 节点按名字逐节点；175 个 facadeBay 一一空间配对（三角形质心最近邻）后逐 bay 比较。旧 bay 节点名只有 7 个共享计数值，不存在（也不可造）旧→新一对一改名映射；真正的迁移关系是 baseline/layout.json facadeIdentity.legacyAliases 的一对多别名清单。三角形键 = 世界坐标量化 0.1 mm、只允许循环移位（ABC/BCA/CAB），winding 保留、镜像翻面算差异。多重集相同但文件 hash 不同 = 索引顺序/序列化差异，不代表几何变化。任一预期分件单侧或双侧缺失都判 FAIL。' };
  if (report) { fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, JSON.stringify(doc, null, 1) + '\n'); }
  console.log(JSON.stringify({ allPass, parts: rows.length, geomDiff: rows.filter(r => r.verdict === 'GEOMETRY_DIFF').map(r => r.file),
    missing: rows.filter(r => String(r.verdict).startsWith('PART_MISSING')).map(r => `${r.file}:${r.verdict}`) }));
  process.exit(allPass ? 0 : 1);
}

function merge(dst, src) {
  for (const [k, v] of src) dst.set(k, (dst.get(k) || 0) + v);
}

function identity(outDir, report) {
  const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
  const bays = layout.objects.filter(o => o.kind === 'facadeBay');
  const byNewId = new Map(bays.map(o => [o.id, o]));
  const errors = [];
  const found = new Map(); // newId -> {files:[], extras}
  const parts = ZONE_PARTS.filter(f => fs.existsSync(path.join(outDir, f)));
  for (const f of parts) {
    const { gltf } = parse(path.join(outDir, f));
    for (const n of gltf.nodes || []) {
      const nm = n.name ?? '';
      const seg = nm.split('|');
      if (seg.length === 4 && seg[2] === 'facadeBay' && seg[0] === 'bazaar') {
        const id = seg[1];
        const e = found.get(id) || { files: [], extras: [] };
        e.files.push(f);
        e.extras.push(n.extras ?? null);
        found.set(id, e);
      }
    }
  }
  if (found.size !== 175) errors.push(`GLB 里 facadeBay 节点 id 数 ${found.size} != 175`);
  for (const [id, e] of found) {
    if (!byNewId.has(id)) errors.push(`GLB id ${id} 不在 layout`);
    if (e.files.length !== 1) errors.push(`GLB id ${id} 出现在多件 ${e.files.join(',')}`);
    const ex = e.extras[0];
    if (!ex || ex.id !== id) errors.push(`GLB id ${id} extras.id 缺失或不一致`);
    const lo = byNewId.get(id);
    if (lo && ex) {
      if (ex.legacyId !== lo.legacyId) errors.push(`GLB id ${id} extras.legacyId ${ex.legacyId} != layout ${lo.legacyId}`);
      if (String(ex.doorVariant) !== String(lo.doorVariant)) errors.push(`GLB id ${id} extras.doorVariant ${ex.doorVariant} != layout ${lo.doorVariant}`);
    }
  }
  for (const o of bays) {
    if (!found.has(o.id)) errors.push(`layout id ${o.id} 在 GLB 无节点`);
  }
  // legacy 旧名本来就是 7 个计数值共享给 175 个 bay（G1 修的正是这个歧义），唯一性看 layout.facadeIdentity.legacyAliases 清单
  const aliases = layout.facadeIdentity?.legacyAliases ?? {};
  let aliasChecked = 0;
  for (const o of bays) {
    const list = aliases[o.legacyId];
    if (!list || !list.includes(o.id)) errors.push(`layout id ${o.id} 不在 facadeIdentity.legacyAliases[${o.legacyId}] 清单`);
    else aliasChecked++;
  }
  const doc = {
    tool: 'tests/runtime-parity-check.mjs identity', outDir,
    bayNodesInGlb: found.size, layoutBays: bays.length,
    partsScanned: parts,
    legacyAliasesChecked: aliasChecked,
    errors,
    pass: errors.length === 0,
  };
  if (report) { fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, JSON.stringify(doc, null, 1) + '\n'); }
  console.log(JSON.stringify({ pass: doc.pass, bayNodesInGlb: found.size, legacyAliasesChecked: aliasChecked, errors: errors.slice(0, 10) }));
  process.exit(doc.pass ? 0 : 1);
}

// ---------------- selftest：工具自身微型正/负例（合成 GLB，临时目录，不触真实产物） ----------------

// 极小 GLB 写入器：tris = [[[x,y,z],[x,y,z],[x,y,z]] ...]（世界坐标，矩阵单位阵）。
function tinyGlb(tris, nodeName) {
  const pos = new Float32Array(tris.flat(2));
  const idx = new Uint32Array(tris.length * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  }
  const posBuf = Buffer.from(pos.buffer), idxBuf = Buffer.from(idx.buffer);
  const bin = Buffer.concat([posBuf, idxBuf]);
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nodeName }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length },
      { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(gltf));
  const pad4 = (n) => (4 - (n % 4)) % 4;
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length), 0x20)]);  // GLB 规范：JSON chunk 用空格补齐
  const binP = Buffer.concat([bin, Buffer.alloc(pad4(bin.length))]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + binP.length, 8);
  const cj = Buffer.alloc(8); cj.writeUInt32LE(js.length, 0); cj.writeUInt32LE(0x4e4f534a, 4);
  const cb = Buffer.alloc(8); cb.writeUInt32LE(binP.length, 0); cb.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, cj, js, cb, binP]);
}

const TRI = (a, b, c) => [a, b, c];
const A1 = [0, 0, 0], B1 = [1, 0, 0], C1 = [0, 1, 0], D1 = [1, 1, 1];

function selftest() {
  const results = [];
  const check = (name, cond) => { results.push({ name, pass: !!cond }); console.error(`[selftest] ${cond ? 'PASS' : 'FAIL'} ${name}`); };
  const retainedRoot = process.env.ART_DIR ? path.resolve(process.env.ART_DIR) : path.join(os.tmpdir(), 'pawborough-parity-retained');
  fs.mkdirSync(retainedRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(retainedRoot, 'parity-selftest-'));
  const dA = path.join(tmp, 'a'), dB = path.join(tmp, 'b');
  for (const d of [dA, dB]) fs.mkdirSync(d, { recursive: true });

  // 正例：循环换起点（ABC→BCA）+ 三角形绘制顺序重排 → 仍判相同
  const trisBase = [TRI(A1, B1, C1), TRI(A1, C1, D1)];
  const trisRot = [TRI(C1, A1, B1), TRI(D1, A1, C1)];           // 每个三角循环移位 + 顺序对调
  fs.writeFileSync(path.join(dA, 'zone-pond-2.glb'), tinyGlb(trisBase, 'test-mesh'));
  fs.writeFileSync(path.join(dB, 'zone-pond-2.glb'), tinyGlb(trisRot, 'test-mesh'));
  let r = runParity(dA, dB, ['zone-pond-2.glb']);
  check('positive: cyclic vertex rotation + tri reorder = identical', r.allPass && r.parts[0].verdict === 'IDENTICAL_GEOMETRY_AND_NODES');

  // 负例：单三角翻面（最后一个三角 ACB，镜像 winding）→ 必须差异
  const trisFlip = [TRI(A1, B1, C1), TRI(A1, D1, C1)];
  fs.writeFileSync(path.join(dB, 'zone-pond-2.glb'), tinyGlb(trisFlip, 'test-mesh'));
  r = runParity(dA, dB, ['zone-pond-2.glb']);
  check('negative: single triangle flipped winding (ACB) = GEOMETRY_DIFF',
    !r.allPass && r.parts[0].verdict === 'GEOMETRY_DIFF' && (r.parts[0].trisOnlyInA + r.parts[0].trisOnlyInB) === 2);

  // 负例：预期分件双方都缺 → 必须失败（不允许空目录假阳性）
  const dE = path.join(tmp, 'e'), dF = path.join(tmp, 'f');
  fs.mkdirSync(dE, { recursive: true }); fs.mkdirSync(dF, { recursive: true });
  r = runParity(dE, dF, ['zone-pond-2.glb']);
  check('negative: part missing on BOTH sides = fail', !r.allPass && r.parts[0].verdict === 'PART_MISSING_BOTH');

  // 负例：单侧缺件 → 必须失败
  fs.writeFileSync(path.join(dA, 'zone-pond-2.glb'), tinyGlb(trisBase, 'test-mesh'));
  r = runParity(dA, dF, ['zone-pond-2.glb']);
  check('negative: part missing on one side = fail', !r.allPass && r.parts[0].verdict === 'PART_MISSING_IN_ONE_SIDE');

  const retentionRecord = path.join(retainedRoot, 'runtime-parity-fixtures.jsonl');
  fs.appendFileSync(retentionRecord, JSON.stringify({ retainedDir: tmp, retainedAt: new Date().toISOString(), purpose: 'micro parity selftest; final samples retained; earlier deleted worker fixtures cannot be claimed present' }) + '\n', 'utf8');
  const pass = results.every(x => x.pass);
  console.log(JSON.stringify({ pass, cases: results, retainedDir: tmp, retentionRecord }));
  process.exit(pass ? 0 : 1);
}

const [, , mode, ...rest] = process.argv;
const arg = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
if (mode === 'parity') {
  const parts = arg('--parts') ? arg('--parts').split(',').map(s => s.trim()).filter(Boolean) : undefined;
  parityMain(path.resolve(arg('--a')), path.resolve(arg('--b')), arg('--report'), parts);
}
else if (mode === 'identity') identity(path.resolve(ROOT, arg('--out', 'out-goal-current')), arg('--report'));
else if (mode === 'selftest') selftest();
else { console.error('usage: parity --a DIR --b DIR [--parts f1,f2] --report JSON | identity --out DIR --report JSON | selftest'); process.exit(2); }
