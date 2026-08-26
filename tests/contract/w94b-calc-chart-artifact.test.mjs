import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const capability = require('../../main/capability-execution-contract.js');
const calcChart = require('../../main/calc-chart-contract.js');
const { CapabilityArtifactStore } = require('../../main/capability-artifact-store.js');
const { CapabilityExecutionService } = require('../../main/capability-execution-service.js');
const { createCalcPythonAdapter, detectPython } = require('../../main/capabilities/calc-python-adapter.js');
const { createChartSvgAdapter, renderChartSvg } = require('../../main/capabilities/chart-svg-adapter.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');

function workspace(t, prefix = 'mazz-w94b-') {
  const requested = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const canonical = fs.realpathSync.native?.(requested) || fs.realpathSync(requested);
  t.after(() => fs.rmSync(canonical, { recursive: true, force: true }));
  return canonical;
}

function ids() {
  let value = 0;
  return () => `w94b-${++value}`;
}

function createService(options = {}) {
  const resourceLedger = options.resourceLedger || new ResourceLedger();
  const instance = new CapabilityExecutionService({ resourceLedger, randomId: ids(), ...options });
  return { instance, resourceLedger };
}

function calcDefinition(overrides = {}) {
  return {
    schema: calcChart.CALC_DEFINITION_SCHEMA,
    language: 'python-expression',
    expression: 'sqrt(a ** 2 + b ** 2)',
    bindings: { a: 3, b: 4 },
    resultSchema: calcChart.CALC_RESULT_SCHEMA,
    seed: null,
    ...overrides,
  };
}

function chartSpec(overrides = {}) {
  return {
    schema: calcChart.CHART_SPEC_SCHEMA,
    type: 'bar',
    title: 'W94B <Chart>',
    dataset: [['类别', '数值'], ['A & B', 3], ['C', 5]],
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
    ...overrides,
  };
}

function calcProposal(definition = calcDefinition()) {
  return {
    taskId: 'calc-expression', seatId: 'human',
    capabilityId: 'mazz.calc.python-expression', capabilityVersion: '1.0.0', adapterId: 'mazz.calc.python-isolated',
    inputs: [], parameters: { definition }, expectedOutputs: [calcChart.CALC_RESULT_SCHEMA],
    constraints: { timeoutMs: 30_000 }, authorityRef: 'human:w94b-test',
  };
}

function chartProposal(spec = chartSpec()) {
  return {
    taskId: 'sheet-chart', seatId: 'human',
    capabilityId: 'mazz.chart.svg', capabilityVersion: '1.0.0', adapterId: 'mazz.chart.svg-deterministic',
    inputs: [], parameters: { spec }, expectedOutputs: [calcChart.CHART_SPEC_SCHEMA, calcChart.CHART_SVG_SCHEMA],
    constraints: {}, authorityRef: 'human:w94b-test',
  };
}

async function streamText(stream) {
  let text = '';
  for await (const chunk of stream) text += chunk.toString('utf8');
  return text;
}

test('W94B Calc Definition is strict, canonical and free of secret/private locators', () => {
  const left = calcChart.normalizeCalcDefinition(calcDefinition({ bindings: { b: 4, a: 3 } }));
  const right = calcChart.normalizeCalcDefinition(calcDefinition({ bindings: { a: 3, b: 4 } }));
  assert.equal(left.definitionId, right.definitionId);
  assert.match(left.definitionId, /^calc-sha256-[0-9a-f]{64}$/);
  assert.throws(() => calcChart.normalizeCalcDefinition({ ...calcDefinition(), script: 'x' }), /未冻结字段/);
  assert.throws(() => calcChart.normalizeCalcDefinition(calcDefinition({ bindings: { apiKey: 'secret-value' } })), /secret/i);
  assert.throws(() => calcChart.normalizeCalcDefinition(calcDefinition({ bindings: { source: 'C:\\Users\\Alice\\private.csv' } })), /路径|URI/i);
  assert.throws(() => calcChart.normalizeCalcDefinition(calcDefinition({ bindings: { a: Number.NaN } })), /NaN/);
});

test('W94B Chart Spec is strict, canonical and changes identity on data/theme/geometry', () => {
  const base = calcChart.normalizeChartSpec(chartSpec());
  assert.match(base.chartSpecId, /^chart-sha256-[0-9a-f]{64}$/);
  assert.equal(calcChart.normalizeChartSpec(chartSpec({ dataset: [['类别', '数值'], ['A & B', 3], ['C', 5]] })).chartSpecId, base.chartSpecId);
  assert.notEqual(calcChart.normalizeChartSpec(chartSpec({ width: 961 })).chartSpecId, base.chartSpecId);
  assert.notEqual(calcChart.normalizeChartSpec(chartSpec({ theme: { ...chartSpec().theme, background: '#000000' } })).chartSpecId, base.chartSpecId);
  assert.throws(() => calcChart.normalizeChartSpec(chartSpec({ type: 'universal' })), /不支持/);
  assert.throws(() => calcChart.normalizeChartSpec(chartSpec({ theme: { ...chartSpec().theme, background: 'url(file:\/\/secret)' } })), /#rrggbb/);
  assert.throws(() => calcChart.normalizeChartSpec(chartSpec({ encoding: { categoryColumn: 0, seriesColumns: [9], headerRow: true } })), /不存在/);
});

test('W94B SVG renderer is deterministic, escaped and contains no executable/external content', () => {
  for (const type of calcChart.CHART_TYPES) {
    const first = renderChartSvg(chartSpec({ type }));
    const second = renderChartSvg(chartSpec({ type }));
    assert.equal(first, second, `${type} SVG must be byte deterministic`);
    assert.match(first, /^<svg /);
    assert.match(first, /W94B &lt;Chart&gt;/);
    assert.match(first, /A &amp; B/);
    const withoutSvgNamespace = first.replace(' xmlns="http://www.w3.org/2000/svg"', '');
    assert.doesNotMatch(withoutSvgNamespace, /<script|foreignObject|\son[a-z]+=|(?:https?|file|data):/i);
  }
});

test('W94B Artifact Store streams complete bytes, reuses exact hash and never Base64/Buffer.concat', async t => {
  const root = workspace(t);
  const store = new CapabilityArtifactStore({ workspacePath: root });
  const chunks = [Buffer.from('第一段\n'), Buffer.alloc(512 * 1024, 0x61), Buffer.from('\n末段')];
  const first = await store.publishReadable({ readable: Readable.from(chunks) });
  const second = await store.publishReadable({ readable: Readable.from(chunks) });
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.created, true);
  assert.equal(second.reused, true);
  assert.equal(store.snapshot().blobCount, 1);
  assert.equal(store.snapshot().stagingCount, 0);
  const opened = await store.open(first.storageRef, { expectedHash: first.contentHash });
  const expected = Buffer.concat(chunks).toString('utf8');
  assert.equal(await streamText(opened.stream), expected);
  const source = fs.readFileSync(path.join('main', 'capability-artifact-store.js'), 'utf8');
  assert.doesNotMatch(source, /Buffer\.concat|base64/i);
});

test('W94B Artifact Store fails closed when atomic hard-link publish is unsupported', async t => {
  const root = workspace(t);
  const fsProxy = new Proxy(fs, { get(target, key) {
    if (key === 'linkSync') return () => { const error = new Error('unsupported'); error.code = 'EPERM'; throw error; };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const store = new CapabilityArtifactStore({ workspacePath: root, fsApi: fsProxy });
  await assert.rejects(store.publishBytes(Buffer.from('not published')), error => error.code === 'CAPABILITY_ARTIFACT_ATOMIC_PUBLISH_UNSUPPORTED');
  assert.equal(store.snapshot().blobCount, 0);
  assert.equal(store.snapshot().stagingCount, 0);
});

test('W94B Artifact Store rejects runtime layout replacement before publication', async t => {
  const root = workspace(t);
  const store = new CapabilityArtifactStore({ workspacePath: root });
  const old = `${store.paths.staging}.old`;
  fs.renameSync(store.paths.staging, old);
  fs.mkdirSync(store.paths.staging);
  await assert.rejects(store.publishBytes(Buffer.from('blocked')), error => error.code === 'CAPABILITY_ARTIFACT_LAYOUT_CHANGED');
  fs.rmSync(store.paths.staging, { recursive: true, force: true });
  fs.renameSync(old, store.paths.staging);
});

test('W94B real isolated Python expression produces a durable typed Artifact', async t => {
  const python = detectPython();
  if (!python) return t.skip('Python 3 unavailable');
  const root = workspace(t);
  const { instance, resourceLedger } = createService();
  instance.register(createCalcPythonAdapter({ python, resourceLedger }));
  const submitted = instance.submitProposal(root, calcProposal());
  const result = await instance.executeProposal(root, submitted.proposal.proposalId);
  assert.equal(result.proposal.state, 'completed');
  assert.equal(result.artifacts.length, 1);
  const grant = instance.grantArtifact(root, result.artifacts[0].artifactId);
  const opened = await instance.openArtifactGrant(grant.url.split('/').at(-1));
  const body = JSON.parse(await streamText(opened.stream));
  assert.equal(body.schema, calcChart.CALC_RESULT_SCHEMA);
  assert.equal(body.value, 5);
  assert.equal(body.valueType, 'number');
  assert.equal(resourceLedger.snapshot().byType['python-process'] || 0, 0);
  assert.equal(instance.snapshot().activeCount, 0);
  await instance.shutdown();
});

test('W94B Python AST attack becomes a durable failed Receipt without leaking code/path', async t => {
  const python = detectPython();
  if (!python) return t.skip('Python 3 unavailable');
  const root = workspace(t);
  const { instance } = createService();
  instance.register(createCalcPythonAdapter({ python }));
  const submitted = instance.submitProposal(root, calcProposal(calcDefinition({ expression: "__import__('os').getcwd()" })));
  await assert.rejects(instance.executeProposal(root, submitted.proposal.proposalId), error => {
    assert.equal(error.code, 'CAPABILITY_CALC_EXPRESSION_REJECTED');
    assert.equal(error.durableReceipt.state, 'failed');
    assert.doesNotMatch(JSON.stringify(error.durableReceipt), /__import__|getcwd|Users|\\|\/home\//i);
    return true;
  });
  const snapshot = instance.workspaceSnapshot(root);
  assert.equal(snapshot.proposals[0].state, 'failed');
  assert.equal(snapshot.leases[0].state, 'released');
  assert.equal(instance.snapshot().activeCount, 0);
  await instance.shutdown();
});

test('W94B Chart capability publishes canonical Spec and SVG in one W94A completion fact', async t => {
  const root = workspace(t);
  const { instance } = createService();
  instance.register(createChartSvgAdapter());
  const submitted = instance.submitProposal(root, chartProposal());
  const first = await instance.executeProposal(root, submitted.proposal.proposalId);
  const replay = await instance.executeProposal(root, submitted.proposal.proposalId);
  assert.equal(first.proposal.state, 'completed');
  assert.equal(replay.idempotent, true);
  assert.deepEqual(first.artifacts.map(row => row.contentSchema).sort(), [calcChart.CHART_SPEC_SCHEMA, calcChart.CHART_SVG_SCHEMA].sort());
  assert.equal(instance.workspaceSnapshot(root).receipts.length, 1);
  assert.equal(instance.workspaceSnapshot(root).artifacts.length, 2);
  assert.equal(instance._artifactStore(instance._store(root)).snapshot().blobCount, 2);
  await instance.shutdown();
});

test('W94B Artifact grant is current-fact bound, single use and streamed', async t => {
  const root = workspace(t);
  let now = 1000;
  const { instance } = createService({ grantClock: () => now });
  instance.register(createChartSvgAdapter());
  const submitted = instance.submitProposal(root, chartProposal());
  const completed = await instance.executeProposal(root, submitted.proposal.proposalId);
  const svg = completed.artifacts.find(row => row.contentSchema === calcChart.CHART_SVG_SCHEMA);
  const grant = instance.grantArtifact(root, svg.artifactId, { ttlMs: 50 });
  assert.match(grant.url, /^mazz-res:\/\/artifact\/grant-/);
  const token = decodeURIComponent(new URL(grant.url).pathname.slice(1));
  assert.doesNotMatch(token, /sha256|[A-Za-z]:|\\|\/Users\//i);
  const opened = await instance.openArtifactGrant(token);
  assert.match(await streamText(opened.stream), /^<svg /);
  await assert.rejects(instance.openArtifactGrant(token), error => error.code === 'CAPABILITY_ARTIFACT_GRANT_NOT_FOUND');
  const expired = instance.grantArtifact(root, svg.artifactId, { ttlMs: 50 });
  now += 51;
  await assert.rejects(instance.openArtifactGrant(decodeURIComponent(new URL(expired.url).pathname.slice(1))), error => error.code === 'CAPABILITY_ARTIFACT_GRANT_EXPIRED');
  assert.equal(instance.snapshot().artifactStreamCount, 0);
  await instance.shutdown();
});

test('W94B different Workspaces do not share proposal or Artifact grants', async t => {
  const rootA = workspace(t, 'mazz-w94b-a-');
  const rootB = workspace(t, 'mazz-w94b-b-');
  const { instance } = createService();
  instance.register(createChartSvgAdapter());
  const a = instance.submitProposal(rootA, chartProposal());
  const b = instance.submitProposal(rootB, chartProposal());
  assert.notEqual(a.proposal.proposalId, b.proposal.proposalId);
  const completed = await instance.executeProposal(rootA, a.proposal.proposalId);
  assert.throws(() => instance.grantArtifact(rootB, completed.artifacts[0].artifactId), error => error.code === 'CAPABILITY_ARTIFACT_NOT_FOUND');
  await instance.shutdown();
});

test('W94B production assembly registers Calc/Chart and streams Artifact protocol', () => {
  const main = fs.readFileSync(path.join('main', 'main.js'), 'utf8');
  const ipc = fs.readFileSync(path.join('main', 'capability-execution-ipc.js'), 'utf8');
  const preload = fs.readFileSync(path.join('preload', 'bridge.js'), 'utf8');
  const watcher = fs.readFileSync(path.join('main', 'file-watcher.js'), 'utf8');
  assert.match(main, /register\(createCalcPythonAdapter\(\{ resourceLedger \}\)\)/);
  assert.match(main, /register\(createChartSvgAdapter\(\)\)/);
  assert.match(main, /u\.host === 'artifact'/);
  assert.match(main, /Readable\.toWeb\(opened\.stream\)/);
  assert.match(ipc, /capability:artifactGrant/);
  assert.match(preload, /capability:artifactGrant/);
  assert.match(watcher, /capability-artifacts/);
});

test('W94B Math/Markdown/Sheet new execution path uses W94A and removes old result/history gates', () => {
  const helper = fs.readFileSync(path.join('renderer', 'lib', 'capability-artifacts.js'), 'utf8');
  const calc = fs.readFileSync(path.join('renderer', 'modules', 'markdown', 'calc-block.js'), 'utf8');
  const math = fs.readFileSync(path.join('renderer', 'modules', 'math', 'index.js'), 'utf8');
  const charts = fs.readFileSync(path.join('renderer', 'modules', 'sheet', 'charts.js'), 'utf8');
  assert.match(helper, /capability:submitProposal/);
  assert.match(helper, /capability:executeProposal/);
  assert.match(helper, /capability:artifactGrant/);
  assert.match(helper, /response\.body\.getReader/);
  assert.doesNotMatch(calc, /py:exec|RESULT_TEXT_LIMIT|RESULT_CACHE_LIMIT|输出已截断/);
  assert.doesNotMatch(math, /py:exec|history\.length\s*>\s*50|slice\(0,\s*50\)/);
  assert.match(charts, /executeChartSpec\(buildChartSpec/);
  assert.match(charts, /sg-chart-artifact/);
});

test('W94B product policy has no arbitrary word/token/row/output/file-size gate', () => {
  const files = [
    'main/calc-chart-contract.js', 'main/capability-artifact-store.js',
    'main/capabilities/calc-python-adapter.js', 'main/capabilities/chart-svg-adapter.js',
    'renderer/lib/capability-artifacts.js', 'renderer/modules/markdown/calc-block.js',
    'renderer/modules/sheet/charts.js',
  ];
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /max[_-]?(?:tokens?|rows?|columns?|output|bytes|file[_-]?size)|RESULT_(?:TEXT|CACHE)_LIMIT|输出已截断/i);
  assert.doesNotMatch(source, /\.slice\(0,\s*\d+\)/);
});
