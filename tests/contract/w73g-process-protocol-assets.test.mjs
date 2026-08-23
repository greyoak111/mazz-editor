import { createRequire } from 'node:module';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  FACTORY_PROCESS_PROTOCOL_SCHEMA, FACTORY_PROCESS_PROJECTION_SCHEMA,
  buildFactoryRunProtocolProjection, createW68FactoryProcessProtocol,
  normalizeFactoryProcessProtocol, openFactoryProcessProjectionAsset, openFactoryProcessProtocolAsset,
  renderFactoryProcessProtocolMarkdown, saveFactoryProcessProjectionAsset, saveFactoryProcessProtocolAsset,
} from '../../renderer/modules/factory/process-protocol-assets.js';
import { openProductionRunLedger } from '../../renderer/modules/factory/production-run.js';

const require = createRequire(import.meta.url);
const { isAssetEnvelope } = require('../../main/foundation/asset-envelope.js');
const NOW = '2026-08-17T10:00:00.000Z';

class MemoryIo {
  constructor() { this.files = new Map(); this.directories = new Set(); }
  async exists(path) { return this.files.has(path); }
  async read(path) { if (!this.files.has(path)) throw new Error(`ENOENT ${path}`); return this.files.get(path); }
  async write(path, content) { this.files.set(path, String(content)); return true; }
  async mkdir(path) { this.directories.add(path); return true; }
}

async function runLedger(io) {
  const ledger = await openProductionRunLedger({
    io, folder: 'D:/Factory/W73g', runId: 'run-w73g-001', taskId: 'task-w73g-001', projectId: 'project-w73g',
    title: 'W73g 样本', clock: () => Date.parse(NOW), idFactory: () => 'fixed',
  });
  await ledger.append({ type: 'run-started', toStatus: 'running' });
  return ledger;
}

describe('W73g Director and Process Protocol assets', () => {
  test('W68 protocol 同时冻结 Director、handoff、exception、artifact chain 与 gate/recovery，且没有自动降级', () => {
    const protocol = createW68FactoryProcessProtocol();
    assert.equal(protocol.schema, FACTORY_PROCESS_PROTOCOL_SCHEMA);
    assert.equal(protocol.directorTable.length, 7);
    assert.equal(protocol.handoffs.length, 7);
    assert.equal(protocol.exceptions.length, 5);
    assert.equal(protocol.artifactChain.length, 12);
    assert.deepEqual(protocol.gateRecoveryProjection.gates.map(row => row.gateRef), ['w68:machine', 'w68:point', 'w68:review', 'w68:objection']);
    assert.equal(protocol.exceptions.every(row => row.automaticFallback === false), true);
    assert.equal(protocol.exceptions.some(row => row.exceptionId === 'exception:budget-stop'), false);
    assert.equal(protocol.gateRecoveryProjection.recoveryPoints.some(row => row.recoveryPointId === 'recovery:budget-decision'), false);
    assert.match(protocol.provenance.boundary, /no execution|不执行/i);
    const markdown = renderFactoryProcessProtocolMarkdown(protocol);
    for (const heading of ['Director table', 'Handoff', 'Exception', 'Artifact chain', 'Gate projection', 'Recovery points']) assert.ok(markdown.includes(heading));
    assert.match(markdown, /Factory seal 不等于 Promotion|不取得 Promotion/);
  });

  test('协议是严格闭集：未知字段、secret、悬空 Gate 与同版本身份冲突都拒绝', async () => {
    const protocol = createW68FactoryProcessProtocol();
    assert.throws(() => normalizeFactoryProcessProtocol({ ...protocol, command: 'rm -rf' }), /未冻结字段/);
    assert.throws(() => normalizeFactoryProcessProtocol({ ...protocol, provenance: { ...protocol.provenance, apiKey: 'SECRET' } }), /secret/);
    const broken = structuredClone(protocol); broken.directorTable[0].gateRefs = ['gate:missing'];
    assert.throws(() => normalizeFactoryProcessProtocol(broken), /未知 Gate/);
    const io = new MemoryIo(); const first = await saveFactoryProcessProtocolAsset({ io, projectFolder: 'D:/Factory/W73g', protocol });
    const changed = structuredClone(protocol); changed.title = '同版本偷改';
    await assert.rejects(() => saveFactoryProcessProtocolAsset({ io, projectFolder: 'D:/Factory/W73g', protocol: changed }), error => error?.code === 'W73G_PROTOCOL_VERSION_CONFLICT');
    assert.equal((await openFactoryProcessProtocolAsset({ io, path: first.paths.json })).title, protocol.title);
  });

  test('项目级定义资产可保存、幂等重开、逐字 diff，并由 W72 Asset Envelope 包裹', async () => {
    const io = new MemoryIo(); const protocol = createW68FactoryProcessProtocol();
    const first = await saveFactoryProcessProtocolAsset({ io, projectFolder: 'D:/Factory/W73g', protocol });
    const before = new Map(io.files); const second = await saveFactoryProcessProtocolAsset({ io, projectFolder: 'D:/Factory/W73g', protocol });
    assert.equal(second.paths.json, first.paths.json);
    assert.deepEqual(io.files, before);
    assert.equal(isAssetEnvelope(JSON.parse(io.files.get(first.paths.envelope))), true);
    assert.match(io.files.get(first.paths.markdown), /只描述职责、交接、异常、工件链、Gate 与恢复/);
    assert.equal((await openFactoryProcessProtocolAsset({ io, path: first.paths.json })).version, '1.0.0');
  });

  test('Run 投影只引用现有事实，按 sequence 留存版本，并由 W72 Asset Envelope 包裹', async () => {
    const io = new MemoryIo(); const ledger = await runLedger(io);
    await ledger.append({
      type: 'review-recorded', gateRefs: ['w68:machine:pass', 'w68:point:pass'], findingRefs: ['finding:1'], reworkRefs: ['rework:1'],
      artifactRefs: [{ kind: 'artifact', id: 'artifact:draft', path: '工件/001/02-扩写稿.md', type: 'text/markdown', role: 'draft' }],
    });
    const protocol = await saveFactoryProcessProtocolAsset({ io, projectFolder: 'D:/Factory/W73g' });
    const projection = buildFactoryRunProtocolProjection({ protocolAsset: protocol.asset, ledger });
    assert.equal(projection.schema, FACTORY_PROCESS_PROJECTION_SCHEMA);
    assert.equal(projection.version, 'run-seq-000003');
    assert.equal(projection.runRef.runId, ledger.runId);
    assert.equal(projection.artifactRefs.some(ref => ref.role === 'draft'), true);
    assert.deepEqual(projection.gateRefs, ['w68:machine:pass', 'w68:point:pass']);
    assert.deepEqual(projection.findingRefs, ['finding:1']);
    assert.deepEqual(projection.reworkRefs, ['rework:1']);
    const saved = await saveFactoryProcessProjectionAsset({ io, runFolder: ledger.paths.root, projection });
    assert.equal(isAssetEnvelope(JSON.parse(io.files.get(saved.paths.envelope))), true);
    assert.equal((await openFactoryProcessProjectionAsset({ io, path: saved.paths.json })).version, projection.version);
    assert.match(io.files.get(saved.paths.markdown), /删除 Factory Desk 视图或本投影，不会删除 Run/);
  });

  test('只读投影删除不触碰 Run 与领域工件真相', async () => {
    const io = new MemoryIo(); const ledger = await runLedger(io);
    await ledger.append({ type: 'artifact-recorded', artifactRefs: [{ kind: 'artifact', path: 'D:/Factory/W73g/正文.md', role: 'final-output' }] });
    const protocol = await saveFactoryProcessProtocolAsset({ io, projectFolder: 'D:/Factory/W73g' });
    const saved = await saveFactoryProcessProjectionAsset({ io, runFolder: ledger.paths.root, projection: buildFactoryRunProtocolProjection({ protocolAsset: protocol.asset, ledger }) });
    io.files.delete(saved.paths.markdown); io.files.delete(saved.paths.json); io.files.delete(saved.paths.envelope);
    assert.equal(ledger.snapshot.outputArtifactRefs[0].path, 'D:/Factory/W73g/正文.md');
    assert.equal(io.files.has(ledger.paths.events), true);
    assert.equal(io.files.has(protocol.paths.json), true);
  });
});
