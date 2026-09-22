// 静态服务：/ -> web/，/out -> OUT_DIR（默认 out/），/node_modules -> 共享依赖。
// 端口/输出目录可显式指定：PORT=5472 OUT_DIR=out-v2 node scripts/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const PORT = parseInt(process.env.PORT || '5470', 10);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.css': 'text/css', '.blend': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = url.pathname;
  if (p === '/') p = '/web/index.html';
  let base = ROOT;
  if (p.startsWith('/out/')) { base = OUTDIR; p = p.replace(/^\/out/, ''); }
  // else /node_modules/、/web/ 等相对 ROOT
  const file = path.normalize(path.join(base, decodeURIComponent(p)));
  if (!file.startsWith(OUTDIR) && !file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`preview at http://127.0.0.1:${PORT}/ (out -> ${OUTDIR})`));
