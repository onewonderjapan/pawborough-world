// WP13/T2 标签去重：屏幕空间矩形相交时隐藏低优先级标签（region > landmark > facility > note），
// 非区域标签（landmark+facility）每屏上限 FACILITY_CAP，landmark 永远先于普通设施保留；
// 返回本帧重叠对数（去重后应为 0）供 headless 断言。
// web/main.js 只在 drawLabels 里调用 dedupeLabels —— 逻辑集中在本文件方便合并。

const FACILITY_CAP = 12;
const PAD = 2;          // 矩形外扩 px，宁严勿漏
const sizeCache = new WeakMap();

function sizeOf(el) {
  let s = sizeCache.get(el);
  if (!s) { s = { w: el.offsetWidth, h: el.offsetHeight }; sizeCache.set(el, s); }
  return s;
}
// .lbl 的 transform 为 translate(-50%,-130%)：left/top 锚点在标签盒底部中心
function rectOf(it) {
  const { w, h } = sizeOf(it.el);
  return { x0: it.x - w / 2 - PAD, y0: it.y - h * 1.3 - PAD, x1: it.x + w / 2 + PAD, y1: it.y - h * 0.3 + PAD };
}
const intersects = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
const onScreen = (r, w, h) => r.x1 > 0 && r.x0 < w && r.y1 > 0 && r.y0 < h;

// items: [{el, prio(0=region,1=landmark,2=facility,3=note), x, y, dist}]，x/y 为已设置的 left/top。
// 处理顺序 = prio 升序（region/landmark 先占位）；与已放置矩形相交的后到者隐藏；
// 非区域标签超出 CAP 时按 (prio, 距离) 保留前 CAP 个。返回 {hidden, overlaps}。
export function dedupeLabels(items, w, h, facilityCap = FACILITY_CAP) {
  const lab = items.filter(i => i.prio >= 1).sort((a, b) => (a.prio - b.prio) || (a.dist - b.dist));
  const capHide = new Set(lab.slice(facilityCap).map(i => i.el));
  const order = [...items].sort((a, b) => a.prio - b.prio);
  const placed = [];
  let hidden = 0;
  for (const it of order) {
    if (capHide.has(it.el)) { it.el.style.visibility = 'hidden'; hidden++; continue; }
    const r = rectOf(it);
    if (!onScreen(r, w, h)) continue; // 屏外标签由 overflow:hidden 裁剪，不参与占位
    const clash = placed.find(q => intersects(r, q.rect));
    if (clash && it.prio >= clash.prio) { it.el.style.visibility = 'hidden'; hidden++; continue; }
    placed.push({ el: it.el, prio: it.prio, rect: r });
  }
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++)
      if (intersects(placed[i].rect, placed[j].rect)) overlaps++;
  return { hidden, overlaps };
}
export const FACILITY_LABEL_CAP = FACILITY_CAP;
