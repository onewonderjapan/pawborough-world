// tools/portable/lib.mjs — 共享工具：sha256、安全路径、递归复制/打包辅助。
// 约束（WAVE1_CONTRACT / ORDER）：
//   - 路径不得逃逸输出根（zip-slip / ../ 防护）；
//   - 不覆盖既有目录，不删除旧内容；
//   - 大文件带 sha256，清单可重验；
//   - 不硬编码任何具体候选目录或 HEAD。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export async function sha256File(file) {
  const h = createHash('sha256');
  await new Promise((res, rej) => {
    const rs = fs.createReadStream(file);
    rs.on('data', (d) => h.update(d));
    rs.on('end', res);
    rs.on('error', rej);
  });
  return h.digest('hex');
}

// 把目标路径限制在 root 之下；返回归一化后的绝对路径，否则抛错。
export function safeJoin(root, ...parts) {
  const absRoot = path.resolve(root);
  const joined = path.resolve(absRoot, ...parts);
  if (joined !== absRoot && !joined.startsWith(absRoot + path.sep)) {
    throw new Error(`PATH_ESCAPE: ${path.join(...parts)} escapes ${absRoot}`);
  }
  return joined;
}

// tar 条目名校验：拒绝绝对路径与 ../（防 zip-slip）。
export function safeTarName(name) {
  const n = String(name).replace(/\\/g, '/');
  if (n.startsWith('/') || n.split('/').includes('..')) {
    throw new Error(`TAR_ENTRY_UNSAFE: ${name}`);
  }
  return n;
}

export async function exists(p) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

export async function isDir(p) {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}

// 目录必须不存在，或存在且完全为空（恢复目标）；否则拒绝（不覆盖既有目录）。
export async function assertEmptyDest(dest) {
  if (!(await exists(dest))) return;
  const st = await fsp.stat(dest);
  if (!st.isDirectory()) throw new Error(`DEST_NOT_DIR: ${dest}`);
  const entries = await fsp.readdir(dest);
  if (entries.length > 0) {
    throw new Error(`DEST_NOT_EMPTY: ${dest} has ${entries.length} entries — restore refuses to overwrite or merge`);
  }
}

// 递归列出 root 下所有普通文件（相对路径，POSIX 分隔符）。遇 symlink 即抛错：
// 恢复环境里不允许符号链接冒充新环境（npm 的 bin 链接指向 dest 内部才放行，见 assertSymlinksInside）。
export async function listFiles(root, { rel = '', out = [] } = {}) {
  const abs = rel ? path.join(root, rel) : root;
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  for (const e of entries) {
    if (e.isSymbolicLink()) throw new Error(`SYMLINK_IN_TREE: ${path.join(rel, e.name)}`);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await listFiles(root, { rel: r, out });
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

// 校验 root 下的符号链接（若有）目标都仍在 root 内部；任何逃逸即失败。
// 用于恢复后证明 node_modules 不是指向旧环境的软链。
export async function assertSymlinksInside(root) {
  const walk = async (rel) => {
    const abs = path.join(root, rel);
    const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        const target = await fsp.readlink(path.join(root, r));
        const resolved = path.resolve(path.join(root, rel), target);
        const absRoot = path.resolve(root);
        if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
          throw new Error(`SYMLINK_ESCAPES_DEST: ${r} -> ${target}`);
        }
      } else if (e.isDirectory()) {
        await walk(r);
      }
    }
  };
  await walk('');
}

// 递归复制目录（源树内不允许 symlink），全部落为真实字节。
export async function copyTree(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.isSymbolicLink()) throw new Error(`SYMLINK_IN_SOURCE: ${path.join(src, e.name)}`);
    const s = path.join(src, e.name);
    const d = safeJoin(dest, e.name);
    if (e.isDirectory()) await copyTree(s, d);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

export function writeJson(file, obj) {
  // UTF8 LF（契约要求），尾部一个换行。
  return fsp.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function readJson(file) {
  return fsp.readFile(file, 'utf8').then((t) => JSON.parse(t));
}

// 证据/报告文件名防覆盖：存在则加 -2、-3 …
export async function nonClobberPath(file) {
  if (!(await exists(file))) return file;
  for (let i = 2; i < 1000; i++) {
    const cand = `${file.replace(/(\.[^./]+)$/, '')}-${i}${(file.match(/(\.[^./]+)$/) || ['', ''])[1]}`;
    if (!(await exists(cand))) return cand;
  }
  throw new Error(`NON_CLOBBER_EXHAUSTED: ${file}`);
}

export function fmtBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'KB';
  return `${n}B`;
}

// 解析 key=value CLI：--k v / --k=v / 布尔 flag。
export function parseArgs(argv, spec = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    a = a.slice(2);
    let k = a, v = true;
    const eq = a.indexOf('=');
    if (eq >= 0) { k = a.slice(0, eq); v = a.slice(eq + 1); }
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !(spec.flags || []).includes(a)) {
      v = argv[++i];
    }
    out[k] = v;
  }
  return out;
}

export function die(msg) {
  console.error('FAIL ' + msg);
  process.exit(1);
}
