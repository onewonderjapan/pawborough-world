// Play-mode HUD（逛吃手账 20261002 重绘）：
//   左上：紧凑三味手账「逛吃手账」+ 下一味/距离 + 三枚大圆章 + 已尝计数
//   右上：小地图（DOM 在 web/play/minimap.js，本文件只留位置协调）
//   底部：小型动作栏 + 单条上下文按键提示 + 「慢慢品尝」进度卡（updateInteraction 接口）
//   详细 WASD/Shift/F/R 键位收进「操作」折叠弹层：打开时暂停游戏，
//   关闭只解除弹层自己按下的那次暂停，不绕过用户/暂停键建立的 session 状态。
//   保留：暂停/继续/取景/回到游玩、新散步（二次确认）、中文可恢复资产失败面板、
//   全部旧按钮 ID 与事件。
// HUD 拥有 play 模式全部 DOM；状态一律来自 state.js（HUD 只展示）。
import { EAT_SECONDS } from './state.js';

// 三味原创内联 SVG 线画图标（静态常量，可安全 innerHTML；不用 emoji 当主体）
const FOOD_SVG = {
  xiaolongbao: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5.8 16.5c0-4 2.8-6.8 6.2-6.8s6.2 2.8 6.2 6.8"/>
  <path d="M5.2 16.5h13.6"/>
  <path d="M12 9.7V6.8"/>
  <path d="M9.4 10.3 8.6 7.7"/>
  <path d="m14.6 10.3.8-2.6"/>
</svg>`,
  congyoubing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <ellipse cx="12" cy="13" rx="7.2" ry="5.6"/>
  <path d="m8.6 11.6 1.5 1.1"/>
  <path d="m13.9 10.9-1.3 1.2"/>
  <path d="m15.3 14.8-1.5-1"/>
  <path d="m10.1 15.9 1.2-1.1"/>
</svg>`,
  youdunzi: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 20.2c-3.4 0-5.8-2.1-5.8-5C6.2 11.6 9 8 12 4.6c3 3.6 5.8 7 5.8 10.6 0 2.9-2.4 5-5.8 5Z"/>
  <path d="m9.4 13.2 1.5 1.2"/>
  <path d="m13.2 11.8 1.4 1.2"/>
  <path d="m11 16.4 1.3 1"/>
</svg>`,
  fallback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="13" r="6.5"/></svg>`,
};
const svgFor = (id) => FOOD_SVG[id] ?? FOOD_SVG.fallback;

export function installPlayHud({ core, state = null, overlay = null }) {
  document.body.classList.add('play-mode');
  // 调试三排按钮 / 统计浮层在 play 页隐藏（默认 viewer 页不受影响）
  for (const id of ['bar', 'hud']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  const root = document.createElement('div');
  root.id = 'play-hud';
  root.innerHTML = `
    <div id="play-goal" hidden>
      <div id="play-goal-head">
        <span id="play-goal-title">逛吃手账</span>
        <span id="play-goal-count"></span>
      </div>
      <div id="play-goal-sub"><span id="play-goal-next"></span><span id="play-goal-dist"></span></div>
      <div id="play-stamps"></div>
    </div>
    <div id="play-msg" hidden></div>
    <div id="play-interact" hidden>
      <span class="pi-icon" aria-hidden="true"></span>
      <span class="pi-body">
        <span class="pi-label">慢慢品尝</span>
        <span class="pi-bar"><span class="pi-fill"></span></span>
      </span>
    </div>
    <div id="play-bottom" hidden></div>
    <div id="play-hint">WASD 走动 · Shift 小跑 · P 暂停</div>
    <div id="play-actions">
      <button type="button" id="p-pause">暂停</button>
      <button type="button" id="p-view">取景</button>
      <button type="button" id="p-enter" hidden>回到游玩</button>
      <button type="button" id="p-atlas" disabled>图鉴</button>
      <button type="button" id="p-help" aria-expanded="false" aria-controls="play-help">操作</button>
      <button type="button" id="p-reset" title="散步记录准备中" disabled>新散步</button>
    </div>
    <div id="play-asset-error" role="alert" hidden>
      <p id="play-asset-error-text"></p>
      <button type="button" id="p-reload">重新加载</button>
    </div>
    <div id="play-help" hidden>
      <div id="play-help-card" role="dialog" aria-modal="true" aria-label="操作说明">
        <div id="play-help-head">
          <span>操作说明</span>
          <button type="button" id="p-help-close">关闭</button>
        </div>
        <div id="play-help-body"></div>
        <p id="play-help-note">打开本说明时游戏会自动暂停。</p>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const bPause = $('p-pause'), bView = $('p-view'), bEnter = $('p-enter'), bReset = $('p-reset');
  const bHelp = $('p-help'), bAtlas = $('p-atlas');
  let atlasOpener = null;
  const msg = $('play-msg'), errBox = $('play-asset-error'), errText = $('play-asset-error-text');
  const goalBox = $('play-goal'), goalCount = $('play-goal-count');
  const goalNext = $('play-goal-next'), goalDist = $('play-goal-dist'), stampsBox = $('play-stamps');
  const bottom = $('play-bottom'), hintEl = $('play-hint');
  const interactBox = $('play-interact');
  const piIcon = interactBox.querySelector('.pi-icon'), piFill = interactBox.querySelector('.pi-fill');
  const helpEl = $('play-help');

  // ---- 「操作」弹层内容（DOM API + textContent，全部静态文案） ----
  const helpBody = $('play-help-body');
  for (const [keys, desc] of [
    ['W A S D', '移动'],
    ['Shift', '跑步'],
    ['鼠标移动', '环顾四周（先点击画面锁定鼠标）'],
    ['E', '在摊位前取一份小吃'],
    ['F', '开吃，慢慢品尝'],
    ['R', '骑上 / 下共享自行车'],
    ['B', '打开 / 关闭寻味图鉴'],
    ['P', '暂停 / 继续'],
  ]) {
    const row = document.createElement('div');
    row.className = 'help-row';
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    const d = document.createElement('span');
    d.textContent = desc;
    row.append(kbd, d);
    helpBody.appendChild(row);
  }

  let msgTimer = 0;
  function message(text) {
    if (!text) return;
    msg.textContent = text;
    msg.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { msg.hidden = true; }, 3500);
  }

  let walk = null;
  bPause.addEventListener('click', () => {
    if (!walk) return;
    core.session.paused ? walk.resume() : walk.pause();
  });
  bView.addEventListener('click', () => { if (walk) walk.exit(); });
  bEnter.addEventListener('click', () => { if (walk) walk.enter(); });
  bAtlas.addEventListener('click', () => atlasOpener?.());
  $('p-reload').addEventListener('click', () => location.reload());
  bReset.addEventListener('click', () => {
    if (!state) return;
    state.reset();
  });

  // ---- 「操作」弹层：打开即暂停；关闭只解除弹层自己按下的那次暂停 ----
  let helpHeldPause = false;   // 这次打开是否由弹层按下的暂停
  let helpToken = null;
  const helpCoversGame = () => !document.body.classList.contains('play-viewing');
  function openHelp() {
    if (!helpEl.hidden) return;
    helpEl.hidden = false;
    bHelp.setAttribute('aria-expanded', 'true');
    $('p-help-close').focus({preventScroll:true});
    helpHeldPause = false;
    if (overlay) helpToken = overlay.open('help', { returnFocus: bHelp });
    else if (helpCoversGame() && walk && !core.session.paused) {
      walk.pause();
      helpHeldPause = true;
    }
  }
  function closeHelp() {
    if (helpEl.hidden) return;
    helpEl.hidden = true;
    bHelp.setAttribute('aria-expanded', 'false');
    if (helpToken) { helpToken.release(); helpToken = null; }
    else {
      bHelp.focus({preventScroll:true});
      if (helpHeldPause && walk && core.session.paused) walk.resume();
    }
    helpHeldPause = false;
  }
  bHelp.addEventListener('click', () => (helpEl.hidden ? openHelp() : closeHelp()));
  $('p-help-close').addEventListener('click', closeHelp);
  helpEl.addEventListener('click', (e) => { if (e.target === helpEl) closeHelp(); });

  window.addEventListener('keydown', e=>{if(helpEl.hidden||overlay?.isOpen('atlas'))return;if(e.code==='Tab'){e.preventDefault();$('p-help-close').focus();return;}if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeHelp();}else if(/^(Key[WASDPEFR]|Arrow|Shift|Space)/.test(e.code)){e.preventDefault();e.stopImmediatePropagation();}},true);

  // walk.js 的唯一模式通知点（按钮/enter/exit 都汇到 pb:mode）
  window.addEventListener('pb:mode', (e) => {
    const playing = e.detail?.mode === 'walk';
    document.body.classList.toggle('play-viewing', !playing);
    bEnter.hidden = playing;          // 游玩中不需要「回到游玩」
    goalBox.hidden = !playing;
    if (playing) message(core.session.paused ? '已暂停' : '');
  });

  // ---- 目标/集章（renderGoal 每帧被调：只在 tasted/complete/goal 变化时重建章与文案，
  //      每帧只更新距离文本；新章只加一次落章动画类，不因重建而重播） ----
  let goalBits = '', goalComplete = false, goalId = null;
  function buildStamps(foods, bits, newIds) {
    stampsBox.replaceChildren();
    foods.forEach((f, i) => {
      const s = document.createElement('span');
      s.className = 'stamp'
        + (bits[i] === '1' ? ' full' : '')
        + (newIds.includes(f.id) ? ' just' : '');
      s.title = f.labelZh;
      s.innerHTML = svgFor(f.id);
      stampsBox.appendChild(s);
    });
  }
  function renderGoal(st) {
    if (!st) return;
    goalBox.hidden = false;
    const foods = st.foods;
    const bits = foods.map((f) => (st.tasted.has(f.id) ? '1' : '0')).join('');
    const complete = !!st.complete;
    const gid = st.goal?.id ?? null;
    if (bits !== goalBits || complete !== goalComplete) {
      const newIds = [];
      foods.forEach((f, i) => {
        if (goalBits && bits[i] === '1' && goalBits[i] !== '1') newIds.push(f.id);
      });
      buildStamps(foods, bits, newIds);
      const n = foods.filter((_, i) => bits[i] === '1').length;
      goalCount.textContent = `已尝 ${n}/${foods.length}`;
      if (complete) {
        goalNext.textContent = `已尝齐 ${foods.length} 味！这条街你吃遍了`;
        goalDist.textContent = '';
      } else if (st.goal) {
        goalNext.textContent = `下一味：${st.goal.labelZh}（${st.goal.stallLabelZh}）`;
      }
      goalBits = bits;
      goalComplete = complete;
    } else if (!complete && st.goal && gid !== goalId) {
      // 小地图改目标：只换下一味文案，不动章
      goalNext.textContent = `下一味：${st.goal.labelZh}（${st.goal.stallLabelZh}）`;
    }
    goalId = gid;
    if (!complete) {
      goalDist.textContent = Number.isFinite(st.distM) ? ` · ${Math.round(st.distM)}m` : '';
    }
  }

  // ---- 底部动态交互提示（状态机文案，install.js 每帧或事件时推入） ----
  // 开头单个 E/F/R 键以 <kbd> 渲染，其余一律 textContent（禁止未转义 HTML）
  let lastHint = null;
  function setHint(text) {
    const t = text ?? '';
    if (t === lastHint) return;
    lastHint = t;
    if (!t) { bottom.hidden = true; return; }
    const m = /^([EFR])\s([\s\S]*)$/.exec(t);
    if (m) {
      const k = document.createElement('kbd');
      k.textContent = m[1];
      bottom.replaceChildren(k, document.createTextNode(' ' + m[2]));
    } else {
      bottom.textContent = t;
    }
    bottom.hidden = false;
  }

  // ---- 交互状态卡（由 root 每帧接线；只渲染推入的值，不自己计时） ----
  let interacting = false, interactionIcon = null;
  function updateInteraction({ heldItem = null, eating = null, riding = false, paused = false, complete = false } = {}) {
    const eat = eating && eating.foodId ? eating : null;
    document.body.classList.toggle('play-eating',!!eat);
    root.classList.toggle('is-paused',paused);
    if (eat) {
      // 图标优先取正在吃的那味，退回手中那味；均为静态 SVG 常量
      const iconId = FOOD_SVG[eat.foodId] ? eat.foodId
        : (heldItem && FOOD_SVG[heldItem] ? heldItem : null);
      if (iconId && iconId !== interactionIcon) {piIcon.innerHTML = svgFor(iconId);interactionIcon=iconId;}
      const p = Number.isFinite(eat.elapsed) ? Math.min(1, Math.max(0, eat.elapsed / EAT_SECONDS)) : 0;
      piFill.style.width = `${(p * 100).toFixed(1)}%`;
      if (!interacting) { interacting = true; interactBox.hidden = false; }
    } else if (interacting) {
      interacting = false;
      interactBox.hidden = true;
    }
    // heldItem / riding / paused / complete 目前只影响上方提示与手账；暂停时
    // root 不再推进 eating.elapsed，这里只渲染推入值，进度条自然冻结。
  }

  let lastPaused = null;
  return {
    bind({ walk: w }) { walk = w; },
    bindAtlas(open) { atlasOpener = open; bAtlas.disabled = !open; },
    closeHelp,
    setTripResetReady(ready) {
      bReset.disabled = !ready;
      bReset.title = ready ? '重置行程，保留图鉴收藏' : '散步记录准备中';
    },
    setPaused(paused) {
      if (paused === lastPaused) return;
      lastPaused = paused;
      bPause.textContent = paused ? '继续' : '暂停';
      bPause.classList.toggle('active', paused);
      hintEl.textContent = paused
        ? '已暂停 · 点「继续」或点击画面恢复'
        : 'WASD 走动 · Shift 小跑 · P 暂停';
    },
    message,
    setHint,
    renderGoal,
    updateInteraction,
    assetsReady() {
      // R1：面向玩家的措辞，不显示 raw actorId / 技术词
      message('灰猫准备好了，去找下一味吧');
    },
    showAssetError(text) {
      errText.textContent = text;   // 中文可恢复说明（install.js 组装）
      errBox.hidden = false;
      hintEl.textContent = '角色未加载：本次不能进入游玩模式';
    },
  };
}
