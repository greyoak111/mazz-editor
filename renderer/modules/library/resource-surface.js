const STATE_LABELS = Object.freeze({
  discovered: '已发现', resolving: '解析中', 'awaiting-rights': '等待权利确认',
  inspecting: '检查中', 'awaiting-selection': '等待选档', queued: '已排队',
  downloading: '下载中', paused: '已暂停', verifying: '校验中',
  materializing: '入库发布中', 'awaiting-import': '等待写入书架', imported: '已入架',
  failed: '失败', cancelled: '已取消',
});

const RIGHTS_LABELS = Object.freeze({
  'public-domain': '公版来源主张', 'open-license': '开放许可', 'user-owned': '用户自有',
  unknown: '权利未知', restricted: '受限',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function byteText(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function exactWorkspace(value) {
  return typeof value === 'string' && value ? value : '';
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export function createLibraryResourceSurface({
  root,
  invoke,
  getWorkspacePath,
  canUse,
  track,
  toast,
} = {}) {
  if (!root || typeof invoke !== 'function' || typeof getWorkspacePath !== 'function'
      || typeof canUse !== 'function' || typeof track !== 'function') {
    throw new TypeError('Library resource surface dependencies are incomplete');
  }
  const view = root.querySelector('.lib-resource-view');
  const shelfView = root.querySelector('.lib-shelf-view');
  const query = view.querySelector('.lib-resource-query');
  const providers = view.querySelector('.lib-resource-providers');
  const candidateList = view.querySelector('.lib-resource-candidates');
  const jobList = view.querySelector('.lib-resource-jobs');
  const summary = view.querySelector('.lib-resource-summary');
  const configPanel = view.querySelector('.lib-resource-config');
  const manualPanel = view.querySelector('.lib-resource-manual');
  let generation = 0;
  let controller = null;
  let snapshot = null;
  let continuations = [];
  let visible = false;
  let destroyed = false;

  const workspacePayload = () => {
    const workspacePath = exactWorkspace(getWorkspacePath());
    if (!workspacePath) throw new Error('书库尚未绑定 Workspace');
    return { workspacePath };
  };

  const authority = () => !destroyed && canUse();

  const call = (channel, payload) => {
    if (!authority()) return Promise.reject(Object.assign(new Error('资源页当前没有写权'), { stale: true }));
    return track(invoke(channel, payload));
  };

  function renderProviders(items) {
    providers.innerHTML = asList(items).map(item => `
      <label class="lib-resource-provider">
        <input type="checkbox" value="${escapeHtml(item.providerId)}" ${item.configured ? 'checked' : ''} ${item.configured ? '' : 'disabled'}>
        <span>${escapeHtml(item.displayName)}</span>
      </label>`).join('') || '<span class="lib-resource-muted">尚无可检索来源</span>';
  }

  function decisionText(candidate) {
    const outcome = candidate.decision?.outcome || 'awaiting-rights';
    if (outcome === 'pass') return '可取得';
    if (outcome === 'blocked') return '禁止取得';
    return '等待权利确认';
  }

  function renderCandidates(items) {
    const rows = asList(items);
    if (!rows.length) {
      candidateList.innerHTML = '<div class="lib-resource-empty">没有候选。设置 contact 后搜索官方目录，或手动添加公共 HTTPS 地址。</div>';
      return;
    }
    candidateList.innerHTML = rows.map(candidate => {
      const offers = asList(candidate.offers).map(offer => {
        const pass = candidate.decision?.outcome === 'pass' && offer.transport === 'https';
        return `<button class="rb-btn lib-resource-offer" data-resource-acquire="1"
          data-candidate-id="${escapeHtml(candidate.candidateId)}"
          data-candidate-fingerprint="${escapeHtml(candidate.candidateFingerprint)}"
          data-offer-id="${escapeHtml(offer.offerId)}" ${pass ? '' : 'disabled'}
          title="${escapeHtml(pass ? '创建持久取得任务' : decisionText(candidate))}">
          ${escapeHtml(String(offer.format || '').toUpperCase())} · ${escapeHtml(byteText(offer.size))}
        </button>`;
      }).join('');
      return `<article class="lib-resource-card" data-candidate="${escapeHtml(candidate.candidateId)}">
        <div class="lib-resource-card-main">
          <b>${escapeHtml(candidate.title)}</b>
          <span class="lib-resource-muted">${escapeHtml(asList(candidate.authors).join(' / ') || '作者未知')}</span>
          <span class="lib-resource-meta">${escapeHtml(candidate.providerName)} · ${escapeHtml(candidate.editionCount)} 个版本</span>
        </div>
        <div class="lib-resource-card-side">
          <span class="lib-resource-badge rights-${escapeHtml(candidate.rights?.status || 'unknown')}">${escapeHtml(RIGHTS_LABELS[candidate.rights?.status] || candidate.rights?.status)}</span>
          <span class="lib-resource-decision">${escapeHtml(decisionText(candidate))}${candidate.decision?.reasonCode ? ` · ${escapeHtml(candidate.decision.reasonCode)}` : ''}</span>
          <div class="lib-resource-offers">${offers || '<span class="lib-resource-muted">无可读格式</span>'}</div>
        </div>
      </article>`;
    }).join('');
  }

  function jobActions(job) {
    const buttons = [];
    if (job.state === 'queued' || job.state === 'downloading') buttons.push(['pause', '暂停']);
    if (job.state === 'paused' && job.retryFrom === 'downloading') buttons.push(['resume', '继续']);
    if (job.state === 'failed' && job.retryFrom === 'downloading') buttons.push(['retry', '重试']);
    if (!['imported', 'cancelled', 'awaiting-import', 'materializing'].includes(job.state)) buttons.push(['cancel', '取消']);
    return buttons.map(([action, label]) => `<button class="rb-btn" data-resource-action="${action}"
      data-job-id="${escapeHtml(job.jobId)}" data-job-revision="${escapeHtml(job.revision)}">${label}</button>`).join('');
  }

  function renderJobs(items) {
    const rows = asList(items);
    if (!rows.length) {
      jobList.innerHTML = '<div class="lib-resource-empty">还没有取得任务。</div>';
      return;
    }
    jobList.innerHTML = rows.map(job => {
      const received = Number(job.bytes?.received) || 0;
      const total = Number(job.bytes?.total);
      const ratio = Number.isFinite(total) && total > 0 ? Math.min(100, received / total * 100) : null;
      return `<article class="lib-resource-job">
        <div class="lib-resource-job-title">
          <b>${escapeHtml(STATE_LABELS[job.state] || job.state)}</b>
          <code>${escapeHtml(job.providerId)} · ${escapeHtml(job.transport)}</code>
        </div>
        <div class="lib-resource-progress"><span style="width:${ratio == null ? 0 : ratio}%"></span></div>
        <div class="lib-resource-meta">${escapeHtml(byteText(received))}${ratio == null ? '' : ` / ${escapeHtml(byteText(total))}`}${job.errorCode ? ` · ${escapeHtml(job.errorCode)}` : ''}</div>
        <div class="lib-resource-job-actions">${jobActions(job)}</div>
      </article>`;
    }).join('');
  }

  function renderConfiguration(config = {}) {
    view.querySelector('.lib-resource-contact').value = config.contact || '';
    view.querySelector('.lib-resource-jurisdiction').value = config.jurisdiction || '';
    const rows = asList(config.opds);
    const list = view.querySelector('.lib-resource-opds-list');
    list.innerHTML = rows.map(item => `<div class="lib-resource-opds-row">
      <span><b>${escapeHtml(item.displayName)}</b><small>${escapeHtml(item.providerId)} · OPDS ${escapeHtml(item.version)}</small></span>
      <button class="rb-btn" data-resource-remove-opds="${escapeHtml(item.providerId)}">移除</button>
    </div>`).join('') || '<span class="lib-resource-muted">未配置自有 OPDS</span>';
  }

  function render(next) {
    snapshot = next;
    renderProviders(next.providers);
    renderCandidates(next.candidates);
    renderJobs(next.jobs);
    renderConfiguration(next.configuration);
    const corruptionCount = asList(next.corruptions?.candidates).length + asList(next.corruptions?.checkpoints).length;
    summary.textContent = `${asList(next.candidates).length} 个候选 · ${asList(next.jobs).length} 个任务 · ${next.pendingInbox || 0} 个待入架${corruptionCount ? ` · ${corruptionCount} 个账本损坏` : ''}`;
    view.classList.toggle('has-corruption', corruptionCount > 0);
  }

  async function refresh() {
    if (!authority()) return null;
    const owner = ++generation;
    const result = await call('library:resourceSnapshot', workspacePayload());
    if (!authority() || owner !== generation) return null;
    render(result);
    return result;
  }

  async function search({ more = false } = {}) {
    const text = query.value.trim();
    if (!text) { toast?.('请输入书名或作者'); return; }
    controller?.abort();
    controller = new AbortController();
    const owner = ++generation;
    view.classList.add('is-loading');
    try {
      const selected = [...providers.querySelectorAll('input:checked')].map(input => input.value);
      if (!selected.length) { toast?.('请先选择一个已配置来源'); return; }
      const page = await call('library:resourceSearch', {
        ...workspacePayload(),
        query: text,
        providers: selected,
        continuations: more ? continuations.filter(item => selected.includes(item.providerId)) : [],
      });
      if (!authority() || owner !== generation) return;
      continuations = asList(page.continuations);
      const merged = new Map((more ? asList(snapshot?.candidates) : []).map(item => [item.candidateId, item]));
      for (const candidate of asList(page.candidates)) merged.set(candidate.candidateId, candidate);
      renderCandidates([...merged.values()]);
      view.querySelector('[data-resource-more]').hidden = continuations.length === 0;
      if (page.failures?.length) toast?.(`部分来源失败：${page.failures.map(item => item.providerId).join('、')}`);
    } catch (error) {
      if (error?.name !== 'AbortError' && authority()) toast?.(`资源检索失败：${error?.message || error}`);
    } finally {
      if (owner === generation) view.classList.remove('is-loading');
    }
  }

  async function saveConfiguration(opdsOverride) {
    const current = snapshot?.configuration || { opds: [] };
    const payload = {
      ...workspacePayload(),
      contact: view.querySelector('.lib-resource-contact').value.trim(),
      jurisdiction: view.querySelector('.lib-resource-jurisdiction').value,
      opds: opdsOverride || current.opds || [],
    };
    await call('library:resourceConfigure', payload);
    await refresh();
    toast?.('资源来源设置已保存');
  }

  view.querySelector('[data-resource-search]').addEventListener('click', () => void search());
  view.querySelector('[data-resource-back]').addEventListener('click', () => hide());
  view.querySelector('[data-resource-more]').addEventListener('click', () => void search({ more: true }));
  query.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void search(); }
  });
  view.querySelector('[data-resource-refresh]').addEventListener('click', () => void refresh().catch(error => toast?.(`刷新失败：${error?.message || error}`)));
  view.querySelector('[data-resource-repair]').addEventListener('click', async () => {
    try { await call('library:resourceRepair', workspacePayload()); await refresh(); toast?.('取得账本已完成恢复与对账'); }
    catch (error) { toast?.(`修复未完成：${error?.message || error}`); }
  });
  view.querySelector('[data-resource-save-config]').addEventListener('click', () => {
    void saveConfiguration().catch(error => toast?.(`设置失败：${error?.message || error}`));
  });
  view.querySelector('[data-resource-add-opds]').addEventListener('click', () => {
    const providerId = view.querySelector('.lib-resource-opds-provider').value.trim();
    const displayName = view.querySelector('.lib-resource-opds-name').value.trim();
    const rootUrl = view.querySelector('.lib-resource-opds-root').value.trim();
    const searchTemplate = view.querySelector('.lib-resource-opds-search').value.trim();
    const version = view.querySelector('.lib-resource-opds-version').value;
    if (!providerId || !displayName || !rootUrl || !searchTemplate) { toast?.('请填完整 OPDS 来源'); return; }
    const opds = [...asList(snapshot?.configuration?.opds), { providerId, displayName, rootUrl, searchTemplate, version }];
    void saveConfiguration(opds).catch(error => toast?.(`添加 OPDS 失败：${error?.message || error}`));
  });
  configPanel.addEventListener('click', event => {
    const button = event.target.closest('[data-resource-remove-opds]');
    if (!button) return;
    const opds = asList(snapshot?.configuration?.opds).filter(item => item.providerId !== button.dataset.resourceRemoveOpds);
    void saveConfiguration(opds).catch(error => toast?.(`移除 OPDS 失败：${error?.message || error}`));
  });
  view.querySelector('[data-resource-add-manual]').addEventListener('click', async () => {
    try {
      const candidate = await call('library:resourceManual', {
        ...workspacePayload(),
        url: manualPanel.querySelector('.lib-resource-manual-url').value.trim(),
        format: manualPanel.querySelector('.lib-resource-manual-format').value,
        title: manualPanel.querySelector('.lib-resource-manual-title').value.trim(),
        authors: manualPanel.querySelector('.lib-resource-manual-authors').value.split(/[，,]/).map(item => item.trim()).filter(Boolean),
        language: manualPanel.querySelector('.lib-resource-manual-language').value.trim(),
      });
      renderCandidates([candidate, ...asList(snapshot?.candidates).filter(item => item.candidateId !== candidate.candidateId)]);
      await refresh();
      toast?.('已保存手动候选；权利未知，不会自动下载');
    } catch (error) { toast?.(`添加失败：${error?.message || error}`); }
  });
  candidateList.addEventListener('click', async event => {
    const button = event.target.closest('[data-resource-acquire]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await call('library:resourceAcquire', {
        ...workspacePayload(),
        candidateId: button.dataset.candidateId,
        candidateFingerprint: button.dataset.candidateFingerprint,
        offerId: button.dataset.offerId,
        intentId: `intent-${crypto.randomUUID()}`,
      });
      await refresh();
      toast?.('取得任务已建立');
    } catch (error) { toast?.(`无法取得：${error?.message || error}`); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  jobList.addEventListener('click', async event => {
    const button = event.target.closest('[data-resource-action]');
    if (!button) return;
    button.disabled = true;
    try {
      await call('library:resourceAction', {
        ...workspacePayload(),
        jobId: button.dataset.jobId,
        expectedRevision: Number(button.dataset.jobRevision),
        action: button.dataset.resourceAction,
      });
      await refresh();
    } catch (error) { toast?.(`任务操作失败：${error?.message || error}`); }
    finally { if (button.isConnected) button.disabled = false; }
  });

  function show() {
    if (!authority()) return false;
    visible = true;
    shelfView.style.display = 'none';
    view.style.display = 'flex';
    void refresh().catch(error => { if (authority()) toast?.(`资源页加载失败：${error?.message || error}`); });
    return true;
  }

  function hide({ showShelf = true } = {}) {
    visible = false;
    generation += 1;
    controller?.abort();
    controller = null;
    view.style.display = 'none';
    if (showShelf && !destroyed) shelfView.style.display = 'flex';
    return true;
  }

  function abort() {
    generation += 1;
    controller?.abort();
    controller = null;
  }

  function resume() {
    if (visible && authority()) return refresh();
    return Promise.resolve(null);
  }

  function destroy() {
    destroyed = true;
    abort();
    view.remove();
  }

  return Object.freeze({ show, hide, refresh, resume, abort, destroy, isVisible: () => visible });
}

export default { createLibraryResourceSurface };
