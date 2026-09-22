import {readInventory,assetPath} from '../src/project-paths.mjs';
// G5 食品接入核验：从实际导出 GLB + food-placement.json + 只读来源 三方对账。
// 检查：来源未改动（SHA）/ socket 稳定 ID 一一对应 / 每实例单档 LOD+必要子件 /
//       落桌位姿=socket 台面与朝向 / 足迹≤可用面 / 食品预算单列。
// 用法：OUT_DIR=out-goal-05 node scripts/check-food.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseGlbJson } from '../src/reconcile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'food-placement.json'), 'utf8'));
const socketsNow = JSON.parse(fs.readFileSync(path.join(OUT, 'food-sockets.json'), 'utf8')).sockets;
const socketsPrev = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'food-sockets.json'), 'utf8')).sockets;
const inventory = readInventory();
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail); }
};

// 1) 只读来源完整：全部 30 条来源（用与不用）SHA 与主控核清单一一致
const shaBad = [];
for (const s of inventory.sources) {
  if (!fs.existsSync(s.path)) { shaBad.push(s.path + ' (missing)'); continue; }
  if (sha256(s.path) !== s.sha256) shaBad.push(s.path);
}
check('sources-readonly-sha-unchanged', shaBad.length === 0, JSON.stringify(shaBad));

// 2) socket 稳定 ID 与位置相对 out-goal-04 零漂移
const prevById = new Map(socketsPrev.map(s => [s.id, s]));
const drift = socketsNow.filter(s => {
  const p = prevById.get(s.id);
  return !p || JSON.stringify(p.worldPosition) !== JSON.stringify(s.worldPosition) || p.worldRotY !== s.worldRotY;
});
check('socket-ids-stable-vs-out-goal-04', socketsNow.length === socketsPrev.length && drift.length === 0, JSON.stringify(drift.slice(0, 3)));

// 3) 每个placement在导出GLB中有锚节点，且位姿=socket真值
const glb = parseGlbJson(fs.readFileSync(path.join(OUT, 'bazaar.glb')));
const nodes = glb.nodes || [];
const byName = new Map(nodes.map((n, i) => [n.name || '', i]));
const scene = glb.scenes[glb.scene || 0];
const reachable = new Set();
const walk = (i) => { if (reachable.has(i)) return; reachable.add(i); for (const c of nodes[i].children || []) walk(c); };
for (const ni of scene.nodes) walk(ni);

const meshTris = (glbJson) => (glbJson.meshes || []).map(m => m.primitives.reduce((s, p) =>
  s + Math.floor(glbJson.accessors[p.indices].count / 3), 0));
const tris = meshTris(glb);

const poseBad = [], missingAnchor = [];
for (const p of plan.placements) {
  const ni = byName.get(p.sceneNode);
  if (ni === undefined || !reachable.has(ni)) { missingAnchor.push(p.socketId); continue; }
  const n = nodes[ni];
  const [x, h, z] = p.worldPosition;
  const dt = Math.hypot(n.translation[0] - x, n.translation[1] - h, n.translation[2] - z);
  // glTF 四元数 (x,y,z,w) 绕 Y 角 = 2*asin(y)
  const rotY = 2 * Math.asin(Math.max(-1, Math.min(1, n.rotation[1]))) * (n.rotation[3] >= 0 ? 1 : -1);
  const dr = Math.abs(rotY - p.worldRotY);
  if (dt > 0.002 || dr > 0.002) poseBad.push(`${p.socketId} dt=${dt.toFixed(4)} dr=${dr.toFixed(4)}`);
}
check('all-86-anchors-present', missingAnchor.length === 0, JSON.stringify(missingAnchor.slice(0, 5)));
check('anchors-at-socket-pose', poseBad.length === 0, JSON.stringify(poseBad.slice(0, 5)));

// 4) 每实例单档 LOD：锚子树内不得同时出现同一道具的多个 LOD 档；必要子件在位
const lodBad = [], extrasBad = [];
const base = (nm) => nm.split('.')[0];  // blender 重名后缀 .001 归一
for (const p of plan.placements) {
  const ni = byName.get(p.sceneNode);
  const kids = (nodes[ni].children || []).map(ci => base(String(nodes[ci].name || '')));
  const lodNodes = kids.filter(k => /_LOD\d+$/.test(k));
  const levels = new Set(lodNodes.map(k => k.match(/_LOD(\d+)$/)[1]));
  if (p.sourceKind === 'handheld_lod') {
    if (lodNodes.length !== 1 || !levels.has(String(p.lod))) lodBad.push(`${p.socketId}: ${lodNodes.join(',')}`);
    for (const e of p.extras) if (!kids.includes(e)) extrasBad.push(`${p.socketId}: missing ${e}`);
  } else if (kids.length !== 1 || !kids[0].startsWith('prop__' + p.item)) {
    lodBad.push(`${p.socketId}: batch kids=${kids.join(',')}`);
  }
}
check('single-lod-per-instance', lodBad.length === 0, JSON.stringify(lodBad.slice(0, 5)));
check('lid-straw-subparts-kept', extrasBad.length === 0, JSON.stringify(extrasBad.slice(0, 5)));

// 5) 食品预算单列：food| 锚子树 placed 三角合计
let foodPlaced = 0;
for (const [nm, ni] of byName) {
  if (!String(nm).startsWith('food|')) continue;
  const sub = [];
  const w = (i) => { sub.push(i); for (const c of (nodes[i].children || [])) w(c); };
  w(ni);
  for (const i of sub) if (nodes[i].mesh !== undefined) foodPlaced += tris[nodes[i].mesh];
}
check('food-budget-within-target', foodPlaced <= plan.budget.foodPlacedTarget,
  `placed=${foodPlaced} target=${plan.budget.foodPlacedTarget}`);
const sceneBytes = fs.statSync(path.join(OUT, 'scene-areas.glb')).size;
const sceneBytes04 = JSON.parse(fs.readFileSync(path.join(ROOT,'baseline','metrics.json'),'utf8')).g4PureSceneBytes;
check('main-glb-within-30mb', sceneBytes <= 30_000_000, `bytes=${sceneBytes}`);

// 6) 足迹匹配（placement 生成时已校验，此处复核记录一致性）
const fitsBad = plan.placements.filter(p => !p.fits).map(p => p.socketId);
check('footprint-fits-usable-size', fitsBad.length === 0, JSON.stringify(fitsBad));

const summary = {
  generatedAt: new Date().toISOString(),
  sourcesChecked: inventory.sources.length, shaMismatches: shaBad.length,
  sockets: socketsNow.length, placements: plan.placements.length, missingAnchors: missingAnchor.length,
  poseViolations: poseBad.length, lodViolations: lodBad.length, extrasMissing: extrasBad.length,
  foodPlacedTriangles: foodPlaced, foodPlacedTarget: plan.budget.foodPlacedTarget,
  bytes: {
    'scene-areas.glb': sceneBytes,
    'scene-areas.glb (out-goal-04 pure scene)': sceneBytes04,
    netChangeVsPreviousPureSceneBytes: sceneBytes - sceneBytes04,
  },
  budgetNote: '本轮含通道/铺面补修和食品的总装按实际字节检查30MB上限；与旧纯场景差值同时包含几何变化和食品，不称为食品独立传输增量。食品面数按放置清单另计。',
};
fs.writeFileSync(path.join(OUT, 'food-check.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (fail) { console.error(`food check FAILED: ${fail}`); process.exit(1); }
console.log(`food-check: ${pass} pass / 0 fail`);
