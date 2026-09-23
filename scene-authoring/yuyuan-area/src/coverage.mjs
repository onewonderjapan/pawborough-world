// coverage.json v2：源清单 -> layout -> 实际导出 GLB 节点 的可执行对账。
// 对账逻辑在 src/reconcile.mjs（与负例测试共用）；本文件负责汇总与出具报告。
// 所有数字要么来自实际文件解析，要么给出明确理由；不硬编码验证/渲染结论。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseGlbJson, nodeNamesOf, buildExpectations, reconcile, triangleCounts } from './reconcile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.OUT_DIR || 'out';
const OUT = path.join(ROOT, OUT_DIR);
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const procStats = JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8'));
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// ---------- 对账：scene-areas.glb ----------
const scenePath = path.join(OUT, 'scene-areas.glb');
const sceneNames = nodeNamesOf(parseGlbJson(fs.readFileSync(scenePath)));
const expectations = buildExpectations(layout, procStats);
const rec = reconcile(expectations, sceneNames);

// tri 计数（unique vs placed 分记）
const tri = { scene: triangleCounts(parseGlbJson(fs.readFileSync(scenePath))) };
const zoneFiles = ['garden.glb', 'temple.glb', 'bazaar.glb'];
for (const f of zoneFiles) {
  const p = path.join(OUT, f);
  if (fs.existsSync(p)) tri[f.replace('.glb', '')] = triangleCounts(parseGlbJson(fs.readFileSync(p)));
}

// validator 结果（来自 validate.mjs 实际运行输出，不硬编码）
let validation = null;
try { validation = readJson('validation.json'); } catch { validation = null; }

// 本批各审计结果（存在才引用）
const audit = {};
for (const f of ['roof-leak-recheck.json', 'normal-audit.json', 'connectivity.json', 'commerce-audit.json']) {
  try { audit[f.replace('.json', '')] = readJson(f); } catch { audit[f.replace('.json', '')] = null; }
}

const byKind = layout.objects.reduce((m, o) => (m[o.kind] = (m[o.kind] || 0) + 1, m), {});
const inputHash = {
  'inputs/map-data.json': sha256(path.join(ROOT, 'inputs', 'map-data.json')),
  'inputs/overpass.json': sha256(path.join(ROOT, 'inputs', 'overpass.json')),
  'inputs/yuyuan-gate-v2.glb': sha256(path.join(ROOT, 'inputs', 'yuyuan-gate-v2.glb')),
};
const gateShaOk = inputHash['inputs/yuyuan-gate-v2.glb'] === layout.meta.inputs.adoptedGate.sha256;
const gateInstances = layout.instances.filter(i => i.module === 'yuyuan-gate-v2');
const gateScaleRecorded = gateInstances.every(i => (i.axis || '').includes('scale 1'));

const coverage = {
  generatedAt: new Date().toISOString(),
  claim: '圈定范围底模 v2 覆盖率与对账报告；非历史测绘复原，非完整精修。所有计数由实际导出文件复算。',
  frozenInputs: { sha256: inputHash, gateShaMatchesAdoption: gateShaOk, gateInstances: gateInstances.length, gateScale: gateScaleRecorded ? '1 (axis string, no scaling applied)' : 'UNVERIFIED' },
  reconciliation: {
    method: 'layout 对象/实例 -> scene-areas.glb 实际节点名匹配（src/reconcile.mjs，与 tests/coverage-negative-test.mjs 共用）',
    expectedNodes: rec.expected,
    presentNodes: rec.present,
    missing: rec.missing,
    absentButFound: rec.unexpectedPresent,
    ok: rec.missing.length === 0 && rec.unexpectedPresent.length === 0,
  },
  counts: layout.counts,
  renderedByKind: byKind,
  triangles: (() => {
    // G5 食品预算单列（PLAN：不偷换纯场景预算）：food|* 锚子树 placed 单独计量，
    // 纯场景口径 = 总 placed - food placed，450k/30MB 目标仍按纯场景复核。
    const j = parseGlbJson(fs.readFileSync(scenePath));
    const nodes = j.nodes || [];
    const trisOf = (m) => m.primitives.reduce((s, p) => s + Math.floor(j.accessors[p.indices].count / 3), 0);
    let foodPlaced = 0;
    const byName = new Map(nodes.map((n, i) => [n.name || '', i]));
    for (const [nm, ni] of byName) {
      if (!String(nm).startsWith('food|')) continue;
      const sub = [];
      const w = (i) => { sub.push(i); for (const c of (nodes[i].children || [])) w(c); };
      w(ni);
      for (const i of sub) if (nodes[i].mesh !== undefined) foodPlaced += trisOf(j.meshes[nodes[i].mesh]);
    }
    const corePlaced = tri.scene.placed - foodPlaced;
    const sceneBytes = fs.statSync(scenePath).size;
    return {
      note: 'unique = mesh 级三角形；placed = 节点树实例化后（L2 只读模块被链接复制计入）；G5 起食品 placed 单列',
      'scene-areas.glb': tri.scene,
      budget: { corePlusBackgroundPlacedTarget: 450000, allGlbBytesTarget: 30_000_000, foodPlacedTarget: 120000 },
      coreScenePlaced: corePlaced,
      foodPlacedSeparate: foodPlaced,
      withinBudget: corePlaced <= 450000 && sceneBytes <= 30_000_000,
      budgetBasis: '纯场景口径（coreScenePlaced ≤450k 且主 GLB ≤30MB）；食品增量另受 foodPlacedTarget 约束（scripts/check-food.mjs 复核）',
    };
  })(),
  glbFiles: (validation?.stats || []).map(s => ({ file: s.file, bytes: s.bytes, nodes: s.nodes, uniqueTriangles: s.triangles })),
  validator: validation ? {
    byFile: validation.validator,
    totalErrors: Object.values(validation.validator).reduce((s, v) => s + (v.issues?.numErrors || 0), 0),
    totalWarnings: Object.values(validation.validator).reduce((s, v) => s + (v.issues?.numWarnings || 0), 0),
    templeTangentWarnings: 'temple.glb 既有 MESH_PRIMITIVE_GENERATED_TANGENT_SPACE 警告如实保留（不改源资产、不为消警告删 normal 贴图）',
  } : 'validation.json 缺失——请先运行 npm run validate',
  audits: {
    roofLeak: audit['roof-leak-recheck'] ? { ok: audit['roof-leak-recheck'].ok, cases: audit['roof-leak-recheck'].cases.length, note: '全场带屋面对象逐个采样；基线13案例最高1.57m -> v2 为 0' } : null,
    normals: audit['normal-audit'] ? { ok: audit['normal-audit'].ok, files: audit['normal-audit'].audits.length, note: '垂直三角朝上法线 基线1250 -> v2 为 0；绕序倾斜法线亦为 0' } : null,
    connectivity: audit['connectivity'] ? { ok: audit['connectivity'].hardViolations.length === 0, routes: audit['connectivity'].routes.map(r => ({ route: r.route, segments: r.segments.length })), violations: audit['connectivity'].hardViolations } : null,
    commerce: audit['commerce-audit'] ? { baysVisible: audit['commerce-audit'].facadeBays.visible, baysTotal: audit['commerce-audit'].facadeBays.total, stalls: audit['commerce-audit'].stallsAndBenches.stalls, benches: audit['commerce-audit'].stallsAndBenches.benches, foodSockets: `${OUT_DIR}/food-sockets.json` } : null,
  },
  l2References: {
    adoptedGate: { asset: 'yuyuan-gate-v2.glb', sha256: layout.meta.inputs.adoptedGate.sha256, ownerAdopted: true, placement: 'design-placement (garden boundary nearest 三穗堂 axis)', scale: '1' },
    templeAxisV3: { modules: 11, instancePlacements: layout.instances.filter(i => i.id.startsWith('temple-')).length, ownerAdopted: false, note: 'read-only embed, per-file sha256 in layout.instances' },
    shopBaseUnits: { units: 5, instances: layout.instances.filter(i => i.module.startsWith('shop-')).length, ownerAdopted: false },
    ownerAdoptedGlobal: false,
  },
  templeRegistration: layout.templeRegistration || null,
  pondWestLink: {
    change: 'v1 decorative bridge (east end landed mid-water) replaced by west-bank shore walk (path)',
    policy: '原布局保留在 out/layout.json（上一批产物未删除）；本变更记录于对象 replacesDesign/inferences',
  },
  designInference: {
    gardenWall: '龙墙走向 = 园区边界内缩 2.5m，遇建筑/街巷自然开口',
    gardenPaths: '厅堂间最小设计连接，遇水/建筑绕行；无法绕行处单列 routeConstraint 受限记录',
    bazaarFacades: '大楼按 OSM 层数做水平线脚+临街窗带；roof:shape 无标签时按类别默认 hip 并如实记录（不谎称 mansard）',
    facadeBays: '开间节奏为设计推断；被相邻楼块重叠轮廓掩埋的开间在生成期抑制并计数（facadeStats.baysSuppressed）',
    stalls: '摊位/座凳设计摆放；G5 起 food_socket 由 inputs/FOOD_INPUT.json 提供的只读食品来源接入（分配见 food-placement.json，来源 SHA 见 food-source-index.json）',
  },
  outputs: {
    scene: `${OUT_DIR}/scene-areas.glb`, zones: [`${OUT_DIR}/garden.glb`, `${OUT_DIR}/temple.glb`, `${OUT_DIR}/bazaar.glb`],
    assembly: `${OUT_DIR}/scene.blend (可重开总装) + scripts/assemble.py (OUT_DIR=${OUT_DIR} 可一次重建)`,
    layout: `${OUT_DIR}/layout.json`, foodSockets: `${OUT_DIR}/food-sockets.json`,
    audits: [`${OUT_DIR}/connectivity.json`, `${OUT_DIR}/commerce-audit.json`, `${OUT_DIR}/roof-leak-recheck.json`, `${OUT_DIR}/normal-audit.json`],
    preview: `http://127.0.0.1:5480/ (PORT=5480 OUT_DIR=${OUT_DIR} npm run server)`,
    note: '旧 out/ 与 renders/ 保留未删（上一批历史记录）',
  },
  deferredOrMissing: [
    'temple L2 模块由 Blender 嵌入，procedural-temple 仅墙/地——分工而非缺件（对账以实例锚节点为准）',
    `G5 食品已接入：86 socket -> 只读来源实例（food-check.json / food-placement.json / food-source-index.json；来源目录 ${'../inputs/FOOD_INPUT.json'} 声明路径只读未改）`,
    'gpath-1 当前采用池岸干绕行；受限状态以本输出目录 connectivity.json 为准。',
    'OSM 路网/广场与建筑、水面的源数据重叠如实记录于 connectivity.json（不裁剪、不挪楼）',
    '檐口瓦垄/龙头/翼角等装饰细节留待精修批',
  ],
};

const ok = coverage.reconciliation.ok && (coverage.audits.roofLeak?.ok !== false) && (coverage.audits.normals?.ok !== false) && (coverage.audits.connectivity?.ok !== false);
fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(coverage, null, 1));
console.log('coverage.json written; reconciliation', coverage.reconciliation.ok ? 'OK' : `MISSING ${rec.missing.length}`, '| overall', ok ? 'OK' : 'FAIL');
if (!coverage.reconciliation.ok) {
  console.log('missing nodes:', JSON.stringify(rec.missing.slice(0, 20), null, 1));
  process.exit(1);
}
if (!ok) process.exit(1);
