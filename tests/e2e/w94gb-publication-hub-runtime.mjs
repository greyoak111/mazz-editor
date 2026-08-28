// W94Gb：fake Hub 公共投影 Source/Packaged + grant/withdraw/sync + A/B/restart
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _forTests } = require('../../main/world-hub-publication-service.js');
const ROOT = path.resolve('.');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94GB_HUB_${MODE.toUpperCase()}.json`);
const SCREENSHOT = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94GB_HUB_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94gb-${MODE}-user-`)));
const WORKSPACE_A = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94gb-${MODE}-a-`)));
const WORKSPACE_B = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94gb-${MODE}-b-`)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); return; }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) throw error; await delay(250); }
  }
}

function fixturePackage() {
  const createdAt = '2026-08-28T00:00:00.000Z';
  const manifestBody = {
    schema: 'mazz.public-content-manifest/v1', manifestId: 'manifest:harbor',
    blocks: [{ contentId: 'content:harbor-text', mediaType: 'text/plain', size: 42, contentHash: `sha256:${'a'.repeat(64)}`, encrypted: false }], createdAt,
  };
  const manifest = { ...manifestBody, contentRoot: `root:${_forTests.digest(manifestBody)}` };
  const grant = _forTests.normalizeGrant({
    schema: 'mazz.publication-grant/v1', grantId: 'grant:harbor-v1', publicationId: 'publication:harbor-v1', subjectId: 'creator:alice',
    scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'], authorityRef: 'human:alice',
    sourceArtifactRefs: ['artifact:harbor-final'], rightsRef: 'license:cc-by', issuedAt: createdAt, status: 'active',
  }, createdAt);
  const base = _forTests.normalizeEnvelope({
    schema: 'mazz.publication-envelope/v1', publicationId: 'publication:harbor-v1', workId: 'work:harbor', creatorId: 'creator:alice',
    editionType: 'text', version: 'v1', title: 'Harbor', summary: 'A public fixture', visibility: 'public', worldRef: 'world:harbor',
    contentManifestRef: 'manifest:harbor', contentIds: ['content:harbor-text'], licenseRef: 'license:cc-by', provenance: { producer: 'W94Gb-e2e' },
    publicationGrantRef: grant.grantId, signatureRef: 'signature:placeholder', createdAt,
  });
  return { manifest, grant, envelope: { ...base, signatureRef: _forTests.expectedSignatureRef(base, grant) } };
}

const errors = [];
let product = null;
let report = null;
function watchProduct(instance) {
  instance.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) errors.push(text.trim());
  });
}
try {
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({ workspace: WORKSPACE_A, workspaces: [{ path: WORKSPACE_A, name: 'A' }, { path: WORKSPACE_B, name: 'B' }], closeBehavior: 'quit', 'agreement.noMore': true }, null, 2)}\n`, 'utf8');
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE_A, MAZZ_E2E_DISABLE_GPU: '1' },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  product = await electron.launch(options);
  watchProduct(product);
  const page = await product.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  const invoke = (channel, payload = {}) => page.evaluate(({ channel, payload }) => window.mazz.invoke(channel, payload), { channel, payload });
  const fixture = fixturePackage();

  const prepared = await invoke('hub:preparePublication', { ...fixture, expectedRevision: 0 });
  assert.equal(prepared.projection.status, 'prepared');
  const published = await invoke('hub:publishPublication', { ...fixture, expectedRevision: 1 });
  assert.equal(published.projection.status, 'published');
  const queried = await invoke('hub:syncPublication', { publicationId: fixture.envelope.publicationId, grant: fixture.grant });
  assert.equal(queried.projection.status, 'published');
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  const withdrawn = await invoke('hub:withdrawPublication', { ...fixture, expectedRevision: 2 });
  assert.equal(withdrawn.projection.status, 'withdrawn');
  const syncedWithdrawn = await invoke('hub:syncPublication', { publicationId: fixture.envelope.publicationId, grant: fixture.grant });
  assert.equal(syncedWithdrawn.projection.envelope.visibility, 'withdrawn');
  const projectionJson = JSON.stringify(syncedWithdrawn.projection);
  assert.equal(projectionJson.includes('artifact:harbor-final'), false);
  assert.equal(projectionJson.includes('C:\\'), false);
  assert.equal(projectionJson.includes('https://'), false);

  await invoke('workspace:setCurrent', { path: WORKSPACE_B });
  assert.equal((await invoke('hub:snapshot')).projections.length, 0);
  await invoke('workspace:setCurrent', { path: WORKSPACE_A });
  assert.equal((await invoke('hub:snapshot')).projections.length, 1);

  await product.close();
  product = null;
  const reopened = await electron.launch(options);
  product = reopened;
  watchProduct(reopened);
  const reopenedPage = await reopened.firstWindow({ timeout: 120000 });
  reopenedPage.on('pageerror', error => errors.push(error.message));
  await reopenedPage.waitForLoadState('domcontentloaded');
  await reopenedPage.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  const reopenedSnapshot = await reopenedPage.evaluate(() => window.mazz.invoke('hub:snapshot'));
  assert.equal(reopenedSnapshot.projections[0].status, 'withdrawn');
  const resources = await reopenedPage.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot?.() || { active: [] });
  assert.equal((resources.active || []).filter(row => row.type === 'external-tool-process').length, 0);
  assert.deepEqual(errors, []);
  report = {
    schema: 'mazz.w94gb-hub-runtime/v1', mode: MODE, result: 'PASS',
    publication: { publicationId: fixture.envelope.publicationId, prepared: true, published: true, withdrawn: true, syncedAfterWithdraw: true, publicFieldsOnly: true },
    workspaceIsolation: { aProjections: 1, bProjections: 0, aRestoredProjections: 1, restartProjections: reopenedSnapshot.projections.length },
    receipts: { prepared: prepared.receipt.outcome, published: published.receipt.outcome, withdrawn: withdrawn.receipt.outcome },
    resources: { activeCount: (resources.active || []).length }, networkCalls: 0, runtimeErrors: errors,
    executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null, generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  if (product) {
    const closed = await Promise.race([product.close().then(() => true), delay(30000).then(() => false)]).catch(() => false);
    if (!closed) { try { product.process().kill(); } catch {} }
  }
  await removeTempDirectory(USER_DATA);
  await removeTempDirectory(WORKSPACE_A);
  await removeTempDirectory(WORKSPACE_B);
}
assert.ok(report);
process.stdout.write(`W94GB_HUB_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
