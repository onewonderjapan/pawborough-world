// wave4-drawcalls 浏览器检查共用件：WebGL 绘制调用独立计数（页面启动前注入）、一帧计数、canvas 逐像素差异。
// 使用者：tests/perf-drawcalls-check.mjs、tests/batch-identity-check.mjs。
import fs from 'node:fs';
export const CH_TOL = 12;             // 单像素任一通道差 > 12/255 才算「不同」（抗锯齿 / 量化噪声以下不计）
export const EDGE_GRAD = 32;          // 改前图该像素与 8 邻域任一通道差 > 32/255 视为几何边缘（边缘抖动不计入口径）
export const PIX_MAX = 0.01;          // 非边缘差异像素占比上限

// ---------- 页面启动前注入：WebGL 绘制调用独立计数 ----------
export function glCounterInit() {
  const c = { api: 0, sub: 0, tris: 0 };
  const TRI = 0x0004;
  const add = (mode, n, inst = 1) => { if (mode === TRI) c.tris += (n / 3) * inst; };
  const wrapMulti = (e) => {
    if (!e || e.__glcWrapped) return e;
    e.__glcWrapped = true;
    const mde = e.multiDrawElementsWEBGL?.bind(e), mda = e.multiDrawArraysWEBGL?.bind(e);
    const mdei = e.multiDrawElementsInstancedWEBGL?.bind(e), mdai = e.multiDrawArraysInstancedWEBGL?.bind(e);
    if (mde) e.multiDrawElementsWEBGL = (m, counts, co, type, offs, oo, n) => { c.api++; c.sub += n; for (let i = 0; i < n; i++) add(m, counts[co + i]); return mde(m, counts, co, type, offs, oo, n); };
    if (mda) e.multiDrawArraysWEBGL = (m, firsts, fo, counts, co, n) => { c.api++; c.sub += n; for (let i = 0; i < n; i++) add(m, counts[co + i]); return mda(m, firsts, fo, counts, co, n); };
    if (mdei) e.multiDrawElementsInstancedWEBGL = (m, counts, co, type, offs, oo, inst, io, n) => { c.api++; c.sub += n; for (let i = 0; i < n; i++) add(m, counts[co + i], inst[io + i]); return mdei(m, counts, co, type, offs, oo, inst, io, n); };
    if (mdai) e.multiDrawArraysInstancedWEBGL = (m, firsts, fo, counts, co, inst, io, n) => { c.api++; c.sub += n; for (let i = 0; i < n; i++) add(m, counts[co + i], inst[io + i]); return mdai(m, firsts, fo, counts, co, inst, io, n); };
    return e;
  };
  const wrapCtx = (gl) => {
    if (!gl || gl.__glcWrapped) return gl;
    gl.__glcWrapped = true;
    const de = gl.drawElements.bind(gl), da = gl.drawArrays.bind(gl);
    gl.drawElements = (m, n, t, o) => { c.api++; c.sub++; add(m, n); return de(m, n, t, o); };
    gl.drawArrays = (m, f, n) => { c.api++; c.sub++; add(m, n); return da(m, f, n); };
    if (gl.drawElementsInstanced) { const f = gl.drawElementsInstanced.bind(gl); gl.drawElementsInstanced = (m, n, t, o, i) => { c.api++; c.sub++; add(m, n, i); return f(m, n, t, o, i); }; }
    if (gl.drawArraysInstanced) { const f = gl.drawArraysInstanced.bind(gl); gl.drawArraysInstanced = (m, a, n, i) => { c.api++; c.sub++; add(m, n, i); return f(m, a, n, i); }; }
    if (gl.drawRangeElements) { const f = gl.drawRangeElements.bind(gl); gl.drawRangeElements = (m, s, e, n, t, o) => { c.api++; c.sub++; add(m, n); return f(m, s, e, n, t, o); }; }
    const ge = gl.getExtension.bind(gl);
    gl.getExtension = (name) => { const e = ge(name); return name === 'WEBGL_multi_draw' ? wrapMulti(e) : e; };
    return gl;
  };
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const g = gc.call(this, type, attrs);
    return type === 'webgl2' || type === 'webgl' ? wrapCtx(g) : g;
  };
  // 每个 rAF 记一次增量：本回调先于 three 的 setAnimationLoop 注册，之后每帧顺序固定，
  // 相邻两次回调之间恰好是 three 的一次 renderer.render。
  const frames = [];
  let last = { api: 0, sub: 0, tris: 0 };
  const loop = () => {
    frames.push({ api: c.api - last.api, sub: c.sub - last.sub, tris: c.tris - last.tris });
    if (frames.length > 40) frames.shift();
    last = { ...c };
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__glc = c;
  window.__glFrames = frames;
}

export const settle = (page, n = 20) => page.evaluate((n) => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// 静止机位下取最近 10 帧中位数（并记录抖动范围）
export async function frameCounts(page) {
  await settle(page, 24);
  return page.evaluate(() => {
    const f = window.__glFrames.slice(-10);
    const med = (k) => { const s = f.map(x => x[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return {
      apiCalls: med('api'), subDraws: med('sub'), triangles: Math.round(med('tris')),
      apiRange: [Math.min(...f.map(x => x.api)), Math.max(...f.map(x => x.api))],
      multiDraw: !!document.createElement('canvas').getContext('webgl2')?.getExtension('WEBGL_multi_draw'),
      batch: window.__batchStats ? window.__batchStats() : null,
    };
  });
}
export const canvasPng = (page) => page.evaluate(() => document.querySelector('#app canvas').toDataURL('image/png'));
// 逐像素差异口径（在浏览器里解码比较，免依赖）：
//   diff    = 任一通道 |a-b| > CH_TOL 的像素；
//   edge    = diff 中「改前图该像素与 8 邻域任一通道差 > EDGE_GRAD」的像素（几何边缘抖动）；
//   share   = (diff − edge) / 总像素 —— 断言 < 1%；rawShare = diff / 总像素 只报告。
// 同时出差异图：非边缘差异 = 红，边缘抖动 = 黄，其余 = 改前图灰度 × 0.5。
export async function pixelDiff(page, aUrl, bUrl) {
  return page.evaluate(async ({ aUrl, bUrl, CH_TOL, EDGE_GRAD }) => {
    const load = async (u) => { const im = new Image(); im.src = u; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height); };
    const A = await load(aUrl), B = await load(bUrl);
    if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
    const w = A.width, h = A.height, a = A.data, b = B.data;
    const out = new ImageData(w, h);
    let diff = 0, edge = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      const g = (a[i] + a[i + 1] + a[i + 2]) / 6;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g; out.data[i + 3] = 255;
      if (d <= CH_TOL) continue;
      diff++;
      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 4;
        if (Math.max(Math.abs(a[i] - a[j]), Math.abs(a[i + 1] - a[j + 1]), Math.abs(a[i + 2] - a[j + 2])) > EDGE_GRAD) { isEdge = true; break; }
      }
      if (isEdge) { edge++; out.data[i] = 255; out.data[i + 1] = 210; out.data[i + 2] = 0; }
      else { out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; }
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(out, 0, 0);
    const n = w * h;
    return { share: +((diff - edge) / n).toFixed(5), rawShare: +(diff / n).toFixed(5), diffPixels: diff, edgePixels: edge, pixels: n, png: c.toDataURL('image/png') };
  }, { aUrl, bUrl, CH_TOL, EDGE_GRAD });
}
export const savePng = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

