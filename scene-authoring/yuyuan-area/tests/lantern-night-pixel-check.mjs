// wave14-lantern R1 必修1：夜间最终画面判据（REVIEW-astra：不能只验底色）。
// 对固定夜间机位的灯笼特写实拍（scripts/shoot-closeup-r1.mjs 产出 png + lantern-rect.json sidecar）做
// 灯身主体像素的色相/饱和度/削顶统计：
//   取样区 = sidecar rect 的中心 50%（1.35m 特写下灯身充满该区，四角墙体/天空被排除）
//   判据（阈值来源见 NIGHT 设计常量注释）：
//     P1 亮占比：rect 内 V≥litGate 的像素 ≥ 60%（灯亮着，不是黑壳/没导出）
//     P2 色相：亮像素中位 hue ∈ [0°, 35°]（红-橙红）
//     P3 饱和度：亮像素中位 S ≥ 0.45（R0 粉白失败实测 0.11–0.16 ↔ 白天同灯 0.91）
//     P4 削顶：亮像素中 V≥0.995 占比 ≤ 30%（大面积削顶白 = 过曝；R0 实测 ≈100%）
// 用法: node tests/lantern-night-pixel-check.mjs <closeup-night.png> <lantern-rect.json>
// 红证：R0 产物实拍（artifacts/r1/shots/before/lantern-closeup-night.png）必须 FAIL（red4 日志）。
import fs from 'node:fs';
import zlib from 'node:zlib';

const NIGHT = {
  innerFrac: 0.5,     // 中心占比子矩形：灯身主体（四角是背景墙/天）
  litGate: 0.30,      // 「亮」门槛 V：夜晚场景里可辨亮的物体（地面/暗墙 V≈0.1–0.25，实拍统计 2026-09-30）
  litFracMin: 0.60,   // 亮像素占比下限
  hueMax: 35,         // 红-橙红上限：设计纸红 #c8301f hue 6.0° 与组暖光 #ff7a3c hue 20° 的混合区间；白天同灯实拍 23.7°
  satMin: 0.45,       // 饱和度下限：R0 产物夜景实测失败 sMed 0.11–0.16（粉白）↔ 白天同灯实拍 0.91（正红）之间取判别线
  clipGate: 0.995,    // 削顶判定 V
  clipFracMax: 0.30,  // 削顶占比上限：R0 实测亮像素几乎 100% V=1.0（色调映射后仍白）；修复预测 ≈0%
};

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`unsupported PNG depth=${bitDepth} color=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(w * h * bpp), recon = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const x = raw[pos++];
      const a = i >= bpp ? recon[i - bpp] : 0, b = y > 0 ? out[(y - 1) * stride + i] : 0,
        c = (i >= bpp && y > 0) ? out[(y - 1) * stride + i - bpp] : 0;
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      recon[i] = v & 0xff;
    }
    recon.copy(out, y * stride);
  }
  return { w, h, data: out };
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

const [pngPath, rectPath] = process.argv.slice(2);
if (!pngPath || !rectPath) { console.error('usage: node lantern-night-pixel-check.mjs <closeup-night.png> <lantern-rect.json>'); process.exit(2); }
const sidecar = JSON.parse(fs.readFileSync(rectPath, 'utf8'));
const img = decodePng(fs.readFileSync(pngPath));
if (img.w !== sidecar.canvas[0] || img.h !== sidecar.canvas[1]) throw new Error(`canvas size mismatch: png ${img.w}x${img.h} vs sidecar ${sidecar.canvas}`);
const rect = sidecar.rect;
const bw = rect.x1 - rect.x0 + 1, bh = rect.y1 - rect.y0 + 1;
const ix0 = Math.round(rect.x0 + (bw - 1) * (1 - NIGHT.innerFrac) / 2), ix1 = Math.round(rect.x1 - (bw - 1) * (1 - NIGHT.innerFrac) / 2);
const iy0 = Math.round(rect.y0 + (bh - 1) * (1 - NIGHT.innerFrac) / 2), iy1 = Math.round(rect.y1 - (bh - 1) * (1 - NIGHT.innerFrac) / 2);
const lit = [];
let n = 0;
for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
  const k = (y * img.w + x) * 4;
  const { h, s, v } = rgbToHsv(img.data[k], img.data[k + 1], img.data[k + 2]);
  n++;
  if (v >= NIGHT.litGate) lit.push({ h, s, v });
}
const med = (arr, f) => {
  const a = arr.map(o => o[f]).sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const litFrac = lit.length / n;
const hueMed = med(lit, 'h'), satMed = med(lit, 's');
const clipFrac = lit.filter(o => o.v >= NIGHT.clipGate).length / (lit.length || 1);
const fails = [];
const ok = (cond, name, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!cond) fails.push(name); };
console.log(`lantern-night-pixel: ${pngPath}`);
console.log(`  rect=${JSON.stringify(rect)} inner50%=[${ix0},${iy0}..${ix1},${iy1}] n=${n} lit=${lit.length}`);
ok(litFrac >= NIGHT.litFracMin, 'P1 亮占比（灯亮着）', `litFrac=${(litFrac * 100).toFixed(1)}% ≥ ${NIGHT.litFracMin * 100}%`);
ok(hueMed >= 0 && hueMed <= NIGHT.hueMax, 'P2 色相红-橙红', `hueMed=${hueMed.toFixed(1)}° ≤ ${NIGHT.hueMax}°`);
ok(satMed >= NIGHT.satMin, 'P3 饱和度下限（粉白→红）', `satMed=${satMed.toFixed(2)} ≥ ${NIGHT.satMin}`);
ok(clipFrac <= NIGHT.clipFracMax, 'P4 削顶占比（过曝白）', `clipFrac=${(clipFrac * 100).toFixed(1)}% ≤ ${NIGHT.clipFracMax * 100}%`);
console.log(`lantern-night-pixel: ${4 - fails.length} pass, ${fails.length} fail`);
if (fails.length) { console.log('FAILURES: ' + fails.join(' | ')); process.exit(1); }
