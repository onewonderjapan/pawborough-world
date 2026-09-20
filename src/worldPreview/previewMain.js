// world-preview page behavior — the player homepage. No 3D, no physics: the
// page reads the delivered route.json, derives the four start points with the
// same rules as the game (src/player/entryAnchors.js), and links into
// fangbang.html?ds=fangbang-temple-v7&entry=<id> with relative URLs only.
// If route.json cannot be read, the page says so and still links into the
// game with its default entry — it never invents coordinates.
import { DATASET_ID, derivePreviewAnchors, gameUrl } from './entryData.js';
import galleryManifest from './galleryManifest.json';

import imgMainStreet from '../../artifacts/world-playable/captures/main-street.png';
import imgTempleFront from '../../artifacts/world-playable/captures/temple-front.png';
import imgLaneA from '../../artifacts/world-playable/captures/lane-a-mouth.png';
import imgLaneB from '../../artifacts/world-playable/captures/lane-b-mouth.png';
import imgLaneAAfterEvidence from '../../artifacts/lane-a-polish/after/street-mouth.png';
import imgLaneABefore from '../../artifacts/lane-a-polish/before/street-mouth.png';
import imgLaneBAfterEvidence from '../../artifacts/lane-b-polish/after/street-mouth.png';
import imgLaneBBefore from '../../artifacts/lane-b-polish/before/street-mouth.png';

// display order per plan: 主街、A弄、B弄、庙前
const ENTRY_META = {
  mainStreet: { name: '主街', desc: '精修样段主街：沿街店铺与两处弄口，一路向西到庙前。',
    img: imgMainStreet,
    caption: '主街西口机位：精修主街向西延伸，两侧为沿街立面。来自游戏实景截图。',
    alt: '游戏实景：主街西口望西，两侧石库门沿街立面' },
  laneA: { name: 'A弄', desc: '八米窄弄：街口望进有纵深，弄内有门窗与尽端壁龛。',
    img: imgLaneA,
    caption: 'A弄街口机位（本批实拍；A弄资产与当前候选逐字节一致）。来自游戏实景截图。',
    alt: '游戏实景：A弄街口望入' },
  laneB: { name: 'B弄', desc: '弄身向里渐宽成口袋，走到尽端回望正对主街。',
    img: imgLaneB,
    caption: 'B弄街口机位（本批实拍，v7 候选资产）。来自游戏实景截图。',
    alt: '游戏实景：B弄街口望入' },
  templeFront: { name: '庙前', desc: '山门前广场：正望「保障海隅」门额，可沿庙轴线走进前院。',
    img: imgTempleFront,
    caption: '方浜路中线机位：山门正立面与门前石狮。来自游戏实景截图。',
    alt: '游戏实景：庙前山门正立面' },
};

const $ = (s) => document.querySelector(s);
const entriesEl = $('#entries'), heroImg = $('#hero-img'), heroCap = $('#hero-cap'),
  ctaExplore = $('#cta-explore'), mapEl = $('#map');

let anchors = [];       // derived from route.json (may stay empty on fetch failure)
let selectedId = null;
let config = 'default';

function refreshCta() {
  ctaExplore.href = gameUrl(selectedId ?? '', config);
}

function selectEntry(id, { focus = false } = {}) {
  if (!ENTRY_META[id]) return;
  selectedId = id;
  for (const b of entriesEl.querySelectorAll('button')) {
    if (b.dataset.entry === id) {
      b.setAttribute('aria-pressed', 'true');
      if (focus) b.focus();
    } else b.setAttribute('aria-pressed', 'false');
  }
  for (const d of mapEl.querySelectorAll('[data-map-entry]'))
    d.setAttribute('aria-pressed', d.dataset.mapEntry === id ? 'true' : 'false');
  heroImg.src = ENTRY_META[id].img;
  heroImg.alt = ENTRY_META[id].alt;
  heroCap.textContent = ENTRY_META[id].caption;
  refreshCta();
}

function buildEntryList() {
  entriesEl.textContent = '';
  for (const a of anchors) {
    const m = ENTRY_META[a.id];
    if (!m) continue;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'entry-btn';
    b.dataset.entry = a.id;
    b.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span');
    name.className = 'entry-name serif';
    name.textContent = m.name;
    const desc = document.createElement('span');
    desc.className = 'entry-desc';
    desc.textContent = m.desc;
    b.append(name, desc);
    b.onclick = () => selectEntry(a.id);
    li.appendChild(b);
    entriesEl.appendChild(li);
  }
}

// ---- 2D guide map: real route coordinates projected to SVG ------------------
// west (temple) on the left, east (sample end) on the right; vertical axis is
// the raw world z. Bounds and scale are computed from the data, never fixed.
function buildMap(route) {
  const lines = [];
  const pts = [...(route.mainStreet ?? [])];
  lines.push({ pts, dash: null, cls: 'street' });
  const e = route.entries ?? {};
  if (e.shanmenThreshold && e.houdianDoors)
    lines.push({ pts: [e.shanmenThreshold, e.houdianDoors], dash: '7 6', cls: 'axis', label: '庙轴线' });
  const exc = [];
  for (const key of ['laneAExcursion', 'laneBExcursion'])
    if (route[key]?.length >= 2) exc.push({ pts: route[key], cls: 'lane' });
  const all = [...pts, ...exc.flatMap((l) => l.pts),
    ...(e.houdianDoors ? [e.houdianDoors] : [])];
  if (all.length < 2) { mapError('路线数据点不足，无法绘制导览图。'); return; }
  const xs = all.map((p) => p[0]), zs = all.map((p) => p[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const W = 1000, pad = 46;
  const s = (W - pad * 2) / Math.max(maxX - minX, 1);
  const H = Math.round(Math.max(300, Math.min(620, (maxZ - minZ) * s + pad * 2)));
  const X = (x) => +((x - minX) * s + pad).toFixed(1);
  const Y = (z) => +((z - minZ) * s + pad).toFixed(1);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '导览图：主街与四个出发点');
  const css = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  css.textContent = `
    .street{fill:none;stroke:#a49e8c;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
    .lane{fill:none;stroke:#a49e8c;stroke-width:2;stroke-linecap:round}
    .axis{stroke:#8a8271;stroke-width:1.6}
    .axis-label,.dot-label{font:13px 'Noto Serif CJK SC',serif;fill:#372f27;paint-order:stroke;stroke:#f7f4ec;stroke-width:4px;stroke-linejoin:round}
    .end-label{font:12px system-ui,'Noto Sans CJK SC',sans-serif;fill:#8b8270}
    .dot{fill:#4f4639;stroke:#f7f4ec;stroke-width:2}
    .dot-hit{fill:transparent;cursor:pointer}
    [data-map-entry]{outline-offset:2px}
    [data-map-entry]:focus-visible .dot{stroke:#372f27}
    [data-map-entry][aria-pressed="true"] .dot{fill:#8a6f4d}
  `;
  svg.appendChild(css);
  for (const l of [...lines.map((x) => ({ ...x, cls: 'street' })), ...exc]) {
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('class', l.cls);
    if (l.dash) pl.setAttribute('stroke-dasharray', l.dash);
    pl.setAttribute('points', l.pts.map((p) => `${X(p[0])},${Y(p[2])}`).join(' '));
    svg.appendChild(pl);
  }
  // temple axis line drawn on top of the street polyline end
  if (e.shanmenThreshold && e.houdianDoors) {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('class', 'axis');
    ln.setAttribute('stroke-dasharray', '7 6');
    ln.setAttribute('x1', X(e.shanmenThreshold[0])); ln.setAttribute('y1', Y(e.shanmenThreshold[2]));
    ln.setAttribute('x2', X(e.houdianDoors[0])); ln.setAttribute('y2', Y(e.houdianDoors[2]));
    svg.appendChild(ln);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'axis-label');
    t.setAttribute('x', X((e.shanmenThreshold[0] + e.houdianDoors[0]) / 2) - 22);
    t.setAttribute('y', Y((e.shanmenThreshold[2] + e.houdianDoors[2]) / 2));
    t.textContent = '庙轴线';
    svg.appendChild(t);
  }
  // end labels: west/east grounded in the delivered camera/route naming
  const west = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  west.setAttribute('class', 'end-label'); west.setAttribute('x', 8); west.setAttribute('y', 18);
  west.textContent = '← 西（庙前方向）';
  const east = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  east.setAttribute('class', 'end-label'); east.setAttribute('text-anchor', 'end');
  east.setAttribute('x', W - 8); east.setAttribute('y', 18);
  east.textContent = '东（样段东端）→';
  svg.append(west, east);

  for (const a of anchors) {
    const m = ENTRY_META[a.id];
    if (!m) continue;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-map-entry', a.id);
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-pressed', 'false');
    g.setAttribute('aria-label', `选择出发点：${m.name}`);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.setAttribute('class', 'dot-hit'); hit.setAttribute('r', 16);
    hit.setAttribute('cx', X(a.position[0])); hit.setAttribute('cy', Y(a.position[2]));
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'dot'); dot.setAttribute('r', 6.5);
    dot.setAttribute('cx', X(a.position[0])); dot.setAttribute('cy', Y(a.position[2]));
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'dot-label');
    label.setAttribute('x', X(a.position[0]) + 10); label.setAttribute('y', Y(a.position[2]) + 4);
    label.textContent = m.name;
    g.append(hit, dot, label);
    g.addEventListener('click', () => selectEntry(a.id));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectEntry(a.id, { focus: false }); }
    });
    svg.appendChild(g);
  }
  mapEl.textContent = '';
  mapEl.appendChild(svg);
}

function mapError(msg) {
  mapEl.textContent = '';
  const p = document.createElement('p');
  p.className = 'map-error';
  p.textContent = msg;
  mapEl.appendChild(p);
}

// ---- gallery -----------------------------------------------------------------
function buildGallery() {
  const spotsEl = $('#spots');
  spotsEl.textContent = '';
  for (const id of ['mainStreet', 'laneA', 'laneB', 'templeFront']) {
    const m = ENTRY_META[id];
    const prov = galleryManifest.images[id];
    const fig = document.createElement('figure');
    const a = document.createElement('a');
    a.href = m.img; a.target = '_blank'; a.rel = 'noopener';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = m.img; img.alt = m.alt;
    a.appendChild(img);
    const cap = document.createElement('figcaption');
    cap.textContent = `${m.name} —— ${m.caption}`;
    fig.append(a, cap);
    spotsEl.appendChild(fig);
  }
  // before/after pairs: the upstream SAME-POSE evidence pairs (上一版 left,
  // never presented as current)
  $('#pair-a').append(...pair([
    { ver: '上一版', note: 'A弄精修施工前', img: imgLaneABefore, manifestId: 'laneABefore' },
    { ver: '当前候选', note: 'A弄精修后（资产与v7候选逐字节一致）', img: imgLaneAAfterEvidence, manifestId: 'laneAAfterEvidence' },
  ], 'A弄·街口同机位'));
  $('#pair-b').append(...pair([
    { ver: '上一版', note: 'v6 候选', img: imgLaneBBefore, manifestId: 'laneBBefore' },
    { ver: '当前候选', note: 'v7，B弄口修整', img: imgLaneBAfterEvidence, manifestId: 'laneBAfterEvidence' },
  ], 'B弄·街口同机位'));
  const tb = $('#src-table tbody');
  for (const [p, s] of Object.entries(galleryManifest.sources)) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); const code = document.createElement('code');
    code.textContent = p; td1.appendChild(code);
    const td2 = document.createElement('td'); td2.textContent = s.note;
    const td3 = document.createElement('td');
    td3.textContent = `sha256 ${s.sha256.slice(0, 12)}… · ${(s.bytes / 1e6).toFixed(1)} MB`;
    tr.append(td1, td2, td3);
    tb.appendChild(tr);
  }
}

function pair(cells, title) {
  const out = [];
  for (const c of cells) {
    const fig = document.createElement('figure');
    const a = document.createElement('a');
    a.href = c.img; a.target = '_blank'; a.rel = 'noopener';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = c.img;
    img.alt = `${title}：${c.ver}——${c.note}`;
    a.appendChild(img);
    const cap = document.createElement('figcaption');
    cap.className = 'ver';
    const b = document.createElement('b'); b.textContent = c.ver;
    cap.append(b, document.createTextNode('：' + c.note));
    fig.append(a, cap);
    out.push(fig);
  }
  return out;
}

// ---- init --------------------------------------------------------------------
for (const radio of document.querySelectorAll('input[name="cfg"]'))
  radio.addEventListener('change', () => { config = radio.value; refreshCta(); });

// first paint already shows the main-street hero (data may still be loading)
heroImg.src = ENTRY_META.mainStreet.img;
heroImg.alt = ENTRY_META.mainStreet.alt;
heroCap.textContent = ENTRY_META.mainStreet.caption;

(async function init() {
  buildGallery();
  let route = null;
  try {
    const r = await fetch(`./world/${DATASET_ID}/route.json`);
    if (!r.ok) throw new Error(`route.json HTTP ${r.status}`);
    route = await r.json();
    anchors = derivePreviewAnchors(route);
  } catch (err) {
    entriesEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'entry-btn';
    li.style.cssText = 'color:#6d6555;cursor:default;display:block';
    li.textContent = '出发点数据读取失败（' + (err?.message ?? err) + '）。仍可从默认入口进入游戏。';
    entriesEl.appendChild(li);
    mapError('导览图数据读取失败：' + (err?.message ?? err));
    refreshCta();
    return;
  }
  buildEntryList();
  buildMap(route);
  selectEntry('mainStreet');
})();
