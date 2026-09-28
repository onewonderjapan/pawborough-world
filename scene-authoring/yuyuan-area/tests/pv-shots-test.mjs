// wave11-pvboard：PV 分镜契约测试（scripts/pv-shots.json → scripts/build-pv-shots.py → $OUT_DIR/pv-cameras.json）。
// 期望值只从 GOAL 文字、baseline/layout.json 与管线碰撞（collision-*.json）重算；不拿渲染产物、不拿 pv-cameras.json 自比。
// 渲染侧取景真值（目标像素 / 天空 / 近景墙 / 空地面）在 scripts/check-pv-frames.py（依赖预览渲染）。
//
// S 结构（GOAL P1）：12–16 镜头；每镜 3–6 s、24 fps（帧数 = 时长 × 24）；总长 60–90 s；新镜头 ≥ 6；复用镜头的源在 control-shots.json
//   里、且按 PV 重设时长（帧数 ≠ 原 24 帧）、段端点与源镜头同参数位置的机位一致；灯光标签 ∈ day|dusk|night；每镜有中英意图、
//   转场、镜头类别（ground / raised / crane / aerial）与生成方式（fixed-push / travel / aerial）。
// T 文案（GOAL P3 规则 + R1 审查可选1）：正向提示词中文含「1990 年代」、英文含「1990s」；不写「重建 / rebuilt」等史实表述
//   （只写 1990 年代改建后外观，正向含「维护良好、不刻意做旧」）；正向提示词不写可读文字 / 招牌内容
//   （写着 / 字样 / 题字 / lettering / inscription / text …），不写年代与史实（四位年份，1990 除外；朝代 / 始建 / founded …）；
//   全局负面词覆盖文字类（文字 / 招牌 / 水印 / text / letters / watermark）与做旧类（老旧 / 风化 / aged / weathered / ruined）。
// P 路径（control-shots-spec 同口径）：逐帧离任何碰撞盒 ≥ 1.0 m（全部高度，含方浜中路分区；水面隐形挡墙不算）；相邻帧连线不穿碰撞盒；
//   ground 镜头眼高 1.6 m、不进建筑 footprint、不进水面；raised 镜头 ≥ 桥面 + 1.6 m；crane 起点眼高 1.6 m；
//   aerial 镜头标明航拍高度（≥ 12 m），机位在建筑 footprint 上空时高出该建筑保守屋顶高 ≥ 3 m（layout 高 × 1.6 与 +6 m 取大，
//   塔楼套件楼按 26 m）；速度：walk ≤ 2 m/s、其余 ground ≤ 5 m/s、raised ≤ 3 m/s、crane ≤ 2 m/s、aerial ≤ 15 m/s；
//   视向角速度 ≤ 30°/s（逐帧，防甩镜）。
// V 可见性（control-shot-visibility.mjs evaluateShot，与控制层同一套碰撞集 / 目标盒 / 裁画框投影）：终点帧目标 9 点 ≥ 5 点可见、
//   投影 ≥ minTargetFrac（缺省 8%；航拍全景镜头在 pv-shots.json 里显式写更低门槛，测试要求它 ≥ 0.5% 且只允许 aerial 镜头放宽）；
//   每 1 s 窗口（24 帧）至少一半帧满足三条（可见 / 投影 / 净距 1.0 m）；reveal 镜头只查最后 1 s 窗口。
//
// 草稿复验：PV_SHOTS=<草稿 pv-shots.json> 让生成器改读草稿（新断言先在未修正的草稿上跑出失败，见 artifacts/pv/TEST-FIRST-FAIL.log）。
// 用法：OUT_DIR=out-zone node tests/pv-shots-test.mjs      （JSON_OUT=<路径> 另写逐镜头汇总）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pointInPoly, dist2d } from '../src/lib.mjs';
import { loadColliders, segBlocked, nearestColliderDist, ZONE_FILES } from '../scripts/tour-visibility.mjs';
import { evaluateShot } from '../scripts/control-shot-visibility.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { console.error('FAIL:', msg); fails++; } };

// 由源重生成（确定性；草稿复验时读 PV_SHOTS）
execFileSync('python3', ['scripts/build-pv-shots.py', '--out-zone', OUT, ...(process.env.PV_SHOTS ? ['--pv', process.env.PV_SHOTS] : [])], { cwd: ROOT, stdio: 'pipe' });
const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'pv-cameras.json'), 'utf8'));
const ctl = JSON.parse(fs.readFileSync(path.join(OUT, 'control-shots.json'), 'utf8'));
const pvSrc = JSON.parse(fs.readFileSync(process.env.PV_SHOTS || path.join(ROOT, 'scripts', 'pv-shots.json'), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));

// ---------- S 结构 ----------
const GOAL = { minShots: 12, maxShots: 16, minS: 3, maxS: 6, minTotal: 60, maxTotal: 90, fps: 24, minNew: 6 };
const LIGHTS = new Set(['day', 'dusk', 'night']);
const CLASSES = new Set(['ground', 'raised', 'crane', 'aerial']);
const GENMODES = new Set(['fixed-push', 'travel', 'aerial']);
const shots = doc.shots;
check(doc.fps === GOAL.fps, `fps ${doc.fps} != 24`);
check(shots.length >= GOAL.minShots && shots.length <= GOAL.maxShots, `镜头数 ${shots.length} 不在 12–16`);
const total = shots.reduce((a, s) => a + s.durationS, 0);
check(total >= GOAL.minTotal && total <= GOAL.maxTotal, `总时长 ${total} s 不在 60–90`);
check(new Set(shots.map(s => s.id)).size === shots.length, '镜头 id 重复');
shots.forEach((s, i) => check(s.no === i + 1, `${s.id} 镜号 ${s.no} != 顺序 ${i + 1}`));
const nNew = shots.filter(s => s.status === 'new').length;
check(nNew >= GOAL.minNew, `新镜头 ${nNew} < 6`);
const ctlBy = Object.fromEntries(ctl.shots.map(s => [s.id, s]));
for (const s of shots) {
  check(s.durationS >= GOAL.minS && s.durationS <= GOAL.maxS, `${s.id} 时长 ${s.durationS} s 不在 3–6`);
  check(s.frames === Math.round(s.durationS * GOAL.fps) && s.eye.length === s.frames && s.target.length === s.frames, `${s.id} 帧数 ${s.frames} != 时长×24 或 eye/target 长度不符`);
  check(LIGHTS.has(s.light), `${s.id} 灯光标签 ${s.light} 不在 day|dusk|night`);
  check(CLASSES.has(s.camClass), `${s.id} 镜头类别 ${s.camClass}`);
  check(GENMODES.has(s.genMode), `${s.id} 生成方式 ${s.genMode}`);
  check(!!(s.intent && s.intent.zh && s.intent.en), `${s.id} 缺中英意图`);
  check(!!(s.transitionIn && s.transitionOut), `${s.id} 缺转场`);
  check(typeof s.targetId === 'string' && (layout.objects.some(o => o.id === s.targetId) || (layout.instances || []).some(o => o.id === s.targetId)), `${s.id} 目标 ${s.targetId} 不在 layout`);
  check(s.status === 'new' || s.status === 'reused', `${s.id} status ${s.status}`);
  if (s.status === 'reused') {
    const src = s.reuse && ctlBy[s.reuse.shot];
    check(!!src, `${s.id} 复用源 ${s.reuse && s.reuse.shot} 不在 control-shots.json`);
    if (src) {
      check(s.frames !== src.frames, `${s.id} 帧数仍是源镜头的 ${src.frames}（时长没有按 PV 重设）`);
      check(s.targetId === src.targetId, `${s.id} 目标 ${s.targetId} != 源 ${src.targetId}`);
      const [u0, u1] = s.reuse.segment;
      check(u0 >= 0 && u1 <= 1 && u1 > u0, `${s.id} 复用段 ${u0}–${u1} 非法`);
      // 段端点落在源关键帧上时，机位必须与源镜头该帧一致（重定时不改路径）
      for (const [u, k] of [[u0, 0], [u1, s.frames - 1]]) {
        const x = u * (src.frames - 1);
        if (Math.abs(x - Math.round(x)) < 1e-9) {
          const e = src.eye[Math.round(x)], d = Math.hypot(e[0] - s.eye[k][0], e[1] - s.eye[k][1], e[2] - s.eye[k][2]);
          check(d < 1e-3, `${s.id} 第 ${k} 帧机位偏离源镜头 ${src.id} 第 ${Math.round(x)} 帧 ${d.toFixed(3)} m`);
        }
      }
    }
  } else {
    check(!s.reuse, `${s.id} 标 new 却写了 reuse`);
  }
}

// ---------- T 文案 ----------
const FORBID_TEXT = [/写着/, /字样/, /题字/, /题写/, /匾额上/, /招牌上/, /书写/, /标语/, /lettering/i, /inscri/i, /calligraph/i, /\btext\b/i, /\bwords?\b/i, /reading ["'“]/i, /\bslogan/i];
const FORBID_HISTORY = [/(?<!\d)(1[0-8]\d\d|19[0-8]\d|2\d\d\d)(?!\d)/, /[唐宋元明清]朝/, /明代|清代|宋代|元代|始建|建于|创建|历史上/, /dynasty|\bMing\b|\bQing\b|founded|built in|dating|centur/i];
for (const s of pvSrc.shots) {
  const p = s.prompt || {};
  check(!!(p.zh && p.en), `${s.id} 缺中英提示词`);
  if (!(p.zh && p.en)) continue;
  check(/1990 ?年代/.test(p.zh), `${s.id} 中文提示词没有标「1990 年代」形制`);
  check(/1990s/.test(p.en), `${s.id} 英文提示词没有标「1990s」形制`);
  check(!/重建|rebuilt/i.test(p.zh) && !/重建|rebuilt/i.test(p.en), `${s.id} 正向提示词含「重建 / rebuilt」史实表述（应写 1990 年代改建后外观）`);
  for (const re of FORBID_TEXT) check(!re.test(p.zh) && !re.test(p.en), `${s.id} 正向提示词含文字 / 招牌内容描述 ${re}`);
  for (const re of FORBID_HISTORY) check(!re.test(p.zh.replace(/1990 ?年代/g, '')) && !re.test(p.en.replace(/1990s/g, '')), `${s.id} 正向提示词含年代 / 史实 ${re}`);
}
const neg = pvSrc.negative || {};
check(/文字/.test(neg.zh || '') && /招牌/.test(neg.zh || '') && /水印/.test(neg.zh || ''), '中文负面词未覆盖 文字 / 招牌 / 水印');
check(/text/.test(neg.en || '') && /letters/.test(neg.en || '') && /watermark/.test(neg.en || ''), '英文负面词未覆盖 text / letters / watermark');
check(/老旧/.test(neg.zh || '') && /风化/.test(neg.zh || ''), '中文负面词未覆盖做旧类（老旧 / 风化）');
check(/aged/.test(neg.en || '') && /weathered/.test(neg.en || '') && /ruined/.test(neg.en || ''), '英文负面词未覆盖 aged / weathered / ruined');
check(/维护良好/.test((pvSrc.styleNote || {}).zh || ''), '形制词规则未补「维护良好、不刻意做旧」');

// ---------- 转场一致性（R1 审查必修2）：出场与下一镜入场的类型和帧数必须相同 ----------
const tparts = (t) => {
  const m = /^(fade-from-black|fade-to-black|dissolve|cut)(?:\s+(\d+)\s*f)?$/.exec(String(t).trim());
  return m ? [m[1], m[2] ? +m[2] : null] : [String(t).trim(), null];
};
for (let i = 0; i + 1 < pvSrc.shots.length; i++) {
  const [to, fo] = tparts(pvSrc.shots[i].transitionOut);
  const [ti, fi] = tparts(pvSrc.shots[i + 1].transitionIn);
  check(to === ti && fo === fi, `${pvSrc.shots[i].id} 出场「${pvSrc.shots[i].transitionOut}」与 ${pvSrc.shots[i + 1].id} 入场「${pvSrc.shots[i + 1].transitionIn}」不一致（类型与帧数须相同）`);
}

// ---------- P 路径 ----------
const boxes = loadColliders(ROOT, path.relative(ROOT, OUT), [...ZONE_FILES, 'fangbang']);
const BUILDING_KINDS = new Set(['outerBuilding', 'bazaarBlock', 'facadeBay', 'hall', 'tower', 'xuan', 'pavilion', 'stage', 'waterside']);
const bld = layout.objects.filter(o => BUILDING_KINDS.has(o.kind) && o.geometry.footprint && o.disposition !== 'replaced-by-design');
const water = layout.objects.filter(o => o.kind === 'water' && o.geometry.footprint);
const roofTop = (o) => o.kind === 'bazaarBlock' ? 26 : Math.max((o.height || 4) * 1.6, (o.height || 4) + 6);
const bridge = layout.objects.find(o => o.kind === 'zigzagBridge');
const SPEED = { walk: 2.0, ground: 5.0, raised: 3.0, crane: 2.0, aerial: 15.0 };
const YAW_RATE_MAX = 30; // °/s
const xz = (p) => [p[0], p[2]];
const summary = {};
for (const s of shots) {
  const n = s.frames, cls = s.camClass;
  const sm = summary[s.id] = { no: s.no, status: s.status, cls, light: s.light, durationS: s.durationS, targetId: s.targetId };
  const ys = s.eye.map(p => p[1]);
  if (cls === 'ground') check(ys.every(y => Math.abs(y - 1.6) < 1e-6), `${s.id} 地面镜头眼高不是 1.6 m（${Math.min(...ys)}–${Math.max(...ys)}）`);
  if (cls === 'raised') check(ys.every(y => y >= (bridge.deckY ?? 0.55) + 1.6 - 1e-6), `${s.id} 升高机位低于桥面眼高`);
  if (cls === 'crane') check(Math.abs(ys[0] - 1.6) < 1e-6, `${s.id} 升降镜头起点眼高 ${ys[0]} != 1.6`);
  if (cls === 'aerial') check(Math.min(...ys) >= 12, `${s.id} 航拍高度 ${Math.min(...ys).toFixed(1)} m < 12（未标明航拍高度）`);
  let minClr = Infinity, clrName = null, vmax = 0, yawMax = 0;
  for (let k = 0; k < n; k++) {
    const c = nearestColliderDist(boxes, s.eye[k], { eyeY: -Infinity });
    if (c.dist < minClr) { minClr = c.dist; clrName = c.name; }
    check(c.dist >= 1.0, `${s.id} 第 ${k} 帧机位离碰撞盒 ${c.name} ${c.dist.toFixed(2)} m < 1.0`);
    if (k > 0) {
      const hit = segBlocked(boxes, s.eye[k - 1], s.eye[k]);
      check(!hit, `${s.id} 第 ${k - 1}→${k} 帧机位连线穿过碰撞盒 ${hit}`);
      const v = Math.hypot(s.eye[k][0] - s.eye[k - 1][0], s.eye[k][1] - s.eye[k - 1][1], s.eye[k][2] - s.eye[k - 1][2]) * GOAL.fps;
      vmax = Math.max(vmax, v);
      const a0 = Math.atan2(s.target[k - 1][0] - s.eye[k - 1][0], s.target[k - 1][2] - s.eye[k - 1][2]);
      const a1 = Math.atan2(s.target[k][0] - s.eye[k][0], s.target[k][2] - s.eye[k][2]);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      yawMax = Math.max(yawMax, Math.abs(d) * 180 / Math.PI * GOAL.fps);
    }
    const p = xz(s.eye[k]);
    for (const o of bld) {
      if (!pointInPoly(p, o.geometry.footprint)) continue;
      if (cls === 'aerial') check(s.eye[k][1] >= roofTop(o) + 3, `${s.id} 第 ${k} 帧航拍机位在 ${o.id}${o.name ? ' ' + o.name : ''} 上空仅 ${s.eye[k][1].toFixed(1)} m（保守屋顶 ${roofTop(o).toFixed(1)} + 3）`);
      else check(false, `${s.id} 第 ${k} 帧机位进入建筑 footprint ${o.id}${o.name ? ' ' + o.name : ''}`);
    }
    if (cls === 'ground') for (const w of water) if (pointInPoly(p, w.geometry.footprint)) check(false, `${s.id} 第 ${k} 帧地面机位在水面 ${w.id}`);
  }
  const lim = s.move === 'walk' ? SPEED.walk : SPEED[cls];
  check(vmax <= lim, `${s.id} 最大速度 ${vmax.toFixed(2)} m/s > ${lim}（${s.move === 'walk' ? 'walk' : cls}）`);
  check(yawMax <= YAW_RATE_MAX, `${s.id} 视向角速度 ${yawMax.toFixed(1)}°/s > ${YAW_RATE_MAX}`);
  Object.assign(sm, { minClearanceM: +minClr.toFixed(2), minClearanceName: clrName, maxSpeedMps: +vmax.toFixed(2), maxYawDegPerS: +yawMax.toFixed(1), eyeYM: [+Math.min(...ys).toFixed(1), +Math.max(...ys).toFixed(1)] });

  // ---------- V 可见性 ----------
  const minFrac = s.minTargetFrac ?? 0.08;
  if (s.minTargetFrac != null) check(cls === 'aerial' && s.minTargetFrac >= 0.005, `${s.id} 放宽目标投影门槛 ${s.minTargetFrac} 只允许航拍镜头且 ≥ 0.5%`);
  const ev = evaluateShot({ ...s, railCheck: false }, layout, boxes);
  const ok = ev.frames.map(f => f.vis >= 5 && f.area >= minFrac && f.clearance >= 1.0);
  const e = ev.frames[n - 1];
  check(e.vis >= 5, `${s.id} 终点帧目标 9 点仅 ${e.vis} 点可见`);
  check(e.area >= minFrac, `${s.id} 终点帧目标投影 ${(e.area * 100).toFixed(2)}% < ${(minFrac * 100).toFixed(1)}%`);
  const W = GOAL.fps;
  for (let i = s.reveal ? n - W : 0; i + W <= n; i += W / 2) {
    const c = ok.slice(i, i + W).filter(Boolean).length;
    check(c >= W / 2, `${s.id} 帧 ${i}–${i + W - 1} 仅 ${c}/${W} 帧满足可见性三条（需 ≥ ${W / 2}）`);
  }
  Object.assign(sm, { okFrames: ok.filter(Boolean).length, frames: n, endVis: e.vis, endAreaPct: +(e.area * 100).toFixed(2), minAreaPct: +(Math.min(...ev.frames.map(f => f.area)) * 100).toFixed(2), minTargetPct: +(minFrac * 100).toFixed(2) });
}
const g = layout.objects.find(o => o.id === 'ground').geometry.bounds;
for (const s of shots) for (const arr of [s.eye, s.target]) for (const p of arr) {
  if (!(p[0] >= g[0] && p[0] <= g[2] && p[2] >= g[1] && p[2] <= g[3])) { check(false, `${s.id} 坐标越界 (${p[0]}, ${p[2]})`); break; }
}
console.log('pv-shots-test summary:', JSON.stringify({ shots: shots.length, newShots: nNew, totalS: total }));
if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify({ totalS: total, shots: shots.length, newShots: nNew, checks, fails, perShot: summary }, null, 1) + '\n');
console.log(`pv-shots-test: ${checks - fails} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
