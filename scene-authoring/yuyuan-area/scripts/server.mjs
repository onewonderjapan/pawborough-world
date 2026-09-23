// 静态服务：/ -> web/，/out -> OUT_DIR（默认 out/），/node_modules -> 共享依赖。
// WP4 步行新增只读路由：/vendor/ -> 仓库根 node_modules/（Rapier），
// /vendor-src/ -> 仓库根 src/（DOM-free 可复用件 WalkController/physics/groundExtractor 等）。
// 端口/输出目录可显式指定：PORT=5472 OUT_DIR=out-v2 node scripts/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');                 // 仓库根（本 worktree）
const OUTDIR = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const VENDOR = path.resolve(REPO, 'node_modules');           // /vendor/
const VENDOR_SRC = path.resolve(REPO, 'src');                // /vendor-src/
const PORT = parseInt(process.env.PORT || '5470', 10);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.css': 'text/css', '.blend': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = url.pathname;
  if (p === '/') p = '/web/index.html';
  let base = ROOT;
  if (p.startsWith('/out/')) { base = OUTDIR; p = p.replace(/^\/out/, ''); }
  else if (p.startsWith('/vendor/')) { base = VENDOR; p = p.replace(/^\/vendor/, ''); }
  else if (p.startsWith('/vendor-src/')) { base = VENDOR_SRC; p = p.replace(/^\/vendor-src/, ''); }
  // else /node_modules/、/web/ 等相对 ROOT
  const file = path.normalize(path.join(base, decodeURIComponent(p)));
  const allowed = [OUTDIR, ROOT, VENDOR, VENDOR_SRC];
  if (!allowed.some(b => file === b || file.startsWith(b + path.sep))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`preview at http://127.0.0.1:${PORT}/ (out -> ${OUTDIR})`));
