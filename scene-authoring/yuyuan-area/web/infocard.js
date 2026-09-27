// wave11-infocard：点击地标弹信息卡。逻辑全部集中本文件，web/main.js 只加最小挂钩（installInfocard 一行）。
// 交互：点击对象 → 沿父链找 layout id（同 tests/batch-identity-check.mjs I1 的点选溯源，合批下命中原对象）→
//       查 baseline layout 数据弹卡；再点空白 / 无名对象 / Esc 关闭；步行模式不弹（避免误触），导览 / 轨道模式弹。
// 白名单字段（工单定，写死在下面常量）：名称 / 类别 / 所在区域 / 高度 / 层数 / 占地面积 / 模型来源 + 一行固定数据边界说明。
// 不写任何描述性文字、历史介绍、年代、评价；不引用图库图片。
// 卡片复用 #info 面板：main.js 遗留的调试点选挂在前面先执行，本模块随后覆盖内容或收起 —— batch-identity-check I1
// 读 #info（无 dt「ID」时回退 h2），卡片 h2 = 名称，I1 口径不破。
// 顶层只放纯函数与常量（node 测试可直接 import），DOM 只在 installInfocard 里创建。
import * as THREE from 'three';

// —— 白名单常量（工单 2026-09-27 机主定）——
export const NOTE_TEXT = '名称来自 OpenStreetMap；形制为本项目推断建模，年代与史实未核实。';
export const NOTE_CLASS = 'infocard-note';
export const CARD_FIELDS = ['类别', '所在区域', '高度', '层数', '占地面积', '模型来源'];

// 所在区域：layout zone → 中文
export const AREA_CN = {
  garden: '豫园', temple: '城隍庙', bazaar: '商城', pond: '池带', fangbang: '方浜中路', outer: '外围',
};

// kind → 中文。pond 水上的 tower 是亭（湖心亭），商城 tower 是楼；
// templeAnchor 按名称细分（殿/庭院/门/廊/戏台/树），均只依赖 layout 字段。
export function kindLabel(o) {
  const k = o?.kind;
  const n = String(o?.name || '');
  if (k === 'hall') return '厅堂';
  if (k === 'xuan') return '轩';
  if (k === 'tower') return o?.zone === 'pond' ? '亭' : '楼';
  if (k === 'bazaarBlock') return '商城楼';
  if (k === 'zigzagBridge' || k === 'bridge') return '桥';
  if (k === 'rockery') return '假山';
  if (k === 'templeAnchor') {
    if (/殿$/.test(n)) return '殿';
    if (/庭$|院|穿廊|香道/.test(n)) return '庭院';
    if (/门/.test(n)) return '门';
    if (/廊/.test(n)) return '廊';
    if (/戏台/.test(n)) return '戏台';
    if (/^tree/.test(n)) return '树';
    return '庙宇建筑';
  }
  return KIND_CN[k] ?? (k ? String(k) : '—');
}
const KIND_CN = {
  pavilion: '亭', waterside: '水榭', watersideGallery: '水廊', corridor: '廊', stage: '戏台',
  gateAnchor: '门楼', moonGateWall: '洞门', wallHead: '墙头', wall: '墙', steps: '台阶',
  shopAnchor: '店铺', stall: '摊位', bench: '长凳', tree: '树', plaza: '广场', water: '水面',
  road: '道路', path: '小径', paving: '铺装', ground: '地面', outerBuilding: '楼',
  facadeBay: '立面开间', osmTempleOutline: '庙界', temple: '殿宇',
};

// 套件 id 表 —— 冻结源快照（modules/hall-kit/ids.json、modules/bazaar-tower-kit/ids.json、
// assemble.py SANSUITANG_DIR、modules/huxinting、modules/rockery/build-rockery.py 的目标 id）。
// tests/infocard-test.mjs 用同一批冻结源复核本表；表只决定「模型来源」一行的显示。
export const KIT_IDS = {
  "bld-165791764": "bazaar-tower-kit",
  "bld-228035331": "hall-kit",
  "bld-228035335": "hall-kit",
  "bld-389701812": "bazaar-tower-kit",
  "bld-389701901": "bazaar-tower-kit",
  "bld-389701971": "bazaar-tower-kit",
  "bld-389702030": "bazaar-tower-kit",
  "bld-428179901": "sansuitang",
  "bld-428179902": "hall-kit",
  "bld-428179903": "hall-kit",
  "bld-428179905": "hall-kit",
  "bld-428179909": "hall-kit",
  "bld-428179910": "hall-kit",
  "bld-428179911": "hall-kit",
  "bld-428179912": "hall-kit",
  "bld-428179913": "hall-kit",
  "bld-428179914": "hall-kit",
  "bld-428179916": "hall-kit",
  "bld-428179917": "hall-kit",
  "bld-428179918": "hall-kit",
  "bld-428179921": "hall-kit",
  "bld-428179922": "hall-kit",
  "bld-428179923": "hall-kit",
  "bld-428179925": "hall-kit",
  "bld-428179926": "hall-kit",
  "bld-428196072": "hall-kit",
  "bld-428196075": "hall-kit",
  "bld-428196078": "hall-kit",
  "bld-428196079": "hall-kit",
  "bld-428196090": "hall-kit",
  "bld-428196092": "hall-kit",
  "bld-428196106": "hall-kit",
  "bld-428196108": "hall-kit",
  "bld-428196109": "hall-kit",
  "bld-428196112": "hall-kit",
  "bld-428202599": "bazaar-tower-kit",
  "bld-428202601": "bazaar-tower-kit",
  "bld-428202602": "bazaar-tower-kit",
  "bld-428202603": "bazaar-tower-kit",
  "bld-428202606": "bazaar-tower-kit",
  "bld-428202607": "bazaar-tower-kit",
  "bld-553893867": "bazaar-tower-kit",
  "bld-553893868": "bazaar-tower-kit",
  "bld-553893873": "bazaar-tower-kit",
  "bld-553893884": "bazaar-tower-kit",
  "huxin-ting": "huxinting",
  "rockery-dajiashan": "rockery",
  "rockery-yulinglong": "rockery",
};

// —— 纯函数（测试的同一契约）——
// 占地面积 m²：footprint 多边形鞋带公式现算；无 footprint（折线 / 点 / 石块）返回 null → 卡片显示 —。
export function footprintAreaM2(o) {
  const fp = o?.geometry?.footprint;
  if (!Array.isArray(fp) || fp.length < 3) return null;
  let a = 0;
  for (let i = 0; i < fp.length; i++) {
    const p = fp[i], q = fp[(i + 1) % fp.length];
    if (!Array.isArray(p) || !Array.isArray(q)) return null;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
// 模型来源：layout.instances 的 id → 套件 module；否则套件 id 表；都不命中 → 程序化体块。
export function sourceLabel(obj, instancesById) {
  const inst = instancesById && instancesById.get(obj?.id);
  if (inst) return `套件：${inst.module}`;
  const kit = KIT_IDS[obj?.id];
  if (kit) return `套件：${kit}`;
  return '程序化体块';
}
const fmtHeight = (h) => (h == null ? '—' : `${h} m`);
const fmtArea = (a) => (a == null ? '—' : `${a.toFixed(1)} m²`);

// idOf：与 web/main.js 的 infoOf 同一条父链（userData.id 或 `zone|id|kind|lod|…` 管道名）
function parsePipe(name) {
  const parts = String(name).split('|');
  return parts.length >= 4 ? { id: parts[1] } : null;
}
function idOf(node) {
  for (let n = node; n; n = n.parent) {
    if (n.userData && n.userData.id) return n.userData.id;
    const p = parsePipe(n.name);
    if (p) return p.id;
  }
  return null;
}

// —— 安装（main.js 末尾调用一次）——
export function installInfocard({ raycaster, camera, scene, renderer, getLayout, getMode }) {
  if (!document.getElementById('infocard-style')) {
    const style = document.createElement('style');
    style.id = 'infocard-style';
    style.textContent = [
      // 小卡片、半透明底；手机宽度（375px）下不溢出（left:12px + 宽度 ≤ 100vw-24px）
      '#info.infocard{max-width:min(330px, calc(100vw - 24px));background:#faf5e8ee}',
      '#info.infocard h2{font-size:16px;margin:0 0 4px}',
      '#info.infocard dt{float:left;clear:left;color:#7d715d}',
      '#info.infocard dd{margin:0 0 2px 5.5em}',
      `#info.infocard .${NOTE_CLASS}{margin:6px 0 0;font-size:11px;line-height:1.5;color:#8a7f68;border-top:1px dashed #c3b498;padding-top:5px}`,
      // 卡片打开时对应标签高亮
      '.lbl.lbl-card-active{background:#956344 !important;color:#fff6e4 !important;border-color:#956344 !important}',
    ].join('\n');
    document.head.appendChild(style);
  }
  const el = document.getElementById('info');
  let objsById = null, instancesById = null;
  let activeLabels = [];
  const index = (layout) => {
    objsById = new Map(layout.objects.map(o => [o.id, o]));
    instancesById = new Map((layout.instances || []).map(i => [i.id, i]));
  };
  const unhighlight = () => { for (const n of activeLabels) n.classList.remove('lbl-card-active'); activeLabels = []; };
  const highlight = (name) => {
    unhighlight();
    if (!name) return;
    activeLabels = [...document.querySelectorAll('#labels .lbl')].filter(n => n.dataset.labelText === name);
    for (const n of activeLabels) n.classList.add('lbl-card-active');
  };
  const close = () => { el.style.display = 'none'; el.innerHTML = ''; el.classList.remove('infocard'); unhighlight(); };
  const open = (obj) => {
    el.classList.add('infocard');
    el.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = obj.name;
    const dl = document.createElement('dl');
    const rows = [
      [CARD_FIELDS[0], kindLabel(obj)],
      [CARD_FIELDS[1], AREA_CN[obj.zone] || obj.zone || '—'],
      [CARD_FIELDS[2], fmtHeight(obj.height)],
      [CARD_FIELDS[3], obj.storeys == null ? '—' : String(obj.storeys)],
      [CARD_FIELDS[4], fmtArea(footprintAreaM2(obj))],
      [CARD_FIELDS[5], sourceLabel(obj, instancesById)],
    ];
    for (const [dt, dd] of rows) {
      const d1 = document.createElement('dt'); d1.textContent = dt;
      const d2 = document.createElement('dd'); d2.textContent = dd;
      dl.append(d1, d2);
    }
    const note = document.createElement('p');
    note.className = NOTE_CLASS;
    note.textContent = NOTE_TEXT;
    el.append(h2, dl, note);
    el.style.display = 'block';
    highlight(obj.name);
  };
  renderer.domElement.addEventListener('click', (e) => {
    const layout = getLayout && getLayout();
    if (!layout) return;
    if (!objsById) index(layout);
    if (getMode && getMode() === 'walk') { close(); return; }   // 步行模式不弹（避免误触）
    raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      const id = idOf(hit.object);
      if (!id) continue;
      const obj = objsById.get(id);
      if (obj && obj.name) open(obj); else close();   // 无名对象不弹卡
      return;
    }
    close();   // 点空白收卡
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { open, close, _el: el };
}
