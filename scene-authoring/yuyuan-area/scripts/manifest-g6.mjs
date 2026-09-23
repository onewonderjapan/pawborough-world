// G6 交付包清单：逐文件 SHA256 + 字节数。
// 排除 manifest.json 自身与备份（*.blend1）/系统杂物（.DS_Store）；必须在 README/RESULT/verification 定稿之后运行。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, process.env.PKG_DIR || 'out-goal-06');
const OUT = path.join(PKG, 'manifest.json');

const EXCLUDE = new Set(['manifest.json']);
const EXCLUDE_PATTERNS = [/\.blend1$/, /(^|\/)\.DS_Store$/];
const excluded = [];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    const rel = path.relative(PKG, p).split(path.sep).join('/');
    if (e.isDirectory()) { walk(p); continue; }
    if (EXCLUDE.has(rel) || EXCLUDE_PATTERNS.some(re => re.test(rel))) { excluded.push(rel); continue; }
    const buf = fs.readFileSync(p);
    files.push({ path: rel, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  }
})(PKG);

const manifest = {
  generatedAt: new Date().toISOString(),
  package: path.basename(PKG),
  note: '统一候选交付包清单。本文件在 README.md / RESULT.md / verification/ 定稿之后生成（哈希覆盖最终内容）；排除 manifest.json 自身与备份文件。生成脚本 scripts/manifest-g6.mjs。',
  algorithms: 'sha256',
  fileCount: files.length,
  totalBytes: files.reduce((s, f) => s + f.bytes, 0),
  excludes: { self: ['manifest.json'], patterns: ['*.blend1', '.DS_Store'], matched: excluded },
  files,
};
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 1));
console.log(`manifest: ${files.length} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MB, excluded ${excluded.length}`);
