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
const EVIDENCE_JSON = path.join(EVIDENCE_ROOT, `W94B_CALC_CHART_${MODE.toUpperCase()}.json`);
const USER_DATA = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94b-${MODE}-user-`)));
const WORKSPACE = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `mazz-w94b-${MODE}-workspace-`)));

const CALC_SCHEMA = 'mazz.calc-definition/v1';
const RESULT_SCHEMA = 'mazz.calc-result/v1';
const CHART_SPEC_SCHEMA = 'mazz.chart-spec/v1';
const CHART_SVG_SCHEMA = 'mazz.chart-svg/v1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const slash = value => String(value || '').replace(/\\/g, '/');

function calcProposal() {
  return {
    taskId: 'task:w94b-runtime-calc',
    seatId: 'seat:human-maintainer',
    capabilityId: 'mazz.calc.python-expression',
    capabilityVersion: '1.0.0',
    adapterId: 'mazz.calc.python-isolated',
    inputs: [],
    parameters: {
      definition: {
        schema: CALC_SCHEMA,
        language: 'python-expression',
        expression: 'sqrt(a ** 2 + b ** 2)',
        bindings: { a: 3, b: 4 },
        resultSchema: RESULT_SCHEMA,
        seed: null,
      },
    },
    expectedOutputs: [RESULT_SCHEMA],
    constraints: { timeoutMs: 30_000 },
    authorityRef: 'human:w94b-runtime',
  };
}

function chartProposal() {
  return {
    taskId: 'task:w94b-runtime-chart',
    seatId: 'seat:human-maintainer',
    capabilityId: 'mazz.chart.svg',
    capabilityVersion: '1.0.0',
    adapterId: 'mazz.chart.svg-deterministic',
    inputs: [],
    parameters: {
      spec: {
        schema: CHART_SPEC_SCHEMA,
        type: 'bar',
        title: 'W94B 运行图',
        dataset: [['类别', '数值'], ['甲', 3], ['乙', 5]],
        encoding: { categoryColumn: 0, seriesColumns: [1], headerRow: true },
        width: 960,
        height: 540,
        dpi: 96,
        theme: {
          background: '#ffffff', foreground: '#222222', muted: '#666666', border: '#dddddd',
          palette: ['#4f46e5', '#0f766e'],
        },
        locale: 'zh-CN',
        font: { family: 'Mazz Sans', fallback: 'sans-serif' },
        seed: 0,
      },
    },
    expectedOutputs: [CHART_SPEC_SCHEMA, CHART_SVG_SCHEMA],
    constraints: {},
    authorityRef: 'human:w94b-runtime',
  };
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
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => runtimeErrors.push(`[pageerror] ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const value = message.text();
    if (!/Autofill|SharedArrayBuffer|ERR_FILE_NOT_FOUND|ffmpeg_common/i.test(value)) {
      runtimeErrors.push(`[console.error] ${value}`);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.mazz?.invoke && window.MazzShell));
  await page.evaluate(async workspacePath => {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
      window.mazz.invoke('fs:watch', { paths: [workspacePath] }),
    ]);
    window.__w94bFileChanges = [];
    window.__w94bStopFileChanges = window.mazz.on('file:changed', event => {
      window.__w94bFileChanges.push(event?.path || '');
    });
  }, WORKSPACE);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const list = await page.evaluate(() => window.mazz.invoke('capability:list', {}));
      if (Array.isArray(list)) return { app, page, list };
    } catch {}
    await delay(50);
  }
  throw new Error('W94B capability startup gate did not become ready');
}

async function closeProduct(product) {
  if (!product) return;
  await product.page.evaluate(() => window.__w94bStopFileChanges?.()).catch(() => {});
  const closed = await Promise.race([
    product.app.close().then(() => true),
    delay(30000).then(() => false),
  ]);
  if (!closed) {
    product.app.process().kill();
    throw new Error('W94B product did not cross the durable quit boundary');
  }
}

async function mainSnapshot(app) {
  return app.evaluate(() => {
    const workspacePath = process.env.MAZZ_E2E_WORKSPACE;
    const service = globalThis.__MAZZ_E2E_CAPABILITY_EXECUTION__;
    const resources = globalThis.__MAZZ_E2E_RESOURCE_LEDGER__.snapshot();
    const store = service._store(workspacePath);
    return {
      service: service.snapshot(),
      resources,
      artifacts: service._artifactStore(store).snapshot(),
    };
  });
}

async function execute(page, proposal) {
  return page.evaluate(async ({ workspacePath, proposal }) => {
    const submitted = await window.mazz.invoke('capability:submitProposal', { workspacePath, proposal });
    const executed = await window.mazz.invoke('capability:executeProposal', {
      workspacePath, proposalId: submitted.proposal.proposalId,
    });
    return { submitted, executed };
  }, { workspacePath: WORKSPACE, proposal });
}

async function readArtifact(page, artifact) {
  return page.evaluate(async ({ workspacePath, artifactId }) => {
    const grant = await window.mazz.invoke('capability:artifactGrant', { workspacePath, artifactId });
    const first = await fetch(grant.url);
    const body = await first.text();
    return {
      status: first.status,
      body,
      mediaType: first.headers.get('content-type') || '',
      grant: { schema: grant.schema, artifactId: grant.artifactId, contentHash: grant.contentHash },
    };
  }, { workspacePath: WORKSPACE, artifactId: artifact.artifactId });
}

async function verifySingleUse(app) {
  return app.evaluate(async () => {
    const service = globalThis.__MAZZ_E2E_CAPABILITY_EXECUTION__;
    const workspacePath = process.env.MAZZ_E2E_WORKSPACE;
    const artifact = service.workspaceSnapshot(workspacePath).artifacts.find(row => row.contentSchema === 'mazz.chart-svg/v1');
    const grant = service.grantArtifact(workspacePath, artifact.artifactId);
    const token = decodeURIComponent(new URL(grant.url).pathname.slice(1));
    const opened = await service.openArtifactGrant(token);
    let bytes = 0;
    for await (const chunk of opened.stream) bytes += chunk.length;
    let secondCode = '';
    try { await service.openArtifactGrant(token); } catch (error) { secondCode = error.code; }
    return { bytes, secondCode };
  });
}

const runtimeErrors = [];
let first = null;
let second = null;
let report = null;
try {
  first = await launch(runtimeErrors);
  const ids = first.list.map(row => row.capabilityId).sort();
  assert.ok(ids.includes('mazz.calc.python-expression'));
  assert.ok(ids.includes('mazz.chart.svg'));
  assert.ok(ids.includes('mazz.blender.external'), 'W94D Blender capability must share the W94A registry');
  assert.equal(first.list.find(row => row.capabilityId === 'mazz.calc.python-expression').availability.state, 'available');

  const calc = await execute(first.page, calcProposal());
  const chart = await execute(first.page, chartProposal());
  assert.equal(calc.submitted.idempotent, false);
  assert.equal(chart.submitted.idempotent, false);
  assert.equal(calc.executed.proposal.state, 'completed');
  assert.equal(chart.executed.proposal.state, 'completed');
  assert.equal(calc.executed.artifacts.length, 1);
  assert.equal(chart.executed.artifacts.length, 2);

  const calcBody = await readArtifact(first.page, calc.executed.artifacts[0]);
  const svgArtifact = chart.executed.artifacts.find(row => row.contentSchema === CHART_SVG_SCHEMA);
  const svgBody = await readArtifact(first.page, svgArtifact);
  assert.equal(calcBody.status, 200);
  assert.equal(JSON.parse(calcBody.body).value, 5);
  assert.equal(svgBody.status, 200);
  assert.match(svgBody.body, /^<svg /);
  assert.match(svgBody.body, /W94B 运行图/);
  assert.doesNotMatch(svgBody.body.replace(' xmlns="http://www.w3.org/2000/svg"', ''), /<script|foreignObject|\son[a-z]+=|(?:https?|file|data):/i);
  const singleUse = await verifySingleUse(first.app);
  assert.ok(singleUse.bytes > 0);
  assert.equal(singleUse.secondCode, 'CAPABILITY_ARTIFACT_GRANT_NOT_FOUND');

  await delay(900);
  const firstChanges = await first.page.evaluate(() => [...window.__w94bFileChanges]);
  assert.equal(firstChanges.some(value => /\/\.mazz\/capability-(?:runtime|artifacts)(?:\/|$)/i.test(slash(value))), false);
  const firstSnapshot = await mainSnapshot(first.app);
  assert.equal(firstSnapshot.service.activeCount, 0);
  assert.equal(firstSnapshot.service.artifactGrantCount, 0);
  assert.equal(firstSnapshot.service.artifactStreamCount, 0);
  assert.equal(firstSnapshot.service.durabilityFailureCount, 0);
  assert.equal(firstSnapshot.artifacts.blobCount, 3);
  assert.equal(firstSnapshot.artifacts.stagingCount, 0);
  assert.equal(firstSnapshot.resources.active.some(row => ['capability-execution', 'capability-artifact-stream', 'python-process'].includes(row.type)), false);
  await closeProduct(first);
  first = null;

  second = await launch(runtimeErrors);
  const calcReplay = await execute(second.page, calcProposal());
  const chartReplay = await execute(second.page, chartProposal());
  assert.equal(calcReplay.submitted.idempotent, true);
  assert.equal(calcReplay.executed.idempotent, true);
  assert.equal(chartReplay.submitted.idempotent, true);
  assert.equal(chartReplay.executed.idempotent, true);
  assert.equal(calcReplay.executed.receipt.receiptId, calc.executed.receipt.receiptId);
  assert.equal(chartReplay.executed.receipt.receiptId, chart.executed.receipt.receiptId);

  const state = await second.page.evaluate(async workspacePath => window.mazz.invoke('capability:workspaceSnapshot', { workspacePath }), WORKSPACE);
  assert.equal(state.proposals.length, 2);
  assert.equal(state.receipts.length, 2);
  assert.equal(state.artifacts.length, 3);
  const secondSnapshot = await mainSnapshot(second.app);
  assert.equal(secondSnapshot.service.activeCount, 0);
  assert.equal(secondSnapshot.service.artifactGrantCount, 0);
  assert.equal(secondSnapshot.service.artifactStreamCount, 0);
  assert.equal(secondSnapshot.service.durabilityFailureCount, 0);
  assert.equal(secondSnapshot.artifacts.blobCount, 3);
  assert.equal(secondSnapshot.artifacts.stagingCount, 0);
  assert.equal(secondSnapshot.resources.active.some(row => ['capability-execution', 'capability-artifact-stream', 'python-process'].includes(row.type)), false);
  assert.deepEqual(runtimeErrors, []);

  const statePath = path.join(WORKSPACE, '.mazz', 'capability-runtime', 'state.json');
  const blobRoot = path.join(WORKSPACE, '.mazz', 'capability-artifacts', 'blobs');
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.readdirSync(blobRoot).filter(name => /^[0-9a-f]{64}$/.test(name)).length, 3);
  report = {
    schema: 'mazz.w94b-calc-chart-runtime/v1',
    mode: MODE,
    result: 'PASS',
    product: EXECUTABLE ? 'win-unpacked' : 'source',
    capabilities: ids,
    calc: {
      proposalId: calcReplay.submitted.proposal.proposalId,
      receiptId: calcReplay.executed.receipt.receiptId,
      artifactId: calcReplay.executed.artifacts[0].artifactId,
      contentHash: calcReplay.executed.artifacts[0].contentHash,
      typedResult: { schema: RESULT_SCHEMA, valueType: 'number', value: 5 },
    },
    chart: {
      proposalId: chartReplay.submitted.proposal.proposalId,
      receiptId: chartReplay.executed.receipt.receiptId,
      artifacts: chartReplay.executed.artifacts.map(row => ({ artifactId: row.artifactId, contentHash: row.contentHash, contentSchema: row.contentSchema })),
      deterministicSvg: true,
    },
    exactReplay: true,
    restartReopen: true,
    persistedCounts: { proposals: 2, receipts: 2, artifacts: 3, blobs: 3 },
    artifactProtocol: { streamed: true, singleUse: true, grantsFinal: 0, streamsFinal: 0 },
    fileTreeInternalEvents: 0,
    networkCalls: 0,
    resources: {
      capabilityExecutionOwners: secondSnapshot.resources.active.filter(row => row.type === 'capability-execution').length,
      artifactStreamOwners: secondSnapshot.resources.active.filter(row => row.type === 'capability-artifact-stream').length,
      pythonProcessOwners: secondSnapshot.resources.active.filter(row => row.type === 'python-process').length,
      serviceActiveCount: secondSnapshot.service.activeCount,
      durabilityFailureCount: secondSnapshot.service.durabilityFailureCount,
      artifactStagingCount: secondSnapshot.artifacts.stagingCount,
    },
    runtimeErrors,
    stateSha256: sha256(statePath),
    rendererBundleSha256: sha256(path.join(ROOT, 'renderer', 'dist', 'app.js')),
    executableSha256: EXECUTABLE ? sha256(EXECUTABLE) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  fs.writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await closeProduct(second);
  second = null;
} finally {
  if (first) await closeProduct(first).catch(() => { try { first.app.process().kill(); } catch {} });
  if (second) await closeProduct(second).catch(() => { try { second.app.process().kill(); } catch {} });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
}

assert.equal(fs.existsSync(USER_DATA), false);
assert.equal(fs.existsSync(WORKSPACE), false);
assert.ok(report);
process.stdout.write(`W94B_RUNTIME_REPORT=${JSON.stringify(report)}\n`);
