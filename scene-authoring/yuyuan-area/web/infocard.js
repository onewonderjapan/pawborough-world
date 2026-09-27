// wave11-infocard R2：点击地标弹信息卡。逻辑全部集中本文件，web/main.js 只保留 installInfocard 一行挂钩（拾取合并为一次）。
// 交互：点击对象 → 沿父链找 layout id（同 batch-identity-check 的点选溯源，合批下命中原网格）→ 查 baseline layout 弹卡；
//       再点空白 / Esc 关闭；步行模式不弹（避免误触），导览 / 轨道模式弹；已开卡片时切入步行立即关卡并清高亮。
// R2 字段口径（主控裁定 2026-09-27，取代 R1 工单的口径）：
//   名称        layout `name`（无名对象不弹卡）；
//   类别        layout `kind` 映射中文；templeAnchor 下先匹配具体类型（戏台/戏楼）再匹配泛化的「门」；
//   所在区域    layout zone → 中文；
//   模型高度    运行时该 layout id 全部可见网格的世界包围盒最高点，地面 0 m 起算（场地地面 y≈0，水下桩等 y<0 不计入），
//               合批下用原网格身份，显示 1 位小数；
//   层数（输入数据）  layout `storeys`，缺则 `levels`，都没有 → 「未核实」（不从模型猜）；
//   轮廓面积（OSM）   layout footprint 鞋带公式现算 —— 是输入轮廓面积，不是套件实际占地（字段名里写明 OSM）；
//   模型来源    命中节点父链上最近的 glTF extras `module`（three.js 里是 userData.module）→「套件：<module>」，
//               父链上没有 → 「程序化体块」。R1 的静态 KIT_IDS 表已删除（默认开关和关套件时都会误报）。
// 固定边界说明一行不变；不写任何描述性文字、历史介绍、年代、评价；不引用图库图片。
// 调试契约（非展示）：window.__pickDebug = { id, name, node } 每次轨道拾取都写，无名对象也写 id（batch-identity-check I1 消费 id/name；
// R4 追加只读字段 node = 实际命中网格 uuid，供 infocard-test 核对命中节点身份）。
// 顶层只放纯函数与常量（node 测试可直接 import），DOM 只在 installInfocard 里创建。
import * as THREE from 'three';

// —— 白名单常量（R2 主控裁定）——
export const NOTE_TEXT = '名称来自 OpenStreetMap；形制为本项目推断建模，年代与史实未核实。';
export const NOTE_CLASS = 'infocard-note';
export const CARD_FIELDS = ['类别', '所在区域', '模型高度', '层数（输入数据）', '轮廓面积（OSM）', '模型来源'];

// 所在区域：layout zone → 中文
export const AREA_CN = {
  garden: '豫园', temple: '城隍庙', bazaar: '商城', pond: '池带', fangbang: '方浜中路', outer: '外围',
};

// kind → 中文。pond 水上的 tower 是亭（湖心亭），商城 tower 是楼；templeAnchor 按名称细分。
// R2（必修7）：先匹配具体类型（戏台/戏楼），再匹配泛化的「门」—— 仪门戏楼不能被判成门。
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
    if (/戏台|戏楼/.test(n)) return '戏台';
    if (/门/.test(n)) return '门';
    if (/廊/.test(n)) return '廊';
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

// —— 纯函数（测试同一契约）——
// 轮廓面积 m²：footprint 多边形鞋带公式现算（输入轮廓口径，非套件实际占地）；无 footprint 返回 null → 显示 —。
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
// 层数（输入数据）：storeys 优先，缺则 levels，都没有 → 未核实（必修1：华宝楼/上海老饭店在 levels 上）
export function storeysLabel(o) {
  const n = o?.storeys ?? o?.levels;
  return n == null ? '未核实' : String(n);
}
// 模型来源文本：模块名来自运行时命中节点父链 userData.module；没有 → 程序化体块。无静态表。
export function sourceLabel(moduleName) {
  return moduleName ? `套件：${moduleName}` : '程序化体块';
}
const fmtHeight = (h) => (h == null ? '—' : `${h.toFixed(1)} m`);
const fmtArea = (a) => (a == null ? '—' : `${a.toFixed(1)} m²`);

// idOf：父链上 userData.id 或 `zone|id|kind|lod|…` 管道名（与 main.js 的 infoOf 同一条链）
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
// R2（必修3）：命中节点父链上最近的 glTF extras module（userData.module）
function moduleOf(node) {
  for (let n = node; n; n = n.parent) {
    if (n.userData && n.userData.module != null) return String(n.userData.module);
  }
  return null;
}
// R2（必修3）：自身或父链 visible===false 的命中一律跳过（隐藏几何不抢点击）
function visibleChain(node) {
  for (let n = node; n; n = n.parent) if (n.visible === false) return false;
  return true;
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
      // R2 dt 变长（层数（输入数据）），dd 缩进同步加大
      '#info.infocard dt{float:left;clear:left;color:#7d715d}',
      '#info.infocard dd{margin:0 0 2px 7.6em}',
      `#info.infocard .${NOTE_CLASS}{margin:6px 0 0;font-size:11px;line-height:1.5;color:#8a7f68;border-top:1px dashed #c3b498;padding-top:5px}`,
      // 卡片打开时对应标签高亮
      '.lbl.lbl-card-active{background:#956344 !important;color:#fff6e4 !important;border-color:#956344 !important}',
      // R2（必修4）：#bar 与 #hud 都是 absolute 且无 z-index，DOM 里 hud 在后会盖住工具条按钮（375px 下两区相交）；
      // 工具条必须保持可点（拾取断言与误触保护），提到 hud 之上。
      '#bar{z-index:30}',
    ].join('\n');
    document.head.appendChild(style);
  }
  const el = document.getElementById('info');
  const barEl = document.getElementById('bar');
  let objsById = null;
  let meshIndex = null, meshCount = -1;   // layout id → 原网格列表（合批下身份在原网格上；分区懒加载后重建）
  const index = (layout) => {
    objsById = new Map(layout.objects.map(o => [o.id, o]));
    meshIndex = null;
  };
  function ensureMeshIndex() {
    let total = 0;
    scene.traverse(o => { if (o.isMesh) total++; });
    if (meshIndex && total === meshCount) return meshIndex;
    meshCount = total;
    meshIndex = new Map();
    scene.traverse(o => {
      if (!o.isMesh || o.isBatchedMesh || !o.geometry) return;
      const id = idOf(o);
      if (!id) return;
      if (!meshIndex.has(id)) meshIndex.set(id, []);
      meshIndex.get(id).push(o);
    });
    return meshIndex;
  }
  // 模型高度：该 layout id 全部「可见」网格的世界包围盒最高点（地面 0 m 起算，y<0 不计入）
  const _v = new THREE.Vector3();
  function modelHeight(id) {
    const meshes = ensureMeshIndex().get(id);
    if (!meshes || !meshes.length) return null;
    let maxY = null;
    for (const m of meshes) {
      if (!visibleChain(m)) continue;
      m.updateWorldMatrix(true, false);
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      for (let ci = 0; ci < 8; ci++) {
        _v.set(ci & 1 ? b.max.x : b.min.x, ci & 2 ? b.max.y : b.min.y, ci & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
        if (maxY === null || _v.y > maxY) maxY = _v.y;
      }
    }
    return maxY == null ? null : Math.max(0, maxY);
  }
  const activeLabels = [];
  const unhighlight = () => { for (const n of activeLabels) n.classList.remove('lbl-card-active'); activeLabels.length = 0; };
  const highlight = (name) => {
    unhighlight();
    if (!name) return;
    for (const n of document.querySelectorAll('#labels .lbl')) {
      if (n.dataset.labelText === name) { n.classList.add('lbl-card-active'); activeLabels.push(n); }
    }
  };
  const close = () => { el.style.display = 'none'; el.innerHTML = ''; el.classList.remove('infocard'); unhighlight(); };
  // R2（必修4）：窄屏下卡片停靠在工具区之外 —— 顶边压在 #bar 下缘之下，最高到视口底，超出滚动
  const dock = () => {
    if (innerWidth <= 640 && barEl) {
      const top = Math.ceil(barEl.getBoundingClientRect().bottom) + 8;
      el.style.top = `${top}px`;
      el.style.bottom = 'auto';
      el.style.maxHeight = `${Math.max(140, innerHeight - top - 10)}px`;
    } else {
      el.style.top = '';
      el.style.bottom = '';
      el.style.maxHeight = '';
    }
  };
  const open = (obj, hitNode) => {
    el.classList.add('infocard');
    el.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = obj.name;
    const dl = document.createElement('dl');
    const rows = [
      [CARD_FIELDS[0], kindLabel(obj)],
      [CARD_FIELDS[1], AREA_CN[obj.zone] || obj.zone || '—'],
      [CARD_FIELDS[2], fmtHeight(modelHeight(obj.id))],
      [CARD_FIELDS[3], storeysLabel(obj)],
      [CARD_FIELDS[4], fmtArea(footprintAreaM2(obj))],
      [CARD_FIELDS[5], sourceLabel(hitNode ? moduleOf(hitNode) : null)],
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
    dock();
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
    let hitNode = null, id = null, obj = null;
    for (const hit of hits) {
      if (!visibleChain(hit.object)) continue;   // 隐藏几何不抢点击（含父链不可见）
      const hid = idOf(hit.object);
      if (!hid) continue;
      hitNode = hit.object; id = hid;
      obj = objsById.get(id) || null;
      break;
    }
    // 调试契约（非展示）：每次轨道拾取都写；无名对象也写 id，空白写 null（batch-identity-check I1 消费）
    // R4：附加 node = 实际命中网格的 three uuid（只读调试字段，不影响弹卡；infocard-test T6/T8 用它核对命中节点身份）
    window.__pickDebug = { id: id, name: obj && obj.name ? obj.name : null, node: hitNode ? hitNode.uuid : null };
    if (obj && obj.name) open(obj, hitNode);
    else close();   // 无名对象 / 空白收卡
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // R3（可选1）：模式变化统一走 walk.js 内部 setMode 派发的 pb:mode 事件（按钮 / enter / exit / spawnAt 全覆盖），
  // 不再包装 __walk.enter。#w-home 不切模式（步行内回锚点），保留点击关卡。
  addEventListener('pb:mode', () => close());
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#w-home')) close();
  });
  addEventListener('resize', () => { if (el.style.display === 'block') dock(); });
  return { open, close, _el: el };
}
