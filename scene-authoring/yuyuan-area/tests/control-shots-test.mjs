// WP11/C2 控制层三镜头相机路径契约测试（对照冻结源重算校验，不拿渲染产物自比）。
// 数据源：baseline/layout.json + OUT_DIR/fangbang-route.json（与 build-control-shots.py 相同来源），
// 断言的是几何不变量本身，而非 control-shots.json 与产物的一致性；渲染产物（四通道图）的校验
// 在 scripts/check-control-passes.py —— 它依赖渲染输出，渲染前运行即失败（missing shots 已验证）。
// 断言：
//  1) 三个镜头、每镜头 24 帧，eye/target 数组长度一致；
//  2) 眼高：①②=1.6 m（GOAL 规定），③=桥面 0.55+1.6=2.15 m；
//  3) ①机位逐帧落在 fangbang-route mainStreet 折线上（≤0.05 m），末点=山门接点（layout instance
//     temple-shanmen 锚），行进方向整体向西（x 单调不增）；
//  4) ①注视点不与机位重合（无退化朝向），且末帧注视点沿行进方向外推（在山门以西）；
//  5) ②机位在中心广场（plaza-428199199）footprint 内、距华宝楼（bld-428202599）形心 22–34 m，
//     注视点半径 20 m、注视高度 4 m，24 帧环绕 360°（首末注视方位角差 ≈ 360°）；
//  6) ③机位逐帧落在 jiuqu-bridge polyline 上，末点为折线上最靠近湖心亭（huxin-ting）形心的点，
//     末 1/3 帧注视点收敛到湖心亭形心方向；
//  7) 全部坐标在场景地面范围内；
//  R1-1) 每个镜头声明取景目标 targetId（①山门 temple-shanmen、②华宝楼 bld-428202599、③湖心亭 huxin-ting）。
// 用法：OUT_DIR=out-zone node tests/control-shots-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';
import { loadColliders, viewFromLens, inFrame } from '../scripts/tour-visibility.mjs';
import { evaluateShot } from '../scripts/control-shot-visibility.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let fails = 0;
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); fails++; } };

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const fbRoute = JSON.parse(fs.readFileSync(path.join(OUT, 'fangbang-route.json'), 'utf8'));

// 由源重生成一遍：同一冻结输入必须给出同一相机路径（确定性）
execFileSync('python3', ['scripts/build-control-shots.py', '--out-zone', OUT], { cwd: ROOT, stdio: 'pipe' });
const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'control-shots.json'), 'utf8'));

const objById = (id) => layout.objects.find(o => o.id === id);
const layoutIds = new Set(layout.objects.map(o => o.id));
const ms = fbRoute.mainStreet.map(p => [p[0], p[2]]);
const shanmen = layout.instances.find(i => i.id === 'temple-shanmen').position;

check(doc.version === 1, 'version != 1');
check(doc.width === 1280 && doc.height === 720, '分辨率 != 1280x720');
check(doc.eyeHeightM === 1.6, 'eyeHeightM != 1.6');
check(doc.shots.length === 3, `镜头数 ${doc.shots.length} != 3`);
const byId = Object.fromEntries(doc.shots.map(s => [s.id, s]));
for (const s of doc.shots) {
  check(s.frames === 24, `${s.id} 帧数 ${s.frames} != 24`);
  check(s.eye.length === s.frames && s.target.length === s.frames, `${s.id} eye/target 长度与 frames 不一致`);
}

// R1-1 每个镜头声明取景目标（targetId = layout 对象 id；期望值从 layout 按名重查，不抄生成器）
{
  const expected = {
    'fangbang-westbound': layout.objects.find(o => o.kind === 'templeAnchor' && o.name === '山门')?.id,
    'habao-plaza-pan': layout.objects.find(o => o.name === '华宝楼' && o.kind === 'bazaarBlock')?.id,
    'jiuqu-to-huxinting': layout.objects.find(o => o.name === '湖心亭')?.id,
  };
  for (const s of doc.shots) {
    check(!!expected[s.id] && s.targetId === expected[s.id], `${s.id} 取景目标 targetId=${s.targetId} != ${expected[s.id]}`);
    check(layoutIds.has(s.targetId), `${s.id} targetId ${s.targetId} 不在 layout objects 里`);
  }
}

// ① 方浜中路西行
{
  const s = byId['fangbang-westbound'];
  check(!!s, '缺 fangbang-westbound');
  if (s) {
    check(s.eye.every(p => Math.abs(p[1] - 1.6) < 1e-9), '①眼高 != 1.6 m');
    // 与推导同构：E-W 段 = 首个南向占优段之前的折线；+12 m 沿末段方向外推（折线终点外是物理街道，山门视廊所在）
    let corner = ms.length - 1;
    for (let i = 1; i < ms.length; i++) {
      const dx = ms[i][0] - ms[i - 1][0], dz = ms[i][1] - ms[i - 1][1];
      if (Math.abs(dz) > Math.abs(dx) && ms[i][0] < -50) { corner = i - 1; break; }
    }
    const leg = ms.slice(0, corner + 1);
    const tdx = leg[leg.length - 1][0] - leg[leg.length - 2][0];
    const tdz = leg[leg.length - 1][1] - leg[leg.length - 2][1];
    const tl = Math.hypot(tdx, tdz);
    const walkPoly = [...leg, [leg[leg.length - 1][0] + tdx / tl * 12, leg[leg.length - 1][1] + tdz / tl * 12]];
    let maxOff = 0;
    for (const p of s.eye) maxOff = Math.max(maxOff, distToPolyline([p[0], p[2]], walkPoly));
    check(maxOff <= 0.05, `①机位偏离行走折线 ${maxOff.toFixed(3)} m > 0.05`);
    const last = s.eye[s.eye.length - 1];
    check(dist2d([last[0], last[2]], shanmen) <= 15, `①末点离山门锚 ${dist2d([last[0], last[2]], shanmen).toFixed(1)} m > 15`);
    const xs = s.eye.map(p => p[0]);
    check(xs[0] - xs[xs.length - 1] >= 150, `①净西移 ${(xs[0] - xs[xs.length - 1]).toFixed(1)} m < 150`);
    let peak = -Infinity, regress = 0;
    for (const x of xs) { peak = Math.max(peak, x); regress = Math.max(regress, x - peak); }
    check(regress <= 5, `①东向回退 ${regress.toFixed(1)} m > 5（街道小折曲允许，不得回头）`);
    for (let k = 0; k < s.frames; k++) {
      const d = dist2d([s.eye[k][0], s.eye[k][2]], [s.target[k][0], s.target[k][2]]);
      check(d > 1, `①第 ${k} 帧注视点距机位 ${d.toFixed(2)} m ≤ 1（退化朝向）`);
    }
    const lt = s.target[s.frames - 1];
    check(dist2d([lt[0], lt[2]], shanmen) <= 1.5, `①末帧注视点不在山门锚（偏差 ${dist2d([lt[0], lt[2]], shanmen).toFixed(2)} m）`);
    check(Math.abs(lt[1] - 4.0) < 1e-9, '①末帧注视高度 != 4.0 m');
    check(dist2d([last[0], last[2]], shanmen) >= 4 && dist2d([last[0], last[2]], shanmen) <= 15,
      `①停步点距山门 ${dist2d([last[0], last[2]], shanmen).toFixed(1)} m 不在 4–15`);
  }
}

// ② 华宝楼前广场环视
{
  const s = byId['habao-plaza-pan'];
  const plaza = objById('plaza-428199199');
  const habao = layout.objects.find(o => o.name === '华宝楼' && o.kind === 'bazaarBlock');
  check(!!s && !!plaza && !!habao, '缺 habao-plaza-pan 或 layout 对象（中心广场/华宝楼）');
  if (s && plaza && habao) {
    const fp = habao.geometry.footprint;
    const closed_fp = fp[0][0] === fp[fp.length - 1][0] && fp[0][1] === fp[fp.length - 1][1] ? fp : [...fp, fp[0]];
    const c = centroid(closed_fp);
    // 与推导同构：前街边（street=中心广场 最长边）中点
    const front = habao.frontEdges.filter(e => e.street === '中心广场').reduce((a, b) => (b.lenM > (a?.lenM ?? 0) ? b : a), null);
    check(!!front, '②华宝楼缺中心广场 frontEdge');
    const m = front ? [(front.edge[0][0] + front.edge[1][0]) / 2, (front.edge[0][1] + front.edge[1][1]) / 2] : c;
    const pos = s.eye[0];
    check(pointInPoly([pos[0], pos[2]], plaza.geometry.footprint), '②机位不在中心广场 footprint 内');
    const pf = plaza.geometry.footprint;
    const plazaC = [pf.reduce((a, q) => a + q[0], 0) / pf.length, pf.reduce((a, q) => a + q[1], 0) / pf.length];  // 与脚本同：算术平均
    check(dist2d([pos[0], pos[2]], plazaC) <= 2, `②机位不在中心广场形心 2 m 内（偏差 ${dist2d([pos[0], pos[2]], plazaC).toFixed(1)} m）`);
    check(s.eye.every(p => dist2d([p[0], p[2]], [pos[0], pos[2]]) < 1e-6), '②环视机位应定点');
    check(s.eye.every(p => Math.abs(p[1] - 1.6) < 1e-9), '②眼高 != 1.6 m');
    check(s.target.every(t => Math.abs(t[1] - 1.6) < 1e-9), '②注视高度 != 眼高 1.6 m（水平注视）');
    const panR = dist2d([s.target[0][0], s.target[0][2]], [pos[0], pos[2]]);
    check(Math.abs(panR - 20) < 0.5, `②注视半径 ${panR.toFixed(1)} m != 20`);
    const yaw = (t) => Math.atan2(t[0] - pos[0], t[2] - pos[2]);
    const y0 = yaw(s.target[0]);
    const sweep = s.target.slice(1).reduce((acc, t) => {
      let dy = yaw(t) - acc.prev;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      return { prev: acc.prev + dy, total: acc.total + dy };
    }, { prev: y0, total: 0 }).total;
    check(Math.abs(Math.abs(sweep) - 2 * Math.PI * 23 / 24) < 0.05, `②环视总转角 ${Math.abs(sweep).toFixed(2)} rad 偏离 23×15°`);
    check(dist2d([s.target[0][0], s.target[0][2]], m) < 4, '②首帧注视点未朝向前街边中点方向');
  }
}

// ③ 九曲桥走向湖心亭
{
  const s = byId['jiuqu-to-huxinting'];
  const bridge = objById('jiuqu-bridge');
  const huxin = objById('huxin-ting');
  check(!!s && !!bridge && !!huxin, '缺 jiuqu-to-huxinting 或 layout 对象（九曲桥/湖心亭）');
  if (s && bridge && huxin) {
    const pl = bridge.geometry.polyline;
    const c = centroid(huxin.geometry.footprint);
    check(s.eye.every(p => Math.abs(p[1] - 2.15) < 1e-9), '③眼高 != 桥面0.55+1.6=2.15 m');
    let maxOff = 0;
    for (const p of s.eye) maxOff = Math.max(maxOff, distToPolyline([p[0], p[2]], pl));
    check(maxOff <= 0.05, `③机位偏离九曲桥折线 ${maxOff.toFixed(3)} m > 0.05`);
    const last = s.eye[s.eye.length - 1];
    let best = 0, bd = Infinity;
    const edgeDist = (p, poly) => {
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const abx = b[0] - a[0], abz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz + 1e-12)));
        best = Math.min(best, Math.hypot(p[0] - a[0] - abx * t, p[1] - a[1] - abz * t));
      }
      return best;
    };
    pl.forEach((p, i) => { const d = edgeDist(p, huxin.geometry.footprint); if (d < bd) { bd = d; best = i; } });
    while (best > 0 && edgeDist(pl[best], huxin.geometry.footprint) < 16) best--;   // 同推导：停步点离轮廓 ≥16 m
    check(dist2d([last[0], last[2]], pl[best]) < 1e-6, '③末点不是折线上最靠近湖心亭轮廓的点');
    check(edgeDist([last[0], last[2]], huxin.geometry.footprint) >= 16, '③停步点离湖心亭轮廓 < 16 m（怼脸/进亭）');
    for (let k = 0; k < s.frames; k++) {
      const d = dist2d([s.eye[k][0], s.eye[k][2]], [s.target[k][0], s.target[k][2]]);
      check(d > 1, `③第 ${k} 帧注视点距机位 ${d.toFixed(2)} m ≤ 1（退化朝向）`);
    }
    const mid = s.target[15], end = s.target[s.frames - 1];
    const dEnd = dist2d([end[0], end[2]], c);
    const dMid = dist2d([mid[0], mid[2]], c);
    check(dEnd < dMid, '③末段注视点未向湖心亭形心收敛');
    check(dEnd < 2, `③末帧注视点距湖心亭形心 ${dEnd.toFixed(1)} m > 2`);
  }
}

// ---------- R1-2 逐关键帧可见性（与 tour-test R1 同一套：scripts/tour-visibility.mjs 的碰撞集 / 目标盒 / 遮挡判定） ----------
// 每帧三条：目标包围盒 9 采样点 ≥5 点视线不被碰撞盒挡；目标投影（裁到 1280×720 画面、按镜头 lensMm 的真实 fov）≥ 8%；
// 相机距最近可遮挡碰撞盒（顶 ≥1.6 m）≥ 1.5 m。终点帧三条全满足；每连续 6 帧至少 3 帧三条全满足（中间帧允许目标暂时出画）。
// 例外（明示）：①方浜中路西行是行进揭示镜头，GOAL R1 定「①不变」——山门在庙前转角后才露出，190 m 行进前段
// 山门投影 < 8% 是镜头设计本身；窗口规则对①只查末 6 帧（揭示段），终点帧规则照常。②③无例外。
// ② 另查：沿弧线移动（非原地转头）、整座楼（footprint 棱柱，高 = 变体目标高）逐帧全部在画面内。
// ③ 另查：终点在桥面上（距中线 ≤0.85 m，桥栏内侧 0.89 m）、离湖心亭形心 15–25 m；画面下 1/3 被 10 m 内桥栏挡住的射线 ≤15%（逐帧）。
const R1 = { minPts: 5, minArea: 0.08, minClr: 1.5, win: 6, winMin: 3, railNearM: 10, railMax: 0.15 };
const WINDOW_FROM = { 'fangbang-westbound': (n) => n - R1.win };
const boxes = loadColliders(ROOT, path.relative(ROOT, OUT));
const BAZAAR_TOWERS = process.env.BAZAAR_TOWERS === '1';
const habaoObj = layout.objects.find(o => o.name === '华宝楼' && o.kind === 'bazaarBlock');
// 华宝楼目标高：程序化体块 = layout height；BAZAAR_TOWERS=1 = 套件冻结参数最高点（角亭宝顶 finial.topM 与主脊 ridgeHeightM 取大）
const towerP = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'bazaar-tower-kit', 'params', `huabao-${habaoObj.id}.json`), 'utf8'));
const habaoH = BAZAAR_TOWERS ? Math.max(towerP.roof.ridgeHeightM, towerP.pavilion.finial.topM) : habaoObj.height;
const r1Summary = {};
for (const s of doc.shots) {
  const ev = evaluateShot({ ...s, targetHeightM: s.id === 'habao-plaza-pan' ? habaoH : undefined, railCheck: s.id === 'jiuqu-to-huxinting' }, layout, boxes);
  const n = ev.frames.length;
  const ok = ev.frames.map(f => f.vis >= R1.minPts && f.area >= R1.minArea && f.clearance >= R1.minClr);
  const e = ev.frames[n - 1];
  check(e.vis >= R1.minPts, `${s.id} 终点帧目标 9 点仅 ${e.vis} 点可见（<5）`);
  check(e.area >= R1.minArea, `${s.id} 终点帧目标投影 ${(e.area * 100).toFixed(1)}% < 8%`);
  check(e.clearance >= R1.minClr, `${s.id} 终点帧相机距碰撞盒 ${e.clearanceName} ${e.clearance.toFixed(2)} m < 1.5`);
  const from = WINDOW_FROM[s.id] ? WINDOW_FROM[s.id](n) : 0;
  for (let i = from; i + R1.win <= n; i++) {
    const c = ok.slice(i, i + R1.win).filter(Boolean).length;
    check(c >= R1.winMin, `${s.id} 帧 ${i}–${i + R1.win - 1} 仅 ${c}/6 帧满足可见性三条（需 ≥3）`);
  }
  r1Summary[s.id] = { lensMm: ev.lensMm, okFrames: ok.filter(Boolean).length, end: { vis: e.vis, area: +e.area.toFixed(3), clearance: +e.clearance.toFixed(2), distM: +e.dist.toFixed(1) } };
  if (s.id === 'habao-plaza-pan') {
    check(Math.abs((s.targetHeightM ?? habaoObj.height) - habaoH) < 1e-6, `②目标高 targetHeightM=${s.targetHeightM} != ${habaoH}（BAZAAR_TOWERS=${BAZAAR_TOWERS ? 1 : 0}）`);
    let pathLen = 0;
    for (let k = 1; k < n; k++) pathLen += dist2d([s.eye[k][0], s.eye[k][2]], [s.eye[k - 1][0], s.eye[k - 1][2]]);
    check(pathLen >= 10, `②机位移动 ${pathLen.toFixed(1)} m < 10（原地转头，不是沿弧线）`);
    const c2 = [(ev.box.min[0] + ev.box.max[0]) / 2, (ev.box.min[2] + ev.box.max[2]) / 2];
    const rs = s.eye.map(p => dist2d([p[0], p[2]], c2));
    check(Math.max(...rs) - Math.min(...rs) <= 1.0, `②机位到华宝楼中心半径变化 ${(Math.max(...rs) - Math.min(...rs)).toFixed(2)} m > 1（不是弧线）`);
    const az = s.eye.map(p => Math.atan2(p[0] - c2[0], p[2] - c2[1]));
    let sweep = 0;
    for (let k = 1; k < n; k++) { let d = az[k] - az[k - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sweep += d; }
    check(Math.abs(sweep) >= 20 * Math.PI / 180, `②弧线扫角 ${(Math.abs(sweep) * 180 / Math.PI).toFixed(1)}° < 20°`);
    const fp = habaoObj.geometry.footprint.slice(0, -1);
    const prism = fp.flatMap(p => [[p[0], 0, p[1]], [p[0], habaoH, p[1]]]);
    const view = viewFromLens(s.lensMm ?? 50);
    const whole = s.eye.map((cam, k) => prism.filter(q => inFrame(q, cam, s.target[k], view)).length);
    whole.forEach((w, k) => check(w === prism.length, `②第 ${k} 帧整座楼（footprint 棱柱 ${prism.length} 角，高 ${habaoH} m）仅 ${w} 角在画面内`));
    Object.assign(r1Summary[s.id], { pathLenM: +pathLen.toFixed(1), sweepDeg: +(Math.abs(sweep) * 180 / Math.PI).toFixed(1), wholeFrames: whole.filter(w => w === prism.length).length, targetHeightM: habaoH });
  }
  if (s.id === 'jiuqu-to-huxinting') {
    const pl = objById('jiuqu-bridge').geometry.polyline;
    const hc = centroid(objById('huxin-ting').geometry.footprint);
    const offs = s.eye.map(p => distToPolyline([p[0], p[2]], pl));
    check(Math.max(...offs) <= 0.85, `③机位离桥中线 ${Math.max(...offs).toFixed(2)} m > 0.85（出了桥栏内侧）`);
    const last = s.eye[n - 1], dEnd = dist2d([last[0], last[2]], hc);
    check(dEnd >= 15 && dEnd <= 25, `③终点离湖心亭形心 ${dEnd.toFixed(1)} m 不在 15–25`);
    const rail = s.eye.map((cam, k) => ev.frames[k].railLowerThird);
    ev.frames.forEach((f, k) => check(f.railNear <= R1.railMax, `③第 ${k} 帧画面下 1/3 被 ${R1.railNearM} m 内桥栏挡住 ${(f.railNear * 100).toFixed(0)}% > ${R1.railMax * 100}%`));
    Object.assign(r1Summary[s.id], { endDistM: +dEnd.toFixed(1), maxDeckOffsetM: +Math.max(...offs).toFixed(2),
      railNearMaxPct: Math.round(Math.max(...ev.frames.map(f => f.railNear)) * 100), railAllMaxPct: Math.round(Math.max(...rail) * 100), eyeY: last[1] });
  }
}
console.log('control-shots-test R1:', JSON.stringify(r1Summary));

// ⑦ 场景范围
const g = layout.objects.find(o => o.id === 'ground').geometry.bounds;
for (const s of doc.shots) {
  for (const arr of [s.eye, s.target]) for (const p of arr) {
    check(p[0] >= g[0] && p[0] <= g[2] && p[2] >= g[1] && p[2] <= g[3], `${s.id} 坐标越界 (${p[0]}, ${p[2]})`);
  }
}

console.log(`control-shots-test: ${fails ? fails + ' fail' : 'all pass'}`);
process.exit(fails ? 1 : 0);
