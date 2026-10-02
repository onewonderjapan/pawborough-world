// M07: Overlay controller unit tests
// Contract verification for modal pausing, focus ownership, nested stacking, and input clearing.
// Run: node tests/play_overlay_controller.test.mjs
import { createOverlayController } from '../scene-authoring/yuyuan-area/web/play/overlay-controller.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

// 模拟纯回调环境
function makeHarness(initialState = { mode: 'play', paused: false, pausedReason: null, focused: true }) {
  const state = { ...initialState };
  const calls = {
    pause: [],
    resume: [],
    clearInput: 0,
  };

  const controller = createOverlayController({
    captureState: () => ({ ...state }),
    pause: (reason) => {
      calls.pause.push(reason);
      state.paused = true;
      state.pausedReason = reason;
    },
    resume: (reason) => {
      calls.resume.push(reason);
      state.paused = false;
      state.pausedReason = null;
    },
    clearInput: () => {
      calls.clearInput += 1;
    },
    isFocused: () => state.focused,
  });

  return { controller, state, calls };
}

// ==========================================
// 1. Prior unpaused play mode: captures ownership and resumes on close
// ==========================================
{
  const { controller, state, calls } = makeHarness({ mode: 'play', paused: false, pausedReason: null, focused: true });

  check('初始未打开任何模态', controller.isOpen() === false);

  const focusTarget = { isConnected: true, focused: false, focus() { this.focused = true; } };
  const token = controller.open('atlas', { returnFocus: focusTarget });

  check('open 返回有效 token', token && token.id === 'atlas' && typeof token.release === 'function');
  check('atlas 状态为 open', controller.isOpen('atlas') === true && controller.isOpen() === true);
  check('拥有暂停所有权并触发 pause', calls.pause.length === 1 && calls.pause[0] === 'overlay');
  check('打开时触发 clearInput 清理按键积压', calls.clearInput === 1);
  check('世界状态被置为 paused', state.paused === true);

  // 关闭
  token.release();
  check('关闭后 isOpen 为 false', controller.isOpen() === false);
  check('拥有所有权且模式未变时触发 resume', calls.resume.length === 1 && calls.resume[0] === 'overlay');
  check('关闭时再次触发 clearInput', calls.clearInput === 2);
  check('世界状态恢复未暂停', state.paused === false);
  check('焦点正确返回原元素', focusTarget.focused === true);
}

// ==========================================
// 2. Prior paused / orbit mode: NEVER unpauses game
// ==========================================
{
  // 场景 A: 原本已经因其他原因暂停（例如主菜单或调试器）
  const harnessA = makeHarness({ mode: 'play', paused: true, pausedReason: 'menu', focused: true });
  const tokenA = harnessA.controller.open('atlas');
  check('已暂停状态下打开不重复调用 pause', harnessA.calls.pause.length === 0);
  tokenA.release();
  check('原本已暂停状态在模态关闭后决不恢复(resume 不被调用)', harnessA.calls.resume.length === 0);
  check('状态依然保持暂停', harnessA.state.paused === true);

  // 场景 B: 原本处于 orbit 观察模式
  const harnessB = makeHarness({ mode: 'orbit', paused: false, pausedReason: null, focused: true });
  const tokenB = harnessB.controller.open('atlas');
  check('orbit 模式下打开不抢占 pause 所有权', harnessB.calls.pause.length === 0);
  tokenB.release();
  check('orbit 模式下关闭决不擅自调用 resume', harnessB.calls.resume.length === 0);
}

// ==========================================
// 3. Duplicate ID does not stack
// ==========================================
{
  const { controller, calls } = makeHarness({ mode: 'play', paused: false, pausedReason: null, focused: true });

  const token1 = controller.open('atlas');
  const token2 = controller.open('atlas');

  check('相同 ID 打开返回同一 token 或幂等引用', token1.id === token2.id);
  check('相同 ID 不重复调用 pause', calls.pause.length === 1);

  // 一次 release 即关闭
  token1.release();
  check('release 后模态已关闭', controller.isOpen('atlas') === false);
  check('resume 正常触发一次', calls.resume.length === 1);

  // 再次 release 是幂等安全操作
  token2.release();
  check('重复 release 不会产生多次 resume', calls.resume.length === 1);
}

// ==========================================
// 4. Nested overlays & out-of-order release
// ==========================================
{
  const { controller, calls, state } = makeHarness({ mode: 'play', paused: false, pausedReason: null, focused: true });

  const tokenHelp = controller.open('help');
  check('打开 help 模态，触发 pause', calls.pause.length === 1);

  const tokenAtlas = controller.open('atlas');
  check('嵌套打开 atlas，不重复 pause', calls.pause.length === 1);
  check('两者均处于 open 状态', controller.isOpen('help') && controller.isOpen('atlas'));

  // 乱序释放：先关 help，后关 atlas
  tokenHelp.release();
  check('关闭外层 help 后 atlas 仍在打开', controller.isOpen('atlas') === true && controller.isOpen('help') === false);
  check('仍有活跃模态时绝不提前 resume', calls.resume.length === 0);
  check('状态维持暂停', state.paused === true);

  // 最后释放 atlas
  tokenAtlas.release();
  check('全部关闭后控制器 isOpen 为 false', controller.isOpen() === false);
  check('最后一个模态关闭才触发 resume', calls.resume.length === 1);
  check('状态恢复', state.paused === false);
}

// ==========================================
// 5. Focus lost or external pause interruption
// ==========================================
{
  // 场景 A: 关闭时窗口失焦
  const harnessA = makeHarness({ mode: 'play', paused: false, pausedReason: null, focused: true });
  const tokenA = harnessA.controller.open('atlas');
  harnessA.state.focused = false; // 用户切屏/失焦
  tokenA.release();
  check('窗口失焦时关闭模态不恢复运行', harnessA.calls.resume.length === 0);

  // 场景 B: 模态开启期间，外部将暂停原因修改为非 overlay（如网络中断/调试菜单）
  const harnessB = makeHarness({ mode: 'play', paused: false, pausedReason: null, focused: true });
  const tokenB = harnessB.controller.open('atlas');
  harnessB.state.pausedReason = 'external-error';
  tokenB.release();
  check('外部暂停介入后关闭模态不强行恢复', harnessB.calls.resume.length === 0);

  // 场景 C: 模式在开启期间被改变（例如切到 orbit）
  const harnessC = makeHarness({ mode: 'play', paused: false, pausedReason: null, focused: true });
  const tokenC = harnessC.controller.open('atlas');
  harnessC.state.mode = 'orbit';
  tokenC.release();
  check('模式发生改变时关闭模态不恢复', harnessC.calls.resume.length === 0);
}

// ==========================================
// 6. Idempotent close and dispose
// ==========================================
{
  const { controller, calls } = makeHarness();

  check('关闭不存在的 ID 返回 false 且不报错', controller.close('non-existent') === false);

  controller.open('test');
  check('打开后 isOpen 为 true', controller.isOpen('test') === true);

  controller.dispose();
  check('dispose 后 isOpen 为 false', controller.isOpen() === false);

  // dispose 之后的操作安全忽略
  controller.close('test');
  const afterToken = controller.open('test2');
  check('dispose 之后 open 返回 null', afterToken === null);
  controller.dispose(); // 重复 dispose 安全
}

console.log(`\nplay_overlay_controller tests completed: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
