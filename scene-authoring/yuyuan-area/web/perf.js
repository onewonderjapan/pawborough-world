// M4: ?perf=1 性能采样 —— 首次加载完成时间 + 60s 轨道 / 60s 巡游步行（CruiseDriver）
// 的帧时 P50/P95 + performance.memory（若可用）+ GPU 字符串；结束在页面显示结果
// 并提供「复制 JSON」。数字只反映当前环境（swiftshader 下不代表真实性能），
// 采样方法见 docs/PERF-W2.md。位置/路线全部来自运行时产物（commercial-route.json）。
import { CruiseDriver } from '/vendor-src/player/cruise.js';

const ORBIT_SECONDS = 60, WALK_SECONDS = 60;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return +sorted[i].toFixed(2);
}
function stats(frames) {
  if (!frames.length) return { frames: 0 };
  const s = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return {
    frames: frames.length,
    p50Ms: percentile(s, 50), p95Ms: percentile(s, 95),
    meanMs: +mean.toFixed(2), minMs: +s[0].toFixed(2), maxMs: +s[s.length - 1].toFixed(2),
    fpsP50: +(1000 / percentile(s, 50)).toFixed(1),
  };
}
function memory() {
  const m = performance.memory;
  return m ? { usedJSHeapMB: +(m.usedJSHeapSize / 1048576).toFixed(1), totalJSHeapMB: +(m.totalJSHeapSize / 1048576).toFixed(1), jsHeapLimitMB: +(m.jsHeapSizeLimit / 1048576).toFixed(0) } : null;
}
function gpuInfo(renderer) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
    webglVersion: String(gl.getParameter(gl.VERSION)),
  };
}

export function setupPerf({ renderer, camera, controls, walk, hud }) {
  const params = new URLSearchParams(location.search);
  if (params.get('perf') !== '1') return null;

  let phase = 'wait-load';   // wait-load -> orbit -> walk -> done
  let frames = [];           // 当前阶段的帧间隔采样
  let lastFrame = null;
  let phaseEndsAt = 0;
  let loadedResolve = null;
  const loaded = new Promise((r) => { loadedResolve = r; });
  let driver = null, orbitAngle = 0, orbitBase = null;
  const report = {
    kind: 'pawborough-perf-sample', protocol: 'M4/2026-09-25',
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    note: '帧时为 rAF 间隔（含 vsync/合成）；swiftshader 或转发环境下不代表真实性能',
  };

  function setPhase(p, seconds) {
    phase = p;
    frames = []; lastFrame = null;
    phaseEndsAt = performance.now() + seconds * 1000;
    report[p === 'orbit' ? 'orbitStartedAt' : 'walkStartedAt'] = new Date().toISOString();
  }

  async function start() {
    await loaded;
    report.loadCompleteMs = +(performance.now()).toFixed(0); // 自导航起的首次加载完成耗时
    report.memory = memory();
    report.gpu = gpuInfo(renderer);
    renderer.info.autoReset = false;
    // 一帧后取 drawCalls/triangles（autoReset 关闭时为累计值，先 reset 再渲染一帧）
    renderer.info.reset();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    report.renderer = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? null };
    renderer.info.autoReset = true;
    setPhase('orbit', ORBIT_SECONDS);
    orbitBase = { target: controls.target.clone(), pos: camera.position.clone() };
    orbitAngle = Math.atan2(orbitBase.pos.z - orbitBase.target.z, orbitBase.pos.x - orbitBase.target.x);
    if (hud) hud('性能采样：轨道 60s …（期间不要操作页面）');
    // 巡游步行不在这里发起 —— 轨道满 60s 后由 tick() 进入 cruiseWalk
  }

  // 巡游步行：进步行模式 -> CruiseDriver 沿 commercial-route 最长路线走 60s
  async function cruiseWalk() {
    if (!window.__walk) throw new Error('walk hooks missing');
    const routes = (await fetch('/out/commercial-route.json').then((r) => { if (!r.ok) throw new Error('commercial-route.json ' + r.status); return r.json(); })).routes;
    const len = (r) => r.points.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - r.points[i - 1][0], p[1] - r.points[i - 1][1]) : 0), 0);
    const route = routes.filter((r) => r.from === 'main').sort((a, b) => len(b) - len(a))[0] || routes.sort((a, b) => len(b) - len(a))[0];
    if (!route) throw new Error('no commercial routes');
    report.walkRoute = `${route.from}->${route.to}`;
    await window.__walk.enter();
    // 等控制器就绪（enter 内部懒构建物理）
    const t0 = performance.now();
    while (!window.__walk.controller && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 200));
    const controller = window.__walk.controller;
    if (!controller) throw new Error('walk controller not ready');
    driver = new CruiseDriver({ controller, waypoints: route.points, reachRadius: 0.9, timeoutSteps: 60 * (WALK_SECONDS + 30) });
    setPhase('walk', WALK_SECONDS);
    if (hud) hud(`性能采样：步行巡游 60s（${report.walkRoute}）…`);
  }

  // 主循环每帧调用（main.js 的 setAnimationLoop 里在 walk.tick 之前）
  function tick() {
    const now = performance.now();
    if (lastFrame !== null && (phase === 'orbit' || phase === 'walk')) frames.push(now - lastFrame);
    lastFrame = now;
    if (phase === 'orbit') {
      const dt = 1 / 60; // 旋转速度按标称帧长计，只影响取景速度不影响帧时采样
      orbitAngle += dt * 0.12;
      const r = Math.hypot(orbitBase.pos.x - orbitBase.target.x, orbitBase.pos.z - orbitBase.target.z);
      const h = orbitBase.pos.y - orbitBase.target.y;
      camera.position.set(orbitBase.target.x + Math.cos(orbitAngle) * r, orbitBase.target.y + h, orbitBase.target.z + Math.sin(orbitAngle) * r);
      controls.update();
    } else if (phase === 'walk' && driver) {
      driver.tick(1 / 60);
    }
    if ((phase === 'orbit' || phase === 'walk') && now >= phaseEndsAt) {
      report[phase] = { seconds: phase === 'orbit' ? ORBIT_SECONDS : WALK_SECONDS, ...stats(frames), memoryAfter: memory() };
      if (phase === 'walk') finish();
      else {
        phase = 'transit'; // 巡游准备期（物理构建）不计时；cruiseWalk 内 setPhase('walk') 恢复
        cruiseWalk().catch((e) => { report.walkError = String(e && e.message || e); finish(); });
      }
    }
  }

  function finish() {
    phase = 'done';
    window.__walk?.exit?.();
    report.finishedAt = new Date().toISOString();
    report.memoryEnd = memory();
    show(report);
    if (hud) hud('性能采样完成 —— 结果见右下面板');
  }

  function show(report) {
    const el = document.createElement('div');
    el.id = 'perf-panel';
    el.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99;max-width:520px;max-height:60vh;overflow:auto;'
      + 'background:rgba(20,24,28,.92);color:#dfe8ec;font:12px/1.5 monospace;padding:12px;border-radius:8px;box-shadow:0 2px 12px #0008;white-space:pre;';
    el.textContent = JSON.stringify(report, null, 1);
    const btn = document.createElement('button');
    btn.textContent = '复制 JSON';
    btn.style.cssText = 'margin-bottom:8px;padding:4px 12px;cursor:pointer;';
    btn.onclick = async () => {
      const text = JSON.stringify(report, null, 1);
      try { await navigator.clipboard.writeText(text); btn.textContent = '已复制 ✓'; }
      catch {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); btn.textContent = '已复制 ✓（fallback）';
      }
      setTimeout(() => { btn.textContent = '复制 JSON'; }, 2000);
    };
    el.prepend(btn);
    document.body.appendChild(el);
  }

  window.__perfResult = () => (phase === 'done' ? report : null);
  return {
    tick,
    markLoaded: () => { if (loadedResolve) { loadedResolve(); loadedResolve = null; } },
    start,
  };
}
