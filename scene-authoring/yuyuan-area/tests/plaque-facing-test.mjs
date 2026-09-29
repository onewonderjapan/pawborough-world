// wave13-plaquefix：商城楼套件立面面板（大匾 / 每间空匾 / 店招 / 店面后壁 / 店面玻璃）的正面朝向契约（静态，读 raw 分区 GLB）。
//
// 背景：查看器 web/main.js prepare() 对无贴图、无顶点色的材质一律 FrontSide（背面剔除；全场 cm 件 137 个无贴图材质里
// 128 个在 glTF 里标 doubleSided（Blender 默认导出），约 1/3 三角共用这条剔除策略）。build_tower.py 的 rpanel()
// 约定「法线 = run 外法线」，但 6c6270fb 及以前的绕序经 to_b 的 (x,-z) 镜像后正面朝楼内：Cycles 不剔除看得见，
// 浏览器从街面看到的是背面 → 被剔除，大匾（btk-dark + btk-gild）、店招（btk-signred）、店面后壁（btk-shopback）、
// 店面玻璃（btk-glass）整块不画，射线也穿过去打到后面的窗背板。
//
// 真相来源（不读生成器任何输出、不拿产物和自己比）：见 tests/plaque-lib.mjs（layout footprint 外法线 + params 大匾尺寸）。
// 断言：
//   P1 每块 features.plaques 大匾：该楼锚节点下 plaques__dark* 有 2 个面积 = w·h/2 的三角（板），
//      plaques__gild* 有 2 个面积 = (w+2b)(h+2b)/2 的三角（金框）；
//   P2 这些三角的绕序法线与 footprint 外法线同向（cos ≥ 0.9），且 NORMAL 属性与绕序一致（cos ≥ 0.9）；
//   P3 全部 15 栋：plaques__* / shopfront__* 节点里五种无贴图立面面板材质的竖直三角（面积 ≥ 0.05 m² 且高 ≥ 0.1 m：
//      挂杆小盒子面、店面顶 4 cm 厚黑漆板条这类封闭体块的朝墙侧面不计）全部外向。
// 红态：6c6270fb 产物（rpanel 绕序朝内）P2 8 项 / P3 15 栋全红，见工单包 artifacts/red-plaque-facing-6c6270fb.log。
import path from 'node:path';
import { ROOT, loadInputs, panelTriangles, bigPlaques, footprintEdges, outwardFor, triInfo, dot } from './plaque-lib.mjs';

const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let pass = 0, fail = 0;
const ok = (msg, cond, data) => { if (cond) { pass++; console.log('PASS', msg); } else { fail++; console.log('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };

const inp = loadInputs(OUT);
const towers = panelTriangles(inp.files, inp.ids.ids);
ok('15 栋商城楼都在 bazaar 分件里找到面板节点', inp.ids.ids.every(id => towers.has(id)), inp.ids.ids.filter(id => !towers.has(id)));

// P1 / P2：features.plaques 大匾
const pls = bigPlaques(inp, towers);
ok('P1 features.plaques 大匾块数 = 4（华宝 1 / 悦宾 1 / 和丰 2）', pls.length === 4, pls.map(p => p.id));
for (const p of pls) {
  for (const [what, key] of [['板', 'board'], ['金框', 'frame']]) {
    const s = p[key], tag = `${p.id} ${p.name} 大匾#${p.index}（${p.storey} 层 ${p.wM}×${p.hM}）${what}`;
    ok(`P1 ${tag} 存在（2 三角）`, s.n === 2, { found: s.n });
    if (!s.n) continue;
    ok(`P2 ${tag} 正面朝外（绕序法线·footprint 外法线 ≥ 0.9）`, s.cosOut >= 0.9, { center: s.center.map(v => +v.toFixed(2)), cosOut: +s.cosOut.toFixed(3), edgeDist: s.edgeDist && +s.edgeDist.toFixed(2) });
    ok(`P2 ${tag} NORMAL 与绕序一致`, s.cosVn >= 0.9, { cosVn: +s.cosVn.toFixed(3) });
  }
}

// P3：全部 15 栋，五种无贴图立面面板材质的竖直三角全部外向
const summary = {};
for (const id of inp.ids.ids) {
  const eds = footprintEdges(inp.FP.get(id));
  const byMat = {};
  for (const t0 of towers.get(id) || []) {
    const t = { ...t0, ...triInfo(t0) };
    const hY = Math.max(...t.P.map(q => q[1])) - Math.min(...t.P.map(q => q[1]));
    if (t.area < 0.05 || Math.abs(t.n[1]) > 0.3 || hY < 0.1) continue;   // 封闭体块（4 cm 厚黑漆板条等）的侧面可合法朝墙，只看高 ≥ 0.1 m 的面板
    const out = outwardFor(t.cen, t.n, eds);
    const s = byMat[t.mat] || (byMat[t.mat] = { out: 0, in: 0, noEdge: 0 });
    if (!out) s.noEdge++; else if (dot(t.n, out.n) > 0) s.out++; else s.in++;
  }
  summary[id] = byMat;
  const inward = Object.entries(byMat).filter(([, s]) => s.in > 0 || s.noEdge > 0).map(([m, s]) => `${m} in ${s.in} noEdge ${s.noEdge} / ${s.in + s.out + s.noEdge}`);
  const total = Object.values(byMat).reduce((s, v) => s + v.out + v.in + v.noEdge, 0);
  ok(`P3 ${id} 立面面板（${Object.keys(byMat).join(' / ') || '无'}）竖直三角全部朝外（共 ${total}）`, total > 0 && inward.length === 0, inward);
}
console.log('summary', JSON.stringify(summary));
console.log(`plaque-facing: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
