import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { WorldHubPublicationService } = require('../main/world-hub-publication-service.js');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(projectRoot, 'hub-web');
const workspaceRoot = path.resolve(process.env.MAZZ_HUB_PREVIEW_WORKSPACE || projectRoot);
const host = '127.0.0.1';
const port = Number(process.env.MAZZ_HUB_PREVIEW_PORT || 4173);
const localHub = new WorldHubPublicationService({ rootProvider: () => workspaceRoot });
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

function readJson(req, { maxBytes = 128 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求体过大'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON 非法'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

async function localHubAction(req, res, action) {
  const methods = { prepare: 'prepare', publish: 'publish', withdraw: 'withdraw', sync: 'sync' };
  if (!methods[action]) return json(res, 404, { error: 'NOT_FOUND' });
  try {
    const input = await readJson(req);
    const result = localHub[methods[action]](input);
    return json(res, 200, result);
  } catch (error) {
    const status = error.code === 'BODY_TOO_LARGE' ? 413 : error.code === 'INVALID_JSON' ? 400 : 422;
    return json(res, status, { error: error.code || 'LOCAL_HUB_FAILED', message: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  const actionMatch = url.pathname.match(/^\/api\/local-hub\/(prepare|publish|withdraw|sync)$/);
  if (actionMatch) {
    if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return localHubAction(req, res, actionMatch[1]);
  }
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (url.pathname === '/healthz') return json(res, 200, { schema: 'mazz.hub-preview-health/v1', status: 'ok', mode: 'local-fixture', publicEffect: 'disabled', localHubEffect: 'fake-only' });
  if (url.pathname === '/api/local-hub/snapshot') {
    try { return json(res, 200, localHub.snapshot()); }
    catch (error) { return json(res, 500, { error: error.code || 'LOCAL_HUB_SNAPSHOT_FAILED', message: error.message }); }
  }
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
  console.log('[mazz-hub-preview] public effect disabled; local fake-Hub enabled');
});

function close() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
