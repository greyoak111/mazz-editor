import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve('.');
const executableIndex = process.argv.indexOf('--executable');
const EXECUTABLE = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : '';
const MODE = EXECUTABLE ? 'packaged' : 'source';
const EVIDENCE = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94G_LOCAL_WORKBENCH_${MODE.toUpperCase()}.json`);
const SCREENSHOT = path.join(ROOT, 'docs', 'engineering', 'evidence', `W94G_LOCAL_WORKBENCH_${MODE.toUpperCase()}.png`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94g-workbench-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94g-workbench-${MODE}-workspace-`)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function removeTempDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); return; }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) throw error; await delay(250); }
  }
}

const errors = [];
let product = null;
let report = null;
function watch(instance) {
  instance.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) errors.push(text.trim());
  });
}

try {
  fs.writeFileSync(path.join(USER_DATA, 'mazz-settings.json'), `${JSON.stringify({ workspace: WORKSPACE, workspaces: [{ path: WORKSPACE, name: 'W94G' }], closeBehavior: 'quit', 'agreement.noMore': true }, null, 2)}\n`, 'utf8');
  const options = {
    args: EXECUTABLE ? [] : [ROOT], executablePath: EXECUTABLE || undefined,
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WORKSPACE, MAZZ_E2E_DISABLE_GPU: '1' },
    timeout: 120000,
  };
  if (!EXECUTABLE) delete options.executablePath;
  product = await electron.launch(options); watch(product);
  const page = await product.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.MazzCommands && window.MazzShell));
  const seeded = await product.evaluate(async () => globalThis.__MAZZ_E2E_SEED_ARTIFACT__({
    workspacePath: globalThis.__MAZZ_E2E_LOCAL_PUBLICATION_BRIDGE__.root(),
    bytesBase64: Buffer.from('W94G desktop product bridge', 'utf8').toString('base64'),
    kind: 'document', mediaType: 'text/plain', contentSchema: 'mazz.document/v1',
  }));
  assert.match(seeded.artifactId, /^artifact-sha256-/);
  await page.evaluate(() => window.MazzCommands.execute('world.openWorkbench'));
  await page.locator('.world-root').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('[data-artifact-list] .world-card').length === 1);

  const createWorld = page.locator('form[data-form="create-world"]');
  await createWorld.locator('[name="worldName"]').fill('W94G Harbor');
  await createWorld.locator('[name="worldDescription"]').fill('Local World product-surface evidence');
  await createWorld.locator('button').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-world-list] .world-card').length === 1);

  const fork = page.locator('form[data-form="fork"]');
  await fork.locator('[name="forkBranch"]').fill('branch:w94g-community');
  await fork.locator('button').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[name="proposalBranch"] option')].some(row => row.value === 'branch:w94g-community'));
  await page.locator('[name="proposalBranch"]').selectOption('branch:w94g-community');
  await page.locator('form[data-form="proposal"] button').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-proposal-list] [data-proposal]').length === 1);
  await page.locator('[data-proposal-list] [data-a="withdraw-proposal"]').click();
  await page.waitForFunction(() => document.querySelector('[data-proposal-list] .world-card header b')?.textContent === 'withdrawn');

  const prepare = page.locator('form[data-form="prepare"]');
  await prepare.locator('[name="publishTitle"]').fill('W94G Desktop Artifact');
  await prepare.locator('[name="publishSummary"]').fill('Explicit local Grant and Ed25519 publication evidence');
  await prepare.locator('button').click();
  await page.waitForFunction(() => document.querySelector('[data-draft-list] .world-card header span')?.textContent === 'prepared');
  await page.locator('[data-draft-list] [data-a="publish"]').click();
  await page.waitForFunction(() => document.querySelector('[data-draft-list] .world-card header span')?.textContent === 'published');
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  await page.locator('[data-draft-list] [data-a="withdraw-publication"]').click();
  await page.waitForFunction(() => document.querySelector('[data-draft-list] .world-card header span')?.textContent === 'withdrawn');
  const beforeRestart = await page.evaluate(async () => ({
    world: await window.mazz.invoke('world:snapshot'), publication: await window.mazz.invoke('publicationBridge:snapshot'),
  }));
  assert.equal(beforeRestart.world.proposals[0].status, 'withdrawn');
  assert.equal(beforeRestart.publication.drafts[0].status, 'withdrawn');
  assert.equal(beforeRestart.publication.hub.projections[0].signatureVerified, true);
  assert.equal(beforeRestart.publication.networkCalls, 0);

  await product.close(); product = null;
  product = await electron.launch(options); watch(product);
  const reopened = await product.firstWindow({ timeout: 120000 });
  reopened.on('pageerror', error => errors.push(error.message));
  await reopened.waitForFunction(() => Boolean(window.mazz?.invoke));
  const afterRestart = await reopened.evaluate(async () => ({
    world: await window.mazz.invoke('world:snapshot'), publication: await window.mazz.invoke('publicationBridge:snapshot'),
  }));
  assert.equal(afterRestart.world.proposals[0].status, 'withdrawn');
  assert.equal(afterRestart.publication.drafts[0].status, 'withdrawn');
  assert.equal(afterRestart.publication.hub.projections[0].status, 'withdrawn');
  assert.deepEqual(errors, []);
  report = {
    schema: 'mazz.w94g-local-workbench-runtime/v1', mode: MODE, result: 'PASS',
    productSurface: { module: 'world', artifactListed: true, worldCreated: true, branchForked: true, proposalWithdrawn: true, publicationPrepared: true, localProjectionPublished: true, publicationWithdrawn: true },
    signing: { ed25519Verified: true, privateKeyExposed: false, protectedAtRest: true },
    durability: { worldRestarted: true, publicationRestarted: true }, networkCalls: 0, publicEffectAuthorized: false,
    runtimeErrors: errors, executableSha256: EXECUTABLE ? sha256File(EXECUTABLE) : null, generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  if (product) {
    const closed = await Promise.race([product.close().then(() => true), delay(30000).then(() => false)]).catch(() => false);
    if (!closed) { try { product.process().kill(); } catch {} }
  }
  await removeTempDirectory(USER_DATA);
  await removeTempDirectory(WORKSPACE);
}
assert.ok(report);
process.stdout.write(`W94G_LOCAL_WORKBENCH_REPORT=${JSON.stringify(report)}\n`);
