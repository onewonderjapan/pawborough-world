// tools/portable/tar.mjs — 最小 ustar 归档层（自写自读，无外部 tar 依赖）。
//
// 安全契约（R2）：所有归档层在解包【前】完整校验 entry 名与类型：
//   - 路径：拒绝绝对路径、任何 '..' 段、NUL/反斜杠结尾等异常；
//   - 类型：只接受普通文件（typeflag '0'/'\0'）与目录（'5'）；
//     拒绝 symlink('2') / hardlink('1') / char('3') / block('4') / fifo('6') /
//     contiguous('7') 以及 pax('x','g') / GNU longname('L','K') 扩展头 ——
//     本工具写出的 tar 不含这些，读入时遇到即视为不可信归档整体拒绝；
//   - 解包目标已有内容照旧由上层拒绝；解包本身逐条 safeJoin 防父目录逃逸。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { safeJoin } from './lib.mjs';

const BLOCK_SIZE = 512;

export class TarUnsafeError extends Error {}

function octal(n, len) {
  const s = Math.floor(n).toString(8);
  if (s.length > len - 1) throw new TarUnsafeError(`NUM_OVERFLOW: ${n} does not fit ${len - 1} octal digits`);
  return s.padStart(len - 1, '0') + '\0';
}

function header(entry) {
  const name = Buffer.from(entry.path, 'utf8');
  let nameField = name, prefixField = Buffer.alloc(0);
  if (name.length > 100) {
    // ustar 前缀拆分：在 '/' 边界切，prefix ≤155、name ≤100
    let cut = -1;
    for (let i = name.length - 101; i >= 0; i--) {
      if (name[i] === 0x2f) { cut = i; break; }
    }
    if (cut < 0 || name.length - cut - 1 > 100 || cut > 155) {
      throw new TarUnsafeError(`NAME_TOO_LONG: ${entry.path}`);
    }
    prefixField = name.subarray(0, cut);
    nameField = name.subarray(cut + 1);
  }
  if (entry.type === '5' && !entry.path.endsWith('/')) {
    throw new TarUnsafeError(`DIR_NAME_NEEDS_SLASH: ${entry.path}`);
  }
  const buf = Buffer.alloc(BLOCK_SIZE);
  buf.write(nameField.toString('utf8'), 0, 100, 'utf8');
  buf.write(octal(entry.mode ?? (entry.type === '5' ? 0o755 : 0o644), 8), 100, 8, 'utf8');
  buf.write(octal(0, 8), 108, 8, 'utf8');   // uid
  buf.write(octal(0, 8), 116, 8, 'utf8');   // gid
  buf.write(octal(entry.type === '5' ? 0 : entry.data.length, 12), 124, 12, 'utf8');
  buf.write(octal(0, 12), 136, 12, 'utf8'); // mtime
  buf.write('        ', 148, 8, 'ascii');   // checksum 占位
  buf.write(entry.type, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'utf8');
  buf.write('00', 263, 2, 'utf8');
  prefixField.copy(buf, 345, 0, Math.min(prefixField.length, 155));
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(octal(sum, 8).replace(/\0$/, ' '), 148, 8, 'utf8');
  return buf;
}

// entries: [{ path, type: '0'|'5', data?: Buffer }]；目录自动补父目录项。
export function writeTar(entries) {
  const dirs = new Set();
  for (const e of entries) {
    const segs = e.path.split('/');
    if (e.type !== '5') segs.pop();
    let acc = '';
    for (const s of segs) { acc = acc ? `${acc}/${s}` : s; dirs.add(acc); }
  }
  const all = [
    ...[...dirs].sort().map((d) => ({ path: d + '/', type: '5' })),
    ...entries,
  ];
  const chunks = [];
  for (const e of all) {
    chunks.push(header(e));
    if (e.type !== '5') {
      chunks.push(e.data);
      const pad = (BLOCK_SIZE - (e.data.length % BLOCK_SIZE)) % BLOCK_SIZE;
      if (pad) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}

function readString(buf, start, len) {
  const b = buf.subarray(start, start + len);
  const nul = b.indexOf(0);
  return b.subarray(0, nul === -1 ? len : nul).toString('utf8');
}

// 严格读取：任何非普通文件/目录、坏路径、坏校验、截断 → 抛 TarUnsafeError。
// 返回 [{ path, type, data }]（目录无 data）。
export function readTar(buf) {
  if (buf.length < BLOCK_SIZE * 2 || buf.length % BLOCK_SIZE !== 0) {
    throw new TarUnsafeError(`TAR_SIZE_INVALID: ${buf.length}`);
  }
  const entries = [];
  let off = 0;
  let zeroBlocks = 0;
  let ended = false;
  while (off + BLOCK_SIZE <= buf.length) {
    const h = buf.subarray(off, off + BLOCK_SIZE);
    if (h.every((b) => b === 0)) {
      zeroBlocks++;
      off += BLOCK_SIZE;
      if (zeroBlocks === 2) { ended = true; break; }
      continue;
    }
    if (ended) throw new TarUnsafeError('TAR_DATA_AFTER_END');
    const name = readString(h, 0, 100);
    const sizeStr = readString(h, 124, 12).trim();
    const size = parseInt(sizeStr || '0', 8);
    const type = readString(h, 156, 1) || '0';
    const prefix = readString(h, 345, 155);
    const checksumField = h.subarray(148, 156);
    const calc = (() => { const c = Buffer.from(h); c.fill(0x20, 148, 156); let s = 0; for (const b of c) s += b; return s; })();
    const recorded = parseInt(readString(h, 148, 8).trim() || '0', 8);
    if (calc !== recorded) throw new TarUnsafeError(`TAR_CHECKSUM_MISMATCH: ${name}`);
    if (!/^\d+$/.test(sizeStr) || Number.isNaN(size) || size < 0) throw new TarUnsafeError(`TAR_SIZE_BAD: ${name} '${sizeStr}'`);

    // R2 类型白名单：只放行普通文件与目录
    if (type !== '0' && type !== '\0' && type !== '5') {
      throw new TarUnsafeError(`TAR_ENTRY_TYPE_REFUSED: typeflag='${type}' name='${name || prefix}' (symlink/hardlink/special/extension headers are not accepted)`);
    }
    const full = (prefix ? prefix + '/' : '') + name;
    if (/[\\\0]/.test(full) || full.endsWith('/..') || full.includes('\u0000')) {
      throw new TarUnsafeError(`TAR_ENTRY_NAME_REFUSED: '${full}'`);
    }
    const segs = full.split('/').filter((s) => s !== '' && s !== '.');
    if (path.isAbsolute(full) || segs.includes('..') || segs.length === 0) {
      throw new TarUnsafeError(`TAR_ENTRY_PATH_REFUSED: '${full}' (absolute or parent-traversing)`);
    }
    const data = type === '5' ? null : buf.subarray(off + BLOCK_SIZE, off + BLOCK_SIZE + size);
    if (type !== '5' && (data === null || data.length !== size)) throw new TarUnsafeError(`TAR_TRUNCATED: ${full}`);
    entries.push({ path: segs.join('/') + (type === '5' ? '/' : ''), type, data: data ?? undefined });
    off += BLOCK_SIZE + (type === '5' ? 0 : Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE);
  }
  if (!ended) throw new TarUnsafeError('TAR_NO_END_BLOCKS');
  return entries;
}

// 先整体校验（readTar），再解包；解包目标已有内容由调用方负责拒绝。
export async function extractTar(buf, dest) {
  const entries = readTar(buf); // 可能抛 TarUnsafeError —— 解包前完成
  for (const e of entries) {
    const abs = safeJoin(dest, e.path);
    if (e.type === '5') {
      await fsp.mkdir(abs, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, e.data);
    }
  }
  return entries;
}

// 供测试构造恶意归档：直接写任意 512 字节头 + 数据，不做任何过滤。
export function rawTarBlock({ name, typeflag = '0', sizeBytes = 0, linkName = '', payload = null, prefix = '' }) {
  const buf = Buffer.alloc(BLOCK_SIZE);
  buf.write(name, 0, 100, 'utf8');
  buf.write('0000644\0', 100, 8, 'utf8');
  buf.write('0000000\0', 108, 8, 'utf8');
  buf.write('0000000\0', 116, 8, 'utf8');
  buf.write((sizeBytes.toString(8).padStart(11, '0') + '\0'), 124, 12, 'utf8');
  buf.write('00000000000\0', 136, 12, 'utf8');
  buf.write('        ', 148, 8, 'ascii');
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write(linkName, 157, 100, 'utf8');
  buf.write('ustar\0', 257, 6, 'utf8');
  buf.write('00', 263, 2, 'utf8');
  buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write((sum.toString(8).padStart(7, '0') + '\0'), 148, 8, 'utf8');
  const parts = [buf];
  if (payload) {
    parts.push(payload);
    const pad = (BLOCK_SIZE - (payload.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  return Buffer.concat(parts);
}
