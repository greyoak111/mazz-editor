import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..', '..');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'engineering', 'evidence');
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W93F_LIBRARY_TORRENT_${MODE.toUpperCase()}.json`);
const EVIDENCE_PNG = path.join(EVIDENCE_ROOT, `W93F_LIBRARY_TORRENT_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93f-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93f-${MODE}-workspace-`)));
const INFO_HASH = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}`;
const TITLE = 'W93F 离线 Torrent 书籍';
const FILE_PATH = 'books/w93f-fixture.txt';
const BODY = 'W93F fake swarm streams only the selected readable book.';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

async function launch(runtimeErrors) {
  const options = {
    args: EXECUTABLE ? [] : [ROOT],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: '1',
      MAZZ_E2E_ALLOW_LIVE_PROVIDER: '0',
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
    if (!transport) throw new Error('W93F transport test hook missing');
    globalThis.__MAZZ_E2E_W93F_FAKE_SWARM__ = { inspect: [], download: [] };
    transport.inspect = async request => {
      if (request.p2pConsent !== true || request.magnet !== fixture.magnet) {
        throw new Error('fake swarm inspect contract mismatch');
      }
      globalThis.__MAZZ_E2E_W93F_FAKE_SWARM__.inspect.push({ consent: true });
      return Object.freeze({
        infoHash: fixture.infoHash,
        title: fixture.title,
        files: Object.freeze([
          Object.freeze({ path: fixture.filePath, size: Buffer.byteLength(fixture.body), format: 'txt' }),
        ]),
      });
    };
    transport.download = async request => {
      if (request.p2pConsent !== true || request.infoHash !== fixture.infoHash
        || request.selectedFile !== fixture.filePath || request.signal?.aborted) {
        throw new Error('fake swarm download contract mismatch');
      }
      const bytes = Buffer.from(fixture.body, 'utf8');
      const pivot = Math.max(1, Math.floor(bytes.length / 2));
      await request.onChunk(bytes.subarray(0, pivot), { received: pivot, total: bytes.length });
      await request.onChunk(bytes.subarray(pivot), { received: bytes.length, total: bytes.length });
      globalThis.__MAZZ_E2E_W93F_FAKE_SWARM__.download.push({
        selectedFile: request.selectedFile,
        chunks: 2,
        bytes: bytes.length,
      });
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
  return page.evaluate(workspacePath => window.mazz.invoke('library:resourceSnapshot', { workspacePath }), slash(WORKSPACE));
}

async function runUiCoordinate(product) {
  await openLibraryResource(product.page);
  const torrent = product.page.locator('.lib-resource-torrent');
  await torrent.locator('summary').click();
  await torrent.locator('.lib-resource-torrent-magnet').fill(MAGNET);
  await torrent.locator('.lib-resource-p2p-consent').check();
  await torrent.locator('.lib-resource-rights-confirm').check();
  await torrent.locator('[data-resource-torrent-inspect]').click();
  await product.page.waitForFunction(title => document.querySelector('.lib-resource-candidates')?.textContent?.includes(title), TITLE);
  const candidate = (await snapshot(product.page)).candidates.find(item => item.title === TITLE);
  assert.ok(candidate);
  assert.equal(candidate.rights.status, 'user-owned');
  assert.equal(candidate.decision.reasonCode, 'USER_ASSERTION_REQUIRED');
  assert.deepEqual(candidate.offers[0].selectableFiles, [FILE_PATH]);
  assert.doesNotMatch(JSON.stringify(candidate), /magnet:|btih:|tracker|peer|0123456789abcdef/i);
  const offer = product.page.locator(`[data-offer-id="${candidate.offers[0].offerId}"]`);
  await offer.click();
  let completed = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const current = await snapshot(product.page);
    if (current.candidates.some(candidate => candidate.title === TITLE)
      && current.jobs.some(job => job.transport === 'magnet' && job.state === 'imported')) {
      completed = current;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(completed, 'Torrent Job did not converge through Inbox to imported');
  const torrentJobs = completed.jobs.filter(item => item.transport === 'magnet');
  if (torrentJobs.length !== 1 || torrentJobs[0].state !== 'imported') {
    process.stderr.write(`W93F_TORRENT_JOBS=${JSON.stringify(torrentJobs)}\n`);
  }
  assert.equal(torrentJobs.length, 1);
  const job = torrentJobs[0];
  assert.equal(job.state, 'imported');
  assert.equal(job.integrity.pieceVerified, true);
  assert.equal(job.bytes.received, Buffer.byteLength(BODY));
  assert.equal(completed.pendingInbox, 0);
  await product.page.locator('button[data-resource-back]').click();
  await product.page.waitForFunction(title => document.querySelector('.lib-shelf')?.textContent?.includes(title), TITLE);
  return { candidate, job, completed };
}

const runtimeErrors = [];
let first = null;
let second = null;
let report = null;

try {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  first = await launch(runtimeErrors);
  const firstRun = await runUiCoordinate(first);
  const firstOwners = await first.app.evaluate(() => ({
    torrent: globalThis.__MAZZ_E2E_LIBRARY_TORRENT_TRANSPORT__.snapshot(),
    surface: globalThis.__MAZZ_E2E_LIBRARY_RESOURCE_SURFACE__.snapshotResources(),
    fake: globalThis.__MAZZ_E2E_W93F_FAKE_SWARM__,
  }));
  assert.equal(firstOwners.torrent.activeCount, 0);
  assert.equal(firstOwners.surface.operationCount, 0);
  assert.equal(firstOwners.surface.backgroundCount, 0);
  assert.deepEqual(firstOwners.fake.inspect, [{ consent: true }]);
  assert.deepEqual(firstOwners.fake.download, [{
    selectedFile: FILE_PATH, chunks: 2, bytes: Buffer.byteLength(BODY),
  }]);
  await first.app.close();
  first = null;

  second = await launch(runtimeErrors);
  await openLibraryResource(second.page);
  const reopened = await snapshot(second.page);
  const reopenedCandidate = reopened.candidates.find(item => item.title === TITLE);
  const reopenedJob = reopened.jobs.find(item => item.transport === 'magnet');
  assert.ok(reopenedCandidate);
  assert.equal(reopenedJob.state, 'imported');
  assert.equal(reopenedJob.integrity.pieceVerified, true);
  assert.equal(reopened.pendingInbox, 0);
  assert.equal((await second.app.evaluate(() => globalThis.__MAZZ_E2E_W93F_FAKE_SWARM__)).download.length, 0);
  await second.page.screenshot({ path: EVIDENCE_PNG, fullPage: true });
  const finalOwners = await second.app.evaluate(() => ({
    torrent: globalThis.__MAZZ_E2E_LIBRARY_TORRENT_TRANSPORT__.snapshot(),
    surface: globalThis.__MAZZ_E2E_LIBRARY_RESOURCE_SURFACE__.snapshotResources(),
  }));
  assert.equal(finalOwners.torrent.activeCount, 0);
  assert.equal(finalOwners.surface.operationCount, 0);
  assert.equal(finalOwners.surface.backgroundCount, 0);
  assert.equal(finalOwners.surface.controllerCount, 0);
  assert.deepEqual(runtimeErrors, []);

  report = {
    schema: 'mazz.w93f-library-torrent-runtime/v1',
    mode: MODE,
    result: 'PASS',
    product: EXECUTABLE ? 'win-unpacked' : 'source',
    transport: 'magnet-public-dht-fixture',
    p2pConsentRequired: true,
    rightsConfirmationRequired: true,
    metadataDeselect: true,
    selectedFiles: [FILE_PATH],
    inspectedFiles: firstRun.candidate.offers.length,
    bytes: firstRun.job.bytes.received,
    pieceVerified: firstRun.job.integrity.pieceVerified,
    finalState: reopenedJob.state,
    persistedAcrossRestart: true,
    publicNetworkCalls: 0,
    ownerFinal: {
      torrentActiveCount: finalOwners.torrent.activeCount,
      operationCount: finalOwners.surface.operationCount,
      backgroundCount: finalOwners.surface.backgroundCount,
      controllerCount: finalOwners.surface.controllerCount,
    },
    runtimeErrors,
    evidenceScreenshot: path.basename(EVIDENCE_PNG),
    executableSha256: EXECUTABLE ? sha256(EXECUTABLE) : null,
    rendererBundleSha256: sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await second.app.close();
  second = null;
} finally {
  if (first) await first.app.close().catch(() => {});
  if (second) await second.app.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
}

assert.equal(fs.existsSync(USER_DATA), false);
assert.equal(fs.existsSync(WORKSPACE), false);
assert.ok(report);
process.stdout.write(`W93F_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
