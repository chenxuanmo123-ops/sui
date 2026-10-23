import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createAiHandler } from './ai.mjs';
import { createProfileStore } from './profile-store.mjs';
import { loadProviders } from './config.mjs';
const handler = createAiHandler(loadProviders(), { store: createProfileStore() });
const root = resolve('dist');
const mime = { '.wasm': 'application/wasm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname === '/api/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', service: 'shujian-agent' }));
  }
  if (url.pathname.startsWith('/api/ai/')) return void handler(req, res);
  if (url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname.includes('\0') || pathname.replaceAll('\\', '/').split('/').some(segment => segment.startsWith('.'))) { res.writeHead(403); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  try {
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = resolve(file, 'index.html');
    let data;
    try { data = await readFile(file); } catch { if (extname(file) || pathname.startsWith('/assets/')) { res.writeHead(404); return res.end(); } file = resolve(root, 'index.html'); data = await readFile(file); }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': file.startsWith(resolve(root, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(500); res.end('页面尚未构建，请先执行 npm run build。'); }
});
server.listen(Number(process.env.PORT || 5173), process.env.HOST || '127.0.0.1', () => console.log('数鉴已启动：http://' + (process.env.HOST || '127.0.0.1') + ':' + server.address().port));

for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
});
