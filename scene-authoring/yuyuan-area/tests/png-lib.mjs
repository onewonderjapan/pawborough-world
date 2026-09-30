// PNG 解码 / HSV 变换共用件（无依赖：zlib inflate + 逐行 unfilter）。
// 使用者：tests/lantern-night-pixel-check.mjs、scripts/lantern-mask-evidence-r2.mjs（R2 掩膜口径同一实现）。
import zlib from 'node:zlib';

export function decodePng(buf) {
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

export function rgbToHsv(r, g, b) {
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
