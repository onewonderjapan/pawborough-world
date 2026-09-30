// wave14-lantern：夜间最终画面判据（R0 审查：不能只验底色；R1 审查：取样区须来自几何/对象身份并排除前景）。
// 输入：夜间特写 PNG + 冻结掩膜 JSON（scripts/lantern-night-evidence.mjs 产出）。
// 掩膜 = 该机位下「灯笼纸壳是最前表面」的像素（对象身份 ID 渲染，与颜色无关；灯笼骨架/盖与前景物均不在掩膜内）。
//   结构断言（掩膜本身有效）：
//     M1 画幅一致；M2 掩膜像素复算 = 记录值且 ≥ minPixels；M3 掩膜全部落在 region 内且 region 距画边 ≥ 8 px；
//     M4 region 内前景遮挡率（非灯笼物体挡住灯笼剪影的比例）≤ occlusionMax（1%）。
//   颜色判据（掩膜内全部像素）：
//     P1 亮占比：V ≥ 0.30 的像素 ≥ 60%（灯亮着；夜景暗墙/地面 V≈0.1–0.25）
//     P2 色相：亮像素中位 hue ∈ [−15°, 35°]（红—橙红；纸红 #c8301f ≈ 6°，lantern 组暖光 #ff7a3c ≈ 20°）
//     P3 饱和度：亮像素中位 S ≥ 0.45（R0 粉白实测 0.11–0.27；白天同灯正红 ≈ 0.9）
//     P4 近白占比：S < 0.25 且 V ≥ 0.80 的像素 ≤ 30%（粉白/白化的直接口径；不再用 max(R,G,B)≥0.995 冒充"白"）
//     P5 分段近白：掩膜按高度三等分，每段近白占比 ≤ 30%（R2 实测修复前下段 70% 而整体仅 22%，整体口径拦不住局部白化）
//   阈值沿用 R1 预先写定的数值（P4 改口径不改上限），不按 R2 的新图调整。
// 用法: node tests/lantern-night-pixel-check.mjs <closeup-night.png> <lantern-mask.json>
import fs from 'node:fs';
import { decodePng } from './png-lib.mjs';

const NIGHT = { litGate: 0.30, litFracMin: 0.60, hueMin: -15, hueMax: 35, satMin: 0.45, whiteSatMax: 0.25, whiteValMin: 0.80, whiteFracMax: 0.30 };

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  if (h > 180) h -= 360;          // 红色两侧连续：品红侧记负角
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

const [pngPath, maskPath] = process.argv.slice(2);
if (!pngPath || !maskPath) { console.error('usage: node tests/lantern-night-pixel-check.mjs <closeup-night.png> <lantern-mask.json>'); process.exit(2); }
const M = JSON.parse(fs.readFileSync(maskPath, 'utf8'));
const img = decodePng(fs.readFileSync(pngPath));
const fails = [];
const ok = (cond, name, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!cond) fails.push(name); };

const [W, H] = M.camera.canvas;
const [rx0, ry0, rx1, ry1] = M.visibility.region;
console.log(`lantern-night-pixel: ${pngPath}`);
ok(img.w === W && img.h === H, 'M1 画幅一致', `png ${img.w}x${img.h} vs mask ${W}x${H}`);
const px = [], rowOf = [];
let outside = 0;
for (const [y, runs] of M.mask.rle.rows) for (let i = 0; i < runs.length; i += 2) for (let x = runs[i]; x <= runs[i + 1]; x++) {
  if (x < rx0 || x > rx1 || y < ry0 || y > ry1) outside++;
  const k = (y * img.w + x) * 4;
  px.push(hsv(img.data[k], img.data[k + 1], img.data[k + 2]));
  rowOf.push(y);
}
ok(px.length === M.mask.pixelCount && px.length >= M.mask.minPixels, 'M2 掩膜像素数', `${px.length}（记录 ${M.mask.pixelCount}，下限 ${M.mask.minPixels}）`);
const margin = Math.min(rx0, ry0, W - 1 - rx1, H - 1 - ry1);
ok(outside === 0 && margin >= 8, 'M3 掩膜在 region 内、region 距画边 ≥ 8px', `outside=${outside} margin=${margin}`);
ok(M.visibility.foregroundOcclusion <= M.visibility.occlusionMax, 'M4 前景遮挡率', `${(M.visibility.foregroundOcclusion * 100).toFixed(2)}% ≤ ${M.visibility.occlusionMax * 100}%`);

const isWhite = (p) => p.s < NIGHT.whiteSatMax && p.v >= NIGHT.whiteValMin;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const lit = px.filter(p => p.v >= NIGHT.litGate);
const litFrac = lit.length / (px.length || 1);
const hueMed = lit.length ? med(lit.map(p => p.h)) : NaN, satMed = lit.length ? med(lit.map(p => p.s)) : NaN;
const whiteFrac = px.filter(isWhite).length / (px.length || 1);
ok(litFrac >= NIGHT.litFracMin, 'P1 亮占比（灯亮着）', `${(litFrac * 100).toFixed(1)}% ≥ ${NIGHT.litFracMin * 100}%`);
ok(hueMed >= NIGHT.hueMin && hueMed <= NIGHT.hueMax, 'P2 色相红—橙红', `hueMed=${hueMed.toFixed(1)}° ∈ [${NIGHT.hueMin}°, ${NIGHT.hueMax}°]`);
ok(satMed >= NIGHT.satMin, 'P3 饱和度', `satMed=${satMed.toFixed(2)} ≥ ${NIGHT.satMin}`);
ok(whiteFrac <= NIGHT.whiteFracMax, 'P4 近白占比（粉白）', `${(whiteFrac * 100).toFixed(1)}% ≤ ${NIGHT.whiteFracMax * 100}%`);
// P5：掩膜按高度三等分，逐段近白占比（定位并拦住局部白化）
const yMin = M.mask.rle.rows[0][0], yMax = M.mask.rle.rows[M.mask.rle.rows.length - 1][0], band = (y) => Math.min(2, Math.floor((y - yMin) / ((yMax - yMin + 1) / 3)));
let worstBand = 0;
for (let b = 0; b < 3; b++) {
  const a = px.filter((_, i) => band(rowOf[i]) === b);
  const wf = a.filter(isWhite).length / (a.length || 1);
  worstBand = Math.max(worstBand, wf);
  console.log(`  info ${['上', '中', '下'][b]}段: n=${a.length} satMed=${med(a.map(p => p.s)).toFixed(2)} 近白=${(wf * 100).toFixed(1)}%`);
}
ok(worstBand <= NIGHT.whiteFracMax, 'P5 分段近白（最差一段）', `${(worstBand * 100).toFixed(1)}% ≤ ${NIGHT.whiteFracMax * 100}%`);
console.log(`lantern-night-pixel: ${9 - fails.length} pass, ${fails.length} fail`);
if (fails.length) { console.log('FAILURES: ' + fails.join(' | ')); process.exit(1); }
