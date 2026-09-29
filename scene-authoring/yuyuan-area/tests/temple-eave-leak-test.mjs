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
// R3 改造（lead review R3 必修3/4/5/6）：
//   - pv05 相机改测试内固定常量（tests/temple-eave-pv05.mjs，pv05-dadian-rise fmid 生成值
//     固化），不再读 OUT_DIR/pv-cameras.json（npm run build 不生成该文件，生成目录可变）。
//   - pv05Dir 基向量归一化：旧版 right=[-fwd.z,0,fwd.x] 长 0.9622，声明像素与实际射线差
//     ~23px（审查实测 (100,440) 实际对应 (122.66,440.38)）；新增 N0 断言：像素射线经
//     Three.js PerspectiveCamera（查看器同参）反投影误差 <0.5px。
//   - 浏览器实际资产守卫（分区件/压缩件 pv05 射线）拆出默认链 → tests/temple-eave-zones-test.mjs
//     （npm run test:temple-eave-zones，不入默认链；缺文件即 FAIL、ZONE_CM=0 只查 raw）。
//     本文件只测模块 GLB（固定相机），npm run build 后即可跑，无生成物前置依赖。
//   - CAP_WINDOWS 逐字段校验（front/rear/sideOuter 有限数值 ∈(0,6]，缺字段/NaN 即 FAIL）+
//     负例④ EAVE_LEAK_NEGCASE=4 内存删除 yimen-pilot roof.front → 必须红。
//   - N4 存在断言的陡坡计数改在负例变换后进行（旧版变换前计数，负例③移除压低段后
//     仍打印「128 ≥64」）。
// 用法：node tests/temple-eave-leak-test.mjs [--dir <模块目录>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as Q from './templeqa-lib.mjs';
import { PV05_CAM, PV05_PIXELS, DD, pv05Dir, pv05PixelErrors } from './temple-eave-pv05.mjs';

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

// dadian 封板/基座特征锚点 DD 见 temple-eave-pv05.mjs（R3 起两测试共用一份）。

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
// 负例④（R3 必修4）：内存删除 yimen-pilot roof.front——单个必需字段缺失必须红。
// 审查实测：旧版 `!!cap` 只查整条存在，删单字段后测试仍 24 PASS / 0 FAIL，
// 前檐距离阈值重新变成 NaN 静默失效。
if (NEG === 4) delete CAP_WINDOWS['yimen-pilot roof'].front;

// R3 必修4：CAP_WINDOWS 逐字段校验。缺字段 / 非数值 / NaN / Inf / 超出合理范围
// 都判 FAIL——NaN 阈值会让封口深度比较恒 false（正是 R2 审查抓到的静默失效模式）。
// 合理范围：封口深度/侧向窗是米制距离，>0 且 ≤6（实测最大 sideOuter=3.5）。
function capFieldErrs(cap) {
  if (!cap || typeof cap !== 'object') return ['CAP_WINDOWS 缺条目（封口深度/侧向窗必须显式给出，缺失即 FAIL）'];
  const errs = [];
  for (const f of ['front', 'rear', 'sideOuter']) {
    const v = cap[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${f}=${String(v)}（缺失或非有限数值）`);
    else if (v <= 0 || v > 6) errs.push(`${f}=${v} 超出合理范围 (0,6]`);
  }
  return errs;
}

const STRIP_BUILDINGS = BUILDINGS.filter((b) => ['dadian', 'yimen-pilot', 'temple-shanmen'].includes(b.mod));
for (const b of STRIP_BUILDINGS) {
  const tris = buildTris(b);
  if (!tris) continue;
  const cfg = cfgOf(b.cfg);
  for (const shellPath of b.shells) {
    const cap = CAP_WINDOWS[`${b.mod} ${shellPath}`];
    const capErrs = capFieldErrs(cap);
    ok(`${b.mod} ${shellPath}: 封口窗配置存在且字段有效（front/rear/sideOuter 有限数值 ∈(0,6]）`,
      capErrs.length === 0, capErrs.join('; '));
    if (capErrs.length) continue;
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

// ---------- pv05 相机口径（N3 用） ----------
// R3 必修3：相机/像素集/射线构造全部来自 temple-eave-pv05.mjs 的固定常量与归一化实现
// （PV05_CAM / PV05_PIXELS / pv05Dir），不再读 OUT_DIR/pv-cameras.json。
// dadian 实例位姿（baseline/layout.json，assemble 输入件口径；与 out-zone/layout.json 一致）
let dadianInst = null, dadianInstErr = null;
try {
  const L = JSON.parse(fs.readFileSync(path.join(Q.ROOT, 'baseline', 'layout.json'), 'utf8'));
  dadianInst = L.instances.find((x) => x.id === 'temple-dadian');
  if (!dadianInst) throw new Error('baseline/layout.json 无 temple-dadian 实例');
} catch (e) { dadianInstErr = String(e.message || e); }

// N0 相机口径自证（R3 必修3）：固定相机像素射线经 Three.js PerspectiveCamera（查看器
// 同参 46°/1400×900）反投影回像素，误差必须 <0.5px——「声明的像素真的被测到」才算数。
// 旧版 right 未归一化时三漏点偏差实测 (22.66,0.38)/(18.88,0.38)/(−20.77,0.38) px。
{
  const errs = await pv05PixelErrors(30);
  const maxE = Math.max(...errs.map((e) => e.errPx));
  ok(`pv05 口径: 像素射线反投影误差 <0.5px（N0, max=${maxE.toFixed(4)}px）`, maxE < 0.5,
    errs.map((e) => `(${e.px},${e.py})→参考(${e.ref[0].toFixed(2)},${e.ref[1].toFixed(2)}) err=${e.errPx.toFixed(3)}px`).join('; '));
}

// N2+N3 只探 dadian（审查口径的基座悬空带与 pv05 漏点都在大殿）
{
  const b = BUILDINGS[0];
  const cfg = cfgOf(b.cfg);
  const up = at(cfg, 'roofUpper');
  let tris = buildTris(b);
  if (tris) {
    const apronIdentified = tris.filter(isApronTri).length;
    const capSteepIdentified = tris.filter(isCapSteepTri).length;
    if (NEG === 1) {
      const before = tris.length;
      tris = tris.filter((t) => !isApronTri(t));
      console.log(`# negcase1: 移除基座裙板三角 ${before - tris.length}（识别 ${apronIdentified}）`);
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
      console.log(`# negcase3: 移除前后檐压低段陡坡三角 ${before - tris.length}（识别 ${capSteepIdentified}）`);
    }
    // 断言用计数取变换后的三角集（R3 必修6）：旧版在负例变换前计数，负例③移除
    // 压低段后 N4 存在断言仍打印「128 ≥64」假绿；默认正例下两口径数值相同。
    const apronCount = tris.filter(isApronTri).length;
    const capSteepCount = tris.filter(isCapSteepTri).length;

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
      if (!dadianInst) {
        ok('dadian: pv05 相机口径可读（N3）', false, dadianInstErr);
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
          const d = pv05Dir(PV05_CAM.eye, PV05_CAM.tgt, px, py);
          const p = rayHitPoint(wtris, PV05_CAM.eye, d);
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

console.log(`\ntemple-eave-leak: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
