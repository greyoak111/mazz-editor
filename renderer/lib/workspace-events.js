// W81 Workspace Event capture：只发语义元数据；失败永不阻断主模块。
// 禁止在调用处传正文、逐键、剪贴板、命令或环境变量。
export function captureWorkspaceEvent({ sourceModule, action, subjectRefs = [], objectRefs = [], contextRefs = [], outcome = 'success', summary = '', payloadRef = '' } = {}) {
  if (!window.mazz?.isElectron) return Promise.resolve({ recorded: false, reason: 'NOT_ELECTRON' });
  const occurredAt = new Date().toISOString();
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return window.mazz.invoke('events:capture', {
    idempotencyKey: `${sourceModule}:${action}:${nonce}`,
    occurredAt,
    actorType: 'human', sourceModule, action,
    subjectRefs, objectRefs, contextRefs, outcome,
    provenance: { producer: `renderer:${sourceModule}`, version: 'w81-pilot/v0' },
    privacyClass: 'operational', retentionClass: '1y', payloadRef, summary,
  }).catch(error => ({ recorded: false, reason: 'CAPTURE_FAILED', error: String(error?.message || error) }));
}
