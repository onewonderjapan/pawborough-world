// Node fallback launcher (used only when python3 is unavailable) — zero
// dependencies, serves THIS package directory on 127.0.0.1.
//   node start-world-playable.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8' };

const port = Number(process.argv[2]) || 5411;
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const st = await stat(file).catch(() => null);
    if (st?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
server.on('error', (e) => {
  console.error(`端口 ${port} 无法使用（${e.code}）。请换一个端口：node start-world-playable.mjs 5412`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () =>
  console.log(`方浜市声 本地试玩包已启动：http://127.0.0.1:${port}/world-preview.html （Ctrl+C 停止）`));
