import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.MAZZ_HUB_STAGING_URL || 'https://www.mazz-hub.com';
const evidencePath = path.resolve('docs/engineering/evidence/W94GC_SERVER_STAGING.json');
const result = { schema: 'mazz.w94gc-staging-runtime/v1', result: 'FAIL', base, networkCalls: 0, runtimeErrors: [], checks: [] };

async function get(pathname) {
  result.networkCalls += 1;
  const response = await fetch(`${base}${pathname}`);
  return { response, body: await response.json() };
}
async function post(pathname, payload) {
  result.networkCalls += 1;
  const response = await fetch(`${base}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { response, body: await response.json() };
}

try {
  const health = await get('/healthz');
  assert.equal(health.response.status, 200); assert.equal(health.body.status, 'ok');
  assert.equal(health.body.hubIdentity, 'mazz-hub:staging'); assert.equal(health.body.publicationEffect, 'disabled-staging'); result.checks.push('https-health');
  const snapshot = await get('/v1/publications');
  assert.equal(snapshot.response.status, 200); assert.equal(snapshot.body.localOnly, false); assert.equal(Array.isArray(snapshot.body.projections), true); result.checks.push('public-snapshot');
  const publish = await post('/v1/publications/publish', {});
  assert.equal(publish.response.status, 403); assert.equal(publish.body.code, 'HUB_PUBLIC_EFFECT_DISABLED'); result.checks.push('public-effect-closed');
  result.result = 'PASS_WITH_SCOPE';
} catch (error) {
  result.runtimeErrors.push(error?.stack || String(error));
}
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result));
if (result.result !== 'PASS_WITH_SCOPE') process.exitCode = 1;
