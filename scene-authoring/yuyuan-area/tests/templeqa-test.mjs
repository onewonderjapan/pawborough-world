// 庙区模块质量测试（wave5-templeqa Q2）：读 resources/temple-v3 的模块 GLB（管线输入）+ baseline/layout.json 实例。
// 用法：node tests/templeqa-test.mjs [--dir <模块目录>]；缺模块 GLB = 失败。
//  1) 非屋面构件不从瓦面「顶面」穿出（templeqa-lib roofClip 的 throughM：顶点高于该处最高覆盖面 > 0.01 m）。
//     覆盖面 = gray-pan-tile 节点非竖直三角；坐在屋面上的饰件、坡面根线 0.2 m 内照 hall-kit 口径豁免。
//     已知、未修且需主控定的件列在 KNOWN（节点 + 包围盒中心 ±0.05 m 认件），其余一律不许穿出。
//  2) 绕序与法线属性一致（三角几何法线 · 顶点法线 ≥ 0），闭合连通块无朝内的面（射线奇偶）。
//  3) 格扇底板材质 + 棂条朝向：有格扇 / 格窗的四座（大殿 / 仪门 / 配殿 / 后殿）底板用 lattice-backing，底色 sRGB #55483c（hall-kit
//     latticeBackSrgb，±2），且确有节点在用；不许再是 deep-door-lacquer 黑板（立面明度的渲染验收见 scripts/templeqa-render.py --facade）。
//  4) 实例位姿只认 baseline/layout.json（templeqa-lib.templeInstances），模块文件从 scripts/assemble.py MODULE_FILE 取。
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './templeqa-lib.mjs';

const args = process.argv.slice(2);
const DIR = path.resolve(args.indexOf('--dir') >= 0 ? args[args.indexOf('--dir') + 1] : Q.TEMPLE_V3);
let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('ok  ', name); }
  else { fail++; failures.push(name); console.log('FAIL', name, extra); }
};

// 需主控决定、本单未改的穿出件（节点, 包围盒中心 [x,y,z] 模块本地）——见 artifacts/q1/FINDINGS.md
const KNOWN = [
  // 山门：中段 / 肩部交接的深色封口板（seam trim、前檐额板两端）按设计压在瓦面上，穿出 0.16 / 0.28 m
  { file: 'temple.glb', node: 'shanmen-body__deep-door-lacquer', c: [-2.5, 6.49, -1.7], why: 'seam trim board over the shoulder valley (design trim)' },
  { file: 'temple.glb', node: 'shanmen-body__deep-door-lacquer', c: [2.5, 6.49, -1.7], why: 'seam trim board over the shoulder valley (design trim)' },
  { file: 'temple.glb', node: 'shanmen-body__deep-door-lacquer', c: [0, 5.6, -0.13], why: 'front frieze band ends under the shoulder eaves' },
  // 戏台：两侧白墩顶 7.4 高出戏台屋面 0.048
  { file: 'yimen-stage.glb', node: 'yimen-stage-body__weathered-lime-plaster', c: [-1.96, 6.65, -7.25], why: 'stage pier cap 0.048 above the stage roof' },
  { file: 'yimen-stage.glb', node: 'yimen-stage-body__weathered-lime-plaster', c: [1.96, 6.65, -7.25], why: 'stage pier cap 0.048 above the stage roof' },
];
const isKnown = (file, v) => KNOWN.some((k) => k.file === file && k.node === v.node
  && [0, 1, 2].every((c) => Math.abs((v.bbox[0][c] + v.bbox[1][c]) / 2 - k.c[c]) <= 0.05));

const MF = Q.moduleFileMap();
const files = [...new Set(Object.values(MF))];
const missing = files.filter((f) => !fs.existsSync(path.join(DIR, f)));
ok(`模块 GLB 齐全（${files.length}）`, !missing.length, missing.join(','));
if (missing.length) process.exit(1);
const insts = Q.templeInstances();
ok(`layout 实例 16 个、全部映射到模块文件`, insts.length === 16 && insts.every((i) => files.includes(i.file)), String(insts.length));

const LATTICE = ['dadian.glb', 'yimen.glb', 'peidian.glb', 'houdian.glb'];
const toS = (c) => { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(v * 255); };
for (const f of files) {
  const mod = Q.readModule(path.join(DIR, f));
  const c = Q.roofClip(mod);
  const through = c.violations.filter((v) => v.throughM > Q.CLIP_TOL);
  const unknown = through.filter((v) => !isKnown(f, v));
  const worst = unknown.reduce((m, v) => Math.max(m, v.throughM), 0);
  ok(`${f} 非屋面构件不从瓦面顶穿出（未登记 ${unknown.length} 件，最大 ${worst.toFixed(3)} m；已登记 ${through.length - unknown.length} 件）`,
    unknown.length === 0, unknown.slice(0, 4).map((v) => `${v.node} +${v.throughM} at ${v.throughAt}`).join(' | '));
  const b = Q.backfaces(mod);
  const wn = b.reduce((s, x) => s + x.windingVsNormal.tris, 0);
  const inw = b.reduce((s, x) => s + x.closed.inwardTris, 0);
  const inwA = b.reduce((s, x) => s + x.closed.inwardAreaM2, 0);
  ok(`${f} 绕序与法线一致（不一致 ${wn} 面）`, wn === 0);
  ok(`${f} 闭合块无朝内面（${inw} 面 ${inwA.toFixed(3)} m²）`, inw === 0);
  if (LATTICE.includes(f)) {
    const mat = (mod.json.materials || []).find((m) => m.name === 'lattice-backing');
    const bc = mat?.pbrMetallicRoughness?.baseColorFactor;
    const got = bc ? bc.slice(0, 3).map(toS) : null;
    const want = [0x55, 0x48, 0x3c];
    const used = mod.nodes.some((n) => n.mat === 'lattice-backing' && n.T.length);
    ok(`${f} 格扇底板 lattice-backing = sRGB #55483c 且在用（实得 ${got ? got.join(',') : '无'}，在用 ${used}）`,
      !!got && got.every((v, i) => Math.abs(v - want[i]) <= 2) && used);
    // 棂条 / 抹头 / 边梃（oxblood-stained-timber 细长块）必须站在底板正面之前（模块正面 = +Z）：
    // 每块底板的 x/y 范围内、z 离底板 0.3 m 内的木构件，至少 3 件的前表面比底板前表面更靠前 ≥ 5 mm。
    const back = mod.nodes.find((n) => n.mat === 'lattice-backing');
    const wood = mod.nodes.find((n) => n.mat === 'oxblood-stained-timber');
    let bays = 0, baysOk = 0, worstFront = Infinity;
    if (back && wood) {
      const wi = Q.islands(wood).list;
      // 底板 = lattice-backing 里厚 ≥ 0.08 m 的块（0.1 m 板）；0.045–0.05 m 的裙板不算底板
      for (const B of Q.islands(back).list.filter((I) => I.max[2] - I.min[2] >= 0.08)) {
        bays++;
        const inBay = wi.filter((W) => W.min[0] >= B.min[0] - 0.06 && W.max[0] <= B.max[0] + 0.06 && W.min[1] >= B.min[1] - 0.12
          && W.max[1] <= B.max[1] + 0.12 && W.max[2] > B.min[2] - 0.3 && W.min[2] < B.max[2] + 0.3);
        const ahead = inBay.filter((W) => W.max[2] >= B.max[2] + 0.005).length;
        worstFront = Math.min(worstFront, ahead);
        if (ahead >= 3) baysOk++;
      }
    }
    ok(`${f} 格扇木构件在底板正面之前（${baysOk}/${bays} 块底板前有 ≥3 件木构件；最少 ${isFinite(worstFront) ? worstFront : 0}）`,
      bays > 0 && baysOk === bays);
  }
}
console.log(`\ntempleqa-test: ${pass} pass, ${fail} fail (${DIR})`);
if (fail) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
