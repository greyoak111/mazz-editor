import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hub-web');
const host = '127.0.0.1';
const port = Number(process.env.MAZZ_HUB_PREVIEW_PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function safeFile(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  if (url.pathname === '/healthz') return json(res, 200, { schema: 'mazz.hub-preview-health/v1', status: 'ok', mode: 'local-fixture', publicEffect: 'disabled' });
  if (url.pathname === '/api/fixture') {
    const fixture = path.join(root, 'fixture.json');
    return fs.readFile(fixture, 'utf8', (error, text) => {
      if (error) return json(res, 500, { error: 'FIXTURE_READ_FAILED' });
      res.writeHead(200, { 'content-type': mime['.json'], 'cache-control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      res.end(text);
    });
  }
  const file = safeFile(url.pathname);
  if (!file) return json(res, 400, { error: 'INVALID_PATH' });
  fs.stat(file, (statError, stat) => {
    if (statError || !stat.isFile()) return json(res, 404, { error: 'NOT_FOUND' });
    res.writeHead(200, { 'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`[mazz-hub-preview] http://${host}:${port}`);
  console.log(`[mazz-hub-preview] root=${root}`);
  console.log('[mazz-hub-preview] public effect disabled; fixture only');
});

function close() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
