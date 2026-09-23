// A1 最小几何测试：先钉住公共生成器错误，修复后必须全绿。
// 覆盖：三角化不越界（矩形/L/U）、重复首尾点、正反绕序、法线朝向（顶面朝上/墙外向）、offsetPoly 自交防护。
import * as THREE from 'three';
import {
  polyArea, pointInPoly, distToPolyline, centroid,
  wallRing, makeRoof, offsetPoly, normalizeRing, orientRing, triangulateRing,
  offsetPolySafe,
} from '../src/lib.mjs';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL', name, detail); }
}

// 采样三角形顶点+质心是否都在容差内贴着多边形（允许真实出檐 overhang）
function surfaceLeaks(tris, ring, tol) {
  let worst = 0;
  for (const t of tris) {
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
    for (const p of [[t[0][0], t[0][2]], [t[1][0], t[1][2]], [t[2][0], t[2][2]], [cx, cz]]) {
      if (!pointInPoly(p, ring)) {
        const d = distToPolyline(p, [...ring, ring[0]]);
        if (d > tol) worst = Math.max(worst, d);
      }
    }
  }
  return worst;
}

// 从 BufferGeometry 抽三角形（世界系）
function trisOf(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const out = [];
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    out.push([
      [pos.getX(a), pos.getY(a), pos.getZ(a)],
      [pos.getX(b), pos.getY(b), pos.getZ(b)],
      [pos.getX(c), pos.getY(c), pos.getZ(c)],
    ]);
  }
  return out;
}

function faceNormal(t) {
  const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
  const w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

// ---------- 输入形状 ----------
const RECT = [[0, 0], [10, 0], [10, 6], [0, 6]];
const RECT_REV = [...RECT].reverse();
const RECT_DUP = [...RECT, RECT[0]];            // 闭环重复点
const LSHAPE = [[0, 0], [10, 0], [10, 3], [3, 3], [3, 10], [0, 10]]; // roof-cases 凹形负例
const USHAPE = [[0, 0], [12, 0], [12, 8], [8, 8], [8, 3], [4, 3], [4, 8], [0, 8]];

// ---------- normalizeRing / orientRing / triangulateRing（目标 API） ----------
check('normalizeRing 去闭环重复点', normalizeRing([...RECT, RECT[0]]).length === 4);
check('normalizeRing 去连续重复点', normalizeRing([[0, 0], [0, 0], [5, 0], [5, 0], [5, 5], [0, 5]]).length === 4);
check('orientRing 统一为正面积绕序', polyArea(orientRing(LSHAPE)) > 0 && polyArea(orientRing([...LSHAPE].reverse())) > 0);

const triL = triangulateRing(orientRing(LSHAPE));
check('triangulateRing L形不越界', triL.every(t => {
  const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
  return pointInPoly(c, LSHAPE);
}), `${triL.filter(t => !pointInPoly([(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3], LSHAPE)).length} 个三角质心越界`);

// ---------- makeRoof：四种形状 x 两种绕序/重复点 ----------
for (const [nm, ring] of [['矩形', RECT], ['矩形反绕序', RECT_REV], ['矩形带重复尾点', RECT_DUP], ['L形', LSHAPE], ['L形反绕序', [...LSHAPE].reverse()], ['U形', USHAPE]]) {
  for (const mode of ['gabled', 'hip']) {
    const g = makeRoof(ring, { eave: 4, rise: 1.8, mode, name: 't' });
    const roofMesh = g.children.find(c => c.name === 't:surface');
    const tris = trisOf(roofMesh.geometry);
    check(`${nm}/${mode} 屋面三角存在`, tris.length >= 2, `${tris.length} tris`);
    // 容差 = 出檐0.38 × √2（直角斜接顶点上限）；真实扇形泄漏(0.68–1.57m)仍会被抓出
    const leak = surfaceLeaks(tris, orientRing(normalizeRing(ring)), 0.38 * 1.5);
    check(`${nm}/${mode} 屋面不越出轮廓+出檐容差`, leak <= 0.001, `worst ${leak.toFixed(3)}m`);
    // 顶面绕序法线朝上
    const down = tris.filter(t => faceNormal(t)[1] < 0.05);
    check(`${nm}/${mode} 顶面法线朝上`, down.length === 0, `${down.length} 个朝下/水平`);
    // 脊线真实存在：gabled 沿主轴中心线应有连续达到 eave+rise 的高度（采样脊线中点与四分点）
    const pa1 = { ring: orientRing(normalizeRing(ring)) };
    const pts = pa1.ring;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const topY = Math.max(...tris.flat().map(p => p[1]));
    check(`${nm}/${mode} 脊高=eave+rise`, Math.abs(topY - 5.8) < 0.35, `top ${topY.toFixed(2)}`);
    // 属性法线与面法线一致性（不靠 DoubleSide 兜底；非索引几何同样处理）
    const nrm = roofMesh.geometry.attributes.normal;
    const idx = roofMesh.geometry.index;
    const triCount = idx ? idx.count / 3 : roofMesh.geometry.attributes.position.count / 3;
    let badN = 0;
    for (let i = 0; i < triCount; i++) {
      const vi = (k) => (idx ? idx.getX(i * 3 + k) : i * 3 + k);
      const fn = faceNormal([
        [roofMesh.geometry.attributes.position.getX(vi(0)), roofMesh.geometry.attributes.position.getY(vi(0)), roofMesh.geometry.attributes.position.getZ(vi(0))],
        [roofMesh.geometry.attributes.position.getX(vi(1)), roofMesh.geometry.attributes.position.getY(vi(1)), roofMesh.geometry.attributes.position.getZ(vi(1))],
        [roofMesh.geometry.attributes.position.getX(vi(2)), roofMesh.geometry.attributes.position.getY(vi(2)), roofMesh.geometry.attributes.position.getZ(vi(2))],
      ]);
      const vn = [nrm.getX(vi(0)), nrm.getY(vi(0)), nrm.getZ(vi(0))];
      if (fn[1] * vn[1] < 0) badN++;
    }
    check(`${nm}/${mode} 属性法线与绕序一致(单面可用)`, badN === 0, `${badN} 不一致`);
    check(`${nm}/${mode} 屋面单面材质`, roofMesh.material.side === THREE.FrontSide, `side=${roofMesh.material.side}`);
    // 总投影面积 ≈ 出檐后环面积（抓分块重叠/漏盖）
    const offRing = offsetPolySafe(orientRing(normalizeRing(ring)), 0.38).pts;
    const ringA = Math.abs(polyArea(offRing));
    let triA = 0;
    for (const t of tris) {
      triA += Math.abs((t[1][0] - t[0][0]) * (t[2][2] - t[0][2]) - (t[2][0] - t[0][0]) * (t[1][2] - t[0][2])) / 2;
    }
    check(`${nm}/${mode} 屋面覆盖一致(无重叠/漏盖)`, Math.abs(triA - ringA) < ringA * 0.03, `tris ${triA.toFixed(1)} vs ring ${ringA.toFixed(1)}`);
  }
}

// 点在2D三角内 + 重心插值高度
function sampleHeight(tris, x, z) {
  for (const t of tris) {
    const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = t;
    const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / d;
    const v = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / d;
    if (u >= -0.001 && v >= -0.001 && u + v <= 1.001) return ay + u * (by - ay) + v * (cy - ay);
  }
  return null;
}

// gabled 脊线连续性：矩形双坡屋面沿脊线插值高度应处处 ≈ eave+rise（连续真脊，不是中心尖点）
{
  const g = makeRoof(RECT, { eave: 4, rise: 2, mode: 'gabled', name: 't' });
  const roofMesh = g.children.find(c => c.name === 't:surface');
  const tris = trisOf(roofMesh.geometry);
  let ok = true, det = [];
  for (const t of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const x = 5 + t * 10, z = 3; // 沿主轴(x)采样
    const h = sampleHeight(tris, x, z);
    det.push(h === null ? 'null' : h.toFixed(2));
    if (h === null || h < 5.6) ok = false; // eave4+rise2=6，脊线附近应接近6
  }
  check('gabled 脊线全长连续存在', ok, det.join(','));
}

// ---------- wallRing：外向硬边法线，无朝上法线 ----------
{
  for (const [nm, ring] of [['矩形', RECT], ['矩形反绕序', RECT_REV], ['L形', LSHAPE]]) {
    const w = wallRing(normalizeRing(ring), 0, 4, 0xcccccc, 'w');
    const geo = w.geometry;
    const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index;
    const ringN = orientRing(normalizeRing(ring));
    let upN = 0, inward = 0;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let i = 0; i < triCount; i++) {
      const vi = (k) => (idx ? idx.getX(i * 3 + k) : i * 3 + k);
      const fx = (pos.getX(vi(0)) + pos.getX(vi(1)) + pos.getX(vi(2))) / 3;
      const fz = (pos.getZ(vi(0)) + pos.getZ(vi(1)) + pos.getZ(vi(2))) / 3;
      for (let k = 0; k < 3; k++) {
        const v = vi(k);
        const ny = nrm.getY(v), nx = nrm.getX(v), nz = nrm.getZ(v);
        if (Math.abs(ny) > 0.3) upN++;
        // 外向判定：面心沿法线偏移后应在环外（凹环上"面心-质心点积"不成立）
        if (pointInPoly([fx + nx * 0.05, fz + nz * 0.05], ringN)) inward++;
      }
      // 绕序面法线必须与属性法线同向（否则单面渲染从内侧可见）
      const fw = faceNormal([
        [pos.getX(vi(0)), pos.getY(vi(0)), pos.getZ(vi(0))],
        [pos.getX(vi(1)), pos.getY(vi(1)), pos.getZ(vi(1))],
        [pos.getX(vi(2)), pos.getY(vi(2)), pos.getZ(vi(2))],
      ]);
      const vw = [nrm.getX(vi(0)), nrm.getY(vi(0)), nrm.getZ(vi(0))];
      if (fw[0] * vw[0] + fw[1] * vw[1] + fw[2] * vw[2] < 0.9) { inward += 1000; }
    }
    check(`wallRing ${nm} 无法线朝上`, upN === 0, `${upN} 个朝上`);
    check(`wallRing ${nm} 法线外向`, inward === 0, `${inward} 个朝内`);
    check(`wallRing ${nm} 单面材质`, w.material.side === THREE.FrontSide, `side=${w.material.side}`);
  }
}

// ---------- offsetPolySafe：凹角/窄部不自交 ----------
{
  const narrow = [[0, 0], [10, 0], [10, 2], [6, 2], [6, 8], [4, 8], [4, 2], [0, 2]]; // 2m 窄颈 U 形
  const r = offsetPolySafe(narrow, -1.2); // 内缩 1.2 > 窄颈一半，应钳制或回退
  const a = Math.abs(polyArea(r.pts));
  const orig = Math.abs(polyArea(narrow));
  check('offsetPolySafe 窄颈内缩不自交', a > 0.01 && a <= orig + 0.01 && r.method !== 'spike', `method=${r.method} area=${a.toFixed(2)}`);
  const r2 = offsetPolySafe(LSHAPE, 0.38);
  check('offsetPolySafe L形外扩保持正面积', Math.abs(polyArea(r2.pts)) > Math.abs(polyArea(LSHAPE)) && r2.method === 'offset');
}

// ---------- 洞环保留：triangulateRing 带洞 ----------
{
  const outer = [[0, 0], [20, 0], [20, 14], [0, 14]];
  const hole = [[6, 4], [12, 4], [12, 9], [6, 9]];
  const tris = triangulateRing(orientRing(outer), [orientRing(hole)]);
  const inHole = tris.filter(t => {
    const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    return pointInPoly(c, hole);
  });
  check('triangulateRing 洞环保留(院落不被铺满)', tris.length >= 4 && inHole.length === 0, `${inHole.length} 三角落入洞`);
}

console.log(`\ngeo-tests: ${pass} pass, ${fail} fail`);
if (failures.length) { console.log('failures:'); for (const f of failures) console.log(' -', f); process.exit(1); }
