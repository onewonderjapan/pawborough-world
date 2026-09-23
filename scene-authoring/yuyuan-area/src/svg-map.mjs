// 同一 layout 派生：2D 标注图 (out/map-annotated.svg) + 分区组件清单 (out/zones/*.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const [bx0, bz0, bx1, bz1] = layout.meta.bounds;
const W = 1800, PAD = 24;
const scale = (W - PAD * 2) / (bx1 - bx0);
const H = Math.round((bz1 - bz0) * scale) + PAD * 2;
const X = (x) => +(PAD + (x - bx0) * scale).toFixed(1);
const Y = (z) => +(PAD + (z - bz0) * scale).toFixed(1);
const poly = (pts) => pts.map(p => `${X(p[0])},${Y(p[1])}`).join(' ');

const ZONE_FILL = { garden: '#7a9a6d', temple: '#8a6d9a', bazaar: '#a8764f', pond: '#5b7f92', outer: '#b3ab9d' };
const s = [];
s.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif">`);
s.push(`<rect width="${W}" height="${H}" fill="#efe8d9"/>`);
s.push(`<text x="${PAD}" y="${PAD + 8}" font-size="20" fill="#5a4a35">方浜市声 · 全域底模总图（俯瞰标注）— 豫园 / 城隍庙 / 小吃商业街　·　X东 Z南 米　·　非历史测绘复原</text>`);

// 道路
for (const o of layout.objects) {
  if (o.kind !== 'road' || o.skipRender) continue;
  const w = Math.max(1, (o.geometry.width || 3.5) * scale * 0.8);
  const col = o.geometry.priority === 2 ? '#9a938a' : o.geometry.priority === 1 ? '#a6a099' : '#b8b2a6';
  s.push(`<polyline points="${poly(o.geometry.polyline)}" fill="none" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-linejoin="round" stroke-linecap="round"/>`);
}
// 广场
for (const o of layout.objects) {
  if (o.kind === 'plaza') s.push(`<polygon points="${poly(o.geometry.footprint)}" fill="#c5bca8"/>`);
}
// 水
for (const o of layout.objects) {
  if (o.kind === 'water') s.push(`<polygon points="${poly(o.geometry.footprint)}" fill="#6f9aa8"/>`);
}
// 建筑（分区着色）
for (const o of layout.objects) {
  if (!o.geometry || !o.geometry.footprint) continue;
  if (!['outerBuilding', 'hall', 'tower', 'pavilion', 'xuan', 'waterside', 'stage', 'bazaarBlock'].includes(o.kind)) continue;
  const fill = ZONE_FILL[o.zone] || ZONE_FILL.outer;
  s.push(`<polygon points="${poly(o.geometry.footprint)}" fill="${fill}" stroke="#00000022" stroke-width="0.5"/>`);
}
// 庙区设计轴实例位置
for (const i of layout.instances) {
  if (!i.id.startsWith('temple-')) continue;
  s.push(`<circle cx="${X(i.position[0])}" cy="${Y(i.position[1])}" r="4" fill="#5d3a6e"/>`);
}
// 园墙/庙墙
for (const o of layout.objects) {
  if (o.kind !== 'wall') continue;
  for (const [a, b] of o.geometry.segments) {
    s.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="#5a5a52" stroke-width="1.6"/>`);
  }
}
// 桥
for (const o of layout.objects) {
  if (o.kind === 'zigzagBridge' || o.kind === 'bridge') {
    s.push(`<polyline points="${poly(o.geometry.polyline)}" fill="none" stroke="#8a5a3a" stroke-width="2.4"/>`);
  }
}
// 区界
for (const [z, zone] of Object.entries(layout.zones)) {
  s.push(`<polygon points="${poly(zone.polygon)}" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="7 4"/>`);
  const bb = zone.polygon.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])], [1e9, -1e9, 1e9, -1e9]);
  s.push(`<text x="${X((bb[0] + bb[1]) / 2)}" y="${Y((bb[2] + bb[3]) / 2)}" font-size="26" fill="#000000cc" text-anchor="middle" font-weight="700">${zone.name}</text>`);
}
// 标签
for (const l of layout.labels) {
  if (l.kind === 'osm-note') {
    s.push(`<circle cx="${X(l.x)}" cy="${Y(l.z)}" r="2.5" fill="#a33"/>`);
    continue;
  }
  s.push(`<text x="${X(l.x)}" y="${Y(l.z)}" font-size="12" fill="#3a3128" text-anchor="middle" stroke="#efe8d9" stroke-width="2.4" paint-order="stroke">${l.text}</text>`);
}
s.push(`<text x="${PAD}" y="${H - 10}" font-size="12" fill="#7d715d">来源：© OpenStreetMap contributors (ODbL) + 2019 档案中心线 · 庙区组团对齐既有 temple-axis-v3 设计轴 · 门楼为已采用 v2 · 店屋为 shop-base 批次只读复用</text>`);
s.push('</svg>');
fs.writeFileSync(path.join(OUT, 'map-annotated.svg'), s.join('\n'));
console.log('map-annotated.svg', s.length, 'elements');

// 分区组件清单
const zdir = path.join(OUT, 'zones');
fs.mkdirSync(zdir, { recursive: true });
for (const z of ['garden', 'temple', 'bazaar', 'pond', 'outer']) {
  const objs = layout.objects.filter(o => o.zone === z);
  const insts = layout.instances.filter(i => i.zone === z);
  fs.writeFileSync(path.join(zdir, `${z}.json`), JSON.stringify({
    zone: z, count: objs.length, instances: insts.length,
    byKind: objs.reduce((m, o) => (m[o.kind] = (m[o.kind] || 0) + 1, m), {}),
    objects: objs, instances: insts,
  }, null, 1));
}
console.log('zone lists written to out/zones/');
