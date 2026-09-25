// WP11/C2 控制层三镜头相机路径契约测试（对照冻结源重算校验，不拿渲染产物自比）。
// 数据源：baseline/layout.json + OUT_DIR/fangbang-route.json（与 build-control-shots.py 相同来源），
// 断言的是几何不变量本身，而非 control-shots.json 与产物的一致性；渲染产物（四通道图）的校验
// 在 scripts/check-control-passes.py —— 它依赖渲染输出，渲染前运行即失败（missing shots 已验证）。
// 断言：
//  1) 三个镜头、每镜头 24 帧，eye/target 数组长度一致；
//  2) ①眼高 1.6 m；②眼高 1.6 m；③机位 ≥ 桥面 0.55 + 1.6 m（R1 升高机位）；
//  3) ①机位逐帧落在 fangbang-route mainStreet 折线上（≤0.05 m），末点=山门接点（layout instance
//     temple-shanmen 锚），行进方向整体向西（x 单调不增）；①路径 R1 不变；
//  4) ①注视点不与机位重合（无退化朝向），且末帧注视点沿行进方向外推（在山门以西）；
//  5) ②机位逐帧在中心广场（plaza-428199199）footprint 内，镜头 json 带 lensMm；
//  6) ③从桥头起步、一路走近湖心亭（≥5 m，逐帧离亭距离不回升），注视点锁定 huxin-ting 形心；
//  7) 全部坐标在场景地面范围内；
//  R1-1) 每个镜头声明取景目标 targetId（①山门 temple-shanmen、②华宝楼 bld-428202599、③湖心亭 huxin-ting）；
//  R1-2) 逐关键帧可见性（tour-test R1 同一套）+ ②弧线/整楼入画 + ③桥面/15–25 m/桥栏不挡画面下 1/3（详见该段注释）。
//  W5) wave5-shots2 第二批 8 镜头（④–⑪，scripts/control-shots-spec.json）：取景目标按名从 layout 重查；
//      路径硬规则（不穿墙、不进建筑 footprint、离碰撞盒 ≥1.0 m、地面镜头眼高 1.6 m）+ 逐关键帧可见性（R1 同口径）
//      + 每镜头运镜语义（推进/横移/沿廊/中轴/升高仰视/环绕/定机位微推/街中东行），详见 W5 段注释。
// 华宝楼塔楼变体：BAZAAR_TOWERS=1 OUT_DIR=out-zone-towers node tests/control-shots-test.mjs（目标高取套件参数）。
// 草稿复验：CONTROL_SHOTS_SPEC=<草稿 spec> 让生成器改读草稿（新断言先在未修正的草稿上跑出失败）。
// 用法：OUT_DIR=out-zone node tests/control-shots-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { centroid, distToPolyline, pointInPoly, dist2d } from '../src/lib.mjs';
import { loadColliders, viewFromLens, inFrame, projectPoint, segBlocked, nearestColliderDist, screenAreaFrac, targetBox, ZONE_FILES } from '../scripts/tour-visibility.mjs';
import { anchorBehindSharedEdge, rearWallFace } from '../src/lib.mjs';
import { evaluateShot } from '../scripts/control-shot-visibility.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let fails = 0;
const check = (ok, msg) => { if (!ok) { console.error('FAIL:', msg); fails++; } };

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const fbRoute = JSON.parse(fs.readFileSync(path.join(OUT, 'fangbang-route.json'), 'utf8'));

// 由源重生成一遍：同一冻结输入必须给出同一相机路径（确定性）
execFileSync('python3', ['scripts/build-control-shots.py', '--out-zone', OUT, ...(process.env.CONTROL_SHOTS_SPEC ? ['--spec', process.env.CONTROL_SHOTS_SPEC] : [])], { cwd: ROOT, stdio: 'pipe' });
const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'control-shots.json'), 'utf8'));

const objById = (id) => layout.objects.find(o => o.id === id);
const layoutIds = new Set(layout.objects.map(o => o.id));
const ms = fbRoute.mainStreet.map(p => [p[0], p[2]]);
const shanmen = layout.instances.find(i => i.id === 'temple-shanmen').position;

check(doc.version === 1, 'version != 1');
check(doc.width === 1280 && doc.height === 720, '分辨率 != 1280x720');
check(doc.eyeHeightM === 1.6, 'eyeHeightM != 1.6');
check(doc.shots.length === 11, `镜头数 ${doc.shots.length} != 11（①–③ + wave5 ④–⑪）`);
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
  for (const s of doc.shots.filter(x => x.id in expected)) {
    check(!!expected[s.id] && s.targetId === expected[s.id], `${s.id} 取景目标 targetId=${s.targetId} != ${expected[s.id]}`);
    check(layoutIds.has(s.targetId), `${s.id} targetId ${s.targetId} 不在 layout objects 里`);
  }
  for (const id of Object.keys(expected)) check(!!byId[id], `缺 ${id}`);
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

// ② 华宝楼前广场弧线环视（R1 契约：几何部分；可见性 / 弧线 / 整楼入画在下方 R1-2）
{
  const s = byId['habao-plaza-pan'];
  const plaza = objById('plaza-428199199');
  check(!!s && !!plaza, '缺 habao-plaza-pan 或 layout 中心广场');
  if (s && plaza) {
    s.eye.forEach((p, k) => check(pointInPoly([p[0], p[2]], plaza.geometry.footprint), `②第 ${k} 帧机位不在中心广场 footprint 内`));
    check(s.eye.every(p => Math.abs(p[1] - 1.6) < 1e-9), '②眼高 != 1.6 m');
    for (let k = 0; k < s.frames; k++) {
      const d = dist2d([s.eye[k][0], s.eye[k][2]], [s.target[k][0], s.target[k][2]]);
      check(d > 1, `②第 ${k} 帧注视点距机位 ${d.toFixed(2)} m ≤ 1（退化朝向）`);
    }
    check(typeof s.lensMm === 'number' && s.lensMm > 0, '②缺 lensMm（弧线整楼取景的焦距必须写进镜头 json）');
  }
}

// ③ 九曲桥走向湖心亭（R1 契约：几何部分；桥面 / 终点距离 / 桥栏遮挡在下方 R1-2）
{
  const s = byId['jiuqu-to-huxinting'];
  const bridge = objById('jiuqu-bridge');
  const huxin = objById('huxin-ting');
  check(!!s && !!bridge && !!huxin, '缺 jiuqu-to-huxinting 或 layout 对象（九曲桥/湖心亭）');
  if (s && bridge && huxin) {
    const pl = bridge.geometry.polyline;
    const c = centroid(huxin.geometry.footprint);
    const deck = bridge.deckY ?? 0.55;
    check(s.eye.every(p => p[1] >= deck + 1.6), `③机位低于桥面眼高 ${deck + 1.6} m`);
    check(dist2d([s.eye[0][0], s.eye[0][2]], pl[0]) <= 3, `③起点离桥头 ${dist2d([s.eye[0][0], s.eye[0][2]], pl[0]).toFixed(1)} m > 3（应从桥头起步）`);
    const dists = s.eye.map(p => dist2d([p[0], p[2]], c));
    let rise = 0;
    for (let k = 1; k < dists.length; k++) rise = Math.max(rise, dists[k] - dists[k - 1]);
    check(dists[0] - dists[dists.length - 1] >= 5, `③走近湖心亭仅 ${(dists[0] - dists[dists.length - 1]).toFixed(1)} m < 5`);
    check(rise <= 0.3, `③逐帧离亭距离回升 ${rise.toFixed(2)} m > 0.3（应一路走近）`);
    for (let k = 0; k < s.frames; k++) {
      const d = dist2d([s.eye[k][0], s.eye[k][2]], [s.target[k][0], s.target[k][2]]);
      check(d > 1, `③第 ${k} 帧注视点距机位 ${d.toFixed(2)} m ≤ 1（退化朝向）`);
      check(dist2d([s.target[k][0], s.target[k][2]], c) <= 0.5, `③第 ${k} 帧注视点离湖心亭形心 ${dist2d([s.target[k][0], s.target[k][2]], c).toFixed(2)} m > 0.5（未锁定目标）`);
    }
  }
}

// ---------- R1-2 逐关键帧可见性（与 tour-test R1 同一套：scripts/tour-visibility.mjs 的碰撞集 / 目标盒 / 遮挡判定） ----------
// 每帧三条：目标包围盒 9 采样点 ≥5 点视线不被碰撞盒挡；目标投影（裁到 1280×720 画面、按镜头 lensMm 的真实 fov）≥ 8%；
// 相机距最近可遮挡碰撞盒（顶 ≥1.6 m）≥ 1.5 m。终点帧三条全满足；每连续 6 帧至少 3 帧三条全满足（中间帧允许目标暂时出画）。
// 例外（明示）：①方浜中路西行是行进揭示镜头，GOAL R1 定「①不变」——山门在庙前转角后才露出，190 m 行进前段
// 山门投影 < 8% 是镜头设计本身；窗口规则对①只查末 6 帧（揭示段），终点帧规则照常。②③无例外。
// wave5 ⑪（①的镜像，西端东行到山门）同此例外；④–⑩无例外。
// ② 另查：沿弧线移动（非原地转头）、整座楼（footprint 棱柱，高 = 变体目标高）逐帧全部在画面内。
// ③ 另查：终点在桥面上（距中线 ≤0.85 m，桥栏内侧 0.89 m）、离湖心亭形心 15–25 m；画面下 1/3 被 10 m 内桥栏挡住的射线 ≤15%（逐帧）。
const R1 = { minPts: 5, minArea: 0.08, minClr: 1.5, win: 6, winMin: 3, railNearM: 10, railMax: 0.15 };
// wave5：⑪方浜中路东行是①的镜像（同一条街从西端走向山门），山门在庙前街角店屋（shoprow-p169/p171）之后才露出，同①只查末 6 帧窗口。
const WINDOW_FROM = { 'fangbang-westbound': (n) => n - R1.win, 'fangbang-eastbound': (n) => n - R1.win };
const boxes = loadColliders(ROOT, path.relative(ROOT, OUT));
const BAZAAR_TOWERS = process.env.BAZAAR_TOWERS === '1';
const habaoObj = layout.objects.find(o => o.name === '华宝楼' && o.kind === 'bazaarBlock');
// 华宝楼目标高：程序化体块 = layout height；BAZAAR_TOWERS=1 = 套件冻结参数最高点（角亭宝顶 finial.topM 与主脊 ridgeHeightM 取大）
const towerP = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'bazaar-tower-kit', 'params', `huabao-${habaoObj.id}.json`), 'utf8'));
const habaoH = BAZAAR_TOWERS ? Math.max(towerP.roof.ridgeHeightM, towerP.pavilion.finial.topM) : habaoObj.height;
// W5 镜头（④–⑪）同一套三条，差别只在两处（均为 GOAL wave5 的明文口径）：净距门槛 1.0 m（GOAL「离碰撞盒 ≥ 1.0 m」；
// ⑥园廊内柱距本身只有 ±1.1 m）；碰撞集加方浜中路分区 collision-fangbang.json（⑪走在方浜西延段，店屋碰撞要算遮挡）。
const W5_IDS = new Set(['garden-entry-sansuitang', 'dajiashan-across-pond', 'garden-corridor-walk', 'temple-axis-push',
  'temple-dadian-rise', 'bazaar-plaza-orbit', 'huxinting-across-pond', 'fangbang-eastbound']);
const W5_MIN_CLR = 1.0;
const boxesAll = loadColliders(ROOT, path.relative(ROOT, OUT), [...ZONE_FILES, 'fangbang']);
const r1Summary = {};
for (const s of doc.shots) {
  const w5 = W5_IDS.has(s.id);
  const minClr = w5 ? W5_MIN_CLR : R1.minClr;
  const ev = evaluateShot({ ...s, targetHeightM: s.targetId === habaoObj.id ? habaoH : undefined, railCheck: s.id === 'jiuqu-to-huxinting' }, layout, w5 ? boxesAll : boxes);
  const n = ev.frames.length;
  const ok = ev.frames.map(f => f.vis >= R1.minPts && f.area >= R1.minArea && f.clearance >= minClr);
  const e = ev.frames[n - 1];
  check(e.vis >= R1.minPts, `${s.id} 终点帧目标 9 点仅 ${e.vis} 点可见（<5）`);
  check(e.area >= R1.minArea, `${s.id} 终点帧目标投影 ${(e.area * 100).toFixed(1)}% < 8%`);
  check(e.clearance >= minClr, `${s.id} 终点帧相机距碰撞盒 ${e.clearanceName} ${e.clearance.toFixed(2)} m < ${minClr}`);
  const from = WINDOW_FROM[s.id] ? WINDOW_FROM[s.id](n) : 0;
  for (let i = from; i + R1.win <= n; i++) {
    const c = ok.slice(i, i + R1.win).filter(Boolean).length;
    check(c >= R1.winMin, `${s.id} 帧 ${i}–${i + R1.win - 1} 仅 ${c}/6 帧满足可见性三条（需 ≥3）`);
  }
  r1Summary[s.id] = { lensMm: ev.lensMm, okFrames: ok.filter(Boolean).length, minArea: +Math.min(...ev.frames.map(f => f.area)).toFixed(3), end: { vis: e.vis, area: +e.area.toFixed(3), clearance: +e.clearance.toFixed(2), distM: +e.dist.toFixed(1) } };
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

// ---------- W5 wave5-shots2：第二批 8 镜头（④–⑪）的路径硬规则与运镜语义 ----------
// 期望值全部按名 / 几何从 baseline/layout.json 与管线碰撞重查，不读 spec、不抄生成器常数。
// 路径硬规则（逐帧，GOAL wave5）：
//   P1 机位离任何碰撞盒（全部高度，含方浜中路分区；水面隐形挡墙不算）≥ 1.0 m；
//   P2 相邻两帧机位连线不穿过任何碰撞盒（不穿墙）；
//   P3 机位路径（相邻帧连线按 0.25 m 采样）不进建筑类 footprint（机位高于该建筑高 + 1 m 的航拍帧除外）；
//      地面镜头另不进水面 footprint；
//   P4 地面镜头眼高 1.6 m；④–⑪ 的镜头类别（地面 / 升高 / 低空航拍）按 GOAL 文字定在下表，不从镜头 json 读。
const W5 = {
  'garden-entry-sansuitang': { no: 4, cls: 'ground', target: () => layout.objects.find(o => o.name === '三穗堂' && o.kind === 'hall') },
  'dajiashan-across-pond': { no: 5, cls: 'ground', target: () => layout.objects.find(o => o.kind === 'rockery' && (o.name || '').startsWith('大假山')) },
  'garden-corridor-walk': { no: 6, cls: 'ground', target: () => layout.objects.find(o => o.kind === 'watersideGallery' && o.name === '听涛阁') },
  'temple-axis-push': { no: 7, cls: 'ground', target: () => layout.objects.find(o => o.kind === 'templeAnchor' && o.name === '仪门') },
  'temple-dadian-rise': { no: 8, cls: 'crane', target: () => layout.objects.find(o => o.kind === 'templeAnchor' && o.name === '大殿') },
  'bazaar-plaza-orbit': { no: 9, cls: 'aerial', target: () => habaoObj },
  'huxinting-across-pond': { no: 10, cls: 'ground', target: () => layout.objects.find(o => o.name === '湖心亭') },
  'fangbang-eastbound': { no: 11, cls: 'ground', target: () => layout.objects.find(o => o.kind === 'templeAnchor' && o.name === '山门') },
};
const BUILDING_KINDS = new Set(['outerBuilding', 'bazaarBlock', 'facadeBay', 'hall', 'tower', 'xuan', 'pavilion', 'stage', 'waterside']);
const bldFps = layout.objects.filter(o => BUILDING_KINDS.has(o.kind) && o.geometry.footprint && o.disposition !== 'replaced-by-design');
const waterFps = layout.objects.filter(o => o.kind === 'water' && o.geometry.footprint);
const HALL_KINDS = new Set(['hall', 'tower', 'xuan', 'pavilion', 'stage', 'waterside']);
const deg = (r) => r * 180 / Math.PI;
const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const angBetween = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, dot2(unit(a), unit(b))))));
const xz = (p) => [p[0], p[2]];
const viewDir = (s, k) => unit([s.target[k][0] - s.eye[k][0], s.target[k][2] - s.eye[k][2]]);
const pathLen = (pts) => pts.slice(1).reduce((a, p, i) => a + dist2d(xz(p), xz(pts[i])), 0);
const segCrossesPoly = (a, b, poly, step = 0.25) => {
  const L = dist2d(a, b), k = Math.max(1, Math.ceil(L / step));
  for (let j = 0; j <= k; j++) if (pointInPoly([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k], poly)) return true;
  return false;
};
// 山门 / 庙轴：layout 实例 temple-shanmen 锚 + 朝向（庙门朝 (sin rotY, cos rotY)，入庙 = 反向）
const shanmenInst = layout.instances.find(i => i.id === 'temple-shanmen');
const templeIn = [-Math.sin(shanmenInst.rotY), -Math.cos(shanmenInst.rotY)];
const alongAxis = (p) => dot2([p[0] - shanmenInst.position[0], p[1] - shanmenInst.position[1]], templeIn);
const offAxis = (p) => Math.abs((p[0] - shanmenInst.position[0]) * templeIn[1] - (p[1] - shanmenInst.position[1]) * templeIn[0]);
const collBox = (id) => { // 碰撞盒并集 AABB（锚点型对象的实物位置；与 control-shot-visibility shotTargetBox 同源）
  const own = boxesAll.filter(b => b.id === id);
  if (!own.length) return null;
  return { min: [Math.min(...own.map(b => b.aabb.x0)), Math.min(...own.map(b => b.aabb.y0)), Math.min(...own.map(b => b.aabb.z0))],
    max: [Math.max(...own.map(b => b.aabb.x1)), Math.max(...own.map(b => b.aabb.y1)), Math.max(...own.map(b => b.aabb.z1))] };
};
const w5Summary = {};
for (const [id, spec] of Object.entries(W5)) {
  const s = byId[id];
  check(!!s, `W5 缺镜头 ${id}（④–⑪ 第 ${spec.no} 号）`);
  if (!s) continue;
  const n = s.frames, tgt = spec.target();
  const sum = w5Summary[id] = { no: spec.no, targetId: s.targetId };
  check(!!tgt && s.targetId === tgt.id, `${id} 取景目标 targetId=${s.targetId} != ${tgt && tgt.id}（按名从 layout 重查）`);
  check(n === 24 && typeof s.lensMm === 'number' && s.lensMm > 0, `${id} 帧数 ${n} / lensMm ${s.lensMm}`);
  // P4 镜头类别与高度
  const ys = s.eye.map(p => p[1]);
  if (spec.cls === 'ground') check(ys.every(y => Math.abs(y - 1.6) < 1e-6), `${id} 地面镜头眼高不是 1.6 m（${Math.min(...ys)}–${Math.max(...ys)}）`);
  if (spec.cls === 'crane') {
    check(Math.abs(ys[0] - 1.6) < 1e-6, `${id} 升高镜头起点眼高 ${ys[0]} != 1.6`);
    check(ys.every((y, k) => k === 0 || y >= ys[k - 1] - 1e-9), `${id} 机位高度不是单调上升`);
    check(ys[n - 1] - ys[0] >= 3, `${id} 升高仅 ${(ys[n - 1] - ys[0]).toFixed(2)} m < 3`);
    const drift = Math.max(...s.eye.map(p => dist2d(xz(p), xz(s.eye[0]))));
    check(drift <= 0.1, `${id} 升高镜头平面漂移 ${drift.toFixed(2)} m > 0.1（应原地升高）`);
    s.target.forEach((t, k) => check(t[1] > s.eye[k][1] + 0.3, `${id} 第 ${k} 帧注视点不高于机位（不是仰视）`));
    Object.assign(sum, { riseM: +(ys[n - 1] - ys[0]).toFixed(2) });
  }
  if (spec.cls === 'aerial') {
    check(ys.every(y => Math.abs(y - ys[0]) < 1e-6) && ys[0] >= 12 && ys[0] <= 30, `${id} 低空航拍高度 ${ys[0]} 不在 12–30 m 或不恒定`);
  }
  // P1 / P2 / P3
  let minClr = Infinity, clrName = null;
  for (let k = 0; k < n; k++) {
    const c = nearestColliderDist(boxesAll, s.eye[k], { eyeY: -Infinity });
    if (c.dist < minClr) { minClr = c.dist; clrName = c.name; }
    check(c.dist >= W5_MIN_CLR, `${id} 第 ${k} 帧机位离碰撞盒 ${c.name} ${c.dist.toFixed(2)} m < ${W5_MIN_CLR}`);
    if (k > 0) {
      const hit = segBlocked(boxesAll, s.eye[k - 1], s.eye[k]);
      check(!hit, `${id} 第 ${k - 1}→${k} 帧机位连线穿过碰撞盒 ${hit}`);
    }
    const a = xz(s.eye[Math.max(0, k - 1)]), b = xz(s.eye[k]);
    for (const o of bldFps) {
      if (s.eye[k][1] > (o.height || 0) + 1.0 && spec.cls === 'aerial') continue;
      if (segCrossesPoly(a, b, o.geometry.footprint)) { check(false, `${id} 第 ${k} 帧机位路径进入建筑 footprint ${o.id}${o.name ? ' ' + o.name : ''}`); break; }
    }
    if (spec.cls === 'ground') for (const w of waterFps) {
      if (segCrossesPoly(a, b, w.geometry.footprint)) { check(false, `${id} 第 ${k} 帧地面机位进入水面 ${w.id}`); break; }
    }
  }
  Object.assign(sum, { minClearanceM: +minClr.toFixed(2), minClearanceName: clrName, eyePathM: +pathLen(s.eye).toFixed(1) });
}

// ---- 每镜头运镜语义 ----
// ④ 豫园入口 → 三穗堂：园门进院、眼高推进，终帧正对格扇立面（机位在立面轴上、视线逆立面朝向，各 ≤ 2°）。
//    立面锚 = compute-area-tour / assemble 同一规则（footprint 最小外接矩形中心 + 与仰山堂共用边的平移），朝向 = layout facade.dir。
{
  const s = byId['garden-entry-sansuitang'];
  const o = layout.objects.find(x => x.name === '三穗堂' && x.kind === 'hall');
  if (s && o) {
    const sst = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'sansuitang', 'collision.json'), 'utf8'));
    const { backZ, backHalfX } = rearWallFace(sst);
    const anc = anchorBehindSharedEdge(o.geometry.footprint, layout.objects.find(x => x.name === '仰山堂').geometry.footprint, o.facade.dir, backZ, backHalfX).anchor;
    const f = unit(o.facade.dir);
    const gate = layout.instances.find(i => i.id === 'garden-gate').position;
    const n = s.frames, e0 = xz(s.eye[0]), e1 = xz(s.eye[n - 1]);
    const d = s.eye.map(p => dist2d(xz(p), anc));
    check(dist2d(e0, gate) <= 6, `④起点离园门锚 ${dist2d(e0, gate).toFixed(1)} m > 6（应从豫园入口起步）`);
    check(pointInPoly(e0, layout.zones.garden.polygon) && pointInPoly(e1, layout.zones.garden.polygon), '④机位不在园区（garden 分区）内');
    check(d[0] - d[n - 1] >= 3, `④推进仅 ${(d[0] - d[n - 1]).toFixed(1)} m < 3`);
    check(d.every((v, k) => k === 0 || v <= d[k - 1] + 1e-6), '④离三穗堂距离不是单调减小（不是推进）');
    const bearing = angBetween([e1[0] - anc[0], e1[1] - anc[1]], f);
    const facing = angBetween(viewDir(s, n - 1), [-f[0], -f[1]]);
    check(bearing <= 2, `④终帧机位偏立面轴 ${bearing.toFixed(1)}° > 2（不在正前方）`);
    check(facing <= 2, `④终帧视线与立面法线夹角 ${facing.toFixed(1)}° > 2（没有正对格扇立面）`);
    Object.assign(w5Summary['garden-entry-sansuitang'], { pushM: +(d[0] - d[n - 1]).toFixed(1), endDistToAnchorM: +d[n - 1].toFixed(1), endBearingDeg: +bearing.toFixed(1), endFacingDeg: +facing.toFixed(1) });
  }
}
// ⑤ 大假山：隔池从仰山堂一侧望大假山，缓慢横移。机位离仰山堂 footprint ≤ 25 m、比离大假山近；
//    逐帧机位 → 大假山形心的视线穿过水面（隔池）；机位移动 ≥ 2 m 且与平均视向的夹角 60–120°（横移，不是推拉）。
//    （仰山堂东北角池岸被 gtree-26 / gtree-2 树冠正挡，镜头改在仰山堂西北的西岸；岸带宽约 7 m，横移取 2.6 m。）
{
  const s = byId['dajiashan-across-pond'];
  const rk = layout.objects.find(o => o.kind === 'rockery' && (o.name || '').startsWith('大假山'));
  const ys = layout.objects.find(o => o.name === '仰山堂');
  if (s && rk && ys) {
    const xs = rk.geometry.rocks.map(r => r.x), zs = rk.geometry.rocks.map(r => r.z);
    const rc = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    const yfp = ys.geometry.footprint;
    const n = s.frames;
    s.eye.forEach((p, k) => {
      const dY = pointInPoly(xz(p), yfp) ? 0 : distToPolyline(xz(p), [...yfp, yfp[0]]);
      check(dY <= 25 && dY < dist2d(xz(p), rc), `⑤第 ${k} 帧机位离仰山堂 ${dY.toFixed(1)} m（应在仰山堂一侧，≤ 25 m 且近于大假山）`);
      check(waterFps.some(w => segCrossesPoly(xz(p), rc, w.geometry.footprint, 0.5)), `⑤第 ${k} 帧视线不隔水（机位 → 大假山形心不经过水面）`);
    });
    const mv = [s.eye[n - 1][0] - s.eye[0][0], s.eye[n - 1][2] - s.eye[0][2]];
    const vd = unit(s.eye.reduce((a, p, k) => [a[0] + viewDir(s, k)[0], a[1] + viewDir(s, k)[1]], [0, 0]));
    const lat = Math.hypot(...mv) > 1e-6 ? angBetween(mv, vd) : 0;
    check(Math.hypot(...mv) >= 2, `⑤横移仅 ${Math.hypot(...mv).toFixed(1)} m < 2`);
    check(lat >= 60 && lat <= 120, `⑤机位移动方向与视向夹角 ${lat.toFixed(0)}°（横移应在 60–120°）`);
    Object.assign(w5Summary['dajiashan-across-pond'], { truckM: +Math.hypot(...mv).toFixed(1), moveVsViewDeg: +lat.toFixed(0) });
  }
}
// ⑥ 园内曲廊行走：取景目标 = 所走的廊（积玉水廊 / 听涛阁 bld-428179920，watersideGallery）；机位逐帧在该廊折线中线 0.3 m 内、
//    行进 ≥ 6 m，视线沿行进方向（≤ 35°）；两侧厅堂入画：画面左半、右半各至少 6 帧有 40 m 内的园林厅堂类建筑（非取景目标）footprint 角点。
//    为什么是水廊而不是园廊 / 复廊：净距 ≥ 1.0 m 是硬规则，园廊套件柱距 ±1.0 m（中线净距 0.88 m）、复廊单侧廊道 0.75 m，
//    都过不了；积玉水廊宽 2.6 m（柱 ±1.2 m，中线净距 1.08 m）。其南段在转角柱与楼内柱网之间的净段只有约 7 m（故 ≥ 6 m）。
{
  const s = byId['garden-corridor-walk'];
  if (s) {
    const n = s.frames;
    const cors = layout.objects.filter(o => (o.kind === 'corridor' || o.kind === 'watersideGallery') && o.geometry.polyline);
    const cor = cors.find(o => s.eye.every(p => distToPolyline(xz(p), o.geometry.polyline) <= 0.3));
    check(!!cor, '⑥机位不全在同一条园廊中线 0.3 m 内（不是沿廊行走）');
    check(!!cor && cor.id === s.targetId, `⑥取景目标 ${s.targetId} 不是所走的廊 ${cor && cor.id}`);
    check(pathLen(s.eye) >= 6, `⑥沿廊行进仅 ${pathLen(s.eye).toFixed(1)} m < 6`);
    for (let k = 0; k < n; k++) {
      const mv = k < n - 1 ? [s.eye[k + 1][0] - s.eye[k][0], s.eye[k + 1][2] - s.eye[k][2]] : [s.eye[k][0] - s.eye[k - 1][0], s.eye[k][2] - s.eye[k - 1][2]];
      const a = angBetween(mv, viewDir(s, k));
      check(a <= 35, `⑥第 ${k} 帧视线偏离行进方向 ${a.toFixed(0)}° > 35`);
    }
    const view = viewFromLens(s.lensMm);
    const halls = layout.objects.filter(o => HALL_KINDS.has(o.kind) && o.geometry.footprint && o.id !== s.targetId);
    let left = 0, right = 0; const seen = new Set();
    for (let k = 0; k < n; k++) {
      let l = false, r = false;
      for (const o of halls) {
        for (const q of o.geometry.footprint) {
          const pt = [q[0], (o.height || 4) / 2, q[1]];
          if (dist2d(q, xz(s.eye[k])) > 40) continue;
          const pr = projectPoint(pt, s.eye[k], s.target[k], view);
          if (!pr || pr[0] < 0 || pr[0] > view.width || pr[1] < 0 || pr[1] > view.height) continue;
          if (pr[0] < view.width / 2) l = true; else r = true;
          seen.add(o.name || o.id);
        }
      }
      left += l; right += r;
    }
    check(left >= 6 && right >= 6, `⑥两侧厅堂入画：左半 ${left} 帧、右半 ${right} 帧（各需 ≥ 6）`);
    Object.assign(w5Summary['garden-corridor-walk'], { corridor: cor && cor.id, hallFramesLeft: left, hallFramesRight: right, hallsSeen: [...seen] });
  }
}
// ⑦ 城隍庙 山门 → 仪门中轴推进：庙轴 = layout 山门实例锚 + 朝向（入庙向）；机位与注视点逐帧离轴 ≤ 0.5 m，
//    沿轴坐标单调前进 ≥ 3 m，起点在山门之后 8 m 内，终点在仪门（碰撞盒）之前。
{
  const s = byId['temple-axis-push'];
  if (s) {
    const n = s.frames, al = s.eye.map(p => alongAxis(xz(p)));
    s.eye.forEach((p, k) => check(offAxis(xz(p)) <= 0.5, `⑦第 ${k} 帧机位离庙轴 ${offAxis(xz(p)).toFixed(2)} m > 0.5`));
    s.target.forEach((p, k) => check(offAxis(xz(p)) <= 0.5, `⑦第 ${k} 帧注视点离庙轴 ${offAxis(xz(p)).toFixed(2)} m > 0.5（不是中轴）`));
    check(al.every((v, k) => k === 0 || v >= al[k - 1] - 1e-6) && al[n - 1] - al[0] >= 3, `⑦沿轴推进 ${(al[n - 1] - al[0]).toFixed(1)} m（需单调且 ≥ 3）`);
    check(al[0] >= 0 && al[0] <= 8, `⑦起点沿轴 ${al[0].toFixed(1)} m 不在山门后 0–8 m`);
    const yb = collBox('temple-yimen');
    const yAlong = yb ? Math.min(...[[yb.min[0], yb.min[2]], [yb.max[0], yb.min[2]], [yb.min[0], yb.max[2]], [yb.max[0], yb.max[2]]].map(alongAxis)) : Infinity;
    check(al[n - 1] < yAlong, `⑦终点沿轴 ${al[n - 1].toFixed(1)} m 越过仪门（${yAlong.toFixed(1)} m）`);
    Object.assign(w5Summary['temple-axis-push'], { pushM: +(al[n - 1] - al[0]).toFixed(1), startAlongM: +al[0].toFixed(1), endAlongM: +al[n - 1].toFixed(1), yimenAlongM: +yAlong.toFixed(1) });
  }
}
// ⑧ 城隍庙大殿：殿前院落仰视、缓慢升高（高度规则见 P4 crane）；机位在大殿正前方院落：沿庙轴位于仪门戏台之后、大殿之前，离轴 ≤ 3 m。
{
  const s = byId['temple-dadian-rise'];
  if (s) {
    const p = xz(s.eye[0]), al = alongAxis(p);
    const st = collBox('temple-yimenstage'), dd = collBox('temple-dadian');
    const corners = (b) => [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.min[0], b.max[2]], [b.max[0], b.max[2]]].map(alongAxis);
    const stBack = st ? Math.max(...corners(st)) : -Infinity, ddFront = dd ? Math.min(...corners(dd)) : Infinity;
    check(al > stBack && al < ddFront, `⑧机位沿轴 ${al.toFixed(1)} m 不在戏台（${stBack.toFixed(1)}）与大殿（${ddFront.toFixed(1)}）之间的殿前院落`);
    check(offAxis(p) <= 3, `⑧机位离庙轴 ${offAxis(p).toFixed(1)} m > 3`);
    Object.assign(w5Summary['temple-dadian-rise'], { alongM: +al.toFixed(1), stageBackM: +stBack.toFixed(1), dadianFrontM: +ddFront.toFixed(1) });
  }
}
// ⑨ 商城中心广场低空环绕：机位平面位置逐帧在中心广场 footprint 内，绕定圆心（首/中/末帧三点定圆）半径变化 ≤ 1 m、
//    扫角 ≥ 20°、弧长 ≥ 10 m；华宝楼与相邻大楼（天裕楼，与华宝楼共边的 bazaarBlock）逐帧同框：两楼 footprint 棱柱
//    （高 = 各自 layout 高；华宝楼按变体目标高）在画面内的裁框投影各 ≥ 5%。
{
  const s = byId['bazaar-plaza-orbit'];
  const plaza = layout.objects.find(o => o.kind === 'plaza' && o.name === '中心广场');
  const nb = layout.objects.find(o => o.kind === 'bazaarBlock' && o.name === '天裕楼');
  if (s && plaza && nb) {
    const n = s.frames;
    s.eye.forEach((p, k) => check(pointInPoly(xz(p), plaza.geometry.footprint), `⑨第 ${k} 帧机位不在中心广场上空`));
    const [A, B, C] = [xz(s.eye[0]), xz(s.eye[n >> 1]), xz(s.eye[n - 1])];
    const D = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    const sq = (p) => p[0] * p[0] + p[1] * p[1];
    const cen = Math.abs(D) < 1e-9 ? null : [(sq(A) * (B[1] - C[1]) + sq(B) * (C[1] - A[1]) + sq(C) * (A[1] - B[1])) / D, (sq(A) * (C[0] - B[0]) + sq(B) * (A[0] - C[0]) + sq(C) * (B[0] - A[0])) / D];
    check(!!cen, '⑨机位三点共线（不是环绕）');
    if (cen) {
      const rs = s.eye.map(p => dist2d(xz(p), cen));
      const az = s.eye.map(p => Math.atan2(p[0] - cen[0], p[2] - cen[1]));
      let sweep = 0;
      for (let k = 1; k < n; k++) { let d = az[k] - az[k - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sweep += d; }
      check(Math.max(...rs) - Math.min(...rs) <= 1, `⑨环绕半径变化 ${(Math.max(...rs) - Math.min(...rs)).toFixed(2)} m > 1`);
      check(Math.abs(deg(sweep)) >= 20, `⑨环绕扫角 ${Math.abs(deg(sweep)).toFixed(1)}° < 20`);
      check(pathLen(s.eye) >= 10, `⑨环绕弧长 ${pathLen(s.eye).toFixed(1)} m < 10`);
      Object.assign(w5Summary['bazaar-plaza-orbit'], { radiusM: +rs[0].toFixed(1), sweepDeg: +Math.abs(deg(sweep)).toFixed(1), heightM: s.eye[0][1] });
    }
    const view = viewFromLens(s.lensMm);
    const hbBox = targetBox(habaoObj); hbBox.max[1] = habaoH;
    const nbBox = targetBox(nb);
    let minHb = 1, minNb = 1;
    for (let k = 0; k < n; k++) {
      const a1 = screenAreaFrac(hbBox, s.eye[k], s.target[k], view), a2 = screenAreaFrac(nbBox, s.eye[k], s.target[k], view);
      minHb = Math.min(minHb, a1); minNb = Math.min(minNb, a2);
      check(a1 >= 0.05 && a2 >= 0.05, `⑨第 ${k} 帧华宝楼 ${(a1 * 100).toFixed(1)}% / 天裕楼 ${(a2 * 100).toFixed(1)}% 未同框（各需 ≥ 5%）`);
    }
    Object.assign(w5Summary['bazaar-plaza-orbit'], { minHuabaoPct: +(minHb * 100).toFixed(1), minNeighbourPct: +(minNb * 100).toFixed(1), targetHeightM: habaoH });
    check(Math.abs((s.targetHeightM ?? 0) - habaoH) < 1e-6, `⑨目标高 targetHeightM=${s.targetHeightM} != ${habaoH}（BAZAAR_TOWERS=${BAZAAR_TOWERS ? 1 : 0}）`);
  }
}
// ⑩ 湖心亭：池对岸定机位微推。机位在岸上（非水面，地面规则已查）、到湖心亭形心的视线逐帧跨水；机位沿直线移动 1–6 m、
//    一路走近；注视点全程不动；九曲桥逐帧同框：桥中线按 1 m 采样（桥面上 0.9 m）至少 30% 的点在画面内。
{
  const s = byId['huxinting-across-pond'];
  const hx = layout.objects.find(o => o.name === '湖心亭');
  const br = layout.objects.find(o => o.kind === 'zigzagBridge');
  if (s && hx && br) {
    const n = s.frames, c = centroid(hx.geometry.footprint);
    const pond = waterFps.filter(w => pointInPoly(c, w.geometry.footprint));
    s.eye.forEach((p, k) => check(pond.some(w => segCrossesPoly(xz(p), c, w.geometry.footprint, 0.5)), `⑩第 ${k} 帧机位 → 湖心亭视线不跨水（不在池对岸）`));
    const L = dist2d(xz(s.eye[0]), xz(s.eye[n - 1]));
    let dev = 0;
    for (const p of s.eye) dev = Math.max(dev, distToPolyline(xz(p), [xz(s.eye[0]), xz(s.eye[n - 1])]));
    check(L >= 1 && L <= 6 && dev <= 0.05, `⑩微推 ${L.toFixed(2)} m（需 1–6 m 直线，偏离 ${dev.toFixed(2)}）`);
    const d = s.eye.map(p => dist2d(xz(p), c));
    check(d[n - 1] < d[0], '⑩没有走近湖心亭');
    check(s.target.every(t => Math.hypot(t[0] - s.target[0][0], t[1] - s.target[0][1], t[2] - s.target[0][2]) < 0.01), '⑩注视点在动（应定机位微推，朝向不变）');
    const pl = br.geometry.polyline, deck = br.deckY ?? 0.55, view = viewFromLens(s.lensMm);
    const samples = [];
    for (let i = 0; i + 1 < pl.length; i++) {
      const m = Math.max(1, Math.round(dist2d(pl[i], pl[i + 1])));
      for (let j = 0; j < m; j++) samples.push([pl[i][0] + (pl[i + 1][0] - pl[i][0]) * j / m, deck + 0.9, pl[i][1] + (pl[i + 1][1] - pl[i][1]) * j / m]);
    }
    let minFrac = 1;
    for (let k = 0; k < n; k++) {
      const fr = samples.filter(q => inFrame(q, s.eye[k], s.target[k], view)).length / samples.length;
      minFrac = Math.min(minFrac, fr);
      check(fr >= 0.3, `⑩第 ${k} 帧九曲桥入画 ${(fr * 100).toFixed(0)}% < 30%（湖心亭与九曲桥未同框）`);
    }
    Object.assign(w5Summary['huxinting-across-pond'], { pushM: +L.toFixed(2), startDistM: +d[0].toFixed(1), endDistM: +d[n - 1].toFixed(1), bridgeInFrameMinPct: Math.round(minFrac * 100) });
  }
}
// ⑪ 方浜中路：街中眼高东行、向城隍庙。机位逐帧在 layout「方浜中路」道路中线 3 m 内、x 严格增大（东行）≥ 40 m，
//    终点离山门比起点近 ≥ 40 m；两侧店面入画：半数以上帧画面左半、右半都有 45 m 内的街面建筑（layout 建筑 footprint 角点
//    或 ≥ 2.5 m 高的碰撞盒——店屋 / 方浜西延店面 / 摊位棚，按 3 m 高投影）。
{
  const s = byId['fangbang-eastbound'];
  if (s) {
    const n = s.frames;
    const roads = layout.objects.filter(o => o.kind === 'road' && o.name === '方浜中路');
    s.eye.forEach((p, k) => {
      const d = Math.min(...roads.map(r => distToPolyline(xz(p), r.geometry.polyline)));
      check(d <= 3, `⑪第 ${k} 帧机位离方浜中路中线 ${d.toFixed(1)} m > 3（不在街中）`);
      if (k > 0) check(p[0] > s.eye[k - 1][0], `⑪第 ${k} 帧没有东行（x 未增大）`);
    });
    const e0 = xz(s.eye[0]), e1 = xz(s.eye[n - 1]);
    check(e1[0] - e0[0] >= 40, `⑪东行仅 ${(e1[0] - e0[0]).toFixed(1)} m < 40`);
    check(dist2d(e0, shanmenInst.position) - dist2d(e1, shanmenInst.position) >= 40, '⑪没有走向城隍庙山门（终点比起点近不足 40 m）');
    const pts = [...bldFps.flatMap(o => o.geometry.footprint), ...boxesAll.filter(b => b.topY >= 2.5 && b.id !== s.targetId).map(b => [b.center[0], b.center[2]])];
    const view = viewFromLens(s.lensMm);
    let both = 0;
    for (let k = 0; k < n; k++) {
      let L = false, R = false;
      for (const q of pts) {
        if (dist2d(q, xz(s.eye[k])) > 45) continue;
        const pr = projectPoint([q[0], 3, q[1]], s.eye[k], s.target[k], view);
        if (!pr || pr[0] < 0 || pr[0] > view.width || pr[1] < 0 || pr[1] > view.height) continue;
        if (pr[0] < view.width / 2) L = true; else R = true;
        if (L && R) break;
      }
      both += L && R;
    }
    check(both >= n / 2, `⑪画面两侧都有街面建筑的帧 ${both}/${n}（需过半）`);
    Object.assign(w5Summary['fangbang-eastbound'], { walkEastM: +(e1[0] - e0[0]).toFixed(1), framesShopsBothSides: both, endDistToShanmenM: +dist2d(e1, shanmenInst.position).toFixed(1) });
  }
}
console.log('control-shots-test W5:', JSON.stringify(w5Summary));

// ⑦ 场景范围
const g = layout.objects.find(o => o.id === 'ground').geometry.bounds;
for (const s of doc.shots) {
  for (const arr of [s.eye, s.target]) for (const p of arr) {
    check(p[0] >= g[0] && p[0] <= g[2] && p[2] >= g[1] && p[2] <= g[3], `${s.id} 坐标越界 (${p[0]}, ${p[2]})`);
  }
}

console.log(`control-shots-test: ${fails ? fails + ' fail' : 'all pass'}`);
process.exit(fails ? 1 : 0);
