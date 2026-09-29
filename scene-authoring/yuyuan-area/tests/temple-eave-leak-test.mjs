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
// R2 补强（lead review R2 必修3）：
//   - N1 封口深度不再读 rf.soffitDepthM（仪门/山门 config 无此字段 → NaN 让限制静默失效），
//     改用显式封口窗表 CAP_WINDOWS（值取自 build_*.py eave_soffit_strip 实参 / config），缺键即 FAIL；
//     侧向判定补内侧距离下界（命中必须落在端面封板附近，深入内侧即漏）。
//   - N3 重写：固定 pv05 相机（OUT_DIR/pv-cameras.json 的 pv05-dadian-rise 第 48 帧=fmid）
//     与原漏点像素（审查三点 (100,440)/(200,440)/(1250,440) + 前檐中段三点）按查看器口径
//     （46° 垂直 FOV、1400×900）构造 FrontSide 射线，命中必须落在实际封板域内；
//     模块 GLB 经 baseline 实例位姿转到世界坐标求交（与分区件/查看器同口径）。
//   - N4 压低段域窗 y 过滤改「三角任一顶点」落入（中点标准漏掉顶点 6.98–7.84 的陡坡面），
//     并断言压低段陡坡三角存在（≥64，审查实测前后檐 128 = 64/檐）。
//   - 负例③ EAVE_LEAK_NEGCASE=3：移除前后檐实际压低段陡坡三角（实测 128）→ N3 必须 FAIL
//     （审查口径：移除后 pv05 三像素全部恢复无正面命中，旧 N3 探针对此不敏感）。
//   - 浏览器实际资产守卫：对 OUT_DIR（默认 out-zone）的 zone-temple-2.glb 与压缩件
//     zone-temple-2.cm.glb 跑同口径 pv05 射线（世界坐标直接求交，压缩件走 meshopt 解压），
//     缺文件即 FAIL——查看器优先吃分区/压缩件（web/main.js loadZoneFiles），模块绿不等于交付绿。
// 用法：node tests/temple-eave-leak-test.mjs [--dir <模块目录>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as Q from './templeqa-lib.mjs';

const require = createRequire(import.meta.url);

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
// 2 = 翻转内缘压低面绕序（N3/N4 必须红）；
// 3 = 移除前后檐实际压低段陡坡三角（isCapSteepTri，审查口径 R2 实测 128=64/檐，
//     移除后 pv05 漏点像素全部恢复无正面命中）→ N3 必须红。默认 0 = 正例。
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
// 上檐条带内缘压低段域窗：y 贴墙顶线（capY 6.98）、z 在前后檐条带带内。
// R2 必修3：y 过滤改「三角任一顶点」落窗——原漏点三角顶点高 6.98–7.84、
// 中点 7.41，旧中点标准把关键压低面排除了（审查实测 17/17 绿下 N4 漏检）。
function isInnerEdgeZone(t) {
  const n = triN(t);
  const l = Math.hypot(...n); if (l < 1e-12) return false;
  if (Math.abs(n[0]) / l > 0.35) return false;
  const yIn = t.v[1] >= DD.capY - 0.15 && t.v[1] <= DD.capY + 0.35 ||
              t.v[4] >= DD.capY - 0.15 && t.v[4] <= DD.capY + 0.35 ||
              t.v[7] >= DD.capY - 0.15 && t.v[7] <= DD.capY + 0.35;
  if (!yIn) return false;
  const cz = (t.lo[2] + t.hi[2]) / 2;
  return (cz > 0.05 && cz < 1.45) || (cz < -12.0 && cz > -13.45);
}
// 实际压低段陡坡面：域窗内法线明显陡于望板缓坡（ny ∈ [−0.25,−0.02]，修复后
// 压低面实测 ny≈−0.11）且朝檐外。负例③的移除集、N4 的存在断言（R2 实测
// 前后檐 128 = 审查口径 64/檐）、N3 的命中面特征都锚这一定义。
function isCapSteepTri(t) {
  if (!isInnerEdgeZone(t)) return false;
  const n = triN(t);
  const l = Math.hypot(...n);
  const ny = n[1] / l, nz = n[2] / l;
  const cz = (t.lo[2] + t.hi[2]) / 2;
  const outward = cz > 0 ? 1 : -1;
  return ny >= -0.25 && ny <= -0.02 && nz * outward > 0.5;
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

// 显式封口窗表（R2 必修3：rf.soffitDepthM 在 yimen/shanmen config 不存在，NaN 让 N1 的
// 「越过封口深度」限制静默失效——审查实测 17/17 绿下 N3 漏报）。值出处：
//   dadian roofLower/roofUpper = config soffitDepthM（build_dadian.py sd=rf['soffitDepthM']，前后檐同值）
//   yimen front/rear = build_yimen.py:455-456 实参 0.8 / 0.77
//   shanmen center front/rear = build_temple_shanmen.py:463-464 实参 0.69 / 0.42
//   sideOuter = 侧向命中窗外界：端面 endcap 在 |x|=hw，shanmen 翼墙 |x|≈4.6=hw+2.3
//   也须在窗内。内侧下界见 N1 侧向段（按探针 z 是否在条带 z 带分档）。缺失条目即 FAIL。
const CAP_WINDOWS = {
  'dadian roofLower': { front: 1.3, rear: 1.3, sideOuter: 3.5 },
  'dadian roofUpper': { front: 1.3, rear: 1.3, sideOuter: 3.5 },
  'yimen-pilot roof': { front: 0.8, rear: 0.77, sideOuter: 3.5 },
  'temple-shanmen roof.center': { front: 0.69, rear: 0.42, sideOuter: 3.5 },
};

const STRIP_BUILDINGS = BUILDINGS.filter((b) => ['dadian', 'yimen-pilot', 'temple-shanmen'].includes(b.mod));
for (const b of STRIP_BUILDINGS) {
  const tris = buildTris(b);
  if (!tris) continue;
  const cfg = cfgOf(b.cfg);
  for (const shellPath of b.shells) {
    const cap = CAP_WINDOWS[`${b.mod} ${shellPath}`];
    ok(`${b.mod} ${shellPath}: 封口窗显式配置存在`, !!cap,
      cap ? '' : 'CAP_WINDOWS 缺条目（封口深度/侧向窗必须显式给出，缺失即 FAIL）');
    if (!cap) continue;
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
      const capD = tag === 'front' ? cap.front : cap.rear;
      for (const x of linspace(-hw + 0.3, hw - 0.3, 19)) {
        for (const y of yLevels) {
          n++;
          const p = rayHitPoint(tris, [x, y, from], [0, 0, sgn]);
          const beyond = p != null && (p[2] - zEnd) * sgn > capD * 2 + 0.4;
          if (p == null || beyond) {
            miss.push(`${tag} x=${x.toFixed(1)} y=${y.toFixed(2)}${p ? ` 命中远处 z=${p[2].toFixed(1)}` : ' 无正面命中'}`);
          }
        }
      }
    }
    // 左 / 右 hip 端侧向（x>0 为观察者左、x<0 为右：模块 +Z 朝街=观察方向，
    // 朝 +z 看时屏幕右方是 −x）。内侧距离下界按探针 z 分档（R2 必修3）：
    //   条带 z 带内（endcap 覆盖域，±0.1 裕量）：命中必须贴端面 [hw−0.35, hw+sideOuter]，
    //     深入端面内侧 0.35m 之外 = 端面缺失射线穿进内部，算漏；
    //   带外（侧坡中段）：无 endcap 职责，庑殿翼缘/壳体下缘本就内收（实测 dadian
    //     roofLower 命中 hw−2.3、yimen hw−0.8，为壳体几何非漏点），下界放宽到 hw−3.0，
    //     仍拦「穿到对侧」与「穿进殿内深处」。
    const inCapZ = (zv) => Math.abs(zv - rf.frontEaveZ) <= cap.front + 0.1 || Math.abs(zv - rf.rearEaveZ) <= cap.rear + 0.1;
    for (const [tag, from, sgn] of [['left', OUT, -1], ['right', -OUT, 1]]) {
      for (const z of linspace(rf.rearEaveZ + 0.3, rf.frontEaveZ - 0.3, 7)) {
        for (const y of yLevelsSide) {
          n++;
          const p = rayHitPoint(tris, [from, y, z], [sgn, 0, 0]);
          const si = inCapZ(z) ? 0.35 : 3.0;
          const blocked = p != null && p[0] * from > 0 &&
            Math.abs(p[0]) >= hw - si && Math.abs(p[0]) <= hw + cap.sideOuter;
          if (p == null || !blocked) {
            miss.push(`${tag} z=${z.toFixed(1)} y=${y.toFixed(2)}${p != null ? ` 命中 x=${p[0].toFixed(1)}（对侧/超窗 [${(hw - si).toFixed(2)}, ${(hw + cap.sideOuter).toFixed(2)}] 内侧深入或过远）` : ' 无正面命中'}`);
          }
        }
      }
    }
    ok(`${b.mod} ${shellPath}: 四侧封口带无穿透（N1, ${n} 射线）`, miss.length === 0,
      miss.length ? `\n  ${miss.slice(0, 8).join('\n  ')}` : '');
  }
}

// ---------- R2：pv05 相机口径（N3 与 zone 资产断言共用） ----------
// 像素集：审查三漏点像素 + 前檐中段三点（1400×900）。
const PV05_PIXELS = [[100, 440], [200, 440], [1250, 440], [500, 440], [700, 440], [900, 440]];
// 相机：OUT_DIR/pv-cameras.json 的 pv05-dadian-rise 第 48 帧（96 帧中点 = fmid）。
let pv05 = null, pv05Err = null;
try {
  const pv = JSON.parse(fs.readFileSync(path.join(Q.ROOT, process.env.OUT_DIR || 'out-zone', 'pv-cameras.json'), 'utf8'));
  const shot = pv.shots.find((s) => s.id === 'pv05-dadian-rise');
  if (!shot) throw new Error('pv-cameras.json 无 pv05-dadian-rise 条目');
  if (!shot.eye || shot.eye.length < 49) throw new Error('pv05 帧数不足 49（fmid=48 不可得）');
  pv05 = { eye: shot.eye[48], tgt: shot.target[48] };
} catch (e) { pv05Err = String(e.message || e); }
// 查看器口径像素射线：46° 垂直 FOV（web/main.js PerspectiveCamera(46,...)）、1400×900。
// NDC +X = 屏幕右 = normalize(cross(fwd, [0,1,0]))。
function pv05Dir(eye, tgt, px, py) {
  const ndcX = (px / 1400) * 2 - 1, ndcY = 1 - (py / 900) * 2;
  const fwd = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
  const fl = Math.hypot(...fwd);
  fwd[0] /= fl; fwd[1] /= fl; fwd[2] /= fl;
  const right = [-fwd[2], 0, fwd[0]];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const th = Math.tan((23 * Math.PI) / 180), aspect = 1400 / 900;
  const d = [
    fwd[0] + right[0] * ndcX * th * aspect + up[0] * ndcY * th,
    fwd[1] + right[1] * ndcX * th * aspect + up[1] * ndcY * th,
    fwd[2] + right[2] * ndcX * th * aspect + up[2] * ndcY * th,
  ];
  const dl = Math.hypot(...d);
  return [d[0] / dl, d[1] / dl, d[2] / dl];
}
// dadian 实例位姿（baseline/layout.json，assemble 输入件口径；与 out-zone/layout.json 一致）
let dadianInst = null, dadianInstErr = null;
try {
  const L = JSON.parse(fs.readFileSync(path.join(Q.ROOT, 'baseline', 'layout.json'), 'utf8'));
  dadianInst = L.instances.find((x) => x.id === 'temple-dadian');
  if (!dadianInst) throw new Error('baseline/layout.json 无 temple-dadian 实例');
} catch (e) { dadianInstErr = String(e.message || e); }

// N2+N3 只探 dadian（审查口径的基座悬空带与 pv05 漏点都在大殿）
{
  const b = BUILDINGS[0];
  const cfg = cfgOf(b.cfg);
  const up = at(cfg, 'roofUpper');
  let tris = buildTris(b);
  if (tris) {
    const apronCount = tris.filter(isApronTri).length;
    const capSteepCount = tris.filter(isCapSteepTri).length;
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
    } else if (NEG === 3) {
      const before = tris.length;
      tris = tris.filter((t) => !isCapSteepTri(t));
      console.log(`# negcase3: 移除前后檐压低段陡坡三角 ${before - tris.length}（识别 ${capSteepCount}）`);
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

    // N3 pv05 漏点像素射线（R2 重写，审查必修3）：固定 pv05 相机 + 查看器口径构造
    // 原漏点像素的 FrontSide 射线。旧版「压低段法向近距入射」未复刻 pv05 外侧视线：
    // 审查实测其前侧中央探针命中 z≈1.021，而原漏点封板在 z≈0.083——移除压低段后
    // 旧 N3 仍绿（对真实漏法不敏感）。相机口径：pv05-dadian-rise 第 48 帧（96 帧中
    // 点 = fmid）、46° 垂直 FOV（web/main.js PerspectiveCamera）、1400×900（与 r1/after
    // 截图同尺寸；该口径下模块局部命中 z≈0.082 与审查实测封板 z≈0.083 吻合）。模块
    // 三角经 baseline/layout.json 的 dadian 实例位姿（assemble place 同式）转到世界
    // 坐标，与查看器/分区件同一世界射线求交；命中点逆变换回局部后必须落在封板域
    // （y 贴 capY、前后檐条带带内）。负例2 翻转压低面/负例3 移除压低段后本断言必须红。
    {
      const miss = [];
      let n = 0;
      if (!pv05 || !dadianInst) {
        ok('dadian: pv05 相机口径可读（N3）', false, pv05Err || dadianInstErr);
      } else {
        const [x0, z0] = dadianInst.position, r = dadianInst.rotY;
        const c = Math.cos(r), s = Math.sin(r);
        const place = (t) => {
          const w = [
            x0 + c * t.v[0] + s * t.v[2], t.v[1], z0 - s * t.v[0] + c * t.v[2],
            x0 + c * t.v[3] + s * t.v[5], t.v[4], z0 - s * t.v[3] + c * t.v[5],
            x0 + c * t.v[6] + s * t.v[8], t.v[7], z0 - s * t.v[6] + c * t.v[8],
          ];
          return {
            v: w,
            lo: [Math.min(w[0], w[3], w[6]), Math.min(w[1], w[4], w[7]), Math.min(w[2], w[5], w[8])],
            hi: [Math.max(w[0], w[3], w[6]), Math.max(w[1], w[4], w[7]), Math.max(w[2], w[5], w[8])],
          };
        };
        const wtris = tris.map(place);
        const unplace = (p) => {
          const dx = p[0] - x0, dz = p[2] - z0;
          return [c * dx - s * dz, p[1], s * dx + c * dz];
        };
        for (const [px, py] of PV05_PIXELS) {
          n++;
          const d = pv05Dir(pv05.eye, pv05.tgt, px, py);
          const p = rayHitPoint(wtris, pv05.eye, d);
          const lp = p ? unplace(p) : null;
          const inCap = lp && lp[1] > DD.capY - 0.15 && lp[1] < DD.capY + 0.35 &&
            ((lp[2] > 0.05 && lp[2] < 1.45) || (lp[2] < -12.0 && lp[2] > -13.45));
          if (!p || !inCap) miss.push(`px(${px},${py})${p ? ` 命中局部(${lp.map((v) => v.toFixed(2))}) 不在封板域` : ' 无正面命中（穿封板出天）'}`);
        }
        ok(`dadian: pv05 漏点像素射线落在封板内（N3, ${n} 像素 @fmid 46° 1400×900）`, miss.length === 0,
          miss.length ? `\n  ${miss.join('\n  ')}` : '');
      }
    }

    // N4 压低段朝向审计（R1 lead review 缺陷本体）：压低段域内不得有「朝上且
    // 朝檐内」的三角——R0 的 (0,0.108,-0.994) 法线即此类，浏览器 FrontSide
    // 剔除后成透天缝。负例2 翻转压低面后本断言必须红。
    // R2 必修3 补存在断言：实际压低段陡坡面必须存在（isCapSteepTri ≥ 64；
    // R2 实测前后檐 128 = 审查口径 64/檐。旧中点 y 过滤会把关键压低面排除出
    // 审计域，生成器漏生成整段时 N4 靠「域内 0 坏面」照样绿——存在断言堵住它）。
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
      ok(`dadian: 压低段陡坡面存在（${capSteepCount} ≥ 64）`, capSteepCount >= 64,
        `isCapSteepTri 仅 ${capSteepCount} 个（审查口径 64/檐×前后檐），压低段可能未生成`);
    }
  }
}

// ---------- R2 必修3：浏览器实际资产守卫（分区件 + 压缩件，世界坐标直读） ----------
// 查看器（web/main.js loadZoneFiles）默认吃清单里的 zone-*.cm.glb（?raw=1 才吃原件），
// 模块 GLB 绿不等于交付绿——R1 的教训：模块/单文件总装已修复而 out-zone/zone-temple-2.glb
// 仍是 R0 反向面。对 zone-temple-2.glb 与 zone-temple-2.cm.glb 跑同口径 pv05 射线：
// FrontSide 命中必须存在且落在封板特征域（陡坡法线 ny∈[-0.3,-0.01] + 高度窗）。
// 压缩件按浏览器同款字节解压（EXT_meshopt_compression，three 的 MeshoptDecoder）。
{
  const OUTD = process.env.OUT_DIR || 'out-zone';
  // 通用 GLB → 世界三角（节点变换应用；meshopt 压缩 bufferView 解压）
  async function readSceneWorldTris(file) {
    const { MeshoptDecoder } = require('three/addons/libs/meshopt_decoder.module.js');
    await MeshoptDecoder.ready;
    const buf = fs.readFileSync(file);
    const jl = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jl));
    const bin = 28 + jl < buf.length ? buf.subarray(28 + jl, 28 + jl + buf.readUInt32LE(20 + jl)) : null;
    const decCache = new Map();
    const viewBytes = (bvi) => {
      if (decCache.has(bvi)) return decCache.get(bvi);
      const bv = json.bufferViews[bvi];
      const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
      let out;
      if (ext) {
        const src = bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength);
        out = Buffer.alloc(ext.count * ext.byteStride);
        MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter || 'NONE');
      } else out = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      decCache.set(bvi, out);
      return out;
    };
    const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
    const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const acc = (ai) => {
      const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
      const Arr = COMP[a.componentType], nc = NC[a.type];
      const bytes = viewBytes(a.bufferView);
      const stride = bv.byteStride || Arr.BYTES_PER_ELEMENT * nc;
      const off = a.byteOffset || 0;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const rd = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o) }[a.componentType];
      const out = new Float64Array(a.count * nc);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) out[i * nc + c] = rd(off + i * stride + c * Arr.BYTES_PER_ELEMENT);
      return out;
    };
    const matOf = (n) => {
      if (n.matrix) return n.matrix;
      const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], sc = n.scale || [1, 1, 1];
      const [x, y, z, w] = q;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      return [
        (1 - (yy + zz)) * sc[0], (xy + wz) * sc[0], (xz - wy) * sc[0], 0,
        (xy - wz) * sc[1], (1 - (xx + zz)) * sc[1], (yz + wx) * sc[1], 0,
        (xz + wy) * sc[2], (yz - wx) * sc[2], (1 - (xx + yy)) * sc[2], 0,
        t[0], t[1], t[2], 1,
      ];
    };
    const mulMat = (a, b) => {
      const o = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let r2 = 0; r2 < 4; r2++)
        for (let k = 0; k < 4; k++) o[c * 4 + r2] += a[k * 4 + r2] * b[c * 4 + k];
      return o;
    };
    const xf = (m, p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
    const out = [];
    const walk = (ni, m) => {
      const n = json.nodes[ni];
      const mm = n.matrix ? mulMat(m, n.matrix) : mulMat(m, matOf(n));
      if (n.mesh !== undefined) {
        for (const pr of json.meshes[n.mesh].primitives) {
          const P = acc(pr.attributes.POSITION);
          const T = pr.indices !== undefined ? acc(pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
          for (let k = 0; k + 2 < T.length; k += 3) {
            out.push({
              A: xf(mm, [P[T[k] * 3], P[T[k] * 3 + 1], P[T[k] * 3 + 2]]),
              B: xf(mm, [P[T[k + 1] * 3], P[T[k + 1] * 3 + 1], P[T[k + 1] * 3 + 2]]),
              C: xf(mm, [P[T[k + 2] * 3], P[T[k + 2] * 3 + 1], P[T[k + 2] * 3 + 2]]),
            });
          }
        }
      }
      for (const c of n.children || []) walk(c, mm);
    };
    for (const ni of json.scenes[json.scene || 0].nodes) walk(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return out;
  }
  // FrontSide 最近命中（带命中面法线）
  function rayFrontFull(tris, o, d) {
    let best = null;
    for (const t of tris) {
      const e1 = [t.B[0] - t.A[0], t.B[1] - t.A[1], t.B[2] - t.A[2]], e2 = [t.C[0] - t.A[0], t.C[1] - t.A[1], t.C[2] - t.A[2]];
      const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0];
      const det = e1[0] * px + e1[1] * py + e1[2] * pz;
      if (det <= 1e-12) continue;
      const inv = 1 / det, tx = o[0] - t.A[0], ty = o[1] - t.A[1], tz = o[2] - t.A[2];
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = ty * e1[2] - tz * e1[1], qy = tz * e1[0] - tx * e1[2], qz = tx * e1[1] - ty * e1[0];
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const s2 = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
      if (s2 > 1e-6 && (!best || s2 < best.s)) {
        best = { s: s2, p: [o[0] + d[0] * s2, o[1] + d[1] * s2, o[2] + d[2] * s2],
          n: [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]] };
      }
    }
    return best;
  }
  for (const f of ['zone-temple-2.glb', 'zone-temple-2.cm.glb']) {
    const file = path.join(Q.ROOT, OUTD, f);
    if (!fs.existsSync(file)) {
      ok(`zone 资产 ${f}: 存在（浏览器实际资产）`, false, `${OUTD}/${f} 缺失——分区件未随模块重建（export-zones.py + compress-zones.mjs）`);
      continue;
    }
    try {
      const ztris = await readSceneWorldTris(file);
      const miss = [];
      let n = 0;
      if (!pv05) { ok(`zone 资产 ${f}: pv05 口径可读`, false, pv05Err); continue; }
      for (const [px, py] of PV05_PIXELS) {
        n++;
        const d = pv05Dir(pv05.eye, pv05.tgt, px, py);
        const h = rayFrontFull(ztris, pv05.eye, d);
        const nl = h ? Math.hypot(...h.n) : 0;
        const ny = h ? h.n[1] / nl : 0;
        // 封板特征：陡坡朝外（修复后压低面 ny≈-0.11；R0 反向面 ny≈+0.11 打背面，
        // 被剔除后透天）+ 压低段高度窗（capY±0.35 再放 ±0.05 给 cm 量化）
        const capLike = h && ny >= -0.3 && ny <= -0.01 && h.p[1] > DD.capY - 0.20 && h.p[1] < DD.capY + 0.40;
        if (!h || !capLike) miss.push(`px(${px},${py})${h ? ` 命中(${h.p.map((v) => v.toFixed(2))} ny=${ny.toFixed(3)}) 非封板` : ' 无正面命中（R0 反向面/穿缝出天）'}`);
      }
      ok(`zone 资产 ${f}: pv05 漏点像素封板命中（${n} 像素, ${ztris.length} tris）`, miss.length === 0,
        miss.length ? `\n  ${miss.join('\n  ')}` : '');
    } catch (e) {
      ok(`zone 资产 ${f}: 可解析`, false, String(e && e.message || e));
    }
  }
}

console.log(`\ntemple-eave-leak: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
