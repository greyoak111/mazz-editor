import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _forTests } = require('../../main/world-hub-publication-service.js');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94gc-origin-')));
const evidencePath = path.resolve('docs/engineering/evidence/W94GC_ORIGIN_SOURCE.json');

function fixturePackage() {
  const createdAt = '2026-08-28T00:00:00.000Z';
  const manifestBody = {
    schema: 'mazz.public-content-manifest/v1', manifestId: 'manifest:origin',
    blocks: [{ contentId: 'content:origin-text', mediaType: 'text/plain', size: 42, contentHash: `sha256:${'b'.repeat(64)}`, encrypted: false }], createdAt,
  };
  const manifest = { ...manifestBody, contentRoot: `root:${_forTests.digest(manifestBody)}` };
  const grant = _forTests.normalizeGrant({
    schema: 'mazz.publication-grant/v1', grantId: 'grant:origin-v1', publicationId: 'publication:origin-v1', subjectId: 'creator:alice',
    scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'], authorityRef: 'human:alice',
    sourceArtifactRefs: ['artifact:origin-final'], rightsRef: 'license:cc-by', issuedAt: createdAt, status: 'active',
  }, createdAt);
  const base = _forTests.normalizeEnvelope({
    schema: 'mazz.publication-envelope/v1', publicationId: 'publication:origin-v1', workId: 'work:origin', creatorId: 'creator:alice',
    editionType: 'text', version: 'v1', title: 'Origin', summary: 'Origin fixture', visibility: 'public', worldRef: 'world:origin',
    contentManifestRef: 'manifest:origin', contentIds: ['content:origin-text'], licenseRef: 'license:cc-by', provenance: { producer: 'W94Gc-test' },
    publicationGrantRef: 'grant:origin-v1', signatureRef: 'signature:placeholder', createdAt,
  });
  return { manifest, grant, envelope: { ...base, signatureRef: _forTests.expectedSignatureRef(base, grant) } };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

function startServer(port) {
  const child = spawn(process.execPath, [path.resolve('server/hub-origin.js')], {
    cwd: path.resolve('.'),
    env: { ...process.env, MAZZ_HUB_PORT: String(port), MAZZ_HUB_DATA: root, MAZZ_HUB_IDENTITY: 'mazz-hub:test-origin', MAZZ_HUB_PUBLIC_EFFECT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function waitForHealth(base) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`${base}/healthz`); if (response.ok) return response.json(); } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('origin did not become healthy');
}

async function request(base, pathname, payload) {
  const response = await fetch(`${base}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await response.json();
  return { status: response.status, body };
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const fixture = fixturePackage();
const result = { schema: 'mazz.w94gc-origin-runtime/v1', result: 'FAIL', networkCalls: 0, runtimeErrors: [], lifecycle: [], restart: null, publicEffectDefault: null };
let running;
try {
  running = startServer(port);
  const health = await waitForHealth(base);
  result.publicEffectDefault = health.publicationEffect;
  assert.equal(health.hubIdentity, 'mazz-hub:test-origin');
  assert.equal(health.publicationEffect, 'explicit-grant-only');
  const prepared = await request(base, '/v1/publications/prepare', { ...fixture, expectedRevision: 0 });
  assert.equal(prepared.status, 200); assert.equal(prepared.body.projection.status, 'prepared'); result.lifecycle.push('prepare');
  const published = await request(base, '/v1/publications/publish', { ...fixture, expectedRevision: 1 });
  assert.equal(published.status, 200); assert.equal(published.body.projection.status, 'published'); result.lifecycle.push('publish');
  const queried = await (await fetch(`${base}/v1/publications`)).json();
  assert.equal(queried.projections[0].status, 'published'); result.lifecycle.push('query');
  const withdrawn = await request(base, '/v1/publications/withdraw', { ...fixture, expectedRevision: 2 });
  assert.equal(withdrawn.status, 200); assert.equal(withdrawn.body.projection.status, 'withdrawn'); result.lifecycle.push('withdraw');
  const synced = await request(base, '/v1/publications/sync', { publicationId: fixture.envelope.publicationId, grant: fixture.grant });
  assert.equal(synced.status, 200); assert.equal(synced.body.projection.status, 'withdrawn'); result.lifecycle.push('sync');
  assert.equal(JSON.stringify(synced.body).includes('artifact:origin-final'), false);
  running.child.kill('SIGTERM'); await new Promise(resolve => running.child.once('exit', resolve));
  running = startServer(port); await waitForHealth(base);
  const afterRestart = await (await fetch(`${base}/v1/publications`)).json();
  result.restart = { projectionCount: afterRestart.projections.length, status: afterRestart.projections[0]?.status || null };
  assert.equal(result.restart.status, 'withdrawn');
  result.result = 'PASS';
} catch (error) {
  result.runtimeErrors.push(error?.stack || String(error));
  if (running) result.runtimeErrors.push(running.output());
} finally {
  if (running && !running.child.killed) { running.child.kill('SIGTERM'); await new Promise(resolve => running.child.once('exit', resolve)).catch(() => {}); }
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(result));
if (result.result !== 'PASS') process.exitCode = 1;
