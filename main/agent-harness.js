// main/agent-harness.js —— W66/W71 Agent Harness Foundation（Provider/Seat/Gate 之外的执行器层）
'use strict';

const { randomUUID } = require('crypto');
const { createSpawnGate } = require('./agent-activation-gates');

const SESSION_STATES = Object.freeze([
  'idle', 'starting', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'disposed',
]);
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'disposed']);
const EVENT_TYPES = new Set([
  'started', 'stdout', 'stderr', 'message', 'progress', 'tool',
  'warning', 'error', 'completed', 'state', 'rule-pack-loaded',
]);
const CAPABILITY_KEYS = Object.freeze([
  'workspace', 'fileEdit', 'terminal', 'toolUse', 'imageInput',
  'resume', 'checkpoint', 'approval', 'computerUse', 'structuredOutput',
]);

function normalizeCapabilities(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(CAPABILITY_KEYS.map(key => [key, !!src[key]]));
}

function normalizeDetection(value) {
  if (typeof value === 'boolean') return { available: value };
  const src = value && typeof value === 'object' ? value : {};
  return {
    available: !!src.available,
    command: src.command ? String(src.command) : '',
    version: src.version ? String(src.version) : '',
    reason: src.reason ? String(src.reason) : '',
  };
}

function harnessError(error, fallbackCode = 'HARNESS_ERROR') {
  const source = error instanceof Error ? error : new Error(String(error || '未知 Harness 错误'));
  return {
    code: String(source.code || fallbackCode),
    message: String(source.message || source),
    retryable: !!source.retryable,
  };
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('[harness] Adapter 必须是对象');
  if (!String(adapter.id || '').trim()) throw new Error('[harness] Adapter.id 必填');
  for (const name of ['detect', 'probe', 'capabilities', 'createSession', 'send', 'interrupt', 'dispose', 'events']) {
    if (typeof adapter[name] !== 'function') throw new Error(`[harness] ${adapter.id}.${name} 必须是函数`);
  }
  return adapter;
}

class AgentHarnessRegistry {
  constructor({ onEvent = () => {}, resourceLedger = null, now = () => Date.now(), idFactory = randomUUID, activationGate = createSpawnGate() } = {}) {
    this.adapters = new Map();
    this.sessions = new Map();
    this.onEvent = onEvent;
    this.resourceLedger = resourceLedger;
    this.now = now;
    this.idFactory = idFactory;
    this.activationGate = activationGate;
  }

  register(adapter) {
    validateAdapter(adapter);
    const id = String(adapter.id).trim();
    if (this.adapters.has(id)) throw new Error(`[harness] Adapter 重复: ${id}`);
    this.adapters.set(id, adapter);
    return () => this.unregister(id);
  }

  unregister(id) {
    const adapterId = String(id || '');
    if ([...this.sessions.values()].some(session => session.adapterId === adapterId)) {
      throw new Error(`[harness] Adapter 仍有活动 Session: ${adapterId}`);
    }
    return this.adapters.delete(adapterId);
  }

  async describe(adapter) {
    const capabilities = normalizeCapabilities(await adapter.capabilities());
    return { id: adapter.id, displayName: String(adapter.displayName || adapter.id), capabilities };
  }

  async listAdapters() {
    return Promise.all([...this.adapters.values()].map(adapter => this.describe(adapter)));
  }

  adapter(id) {
    const adapter = this.adapters.get(String(id || ''));
    if (!adapter) throw new Error(`[harness] 未登记 Adapter: ${id}`);
    return adapter;
  }

  async detect(id) {
    const adapter = this.adapter(id);
    try { return { adapterId: adapter.id, ...normalizeDetection(await adapter.detect()) }; }
    catch (error) { return { adapterId: adapter.id, available: false, error: harnessError(error, 'DETECT_FAILED') }; }
  }

  async probe(id) {
    const adapter = this.adapter(id);
    try {
      const detection = normalizeDetection(await adapter.detect());
      if (!detection.available) return { adapterId: adapter.id, ok: false, detection, error: { code: 'NOT_AVAILABLE', message: detection.reason || '执行器不可用', retryable: false } };
      const result = await adapter.probe();
      return { adapterId: adapter.id, ok: result?.ok !== false, detection, capabilities: normalizeCapabilities(await adapter.capabilities()), result: result ?? null };
    } catch (error) {
      return { adapterId: adapter.id, ok: false, error: harnessError(error, 'PROBE_FAILED') };
    }
  }

  publicSession(session) {
    return {
      id: session.id,
      adapterId: session.adapterId,
      state: session.state,
      capabilities: session.capabilities,
      workspace: session.workspace,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sequence: session.sequence,
      attemptId: session.attemptId,
      rulePackHash: session.rulePackHash,
      permissionProfileRef: session.permissionProfileRef,
    };
  }

  transition(session, next) {
    if (!SESSION_STATES.includes(next)) throw new Error(`[harness] 非法状态: ${next}`);
    if (session.state === 'disposed') return false;
    if (session.state === next) return true;
    const allowed = {
      idle: ['starting', 'disposed'],
      starting: ['running', 'waiting', 'completed', 'failed', 'cancelled', 'disposed'],
      running: ['waiting', 'completed', 'failed', 'cancelled', 'disposed'],
      waiting: ['running', 'completed', 'failed', 'cancelled', 'disposed'],
      completed: ['disposed'], failed: ['disposed'], cancelled: ['disposed'],
    };
    if (!(allowed[session.state] || []).includes(next)) {
      throw new Error(`[harness] 非法状态迁移: ${session.state} → ${next}`);
    }
    session.state = next;
    session.updatedAt = this.now();
    if (session.resourceKey) this.resourceLedger?.update(session.resourceKey, { state: next });
    return true;
  }

  emit(session, type, payload = {}, raw = null) {
    const canonical = EVENT_TYPES.has(type) ? type : 'message';
    if (canonical === 'completed') this.transition(session, payload?.status === 'cancelled' ? 'cancelled' : 'completed');
    else if (canonical === 'error' && payload?.terminal !== false) this.transition(session, 'failed');
    else if (canonical === 'state' && ['running', 'waiting'].includes(payload?.state)) this.transition(session, payload.state);
    const event = {
      sessionId: session.id,
      adapterId: session.adapterId,
      type: canonical,
      state: session.state,
      sequence: ++session.sequence,
      at: this.now(),
      payload: payload && typeof payload === 'object' ? payload : { value: payload },
      ...(raw == null ? {} : { raw }),
    };
    this.onEvent(event);
    return event;
  }

  async createSession({ adapterId, workspace = '', instruction = '', context = {}, activation = {}, modelTarget = {}, runRef = '', taskRef = '', attemptNo = 1, handoffRef = '' } = {}) {
    const adapter = this.adapter(adapterId);
    const gated = await this.activationGate(activation);
    const id = String(this.idFactory());
    const at = this.now();
    const session = {
      id, adapterId: adapter.id, adapter, handle: null, unsubscribe: null,
      state: 'idle', capabilities: normalizeCapabilities(await adapter.capabilities()),
      workspace: String(workspace || ''), createdAt: at, updatedAt: at, sequence: 0, resourceKey: null,
      attemptId: gated.receipt.attemptId, rulePackHash: gated.receipt.rulePackHash,
      permissionProfileRef: gated.receipt.permissionProfileRef,
    };
    this.sessions.set(id, session);
    this.transition(session, 'starting');
    session.resourceKey = this.resourceLedger?.register({
      type: 'agent-session', id, owner: adapter.id, state: 'starting',
      meta: { workspace: session.workspace, capabilities: session.capabilities },
    }) || null;
    try {
      session.handle = await adapter.createSession({
        workspace: session.workspace, instruction: String(instruction || ''), context,
        modelTarget, runRef: String(runRef || ''), taskRef: String(taskRef || ''),
        attemptNo: Number(attemptNo) || 1, handoffRef: String(handoffRef || ''),
        permissionProfileRef: gated.receipt.permissionProfileRef,
        rulePackRefs: [{ rulePackId: gated.receipt.rulePackId, rulePackHash: gated.receipt.rulePackHash, compiledRulePackHash: gated.receipt.compiledRulePackHash }],
        rulePackInjection: gated.injection,
      });
      session.unsubscribe = await adapter.events(session.handle, (type, payload, raw) => this.emit(session, type, payload, raw));
      this.transition(session, 'running');
      this.emit(session, 'rule-pack-loaded', { attemptId: session.attemptId, rulePackHash: session.rulePackHash, compiledRulePackHash: gated.receipt.compiledRulePackHash });
      this.emit(session, 'started', { workspace: session.workspace });
      return this.publicSession(session);
    } catch (error) {
      this.emit(session, 'error', { ...harnessError(error, 'SESSION_START_FAILED'), terminal: true });
      try { if (typeof session.unsubscribe === 'function') await session.unsubscribe(); } catch {}
      try { if (session.handle != null) await adapter.dispose(session.handle); } catch {}
      this.resourceLedger?.release(session.resourceKey, { reason: 'start-failed', state: 'failed' });
      this.sessions.delete(session.id);
      throw error;
    }
  }

  session(id) {
    const session = this.sessions.get(String(id || ''));
    if (!session) throw new Error(`[harness] Session 不存在: ${id}`);
    return session;
  }

  async send(id, input) {
    const session = this.session(id);
    if (!['running', 'waiting'].includes(session.state)) throw new Error(`[harness] ${session.state} 状态不可发送`);
    if (session.state === 'waiting') this.transition(session, 'running');
    try { return await session.adapter.send(session.handle, input); }
    catch (error) {
      this.emit(session, 'error', { ...harnessError(error, 'SEND_FAILED'), terminal: true });
      throw error;
    }
  }

  async interrupt(id) {
    const session = this.session(id);
    if (TERMINAL_STATES.has(session.state)) return this.publicSession(session);
    try { await session.adapter.interrupt(session.handle); }
    finally {
      this.transition(session, 'cancelled');
      this.emit(session, 'completed', { status: 'cancelled' });
    }
    return this.publicSession(session);
  }

  async dispose(id, reason = 'dispose') {
    const session = this.session(id);
    try { if (typeof session.unsubscribe === 'function') await session.unsubscribe(); }
    finally {
      try { await session.adapter.dispose(session.handle); }
      finally {
        this.transition(session, 'disposed');
        this.emit(session, 'state', { state: 'disposed', reason });
        if (session.resourceKey) this.resourceLedger?.release(session.resourceKey, { reason, state: 'disposed' });
        this.sessions.delete(session.id);
      }
    }
    return { id: session.id, state: 'disposed' };
  }

  listSessions() { return [...this.sessions.values()].map(session => this.publicSession(session)); }

  async disposeAll(reason = 'app-quit') {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map(async id => {
      const session = this.sessions.get(id);
      if (session && !TERMINAL_STATES.has(session.state)) {
        try { await this.interrupt(id); } catch {}
      }
      if (this.sessions.has(id)) await this.dispose(id, reason);
    }));
  }
}

class AgentHarnessService {
  constructor({ bus, windowManager, resourceLedger, adapters = [] }) {
    this.registry = new AgentHarnessRegistry({
      resourceLedger,
      onEvent: event => windowManager.broadcast('harness:event', event),
    });
    for (const adapter of adapters) this.registry.register(adapter);
    bus.handle('harness:adapters', async () => this.registry.listAdapters());
    bus.handle('harness:detect', async ({ adapterId } = {}) => this.registry.detect(adapterId));
    bus.handle('harness:probe', async ({ adapterId } = {}) => this.registry.probe(adapterId));
    bus.handle('harness:createSession', async payload => this.registry.createSession(payload));
    bus.handle('harness:send', async ({ sessionId, input } = {}) => this.registry.send(sessionId, input));
    bus.handle('harness:interrupt', async ({ sessionId } = {}) => this.registry.interrupt(sessionId));
    bus.handle('harness:dispose', async ({ sessionId, reason } = {}) => this.registry.dispose(sessionId, reason));
    bus.handle('harness:sessions', async () => this.registry.listSessions());
    bus.handle('resources:snapshot', async ({ includeReleased = false } = {}) => resourceLedger.snapshot({ includeReleased }));
  }

  register(adapter) { return this.registry.register(adapter); }
  killAll() { return this.registry.disposeAll('app-quit'); }
}

module.exports = {
  AgentHarnessRegistry,
  AgentHarnessService,
  CAPABILITY_KEYS,
  EVENT_TYPES,
  SESSION_STATES,
  normalizeCapabilities,
  normalizeDetection,
  validateAdapter,
};
