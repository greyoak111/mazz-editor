import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { _forTests } = require('../../main/world-hub-publication-service.js');
const projectRoot = path.resolve(import.meta.dirname, '..', '..');

function packageFixture() {
  const createdAt = '2026-08-31T01:00:00.000Z';
  const manifestBody = {
    schema: 'mazz.public-content-manifest/v1', manifestId: 'manifest:w69-local-test',
    blocks: [{ contentId: 'content:w69-local-test:001', mediaType: 'text/plain', size: 18, contentHash: `sha256:${'a'.repeat(64)}`, encrypted: false }],
    createdAt,
  };
  const manifest = { ...manifestBody, contentRoot: `root:${_forTests.digest(manifestBody)}` };
  const grant = {
    schema: 'mazz.publication-grant/v1', grantId: 'grant:w69-local-test', publicationId: 'publication:w69-local-test-v1',
    subjectId: 'creator:local-preview', scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'],
    authorityRef: 'human:local-preview', sourceArtifactRefs: ['artifact:w69-local-test'], rightsRef: 'license:preview-local', issuedAt: createdAt, status: 'active',
  };
  const envelope = {
    schema: 'mazz.publication-envelope/v1', publicationId: grant.publicationId, workId: 'work:w69-local-test', creatorId: 'creator:local-preview',
    editionType: 'text', version: 'v1', title: '本地闭环样本', summary: '只进入本地 fake-Hub 的公开安全摘要。', visibility: 'public',
    contentManifestRef: manifest.manifestId, contentIds: manifest.blocks.map(block => block.contentId), licenseRef: grant.rightsRef,
    provenance: { artifactRef: 'artifact:w69-local-test' }, publicationGrantRef: grant.grantId, signatureRef: '', createdAt,
  };
  envelope.signatureRef = _forTests.expectedSignatureRef(envelope, grant);
  return { envelope, manifest, grant };
}

async function waitForHealth(url, processHandle) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processHandle.exitCode != null) throw new Error(`preview server exited: ${processHandle.exitCode}`);
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview server health timeout');
}

async function post(url, action, body) {
  const response = await fetch(`${url}/api/local-hub/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test('W69 local website reuses W94Gb fake-Hub for prepare/publish/sync/withdraw without public effect', async t => {
  const tempBase = path.resolve(os.tmpdir());
  const workspace = fs.mkdtempSync(path.join(tempBase, 'mazz-w69-local-hub-'));
  const port = 44000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/mazz-hub-preview.js'], {
    cwd: projectRoot,
    env: { ...process.env, MAZZ_HUB_PREVIEW_PORT: String(port), MAZZ_HUB_PREVIEW_WORKSPACE: workspace },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    await new Promise(resolve => {
      if (child.exitCode != null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
    const resolved = path.resolve(workspace);
    assert.ok(resolved.startsWith(`${tempBase}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith('mazz-w69-local-hub-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const health = await waitForHealth(baseUrl, child);
  assert.equal(health.publicEffect, 'disabled');
  assert.equal(health.localHubEffect, 'fake-only');

  const initial = await (await fetch(`${baseUrl}/api/local-hub/snapshot`)).json();
  assert.equal(initial.revision, 0);
  assert.equal(initial.projections.length, 0);

  const pkg = packageFixture();
  const prepared = await post(baseUrl, 'prepare', { ...pkg, expectedRevision: 0 });
  assert.equal(prepared.response.status, 200, JSON.stringify(prepared.body));
  assert.equal(prepared.body.projection.status, 'prepared');
  assert.equal(prepared.body.networkCalls, 0);
  assert.equal(prepared.body.authorityGranted, false);

  const published = await post(baseUrl, 'publish', { ...pkg, expectedRevision: 1 });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.projection.status, 'published');

  const synced = await post(baseUrl, 'sync', { publicationId: pkg.envelope.publicationId, grant: pkg.grant });
  assert.equal(synced.response.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.projection.status, 'published');

  const withdrawn = await post(baseUrl, 'withdraw', { ...pkg, expectedRevision: 2 });
  assert.equal(withdrawn.response.status, 200, JSON.stringify(withdrawn.body));
  assert.equal(withdrawn.body.projection.status, 'withdrawn');

  const finalSnapshot = await (await fetch(`${baseUrl}/api/local-hub/snapshot`)).json();
  assert.equal(finalSnapshot.revision, 3);
  assert.deepEqual(finalSnapshot.receipts.map(receipt => receipt.action), ['prepare', 'publish', 'withdraw']);
  assert.equal(finalSnapshot.localOnly, true);

  const storeText = fs.readFileSync(path.join(workspace, '.mazz', 'hub', 'fake-store.json'), 'utf8');
  assert.doesNotMatch(storeText, /sourceArtifactRefs|公开样本|[A-Za-z]:\\|https?:\/\//);
  assert.match(storeText, /mazz\.fake-hub-store\/v0/);

  const rejected = await fetch(`${baseUrl}/`, { method: 'POST' });
  assert.equal(rejected.status, 405);
  assert.match(logs, /public effect disabled; local fake-Hub enabled/);
});

test('website fixture covers the local mature-Hub joints without claiming remote delivery', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(projectRoot, 'hub-web', 'fixture.json'), 'utf8'));
  const appSource = fs.readFileSync(path.join(projectRoot, 'hub-web', 'app.js'), 'utf8');
  assert.equal(fixture.publicEffect, 'disabled');
  assert.ok(fixture.publications.every(pub => pub.tags?.length && pub.preview?.length && pub.versions?.length));
  assert.ok(fixture.series.length && fixture.comments.length && fixture.notifications.length);
  for (const joint of ['Following', 'For You', '稍后', '阅读进度', '本地评论', '通知中心', 'Creator Studio', '治理与权限', 'Report', 'Block']) assert.match(appSource, new RegExp(joint, 'i'));
  assert.match(appSource, /W94Gb local fake-Hub/);
  assert.match(appSource, /localProjectionPublications/);
  assert.match(appSource, /item\.status === 'published'/);
  assert.doesNotMatch(appSource, /publicEffect\s*=\s*['"]enabled|VPS.*fetch|www\.mazz-hub\.com/);
});
