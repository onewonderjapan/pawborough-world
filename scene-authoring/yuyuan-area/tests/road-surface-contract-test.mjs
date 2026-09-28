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
// R3 可选（REVIEW-astra-R2）：审查内存验证的 7 组合法输入矩阵（Python 端逐字断言返回值，
//   核心咬合点是 [] 权威空几何 vs null 无权威回退的区分）与 surfaceFootprints:null 等类型负例
//   （N1-N5，两端对齐；JS 端另锁 build-scene 先查新字段后查旧字段的报错顺序）。
//
// 两端驱动方式（同 tests/fangbang-rounding-contract-test.mjs 的跨语言方式）：
//   Python 端：子进程 import scripts/road_surface.py 的 road_surface_footprints，直喂审查点名的合成 geometry；
//   JS 端：类型检查在 build-scene.mjs road 分支内联（不可 import），用临时 OUT_DIR + 当前重建 OUT_DIR
//   （process.env.OUT_DIR || 'out-zone'，R3 起支持绝对路径）的 layout.json 单路变异驱动（检查只看这两个字段，
//   变异后的 geometry 与合成用例等价）。合法空数组以 procedural-stats.json 的 byKind.road / meshes 计数证明
//   该路不再产生任何 mesh（= 空几何）。变异输出始终写独立临时目录，不写输入 OUT_DIR。
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
// R3（REVIEW-astra-R2 必修2）：输入 layout 从 OUT_DIR 解析（支持绝对路径；默认 out-zone）——
// 指定新 OUT_DIR 重建时不再回头读旧的 out-zone/layout.json。变异输出仍写独立临时目录（runScene）。
const IN_ZONE = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(IN_ZONE, 'layout.json'), 'utf8'));
const target = LAYOUT.objects.find(o => o.kind === 'road' && !o.skipRender
  && !FANGBANG_CLIP_IDS.includes(o.id)
  && Array.isArray(o.geometry.surfaceFootprint) && o.geometry.surfaceFootprint.length
  && !('surfaceFootprints' in o.geometry));
if (!target) { console.error('FAIL 找不到符合条件的变异目标路（有 surfaceFootprint、无 surfaceFootprints、非 skipRender）'); process.exit(1); }
console.log('变异目标路:', target.id);

// ---------- Python 端：合成 geometry 直喂 road_surface.road_surface_footprints ----------
// R3 可选（REVIEW-astra-R2）：把审查内存验证的 7 组合法输入矩阵与 surfaceFootprints:null 等
// 类型负例纳入测试，长期锁定两端一致性。矩阵特意区分「权威空几何 []」与「无权威 null
// （可走 ribbon 回退）」——Python 空列表是假值，`or` 式回退会把 M2 偷换成 M4/M6 的语义。
const RING = [[0, 0], [4, 0], [4, 2], [0, 2]];
const RING2 = [[10, 10], [14, 10], [14, 12], [10, 12]];
const PY_CASES = [
  { name: 'E1 {"surfaceFootprint": null} 报错', g: { surfaceFootprint: null }, want: 'raise', field: 'surfaceFootprint' },
  { name: 'E2 {"surfaceFootprints": [], "surfaceFootprint": "oops"} 报错', g: { surfaceFootprints: [], surfaceFootprint: 'oops' }, want: 'raise', field: 'surfaceFootprint' },
  { name: 'L1 {"surfaceFootprints": []} 返回空几何', g: { surfaceFootprints: [] }, want: 'empty' },
  // 合法输入矩阵（审查 R2 内存验证的 7 组；M2/M4-M7 的 [] vs null 区分是矩阵的核心咬合点）
  { name: 'M1 {"surfaceFootprints":[ring]} 新字段权威原样返回', g: { surfaceFootprints: [RING] }, want: 'value', value: [RING] },
  { name: 'M2 {"surfaceFootprints":[]} 权威空几何（不是回退）', g: { surfaceFootprints: [] }, want: 'value', value: [] },
  { name: 'M3 {"surfaceFootprint":ring} 旧单块 → [旧单块]', g: { surfaceFootprint: RING }, want: 'value', value: [RING] },
  { name: 'M4 {"surfaceFootprint":[]} 旧空数组=无旧面（NO_AUTHORITY）', g: { surfaceFootprint: [] }, want: 'none' },
  { name: 'M5 两字段都在：新字段权威、旧字段不再被读', g: { surfaceFootprints: [RING], surfaceFootprint: RING2 }, want: 'value', value: [RING] },
  { name: 'M6 两字段都不在（无 polyline）→ NO_AUTHORITY', g: {}, want: 'none' },
  { name: 'M7 两字段都不在（有 polyline）→ 仍 NO_AUTHORITY（ribbon 回退在消费方）', g: { polyline: [[0, 0], [4, 4]], width: 3 }, want: 'none' },
  // 类型负例扩充（surfaceFootprints:null 等；遮蔽关系下坏字段照样先被拒）
  { name: 'N1 {"surfaceFootprints": null} 报错', g: { surfaceFootprints: null }, want: 'raise', field: 'surfaceFootprints' },
  { name: 'N2 坏新字段(null)+合法旧字段：类型检查先于取面，照样报错', g: { surfaceFootprints: null, surfaceFootprint: RING }, want: 'raise', field: 'surfaceFootprints' },
  { name: 'N3 合法空数组+坏旧字段(null)：不遮蔽，照样报错', g: { surfaceFootprints: [], surfaceFootprint: null }, want: 'raise', field: 'surfaceFootprint' },
  { name: 'N4 {"surfaceFootprints": "oops"} 报错', g: { surfaceFootprints: 'oops' }, want: 'raise', field: 'surfaceFootprints' },
  { name: 'N5 {"surfaceFootprint": 0} 旧字段非数组报错', g: { surfaceFootprint: 0 }, want: 'raise', field: 'surfaceFootprint' },
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
  } else if (c.want === 'value') {   // 矩阵：返回值逐字等于期望（[] 是权威空几何，不是回退）
    ok(r.raised === false && JSON.stringify(r.value) === JSON.stringify(c.value), `Python ${c.name}`, r);
  } else if (c.want === 'none') {    // 矩阵：NO_AUTHORITY 恰为 null（区别于 M2 的 []）
    ok(r.raised === false && r.value === null, `Python ${c.name}`, r);
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

// M5'（矩阵的 JS 可观测面）：旧单块挪进新字段（ring 逐点同值）→ 计数与基线完全一致
//   （渲染结果按面几何定，mesh 计数相等 = 新权威路径消费了同一份面；配合 Python M5 逐字断言）。
const m5 = runScene(g => { g.surfaceFootprints = [g.surfaceFootprint]; }, 'm5');
ok(m5.code === 0 && m5.stats && m5.stats.byKind.road === base.stats.byKind.road
  && m5.stats.meshes === base.stats.meshes,
  'JS M5 旧单块挪进 surfaceFootprints=[旧ring]：计数与基线一致（新权威消费同一份面）',
  { code: m5.code, road: m5.stats && m5.stats.byKind.road, base: base.stats.byKind.road,
    meshes: m5.stats && m5.stats.meshes, baseMeshes: base.stats.meshes });

// 类型负例（R3 可选：surfaceFootprints:null 等；报错点名对应字段、退出非 0）
//   注意 build-scene 的检查顺序是先 surfaceFootprints 后 surfaceFootprint——N2/N3 也锁这个顺序。
const JS_NEGS = [
  { name: 'JS N1 {"surfaceFootprints": null}（删旧字段，单独出现）报错', mut: g => { delete g.surfaceFootprint; g.surfaceFootprints = null; }, field: 'surfaceFootprints' },
  { name: 'JS N2 坏新字段(null)+合法旧字段：照样报错（点名新字段）', mut: g => { g.surfaceFootprints = null; }, field: 'surfaceFootprints' },
  { name: 'JS N3 合法空数组+坏旧字段(null)：不遮蔽，报错点名旧字段', mut: g => { g.surfaceFootprints = []; g.surfaceFootprint = null; }, field: 'surfaceFootprint' },
  { name: 'JS N4 {"surfaceFootprints": "oops"} 报错', mut: g => { g.surfaceFootprints = 'oops'; }, field: 'surfaceFootprints' },
  { name: 'JS N5 {"surfaceFootprint": 0} 旧字段非数组报错', mut: g => { g.surfaceFootprint = 0; }, field: 'surfaceFootprint' },
];
JS_NEGS.forEach((n, i) => {
  const r = runScene(n.mut, `neg${i}`);
  ok(r.code !== 0 && r.out.includes(`${target.id}: ${n.field} 存在但不是数组`),
    n.name, { code: r.code, tail: r.out.trim().split('\n').slice(-2).join(' | ') });
});

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
if (fails) { console.error(`road-surface-contract: ${fails} fail`); process.exit(1); }
console.log('road-surface-contract: all pass');
