'use strict';

// W94Gc staging/prod origin adapter.  The origin owns only the public
// projection store; it never reads a desktop Workspace or accepts file bytes.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WorldHubPublicationService } = require('../main/world-hub-publication-service');

const PORT = Number(process.env.MAZZ_HUB_PORT || 3210);
const ROOT = path.resolve(process.env.MAZZ_HUB_DATA || '/var/lib/mazz-hub');
const IDENTITY = String(process.env.MAZZ_HUB_IDENTITY || 'mazz-hub:staging');
// The origin is safe-by-default.  Enabling publication effects is an explicit
// deployment decision and must not be inherited by a production process.
const PUBLIC_EFFECT = process.env.MAZZ_HUB_PUBLIC_EFFECT === '1';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

fs.mkdirSync(ROOT, { recursive: true });
const service = new WorldHubPublicationService({ rootProvider: () => ROOT, hubIdentity: IDENTITY });

function json(res, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { reject(Object.assign(new Error('request body too large'), { code: 'HUB_REQUEST_TOO_LARGE' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(Object.assign(error, { code: 'HUB_JSON_INVALID' })); }
    });
    req.on('error', reject);
  });
}

function errorStatus(error) {
  if (['HUB_INVALID', 'HUB_GRANT_INVALID', 'HUB_GRANT_MISMATCH', 'HUB_MANIFEST_MISMATCH', 'HUB_SIGNATURE_MISMATCH', 'HUB_SCOPE_DENIED', 'HUB_GRANT_INACTIVE', 'HUB_GRANT_EXPIRED', 'HUB_PREPARE_REQUIRED', 'HUB_WITHDRAW_INVALID'].includes(error?.code)) return 400;
  if (error?.code === 'HUB_PUBLIC_EFFECT_DISABLED') return 403;
  if (error?.code === 'HUB_NOT_FOUND') return 404;
  if (error?.code === 'HUB_PUBLIC_CONFLICT' || error?.code === 'HUB_CAS_MISMATCH') return 409;
  if (error?.code === 'HUB_STORE_CORRUPT') return 503;
  return 500;
}

async function handle(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { schema: 'mazz.hub-health/v1', status: 'ok', hubIdentity: IDENTITY, localOnly: false, publicationEffect: PUBLIC_EFFECT ? 'explicit-grant-only' : 'disabled-staging' });
    if (req.method === 'GET' && req.url === '/v1/publications') return json(res, 200, service.snapshot());
    const routes = {
      '/v1/publications/prepare': ['POST', payload => service.prepare(payload)],
      '/v1/publications/publish': ['POST', payload => service.publish(payload)],
      '/v1/publications/withdraw': ['POST', payload => service.withdraw(payload)],
      '/v1/publications/sync': ['POST', payload => service.sync(payload)],
    };
    const route = routes[req.url];
    if (!route || req.method !== route[0]) return json(res, 404, { schema: 'mazz.hub-error/v1', code: 'NOT_FOUND' });
    if (!PUBLIC_EFFECT && (req.url === '/v1/publications/publish' || req.url === '/v1/publications/withdraw')) {
      throw Object.assign(new Error('publication effect is disabled on this staging origin'), { code: 'HUB_PUBLIC_EFFECT_DISABLED' });
    }
    const payload = await readJson(req);
    return json(res, 200, await route[1](payload));
  } catch (error) {
    return json(res, errorStatus(error), { schema: 'mazz.hub-error/v1', code: error?.code || 'HUB_INTERNAL', message: error?.message || 'Hub request failed' });
  }
}

const server = http.createServer((req, res) => { handle(req, res).catch(error => json(res, 500, { schema: 'mazz.hub-error/v1', code: 'HUB_INTERNAL', message: error.message })); });
server.listen(PORT, '127.0.0.1', () => process.stdout.write(`mazz-hub origin listening on 127.0.0.1:${PORT} as ${IDENTITY}\n`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
