// 小地图绘制层（小吃工单 20261001）。只负责 DOM/画布；几何与投影全部来自
// web/play/map-core.js（纯函数），摊位/借车点数据来自 stalls.js/state.js，
// 玩家位姿每帧由 install.js 推入。
//
// 性能契约（GOAL.md）：静态底图缓存——附近视图把窗内世界预渲染进离屏画布，
// 玩家移动超过窗宽 1/4 才重渲染底图；每帧只 drawImage 缓存 + 画少量动态标记，
// 不重画全部世界。不得灰空圈占位：底图必须来自真实 layout 几何。

import * as MC from './map-core.js';

// 逛吃手账 20261002 工单配色：底图由墨绿实块改温和蓝灰、水绿标线，
// 纸面米白；标记保持胭脂/浅玉/蜂蜜。与 play.css 的 --pb-* 变量同源。
const C = {
  paper: '#fff7e8',
  plaza: '#f4ead2',
  water: '#b9d8c9',
  road: '#71aaa0',
  block: '#5d7f90',
  blockEdge: 'rgba(255,247,232,0.6)',
  player: '#d56b70',
  view: '#244f68',
  stall: '#d56b70',
  stallDone: '#71aaa0',
  target: '#d56b70',
  bike: '#deb26c',
};

export function installPlayMap({ getSize = () => 210 } = {}) {
  const root = document.createElement('div');
  root.id = 'play-map';
  root.innerHTML = `
    <div id="play-map-title">附近街巷</div>
    <canvas id="play-map-canvas" width="${getSize()}" height="${getSize()}"></canvas>
    <div id="play-map-bar">
      <button type="button" id="p-map-mode">全图</button>
    </div>`;
  document.body.appendChild(root);

  const canvas = root.querySelector('#play-map-canvas');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  let geom = null;            // collectMapGeometry 结果
  let fullView = null;        // 全图视窗（打开时算一次）
  let mode = 'near';          // 'near' | 'full'
  let base = null;            // 离屏底图缓存 {canvas, view}
  let markers = { stalls: [], bike: null };
  let targetIdx = -1;
  let onPickTarget = null;
  let feet = [0, 0, 0], yaw = 0, facingYaw = 0, drawnView = null;

  const bCan = document.createElement('canvas');
  const bctx = bCan.getContext('2d');

  // ---- 底图渲染：把 view 窗内的真实几何画进离屏画布 ----
  function renderBase(view) {
    bCan.width = size; bCan.height = size;
    bctx.fillStyle = C.paper;
    bctx.fillRect(0, 0, size, size);
    if (!geom) return baseCache(view);
    const [x0, z0, x1, z1] = geom.bounds;
    // 窗口世界范围
    const wx0 = view.cx - view.halfW, wx1 = view.cx + view.halfW;
    const wz0 = view.cz - view.halfW, wz1 = view.cz + view.halfW;
    const inWin = (bx0, bz0, bx1, bz1) => bx1 >= wx0 && bx0 <= wx1 && bz1 >= wz0 && bz0 <= wz1;

    const fillRings = (rings, style, stroke) => {
      bctx.fillStyle = style;
      if (stroke) { bctx.strokeStyle = stroke; bctx.lineWidth = 1; }
      for (const ring of rings) {
        const bb = ringBBox(ring);
        if (!inWin(...bb)) continue;
        bctx.beginPath();
        ring.forEach(([x, z], i) => {
          const [px, py] = MC.project(view, x, z);
          i ? bctx.lineTo(px, py) : bctx.moveTo(px, py);
        });
        bctx.closePath();
        bctx.fill();
        if (stroke) bctx.stroke();
      }
    };
    fillRings(geom.plazas, C.plaza);
    fillRings(geom.waters, C.water);

    // 道路：真实宽度缩放（最小 1.5px），浅绿标线感
    bctx.strokeStyle = C.road;
    bctx.lineCap = 'round'; bctx.lineJoin = 'round';
    for (const r of geom.roads) {
      const bb = ringBBox(r.pts);
      if (!inWin(...bb)) continue;
      const [, , s] = MC.project(view, r.pts[0][0], r.pts[0][1]);
      bctx.lineWidth = Math.max(1.5, r.widthM * s);
      bctx.beginPath();
      r.pts.forEach(([x, z], i) => {
        const [px, py] = MC.project(view, x, z);
        i ? bctx.lineTo(px, py) : bctx.moveTo(px, py);
      });
      bctx.stroke();
    }

    // 建筑 footprint：温和蓝灰实块 + 纸色细边（街道肌理）
    fillRings(geom.blocks, C.block, C.blockEdge);
    return baseCache(view);
  }
  function baseCache(view) { return { view: { ...view } }; }

  // drawImage 用的是 bCan 本体（renderBase 直接画在它上面）
  function nearBaseFor(feetNow) {
    const view = MC.makeNearView(feetNow, size);
    const recenter = !base || base.view.full
      || Math.hypot(feetNow[0] - base.view.cx, feetNow[2] - base.view.cz) > view.halfW / 2;
    if (recenter) { renderBase(view); base = baseCache(view); }
    return base.view;
  }

  function ringBBox(pts) {
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const p of pts) {
      if (p[0] < ax) ax = p[0]; if (p[0] > bx) bx = p[0];
      if (p[1] < az) az = p[1]; if (p[1] > bz) bz = p[1];
    }
    return [ax, az, bx, bz];
  }

  function drawDisc(px, py, r, fill, stroke = C.paper) {
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke();
  }

  // ---- 每帧：底图缓存 + 动态标记 ----
  function update({ feet: f, yaw: y, facingYaw: fy = null, stalls = [], bike = null, targetIndex = -1, complete = false }) {
    feet = f ?? feet; yaw = y ?? yaw; markers = { stalls, bike }; targetIdx = targetIndex;
    facingYaw = fy ?? yaw;
    ctx.clearRect(0, 0, size, size);
    let view;
    if (mode === 'full') {
      if (!fullView && geom) fullView = MC.makeFullView(geom.bounds, size);
      view = fullView;
      if (!view) return;
      if (!base || !base.view.full) { renderBase(view); base = baseCache(view); }
      ctx.drawImage(bCan, 0, 0);
    } else {
      view = nearBaseFor(feet);
      // The paper window and all markers share the cached projection. The
      // window recenters after 20m; no translation can desync streets/markers.
      ctx.drawImage(bCan, 0, 0);
    }
    drawnView = view;

    // 摊位章（朱红未尝 / 浅绿已尝；当前目标加白圈+外环）
    markers.stalls.forEach((st, i) => {
      const p = MC.projectClamped(view, st.x, st.z);
      const done = st.done, isT = i === targetIndex && !complete;
      drawDisc(p.x, p.y, isT ? 5.5 : 4, done ? C.stallDone : C.stall);
      if (isT) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = C.target; ctx.lineWidth = 2; ctx.stroke();
      }
      if (isT && !p.inside) {  // 屏外目标：钳边小箭头（指向图外方向）
        ctx.fillStyle = C.target;
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('→', p.x, p.y - 8);
      }
    });
    // 借车点（金黄；车被骑走 = 空心）
    if (markers.bike) {
      const p = MC.projectClamped(view, markers.bike.x, markers.bike.z);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = markers.bike.gone ? C.paper : C.bike; ctx.fill();
      ctx.strokeStyle = C.bike; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // 玩家箭头 + 视角须
    {
      const arrow = MC.playerArrow(view, feet, facingYaw);
      ctx.beginPath();
      arrow.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
      ctx.closePath();
      ctx.fillStyle = C.player; ctx.fill();
      const [[ax, ay], [bx2, by2]] = MC.viewTick(view, feet, yaw);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2);
      ctx.strokeStyle = C.view; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // ---- 交互：切全图 / 点击选目标（只导向） ----
  root.querySelector('#p-map-mode').addEventListener('click', () => {
    mode = mode === 'near' ? 'full' : 'near';
    base = null;
    root.querySelector('#p-map-mode').textContent = mode === 'near' ? '全图' : '附近';
  });
  canvas.addEventListener('click', (e) => {
    if (!markers.stalls.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const view = drawnView ?? (mode === 'full' ? fullView : MC.makeNearView(feet, size));
    let best = -1, bestD = 16;
    markers.stalls.forEach((st, i) => {
      const [px, py] = MC.project(view, st.x, st.z);
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && onPickTarget) onPickTarget(best);
  });

  return {
    setGeometry(layout) { geom = MC.collectMapGeometry(layout); base = null; fullView = null; },
    update,
    pickTarget(cb) { onPickTarget = cb; },
    get mode() { return mode; },
  };
}
