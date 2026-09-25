// 路线冻结源（baseline/commercial-route.pinned.json）契约测试（2026-09-25 主控）
// - 冻结源：6 个锚点（map x,z）+ 5 条路线
// - 产物中 anchorSource / routeSource = 'pinned' 的锚点与路线必须与冻结源逐点一致（容差 1e-9）
// - 'searched' 的路线必须 pass（3m 走廊由生成器实测），并打印 WARN：几何变化使冻结路线失效，需主控复验后
//   PIN_ROUTES_UPDATE=1 刷新冻结源（执行者不要自己刷新）
// 反证：在引入冻结源之前的产物上运行会失败（没有 routeSource / anchorSource 字段）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  a.every((p, i) => Math.abs(p[0] - b[i][0]) <= 1e-9 && Math.abs(p[1] - b[i][1]) <= 1e-9);

const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'commercial-route.pinned.json'), 'utf8'));
const ANCHORS = ['main', 'gold', 'center', 'jiuqu', 'old-south', 'old-north'];
const ROUTES = [['main', 'jiuqu'], ['main', 'gold'], ['main', 'center'], ['old-south', 'old-north'], ['gold', 'jiuqu']];
ok('冻结源含 6 个锚点', ANCHORS.every(k => Array.isArray(pin.anchors?.[k]) && pin.anchors[k].length === 2));
ok('冻结源含 5 条路线', ROUTES.every(([a, b]) => pin.routes?.some(r => r.from === a && r.to === b && r.points?.length >= 2)));

const cr = JSON.parse(fs.readFileSync(path.join(OUT, 'commercial-route.json'), 'utf8'));
const ng = JSON.parse(fs.readFileSync(path.join(OUT, 'nav-gap.json'), 'utf8'));
ok('commercial-route.json 记录 anchorSource', cr.anchorSource && typeof cr.anchorSource === 'object');
ok('nav-gap.json 记录 anchorSource', ng.anchorSource && typeof ng.anchorSource === 'object');
const warns = [];
for (const k of ANCHORS) {
  const src = ng.anchorSource?.[k];
  ok(`锚点 ${k} 有来源（pinned/searched），实际 ${src}`, src === 'pinned' || src === 'searched');
  if (src === 'pinned') ok(`锚点 ${k} = 冻结源`, same([ng.anchors[k]], [pin.anchors[k]]));
  else warns.push(`anchor ${k} searched`);
}
for (const [a, b] of ROUTES) {
  const r = cr.routes.find(x => x.from === a && x.to === b);
  const p = pin.routes.find(x => x.from === a && x.to === b);
  ok(`路线 ${a}->${b} 存在且 pass`, r && r.pass === true);
  if (!r) continue;
  ok(`路线 ${a}->${b} 有来源，实际 ${r.routeSource}`, r.routeSource === 'pinned' || r.routeSource === 'searched');
  if (r.routeSource === 'pinned') {
    ok(`路线 ${a}->${b} = 冻结源逐点一致`, same(r.points, p.points));
    ok(`路线 ${a}->${b} 起终点 = 产物锚点`, same([r.points[0], r.points[r.points.length - 1]], [ng.anchors[a], ng.anchors[b]]));
  } else warns.push(`route ${a}->${b} searched`);
}
for (const w of warns) console.log('WARN', w, '— 几何变化使冻结源失效；在 RESULT 里写明，由主控复验后刷新（PIN_ROUTES_UPDATE=1），执行者不要自己刷新');
console.log(`route-pin-test: ${pass} pass, ${fail} fail, ${warns.length} warn (OUT=${path.basename(OUT)})`);
process.exit(fail ? 1 : 0);
