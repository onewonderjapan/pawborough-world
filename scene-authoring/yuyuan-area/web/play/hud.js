// Play-mode HUD: WASD/视角/暂停提示 + 暂停/继续/取景/回到游玩 buttons +
// a Chinese recoverable asset-failure panel. Owns all DOM for play mode;
// runs only on ?play=1 pages (called from web/play/install.js).
export function installPlayHud({ core }) {
  document.body.classList.add('play-mode');
  // 调试三排按钮 / 统计浮层在 play 页隐藏（默认 viewer 页不受影响）
  for (const id of ['bar', 'hud']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  const root = document.createElement('div');
  root.id = 'play-hud';
  root.innerHTML = `
    <div id="play-hint">WASD 移动 · 鼠标控制视角 · P 暂停 · 点击画面锁定鼠标</div>
    <div id="play-actions">
      <button type="button" id="p-pause">暂停</button>
      <button type="button" id="p-view">取景</button>
      <button type="button" id="p-enter" hidden>回到游玩</button>
    </div>
    <div id="play-msg" hidden></div>
    <div id="play-asset-error" role="alert" hidden>
      <p id="play-asset-error-text"></p>
      <button type="button" id="p-reload">重新加载</button>
    </div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const bPause = $('p-pause'), bView = $('p-view'), bEnter = $('p-enter');
  const msg = $('play-msg'), errBox = $('play-asset-error'), errText = $('play-asset-error-text');

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

  // walk.js 的唯一模式通知点（按钮/enter/exit 都汇到 pb:mode）
  window.addEventListener('pb:mode', (e) => {
    const playing = e.detail?.mode === 'walk';
    bEnter.hidden = playing;          // 游玩中不需要「回到游玩」
    if (playing) message(core.session.paused ? '已暂停' : '');
  });

  let lastPaused = null;
  return {
    bind({ walk: w }) { walk = w; },
    setPaused(paused) {
      if (paused === lastPaused) return;
      lastPaused = paused;
      bPause.textContent = paused ? '继续' : '暂停';
      bPause.classList.toggle('active', paused);
      $('play-hint').textContent = paused
        ? '已暂停（继续 / 点击画面恢复）· 取景可环顾全园'
        : 'WASD 移动 · 鼠标控制视角 · P 暂停 · 点击画面锁定鼠标';
    },
    message,
    assetsReady() {
      // R1：面向玩家的措辞，不显示 raw actorId / 技术词
      message('灰猫准备好了');
    },
    showAssetError(text) {
      errText.textContent = text;   // 中文可恢复说明（install.js 组装）
      errBox.hidden = false;
      $('play-hint').textContent = '角色未加载：本次不能进入游玩模式';
    },
  };
}
