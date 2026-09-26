// wave9-sharedtex：GLB 贴图读写小工具（普查 scripts/texture-census.mjs、外置 scripts/share-textures.mjs、测试 tests/shared-texture-test.mjs 共用）。
// 只处理 glTF 2.0 GLB（JSON + 可选 BIN 块）；贴图可以是 bufferView 内嵌，也可以是相对 GLB 的 uri（外置文件）。
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';

export const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = null;
  const o = 20 + jsonLen;
  if (o + 8 <= buf.length && buf.readUInt32LE(o + 4) === 0x004e4942) bin = buf.subarray(o + 8, o + 8 + buf.readUInt32LE(o));
  return { json, bin, bytes: buf.length };
}

export function writeGlb(file, json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (js.length % 4)) % 4;
  js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
  const chunks = [Buffer.alloc(8), js];
  chunks[0].writeUInt32LE(js.length, 0); chunks[0].writeUInt32LE(0x4e4f534a, 4);
  if (bin && bin.length) {
    const bpad = (4 - (bin.length % 4)) % 4;
    const b = Buffer.concat([bin, Buffer.alloc(bpad, 0)]);
    const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(0x004e4942, 4);
    chunks.push(h, b);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
  const out = Buffer.concat([head, body]);
  fs.writeFileSync(file, out);
  return out;
}

// PNG / JPEG / KTX2 / WebP 头里读宽高（普查报告用；读不出返回 null）
export function imageDims(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1], len = b.readUInt16BE(i + 2);
      if ((mk >= 0xc0 && mk <= 0xc3) || (mk >= 0xc5 && mk <= 0xc7) || (mk >= 0xc9 && mk <= 0xcb) || (mk >= 0xcd && mk <= 0xcf)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 28 && b.subarray(1, 7).toString('latin1') === 'KTX 20') return [b.readUInt32LE(20), b.readUInt32LE(24)];
  if (b.length > 30 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    const k = b.subarray(12, 16).toString('latin1');
    if (k === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (k === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (k === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  }
  return null;
}

export const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/ktx2': 'ktx2', 'image/webp': 'webp' };

// 一个 GLB 里全部贴图的内容：[{index, name, mimeType, embedded, uri, bytes(Buffer)}]；外置 uri 相对 GLB 所在目录解析
export function glbImages(file, g = readGlb(file)) {
  const dir = path.dirname(file);
  return (g.json.images || []).map((im, index) => {
    let bytes = null, embedded = false;
    if (im.bufferView !== undefined) {
      const bv = g.json.bufferViews[im.bufferView];
      bytes = g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      embedded = true;
    } else if (im.uri && !im.uri.startsWith('data:')) {
      const p = path.join(dir, decodeURIComponent(im.uri));
      bytes = fs.existsSync(p) ? fs.readFileSync(p) : null;
    }
    return { index, name: im.name || '', mimeType: im.mimeType || '', embedded, uri: im.uri || null, bytes };
  });
}
