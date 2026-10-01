// Play-mode HUD（小吃工单 20261001 扩展）：
//   左上：紧凑目标「尝遍三味」+ 0-3 集章（朱红小圆章）
//   右上：小地图（DOM 在 web/play/minimap.js，本文件只留位置协调）
//   底部：动态交互提示（靠近摊位 E / F 吃 / R 上下车 / 距离提示等）
//   以及暂停/继续/取景/回到游玩、新散步（重置本游戏进度）、中文可恢复资产失败面板。
// HUD 拥有 play 模式全部 DOM；状态一律来自 state.js（HUD 只展示）。
export function installPlayHud({ core, state = null }) {
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
      <div id="play-goal-title">目标 · 尝遍三味</div>
      <div id="play-goal-sub"></div>
      <div id="play-stamps"></div>
    </div>
    <div id="play-hint">WASD 移动 · Shift 跑 · 鼠标视角 · P 暂停 · 点击画面锁定鼠标</div>
    <div id="play-bottom" hidden></div>
    <div id="play-actions">
      <button type="button" id="p-pause">暂停</button>
      <button type="button" id="p-view">取景</button>
      <button type="button" id="p-enter" hidden>回到游玩</button>
      <button type="button" id="p-reset" title="清空本游戏集章/手中食物/自行车进度">新散步</button>
    </div>
    <div id="play-msg" hidden></div>
    <div id="play-asset-error" role="alert" hidden>
      <p id="play-asset-error-text"></p>
      <button type="button" id="p-reload">重新加载</button>
    </div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const bPause = $('p-pause'), bView = $('p-view'), bEnter = $('p-enter'), bReset = $('p-reset');
  const msg = $('play-msg'), errBox = $('play-asset-error'), errText = $('play-asset-error-text');
  const goalBox = $('play-goal'), goalSub = $('play-goal-sub'), stampsBox = $('play-stamps');
  const bottom = $('play-bottom');

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
  $('p-reload').addEventListener('click', () => location.reload());
  bReset.addEventListener('click', () => {
    if (!state) return;
    // 明确重置入口：只清本游戏进度，二次确认避免误触
    if (!bReset.dataset.confirm) {
      bReset.dataset.confirm = '1';
      bReset.textContent = '确认新散步？';
      setTimeout(() => { delete bReset.dataset.confirm; bReset.textContent = '新散步'; }, 4000);
      return;
    }
    delete bReset.dataset.confirm;
    bReset.textContent = '新散步';
    state.reset({ storage: window.localStorage });
    message('已开始新散步（集章与进度已清空）');
  });

  // walk.js 的唯一模式通知点（按钮/enter/exit 都汇到 pb:mode）
  window.addEventListener('pb:mode', (e) => {
    const playing = e.detail?.mode === 'walk';
    document.body.classList.toggle('play-viewing', !playing);
    bEnter.hidden = playing;          // 游玩中不需要「回到游玩」
    goalBox.hidden = !playing;
    if (playing) message(core.session.paused ? '已暂停' : '');
  });

  // ---- 目标/集章 ----
  function renderGoal(st) {
    if (!st) return;
    goalBox.hidden = false;
    if (st.complete) {
      goalSub.textContent = '三味集齐！这条街你吃遍了 🎉';
      stampsBox.innerHTML = st.foods.map(() => '<span class="stamp full">✓</span>').join('');
      return;
    }
    const dist = Number.isFinite(st.distM) ? ` · ${Math.round(st.distM)}m` : '';
    goalSub.textContent = `下一味：${st.goal.labelZh}（${st.goal.stallLabelZh}）${dist}`;
    stampsBox.innerHTML = st.foods.map((f) =>
      `<span class="stamp ${st.tasted.has(f.id) ? 'full' : ''}" title="${f.labelZh}">${f.labelZh[0]}</span>`).join('');
  }

  // ---- 底部动态交互提示（状态机文案，install.js 每帧或事件时推入） ----
  let lastHint = '';
  function setHint(text) {
    if (text === lastHint) return;
    lastHint = text;
    if (!text) { bottom.hidden = true; return; }
    bottom.textContent = text;
    bottom.hidden = false;
  }

  let lastPaused = null;
  return {
    bind({ walk: w }) { walk = w; },
    setPaused(paused) {
      if (paused === lastPaused) return;
      lastPaused = paused;
      bPause.textContent = paused ? '继续' : '暂停';
      bPause.classList.toggle('active', paused);
      $('play-hint').textContent = paused
        ? '已暂停（继续 / 点击画面恢复）· 取景可环顾全街'
        : 'WASD 移动 · Shift 跑 · 鼠标视角 · P 暂停 · 点击画面锁定鼠标';
    },
    message,
    setHint,
    renderGoal,
    assetsReady() {
      // R1：面向玩家的措辞，不显示 raw actorId / 技术词
      message('灰猫准备好了，去尝遍三味吧');
    },
    showAssetError(text) {
      errText.textContent = text;   // 中文可恢复说明（install.js 组装）
      errBox.hidden = false;
      $('play-hint').textContent = '角色未加载：本次不能进入游玩模式';
    },
  };
}
