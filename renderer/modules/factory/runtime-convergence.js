// W73h Factory Runtime convergence：跨 W73b–g 子账判定恢复、幽灵终态与资源收口。

export const FACTORY_RUNTIME_CONVERGENCE_SCHEMA = 'mazz.factory-runtime-convergence/v0';
export const FACTORY_RUNTIME_CONVERGENCE_STATUSES = Object.freeze([
  'ACTIVE', 'QUIESCENT', 'RECOVERY_REQUIRED', 'INCONSISTENT', 'CONVERGED',
]);

const TERMINAL = new Set(['failed', 'completed', 'cancelled']);
const SECRET_KEYS = new Set(['apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie']);
const CHECKPOINT_KEYS = new Set([
  'schema', 'runId', 'taskId', 'capturedAt', 'runStatus', 'status', 'safeToClose', 'safeToSeal',
  'blockers', 'components', 'provenance',
]);
const BLOCKER_KEYS = new Set(['code', 'component', 'message']);
const COMPONENT_KEYS = new Set(['name', 'runId', 'active', 'recoveryRequired', 'disposed', 'details']);
const PROVENANCE_KEYS = new Set(['source', 'wave', 'boundary']);

const text = (value, max = 800) => String(value ?? '').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);

function rejectUnknown(value, allowed, label) {
  if (!object(value)) throw new Error(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} 含未冻结字段：${unknown.join(', ')}`);
}

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!object(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`Factory convergence 禁止 secret 字段：${trail ? trail + '.' : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function health(target) {
  if (!target) return null;
  return typeof target.healthSnapshot === 'function' ? target.healthSnapshot() : target;
}

function component(name, snapshot, runId = '') {
  if (!snapshot) return null;
  const active = Number(snapshot.activeWrites || 0)
    + Number(snapshot.activeExternal || 0)
    + Number(snapshot.activeDelegations || 0)
    + Number(snapshot.activeDispatches || 0)
    + Number(snapshot.orphanDispatches || 0)
    + Number(snapshot.active || 0);
  const details = {};
  for (const key of ['activeWrites', 'activeExternal', 'activeDelegations', 'activeDispatches', 'orphanDispatches', 'unresolvedFindings', 'requiresReload', 'records']) {
    if (snapshot[key] !== undefined) details[key] = snapshot[key];
  }
  return {
    name, runId: text(snapshot.runId || runId, 240), active,
    recoveryRequired: snapshot.recoveryRequired === true || snapshot.requiresReload === true,
    disposed: snapshot.disposed === true,
    details,
  };
}

function blocker(code, componentName, message) {
  return { code, component: componentName, message };
}

export function inspectFactoryRunConvergence({
  task = {}, runLedger = null, auditLedger = null, qualificationLedger = null, delegationLedger = null,
  delegationService = null, scheduleLedger = null, economicsLedger = null,
  taskActive = false, controllerActive = false, workshopPending = false, ownerHeld = false,
  capturedAt = new Date().toISOString(),
} = {}) {
  const run = runLedger?.snapshot || task?.productionRunSnapshot || null;
  const runHealth = health(runLedger) || {};
  const runId = text(run?.runId || runLedger?.runId || task?.productionRunId, 240);
  const taskId = text(run?.taskId || task?.id, 240);
  if (!runId || !taskId) throw new Error('Factory convergence 缺 runId/taskId');
  const components = [
    component('production-run', { ...runHealth, runId }),
    component('rework-audit', health(auditLedger), runId),
    component('qualification', health(qualificationLedger), runId),
    component('delegation', health(delegationLedger), runId),
    component('delegation-service', health(delegationService), runId),
    component('scheduler', health(scheduleLedger), runId),
    component('economics-evaluation', health(economicsLedger), runId),
    component('task-runtime', { runId, active: taskActive ? 1 : 0, controllerActive: !!controllerActive }, runId),
    component('workshop-writer', { runId, active: workshopPending ? 1 : 0 }, runId),
    component('run-owner', { runId, active: ownerHeld ? 1 : 0 }, runId),
  ].filter(Boolean);
  components.find(row => row.name === 'task-runtime').details.controllerActive = !!controllerActive;

  const blockers = [];
  for (const row of components) {
    if (row.runId && row.runId !== runId) blockers.push(blocker('RUN_ID_MISMATCH', row.name, `${row.name} 指向其他 Run`));
    if (row.recoveryRequired) blockers.push(blocker('RECOVERY_REQUIRED', row.name, `${row.name} 需要显式恢复`));
  }
  const activity = components.reduce((sum, row) => sum + row.active, 0) + (controllerActive ? 1 : 0);
  const runStatus = text(run?.status || task?.productionRunStatus, 40);
  const terminal = TERMINAL.has(runStatus);
  const audit = components.find(row => row.name === 'rework-audit');
  if (runStatus === 'completed' && Number(audit?.details?.unresolvedFindings || 0) > 0) {
    blockers.push(blocker('COMPLETED_WITH_UNRESOLVED_FINDINGS', 'rework-audit', 'completed Run 仍有未结 Finding'));
  }
  if (terminal && activity > 0) blockers.push(blocker('TERMINAL_WITH_ACTIVITY', 'runtime', '终态 Run 仍有 writer/session/dispatch/task/owner 活动'));
  if (runStatus === 'running' && activity === 0) blockers.push(blocker('GHOST_RUNNING_RUN', 'production-run', 'running Run 已无执行 owner 或活动资源'));
  if (run?.recoveryState?.required === true && !blockers.some(row => row.component === 'production-run' && row.code === 'RECOVERY_REQUIRED')) {
    blockers.push(blocker('RECOVERY_REQUIRED', 'production-run', text(run.recoveryState.reasonCode || 'Production Run 需要显式恢复', 500)));
  }

  const hasIntegrityFailure = blockers.some(row => row.code !== 'RECOVERY_REQUIRED');
  const hasRecovery = blockers.some(row => row.code === 'RECOVERY_REQUIRED');
  const status = hasIntegrityFailure ? 'INCONSISTENT'
    : hasRecovery ? 'RECOVERY_REQUIRED'
      : activity > 0 ? 'ACTIVE'
        : terminal ? 'CONVERGED' : 'QUIESCENT';
  return normalizeFactoryRunConvergenceCheckpoint({
    schema: FACTORY_RUNTIME_CONVERGENCE_SCHEMA,
    runId, taskId, capturedAt, runStatus, status,
    safeToClose: activity === 0 && !hasIntegrityFailure,
    safeToSeal: runStatus === 'completed' && status === 'CONVERGED',
    blockers,
    components,
    provenance: {
      source: 'mazz.factory.runtime', wave: 'W73h',
      boundary: 'Derived health only; W68 artifacts and Production Run remain the truth owners.',
    },
  });
}

export function normalizeFactoryRunConvergenceCheckpoint(value = {}) {
  rejectSecrets(value);
  rejectUnknown(value, CHECKPOINT_KEYS, 'Factory convergence checkpoint');
  if (value.schema !== FACTORY_RUNTIME_CONVERGENCE_SCHEMA) throw new Error(`未知 Factory convergence schema：${value.schema || '空'}`);
  const status = text(value.status, 40);
  if (!FACTORY_RUNTIME_CONVERGENCE_STATUSES.includes(status)) throw new Error(`非法 Factory convergence status：${status}`);
  const blockers = list(value.blockers).map(item => {
    rejectUnknown(item, BLOCKER_KEYS, 'Factory convergence blocker');
    const row = { code: text(item.code, 160), component: text(item.component, 160), message: text(item.message, 1000) };
    if (!row.code || !row.component || !row.message) throw new Error('Factory convergence blocker 字段不完整');
    return row;
  });
  const components = list(value.components).map(item => {
    rejectUnknown(item, COMPONENT_KEYS, 'Factory convergence component');
    const row = {
      name: text(item.name, 160), runId: text(item.runId, 240), active: Math.max(0, Number(item.active) || 0),
      recoveryRequired: item.recoveryRequired === true, disposed: item.disposed === true,
      details: object(item.details) ? { ...item.details } : {},
    };
    if (!row.name) throw new Error('Factory convergence component 缺 name');
    return row;
  });
  rejectUnknown(value.provenance || {}, PROVENANCE_KEYS, 'Factory convergence provenance');
  const checkpoint = {
    schema: FACTORY_RUNTIME_CONVERGENCE_SCHEMA,
    runId: text(value.runId, 240), taskId: text(value.taskId, 240), capturedAt: text(value.capturedAt, 80),
    runStatus: text(value.runStatus, 40), status,
    safeToClose: value.safeToClose === true, safeToSeal: value.safeToSeal === true,
    blockers, components,
    provenance: {
      source: text(value.provenance?.source, 240), wave: text(value.provenance?.wave, 80),
      boundary: text(value.provenance?.boundary, 800),
    },
  };
  if (!checkpoint.runId || !checkpoint.taskId || !checkpoint.capturedAt) throw new Error('Factory convergence checkpoint 缺 runId/taskId/capturedAt');
  return Object.freeze(checkpoint);
}

export function factoryRunConvergencePath(runFolder = '') {
  const base = text(runFolder, 1400).replace(/\\/g, '/').replace(/\/$/, '');
  if (!base) throw new Error('Factory convergence 缺 Run folder');
  return `${base}/convergence.json`;
}

export async function saveFactoryRunConvergenceCheckpoint({ io, runFolder, checkpoint } = {}) {
  if (typeof io?.write !== 'function') throw new Error('Factory convergence IO 缺 write');
  const normalized = normalizeFactoryRunConvergenceCheckpoint(checkpoint);
  const path = factoryRunConvergencePath(runFolder);
  await io.write(path, JSON.stringify(normalized, null, 2));
  return Object.freeze({ path, checkpoint: normalized });
}
