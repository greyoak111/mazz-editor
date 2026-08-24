// W93B Renderer Inbox -> Library shelf saga.
//
// This module is deliberately an orchestration boundary. The main process owns
// Inbox facts and artifact verification; the renderer only commits their
// immutable metadata to LibraryRepository and returns a small shelf receipt.

import { canonicalBookPath, isPathInsideWorkspace } from './repository.js';

export const ACQUISITION_INBOX_CHANNELS = Object.freeze({
  list: 'library:acquisitionInboxList',
  complete: 'library:acquisitionInboxCommit',
});

const INBOX_SCHEMA = 'mazz.library-acquisition-inbox/v1';
const SHELF_RECEIPT_SCHEMA = 'mazz.library-shelf-commit/v1';
const INBOX_KIND = 'library-asset-ready';
const FORMATS = new Set(['epub', 'cbz', 'txt', 'mobi', 'azw3', 'pdf']);
const RECEIPT_FIELDS = new Set([
  'schema', 'revision', 'receiptId', 'jobId', 'workspaceIdentity', 'kind', 'state',
  'artifact', 'createdAt', 'acknowledgedAt',
]);
const ARTIFACT_FIELDS = new Set(['path', 'sha256', 'size', 'format']);

function sagaError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', `${label} 必须是无控制字符的精确非空字符串`);
  }
  return value;
}

function recordId(value, label) {
  const id = exactText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', `${label} 非法`);
  }
  return id;
}

function fullSha256(value, label = 'sha256') {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', `${label} 必须是完整的小写 SHA-256`);
  }
  return value;
}

function ownKeysExactly(value, fields, label) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) {
      throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', `${label} 含未知字段 ${key}`);
    }
  }
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', `${label} 缺少字段 ${key}`);
    }
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = sagaError('ABORT_ERR', reason ? String(reason) : '操作已取消');
  error.name = 'AbortError';
  throw error;
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function bindingError(phase) {
  const error = sagaError('LIBRARY_INBOX_STALE_BINDING', `Library repository binding 已失效（${phase}）`);
  error.stale = true;
  return error;
}

async function verifyBinding(context, phase) {
  throwIfAborted(context.signal);
  const { binding, repository, bindingVerifier } = context;
  if (!binding || binding.repository !== repository || binding.retiring || binding.stale) {
    throw bindingError(phase);
  }
  let current = false;
  try {
    current = await bindingVerifier(Object.freeze({
      phase,
      binding,
      repository,
      repositoryWorkspace: context.repositoryWorkspace,
      workspaceIdentity: context.workspaceIdentity || '',
      workspaceToken: context.workspaceToken || '',
    }));
  } catch (cause) {
    if (isAbort(cause, context.signal)) throw cause;
    const error = bindingError(phase);
    error.cause = cause;
    throw error;
  }
  if (current !== true || binding.repository !== repository || binding.retiring || binding.stale) {
    throw bindingError(phase);
  }
  throwIfAborted(context.signal);
}

async function tracked(binding, operation) {
  const task = Promise.resolve(operation);
  if (!(binding?.pending instanceof Set)) return task;
  binding.pending.add(task);
  try { return await task; }
  finally { binding.pending.delete(task); }
}

function normalizeReceipt(input, context) {
  if (!isPlainObject(input)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', 'Inbox receipt 必须是普通对象');
  }
  ownKeysExactly(input, RECEIPT_FIELDS, 'Inbox receipt');
  if (input.schema !== INBOX_SCHEMA || input.kind !== INBOX_KIND || input.state !== 'pending') {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', '只允许 pending library asset receipt');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.acknowledgedAt !== null) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', 'pending receipt revision/ack 状态非法');
  }
  const workspaceIdentity = exactText(input.workspaceIdentity, 'workspaceIdentity');
  if (workspaceIdentity !== context.workspaceIdentity) {
    throw sagaError('LIBRARY_INBOX_WORKSPACE_MISMATCH', 'Inbox receipt 与捕获的 Workspace 不一致');
  }
  if (!isPlainObject(input.artifact)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', 'artifact 必须是普通对象');
  }
  ownKeysExactly(input.artifact, ARTIFACT_FIELDS, 'artifact');
  const artifactPath = exactText(input.artifact.path, 'artifact.path');
  if (!isPathInsideWorkspace(artifactPath, context.repositoryWorkspace)) {
    throw sagaError('LIBRARY_INBOX_WORKSPACE_MISMATCH', 'artifact.path 不属于当前 Repository Workspace');
  }
  const sha256 = fullSha256(input.artifact.sha256, 'artifact.sha256');
  if (!Number.isSafeInteger(input.artifact.size) || input.artifact.size < 0) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', 'artifact.size 必须是非负安全整数');
  }
  if (typeof input.artifact.format !== 'string' || !FORMATS.has(input.artifact.format)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', 'artifact.format 非法');
  }
  const epoch = Date.parse(input.createdAt);
  if (typeof input.createdAt !== 'string' || !Number.isFinite(epoch)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RECEIPT', 'createdAt 必须是 ISO 时间');
  }
  return Object.freeze({
    schema: INBOX_SCHEMA,
    revision: input.revision,
    receiptId: recordId(input.receiptId, 'receiptId'),
    jobId: recordId(input.jobId, 'jobId'),
    workspaceIdentity,
    kind: INBOX_KIND,
    state: 'pending',
    artifact: Object.freeze({
      path: artifactPath,
      sha256,
      size: input.artifact.size,
      format: input.artifact.format,
    }),
    createdAt: new Date(epoch).toISOString(),
    acknowledgedAt: null,
  });
}

function normalizeListResponse(response, context) {
  const envelope = Array.isArray(response) ? null : response;
  const receipts = Array.isArray(response) ? response : response?.receipts;
  if (!Array.isArray(receipts)) {
    throw sagaError('LIBRARY_INBOX_INVALID_RESPONSE', 'Inbox list 响应缺少 receipts 数组');
  }
  const workspaceIdentity = exactText(
    envelope?.workspaceIdentity ?? context.binding.workspaceIdentity,
    'workspaceIdentity',
  );
  const workspaceToken = exactText(
    envelope?.workspaceToken ?? context.binding.workspaceToken,
    'workspaceToken',
  );
  if (envelope?.workspacePath !== undefined
      && canonicalBookPath(envelope.workspacePath) !== canonicalBookPath(context.repositoryWorkspace)) {
    throw sagaError('LIBRARY_INBOX_WORKSPACE_MISMATCH', 'Inbox list 响应绑定了另一个 Workspace path');
  }
  const captured = { ...context, workspaceIdentity, workspaceToken };
  const normalized = receipts.map(receipt => normalizeReceipt(receipt, captured));
  const ids = new Set();
  for (const receipt of normalized) {
    if (ids.has(receipt.receiptId)) {
      throw sagaError('LIBRARY_INBOX_INVALID_RESPONSE', 'Inbox list 含重复 receiptId');
    }
    ids.add(receipt.receiptId);
  }
  return Object.freeze({
    workspaceIdentity,
    workspaceToken,
    receipts: Object.freeze(normalized),
  });
}

function bridgeList(bridge, request, channels) {
  if (typeof bridge.listInbox === 'function') return bridge.listInbox(request);
  if (typeof bridge.listPending === 'function') return bridge.listPending(request);
  if (typeof bridge.invoke === 'function') return bridge.invoke(channels.list, request);
  throw new TypeError('acquisition Inbox bridge requires listInbox/listPending/invoke');
}

function bridgeComplete(bridge, receiptId, commit, workspaceToken, channels) {
  if (typeof bridge.commitShelfReceipt === 'function') {
    return bridge.commitShelfReceipt(receiptId, commit, { workspaceToken });
  }
  const payload = { receiptId, workspaceToken, ...commit };
  if (typeof bridge.complete === 'function') return bridge.complete(payload);
  if (typeof bridge.invoke === 'function') return bridge.invoke(channels.complete, payload);
  throw new TypeError('acquisition Inbox bridge requires commitShelfReceipt/complete/invoke');
}

function createContext(options) {
  if (!isPlainObject(options)) throw new TypeError('Inbox saga options must be an object');
  const { bridge, repository, binding, signal } = options;
  if (!bridge || typeof bridge !== 'object') throw new TypeError('Inbox saga requires a bridge');
  if (!repository || typeof repository.mutateBooks !== 'function') {
    throw new TypeError('Inbox saga requires LibraryRepository.mutateBooks');
  }
  if (!binding || binding.repository !== repository) {
    throw bindingError('capture');
  }
  if (typeof options.bindingVerifier !== 'function') {
    throw new TypeError('Inbox saga requires an explicit bindingVerifier');
  }
  const channels = Object.freeze({ ...ACQUISITION_INBOX_CHANNELS, ...(options.channels || {}) });
  return {
    bridge,
    repository,
    binding,
    bindingVerifier: options.bindingVerifier,
    signal,
    channels,
    repositoryWorkspace: '',
    workspaceIdentity: '',
    workspaceToken: '',
  };
}

async function capturePending(options) {
  const context = createContext(options);
  throwIfAborted(context.signal);
  if (context.binding.ready) await tracked(context.binding, context.binding.ready);
  if (!context.repository.identity?.canonical) {
    throw sagaError('LIBRARY_INBOX_REPOSITORY_NOT_READY', 'LibraryRepository 尚未绑定 Workspace');
  }
  context.repositoryWorkspace = context.repository.identity.canonical;
  await verifyBinding(context, 'before-list');
  const response = await tracked(context.binding, bridgeList(context.bridge, {
    workspacePath: context.repositoryWorkspace,
    state: 'pending',
  }, context.channels));
  throwIfAborted(context.signal);
  const listed = normalizeListResponse(response, context);
  const captured = {
    ...context,
    workspaceIdentity: listed.workspaceIdentity,
    workspaceToken: listed.workspaceToken,
  };
  await verifyBinding(captured, 'after-list');
  return { context: captured, receipts: listed.receipts };
}

export function stableAcquisitionBookId(sha256) {
  return `blob-sha256-${fullSha256(sha256)}`;
}

function titleFromArtifact(artifact) {
  const leaf = artifact.path.replace(/\\/g, '/').split('/').at(-1) || '';
  const suffix = `.${artifact.format}`;
  const title = leaf.toLowerCase().endsWith(suffix)
    ? leaf.slice(0, -suffix.length)
    : leaf.replace(/\.[^.]*$/, '');
  return title.trim() || '未命名';
}

function hashFromBook(book) {
  for (const field of ['sourceHash', 'contentHash', 'contentFingerprint', 'hash']) {
    const raw = book?.[field];
    if (typeof raw !== 'string') continue;
    const normalized = raw.replace(/^sha256:/i, '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(normalized)) return normalized;
  }
  return '';
}

function shelfRecord(receipt) {
  const { artifact } = receipt;
  return {
    id: stableAcquisitionBookId(artifact.sha256),
    title: titleFromArtifact(artifact),
    author: '',
    cover: '',
    path: artifact.path,
    sourcePath: artifact.path,
    sourceHash: artifact.sha256,
    contentHash: artifact.sha256,
    format: artifact.format,
    size: artifact.size,
    category: '未分类',
    addedAt: Date.parse(receipt.createdAt),
  };
}

async function commitShelf(context, receipt) {
  await verifyBinding(context, `before-shelf:${receipt.receiptId}`);
  const proposed = shelfRecord(receipt);
  let duplicate = false;
  const mutation = context.repository.mutateBooks(books => {
    if (!Array.isArray(books)) {
      throw sagaError('LIBRARY_INBOX_SHELF_CONFLICT', 'Repository books 必须是数组');
    }
    const sameBlob = books.find(book => hashFromBook(book) === receipt.artifact.sha256);
    if (sameBlob) {
      if (typeof sameBlob.id !== 'string' || !sameBlob.id.trim()) {
        throw sagaError('LIBRARY_INBOX_SHELF_CONFLICT', '同 Blob 书架记录缺少稳定 bookId');
      }
      duplicate = true;
      return books;
    }
    const samePath = books.find(book => (
      canonicalBookPath(book?.path || book?.sourcePath) === canonicalBookPath(receipt.artifact.path)
    ));
    if (samePath) {
      throw sagaError('LIBRARY_INBOX_SHELF_CONFLICT', '同一路径已绑定另一个内容哈希');
    }
    const sameId = books.find(book => String(book?.id || '') === proposed.id);
    if (sameId) {
      throw sagaError('LIBRARY_INBOX_SHELF_CONFLICT', '完整 Blob bookId 与不同内容冲突');
    }
    duplicate = false;
    return [...books, proposed];
  });
  const committed = await tracked(context.binding, mutation);
  throwIfAborted(context.signal);
  if (!committed || committed.ok !== true || !Array.isArray(committed.value)) {
    throw sagaError('LIBRARY_INBOX_SHELF_COMMIT_FAILED', 'Repository 未返回持久化 CAS receipt');
  }
  const book = committed.value.find(item => hashFromBook(item) === receipt.artifact.sha256);
  if (!book || typeof book.id !== 'string' || !book.id.trim()) {
    throw sagaError('LIBRARY_INBOX_SHELF_COMMIT_FAILED', 'Repository CAS 后未找到同 Blob 书架事实');
  }
  return Object.freeze({
    schema: SHELF_RECEIPT_SCHEMA,
    receiptId: receipt.receiptId,
    jobId: receipt.jobId,
    bookId: book.id,
    workspaceIdentity: receipt.workspaceIdentity,
    contentHash: receipt.artifact.sha256,
    path: receipt.artifact.path,
    duplicate,
  });
}

function validateCompletion(response, receipt, shelfCommit) {
  if (!isPlainObject(response) || !isPlainObject(response.receipt) || !isPlainObject(response.job)) {
    throw sagaError('LIBRARY_INBOX_INVALID_COMPLETION', '主进程未返回 durable Inbox/Job 事实');
  }
  const durableReceipt = response.receipt;
  const job = response.job;
  if (durableReceipt.receiptId !== receipt.receiptId
      || durableReceipt.jobId !== receipt.jobId
      || durableReceipt.workspaceIdentity !== receipt.workspaceIdentity
      || durableReceipt.state !== 'acknowledged'
      || durableReceipt.artifact?.path !== receipt.artifact.path
      || durableReceipt.artifact?.sha256 !== receipt.artifact.sha256
      || durableReceipt.artifact?.size !== receipt.artifact.size
      || durableReceipt.artifact?.format !== receipt.artifact.format
      || job.jobId !== receipt.jobId
      || job.workspaceIdentity !== receipt.workspaceIdentity
      || job.bookId !== shelfCommit.bookId
      || job.state !== 'imported') {
    throw sagaError('LIBRARY_INBOX_INVALID_COMPLETION', '主进程完成响应与 shelf commit 不一致');
  }
  return Object.freeze({
    ok: true,
    status: 'completed',
    receiptId: receipt.receiptId,
    jobId: receipt.jobId,
    bookId: shelfCommit.bookId,
    workspaceIdentity: receipt.workspaceIdentity,
    contentHash: receipt.artifact.sha256,
    path: receipt.artifact.path,
    duplicate: shelfCommit.duplicate,
    idempotent: response.idempotent === true,
  });
}

async function consumeCaptured(context, receipt) {
  const shelfCommit = await commitShelf(context, receipt);
  await verifyBinding(context, `before-complete:${receipt.receiptId}`);
  const response = await tracked(context.binding, bridgeComplete(
    context.bridge,
    receipt.receiptId,
    {
      bookId: shelfCommit.bookId,
      workspaceIdentity: shelfCommit.workspaceIdentity,
      contentHash: shelfCommit.contentHash,
      path: shelfCommit.path,
    },
    context.workspaceToken,
    context.channels,
  ));
  throwIfAborted(context.signal);
  const completed = validateCompletion(response, receipt, shelfCommit);
  await verifyBinding(context, `after-complete:${receipt.receiptId}`);
  return completed;
}

/**
 * Consume one receipt by ID. The ID is resolved again through the main-process
 * pending list; event payload artifact metadata is intentionally not accepted.
 */
export async function consumeAcquisitionInboxReceipt(options = {}) {
  const receiptId = recordId(options.receiptId, 'receiptId');
  const { context, receipts } = await capturePending(options);
  const receipt = receipts.find(item => item.receiptId === receiptId);
  if (!receipt) {
    return Object.freeze({
      ok: false,
      status: 'not-pending',
      receiptId,
      workspaceIdentity: context.workspaceIdentity,
    });
  }
  return consumeCaptured(context, receipt);
}

/**
 * Drain the natural pending list. Individual shelf/complete failures are
 * reported and left replayable; cancellation or a stale binding stops the run.
 */
export async function drainAcquisitionInbox(options = {}) {
  const { context, receipts } = await capturePending(options);
  const completed = [];
  const failed = [];
  for (const receipt of receipts) {
    throwIfAborted(context.signal);
    try {
      completed.push(await consumeCaptured(context, receipt));
    } catch (error) {
      if (isAbort(error, context.signal) || error?.stale
          || error?.code === 'LIBRARY_INBOX_STALE_BINDING') throw error;
      failed.push(Object.freeze({
        receiptId: receipt.receiptId,
        code: String(error?.code || 'LIBRARY_INBOX_CONSUME_FAILED'),
        error,
      }));
    }
  }
  return Object.freeze({
    ok: failed.length === 0,
    workspaceIdentity: context.workspaceIdentity,
    listed: receipts.length,
    completed: Object.freeze(completed),
    failed: Object.freeze(failed),
  });
}

export const consume = consumeAcquisitionInboxReceipt;
export const drain = drainAcquisitionInbox;

export const _forTests = Object.freeze({
  normalizeReceipt,
  shelfRecord,
  hashFromBook,
  validateCompletion,
});
