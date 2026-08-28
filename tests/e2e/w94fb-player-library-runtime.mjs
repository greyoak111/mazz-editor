import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'engineering', 'evidence');
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W94FB_PLAYER_LIBRARY_${MODE.toUpperCase()}.json`);
const EVIDENCE_PNG = path.join(EVIDENCE_ROOT, `W94FB_PLAYER_LIBRARY_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94fb-${MODE}-user-`)));
const WORKSPACE_A = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94fb-${MODE}-workspace-a-`)));
const WORKSPACE_B = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94fb-${MODE}-workspace-b-`)));
const INFO_HASH = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}`;
const TITLE = 'W94Fb Player 书籍桥接';
const FILE_PATH = 'books/w94fb-fixture.txt';
const BODY = 'W94Fb bridge uses the existing W93 Candidate and acquisition owner.';

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const slash = value => String(value || '').replace(/\\/g, '/');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(runtimeErrors) {
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE_A, MAZZ_E2E_DISABLE_GPU: '1', MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0',
    },
    timeout: 120000,
  };
  if (EXECUTABLE) options.executablePath = EXECUTABLE;
  const app = await electron.launch(options);
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!/Autofill|SharedArrayBuffer|ERR_FILE_NOT_FOUND|ffmpeg_common/i.test(text)) {
      runtimeErrors.push(`[console.error] ${text}`);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz && window.MazzCommands && window.MazzShell));
  await app.evaluate(({ app }, fixture) => {
    const transport = globalThis.__MAZZ_E2E_LIBRARY_TORRENT_TRANSPORT__;
    if (!transport) throw new Error('W94Fb library torrent transport hook missing');
    globalThis.__MAZZ_E2E_W94FB_FAKE_SWARM__ = { inspect: [], download: [] };
    transport.inspect = async request => {
      if (request.p2pConsent !== true || request.magnet !== fixture.magnet) throw new Error('inspect contract mismatch');
      globalThis.__MAZZ_E2E_W94FB_FAKE_SWARM__.inspect.push(true);
      return Object.freeze({ infoHash: fixture.infoHash, title: fixture.title, files: Object.freeze([
        Object.freeze({ path: fixture.filePath, size: Buffer.byteLength(fixture.body), format: 'txt' }),
      ]) });
    };
    transport.download = async request => {
      if (request.p2pConsent !== true || request.infoHash !== fixture.infoHash
        || request.selectedFile !== fixture.filePath || request.signal?.aborted) throw new Error('download contract mismatch');
      const bytes = Buffer.from(fixture.body, 'utf8');
      await request.onChunk(bytes, { received: bytes.length, total: bytes.length });
      globalThis.__MAZZ_E2E_W94FB_FAKE_SWARM__.download.push(bytes.length);
      return Object.freeze({ bytes: bytes.length, total: bytes.length, pieceVerified: true });
    };
  }, { magnet: MAGNET, infoHash: INFO_HASH, title: TITLE, filePath: FILE_PATH, body: BODY });
  return { app, page };
}

async function openLibraryResource(page) {
  await page.evaluate(async () => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
    ]);
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    await window.MazzCommands.execute('file.newLibrary');
  });
  await page.waitForFunction(() => {
    const binding = window.__activeLibraryCtl?.repositoryBinding;
    return Boolean(binding?.repository?.identity?.canonical && !binding.retiring && binding.pending?.size === 0);
  });
  await page.locator('button[data-a="view-resource"]').click();
  await page.waitForFunction(() => {
    const view = document.querySelector('.lib-resource-view');
    return view && getComputedStyle(view).display === 'flex'
      && !view.querySelector('.lib-resource-summary')?.textContent?.includes('正在读取');
  });
}

async function snapshot(page) {
  return page.evaluate(workspacePath => window.mazz.invoke('library:resourceSnapshot', { workspacePath }), slash(WORKSPACE_A));
}

async function bridgeOnce(product) {
  await openLibraryResource(product.page);
  const torrent = product.page.locator('.lib-resource-torrent');
  await torrent.locator('summary').click();
  await torrent.locator('.lib-resource-torrent-magnet').fill(MAGNET);
  await torrent.locator('.lib-resource-p2p-consent').check();
  await torrent.locator('.lib-resource-rights-confirm').check();
  await torrent.locator('[data-resource-torrent-inspect]').click();
  await product.page.waitForFunction(title => document.querySelector('.lib-resource-candidates')?.textContent?.includes(title), TITLE);
  const before = await snapshot(product.page);
  const candidate = before.candidates.find(item => item.title === TITLE);
  assert.ok(candidate);
  assert.equal(candidate.rights.status, 'user-owned');
  assert.deepEqual(candidate.offers[0].selectableFiles, [FILE_PATH]);
  const result = await product.page.evaluate(({ candidateId, candidateFingerprint, offerId, selectedFile }) =>
    window.mazz.invoke('tor:bridgeLibrary', {
      candidateId, candidateFingerprint, offerId, selectedFile,
      p2pConsent: true, rightsConfirmed: true,
    }), {
    workspacePath: slash(WORKSPACE_A), candidateId: candidate.candidateId,
    candidateFingerprint: candidate.candidateFingerprint, offerId: candidate.offers[0].offerId, selectedFile: FILE_PATH,
  });
  assert.equal(result.bridge, 'player-w93');
  assert.match(result.session.transportRef, /^transport:[a-f0-9]{64}$/);
  assert.deepEqual(result.session.sourceRefs.slice(0, 3), [
    `candidate:${candidate.candidateId}`, `offer:${candidate.offers[0].offerId}`, `job:${result.job.jobId}`,
  ]);
  const startedAt = Date.now();
  let converged = null;
  while (Date.now() - startedAt < 30000) {
    const current = await snapshot(product.page);
    if (current.jobs.some(job => job.jobId === result.job.jobId && job.state === 'imported')) { converged = current; break; }
    await delay(50);
  }
  assert.ok(converged, 'bridged W93 Job did not converge');
  const sessions = await product.page.evaluate(() => window.mazz.invoke('tor:sessions'));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].state, 'completed');
  assert.equal((await product.app.evaluate(() => globalThis.__MAZZ_E2E_TORRENT_DAEMON__.jobs.size)), 0);
  return { candidate, result, job: converged.jobs.find(job => job.jobId === result.job.jobId), sessions };
}

const runtimeErrors = [];
let first = null;
let second = null;
let report = null;
try {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({ workspace: WORKSPACE_A, closeBehavior: 'quit', 'agreement.noMore': true }, null, 2)}\n`, 'utf8');
  first = await launch(runtimeErrors);
  const bridge = await bridgeOnce(first);
  await first.page.evaluate(workspacePath => window.mazz.invoke('workspace:add', { path: workspacePath, name: 'W94Fb B' }), WORKSPACE_B);
  await first.page.evaluate(workspacePath => window.mazz.invoke('workspace:setCurrent', { path: workspacePath }), WORKSPACE_B);
  assert.deepEqual(await first.page.evaluate(() => window.mazz.invoke('tor:sessions')), []);
  const bSnapshot = await first.page.evaluate(workspacePath => window.mazz.invoke('library:resourceSnapshot', { workspacePath }), slash(WORKSPACE_B));
  assert.equal(bSnapshot.candidates.length, 0);
  await first.page.evaluate(workspacePath => window.mazz.invoke('workspace:setCurrent', { path: workspacePath }), WORKSPACE_A);
  const aSessions = await first.page.evaluate(() => window.mazz.invoke('tor:sessions'));
  assert.equal(aSessions.length, 1);
  await first.app.close();
  first = null;

  second = await launch(runtimeErrors);
  await openLibraryResource(second.page);
  const reopened = await snapshot(second.page);
  const reopenedJob = reopened.jobs.find(job => job.transport === 'magnet');
  assert.ok(reopenedJob);
  assert.equal(reopenedJob.state, 'imported');
  const reopenedSessions = await second.page.evaluate(() => window.mazz.invoke('tor:sessions'));
  assert.equal(reopenedSessions.length, 1);
  assert.equal(reopenedSessions[0].state, 'completed');
  assert.equal((await second.app.evaluate(() => globalThis.__MAZZ_E2E_TORRENT_DAEMON__.jobs.size)), 0);
  assert.deepEqual((await second.app.evaluate(() => globalThis.__MAZZ_E2E_W94FB_FAKE_SWARM__)).download, []);
  await second.page.screenshot({ path: EVIDENCE_PNG, fullPage: true });
  const owners = await second.app.evaluate(() => ({
    libraryTorrent: globalThis.__MAZZ_E2E_LIBRARY_TORRENT_TRANSPORT__.snapshot(),
    surface: globalThis.__MAZZ_E2E_LIBRARY_RESOURCE_SURFACE__.snapshotResources(),
  }));
  assert.equal(owners.libraryTorrent.activeCount, 0);
  assert.equal(owners.surface.operationCount, 0);
  assert.equal(owners.surface.backgroundCount, 0);
  assert.deepEqual(runtimeErrors, []);
  report = {
    schema: 'mazz.w94fb-player-library-runtime/v1', mode: MODE, result: 'PASS', product: EXECUTABLE ? 'win-unpacked' : 'source',
    explicitCandidateBridge: true, playerNetworkOwnerForLibraryJob: false,
    candidateId: bridge.candidate.candidateId, candidateFingerprint: bridge.candidate.candidateFingerprint,
    jobId: bridge.result.job.jobId, finalJobState: reopenedJob.state, finalSessionState: reopenedSessions[0].state,
    workspaceIsolation: { aSessions: 1, bSessions: 0, aRestoredSessions: aSessions.length },
    p2pConsentRequired: true, rightsConfirmationRequired: true, publicNetworkCalls: 0,
    ownerFinal: { torrentActiveCount: owners.libraryTorrent.activeCount, operationCount: owners.surface.operationCount, backgroundCount: owners.surface.backgroundCount },
    runtimeErrors, evidenceScreenshot: path.basename(EVIDENCE_PNG), executableSha256: EXECUTABLE ? sha256(EXECUTABLE) : null,
    rendererBundleSha256: sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')), generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await second.app.close();
  second = null;
} finally {
  if (first) await first.app.close().catch(() => {});
  if (second) await second.app.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(WORKSPACE_A, { recursive: true, force: true });
  fs.rmSync(WORKSPACE_B, { recursive: true, force: true });
}
assert.ok(report);
process.stdout.write(`W94FB_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
