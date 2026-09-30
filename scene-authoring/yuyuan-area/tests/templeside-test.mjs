// wave14-templeside：庙区周边三处小问题（机主 2026-09-29）回归。
//   S1 庙区南墙穿帮（两层）：
//     A 占位店 shoprow-p165（方浜未加载时可见）——进深缩放 + 南移后，实际体量（模块 GLB bbox × scale3）
//       与 temple-wall 各段、templeeast-paving 净距 ≥0，前墙不进方浜中路；
//     B v7 精修店 westshop-shop-165（方浜加载后取代占位店）——placement override 平移后，
//       碰撞 OBB（真实墙体）与 temple-wall 各段、templeeast-paving 净距 ≥0（仓库根共享数据集不改，
//       期望值 = 源数据 + baseline/fangbang-placement-overrides.json 独立重算）。
//   S2 安仁街东侧空地（pv04 右缘）：anreneast-paving + 3 樟落在地块内（路缘外退、不压 p163、
//       树间距离、铺地内），且该地块不新增建筑（与当代 OSM「无建筑轮廓」一致的开敞地读法）。
//   S3 后殿北侧院（pv01/pv16）：templeside-paving 落在墙 seg-9…15 围合院内（离墙段/后殿 ≥ 门槛），
//       3 樟 + 1 鼎（复用 templeeast-ding）在铺地内，不新增大建筑。
//   E 碰撞与地面接线（有 OUT_DIR 产物时）：anreneast/templeside 树干/鼎盒进各自分区碰撞；
//     templeside-paving 进庙区 extraGroundNodes；anreneast-paving 由 outer GROUND_RE 命中。
// 期望值一律从 baseline/layout.json、仓库根 world/fangbang-temple-v7/{instances,collision-world}.json、
// baseline/fangbang-placement-overrides.json 与只读模块 GLB（resources/shops、resources/temple-v3）独立重算，
// 不拿本单产物和自己比。查到 0 个目标对象一律 FAIL。
// 用法：OUT_DIR=out-zone node tests/templeside-test.mjs
// 负例：TEMPLESIDE_LAYOUT=<改动前 layout.json> TEMPLESIDE_OVERRIDES=<改动前 overrides.json> → S1A/S2/S3 全 FAIL。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../../../src/world/glbReader.js';
import { distToSeg, pointInPoly, segIntersect } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT_PATH = process.env.TEMPLESIDE_LAYOUT ? path.resolve(process.env.TEMPLESIDE_LAYOUT) : path.join(ROOT, 'baseline', 'layout.json');
const OVERRIDES_PATH = process.env.TEMPLESIDE_OVERRIDES ? path.resolve(process.env.TEMPLESIDE_OVERRIDES) : path.join(ROOT, 'baseline', 'fangbang-placement-overrides.json');
const L = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; failures.push(name); console.log('FAIL', name, extra); } };
const r3 = v => Math.round(v * 1000) / 1000;

// ---------- 庙轴本地系（原点 = 山门锚，rotY = 山门 rotY；本地 +X≈东、+Z≈南） ----------
const sm = L.instances.find(i => i.id === 'temple-shanmen');
if (!sm) { console.log('FAIL 庙轴锚缺失（layout 无 temple-shanmen）'); process.exit(1); }
const TH = sm.rotY, cT = Math.cos(TH), sT = Math.sin(TH);
const toLocal = (wx, wz) => {
  const dx = wx - sm.position[0], dz = wz - sm.position[1];
  return [dx * cT - dz * sT, dx * sT + dz * cT];
};
const instRectLocal = (inst, halfW, zMin, zMax) => {
  // 实例位姿（原点、rotY）下，模型本地矩形 [±halfW]×[zMin,zMax] 的庙轴本地四角
  const c = Math.cos(inst.rotY), s = Math.sin(inst.rotY);
  return [[-halfW, zMin], [halfW, zMin], [halfW, zMax], [-halfW, zMax]]
    .map(([lx, lz]) => toLocal(inst.position[0] + c * lx + s * lz, inst.position[1] - s * lx + c * lz));
};
const ring = fp => (fp[0][0] === fp.at(-1)[0] && fp[0][1] === fp.at(-1)[1]) ? fp.slice(0, -1) : fp;
// 模块 GLB 实际包围盒（顶点经节点矩阵；轴约定 = GLB Y-up：x 宽 / y 高 / z 进深）
const glbBbox = (file) => {
  const { meshes } = readGlb(fs.readFileSync(file));
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const m of meshes) {
    const M = m.matrix;
    for (let k = 0; k < m.positions.length; k += 3) {
      const x = m.positions[k], y = m.positions[k + 1], z = m.positions[k + 2];
      const wx = M[0] * x + M[4] * y + M[8] * z + M[12];
      const wy = M[1] * x + M[5] * y + M[9] * z + M[13];
      const wz = M[2] * x + M[6] * y + M[10] * z + M[14];
      mnx = Math.min(mnx, wx); mxx = Math.max(mxx, wx);
      mny = Math.min(mny, wy); mxy = Math.max(mxy, wy);
      mnz = Math.min(mnz, wz); mxz = Math.max(mxz, wz);
    }
  }
  if (!(mxx > mnx)) throw new Error(`empty GLB bbox: ${file}`);
  return { mnx, mxx, mny, mxy, mnz, mxz };
};
const edgesOf = fp => { const r = ring(fp); return r.map((p, i) => [p, r[(i + 1) % r.length]]); };
const segRectDist = (a, b, rect) => {
  // 墙段（庙轴本地线段）到矩形的最小平面距离；相交/进入返回 0
  const rr = ring(rect);
  const hit = (p, q) => { for (const [c, d] of edgesOf(rect)) if (segIntersect(p, q, c, d)) return true; return false; };
  if (hit(a, b)) return 0;
  const inPoly = (p) => pointInPoly(p, rr);
  if (inPoly(a) || inPoly(b)) return 0;
  let m = Infinity;
  for (const p of rr) m = Math.min(m, distToSeg(p, a, b));
  return m;
};
const polyDist = (A, B) => {
  for (const [a, b] of edgesOf(A)) for (const [c, d] of edgesOf(B)) if (segIntersect(a, b, c, d)) return 0;
  const rA = ring(A), rB = ring(B);
  if (rA.some(p => pointInPoly(p, rB)) || rB.some(p => pointInPoly(p, rA))) return 0;
  let m = Infinity;
  for (const p of rA) for (const [c, d] of edgesOf(B)) m = Math.min(m, distToSeg(p, c, d));
  for (const p of rB) for (const [c, d] of edgesOf(A)) m = Math.min(m, distToSeg(p, c, d));
  return m;
};

const wallObj = L.objects.find(o => o.id === 'temple-wall');
if (!wallObj) { console.log('FAIL temple-wall 缺失'); process.exit(1); }
const WALL_HALF_THICK = (wallObj.thickness ?? 0.45) / 2;   // build-scene 默认 0.45
const wallSegsLocal = wallObj.geometry.segments.map(([a, b]) => [toLocal(a[0], a[1]), toLocal(b[0], b[1])]);
const pavingEast = L.objects.find(o => o.id === 'templeeast-paving');

// ---------- S1A 占位店 shoprow-p165 ----------
{
  const inst = L.instances.find(i => i.id === 'shoprow-p165');
  const obj = L.objects.find(o => o.id === 'shoprow-p165');
  ok('S1A-0 shoprow-p165 存在（对象+实例）', !!inst && !!obj);
  if (inst && obj) {
    const bb = glbBbox(path.join(ROOT, 'resources', 'shops', inst.module, 'model.glb'));
    // 模块 GLB 实际 bbox（轴约定：原点前墙中点，facade +Z，进深 −Z；threebay 实进深 ≈7.1）
    const bboxOk = bb.mxx > bb.mnx && bb.mxz > bb.mnz;
    ok('S1A-0b 模块 GLB bbox 可读（threebay 实进深 ≈7.1）', bboxOk && (bb.mxz - bb.mnz) > 6.5, `depth=${r3(bb.mxz - bb.mnz)}`);
    const s3 = inst.scale3 || [1, 1, 1];
    const halfW = (bb.mxx - bb.mnx) / 2 * s3[0];
    // 进深方向带 bbox 的前后出挑（−6.75/+0.35），乘 scale3[2]
    const rect = instRectLocal(inst, halfW, bb.mnz * s3[2], bb.mxz * s3[2]);
    const dWall = Math.min(...wallSegsLocal.map(([a, b]) => segRectDist(a, b, rect)));
    ok(`S1A-1 体量与庙墙每段净距 ≥0（实测 ${r3(dWall)} m，含半厚 ${WALL_HALF_THICK}）`, dWall >= 0.15 + 0, `min=${r3(dWall)}`);
    // 更严的口径：到墙段中线净距 − 半厚
    const dCenter = Math.min(...wallSegsLocal.map(([a, b]) => {
      let m = Infinity; for (const p of ring(rect)) m = Math.min(m, distToSeg(p, a, b)); return m;
    }));
    ok(`S1A-2 到墙中线净距扣除半厚后 ≥0.15（实测 ${r3(dCenter - WALL_HALF_THICK)} m）`, dCenter - WALL_HALF_THICK >= 0.15);
    const dPav = pavingEast ? polyDist(rect, pavingEast.geometry.footprint.map(p => toLocal(p[0], p[1]))) : -1;
    ok(`S1A-3 体量与 templeeast-paving 净距 ≥0（实测 ${r3(dPav)} m）`, pavingEast && dPav >= 0.5);
    // 前墙不进方浜中路：读 map-data 折线（与生成器同源输入）
    const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'inputs', 'map-data.json'), 'utf8'));
    const c = Math.cos(inst.rotY), s = Math.sin(inst.rotY);
    const frontCorners = [[-halfW, 0], [halfW, 0]].map(([lx, lz]) => [inst.position[0] + c * lx + s * lz, inst.position[1] - s * lx + c * lz]);
    let frontGap = Infinity;
    for (const r of map.roads) {
      if (r.name !== '方浜中路') continue;
      for (let i = 1; i < r.points.length; i++) {
        const a = toLocal(r.points[i - 1][0], r.points[i - 1][1]);
        const b = toLocal(r.points[i][0], r.points[i][1]);
        for (const p of frontCorners) {
          const pl = toLocal(p[0], p[1]);
          frontGap = Math.min(frontGap, distToSeg(pl, a, b) - r.width / 2);
        }
      }
    }
    ok(`S1A-4 前墙到方浜中路近边 ≥0.3（实测 ${r3(frontGap)} m）`, frontGap >= 0.3);
    ok('S1A-5 scale3 已登记（[1,1,0.85]，对象+实例一致）',
      JSON.stringify(inst.scale3) === JSON.stringify([1, 1, 0.85]) && JSON.stringify(obj.scale3) === JSON.stringify(inst.scale3),
      `inst=${JSON.stringify(inst.scale3)} obj=${JSON.stringify(obj.scale3)}`);
  }
}

// ---------- S1B v7 精修店 westshop-shop-165（期望值 = 源数据 + 覆盖文件独立重算） ----------
{
  const v7 = JSON.parse(fs.readFileSync(path.join(REPO, 'world', 'fangbang-temple-v7', 'instances.json'), 'utf8')).instances;
  const v7col = JSON.parse(fs.readFileSync(path.join(REPO, 'world', 'fangbang-temple-v7', 'collision-world.json'), 'utf8')).colliders;
  const doc = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  const ov = (doc.overrides || []).find(o => o.id === 'westshop-shop-165');
  const base = v7.find(i => i.id === 'westshop-shop-165');
  ok('S1B-0 覆盖条目与 v7 实例存在', !!ov && !!base);
  if (ov && base) {
    ok('S1B-1 expectBasePositionGlb 与 v7 源数据一致（防共享数据集改动重复平移）',
      ov.expectBasePositionGlb.every((v, k) => Math.abs(v - base.positionGlb[k]) < 1e-4),
      `expect=${JSON.stringify(ov.expectBasePositionGlb)} base=${JSON.stringify(base.positionGlb)}`);
    const d = ov.translateGlb;
    // 覆盖后位姿（v7 → 地图 = +53.5, −17.4；loader 的 4 位取整规则）
    const r4 = x => Math.sign(x) * Math.floor(Math.abs(x) * 10000 + 0.5) / 10000;
    const pos = base.positionGlb.map((v, k) => r4(v + d[k]));
    const th = base.rotationYRad, cc = Math.cos(th), ss = Math.sin(th);
    // 用 collision-world 的 OBB（真实墙体）算庙轴本地矩形（贴地面部件 y<2 m）
    const recs = v7col.filter(r => r.name.split(':')[0] === base.id && r.obb && (r.obb.center[1] - r.obb.size[1] / 2) < 2.0);
    ok('S1B-2 底部碰撞 OBB ≥3 条（背墙/侧墙在列）', recs.length >= 3, `n=${recs.length}`);
    let dMinWall = Infinity, dMinPav = Infinity;
    for (const r of recs) {
      const o = r.obb;
      const ct = Math.cos(o.theta), st = Math.sin(o.theta);
      const hx = o.size[0] / 2, hz = o.size[2] / 2;
      // OBB 四角（v7 xz）→ 地图 → 庙轴本地（center 相对 pos）
      const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([ux, uz]) => {
        const wx = pos[0] + ct * o.center[0] + st * o.center[2] + ct * ux + st * uz;
        const wz = pos[2] - st * o.center[0] + ct * o.center[2] - st * ux + ct * uz;
        return toLocal(wx + 53.5, wz - 17.4);
      });
      dMinWall = Math.min(dMinWall, ...wallSegsLocal.map(([a, b]) => segRectDist(a, b, corners)));
      const dCenter = Math.min(...wallSegsLocal.map(([a, b]) => {
        let m = Infinity; for (const p of ring(corners)) m = Math.min(m, distToSeg(p, a, b)); return m;
      }));
      dMinWall = Math.min(dMinWall, dCenter - WALL_HALF_THICK);
      if (pavingEast) dMinPav = Math.min(dMinPav, polyDist(corners, pavingEast.geometry.footprint.map(p => toLocal(p[0], p[1]))));
    }
    ok(`S1B-3 平移后贴地墙体与庙墙各段净距 ≥0（实测 ${r3(dMinWall)} m）`, dMinWall >= 0.2, `min=${r3(dMinWall)}`);
    ok(`S1B-4 平移后贴地墙体与 templeeast-paving 净距 ≥0（实测 ${r3(dMinPav)} m）`, !pavingEast || dMinPav >= 0.3, `min=${r3(dMinPav)}`);
    // 方向依据：只向门脸法线（+Z）平移，x 分量 = sin(rotY)·|d|
    const along = Math.hypot(d[0], d[2]);
    ok('S1B-5 平移沿门脸法线（x=±sinθ·1.0, z=cosθ·1.0，|d|=1.0 m）',
      Math.abs(along - 1.0) < 1e-3 && Math.abs(d[0] - Math.sin(base.rotationYRad) * 1.0) < 2e-4 && Math.abs(d[2] - Math.cos(base.rotationYRad) * 1.0) < 2e-4);
  }
}

// ---------- S2 安仁街东侧空地 ----------
{
  const objs = L.objects.filter(o => o.id.startsWith('anreneast-'));
  const trees = L.instances.filter(i => i.id.startsWith('anreneast-'));
  const paving = objs.find(o => o.id === 'anreneast-paving');
  ok(`S2-0 对象齐：铺地 1 + 樟 3（实测铺地 ${paving ? 1 : 0}、实例 ${trees.length}）`, !!paving && trees.length === 3);
  if (paving && trees.length === 3) {
    const lotRing = ring(paving.geometry.footprint).map(p => toLocal(p[0], p[1]));
    const xs = lotRing.map(p => p[0]), zs = lotRing.map(p => p[1]);
    // 地块边界独立重算：安仁街东缘 + 0.5 人行带；z −72…−6
    const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'inputs', 'map-data.json'), 'utf8'));
    const road = map.roads.find(r => r.name === '安仁街' && r.points.length === 12);
    const edgeAt = (zl) => {
      let best = null;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i];
        for (let k = 0; k <= 40; k++) {
          const t = k / 40, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const dx = q[0] - sm.position[0], dz = q[1] - sm.position[1];
          const lx = dx * cT - dz * sT, lz = dx * sT + dz * cT;
          if (!best || Math.abs(lz - zl) < Math.abs(best[1] - zl)) best = [lx, lz];
        }
      }
      return best[0] + road.width / 2;
    };
    // 铺地西缘是随 z 变化的线段：沿西缘按 z 采样（南界…−72），逐点要求 ≥ 该 z 处路缘 + 0.3。
    const westPts = [...lotRing].sort((p, q) => p[0] - q[0]).slice(0, 2).sort((a, b) => a[1] - b[1]);
    const westAt = (zl) => {
      const [p, q] = westPts;
      const t = (zl - p[1]) / (q[1] - p[1]);
      return p[0] + t * (q[0] - p[0]);
    };
    const zLo = Math.min(...zs), zHi = Math.max(...zs);
    let westGapMin = Infinity;
    for (let k = 0; k <= 10; k++) {
      const zl = zLo + (zHi - zLo) * k / 10;
      westGapMin = Math.min(westGapMin, westAt(zl) - edgeAt(zl));
    }
    const zOk = zLo >= -72.5 && zHi <= -5.5;
    ok(`S2-1 铺地在地块内（西缘距路缘 ≥0.3 逐 z 实测最小 ${r3(westGapMin)}、z ⊆ [−72.5,−5.5] 实测 z∈[${r3(zLo)},${r3(zHi)}]）`, westGapMin >= 0.3 && zOk);
    // 不压 p163（提案店，其 footprint 从实例位姿+模块 bbox 独立重算）
    const p163 = L.instances.find(i => i.id === 'shoprow-p163');
    ok('S2-2 p163 存在（对照物）', !!p163);
    if (p163) {
      const b163 = glbBbox(path.join(ROOT, 'resources', 'shops', p163.module, 'model.glb'));
      const rect163 = instRectLocal(p163, (b163.mxx - b163.mnx) / 2, b163.mnz, b163.mxz);
      const d = polyDist(paving.geometry.footprint.map(p => toLocal(p[0], p[1])), rect163);
      ok(`S2-3 铺地与 p163 净距 ≥1.5（实测 ${r3(d)} m）`, d >= 1.5);
      const dTrees = trees.map(t => {
        const p = toLocal(t.position[0], t.position[1]);
        return Math.min(...rect163.map((q, i) => distToSeg(p, rect163[i], rect163[(i + 1) % 4])));
      });
      ok(`S2-4 樹与 p163 净距 ≥10（最小 ${r3(Math.min(...dTrees))} m）`, Math.min(...dTrees) >= 10);
    }
    // 树在铺地内、离铺地边 ≥1.0、两两 ≥8
    const pos = trees.map(t => toLocal(t.position[0], t.position[1]));
    const inPave = pos.map(p => pointInPoly(p, lotRing));
    let edgeMin = Infinity;
    for (const p of pos) for (let i = 0; i < lotRing.length; i++) edgeMin = Math.min(edgeMin, distToSeg(p, lotRing[i], lotRing[(i + 1) % lotRing.length]));
    let pairMin = Infinity;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      pairMin = Math.min(pairMin, Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]));
    }
    ok(`S2-5 3 棵樟都在铺地内、离边 ≥1.0（最小 ${r3(edgeMin)} m）`, inPave.every(Boolean) && edgeMin >= 1.0);
    ok(`S2-6 樟两两间距 ≥8（最小 ${r3(pairMin)} m）`, pairMin >= 8);
    // 开敞地读法：该地块不新增建筑（只有 plaza + 树）
    const kinds = new Set(objs.map(o => o.kind));
    ok(`S2-7 地块内容只有 plaza/templeAnchor（实际 ${[...kinds].join(',')}）`, objs.length === 4 && kinds.has('plaza') && [...kinds].every(k => k === 'plaza' || k === 'templeAnchor'));
    // 树的模块就是 temple-tree-camphor（只读复用）
    ok('S2-8 树模块 = temple-tree-camphor（只读复用）', trees.every(t => t.module === 'temple-tree-camphor'));
  }
}

// ---------- S3 后殿北侧院 ----------
{
  const objs = L.objects.filter(o => o.id.startsWith('templeside-'));
  const trees = L.instances.filter(i => i.id.startsWith('templeside-') && i.module === 'temple-tree-camphor');
  const ding = L.instances.find(i => i.id === 'templeside-ding');
  const paving = objs.find(o => o.id === 'templeside-paving');
  ok(`S3-0 对象齐：铺地 1 + 樟 3 + 鼎 1（实测铺地 ${paving ? 1 : 0}、樟 ${trees.length}、鼎 ${ding ? 1 : 0}）`, !!paving && trees.length === 3 && !!ding);
  if (paving && trees.length === 3 && ding) {
    const paveRing = ring(paving.geometry.footprint).map(p => toLocal(p[0], p[1]));
    // 离庙墙每段 ≥0.2（含半厚）
    let dWall = Infinity;
    for (const [a, b] of wallSegsLocal) {
      let m = Infinity;
      for (const p of paveRing) m = Math.min(m, distToSeg(p, a, b));
      dWall = Math.min(dWall, m);
    }
    ok(`S3-1 铺地与庙墙各段净距 ≥0.2+半厚（实测 ${r3(dWall - WALL_HALF_THICK)} m）`, dWall - WALL_HALF_THICK >= 0.2, `min=${r3(dWall)}`);
    // 与后殿（houdian.glb bbox × 实例位姿）净距 ≥1.0
    const hd = L.instances.find(i => i.id === 'temple-houdian');
    ok('S3-2 后殿实例存在（对照物）', !!hd);
    if (hd) {
      const bhd = glbBbox(path.join(ROOT, 'resources', 'temple-v3', 'houdian.glb'));
      const rect = instRectLocal(hd, (bhd.mxx - bhd.mnx) / 2, bhd.mnz, bhd.mxz);
      const d = polyDist(paveRing, rect);
      ok(`S3-3 铺地与后殿体量净距 ≥1.0（实测 ${r3(d)} m）`, d >= 1.0);
    }
    // 树/鼎在铺地内、离铺地边 ≥0.8、彼此 ≥5
    const pos = [...trees, ding].map(t => toLocal(t.position[0], t.position[1]));
    const inPave = pos.map(p => pointInPoly(p, paveRing));
    let edgeMin = Infinity;
    for (const p of pos) for (let i = 0; i < paveRing.length; i++) edgeMin = Math.min(edgeMin, distToSeg(p, paveRing[i], paveRing[(i + 1) % paveRing.length]));
    let pairMin = Infinity;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      pairMin = Math.min(pairMin, Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]));
    }
    ok(`S3-4 树/鼎都在铺地内、离边 ≥0.8（最小 ${r3(edgeMin)} m）`, inPave.every(Boolean) && edgeMin >= 0.8);
    ok(`S3-5 树/鼎彼此间距 ≥5（最小 ${r3(pairMin)} m）`, pairMin >= 5);
    // 不新增大建筑：只有 plaza + templeAnchor
    const kinds = new Set(objs.map(o => o.kind));
    ok(`S3-6 院内只有 plaza/templeAnchor，无大建筑（实际 ${[...kinds].join(',')}）`, objs.length === 5 && [...kinds].every(k => k === 'plaza' || k === 'templeAnchor'));
    ok('S3-7 鼎复用 templeeast-ding 生成件（不改模块）', ding.module === 'templeeast-ding');
  }
}

// ---------- E 碰撞与地面接线（有 OUT_DIR 产物时） ----------
if (fs.existsSync(path.join(OUT, 'collision-temple.json'))) {
  const ct = JSON.parse(fs.readFileSync(path.join(OUT, 'collision-temple.json'), 'utf8'));
  const co = fs.existsSync(path.join(OUT, 'collision-outer.json'))
    ? JSON.parse(fs.readFileSync(path.join(OUT, 'collision-outer.json'), 'utf8')) : null;
  const names = (f) => new Set((f.colliders || []).map(r => r.name));
  const tnames = names(ct);
  ok(`E-1 templeside 树干/鼎盒进 collision-temple（树 3+鼎2 实测 ${[...tnames].filter(n => n.startsWith('templeside-')).length} 条）`,
    [...tnames].filter(n => n.startsWith('templeside-tree-')).length >= 3 && [...tnames].filter(n => n.startsWith('templeside-ding:')).length >= 1);
  ok('E-2 templeside-paving 进庙区 extraGroundNodes', (ct.extraGroundNodes || []).some(n => n.includes('templeside-paving')));
  if (co) {
    const onames = names(co);
    ok(`E-3 anreneast 树干盒进 collision-outer（实测 ${[...onames].filter(n => n.startsWith('anreneast-')).length} 条）`,
      [...onames].filter(n => n.startsWith('anreneast-tree-')).length >= 3);
  } else ok('E-3 anreneast 树干盒进 collision-outer', false, 'collision-outer.json 缺失');
  // 方浜覆盖后的碰撞同步：collision-fangbang 的记录名带 fangbang- 前缀、坐标是地图系
  // （v7 + 覆盖 translate + (53.5,−17.4)，与 scripts/fangbang_overrides.py 的 round4 规则一致）。
  const cfPath = path.join(OUT, 'collision-fangbang.json');
  if (fs.existsSync(cfPath)) {
    const cf = JSON.parse(fs.readFileSync(cfPath, 'utf8'));
    const recs = (cf.colliders || []).filter(r => r.name.split(':')[0] === 'fangbang-westshop-shop-165');
    const v7raw = JSON.parse(fs.readFileSync(path.join(REPO, 'world', 'fangbang-temple-v7', 'collision-world.json'), 'utf8')).colliders
      .filter(r => r.name.split(':')[0] === 'westshop-shop-165');
    const doc = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    const ov165 = (doc.overrides || []).find(o => o.id === 'westshop-shop-165');
    const r4 = x => Math.sign(x) * Math.floor(Math.abs(x) * 10000 + 0.5) / 10000;
    let bad = 0;
    if (ov165 && recs.length === v7raw.length && recs.length > 0) {
      const v7byName = new Map(v7raw.map(r => [r.name, r]));
      for (const r of recs) {
        const src = v7byName.get(r.name.replace('fangbang-', ''));
        if (!src || !src.obb || !r.obb) { bad++; continue; }
        for (let k = 0; k < 3; k++) {
          const exp = r4(src.obb.pos[k] + ov165.translateGlb[k] + (k === 0 ? 53.5 : k === 2 ? -17.4 : 0));
          if (Math.abs(r.obb.pos[k] - exp) > 0.01) { bad++; break; }
        }
      }
    } else bad++;
    ok(`E-4 collision-fangbang 的 165 记录 = v7 源 + 覆盖平移 + 地图偏移（逐条核 ${recs.length} 条，不符 ${bad}）`,
      recs.length > 0 && bad === 0);
  } else ok('E-4 collision-fangbang 存在', false, 'collision-fangbang.json 缺失（FANGBANG=1 + ZONE_SPLIT=1 重建才有）');
  // 分件渲染归属（wave14-templeside S1b 修复的回归门）：内容进正确分件且带网格（子树里有三角形），
  // temple-5 不收 templeside 内容、也不收孤儿子网格（templeside-ding 的 bronze/stone 子件按名字
  // 前缀曾被 temple-5 谓词抢走 → 锚在 temple-2 无网格、temple-5 出现无人认领的副本）。
  const gltfOf = (f) => readGlb(fs.readFileSync(path.join(OUT, f))).gltf;
  const subtreeTris = (g, i) => {
    let t = 0;
    const n = g.nodes[i];
    if (n.mesh !== undefined) for (const pr of g.meshes[n.mesh].primitives) t += g.accessors[pr.indices].count / 3;
    for (const c of n.children || []) t += subtreeTris(g, c);
    return t;
  };
  const findNode = (g, name) => g.nodes.findIndex(n => (n.name || '') === name);
  const hasTris = (g, name) => {
    const i = findNode(g, name);
    return i >= 0 && subtreeTris(g, i) > 0;
  };
  const t1 = gltfOf('zone-temple-1.glb'), t2 = gltfOf('zone-temple-2.glb'), t5 = gltfOf('zone-temple-5.glb'), zo = gltfOf('zone-outer.glb');
  ok('E-5a temple-1：templeside 铺地+3 樟都在且带网格',
    ['temple|templeside-paving|plaza|L1', 'templeside-tree-1', 'templeside-tree-2', 'templeside-tree-3'].every(n => hasTris(t1, n)));
  ok('E-5b temple-2：templeside-ding 在且带网格', hasTris(t2, 'templeside-ding'));
  ok('E-5c temple-5：无 templeside 内容、鼎网格副本只有 templeeast 原件 1 份',
    !t5.nodes.some(n => (n.name || '').startsWith('templeside')) &&
    t5.nodes.filter(n => (n.name || '').startsWith('templeeast-ding__bronze')).length === 1);
  ok('E-6a outer：anreneast 铺地+3 樟都在且带网格',
    ['outer|anreneast-paving|plaza|L1', 'anreneast-tree-1', 'anreneast-tree-2', 'anreneast-tree-3'].every(n => hasTris(zo, n)));
  ok('E-6b outer：shoprow-p165 还在 outer 件（方浜未加载时可见）且带网格',
    (() => { const i = findNode(zo, 'shoprow-p165'); return i >= 0 && subtreeTris(zo, i) > 0; })());
} else {
  ok('E-1 碰撞接线检查（有 OUT_DIR/collision-temple.json 时）', false, `${OUT}/collision-temple.json 缺失——先跑标准重建`);
}

console.log(`\ntempleside-test: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('  FAIL:', f);
process.exit(fail ? 1 : 0);
