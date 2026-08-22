// 智能创作任务注册表：把内存队列与磁盘恢复状态收敛成同一份可见事实。
// 本文件保持无 DOM / IPC 依赖，便于事务与恢复合同直接验证。

export const FACTORY_TASKS_KEY = 'mazz.factory.tasks';
export const FACTORY_RESUMABLE_DISMISSALS_KEY = 'mazz.factory.resumableDismissals.v1';

export function normalizeFactoryFolder(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function optionalFinite(...values) {
  const raw = firstPresent(...values);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(...values) {
  const raw = firstPresent(...values);
  return typeof raw === 'boolean' ? raw : undefined;
}

export function normalizeFactoryMode(value = '') {
  return value === 'single' ? 'single' : 'max';
}

const FACTORY_RESUMABLE_STATUSES = new Set(['running', 'paused', 'stopped']);

export function isFactoryResumableState(state = {}) {
  return FACTORY_RESUMABLE_STATUSES.has(String(state?.status || ''));
}

function recoveredRegistryStatus(state = {}) {
  const status = String(state?.status || '').trim();
  // A process cannot still be running after a cold start.  Keep its project in
  // the registry as paused, while preserving every non-resumable disk outcome
  // (done/failed/blocked/cancelled and future explicit outcomes) verbatim.
  return isFactoryResumableState(state) ? 'paused' : (status || 'paused');
}

/**
 * Canonical task-state envelope used by every disk write. Transaction identity
 * lives outside the mutable patch so a later status/checkpoint write cannot
 * accidentally erase it and make a single task recover as max.
 */
export function factoryTaskState(task = {}, patch = {}) {
  const rawMaxChapters = firstPresent(task.maxChapters, patch.maxChapters, 0);
  const maxChapters = Number.isFinite(Number(rawMaxChapters)) ? Number(rawMaxChapters) : 0;
  const mode = normalizeFactoryMode(firstPresent(task.mode, patch.mode, 'max'));
  const receiptAt = Number(task.receiptAt) || Number(patch.receiptAt) || 0;
  const createdAt = Number(task.createdAt) || Number(patch.createdAt) || 0;
  const totalWords = optionalFinite(task.totalWords, patch.totalWords);
  const wordsPerUnit = optionalFinite(task.wordsPerUnit, patch.wordsPerUnit);
  const lengthPresetRaw = firstPresent(task.lengthPreset, patch.lengthPreset);
  const reviewRitualRaw = firstPresent(task.reviewRitual, patch.reviewRitual);
  const reviewBudgetCap = optionalFinite(task.reviewBudgetCap, patch.reviewBudgetCap);
  const dualLoop = optionalBoolean(task.dualLoop, patch.dualLoop);
  const autoPreview = optionalBoolean(task.autoPreview, patch.autoPreview);
  const outputProtocolRaw = firstPresent(task.outputProtocol, patch.outputProtocol);
  const reviewProtocolRaw = firstPresent(task.reviewProtocol, patch.reviewProtocol);
  const exportFmtRaw = firstPresent(task.exportFmt, patch.exportFmt);
  return {
    ...patch,
    id: String(firstPresent(task.id, patch.id, '') || ''),
    title: String(firstPresent(task.label, task.title, patch.title, '未命名') || '未命名'),
    genreId: String(firstPresent(task.genreId, patch.genreId, '') || ''),
    mode,
    requestId: String(firstPresent(task.requestId, patch.requestId, task.batchRequestId, patch.batchRequestId, '') || ''),
    batchRequestId: String(firstPresent(task.batchRequestId, patch.batchRequestId, '') || ''),
    receiptAt,
    createdAt,
    maxChapters,
    totalWords,
    wordsPerUnit,
    lengthPreset: lengthPresetRaw === undefined ? undefined : String(lengthPresetRaw),
    reviewRitual: reviewRitualRaw === undefined ? undefined : (reviewRitualRaw === 'full' ? 'full' : 'light'),
    reviewBudgetCap,
    dualLoop,
    autoPreview,
    outputProtocol: outputProtocolRaw === undefined ? undefined : String(outputProtocolRaw),
    reviewProtocol: reviewProtocolRaw === undefined ? undefined : String(reviewProtocolRaw),
    exportFmt: exportFmtRaw === undefined ? undefined : String(exportFmtRaw),
  };
}

function tinyHash(text = '') {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(36);
}

export function resumableRecoveryKey(state = {}) {
  const folder = normalizeFactoryFolder(state.outDir || state.folder).toLocaleLowerCase();
  return folder ? `folder:${folder}` : `task:${String(state.id || '').trim()}`;
}

export function resumableRecoveryFingerprint(state = {}) {
  return [
    String(state.updatedAt || ''),
    String(state.status || ''),
    String(state.currentChapter ?? state.doneChapters ?? 0),
    String(state.maxChapters ?? 0),
  ].join('|');
}

export function makeRecoveredFactoryTask(state = {}, { fallbackGenreId = '' } = {}) {
  const folder = normalizeFactoryFolder(state.outDir || state.folder);
  const sourceId = String(state.id || '').trim();
  const explicitMode = state.mode === 'single' || state.mode === 'max';
  const explicitMaxChapters = state.maxChapters !== undefined && state.maxChapters !== null && state.maxChapters !== '';
  return {
    id: sourceId || `recovered-${tinyHash(folder || JSON.stringify(state))}`,
    label: String(state.title || state.label || '未命名'),
    genreId: String(state.genreId || fallbackGenreId || ''),
    values: state.values && typeof state.values === 'object' ? state.values : {},
    dump: String(state.dump || ''),
    mode: normalizeFactoryMode(state.mode),
    maxChapters: Number(state.maxChapters) || 0,
    status: recoveredRegistryStatus(state),
    doneChapters: Number(state.currentChapter ?? state.doneChapters) || 0,
    folder,
    blueprintReady: state.blueprintReady !== false,
    embeds: Array.isArray(state.embeds) ? state.embeds : [],
    pluginSel: Array.isArray(state.pluginSel) ? state.pluginSel : [],
    pluginValues: state.pluginValues && typeof state.pluginValues === 'object' ? state.pluginValues : {},
    styleIds: Array.isArray(state.styleIds) ? state.styleIds : [],
    exportFmt: firstPresent(state.exportFmt) === undefined ? undefined : String(state.exportFmt),
    createdAt: state.createdAt || Date.parse(state.updatedAt || '') || 0,
    requestId: String(state.requestId || ''),
    batchRequestId: String(state.batchRequestId || ''),
    receiptAt: Number(state.receiptAt) || 0,
    outputProtocol: state.outputProtocol,
    totalWords: optionalFinite(state.totalWords),
    wordsPerUnit: optionalFinite(state.wordsPerUnit),
    lengthPreset: firstPresent(state.lengthPreset) === undefined ? undefined : String(state.lengthPreset),
    reviewProtocol: state.reviewProtocol,
    reviewRitual: firstPresent(state.reviewRitual) === undefined ? undefined : (state.reviewRitual === 'full' ? 'full' : 'light'),
    reviewBudgetCap: optionalFinite(state.reviewBudgetCap),
    dualLoop: optionalBoolean(state.dualLoop),
    autoPreview: optionalBoolean(state.autoPreview),
    reviewState: state.reviewState,
    manualRevision: state.manualRevision,
    recoveredFromDisk: true,
    recoveryDiskStatus: String(state.status || ''),
    recoveryModeExplicit: explicitMode,
    recoveryMaxChaptersExplicit: explicitMaxChapters,
    recoveryStateUpdatedAt: state.updatedAt || '',
  };
}

function setIfMissing(target, key, value) {
  if (value == null || value === '') return false;
  if (target[key] != null && target[key] !== '') return false;
  target[key] = value;
  return true;
}

/**
 * Merge resumable disk states into the registry without duplicating projects.
 * Folder identity wins over id because copied legacy states can share an id.
 */
export function mergeFactoryResumables(tasks = [], states = [], { activeTaskIds = [], fallbackGenreId = '' } = {}) {
  const merged = Array.isArray(tasks) ? [...tasks] : [];
  const active = activeTaskIds instanceof Set ? activeTaskIds : new Set(activeTaskIds || []);
  const byFolder = new Map();
  const byId = new Map();
  for (const task of merged) {
    const folder = normalizeFactoryFolder(task?.folder).toLocaleLowerCase();
    if (folder && !byFolder.has(folder)) byFolder.set(folder, task);
    if (task?.id && !byId.has(String(task.id))) byId.set(String(task.id), task);
  }

  const addedIds = [];
  const mergedIds = [];
  let changed = false;
  for (const state of Array.isArray(states) ? states : []) {
    const recovered = makeRecoveredFactoryTask(state, { fallbackGenreId });
    const folderKey = normalizeFactoryFolder(recovered.folder).toLocaleLowerCase();
    let task = (folderKey && byFolder.get(folderKey)) || null;
    if (!task && recovered.id) {
      const sameId = byId.get(recovered.id);
      const sameIdFolder = normalizeFactoryFolder(sameId?.folder).toLocaleLowerCase();
      if (sameId && (!sameIdFolder || !folderKey || sameIdFolder === folderKey)) task = sameId;
    }
    if (!task) {
      if (byId.has(recovered.id)) recovered.id = `${recovered.id}-recovered-${tinyHash(folderKey)}`;
      merged.push(recovered);
      if (folderKey) byFolder.set(folderKey, recovered);
      byId.set(recovered.id, recovered);
      addedIds.push(recovered.id);
      changed = true;
      continue;
    }

    let taskChanged = false;
    for (const key of ['folder', 'genreId', 'reviewState', 'manualRevision']) {
      taskChanged = setIfMissing(task, key, recovered[key]) || taskChanged;
    }
    // The disk receipt/checkpoint is the durable execution contract. Once a
    // task is no longer active, every explicitly persisted coordinate wins
    // over a stale localStorage view, including meaningful false/0 values.
    for (const key of ['outputProtocol', 'exportFmt', 'totalWords', 'wordsPerUnit', 'lengthPreset', 'reviewProtocol', 'reviewRitual', 'reviewBudgetCap', 'dualLoop', 'autoPreview']) {
      const value = recovered[key];
      if (value === undefined || value === null || value === '') continue;
      if (!active.has(task.id)) {
        if (task[key] !== value) { task[key] = value; taskChanged = true; }
      } else {
        taskChanged = setIfMissing(task, key, value) || taskChanged;
      }
    }
    if (recovered.recoveryModeExplicit && !active.has(task.id) && task.mode !== recovered.mode) {
      task.mode = recovered.mode; taskChanged = true;
    }
    for (const key of ['requestId', 'batchRequestId', 'receiptAt', 'createdAt']) {
      if (!task[key] && recovered[key]) { task[key] = recovered[key]; taskChanged = true; }
    }
    if (!active.has(task.id) && recovered.recoveryMaxChaptersExplicit && task.maxChapters !== recovered.maxChapters) {
      task.maxChapters = recovered.maxChapters; taskChanged = true;
    } else if ((task.maxChapters === undefined || task.maxChapters === null || task.maxChapters === '') && recovered.maxChapters >= 0) {
      task.maxChapters = recovered.maxChapters; taskChanged = true;
    }
    for (const key of ['values', 'pluginValues']) {
      if ((!task[key] || !Object.keys(task[key]).length) && recovered[key] && Object.keys(recovered[key]).length) {
        task[key] = recovered[key]; taskChanged = true;
      }
    }
    for (const key of ['embeds', 'pluginSel', 'styleIds']) {
      if ((!Array.isArray(task[key]) || !task[key].length) && recovered[key]?.length) {
        task[key] = recovered[key]; taskChanged = true;
      }
    }
    if (!active.has(task.id)) {
      const recoveredStatus = recovered.status;
      if (!isFactoryResumableState({ status: recovered.recoveryDiskStatus })) {
        if (task.status !== recoveredStatus) { task.status = recoveredStatus; taskChanged = true; }
      } else if (!['done', 'done-warn', 'failed', 'blocked', 'cancelled'].includes(task.status) && task.status !== 'paused') {
        task.status = 'paused'; taskChanged = true;
      }
    }
    if ((Number(task.doneChapters) || 0) < recovered.doneChapters) {
      task.doneChapters = recovered.doneChapters; taskChanged = true;
    }
    if (task.recoveryStateUpdatedAt !== recovered.recoveryStateUpdatedAt) {
      task.recoveryStateUpdatedAt = recovered.recoveryStateUpdatedAt; taskChanged = true;
    }
    if (!task.recoveredFromDisk) { task.recoveredFromDisk = true; taskChanged = true; }
    if (taskChanged) { changed = true; mergedIds.push(task.id); }
  }
  return { tasks: merged, changed, addedIds, mergedIds };
}

export function dismissFactoryResumables(dismissals = {}, states = []) {
  const next = { ...(dismissals && typeof dismissals === 'object' ? dismissals : {}) };
  for (const state of states || []) next[resumableRecoveryKey(state)] = resumableRecoveryFingerprint(state);
  return next;
}

export function visibleFactoryResumables(states = [], dismissals = {}) {
  return (states || []).filter(state => isFactoryResumableState(state)
    && dismissals?.[resumableRecoveryKey(state)] !== resumableRecoveryFingerprint(state));
}

export function pruneFactoryResumableDismissals(states = [], dismissals = {}) {
  const next = {};
  for (const state of states || []) {
    const key = resumableRecoveryKey(state);
    const fingerprint = resumableRecoveryFingerprint(state);
    if (dismissals?.[key] === fingerprint) next[key] = fingerprint;
  }
  return next;
}
