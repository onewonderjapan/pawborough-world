// wave12-debt R1（审查必修1）：道路路面字段类型契约的跨语言两端测试。
//
// 审查背景（artifacts/REVIEW-astra.md 必修1）：aa021030 的 Python 端没有完整执行「字段存在但非数组即报错」——
//   {"surfaceFootprint": null}：Python get→None 落 NO_AUTHORITY 回退，JS（键存在 && !Array.isArray）报错；
//   {"surfaceFootprints": [], "surfaceFootprint": "oops"}：Python 提前返回 [] 没看已损坏的旧字段，
//   JS 先对两个字段同时做类型检查再取面优先级、报错。
// 契约（与 src/build-scene.mjs road 分支逐字一致，不放宽 JS 检查）：
//   类型检查先于取面优先级、同时覆盖两个字段（合法 surfaceFootprints=[] 不遮蔽已损坏的 surfaceFootprint）；
//   存在但不是数组（含显式 null）= 数据损坏，两端都报错；合法空数组 = 两端都返回空几何（该路无面）。
//
// 两端驱动方式（同 tests/fangbang-rounding-contract-test.mjs 的跨语言方式）：
//   Python 端：子进程 import scripts/road_surface.py 的 road_surface_footprints，直喂审查点名的合成 geometry；
//   JS 端：类型检查在 build-scene.mjs road 分支内联（不可 import），用临时 OUT_DIR + 真实 out-zone/layout.json
//   的单路变异驱动（检查只看这两个字段，变异后的 geometry 与合成用例等价）。合法空数组以
//   procedural-stats.json 的 byKind.road / meshes 计数证明该路不再产生任何 mesh（= 空几何）。
// 红（aa021030，artifacts/r1/RED-road-surface-contract.log + .patch）：E1/E2 的 Python 断言 FAIL，JS 端全过。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg, data) => { if (cond) { console.log('PASS', msg); } else { fails++; console.error('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };

// ---------- 变异目标：第一条「有旧单块 surfaceFootprint、无 surfaceFootprints、非 skipRender、不在 FANGBANG 裁让名单」的路 ----------
const FANGBANG_CLIP_IDS = ['road-238219466', 'road-238219464', 'road-33683439'];   // 与 build-scene FANGBANG_ROAD_CLIP 同源名单
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'out-zone', 'layout.json'), 'utf8'));
const target = LAYOUT.objects.find(o => o.kind === 'road' && !o.skipRender
  && !FANGBANG_CLIP_IDS.includes(o.id)
  && Array.isArray(o.geometry.surfaceFootprint) && o.geometry.surfaceFootprint.length
  && !('surfaceFootprints' in o.geometry));
if (!target) { console.error('FAIL 找不到符合条件的变异目标路（有 surfaceFootprint、无 surfaceFootprints、非 skipRender）'); process.exit(1); }
console.log('变异目标路:', target.id);

// ---------- Python 端：合成 geometry 直喂 road_surface.road_surface_footprints ----------
const PY_CASES = [
  { name: 'E1 {"surfaceFootprint": null} 报错', g: { surfaceFootprint: null }, want: 'raise', field: 'surfaceFootprint' },
  { name: 'E2 {"surfaceFootprints": [], "surfaceFootprint": "oops"} 报错', g: { surfaceFootprints: [], surfaceFootprint: 'oops' }, want: 'raise', field: 'surfaceFootprint' },
  { name: 'L1 {"surfaceFootprints": []} 返回空几何', g: { surfaceFootprints: [] }, want: 'empty' },
];
const pyCasesFile = path.join(os.tmpdir(), `road-surface-contract-py-${process.pid}.json`);
fs.writeFileSync(pyCasesFile, JSON.stringify(PY_CASES.map(c => c.g)), 'utf8');
const py = spawnSync('python3', ['-X', 'utf8', '-c', [
  'import sys, json',
  "sys.path.insert(0, '.python-deps')",
  "sys.path.insert(0, 'scripts')",
  'import road_surface',
  'cases = json.load(open(sys.argv[1]))',
  'out = []',
  'for g in cases:',
  '    try:',
  '        out.append({"raised": False, "value": road_surface.road_surface_footprints(g), "msg": ""})',
  '    except SystemExit as e:',
  '        out.append({"raised": True, "value": None, "msg": str(e)})',
  'print(json.dumps(out, ensure_ascii=False))',
].join('\n'), pyCasesFile], { cwd: ROOT, encoding: 'utf8' });
fs.rmSync(pyCasesFile, { force: true });
if (py.status !== 0) { console.error('FAIL Python 端子进程异常', py.stderr); process.exit(1); }
const pyResults = JSON.parse(py.stdout);

PY_CASES.forEach((c, i) => {
  const r = pyResults[i];
  if (c.want === 'raise') {
    ok(r.raised === true && r.msg.includes(`${c.field} 存在但不是数组`), `Python ${c.name}`, r);
  } else {   // want === 'empty'：不抛错、返回空列表（权威空几何，而非 None 回退）
    ok(r.raised === false && Array.isArray(r.value) && r.value.length === 0, `Python ${c.name}`, r);
  }
});

// ---------- JS 端：临时 OUT_DIR + 真实 layout 单路变异驱动 build-scene.mjs ----------
const tmpDirs = [];
function runScene(mutate, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `road-surface-contract-${tag}-`));
  tmpDirs.push(dir);
  const doc = JSON.parse(JSON.stringify(LAYOUT));
  mutate(doc.objects.find(o => o.id === target.id).geometry, doc);
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(doc), 'utf8');
  const r = spawnSync('node', ['src/build-scene.mjs'], { cwd: ROOT, env: { ...process.env, OUT_DIR: dir }, encoding: 'utf8' });
  let stats = null;
  const sf = path.join(dir, 'procedural-stats.json');
  if (r.status === 0 && fs.existsSync(sf)) stats = JSON.parse(fs.readFileSync(sf, 'utf8')).stats;
  return { code: r.status, out: (r.stdout || '') + '\n' + (r.stderr || ''), stats };
}

// 基线（同 layout 不变异）：全绿出口 + byKind.road / meshes 基准值
const base = runScene(() => {}, 'base');
ok(base.code === 0 && base.stats && base.stats.byKind.road > 0, 'JS 基线 build-scene EXIT 0 且有 road mesh',
  { code: base.code, road: base.stats && base.stats.byKind.road });

// E1：surfaceFootprint 置 null（该路本无 surfaceFootprints）→ build-scene 报错退出
const e1 = runScene(g => { g.surfaceFootprint = null; }, 'e1');
ok(e1.code !== 0 && e1.out.includes(`${target.id}: surfaceFootprint 存在但不是数组`),
  'JS E1 {"surfaceFootprint": null} 报错（退出非 0 + 报错点名 surfaceFootprint）',
  { code: e1.code, tail: e1.out.trim().split('\n').slice(-3).join(' | ') });

// E2：surfaceFootprints=[]（合法）+ surfaceFootprint="oops"（损坏）→ 先查两字段、仍报错
const e2 = runScene(g => { g.surfaceFootprints = []; g.surfaceFootprint = 'oops'; }, 'e2');
ok(e2.code !== 0 && e2.out.includes(`${target.id}: surfaceFootprint 存在但不是数组`),
  'JS E2 {"surfaceFootprints": [], "surfaceFootprint": "oops"} 报错（合法空数组不遮蔽损坏旧字段）',
  { code: e2.code, tail: e2.out.trim().split('\n').slice(-3).join(' | ') });

// L1：surfaceFootprints=[]（删旧字段，等价 {"surfaceFootprints": []}）→ EXIT 0 且该路不再产生 mesh
const l1 = runScene(g => { delete g.surfaceFootprint; g.surfaceFootprints = []; }, 'l1');
ok(l1.code === 0 && l1.stats && l1.stats.byKind.road === base.stats.byKind.road - 1
  && l1.stats.meshes === base.stats.meshes - 1,
  'JS L1 {"surfaceFootprints": []} 空几何（EXIT 0，byKind.road 与 meshes 恰各 -1）',
  { code: l1.code, road: l1.stats && l1.stats.byKind.road, base: base.stats.byKind.road,
    meshes: l1.stats && l1.stats.meshes, baseMeshes: base.stats.meshes });

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
if (fails) { console.error(`road-surface-contract: ${fails} fail`); process.exit(1); }
console.log('road-surface-contract: all pass');
