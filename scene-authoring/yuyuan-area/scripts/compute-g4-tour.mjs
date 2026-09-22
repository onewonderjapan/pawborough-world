// G4 取景导览机位：总览 / 园内 / 池桥 / 庙院 / 商业主街 / 摊位组团。
// 明确定位为"固定取景机位"（不冒充行走）；复用历史已校验机位时逐点复检净距/视线。
// 产出 OUT_DIR/tour.json，预览端按此生成"取景导览"按钮组。
// 用法：node scripts/compute-g4-tour.mjs [OUT_DIR=out-goal-04]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid } from '../src/lib.mjs';
import { makeShotTools } from './shot-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'inputs', 'map-data.json'), 'utf8'));
const tools = makeShotTools(layout, map);
const footCent = (id) => {
  const o = layout.objects.find(x => x.id === id);
  return centroid(o.geometry.footprint ?? o.geometry.polyline ?? [o.geometry.position]);
};
const polyMid = (id) => {
  const o = layout.objects.find(x => x.id === id);
  const pl = o.geometry.polyline;
  let t = 0; const half = pl.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pl[i - 1][0], p[1] - pl[i - 1][1]) : 0), 0) / 2;
  for (let i = 1; i < pl.length; i++) {
    t += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
    if (t >= half) return pl[i];
  }
  return pl[pl.length - 1];
};
const objPos = (id) => {
  const o = layout.objects.find(x => x.id === id);
  return o.geometry.position || polyMid(id);
};
const recheck = (v, note) => {
  if (!v) return null;
  if (tools.pointBlocked([v.p[0], v.p[2]])) { console.error('cam 点净距复检失败:', note, v.p); return null; }
  if (tools.rayBlocked([v.p[0], v.p[2]], [v.t[0], v.t[2]])) { console.error('视线复检失败:', note); return null; }
  return v;
};
// 复用机位（来源轮已目检）：只复检机位点净距（走廊规则）；视线以来源轮目检为准
const recheckReuse = (v, note) => {
  if (!v) return null;
  if (tools.pointBlocked([v.p[0], v.p[2]])) { console.error('cam 点净距复检失败:', note, v.p); return null; }
  return v;
};

const tour = {};

// 1 总览：核心四区（园/庙/商城/池带）联合 bbox，同 viewer frame(oblique) 公式的高机位。
// 高空机位只查水平落点不在建筑投影内（视线检查在高空无意义），沿对角方向滑动找干净点。
{
  const zones = ['garden', 'temple', 'bazaar', 'pond'];
  const pts = zones.flatMap(z => layout.zones[z].polygon);
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.62 + 20;
  const h = +(r * 1.05 + 20).toFixed(1);
  let v = null;
  for (let d = 0; d <= 60 && !v; d += 5) {
    const px = cx + r * 0.55 + d * 0.55, pz = cz + r * 0.95 + d * 0.95;
    if (!tools.pointBlocked([px, pz])) v = { p: [+px.toFixed(1), h, +pz.toFixed(1)], t: [+cx.toFixed(1), 3, +cz.toFixed(1)] };
  }
  if (!v) { console.error('总览机位找不到建筑投影外的落点'); process.exit(1); }
  tour.overview = { label: '总览', zone: 'core', p: v.p, t: v.t, source: 'computed: 核心四区 bbox 斜俯瞰（同 viewer frame 公式，高空落点净距检查）' };
}

// 2 园内：园内建筑+园墙密集，开阔长视线不存在（如实）；复用 G2 已目检的玉华堂月洞门近景作为园内停点
{
  const v = recheckReuse({ p: [-98.5, 4.5, -131.5], t: [-98.6, 2, -150] }, 'garden');
  tour.garden = v
    ? { label: '园内', zone: 'garden', p: v.p, t: v.t, source: 'reuse: G2 renders-goal-02/24-node-yuhuatang-moongate（月洞门+格扇厅，G2 已目检；园内建筑密集无开阔远景，取节点近景如实标注）' }
    : null;
}

// 3 池桥：九曲桥广场北段开敞处（净距 12.9m）低机位望桥中段，湖心亭在桥后成景
{
  const v = tools.vistaCam([-166, -125], 2.5, [[-170, -99], [-168, -92], [-164, -95], [-172, -96], [-160, -97]], { h: 4.5, ring: 12 });
  tour['pond-bridge'] = v
    ? { label: '池桥', zone: 'pond', p: v.p, t: v.t, source: 'computed: 广场北段望九曲桥中段+湖心亭（vistaCam：点不入建筑/墙/水且净距≥2.5m，视线不入建筑内部；西岸走廊夹于 bld-553893872 与水之间弃用）' }
    : null;
}

// 4 庙院：山门→仪门→大殿轴线低视角（复用 G1 路线实拍机位，逐点复检）
tour.temple = recheck({ p: [-70, 4.5, 26], t: [-80, 2.5, -30] }, 'temple')
  ? { label: '庙院', zone: 'temple', p: [-70, 4.5, 26], t: [-80, 2.5, -30], source: 'reuse: G1 renders-goal-01/09-route-temple-axis（本轮净距/视线复检通过）' }
  : null;

// 5 商业主街：方浜中路西端沿街（复用 G3 校验机位，逐点复检）
{
  const g3 = JSON.parse(fs.readFileSync(path.join(OUT, 'g3-shot-cams.json'), 'utf8'));
  const v = recheck(g3['31-fangbang-west-end'], 'main-street');
  tour['main-street'] = v
    ? { label: '商业主街', zone: 'bazaar', p: v.p, t: v.t, source: 'reuse: G3 g3-shot-cams 31-fangbang-west-end（本轮净距/视线复检通过）' }
    : null;
  // 6 摊位组团：九曲桥广场北段组团 8（复用 G3 校验机位，逐点复检）
  const v2 = recheck(g3['35-jiuqu-plaza-stalls'], 'stalls');
  tour.stalls = v2
    ? { label: '摊位组团', zone: 'pond', p: v2.p, t: v2.t, source: 'reuse: G3 g3-shot-cams 35-jiuqu-plaza-stalls（本轮净距/视线复检通过）' }
    : null;
}

for (const [k, v] of Object.entries(tour)) {
  console.log(k, v ? `cam(${v.p}) -> tgt(${v.t})` : 'NO-CAM-FOUND');
}
const missing = Object.entries(tour).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error('missing tour cams:', missing.join(', ')); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'tour.json'), JSON.stringify(tour, null, 1));
console.log('tour.json written:', Object.keys(tour).length, 'views');
