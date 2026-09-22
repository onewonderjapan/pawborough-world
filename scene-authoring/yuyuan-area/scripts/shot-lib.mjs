// 机位几何工具库：净距/视线检查 + 沿街/组团/远眺取景机位搜索。
// 规则与 scripts/compute-g3-shots.mjs 相同（g3 脚本是已冻结证据的生成器，保持原样；
// G4 起新脚本统一从这里引用，避免规则分叉）。
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';

export function makeShotTools(layout, map = null) {
  const blds = layout.objects.filter(o => o.geometry && o.geometry.footprint && /^bld-/.test(o.id))
    .map(o => ({ id: o.id, fp: o.geometry.footprint }));
  const waters = layout.objects.filter(o => o.kind === 'water').map(o => o.geometry.footprint);
  const closed = fp => [...fp, fp[0]];
  function pointBlocked(p, ignoreIds = []) {
    for (const b of blds) {
      if (ignoreIds.includes(b.id)) continue;
      if (pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 0.8) return true;
    }
    for (const w of waters) if (pointInPoly(p, w) || distToPolyline(p, closed(w)) < 0.6) return true;
    return false;
  }
  function rayBlocked(p, q, ignoreIds = []) {
    const L = dist2d(p, q), n = Math.max(2, Math.ceil(L / 0.5));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (const b of blds) {
        if (ignoreIds.includes(b.id)) continue;
        if (pointInPoly(s, b.fp) || distToPolyline(s, closed(b.fp)) < 0.5) return true;
      }
    }
    return false;
  }
  // 沿街机位：路弧长 sCam 处高 hCam，看向弧长 sTarget 处（同一街）；在 ±slid 范围内找干净点
  function streetCam(road, sCam, sTarget, { h = 1.7, lateral = 0, slid = 8, latT = 0 } = {}) {
    const total = (() => { let t = 0; for (let i = 0; i < road.points.length - 1; i++) t += dist2d(road.points[i], road.points[i + 1]); return t; })();
    const at = (s) => {
      s = Math.max(0.5, Math.min(total - 0.5, s));
      let acc = 0;
      for (let i = 0; i < road.points.length - 1; i++) {
        const L = dist2d(road.points[i], road.points[i + 1]);
        if (s <= acc + L || i === road.points.length - 2) {
          const t = (s - acc) / (L || 1);
          const p = [road.points[i][0] + (road.points[i + 1][0] - road.points[i][0]) * t, road.points[i][1] + (road.points[i + 1][1] - road.points[i][1]) * t];
          const u = [(road.points[i + 1][0] - road.points[i][0]) / (L || 1), (road.points[i + 1][1] - road.points[i][1]) / (L || 1)];
          return { p, u, n: [-u[1], u[0]] };
        }
        acc += L;
      }
      return null;
    };
    const tgt = at(sTarget);
    for (let d = 0; d <= slid; d += 1) {
      for (const sgn of d === 0 ? [1] : [1, -1]) {
        const cam0 = at(sCam + sgn * d);
        if (!cam0 || !tgt) continue;
        for (const lat of [0, lateral, -lateral, lateral * 2, -lateral * 2]) {
          const c = [cam0.p[0] + cam0.n[0] * lat, h, cam0.p[1] + cam0.n[1] * lat];
          if (pointBlocked([c[0], c[2]])) continue;
          const tp = [tgt.p[0] + tgt.n[0] * latT, tgt.p[1] + tgt.n[1] * latT];
          if (rayBlocked([c[0], c[2]], tp)) continue;
          return { p: [+c[0].toFixed(1), h, +c[2].toFixed(1)], t: [+tp[0].toFixed(1), 1.5, +tp[1].toFixed(1)] };
        }
      }
    }
    return null;
  }
  // 组团机位：看向组团质心，相机在路对侧/沿街后退处
  function clusterCam(clusterId, { h = 1.7, dist = 11 } = {}) {
    const members = layout.objects.filter(o => o.kind === 'stall' && o.cluster === clusterId);
    if (!members.length) return null;
    const c = centroid(members.map(m => m.geometry.position));
    const roadId = members[0].faces.roadOsm;
    const road = map.roads.find(r => r.id === roadId);
    const rp = members[0].faces.refPoint;
    const back = [c[0] - (rp[0] - c[0]), c[1] - (rp[1] - c[1])];
    const bl = Math.hypot(back[0] - c[0], back[1] - c[1]) || 1;
    const dir = [(back[0] - c[0]) / bl, (back[1] - c[1]) / bl];
    for (const dd of [dist, dist + 3, dist - 2, dist + 6, dist + 10]) {
      for (const sw of [-3, -1.5, 0, 1.5, 3, 5, -5, 7, -7]) {
        const px = c[0] + dir[0] * dd + -dir[1] * sw, pz = c[1] + dir[1] * dd + dir[0] * sw;
        if (pointBlocked([px, pz])) continue;
        if (rayBlocked([px, pz], c)) continue;
        return { p: [+px.toFixed(1), h, +pz.toFixed(1)], t: [+c[0].toFixed(1), 1.3, +c[1].toFixed(1)] };
      }
    }
    return null;
  }
  // 取景遮挡集：建筑 + 园墙/庙墙/月洞门墙 + 假山（树冠不算）。墙很薄，视线采样需加密防跳过。
  const vistaObs = [
    ...blds,
    ...layout.objects.filter(o => ['wall', 'moonGateWall', 'rockery'].includes(o.kind) && o.geometry && o.geometry.footprint)
      .map(o => ({ id: o.id, fp: o.geometry.footprint })),
  ];
  // 取景机位点：不入任何遮挡物，且离建筑/墙缘 ≥2.5m（防贴脸墙面入画）、不入水（允许贴水缘）
  function vistaPointClean(p) {
    for (const b of vistaObs) if (pointInPoly(p, b.fp) || distToPolyline(p, closed(b.fp)) < 2.5) return false;
    for (const w of waters) if (pointInPoly(p, w)) return false;
    return true;
  }
  const vistaClearance = (p) => Math.min(...vistaObs.map(b => distToPolyline(p, closed(b.fp))));
  // 视线是否被挡：穿入建筑内部（掠边合法），或穿过墙/假山（薄体按 0.15m 密采样防跳过）
  function rayEntersBuilding(p, q) {
    const L = dist2d(p, q), n = Math.max(2, Math.ceil(L / 0.15));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (const b of vistaObs) if (pointInPoly(s, b.fp)) return true;
    }
    return false;
  }
  // 远眺取景机位：目标点 + 一组种子点，环形滑动收集干净候选，按离遮挡物净距最大者胜出。
  // 取景规则（与行人走廊规则不同，见 strictRay）：机位点不入建筑/水（允许贴水缘）；
  // 视线不入建筑内部（掠边合法）。strictRay=true 时改用走廊级 0.5m 掠边余量。
  function vistaCam(target2d, ty, seeds, { h = 8, ring = 14, strictRay = false } = {}) {
    let best = null, bestClear = -1;
    for (const s of seeds) {
      for (let d = 0; d <= ring; d += 2) {
        for (let a = 0; a < 8; a++) {
          const th = (a / 8) * Math.PI * 2;
          const px = s[0] + Math.cos(th) * d, pz = s[1] + Math.sin(th) * d;
          if (!vistaPointClean([px, pz])) continue;
          const rayHit = strictRay ? rayBlocked([px, pz], target2d) : rayEntersBuilding([px, pz], target2d);
          if (rayHit) continue;
          const c = vistaClearance([px, pz]);
          if (c > bestClear) { bestClear = c; best = { p: [+px.toFixed(1), h, +pz.toFixed(1)], t: [+target2d[0].toFixed(1), ty, +target2d[1].toFixed(1)] }; }
        }
      }
    }
    return best;
  }
  return { blds, waters, pointBlocked, rayBlocked, rayEntersBuilding, vistaPointClean, vistaClearance, streetCam, clusterCam, vistaCam };
}
