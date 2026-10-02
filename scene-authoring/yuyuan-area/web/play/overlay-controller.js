// 纯逻辑模态覆盖层控制器 (M07: Overlay controller)
// 无 DOM / Three / Rapier 依赖，由外部回调管理实际世界状态。

/**
 * 创建模态覆盖层控制器
 * @param {object} options
 * @param {function(): { mode: 'play'|'orbit', paused: boolean, pausedReason: string|null, focused: boolean }} options.captureState
 * @param {function(string): void} options.pause
 * @param {function(string): void} options.resume
 * @param {function(): void} options.clearInput
 * @param {function(): boolean} [options.isFocused]
 * @returns {{ open: function, close: function, isOpen: function, dispose: function }}
 */
export function createOverlayController({
  captureState = null,
  pause = null,
  resume = null,
  clearInput = null,
  isFocused = null,
} = {}) {
  const activeOverlays = new Map(); // id -> token
  let priorState = null;
  let ownsPause = false;
  let originalReturnFocus = null;
  let disposed = false;

  function open(id, { returnFocus = null } = {}) {
    if (disposed) return null;
    if (typeof id !== 'string' || !id) {
      throw new Error('overlay id must be a non-empty string');
    }

    // 相同 ID 不重复压栈，返回既有稳定 token
    if (activeOverlays.has(id)) {
      return activeOverlays.get(id);
    }

    // 首个打开的模态负责捕获初始环境状态与焦点
    if (activeOverlays.size === 0) {
      const state = captureState ? captureState() : { mode: 'play', paused: false, pausedReason: null, focused: true };
      priorState = {
        mode: state?.mode ?? 'play',
        paused: Boolean(state?.paused),
        pausedReason: state?.pausedReason ?? null,
        focused: state?.focused !== false,
      };

      // 仅当原本处于未暂停的 play 模式时，覆盖层才接管 pause 所有权
      ownsPause = (!priorState.paused && priorState.mode === 'play');
      if (ownsPause && typeof pause === 'function') {
        pause('overlay');
      }

      if (returnFocus) {
        originalReturnFocus = returnFocus;
      }
    } else {
      // 嵌套模态：若尚未记录原焦点，记录一次
      if (!originalReturnFocus && returnFocus) {
        originalReturnFocus = returnFocus;
      }
    }

    // 打开时清空输入积压，防止黏键
    if (typeof clearInput === 'function') {
      clearInput();
    }

    const token = {
      id,
      release: () => close(id),
    };
    activeOverlays.set(id, token);
    return token;
  }

  function close(id) {
    if (disposed) return false;
    if (!activeOverlays.has(id)) {
      return false; // 幂等安全
    }

    activeOverlays.delete(id);

    // 关闭时清空输入积压
    if (typeof clearInput === 'function') {
      clearInput();
    }

    // 最后一个模态关闭时结算恢复逻辑
    if (activeOverlays.size === 0) {
      const current = captureState ? captureState() : null;
      const currentMode = current?.mode ?? priorState?.mode;
      const currentFocused = typeof isFocused === 'function' ? isFocused() : (current?.focused !== false);
      const currentPausedReason = current?.pausedReason ?? null;

      // 恢复条件约束：
      // 1. 本控制器拥有 pause 所有权
      // 2. 初始状态记录存在
      // 3. 游戏模式未发生变更 (依旧等于 priorState.mode)
      // 4. 当前窗口持有焦点
      // 5. 暂停原因仍为 overlay (若提供)；若被外部原因修改则不擅自恢复
      const shouldResume =
        ownsPause &&
        priorState &&
        currentMode === priorState.mode &&
        Boolean(currentFocused) &&
        (!currentPausedReason || currentPausedReason === 'overlay');

      if (shouldResume && typeof resume === 'function') {
        resume('overlay');
      }

      ownsPause = false;

      // 焦点安全返回原连接元素
      if (originalReturnFocus && typeof originalReturnFocus.focus === 'function') {
        try {
          if (originalReturnFocus.isConnected !== false) {
            originalReturnFocus.focus();
          }
        } catch (_e) {}
      }
      originalReturnFocus = null;
      priorState = null;
    }

    return true;
  }

  function isOpen(id) {
    if (disposed) return false;
    if (id !== undefined) {
      return activeOverlays.has(id);
    }
    return activeOverlays.size > 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (activeOverlays.size > 0) {
      activeOverlays.clear();
      if (typeof clearInput === 'function') {
        clearInput();
      }
    }
    ownsPause = false;
    originalReturnFocus = null;
    priorState = null;
  }

  return {
    open,
    close,
    isOpen,
    dispose,
  };
}
