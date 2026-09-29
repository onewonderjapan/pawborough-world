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

// ---------------------------------------------------------------------------
// R1 补强断言（lead review 必修2）：原探针只查前后檐角部水平射线，三个盲区放过
// 了真实回归——R0 的内缘封板面朝反，浏览器 FrontSide 下 pv05 上檐下透天缝，
// 10/10 仍绿。新增：
//   N1 四侧封口带：前后檐全宽（含中段+角部）+ 左右 hip 端侧向射线（三个条带建筑）
//   N2 dadian 基座悬空带（审查口径 y≈5.43–5.80）侧向射线，命中必须落在基座裙板
//      附近（远处几何不算封住）
//   N3 dadian pv05 漏点单面斜射线：模拟查看器 FrontSide（背面命中不算），命中
//      必须落在上檐条带内缘压低段域内
// 负例（env EAVE_LEAK_NEGCASE）：1 = 内存移除基座裙板三角（N2 必须红）；
// 2 = 翻转内缘压低面绕序（N3 必须红）。默认 0 = 正例。
const NEG = parseInt(process.env.EAVE_LEAK_NEGCASE || '0', 10);
const triN = (t) => {
  const e1 = [t.v[3] - t.v[0], t.v[4] - t.v[1], t.v[5] - t.v[2]];
  const e2 = [t.v[6] - t.v[0], t.v[7] - t.v[1], t.v[8] - t.v[2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
};
const triArea = (t) => { const n = triN(t); return Math.hypot(n[0], n[1], n[2]) / 2; };
const rayHitPoint = (tris, o, d) => {
  const s = rayFront(tris, o, d);
  return s == null ? null : [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
};
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * (n === 1 ? 0 : i / (n - 1)));

// dadian 实测锚点（审查口径 + GLB 实测）：基座悬空带 y 5.43–5.80；上檐条带
// 内缘钳到墙顶线下 2cm = 6.98（R0 登记值，GLB 观测压低面 y 6.84–6.99）；基座
// 裙板面 |x|≈11.16 / |z|≈12.01 / 前沿 z≈0.01
const DD = { bandLo: 5.43, bandHi: 5.80, capY: 6.98, apronX: 11.16, apronRearZ: -12.01, apronFrontZ: 0.01 };

// 基座裙板三角识别：竖直、位于裙板高度带与四条面线附近、非碎片
function isApronTri(t) {
  const n = triN(t);
  const l = Math.hypot(...n); if (l < 1e-12) return false;
  if (Math.abs(n[1]) / l > 0.3) return false;
  const y = (t.lo[1] + t.hi[1]) / 2;
  if (y < 5.35 || y > 6.0) return false;
  if (triArea(t) < 0.08) return false;
  const cx = (t.lo[0] + t.hi[0]) / 2, cz = (t.lo[2] + t.hi[2]) / 2;
  return Math.abs(Math.abs(cx) - DD.apronX) < 0.35 ||
         Math.abs(Math.abs(cz - DD.apronRearZ)) < 0.35 ||
         Math.abs(cz - DD.apronFrontZ) < 0.35;
}
// 上檐条带内缘压低段域窗：y 贴墙顶线（capY 6.98）、z 在前后檐条带带内
function isInnerEdgeZone(t) {
  const n = triN(t);
  const l = Math.hypot(...n); if (l < 1e-12) return false;
  if (Math.abs(n[0]) / l > 0.35) return false;
  const y = (t.lo[1] + t.hi[1]) / 2;
  if (y < DD.capY - 0.15 || y > DD.capY + 0.35) return false;
  const cz = (t.lo[2] + t.hi[2]) / 2;
  return (cz > 0.05 && cz < 1.45) || (cz < -12.0 && cz > -13.45);
}
// 负例2 的翻转目标：域窗内「当前朝下外（ny<0.02 且朝檐外）」的压低面——翻回
// R0 的朝上朝向；窗内原本朝内/朝上的面不动，避免「背面翻正面」让负例失效。
function isInnerEdgeTri(t) {
  if (!isInnerEdgeZone(t)) return false;
  const n = triN(t);
  const l = Math.hypot(...n);
  const ny = n[1] / l, nz = n[2] / l;
  const cz = (t.lo[2] + t.hi[2]) / 2;
  const outward = cz > 0 ? 1 : -1;
  return ny < 0.02 && nz * outward > 0.5;
}

const STRIP_BUILDINGS = BUILDINGS.filter((b) => ['dadian', 'yimen-pilot', 'temple-shanmen'].includes(b.mod));
for (const b of STRIP_BUILDINGS) {
  const tris = buildTris(b);
  if (!tris) continue;
  const cfg = cfgOf(b.cfg);
  for (const shellPath of b.shells) {
    const rf = at(cfg, shellPath);
    const lift = rf.cornerLiftM || 0;
    const hw = rf.widthM / 2;
    const eaveY = rf.eaveY ?? rf.frontEaveY;
    const yLevels = [eaveY - 0.02, eaveY + lift * 0.5, eaveY + lift + 0.12];
    // 侧向探针只锚条带端角域（檐口下皮以下 2/7/12cm）：端面 endcap（顶=檐口
    // 线、底=裙边底线-2cm）的覆盖带；更高处的端缘（肩部屋顶/山面）与更深处的
    // 墙体凹槽非本构件职责。
    const yLevelsSide = [eaveY - 0.02, eaveY - 0.07, eaveY - 0.12];
    const miss = [];
    let n = 0;
    // 前 / 后檐：x 全宽（含中段与角部）。漏的特征 = 越过封口深度带深入
    // （封口厚度的 2 倍之外）；撞檐口/屋面外皮属正常遮挡，不算漏。
    for (const [tag, from, sgn] of [['front', OUT, -1], ['rear', -OUT, 1]]) {
      const zEnd = tag === 'front' ? rf.frontEaveZ : rf.rearEaveZ;
      for (const x of linspace(-hw + 0.3, hw - 0.3, 19)) {
        for (const y of yLevels) {
          n++;
          const p = rayHitPoint(tris, [x, y, from], [0, 0, sgn]);
          const beyond = p && (p[2] - zEnd) * sgn > rf.soffitDepthM * 2 + 0.4;
          if (!p || beyond) {
            miss.push(`${tag} x=${x.toFixed(1)} y=${y.toFixed(2)}${p ? ` 命中远处 z=${p[2].toFixed(1)}` : ' 无正面命中'}`);
          }
        }
      }
    }
    // 左 / 右 hip 端侧向。漏的特征 = 射线穿过端部进入对侧半空间或无命中；
    // 命中起点同侧半空间内的端面 / 翼墙（山门翼墙在 |x|≈4.6，端外 ≈2.3m）属正常遮挡。
    for (const [tag, from, sgn] of [['left', OUT, -1], ['right', -OUT, 1]]) {
      for (const z of linspace(rf.rearEaveZ + 0.3, rf.frontEaveZ - 0.3, 7)) {
        for (const y of yLevelsSide) {
          n++;
          const p = rayHitPoint(tris, [from, y, z], [sgn, 0, 0]);
          const blocked = p && p[0] * from > 0 && Math.abs(p[0]) <= hw + 3.5;
          if (!p || !blocked) {
            miss.push(`${tag} z=${z.toFixed(1)} y=${y.toFixed(2)}${p ? ` 命中 x=${p[0].toFixed(1)}（穿到对侧/超窗）` : ' 无正面命中'}`);
          }
        }
      }
    }
    ok(`${b.mod} ${shellPath}: 四侧封口带无穿透（N1, ${n} 射线）`, miss.length === 0,
      miss.length ? `\n  ${miss.slice(0, 8).join('\n  ')}` : '');
  }
}

// N2+N3 只探 dadian（审查口径的基座悬空带与 pv05 漏点都在大殿）
{
  const b = BUILDINGS[0];
  const cfg = cfgOf(b.cfg);
  const up = at(cfg, 'roofUpper');
  let tris = buildTris(b);
  if (tris) {
    const apronCount = tris.filter(isApronTri).length;
    if (NEG === 1) {
      const before = tris.length;
      tris = tris.filter((t) => !isApronTri(t));
      console.log(`# negcase1: 移除基座裙板三角 ${before - tris.length}（识别 ${apronCount}）`);
    } else if (NEG === 2) {
      let flipped = 0;
      tris = tris.map((t) => {
        if (!isInnerEdgeTri(t)) return t;
        flipped++;
        const v = [t.v[0], t.v[1], t.v[2], t.v[6], t.v[7], t.v[8], t.v[3], t.v[4], t.v[5]];
        return { v, lo: t.lo, hi: t.hi };
      });
      console.log(`# negcase2: 翻转内缘面三角 ${flipped}`);
    }

    // N2 基座悬空带：复刻 pv05 漏光路径——殿前低处斜向上，穿过下檐檐口下方，
    // 打在前沿基座裙板（悬空带开口 z≈0.01、y 5.43–5.80）。命中必须落在裙板
    // 1.2m 内（远处几何不算封住）。侧向被下檐壳端部真实遮挡，不设探针。
    {
      const miss = [];
      let n = 0;
      for (const x of [-8, -4, 0, 4, 8]) {
        n++;
        const eye = [x, 3.7, DD.apronFrontZ + 26];
        const tgt = [x, 5.6, DD.apronFrontZ];
        const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
        const dl = Math.hypot(...d);
        const p = rayHitPoint(tris, eye, d.map((v) => v / dl));
        const near = p && tris.some((t) => isApronTri(t) &&
          dist2(p, [(t.lo[0] + t.hi[0]) / 2, (t.lo[1] + t.hi[1]) / 2, (t.lo[2] + t.hi[2]) / 2]) < 1.2);
        if (!p || !near) miss.push(`x=${x}${p ? ` 命中(${p.map(v => v.toFixed(1))}) 不在裙板附近` : ' 无正面命中（穿悬空带出天）'}`);
      }
      ok(`dadian: 基座悬空带(${DD.bandLo}–${DD.bandHi}) 封住（N2, ${n} 射线, 裙板 ${apronCount} tri）`, miss.length === 0,
        miss.length ? `\n  ${miss.slice(0, 6).join('\n  ')}` : '');
    }

    // N3 pv05 漏点单面斜射线：压低段法向近距入射——起点在条带带内、沿修复后
    // 压低面法线（朝下外）反向 0.35m 处，正面打向压低段（y 贴 capY 6.98，檐口
    // 内 0.02–0.45m）。判定域与 NEG=2 的翻转集合同域：负例2 把压低面翻回 R0
    // 朝向后，射线打背面穿透，本断言必须红。
    {
      const miss = [];
      let n = 0;
      for (const [tag, zEnd, sgn] of [['front', up.frontEaveZ, 1], ['rear', up.rearEaveZ, -1]]) {
        for (const x of linspace(-9, 9, 7)) {
          n++;
          const pT = [x, DD.capY + 0.04, zEnd - sgn * 0.18];
          const nrm = [0, -0.11, sgn * 0.99];
          const nl = Math.hypot(...nrm);
          const eye = [pT[0] - nrm[0] * 0.35, pT[1] - nrm[1] * 0.35, pT[2] - nrm[2] * 0.35];
          const p = rayHitPoint(tris, eye, nrm.map((v) => v / nl));
          const depthIn = (zEnd - p[2]) * sgn;
          const inCapBand = p && p[1] > DD.capY - 0.15 && p[1] < DD.capY + 0.35 &&
            depthIn > 0.02 && depthIn < 0.45;
          if (!p || !inCapBand) miss.push(`${tag} x=${x.toFixed(1)}${p ? ` 命中(${p.map(v => v.toFixed(1))}) 不在压低段域` : ' 无正面命中（穿封板出天）'}`);
        }
      }
      ok(`dadian: pv05 漏点单面斜射线封住（N3, ${n} 射线）`, miss.length === 0,
        miss.length ? `\n  ${miss.slice(0, 6).join('\n  ')}` : '');
    }

    // N4 压低段朝向审计（R1 lead review 缺陷本体）：压低段域内不得有「朝上且
    // 朝檐内」的三角——R0 的 (0,0.108,-0.994) 法线即此类，浏览器 FrontSide
    // 剔除后成透天缝。负例2 翻转压低面后本断言必须红。
    {
      const bad = [];
      for (const t of tris) {
        if (!isInnerEdgeZone(t)) continue;
        const N = triN(t);
        const l = Math.hypot(...N); if (l < 1e-12) continue;
        const ny = N[1] / l, nz = N[2] / l;
        const cz = (t.lo[2] + t.hi[2]) / 2;
        const outward = cz > 0 ? 1 : -1;
        if (ny > 0.02 && nz * outward < -0.5) {
          bad.push(`y=${((t.lo[1] + t.hi[1]) / 2).toFixed(2)} z=${cz.toFixed(2)} n=(${(N[0] / l).toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)})`);
        }
      }
      ok(`dadian: 压低段无朝上朝内面（N4, ${bad.length} 个）`, bad.length === 0,
        bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : '');
    }
  }
}

console.log(`\ntemple-eave-leak: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
