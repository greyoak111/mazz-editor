import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';
import {
  PRODUCTION_RUN_EVENT_SCHEMA,
  PRODUCTION_RUN_REFERENCES_SCHEMA,
  PRODUCTION_RUN_SCHEMA,
  createProductionRunId,
  createProductionRunSnapshot,
  normalizeProductionRunEvent,
  normalizeProductionRunReference,
  openProductionRunLedger,
  parseProductionRunEventLog,
} from '../../renderer/modules/factory/production-run.js';

class MemoryRunIo {
  constructor() { this.files = new Map(); this.failOnce = new Set(); this.delayMs = 0; }
  async exists(path) { return this.files.has(path); }
  async mkdir() { return true; }
  async read(path) {
    if (!this.files.has(path)) throw new Error(`ENOENT ${path}`);
    return this.files.get(path);
  }
  async write(path, content) {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    if (this.failOnce.delete(path)) throw new Error(`injected write failure: ${path}`);
    this.files.set(path, String(content));
    return true;
  }
}

const clock = (() => {
  let now = Date.parse('2026-08-17T04:00:00.000Z');
  return () => (now += 1000);
})();

const open = (io, extra = {}) => openProductionRunLedger({
  io, folder: 'D:/Factory/Specimen', runId: 'run-specimen-001', taskId: 'task-001', projectId: 'project-001',
  title: 'W73b specimen', governanceProfile: 'light', budgetProfile: { capTokens: 32000 },
  clock, idFactory: (() => { let n = 0; return () => `id-${++n}`; })(), ...extra,
});

describe('W73b Production Run schema', () => {
  test('稳定身份不由路径派生，Snapshot/Event/Reference 三契约分离', () => {
    const a = createProductionRunId('task:alpha', { clock: () => 1, random: () => 0.1 });
    const b = createProductionRunId('task:alpha', { clock: () => 1, random: () => 0.2 });
    assert.notEqual(a, b);
    assert.doesNotMatch(a, /Factory|workspace|D:/i);
    const snapshot = createProductionRunSnapshot({ runId: a, taskId: 'task-alpha', budgetProfile: { capTokens: 1000 } }, { clock: () => 1 });
    assert.equal(snapshot.schema, PRODUCTION_RUN_SCHEMA);
    assert.equal(snapshot.status, 'proposed');
    assert.equal(snapshot.budgetProfile.actualStatus, 'UNKNOWN');
    const ref = normalizeProductionRunReference({ kind: 'artifact', path: '工件/01.md', role: 'review' });
    assert.equal(ref.path, '工件/01.md');
    assert.throws(() => normalizeProductionRunReference({ kind: 'artifact', path: 'x', content: '正文' }), /未冻结字段/);
    assert.throws(() => createProductionRunSnapshot({ runId: 'r', taskId: 't', apiKey: 'secret' }), /禁止 secret/);
    assert.throws(() => createProductionRunSnapshot({ runId: 'run-a', taskId: 'task-a', universalPayload: {} }), /未冻结字段/);
  });

  test('事件必须闭集、连续且不能携带 Authorization/Credential', () => {
    const base = { eventId: 'e1', runId: 'r1', sequence: 1, occurredAt: '2026-08-17T00:00:00.000Z', type: 'run-created', fromStatus: '', toStatus: 'proposed' };
    assert.equal(normalizeProductionRunEvent(base).schema, PRODUCTION_RUN_EVENT_SCHEMA);
    assert.throws(() => normalizeProductionRunEvent({ ...base, type: 'magic-route' }), /非法 Production Run event type/);
    assert.throws(() => normalizeProductionRunEvent({ ...base, providerBoundary: { outcome: 'ok', authorization: 'Bearer x' } }), /禁止 secret|未冻结字段/);
  });
});

describe('W73b append-only ledger roundtrip', () => {
  test('create→start→review→complete 可重放，正文不进入引用账', async () => {
    const io = new MemoryRunIo();
    const ledger = await open(io);
    assert.equal(ledger.snapshot.status, 'proposed');
    assert.equal(ledger.snapshot.lastSequence, 1);
    await ledger.append({
      type: 'run-started', toStatus: 'running', reasonCode: 'USER_START',
      providerBoundary: { providerId: 'openai-compatible', model: 'model-x', role: 'chapter', outcome: 'route-requested', observed: false },
    });
    await ledger.append({
      type: 'review-recorded', reasonCode: 'W68_REVIEW', gateRefs: ['machine', 'point', 'review', 'objection'],
      artifactRefs: [{ kind: 'artifact', id: 'review-001', path: '工件/第001章/manifest.json', type: 'application/json', role: 'review-manifest' }],
    });
    await ledger.append({
      type: 'run-completed', toStatus: 'completed', reasonCode: 'W68_SEALED',
      artifactRefs: [{ kind: 'artifact', id: 'body-001', path: '第001章.md', type: 'text/markdown', role: 'final-output' }],
    });
    assert.equal(ledger.snapshot.status, 'completed');
    assert.equal(ledger.snapshot.lastSequence, 4);
    assert.equal(ledger.snapshot.gateRefs.length, 4);
    assert.equal(ledger.snapshot.outputArtifactRefs[0].path, '第001章.md');
    const refs = JSON.parse(io.files.get(ledger.paths.references));
    assert.equal(refs.schema, PRODUCTION_RUN_REFERENCES_SCHEMA);
    assert.equal(refs.refs.length, 2);
    assert.doesNotMatch(JSON.stringify(refs), /正文|Bearer|apiKey/);
    await ledger.dispose();
    const reopened = await open(io);
    assert.equal(reopened.snapshot.status, 'completed');
    assert.equal(reopened.events.length, 4);
    assert.equal(reopened.healthSnapshot().activeWrites, 0);
  });

  test('同一 Run 并发追加被串行化，sequence 不重号', async () => {
    const io = new MemoryRunIo();
    const ledger = await open(io);
    await ledger.append({ type: 'run-started', toStatus: 'running' });
    await Promise.all([
      ledger.append({ type: 'artifact-recorded', artifactRefs: [{ kind: 'artifact', path: 'a.md' }] }),
      ledger.append({ type: 'artifact-recorded', artifactRefs: [{ kind: 'artifact', path: 'b.md' }] }),
      ledger.append({ type: 'review-recorded', gateRefs: ['machine'] }),
    ]);
    assert.deepEqual(ledger.events.map(row => row.sequence), [1, 2, 3, 4, 5]);
    assert.equal(new Set(ledger.events.map(row => row.eventId)).size, 5);
    assert.equal(ledger.snapshot.outputArtifactRefs.length, 2);
  });

  test('事件先于快照落盘；快照写失败后重开可由事件补回', async () => {
    const io = new MemoryRunIo();
    const ledger = await open(io);
    await ledger.append({ type: 'run-started', toStatus: 'running' });
    io.failOnce.add(ledger.paths.snapshot);
    await assert.rejects(() => ledger.append({ type: 'review-recorded', gateRefs: ['machine'] }), /injected write failure/);
    assert.equal(ledger.snapshot.lastSequence, 2, '内存态不得假装失败写已提交');
    assert.equal(ledger.healthSnapshot().requiresReload, true);
    await assert.rejects(() => ledger.append({ type: 'run-failed', toStatus: 'failed' }), /必须重开/);
    const reopened = await open(io, { recoverOrphaned: false });
    assert.equal(reopened.snapshot.lastSequence, 3, '重开必须从 event log 补回');
    assert.deepEqual(reopened.snapshot.gateRefs, ['machine']);
  });

  test('真实文件系统 specimen 生成五件套并可重新打开', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w73b-'));
    const io = {
      exists: async target => fs.existsSync(target),
      mkdir: async target => { fs.mkdirSync(target, { recursive: true }); return true; },
      read: async target => fs.readFileSync(target, 'utf8'),
      write: async (target, content) => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temp = `${target}.tmp`;
        fs.writeFileSync(temp, content, 'utf8');
        fs.renameSync(temp, target);
        return true;
      },
    };
    try {
      const ledger = await openProductionRunLedger({ io, folder: root, runId: 'run-disk-001', taskId: 'task-disk', clock });
      await ledger.append({ type: 'run-started', toStatus: 'running' });
      await ledger.append({ type: 'run-completed', toStatus: 'completed', artifactRefs: [{ kind: 'artifact', path: `${root}/final.md` }] });
      for (const target of [ledger.paths.snapshot, ledger.paths.events, ledger.paths.findings, ledger.paths.economics, ledger.paths.references]) {
        assert.equal(fs.existsSync(target), true, `缺少 ${target}`);
      }
      const reopened = await openProductionRunLedger({ io, folder: root, runId: ledger.runId, taskId: 'task-disk', clock });
      assert.equal(reopened.snapshot.status, 'completed');
      assert.equal(reopened.events.length, 3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('W73b recovery and resource discipline', () => {
  test('损坏尾被隔离并显式转 blocked，中段损坏拒绝猜测', async () => {
    const io = new MemoryRunIo();
    const ledger = await open(io);
    await ledger.append({ type: 'run-started', toStatus: 'running' });
    io.files.set(ledger.paths.events, io.files.get(ledger.paths.events) + '{"broken":');
    const recovered = await open(io, { recoverOrphaned: true });
    assert.equal(recovered.snapshot.status, 'blocked');
    assert.equal(recovered.snapshot.recoveryState.required, true);
    assert.equal(recovered.snapshot.recoveryState.reasonCode, 'CORRUPT_TAIL_RECOVERED');
    assert.equal(io.files.get(recovered.paths.corruptTail), '{"broken":');
    assert.equal(parseProductionRunEventLog(io.files.get(recovered.paths.events), { runId: recovered.runId }).corruptTail, '');

    const valid = io.files.get(recovered.paths.events).trim().split('\n');
    const middle = `${valid[0]}\n{bad}\n${valid[1]}\n`;
    assert.throws(() => parseProductionRunEventLog(middle, { runId: recovered.runId }), /中段损坏/);
  });

  test('重开未闭合 running Run 先标记恢复，再允许显式续跑', async () => {
    const io = new MemoryRunIo();
    const ledger = await open(io);
    await ledger.append({ type: 'run-started', toStatus: 'running' });
    const reopened = await open(io, { recoverOrphaned: true });
    assert.equal(reopened.snapshot.status, 'blocked');
    assert.equal(reopened.snapshot.recoveryState.reasonCode, 'ORPHANED_RUNNING_RUN');
    await reopened.append({ type: 'run-started', toStatus: 'running', reasonCode: 'EXPLICIT_RESUME' });
    assert.equal(reopened.snapshot.status, 'running');
    assert.equal(reopened.snapshot.recoveryState.required, false);
  });

  test('runId 不能逃出每 Run 独立目录', async () => {
    const io = new MemoryRunIo();
    await assert.rejects(() => open(io, { runId: '../escape' }), /非法路径字符/);
    await assert.rejects(() => openProductionRunLedger({ io, folder: '', runId: 'run-safe', taskId: 'task' }), /缺 folder/);
  });

  test('dispose 等待在飞原子写并回到 activeWrites=0，释放后拒绝新写', async () => {
    const io = new MemoryRunIo();
    const ledger = await open(io);
    await ledger.append({ type: 'run-started', toStatus: 'running' });
    io.delayMs = 5;
    const writing = ledger.append({ type: 'artifact-recorded', artifactRefs: [{ kind: 'artifact', path: 'slow.md' }] });
    await Promise.resolve();
    const disposed = await ledger.dispose();
    await writing;
    assert.equal(disposed.activeWrites, 0);
    assert.equal(disposed.disposed, true);
    await assert.rejects(() => ledger.append({ type: 'review-recorded' }), /已释放/);
  });
});

describe('W73b single-path W68 integration', () => {
  test('只接 W68 单次路径，max/legacy 不被偷偷迁移', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/index.js', import.meta.url), 'utf8');
    assert.ok(source.includes("task?.reviewProtocol === W68_PROTOCOL && task?.mode !== 'max'"));
    assert.ok(source.includes('await this.ensureProductionRun(task, tpl)'));
    assert.ok(source.includes("type: 'review-recorded'"));
    assert.ok(source.includes("type: 'run-completed'"));
    assert.ok(source.includes("type: 'run-paused'"));
    assert.ok(source.includes("type: 'run-failed'"));
  });

  test('完成账必须在 done 任务状态之前，且只引用正文路径不复制正文', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/index.js', import.meta.url), 'utf8');
    const completed = source.indexOf("type: 'run-completed'");
    const doneState = source.indexOf("status: 'done', currentChapter: 1", completed);
    assert.ok(completed > 0 && doneState > completed, 'Run completed 必须先于任务 done 状态');
    const integration = source.slice(completed, doneState);
    assert.ok(integration.includes("path: mdPath"));
    assert.doesNotMatch(integration, /content:\s*text|text:\s*text/);
    assert.ok(source.includes('productionRunId'));
    assert.ok(source.includes('productionRunStatus'));
  });

  test('纯 Ledger 不读 UI/网络/Provider/全局存储，也不成为第二 Factory', () => {
    const source = fs.readFileSync(new URL('../../renderer/modules/factory/production-run.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /window\.|document\.(?:body|create|query)|localStorage|fetch\s*\(|WebSocket|electron|runW68Review|chatStream|AgentRuntime/);
    assert.ok(source.includes('事件先落盘；快照/引用写失败时，重开可由事件重放恢复'));
  });
});
