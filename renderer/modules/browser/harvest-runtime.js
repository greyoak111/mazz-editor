// W62f：AI 对话整理 I/O 编排——采集、工作区导出、文风素材、无损提炼回喂。
import { buildHarvestMarkdown, harvestScript, normalizeHarvestMessages, safeHarvestName } from './harvester.js';
import { saveStyleText } from '../factory/style-studio.js';

const invoke = (channel, payload) => window.mazz.invoke(channel, payload);
const reservedPaths = new Set();
const STRUCTURED_KIND_LABELS = Object.freeze({
  'stage-summary': '阶段总结', decision: '正式决策', method: '可复用方法', finding: '事实发现',
});

async function uniqueMarkdownPath(dir, stem) {
  for (let n = 1; n < 10_000; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const path = `${dir}/${stem}${suffix}.md`;
    if (reservedPaths.has(path)) continue;
    const stat = await invoke('fs:stat', { path }).catch(() => ({ exists: false }));
    if (!stat?.exists) { reservedPaths.add(path); return { path, stem: stem + suffix }; }
  }
  throw new Error('同名对话过多，无法分配文件名');
}

function normalizedPayload(payload = {}) {
  const meta = {
    adapterId: String(payload.meta?.adapterId || ''),
    site: String(payload.meta?.site || '通用网页对话'),
    title: String(payload.meta?.title || ''),
    topic: safeHarvestName(payload.meta?.topic || payload.meta?.title || '未命名对话'),
    url: String(payload.meta?.url || ''),
    capturedAt: String(payload.meta?.capturedAt || new Date().toISOString()),
    scrollPasses: Math.max(0, Number(payload.meta?.scrollPasses) || 0),
  };
  if (!/^https?:\/\//i.test(meta.url)) throw new Error('对话来源网址无效');
  const messages = normalizeHarvestMessages(payload.messages).slice(0, 1000);
  if (!messages.length) throw new Error('请至少选择一条消息');
  const totalChars = messages.reduce((sum, row) => sum + row.text.length, 0);
  if (totalChars > 500_000) throw new Error('一次最多处理 50 万字，请缩小选择范围');
  return { meta, messages };
}

function normalizedReview(review = {}) {
  const kind = String(review.kind || '');
  if (!Object.hasOwn(STRUCTURED_KIND_LABELS, kind)) throw new Error('请选择有效的结构化候选类型');
  const action = String(review.action || '');
  if (!['approve', 'reject'].includes(action)) throw new Error('候选审阅只允许批准或驳回');
  const title = String(review.title || '').trim();
  const statement = String(review.statement || '').replace(/\r\n?/g, '\n').trim();
  if (!title) throw new Error('请填写候选标题');
  if (title.length > 500) throw new Error('候选标题最多 500 字符');
  if (!statement) throw new Error('请审阅并填写候选正文');
  if (statement.length > 100_000) throw new Error('候选正文最多 10 万字符');
  const proposedAt = new Date(String(review.proposedAt || '')).toISOString();
  const supersedes = [...new Set((Array.isArray(review.supersedes) ? review.supersedes : [])
    .map(value => String(value || '').trim()).filter(Boolean))];
  if (action !== 'approve' && supersedes.length) throw new Error('只有批准候选时可以替代旧记录');
  if (supersedes.some(value => value.length > 300 || /[\u0000-\u001f]/.test(value))) throw new Error('替代目标无效');
  return { kind, action, title, statement, proposedAt, supersedes };
}

function managementReason(value, action) {
  const reason = String(value || '').trim();
  if (reason.length < 4) throw new Error(`${action}前请填写至少 4 个字的原因`);
  if (reason.length > 1200) throw new Error('原因最多 1200 字符');
  return reason;
}

function buildStructuredCandidateMarkdown(meta, messages, review) {
  const label = STRUCTURED_KIND_LABELS[review.kind];
  const evidence = buildHarvestMarkdown(meta, messages).replace(/^#/gm, '###');
  return `# ${review.title}\n\n` +
    `> 候选类型：${label}\n> 审阅要求：必须由 human:* Authority 明确决定\n> 来源：${meta.site} · ${meta.topic}\n\n` +
    `## 审阅正文\n\n${review.statement}\n\n` +
    `## 来源对话证据\n\n${evidence}\n`;
}

export function createHarvestRuntime({ ctl } = {}) {
  async function collectCurrent() {
    const tab = ctl?.activeTab?.();
    if (!tab?.viewId || !/^https?:/i.test(tab.url || '')) throw new Error('请先打开一个 AI 对话网页');
    const result = await invoke('bv:js', { tabId: tab.viewId, code: harvestScript(tab.url) });
    if (!result || result.__err) throw new Error(result?.__err || '页面采集脚本没有返回结果');
    const messages = normalizeHarvestMessages(result.messages);
    if (!messages.length) throw new Error('没有识别到对话消息；可滚动页面后重试');
    return {
      meta: {
        adapterId: result.adapterId || 'generic',
        site: result.site || '通用网页对话',
        title: result.title || tab.title || 'AI 对话',
        topic: result.topic || result.title || tab.title || 'AI 对话',
        url: result.url || tab.url,
        capturedAt: result.capturedAt || new Date().toISOString(),
        scrollPasses: Number(result.scrollPasses) || 0,
        selector: result.selector || '',
      },
      messages,
    };
  }

  async function exportSelection(payload) {
    const { meta, messages } = normalizedPayload(payload);
    const markdown = buildHarvestMarkdown(meta, messages);
    const workspace = await invoke('workspace:get');
    const dir = `${workspace}/AI对话归档`;
    await invoke('fs:mkdir', { path: dir });
    const stamp = new Date(meta.capturedAt).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const stem = safeHarvestName(`AI对话-${meta.site}-${meta.topic}-${stamp}`);
    const unique = await uniqueMarkdownPath(dir, stem);
    try {
      await invoke('fs:writeFile', { path: unique.path, content: markdown });
      return { ...unique, markdown, meta, messages };
    } finally { reservedPaths.delete(unique.path); }
  }

  async function feedStyle(payload) {
    const { meta, messages } = normalizedPayload(payload);
    const answers = messages.filter(row => row.role === 'assistant');
    const source = answers.length ? answers : messages;
    const text = source.map(row => row.text).join('\n\n---\n\n');
    const entry = await saveStyleText({
      label: `${meta.site} · ${meta.topic}`,
      text,
      note: `来自 AI 对话整理，共 ${source.length} 条${answers.length ? ' AI 回复' : '消息'}`,
      sourceUrl: meta.url,
    });
    return { entry, count: source.length };
  }

  async function distillSelection(payload) {
    const saved = await exportSelection(payload);
    await invoke('panel:close', { kind: 'harvest' }).catch(() => {});
    window.MazzHost?.openTab('markdown', { title: saved.path.split('/').pop(), filePath: saved.path, content: saved.markdown });
    await new Promise(resolve => setTimeout(resolve, 0));
    await window.MazzCommands?.execute('markdown.distillDocumentToMindmap');
    return saved;
  }

  async function promoteSelection(payload) {
    const { meta, messages } = normalizedPayload(payload);
    const workspace = await invoke('workspace:get');
    const markdown = buildHarvestMarkdown(meta, messages);
    const result = await invoke('promotion:promoteConversation', {
      schema: 'mazz.conversation-promotion-request/v0',
      projectId: 'workspace:conversation-assets',
      projectPath: workspace,
      title: `AI 对话：${meta.topic}`,
      markdown,
      sourceRef: {
        kind: 'ai-conversation', adapterId: meta.adapterId || 'generic', site: meta.site,
        url: meta.url, capturedAt: meta.capturedAt, messageIds: messages.map(row => row.id),
      },
      capturedAt: meta.capturedAt,
      authorityRef: 'human:interactive-local-user',
      reason: '用户在 AI 对话整理面板明确选择“升格为本地资产”',
      decidedAt: new Date().toISOString(),
      supersedes: [...new Set((Array.isArray(payload.supersedes) ? payload.supersedes : [])
        .map(value => String(value || '').trim()).filter(Boolean))],
    });
    if (!result?.ok) throw new Error(result?.promotion?.message || result?.ingestion?.message || '本地资产升格失败；现有资产未改写');
    return result;
  }

  async function reviewPromotionCandidate(payload) {
    const { meta, messages } = normalizedPayload(payload);
    const review = normalizedReview(payload.review);
    const workspace = await invoke('workspace:get');
    const markdown = buildStructuredCandidateMarkdown(meta, messages, review);
    const result = await invoke('promotion:reviewConversationCandidate', {
      schema: 'mazz.structured-promotion-review-request/v0',
      projectId: 'workspace:conversation-assets',
      projectPath: workspace,
      kind: review.kind,
      title: review.title,
      markdown,
      sourceRef: {
        kind: 'ai-conversation-structured-candidate', adapterId: meta.adapterId || 'generic', site: meta.site,
        url: meta.url, capturedAt: meta.capturedAt, messageIds: messages.map(row => row.id), candidateKind: review.kind,
      },
      proposedBy: 'system:w62f-structured-draft',
      proposedAt: review.proposedAt,
      action: review.action,
      authorityRef: 'human:interactive-local-user',
      reason: review.action === 'approve'
        ? (review.supersedes.length
          ? '用户在结构化候选审阅区明确批准，并替代所选同类 active Promotion'
          : '用户在结构化候选审阅区明确批准入库')
        : '用户在结构化候选审阅区明确驳回候选',
      decidedAt: new Date().toISOString(),
      supersedes: review.supersedes,
    });
    if (!result?.ok) throw new Error(result?.promotion?.message || result?.ingestion?.message || '结构化候选审阅失败；现有状态未改写');
    return { ...result, action: review.action, kind: review.kind };
  }

  async function promotionManagement() {
    const workspace = await invoke('workspace:get');
    return invoke('promotion:listManagement', {
      schema: 'mazz.promotion-management-query/v0',
      projectId: 'workspace:conversation-assets',
      projectPath: workspace,
    });
  }

  async function revokePromotion(payload = {}) {
    const workspace = await invoke('workspace:get');
    const result = await invoke('promotion:revoke', {
      schema: 'mazz.promotion-revoke-request/v0',
      projectId: 'workspace:conversation-assets',
      projectPath: workspace,
      promotionId: String(payload.promotionId || ''),
      authorityRef: 'human:interactive-local-user',
      reason: managementReason(payload.reason, '撤销'),
      decidedAt: new Date().toISOString(),
    });
    if (!result?.ok) throw new Error(result?.message || '撤销失败；原状态未改写');
    return result;
  }

  async function manageEvidenceProjection(payload = {}) {
    const workspace = await invoke('workspace:get');
    const action = String(payload.action || '');
    if (!['project', 'withdraw'].includes(action)) throw new Error('证据投影动作无效');
    const result = await invoke('promotion:manageEvidenceProjection', {
      schema: 'mazz.evidence-projection-request/v0',
      projectId: 'workspace:conversation-assets',
      projectPath: workspace,
      action,
      promotionId: String(payload.promotionId || ''),
      authorityRef: 'human:interactive-local-user',
      reason: managementReason(payload.reason, action === 'project' ? '生成证据投影' : '撤回证据投影'),
      decidedAt: new Date().toISOString(),
    });
    if (!result?.ok) throw new Error(result?.message || '证据投影操作失败；原状态未改写');
    return result;
  }

  return {
    collectCurrent, exportSelection, feedStyle, distillSelection, promoteSelection,
    reviewPromotionCandidate, promotionManagement, revokePromotion, manageEvidenceProjection,
    normalizedPayload, normalizedReview,
  };
}
