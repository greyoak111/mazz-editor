// main/agent-handoff.js —— W66-R5 同 Run Attempt / Handoff / safe hot switch
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertSecretHygiene } = require('./agent-activation-gates');

const HANDOFF_SCHEMA = 'mazz.agent-handoff-snapshot/v0';

function safeSegment(value, fallback) {
  const text = String(value || fallback).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return text.slice(0, 100) || fallback;
}

function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, target);
}

class AgentHandoffCoordinator {
  constructor({ registry, clock = () => new Date(), idFactory = crypto.randomUUID } = {}) {
    if (!registry) throw new Error('AgentHandoffCoordinator 缺 AgentHarnessRegistry');
    this.registry = registry;
    this.clock = clock;
    this.idFactory = idFactory;
    this.runs = new Map();
  }

  createRun({ runRef = '', taskRef = '', workspace = '' } = {}) {
    const id = safeSegment(runRef || `run-${this.idFactory()}`, 'run');
    if (this.runs.has(id)) throw Object.assign(new Error(`Run 已存在: ${id}`), { code: 'AGENT_RUN_EXISTS' });
    const run = { id, taskRef: String(taskRef || ''), workspace: path.resolve(String(workspace || process.cwd())), attemptNo: 0, currentSessionId: '', attempts: [], handoffs: [], status: 'idle', createdAt: this.clock().toISOString() };
    this.runs.set(id, run);
    return this.publicRun(run);
  }

  run(id) {
    const run = this.runs.get(safeSegment(id, ''));
    if (!run) throw Object.assign(new Error(`Run 不存在: ${id}`), { code: 'AGENT_RUN_NOT_FOUND' });
    return run;
  }

  publicRun(run) {
    return { id: run.id, taskRef: run.taskRef, workspace: run.workspace, attemptNo: run.attemptNo, currentSessionId: run.currentSessionId, status: run.status, attempts: run.attempts.map(row => ({ ...row })), handoffs: run.handoffs.map(row => row.ref), createdAt: run.createdAt };
  }

  async start(id, input = {}) {
    const run = this.run(id);
    if (run.currentSessionId) throw Object.assign(new Error('Run 已有活动 Session'), { code: 'AGENT_RUN_ALREADY_ACTIVE' });
    const attemptNo = run.attemptNo + 1;
    const session = await this.registry.createSession({ ...input, runRef: run.id, taskRef: run.taskRef, workspace: input.workspace || run.workspace, attemptNo });
    run.attemptNo = attemptNo;
    run.currentSessionId = session.id;
    run.status = 'running';
    run.attempts.push({ attemptNo, sessionId: session.id, adapterId: session.adapterId, state: session.state, startedAt: this.clock().toISOString(), handoffRef: String(input.handoffRef || '') });
    return { run: this.publicRun(run), session };
  }

  handoffPath(run, fromAttempt, toAdapterId) {
    return path.join(run.workspace, '.mazz', 'agent-harness', 'runs', safeSegment(run.id, 'run'), 'handoffs', `${String(fromAttempt).padStart(4, '0')}-to-${safeSegment(toAdapterId, 'adapter')}.json`);
  }

  async switch(id, { toAdapterId, activation, modelTarget = {}, permissionProfileRef = '', instruction = '', snapshot = {} } = {}) {
    const run = this.run(id);
    if (!run.currentSessionId) throw Object.assign(new Error('没有可交接的来源 Session'), { code: 'AGENT_SOURCE_SESSION_REQUIRED' });
    const source = this.registry.session(run.currentSessionId);
    if (snapshot.inFlightTool === true || snapshot.writerLeaseHeld === true) throw Object.assign(new Error('工具事务或 writer lease 尚未释放'), { code: 'HANDOFF_WRITER_LEASE_HELD' });
    if (source.state !== 'waiting') await this.registry.interrupt(source.id);
    const sourcePublic = this.registry.publicSession(source);
    await this.registry.dispose(source.id, 'hot-switch');
    run.currentSessionId = '';
    const handoff = {
      schemaVersion: HANDOFF_SCHEMA,
      handoffId: `handoff-${this.idFactory()}`,
      runRef: run.id,
      taskRef: run.taskRef,
      fromAttemptNo: run.attemptNo,
      fromAdapterId: sourcePublic.adapterId,
      fromSessionId: sourcePublic.id,
      toAdapterId: String(toAdapterId || ''),
      createdAt: this.clock().toISOString(),
      workspace: run.workspace,
      dirtyDiffRef: String(snapshot.dirtyDiffRef || ''),
      artifactRefs: Array.isArray(snapshot.artifactRefs) ? snapshot.artifactRefs.map(String) : [],
      toolResultRefs: Array.isArray(snapshot.toolResultRefs) ? snapshot.toolResultRefs.map(String) : [],
      failureRefs: Array.isArray(snapshot.failureRefs) ? snapshot.failureRefs.map(String) : [],
      unresolved: Array.isArray(snapshot.unresolved) ? snapshot.unresolved.map(String) : [],
      checkpointRef: String(snapshot.checkpointRef || ''),
      sourceTerminalState: sourcePublic.state,
    };
    assertSecretHygiene(handoff);
    const target = this.handoffPath(run, run.attemptNo, toAdapterId);
    atomicJson(target, handoff);
    const handoffRef = target.replaceAll('\\', '/');
    run.handoffs.push({ ref: handoffRef, handoff });
    run.status = 'handoff-written';
    try {
      const started = await this.start(run.id, { adapterId: toAdapterId, activation, modelTarget, permissionProfileRef, instruction, handoffRef });
      run.status = 'running';
      return { ...started, handoffRef };
    } catch (error) {
      run.status = 'recovery-required';
      error.handoffRef = handoffRef;
      throw error;
    }
  }

  async stop(id, reason = 'run-stop') {
    const run = this.run(id);
    if (run.currentSessionId) {
      const session = this.registry.session(run.currentSessionId);
      if (!['completed', 'failed', 'cancelled', 'disposed'].includes(session.state)) await this.registry.interrupt(session.id).catch(() => {});
      if (this.registry.sessions.has(session.id)) await this.registry.dispose(session.id, reason).catch(() => {});
      run.currentSessionId = '';
    }
    run.status = 'stopped';
    return this.publicRun(run);
  }

  listRuns() { return [...this.runs.values()].map(run => this.publicRun(run)); }
}

module.exports = { HANDOFF_SCHEMA, AgentHandoffCoordinator };
