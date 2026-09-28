// 庙区檐口透缝测试（wave13-templefix T1）：对带角部起翘（cornerLiftM）的屋面壳，
// 从檐口外侧略低处水平射向屋内的射线必须命中正面几何（屋面 / 封檐板 / 檐口底板 / 墙面），
// 不得穿透到天空。背景：平底盒檐口底板不随角部起翘抬起，起翘段留下楔形天空缝
// （wave13-nightqa 报告第 2 条，pv05 点选射线穿缝返回 null）。
// 口径：
//   - 读 resources/temple-v3 的模块 GLB（管线输入）+ kit/<name>.config.json 的屋面参数；
//   - 探针带：x ∈ [max(liftX0−0.6, HW−1.5), HW−0.05]（左右两侧），z ∈ [eaveY−0.02, eaveY+lift+0.15]，
//     前 / 后檐各一排，起点在模块外 ±30 m；
//   - 命中判定 = 正面（CCW）三角，与查看器单面材质一致：穿缝射线在模块里没有正面命中 = 露天；
//   - 起翘为 0 的硬山（后殿 / 配殿）同样探（带收窄到 eaveY+0.15），作为同类构件回归护栏。
// 用法：node tests/temple-eave-leak-test.mjs [--dir <模块目录>]
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './templeqa-lib.mjs';

const args = process.argv.slice(2);
const DIR = path.resolve(args.indexOf('--dir') >= 0 ? args[args.indexOf('--dir') + 1] : Q.TEMPLE_V3);
const KIT = path.join(Q.ROOT, '..', '..', 'kit');

// 模块 → (GLB 文件, 配置, 屋面壳列表)。壳字段取自各自 config 的实际键名。
const BUILDINGS = [
  { mod: 'dadian', file: 'dadian.glb', cfg: 'dadian.config.json', shells: ['roofLower', 'roofUpper'] },
  { mod: 'yimen-pilot', file: 'yimen.glb', cfg: 'yimen.config.json', shells: ['roof'] },
  { mod: 'temple-shanmen', file: 'temple.glb', cfg: 'temple-shanmen.config.json', shells: ['roof.center'] },
  { mod: 'houdian', file: 'houdian.glb', cfg: 'houdian.config.json', shells: ['roof'] },
  { mod: 'peidian', file: 'peidian.glb', cfg: 'peidian.config.json', shells: ['roof'] },
];

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('ok  ', name); }
  else { fail++; failures.push(name); console.log('FAIL', name, extra); }
};

// 全模块三角形摊平 + 每三角 AABB，正面（CCW）命中才计数（与查看器单面材质一致）
function buildTris(mod) {
  const file = path.join(DIR, mod.file);
  if (!fs.existsSync(file)) return null;
  const m = Q.readModule(file);
  const tris = [];
  for (const n of m.nodes) {
    const { P, T } = n;
    for (let k = 0; k + 2 < T.length; k += 3) {
      const a = T[k] * 3, b = T[k + 1] * 3, c = T[k + 2] * 3;
      const tri = [P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]];
      tris.push({
        v: tri,
        lo: [Math.min(tri[0], tri[3], tri[6]), Math.min(tri[1], tri[4], tri[7]), Math.min(tri[2], tri[5], tri[8])],
        hi: [Math.max(tri[0], tri[3], tri[6]), Math.max(tri[1], tri[4], tri[7]), Math.max(tri[2], tri[5], tri[8])],
      });
    }
  }
  return tris;
}

// 正面射线：返回最近正面命中距离或 null
function rayFront(tris, o, d) {
  let best = Infinity;
  for (const t of tris) {
    if (o[0] < t.lo[0] && d[0] <= 0) continue; // 粗筛：射线不进三角 AABB 就跳过（按轴精确判断在下面）
    let okBox = true;
    for (let k = 0; k < 3 && okBox; k++) {
      if (Math.abs(d[k]) < 1e-12) { if (o[k] < t.lo[k] || o[k] > t.hi[k]) okBox = false; }
      else {
        let ta = (t.lo[k] - o[k]) / d[k], tb = (t.hi[k] - o[k]) / d[k];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (tb < 0 || ta > best) okBox = false;
      }
    }
    if (!okBox) continue;
    const A = [t.v[0], t.v[1], t.v[2]], B = [t.v[3], t.v[4], t.v[5]], C = [t.v[6], t.v[7], t.v[8]];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0];
    const det = e1[0] * px + e1[1] * py + e1[2] * pz;
    if (det <= 1e-12) continue; // 背面 / 平行：单面材质看不见
    const inv = 1 / det;
    const tx = o[0] - A[0], ty = o[1] - A[1], tz = o[2] - A[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1[2] - tz * e1[1], qy = tz * e1[0] - tx * e1[2], qz = tx * e1[1] - ty * e1[0];
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const s = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
    if (s > 1e-6 && s < best) best = s;
  }
  return Number.isFinite(best) ? best : null;
}

const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(KIT, name), 'utf8'));
const at = (o, k) => k.split('.').reduce((a, key) => a[key], o);

const DX = 0.05, DZ = 0.04, OUT = 30;
for (const b of BUILDINGS) {
  const tris = buildTris(b);
  if (!tris) { ok(`${b.mod}: 模块 GLB 存在`, false, `missing ${b.file}`); continue; }
  ok(`${b.mod}: 模块 GLB 存在 (${tris.length} tris)`, true);
  const cfg = cfgOf(b.cfg);
  let missTotal = 0;
  const missLines = [];
  for (const shellPath of b.shells) {
    const rf = at(cfg, shellPath);
    const lift = rf.cornerLiftM || 0;
    const hw = rf.widthM / 2;
    const eaveY = rf.eaveY ?? rf.frontEaveY;
    const zMid = rf.ridgeLocalZ ?? rf.ridgeZ;
    const thick = rf.shellThicknessM;
    const x0 = Math.max((rf.cornerLiftXStartsM ?? rf.cornerLiftStartX ?? hw) - 0.6, hw - 1.5);
    const x1 = hw - 0.05;
    const z0 = eaveY - 0.02;
    const z1 = eaveY + lift + 0.15;
    const nx = Math.max(2, Math.round((x1 - x0) / DX) + 1);
    const nz = Math.max(2, Math.round((z1 - z0) / DZ) + 1);
    for (const [tag, from, sgn] of [['front', OUT, -1], ['rear', -OUT, 1]]) {
      const zEnd = tag === 'front' ? rf.frontEaveZ : rf.rearEaveZ;
      for (let iz = 0; iz < nz; iz++) {
        const z = z0 + (z1 - z0) * iz / (nz - 1);
        for (let ix = 0; ix < nx; ix++) {
          for (const side of [-1, 1]) {
            const x = side * (x0 + (x1 - x0) * ix / (nx - 1));
            const o = [x, z, from];
            const d = [0, 0, sgn];
            const hit = rayFront(tris, o, d);
            if (hit == null) {
              missTotal++;
              if (missLines.length < 12) missLines.push(
                `${b.mod} ${shellPath} ${tag} x=${x.toFixed(2)} z=${z.toFixed(2)} 起点 z_local=${from} 无正面命中（露天）`);
            }
          }
        }
      }
      void zEnd; void zMid; void thick;
    }
  }
  ok(`${b.mod}: 檐口探针带无穿透（${missTotal} 条穿缝射线）`, missTotal === 0, `\n  ${missLines.join('\n  ')}`);
}

console.log(`\ntemple-eave-leak: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
