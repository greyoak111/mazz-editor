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
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W93E_LIBRARY_RESOURCE_${MODE.toUpperCase()}.json`);
const EVIDENCE_PNG = path.join(EVIDENCE_ROOT, `W93E_LIBRARY_RESOURCE_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93e-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w93e-${MODE}-workspace-`)));
const TITLE = 'W93E 离线资源候选';
const AUTHOR = 'Fixture Author';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function catalogFacts() {
  const root = path.join(WORKSPACE, '书库', '.resources');
  const candidates = path.join(root, 'candidates');
  const jobs = path.join(root, 'jobs');
  return {
    candidateRecords: fs.existsSync(candidates)
      ? fs.readdirSync(candidates).filter(name => name.endsWith('.json')).length : 0,
    jobRecords: fs.existsSync(jobs)
      ? fs.readdirSync(jobs).filter(name => name.endsWith('.json')).length : 0,
  };
}

async function launchProduct(runtimeErrors) {
  const launch = {
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
  if (EXECUTABLE) launch.executablePath = EXECUTABLE;
  const app = await electron.launch(launch);
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
  return { app, page };
}

async function openResourcePage(page) {
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
      && !view.classList.contains('is-loading')
      && !view.querySelector('.lib-resource-summary')?.textContent?.includes('正在读取');
  });
}

async function resourceSnapshot(page) {
  return page.evaluate(workspacePath => window.mazz.invoke('library:resourceSnapshot', { workspacePath }), slash(WORKSPACE));
}

async function closeProduct(app) {
  await app.close();
}

const runtimeErrors = [];
let first = null;
let second = null;
let report = null;

try {
  assert.equal(EXECUTABLE ? fs.existsSync(EXECUTABLE) : fs.existsSync(path.join(ROOT, 'renderer', 'dist', 'app.js')), true);
  first = await launchProduct(runtimeErrors);
  await openResourcePage(first.page);

  const initial = await resourceSnapshot(first.page);
  assert.equal(initial.candidates.length, 0);
  assert.equal(initial.jobs.length, 0);
  assert.equal(initial.contactConfigured, false);
  assert.deepEqual(initial.resource, { discoveryActive: 0, catalogActive: 0, backgroundActive: 0 });

  const manual = first.page.locator('.lib-resource-manual');
  await manual.locator('summary').click();
  await manual.locator('.lib-resource-manual-url').fill('https://example.org/w93e-fixture.epub');
  await manual.locator('.lib-resource-manual-title').fill(TITLE);
  await manual.locator('.lib-resource-manual-authors').fill(AUTHOR);
  await manual.locator('.lib-resource-manual-language').fill('zh-CN');
  await manual.locator('.lib-resource-manual-format').selectOption('epub');
  await manual.locator('[data-resource-add-manual]').click();
  await first.page.waitForFunction(title => {
    const card = document.querySelector('.lib-resource-card');
    return card?.textContent?.includes(title) && card.textContent.includes('权利未知');
  }, TITLE);

  const afterManual = await resourceSnapshot(first.page);
  assert.equal(afterManual.candidates.length, 1);
  assert.equal(afterManual.candidates[0].title, TITLE);
  assert.equal(afterManual.candidates[0].rights.status, 'unknown');
  assert.equal(afterManual.candidates[0].decision.outcome, 'awaiting-rights');
  assert.equal(afterManual.candidates[0].offers[0].transport, 'https');
  assert.equal(await first.page.locator('[data-resource-acquire]').isDisabled(), true);

  const acquired = await first.page.evaluate(({ workspacePath, candidate }) => window.mazz.invoke('library:resourceAcquire', {
    workspacePath,
    candidateId: candidate.candidateId,
    candidateFingerprint: candidate.candidateFingerprint,
    offerId: candidate.offers[0].offerId,
    intentId: 'intent-w93e-offline-runtime',
  }), { workspacePath: slash(WORKSPACE), candidate: afterManual.candidates[0] });
  assert.equal(acquired.decision.outcome, 'awaiting-rights');
  assert.equal(acquired.job.state, 'awaiting-rights');
  const afterAcquire = await resourceSnapshot(first.page);
  assert.equal(afterAcquire.jobs.length, 1);
  assert.equal(afterAcquire.jobs[0].state, 'awaiting-rights');
  assert.deepEqual(afterAcquire.resource, { discoveryActive: 0, catalogActive: 0, backgroundActive: 0 });

  await first.page.locator('[data-resource-repair]').click();
  await first.page.waitForFunction(() => !document.querySelector('.lib-resource-view')?.classList.contains('is-loading'));
  const idleBeforeRestart = await first.app.evaluate(() => globalThis.__MAZZ_E2E_LIBRARY_RESOURCE_SURFACE__.snapshotResources());
  assert.deepEqual({
    operationCount: idleBeforeRestart.operationCount,
    backgroundCount: idleBeforeRestart.backgroundCount,
    controllerCount: idleBeforeRestart.controllerCount,
  }, { operationCount: 0, backgroundCount: 0, controllerCount: 0 });
  assert.deepEqual(catalogFacts(), { candidateRecords: 1, jobRecords: 1 });
  await closeProduct(first.app);
  first = null;

  second = await launchProduct(runtimeErrors);
  await openResourcePage(second.page);
  const reopened = await resourceSnapshot(second.page);
  assert.equal(reopened.candidates.length, 1);
  assert.equal(reopened.candidates[0].title, TITLE);
  assert.equal(reopened.candidates[0].rights.status, 'unknown');
  assert.equal(reopened.jobs.length, 1);
  assert.equal(reopened.jobs[0].state, 'awaiting-rights');
  assert.deepEqual(reopened.resource, { discoveryActive: 0, catalogActive: 0, backgroundActive: 0 });
  await second.page.locator('.lib-resource-manual').evaluate(element => { element.open = false; });
  await second.page.screenshot({ path: EVIDENCE_PNG, fullPage: true });

  const finalSurface = await second.app.evaluate(() => globalThis.__MAZZ_E2E_LIBRARY_RESOURCE_SURFACE__.snapshotResources());
  assert.deepEqual({
    operationCount: finalSurface.operationCount,
    backgroundCount: finalSurface.backgroundCount,
    controllerCount: finalSurface.controllerCount,
  }, { operationCount: 0, backgroundCount: 0, controllerCount: 0 });
  assert.deepEqual(runtimeErrors, []);

  report = {
    schema: 'mazz.w93e-library-resource-runtime/v1',
    mode: MODE,
    result: 'PASS',
    product: EXECUTABLE ? 'win-unpacked' : 'source',
    candidateCount: reopened.candidates.length,
    candidateRights: reopened.candidates[0].rights.status,
    candidateDecision: reopened.candidates[0].decision.outcome,
    jobCount: reopened.jobs.length,
    jobState: reopened.jobs[0].state,
    persistedAcrossRestart: true,
    acquireButtonDisabled: true,
    transportStarted: false,
    repairInvoked: true,
    catalogFacts: catalogFacts(),
    resources: {
      discoveryActive: reopened.resource.discoveryActive,
      catalogActive: reopened.resource.catalogActive,
      backgroundActive: reopened.resource.backgroundActive,
      operationCount: finalSurface.operationCount,
      controllerCount: finalSurface.controllerCount,
    },
    runtimeErrors,
    evidenceScreenshot: path.basename(EVIDENCE_PNG),
    executableSha256: EXECUTABLE ? sha256(EXECUTABLE) : null,
    rendererBundleSha256: sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  await closeProduct(second.app);
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
process.stdout.write(`W93E_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
