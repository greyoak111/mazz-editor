// renderer/modules/factory/desk.js —— W68b Factory Desk：三栏活稿车间正式窗格模块
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { inputModal, modal, toast } from '../../shell/shell.js';
import {
  FACTORY_ARCHIVE_FILE, appendFactoryArchiveText, buildFactoryDebateThreads,
  buildFactoryVirtualItems, computeFactoryVirtualWindow, filterFactoryEvents,
  findFactoryMatches, normalizeFactoryEvent, parseFactoryArchive,
} from './workshop.js';
import {
  FACTORY_COMMAND_LABELS, buildLockedBibleProposal, classifyFactoryInstruction,
  computeFactoryHealth, evaluateBudgetCap, makeBudgetCard, makeClarificationCard,
  makeDiffConfirmationCard,
} from './command-gate.js';
import {
  FACTORY_LIVE_REF_MIME, classifyInstructionMailbox, createArtifactLiveReference,
  createMobileApprovalRequest, makeBibleConflictCard, normalizeFactoryUsageRecord,
  reconcileLockedBible, reconcileMonthlyUsage,
} from './bridge-runtime.js';
import { productFileName, productText } from './terms.js';

const MODULE = 'factorydesk';
const TASKS_KEY = 'mazz.factory.tasks';
const VIEW_KEY = 'mazz.factory.desk.view';
const instances = new Map();
let current = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pathName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const normPath = p => String(p || '').replace(/\\/g, '/').replace(/\/$/, '');
const typeLabel = Object.freeze({ body: '正文', skeleton: '总纲', review: '交叉审校', verdict: '仲裁', help: '协助', system: '系统' });

async function readOptional(path) {
  if (!path) return '';
  const st = await window.mazz.invoke('fs:stat', { path }).catch(() => null);
  return st?.exists && !st.isDir ? String(await window.mazz.invoke('fs:readFile', { path }).catch(() => '')) : '';
}

function tasksWithFolders() {
  try { return (JSON.parse(localStorage.getItem(TASKS_KEY)) || []).filter(row => row?.folder); }
  catch { return []; }
}

function tinyHash(text = '') {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return (n >>> 0).toString(36);
}

function inlineMarkdown(line) {
  return esc(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="fd-md-link" title="$2">$1</span>');
}

function renderMarkdown(markdown, query = '') {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const out = [];
  let code = false, list = false, table = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } if (table) { out.push('</tbody></table></div>'); table = false; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) { close(); code = !code; out.push(code ? '<pre><code>' : '</code></pre>'); continue; }
    if (code) { out.push(esc(line) + '\n'); continue; }
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) { close(); out.push(`<h${h[1].length}>${inlineMarkdown(h[2])}</h${h[1].length}>`); continue; }
    if (/^>\s?/.test(line)) { close(); out.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^[-*+]\s+/.test(line)) { if (!list) { close(); list = true; out.push('<ul>'); } out.push(`<li>${inlineMarkdown(line.replace(/^[-*+]\s+/, ''))}</li>`); continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-+/.test(lines[i + 1] || '')) {
      close(); table = true; const cells = line.split('|').slice(1, -1); out.push('<div class="fd-table-wrap"><table><thead><tr>' + cells.map(x => `<th>${inlineMarkdown(x.trim())}</th>`).join('') + '</tr></thead><tbody>'); i++; continue;
    }
    if (table && /^\|.*\|\s*$/.test(line)) { const cells = line.split('|').slice(1, -1); out.push('<tr>' + cells.map(x => `<td>${inlineMarkdown(x.trim())}</td>`).join('') + '</tr>'); continue; }
    close();
    out.push(line.trim() ? `<p>${inlineMarkdown(line)}</p>` : '<br>');
  }
  close(); if (code) out.push('</code></pre>');
  let html = out.join('');
  if (query) {
    const safe = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { html = html.replace(new RegExp(`(${safe})`, 'ig'), '<mark>$1</mark>'); } catch {}
  }
  return html;
}

async function listFiles(root, { depth = 3 } = {}) {
  const out = [];
  const walk = async (dir, level) => {
    if (level > depth) return;
    const rows = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
    for (const row of rows || []) {
      const path = row.path || `${dir}/${row.name}`;
      if (row.isDir) await walk(path, level + 1);
      else if (/\.(md|markdown|json)$/i.test(row.name) && row.name !== FACTORY_ARCHIVE_FILE) out.push({ name: row.name, path, level });
    }
  };
  if (root) await walk(root, 0);
  return out;
}

function makeRoot(container) {
  const root = document.createElement('div');
  root.className = 'factory-desk';
  root.innerHTML = `
    <header class="fd-topbar">
      <div class="fd-brand"><b>智能创作台</b><span>创作流</span></div>
      <select class="fd-task-select" aria-label="选择创作项目"></select>
      <div class="fd-views" role="tablist">
        <button data-view="body">只看正文</button><button data-view="workshop">创作流全景</button><button data-view="summary">摘要折叠</button>
      </div>
      <label class="fd-search">⌕ <input placeholder="窗内搜索并展开…" spellcheck="false"><span></span></label>
      <button class="fd-icon" data-a="refresh" title="从创作流档案重载">↻</button>
      <button class="fd-icon" data-a="economics" title="实收、结算、月度对账与配额">¥</button>
      <button class="fd-icon" data-a="mobile" title="生成手机审批同步包（客户端条件门）">▣</button>
    </header>
    <section class="fd-pins">
      <button class="fd-pin" data-pin="bible"><i>设定集</i><b>等待载入</b><span>—</span></button>
      <button class="fd-pin" data-pin="precedent"><i>先例库</i><b>等待载入</b><span>—</span></button>
      <button class="fd-stat fd-budget-pin" data-a="budget"><i>成本</i><b data-stat="cost">—</b><span data-stat="cost-note">实收待回供</span></button>
      <div class="fd-stat"><i>退回率</i><b data-stat="return">0%</b><span>已审结单元</span></div>
      <div class="fd-stat"><i>在途</i><b data-stat="flight">0</b><span>项目</span></div>
      <button class="fd-stat fd-health-pin" data-a="health"><i>运行</i><b>7 项</b><span>点开展开</span></button>
    </section>
    <section class="fd-health" hidden><header><b>运行看板</b><span>质量指标自动汇总</span><button type="button" data-a="health-close">收起</button></header><div class="fd-health-grid"></div></section>
    <main class="fd-grid">
      <aside class="fd-directory"><div class="fd-pane-head"><b>章节目录</b><span data-dir-count>0</span></div><div class="fd-dir-list"></div></aside>
      <section class="fd-center">
        <div class="fd-stream" tabindex="0"><div class="fd-vtop"></div><div class="fd-vitems"></div><div class="fd-vbottom"></div><div class="fd-empty">选择一个已有输出目录的创作项目</div></div>
        <form class="fd-instruction"><textarea rows="2" placeholder="指令将分为创作／规则／校验／咨询；含义不清时会先确认。Ctrl+Enter 发送" spellcheck="false"></textarea><button>提交</button></form>
      </section>
      <aside class="fd-compare"><div class="fd-pane-head"><b>产物对照</b><button data-a="close-compare">收起</button></div><div class="fd-files"></div><article class="fd-preview"><div class="fd-preview-empty">点目录或卡片文件，在此对照</div></article></aside>
    </main>`;
  container.appendChild(root);
  return root;
}

function createDesk(container) {
  const root = makeRoot(container);
  const ctl = {
    root, container, task: null, folder: '', events: [], view: localStorage.getItem(VIEW_KEY) || 'workshop',
    memory: {}, items: [], heights: {}, files: [], query: '', activeEventId: '', archiveHash: '', disposed: false,
    threads: [], threadMap: new Map(), costs: {}, startTimer: 0, reloadTimer: 0, suppressReloadUntil: 0,
  };
  const stream = root.querySelector('.fd-stream');
  const itemHost = root.querySelector('.fd-vitems');
  const taskSelect = root.querySelector('.fd-task-select');

  const memoryKey = () => `mazz.factory.desk.collapse.${tinyHash(ctl.folder)}`;
  const loadMemory = () => { try { ctl.memory = JSON.parse(localStorage.getItem(memoryKey())) || {}; } catch { ctl.memory = {}; } };
  const saveMemory = () => localStorage.setItem(memoryKey(), JSON.stringify(ctl.memory));
  const withinProject = path => {
    const target = normPath(path).toLocaleLowerCase();
    const base = `${ctl.folder}/`.toLocaleLowerCase();
    return !!ctl.folder && target.startsWith(base) && !target.includes('/../');
  };

  function populateTasks(prefer = '') {
    const tasks = tasksWithFolders();
    taskSelect.innerHTML = tasks.length ? tasks.map(t => `<option value="${esc(t.id)}">${esc(t.label)} · ${esc(t.status || 'pending')}</option>`).join('') : '<option value="">暂无已落目录项目</option>';
    const wanted = prefer || ctl.task?.id || tasks.at(-1)?.id || '';
    if (tasks.some(t => t.id === wanted)) taskSelect.value = wanted;
    ctl.task = tasks.find(t => t.id === taskSelect.value) || null;
    ctl.folder = normPath(ctl.task?.folder);
    root.querySelector('[data-stat=flight]').textContent = tasks.filter(t => ['pending', 'running', 'paused'].includes(t.status)).length;
  }

  function setView(view) {
    ctl.view = ['body', 'workshop', 'summary'].includes(view) ? view : 'workshop';
    localStorage.setItem(VIEW_KEY, ctl.view);
    root.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('on', btn.dataset.view === ctl.view));
    rebuildItems();
  }

  function renderDirectory() {
    const host = root.querySelector('.fd-dir-list');
    const units = new Map();
    for (const event of filterFactoryEvents(ctl.events, ctl.view)) {
      const key = event.unitNo || 0;
      if (!units.has(key)) units.set(key, { no: key, unitName: event.unitName, events: [] });
      units.get(key).events.push(event);
    }
    const rows = [...units.values()].sort((a, b) => a.no - b.no);
    root.querySelector('[data-dir-count]').textContent = `${rows.length} 节`;
    host.innerHTML = rows.length ? rows.map(unit => `<div class="fd-dir-unit"><button data-jump="${esc(unit.events[0].id)}"><b>${unit.no ? `第 ${unit.no} ${esc(unit.unitName)}` : '公共区'}</b><span>${unit.events.length} 件</span></button>${unit.events.map(e => `<button class="fd-dir-event type-${e.type}" data-jump="${esc(e.id)}"><i>${esc(typeLabel[e.type])}</i>${esc(productText(e.title))}</button>`).join('')}</div>`).join('') : '<div class="fd-side-empty">创作流暂无事件</div>';
    host.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => jumpToEvent(btn.dataset.jump, true)));
  }

  function cardHtml(item) {
    const e = item.event;
    const thread = ctl.threadMap.get(e.id);
    const threadBadge = thread ? `<button class="fd-thread" data-thread="${esc(thread.id)}" data-event="${esc(e.id)}" title="跳到本复核线程下一件">↕ ${thread.index + 1}/${thread.total}</button>` : '';
    const continuation = item.chunkCount > 1 ? `<span class="fd-chunk">${item.chunkIndex + 1}/${item.chunkCount}</span>` : '';
    const progress = e.progress == null ? '' : `<div class="fd-progress"><i style="width:${e.progress}%"></i><span>${e.progress}%</span></div>`;
    if (item.collapsed) return `<article class="fd-card collapsed type-${e.type} tone-${e.tone || 'plain'}" data-event="${esc(e.id)}" data-item="${esc(item.id)}"><button class="fd-fold" title="就地展开">›</button><span class="fd-tag">${esc(typeLabel[e.type])}</span><b>${esc(productText(e.title))}</b>${threadBadge}<time>${esc(String(e.createdAt).slice(0, 16).replace('T', ' '))}</time>${progress}</article>`;
    const resolution = [...ctl.events].reverse().find(row => row.refId === e.id && ['instruction-choice', 'lock-decision', 'bible-conflict-decision', 'final-human', 'budget-decision', 'help-decision'].includes(row.stage));
    const resolved = resolution ? `<div class="fd-resolution">已处理：${esc(productText(resolution.title))}</div>` : '';
    let actions = '';
    if (!resolution && e.card?.kind === 'clarify') actions = `<div class="fd-card-actions">${(e.card.options || []).map(option => `<button data-card-action="clarify:${esc(option.id)}">按「${esc(option.label)}」处理</button>`).join('')}</div>`;
    if (!resolution && e.card?.kind === 'diff-confirm') actions = '<div class="fd-card-actions"><button class="primary" data-card-action="diff:confirm">确认写入设定集</button><button data-card-action="diff:reject">拒绝变更</button></div>';
    if (!resolution && e.card?.kind === 'bible-conflict') actions = '<div class="fd-card-actions"><button class="primary" data-card-action="conflict:human">保留人工版本</button><button class="danger" data-card-action="conflict:ai">以 AI 提案覆盖</button></div>';
    if (!resolution && e.card?.kind === 'final-review') actions = '<div class="fd-card-actions"><button class="primary" data-card-action="final:seal">入库定本</button><button class="danger" data-card-action="final:return">退回修订</button><button data-card-action="final:hold">暂缓</button></div>';
    if (!resolution && e.card?.kind === 'budget') actions = '<div class="fd-card-actions"><button class="primary" data-card-action="budget:degrade">降级继续</button><button class="danger" data-card-action="budget:stop">暂停</button></div>';
    if (!resolution && e.card?.kind === 'help-moment') actions = '<div class="fd-card-actions"><button data-card-action="help:approve">批准升级</button><button data-card-action="help:return">退回修订</button><button data-card-action="help:evidence">要求补证</button></div>';
    return `<article class="fd-card type-${e.type} tone-${e.tone || 'plain'}" data-event="${esc(e.id)}" data-item="${esc(item.id)}"><header><button class="fd-fold" title="折叠">⌄</button><span class="fd-tag">${esc(typeLabel[e.type])}</span><b>${esc(productText(e.title))}</b>${continuation}${threadBadge}<time>${esc(String(e.createdAt).slice(0, 16).replace('T', ' '))}</time></header>${progress}<div class="fd-md">${renderMarkdown(item.content, ctl.query)}</div>${e.artifactPath ? `<button class="fd-artifact" draggable="true" data-path="${esc(e.artifactPath)}" data-live-path="${esc(e.artifactPath)}" title="打开；也可拖入 Markdown 成为块级活引用">产物 ↗ ${esc(productFileName(pathName(e.artifactPath)))}</button>` : ''}${resolved}${actions}</article>`;
  }

  function bindCards() {
    itemHost.querySelectorAll('.fd-card').forEach(card => {
      card.querySelector('.fd-fold')?.addEventListener('click', () => {
        const id = card.dataset.event; ctl.memory[id] = !card.classList.contains('collapsed'); saveMemory(); rebuildItems(id);
      });
      card.querySelector('[data-path]')?.addEventListener('click', () => openCompare(card.querySelector('[data-path]').dataset.path));
      card.querySelector('[data-live-path]')?.addEventListener('dragstart', event => {
        const ref = createArtifactLiveReference({ artifactPath: event.currentTarget.dataset.livePath, eventId: card.dataset.event, label: card.querySelector('header > b')?.textContent || '' });
        event.dataTransfer.effectAllowed = 'copyLink';
        event.dataTransfer.setData(FACTORY_LIVE_REF_MIME, ref.syntax);
        event.dataTransfer.setData('text/plain', ref.syntax);
      });
      card.querySelector('[data-thread]')?.addEventListener('click', event => { event.stopPropagation(); jumpThread(event.currentTarget.dataset.thread, event.currentTarget.dataset.event); });
      card.querySelectorAll('[data-card-action]').forEach(btn => btn.addEventListener('click', () => performCardAction(card.dataset.event, btn.dataset.cardAction)));
    });
    requestAnimationFrame(() => {
      itemHost.querySelectorAll('[data-item]').forEach(node => { ctl.heights[node.dataset.item] = Math.max(24, node.getBoundingClientRect().height + 10); });
    });
  }

  function renderVirtual() {
    if (!ctl.items.length) { root.querySelector('.fd-empty').style.display = 'grid'; itemHost.innerHTML = ''; root.querySelector('.fd-vtop').style.height = '0'; root.querySelector('.fd-vbottom').style.height = '0'; return; }
    root.querySelector('.fd-empty').style.display = 'none';
    const win = computeFactoryVirtualWindow(ctl.items, stream.scrollTop, stream.clientHeight || 700, ctl.heights, 2);
    root.querySelector('.fd-vtop').style.height = `${win.top}px`;
    root.querySelector('.fd-vbottom').style.height = `${win.bottom}px`;
    itemHost.innerHTML = win.items.map(cardHtml).join('');
    bindCards();
  }

  function rebuildItems(focusId = '') {
    ctl.threads = buildFactoryDebateThreads(ctl.events);
    ctl.threadMap = new Map();
    for (const thread of ctl.threads) {
      const rows = [...thread.objection, ...thread.answer, ...thread.verdict]
        .sort((a, b) => ctl.events.findIndex(x => x.id === a.id) - ctl.events.findIndex(x => x.id === b.id));
      rows.forEach((event, index) => ctl.threadMap.set(event.id, { id: thread.id, index, total: rows.length, rows }));
    }
    ctl.items = buildFactoryVirtualItems(ctl.events, ctl.memory, { view: ctl.view, chunkChars: 12000, keepRecentUnits: 2 });
    renderDirectory(); renderVirtual();
    if (focusId) setTimeout(() => jumpToEvent(focusId, false), 20);
  }

  function jumpToEvent(id, expand) {
    if (!id) return;
    if (expand) { ctl.memory[id] = false; saveMemory(); ctl.items = buildFactoryVirtualItems(ctl.events, ctl.memory, { view: ctl.view, chunkChars: 12000, keepRecentUnits: 2 }); }
    const index = ctl.items.findIndex(item => item.eventId === id);
    if (index < 0) return;
    let top = 0;
    for (let i = 0; i < index; i++) top += Number(ctl.heights[ctl.items[i].id]) || ctl.items[i].estimatedHeight;
    ctl.activeEventId = id; stream.scrollTop = Math.max(0, top - 70); renderVirtual();
    setTimeout(() => itemHost.querySelector(`[data-event="${CSS.escape(id)}"]`)?.classList.add('located'), 30);
  }

  function jumpThread(threadId, eventId) {
    const meta = ctl.threadMap.get(eventId);
    if (!meta || meta.id !== threadId || !meta.rows.length) return;
    jumpToEvent(meta.rows[(meta.index + 1) % meta.rows.length].id, true);
  }

  async function renderPins() {
    const bible = await readOptional(`${ctl.folder}/圣经.md`);
    const precedent = await readOptional(`${ctl.folder}/判例库.md`);
    const costsText = await readOptional(`${ctl.folder}/成本台账.json`);
    let costs = {}; try { costs = JSON.parse(costsText) || {}; } catch {}
    ctl.costs = costs;
    const setPin = (name, text) => {
      const btn = root.querySelector(`[data-pin=${name}]`); const old = btn.dataset.hash || '';
      const hash = tinyHash(text); btn.dataset.hash = hash;
      btn.querySelector('b').textContent = text ? `${text.length.toLocaleString()} 字` : '尚未建立';
      btn.querySelector('span').textContent = old && old !== hash ? '有更新' : (text ? `版本 ${hash.slice(0, 5)}` : '—');
      btn.classList.toggle('changed', !!old && old !== hash);
    };
    setPin('bible', bible); setPin('precedent', precedent);
    const legacyEstimates = (costs.units || []).map((row, index) => ({
      kind: 'estimate', taskRef: ctl.task?.id || 'factory-project', totalTokens: Number(row.budget?.usedTokens) || 0,
      observedAt: row.at || new Date(0).toISOString(), sourceRef: `${ctl.folder}/成本台账.json#unit-${row.unitNo || index + 1}`,
    })).filter(row => row.totalTokens);
    ctl.reconciliation = reconcileMonthlyUsage([...(costs.usageRecords || []), ...legacyEstimates], {
      quotaTokens: costs.monthlyQuotaTokens || null,
    });
    const actual = ctl.reconciliation.tokensByKind['provider-reported'];
    const estimated = ctl.reconciliation.tokensByKind.estimate;
    root.querySelector('[data-stat=cost]').textContent = actual ? actual.toLocaleString() : '—';
    root.querySelector('[data-stat=cost-note]').textContent = actual ? `本月实收 · 估算 ${estimated.toLocaleString()}` : `实收待回供 · 估算 ${estimated.toLocaleString()}`;
    const verdictUnits = new Set(ctl.events.filter(e => e.type === 'verdict').map(e => e.unitNo || e.id));
    const returnedUnits = new Set(ctl.events.filter(e => e.tone === 'disagreement' || (e.stage === 'repair' && !/(?:^|\n)\s*-\s*(?:无|本轮未执行)/.test(e.content))).map(e => e.unitNo || e.id));
    root.querySelector('[data-stat=return]').textContent = verdictUnits.size ? `${Math.min(100, Math.round(returnedUnits.size / verdictUnits.size * 100))}%` : '0%';
  }

  function renderHealth() {
    const rows = computeFactoryHealth(ctl.events);
    const host = root.querySelector('.fd-health-grid');
    const stageMap = {
      machineReturnRate: ['machine'], reviewReturnRate: ['repair', 'review'], hearingRate: ['hearing'],
      revisionFirstPassRate: ['repair'], queryEffectivenessRate: ['objection'], evidenceWithdrawalRate: ['answer'],
      humanInterventionCount: ['final-human', 'help-decision', 'upgrade-human'],
    };
    const drillPath = row => [...ctl.events].reverse().find(event => stageMap[row.id]?.includes(event.stage) && event.artifactPath)?.artifactPath || `${ctl.folder}/${FACTORY_ARCHIVE_FILE}`;
    const metrics = rows.map(row => `<button class="fd-health-metric trend-${row.trend}" data-drill-path="${esc(drillPath(row))}" title="钻取到本指标对应工件或创作流原文"><i>${esc(productText(row.label))}</i><b>${esc(row.display)}</b><span>${esc(productText(row.target))}</span><small>${row.trend === 'good' ? '趋势改善' : row.trend === 'bad' ? '趋势需看' : '本周基线'} · 点开原文</small></button>`);
    const account = ctl.reconciliation || reconcileMonthlyUsage([]);
    metrics.push(`<button class="fd-health-metric" data-drill-path="${esc(`${ctl.folder}/成本台账.json`)}"><i>本月 Provider 实收</i><b>${account.tokensByKind['provider-reported'].toLocaleString()}</b><span>估算 ${account.tokensByKind.estimate.toLocaleString()} · 结算凭据 ${Object.keys(account.amountsByKind['settled-actual']).length}</span><small>分栏对账 · 点开原始台账</small></button>`);
    metrics.push(`<button class="fd-health-metric quota-${account.quota.state}" data-drill-path="${esc(`${ctl.folder}/成本台账.json`)}"><i>月度配额</i><b>${account.quota.state === 'gray' ? '—' : account.quota.remainingTokens.toLocaleString()}</b><span>${account.quota.state === 'gray' ? '未配置/未回供，明确灰显' : `余量 token · ${account.quota.state}`}</span><small>不以 unknown 补零</small></button>`);
    host.innerHTML = metrics.join('');
    host.querySelectorAll('[data-drill-path]').forEach(button => button.addEventListener('click', () => openCompare(button.dataset.drillPath)));
  }

  async function renderFiles() {
    ctl.files = await listFiles(ctl.folder);
    const host = root.querySelector('.fd-files');
    host.innerHTML = ctl.files.length ? ctl.files.map(row => `<button data-file="${esc(row.path)}" style="--depth:${row.level}"><span>${/\.json$/i.test(row.name) ? '{}' : '¶'}</span>${esc(productFileName(row.name))}</button>`).join('') : '<div class="fd-side-empty">暂无可对照产物</div>';
    host.querySelectorAll('[data-file]').forEach(btn => btn.addEventListener('click', () => openCompare(btn.dataset.file)));
  }

  async function openCompare(path) {
    const text = await readOptional(path);
    const preview = root.querySelector('.fd-preview');
    preview.innerHTML = `<header><b>${esc(productFileName(pathName(path)))}</b><button data-open>在编辑器打开</button></header><div class="fd-md">${/\.json$/i.test(path) ? `<pre><code>${esc(text)}</code></pre>` : renderMarkdown(text)}</div>`;
    preview.querySelector('[data-open]').addEventListener('click', () => window.MazzCommands.execute('file.openPath', { path }).catch(() => {}));
    root.classList.remove('compare-closed');
  }

  async function loadProject({ taskId = '', folder = '' } = {}) {
    populateTasks(taskId);
    if (folder) { ctl.folder = normPath(folder); ctl.task = ctl.task || { id: taskId || `folder-${tinyHash(folder)}`, label: pathName(folder), folder }; }
    loadMemory(); ctl.heights = {};
    const archive = await readOptional(`${ctl.folder}/${FACTORY_ARCHIVE_FILE}`);
    ctl.archiveHash = tinyHash(archive);
    ctl.events = parseFactoryArchive(archive);
    await Promise.all([renderPins(), renderFiles()]);
    renderHealth();
    rebuildItems();
    if (ctl.events.length) jumpToEvent(ctl.events.at(-1).id, false);
    window.MazzHost?.setTabTitle(
      container,
      ctl.task?.label ? `${ctl.task.label} · 智能创作台` : '智能创作台',
    );
  }

  async function appendEvents(events) {
    if (!ctl.folder) return false;
    ctl.suppressReloadUntil = Date.now() + 700;
    clearTimeout(ctl.reloadTimer); ctl.reloadTimer = 0;
    const path = `${ctl.folder}/${FACTORY_ARCHIVE_FILE}`;
    const old = await readOptional(path);
    const next = appendFactoryArchiveText(old, events, { title: `${ctl.task?.label || 'Mazz'} · 工厂群` });
    if (next !== old) await window.mazz.invoke('fs:writeFile', { path, content: next });
    await loadProject({ taskId: ctl.task?.id, folder: ctl.folder });
    return true;
  }

  function updateTask(patch) {
    let tasks = [];
    try { tasks = JSON.parse(localStorage.getItem(TASKS_KEY)) || []; } catch {}
    const index = tasks.findIndex(row => row.id === ctl.task?.id);
    if (index < 0) return null;
    tasks[index] = { ...tasks[index], ...patch };
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    ctl.task = tasks[index];
    window.dispatchEvent(new CustomEvent('mazz:factory-task-updated', { detail: { taskId: ctl.task.id, folder: ctl.folder, patch } }));
    return ctl.task;
  }

  async function writeCosts(costs) {
    ctl.costs = costs;
    await window.mazz.invoke('fs:writeFile', { path: `${ctl.folder}/成本台账.json`, content: JSON.stringify(costs, null, 2) });
    await loadProject({ taskId: ctl.task?.id, folder: ctl.folder });
  }

  async function openEconomicsDialog() {
    if (!ctl.folder) return;
    const account = ctl.reconciliation || reconcileMonthlyUsage(ctl.costs.usageRecords || [], { quotaTokens: ctl.costs.monthlyQuotaTokens || null });
    const settled = Object.entries(account.amountsByKind['settled-actual']).map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`).join(' / ') || '尚无结算凭据';
    const m = modal('Factory 成本对账');
    m.body.innerHTML = `<div style="min-width:420px;display:grid;gap:10px">
      <div><b>${esc(account.month)} 月度对账</b><p>Provider 实收 ${account.tokensByKind['provider-reported'].toLocaleString()} token；估算 ${account.tokensByKind.estimate.toLocaleString()} token；差额 ${account.estimatedVarianceTokens == null ? '待实收' : account.estimatedVarianceTokens.toLocaleString()}。</p><p>实际结算：${esc(settled)}；unknown ${account.unknownCount} 条保持未知。</p></div>
      <div><b>配额：${account.quota.state === 'gray' ? '未配置/未回供（灰显）' : `${account.quota.usedTokens.toLocaleString()} / ${account.quota.capTokens.toLocaleString()} token`}</b></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="rb-btn" data-e="ledger">打开原始台账</button><button class="rb-btn" data-e="quota">设置月度配额</button><button class="rb-btn" data-e="settle">登记实际结算</button></div>
    </div>`;
    m.body.querySelector('[data-e=ledger]').addEventListener('click', () => { openCompare(`${ctl.folder}/成本台账.json`); m.close(); });
    m.body.querySelector('[data-e=quota]').addEventListener('click', async () => {
      const value = await inputModal('月度 Token 配额（留空取消；只影响灰显/告警，不绕过人工 Gate）', String(ctl.costs.monthlyQuotaTokens || ''));
      if (value == null) return;
      const quota = Number(value);
      if (!Number.isFinite(quota) || quota <= 0) { toast('配额必须是正数'); return; }
      await writeCosts({ ...ctl.costs, monthlyQuotaTokens: quota }); m.close();
    });
    m.body.querySelector('[data-e=settle]').addEventListener('click', async () => {
      const amountText = await inputModal('输入本月已结算实际金额', '');
      if (amountText == null) return;
      const amount = Number(amountText);
      if (!Number.isFinite(amount) || amount < 0) { toast('金额无效'); return; }
      const currency = await inputModal('币种', 'CNY'); if (!currency) return;
      const sourceRef = await inputModal('结算凭据编号或本地路径（必填）', ''); if (!sourceRef) return;
      const record = normalizeFactoryUsageRecord({ kind: 'settled-actual', taskRef: ctl.task?.id || 'factory-project', amount, currency, sourceRef, observedAt: new Date().toISOString(), evidenceRefs: [sourceRef] });
      const usageRecords = [...(ctl.costs.usageRecords || [])].filter(row => row.usageId !== record.usageId).concat(record);
      await writeCosts({ ...ctl.costs, usageRecords }); m.close();
    });
  }

  async function createMobileApprovalPackage() {
    if (!ctl.folder || !ctl.task) return false;
    const resolved = new Set(ctl.events.filter(row => row.refId && ['instruction-choice', 'lock-decision', 'bible-conflict-decision', 'final-human', 'budget-decision', 'help-decision'].includes(row.stage)).map(row => row.refId));
    const target = [...ctl.events].reverse().find(row => row.card && !resolved.has(row.id));
    if (!target) { toast('当前没有等待人工裁决的卡片'); return false; }
    const request = createMobileApprovalRequest({
      taskId: ctl.task.id, gateId: target.id,
      artifactRefs: [target.artifactPath, target.card?.targetPath, target.card?.draftPath].filter(Boolean),
      authorityRequired: 'human:maintainer',
    });
    const packagePath = `${ctl.folder}/手机审批包.json`;
    await window.mazz.invoke('fs:writeFile', { path: packagePath, content: JSON.stringify({
      ...request,
      notice: '本地审批协议已落地；Mobile 客户端当前为 CONDITIONAL_MOBILE_CLIENT。仅同步完整且未过期的 human 回执，绝不在桌面端伪造手机审批。',
    }, null, 2) });
    await appendEvents(normalizeFactoryEvent({ type: 'system', title: '手机审批包已生成 · 客户端条件门', content: `审批对象：${target.title}\n\n本地包：${packagePath}\n\n客户端状态：**CONDITIONAL_MOBILE_CLIENT**；生成包不等于批准，也不会触发执行。`, stage: 'mobile-approval-package', refId: target.id, artifactPath: packagePath }));
    toast('手机审批同步包已落盘；当前没有可冒充的真手机客户端');
    return request;
  }

  async function forwardProduction(text) {
    const panel = window.MazzShell?.sideDock?.factoryPanel;
    if (panel?.agentInputEl) { panel.agentInputEl.value = text; panel.submitAgent?.(); }
    else { window.MazzCommands.execute('factory.toggleDock').catch(() => {}); toast('生产指令已过闸；智能创作坞已打开'); }
  }

  async function processInstruction(text, { forcedFamily = '', refId = '' } = {}) {
    if (!cleanInstruction(text) || !ctl.folder) return false;
    const decision = classifyInstructionMailbox(text, { forcedFamily });
    if (decision.ambiguous) {
      const card = makeClarificationCard(text, decision.options);
      await appendEvents(normalizeFactoryEvent({ type: 'help', title: '异步指令邮箱 L1 · 请二选一', content: `原话：**${text}**\n\n${decision.reason}。系统不猜，不触发任何生产动作。`, stage: 'instruction-clarify', family: 'ambiguous', refId, card }));
      return false;
    }
    if (decision.family === 'chat') {
      await appendEvents(normalizeFactoryEvent({ type: 'system', title: '异步指令邮箱 L0 · 闲聊收讫 · 零动作', content: `> ${text}\n\n已归为闲聊；**未调用模型、未触发生产、未改动文件**。`, stage: 'instruction-chat', family: 'chat', refId }));
      return true;
    }
    if (decision.family === 'legislation') {
      const targetPath = `${ctl.folder}/圣经.md`;
      const before = await readOptional(targetPath);
      const proposal = buildLockedBibleProposal(before, text);
      const card = makeDiffConfirmationCard({ targetPath, before: proposal.before, after: proposal.after, instruction: text });
      await appendEvents(normalizeFactoryEvent({ type: 'help', title: '异步指令邮箱 L2 · 锁定变更待确认', content: `规则指令：**${text}**\n\n\`\`\`diff\n${card.diff}\n\`\`\`\n\n确认前不会写入设定集。`, stage: 'lock-pending', family: 'legislation', refId, card }));
      return false;
    }
    const label = FACTORY_COMMAND_LABELS[decision.family];
    await appendEvents(normalizeFactoryEvent({ type: 'system', title: `异步指令邮箱 ${decision.level} · ${label}`, content: `> ${text}\n\n分类：**${label}**。${decision.family === 'quality' ? '已登记为独立质检请求，不改正文。' : '本次提交即人工显式派发；没有后台自动开工。'}`, stage: `instruction-${decision.family}`, family: decision.family, refId }));
    if (decision.family === 'production') await forwardProduction(text);
    else toast('质检请求已登记；不会冒充生产指令改稿');
    return true;
  }

  function cleanInstruction(value) { return String(value || '').trim(); }

  async function writeFinalLedger(target, action) {
    const statePath = `${ctl.folder}/终审状态.json`;
    let state = { version: 1, decisions: [] };
    try { state = JSON.parse(await readOptional(statePath)) || state; } catch {}
    if (!Array.isArray(state.decisions)) state.decisions = [];
    state.decisions = state.decisions.filter(row => row.cardId !== target.id);
    state.decisions.push({ cardId: target.id, taskId: ctl.task?.id || '', unitNo: target.card?.unitNo || target.unitNo || 0, action, targetPath: target.card?.targetPath || '', at: new Date().toISOString() });
    state.updatedAt = new Date().toISOString();
    await window.mazz.invoke('fs:writeFile', { path: statePath, content: JSON.stringify(state, null, 2) });
  }

  async function performCardAction(eventId, action) {
    const target = ctl.events.find(e => e.id === eventId);
    if (!target?.card || ctl.events.some(e => e.refId === eventId && ['instruction-choice', 'lock-decision', 'bible-conflict-decision', 'final-human', 'budget-decision', 'help-decision'].includes(e.stage))) return false;
    const [kind, value] = String(action || '').split(':');
    if (kind === 'clarify') {
      if (!(target.card.options || []).some(option => option.id === value)) return false;
      await appendEvents(normalizeFactoryEvent({ type: 'verdict', title: `澄清为${FACTORY_COMMAND_LABELS[value] || value}`, content: `人工将「${target.card.original}」明确归入 **${FACTORY_COMMAND_LABELS[value] || value}**。`, stage: 'instruction-choice', family: value, refId: target.id, tone: 'verdict' }));
      return processInstruction(target.card.original, { forcedFamily: value, refId: target.id });
    }
    if (kind === 'diff') {
      if (!['confirm', 'reject'].includes(value) || normPath(target.card.targetPath).toLocaleLowerCase() !== `${ctl.folder}/圣经.md`.toLocaleLowerCase()) return false;
      if (value === 'confirm') {
        const currentText = await readOptional(target.card.targetPath);
        if (currentText.trimEnd() !== String(target.card.before || '').trimEnd()) {
          const reconciliation = reconcileLockedBible({ base: target.card.before, human: currentText, aiProposal: target.card.after });
          const card = makeBibleConflictCard({ targetPath: target.card.targetPath, base: target.card.before, human: currentText, aiProposal: target.card.after, instruction: target.card.instruction });
          await appendEvents([
            normalizeFactoryEvent({ type: 'verdict', title: '旧差异已过期', content: '确认期间设定集另有更新，旧提案未写入。', stage: 'lock-decision', family: 'legislation', refId: target.id, tone: 'verdict' }),
            normalizeFactoryEvent({ type: 'help', title: '设定集人机双写冲突 · 等待裁决', content: `检测到人工版本与 AI 提案都偏离共同基线；系统没有覆盖任何一方。\n\n### 人工修改\n\n\`\`\`diff\n${reconciliation.humanDiff}\n\`\`\`\n\n### AI 提案\n\n\`\`\`diff\n${reconciliation.aiDiff}\n\`\`\``, stage: 'bible-conflict', family: 'legislation', tone: 'disagreement', card }),
          ]);
          return false;
        }
        await window.mazz.invoke('fs:writeFile', { path: target.card.targetPath, content: target.card.after });
      }
      await appendEvents(normalizeFactoryEvent({ type: 'verdict', title: value === 'confirm' ? '锁定变更已写入设定集' : '锁定变更已拒绝', content: value === 'confirm' ? `设定集已按确认差异写入：${target.card.instruction}` : `设定集保持原样：${target.card.instruction}`, stage: 'lock-decision', family: 'legislation', refId: target.id, tone: 'verdict' }));
      return true;
    }
    if (kind === 'conflict') {
      if (!['human', 'ai'].includes(value) || target.card.kind !== 'bible-conflict') return false;
      const currentText = await readOptional(target.card.targetPath);
      if (currentText !== target.card.human) {
        toast('设定集在冲突卡生成后再次变化；请刷新并重新发起裁决');
        return false;
      }
      if (value === 'ai') await window.mazz.invoke('fs:writeFile', { path: target.card.targetPath, content: target.card.aiProposal });
      await appendEvents(normalizeFactoryEvent({
        type: 'verdict', title: value === 'human' ? '设定集冲突 · 保留人工版本' : '设定集冲突 · 人工批准 AI 提案',
        content: value === 'human' ? '人工版本保持不变；AI 提案未写入。' : '由 human Authority 明确批准后写入 AI 提案；不是自动覆盖。',
        stage: 'bible-conflict-decision', family: 'legislation', refId: target.id, tone: 'verdict',
      }));
      return true;
    }
    if (kind === 'final') {
      if (!['seal', 'return', 'hold'].includes(value)) return false;
      if (![target.card.targetPath, target.card.draftPath, target.card.artifactDir].filter(Boolean).every(withinProject)) return false;
      if (value === 'seal') {
        const draft = await readOptional(target.card.draftPath);
        if (!target.card.targetPath || !draft) { toast('终审入库失败：正文工件缺失'); return false; }
        await window.mazz.invoke('fs:writeFile', { path: target.card.targetPath, content: `${target.card.targetPrefix || ''}${draft}` });
        updateTask({ finalDecision: 'sealed', finalDecisionAt: Date.now(), reviewState: { ...(ctl.task?.reviewState || {}), finalStatus: 'sealed' } });
      } else if (value === 'return') {
        const path = `${target.card.artifactDir || ctl.folder}/11-人工终审.md`;
        await window.mazz.invoke('fs:writeFile', { path, content: `# 人工终审\n\n- 决定：打回\n- 时间：${new Date().toISOString()}\n- 对应卡：${target.id}\n` });
        updateTask({ finalDecision: 'returned', finalDecisionAt: Date.now(), status: 'paused', reviewState: { ...(ctl.task?.reviewState || {}), finalStatus: 'returned' } });
      } else updateTask({ finalDecision: 'held', finalDecisionAt: Date.now(), reviewState: { ...(ctl.task?.reviewState || {}), finalStatus: 'held' } });
      await writeFinalLedger(target, value);
      const labels = { seal: '入库定本', return: '退回修订', hold: '暂缓' };
      await appendEvents(normalizeFactoryEvent({ type: 'verdict', title: `人工终审 · ${labels[value]}`, content: `@human 对「${target.title}」作出：**${labels[value]}**。`, unitNo: target.unitNo, unitName: target.unitName, stage: 'final-human', refId: target.id, tone: 'verdict' }));
      return true;
    }
    if (kind === 'budget') {
      if (!['degrade', 'stop'].includes(value)) return false;
      if (value === 'degrade') updateTask({ reviewRitual: 'light', reviewBudgetDecision: 'degrade' });
      else updateTask({ status: 'paused', reviewBudgetDecision: 'stop' });
      await appendEvents(normalizeFactoryEvent({ type: 'verdict', title: value === 'degrade' ? '预算上限 · 降级继续' : '预算上限 · 暂停', content: value === 'degrade' ? '改用标准流程，保留外部反向核查；不绕过交叉审校。' : '创作已暂停；待补预算或人工改令。', stage: 'budget-decision', refId: target.id, tone: 'verdict' }));
      return true;
    }
    if (kind === 'help') {
      if (!['approve', 'return', 'evidence'].includes(value)) return false;
      const labels = { approve: '批准升级', return: '退回修订', evidence: '要求补证' };
      await appendEvents(normalizeFactoryEvent({ type: 'verdict', title: `人工升级 · ${labels[value]}`, content: `@human 对「${target.title}」作出：**${labels[value]}**。`, unitNo: target.unitNo, unitName: target.unitName, stage: 'help-decision', refId: target.id, tone: 'verdict' }));
      return true;
    }
    return false;
  }

  async function openBudgetCard() {
    if (!ctl.folder) return;
    const latest = (ctl.costs.units || []).at(-1) || {};
    const budget = evaluateBudgetCap({ capTokens: latest.budget?.capTokens || ctl.task?.reviewBudgetCap || 32000, usedTokens: latest.budget?.usedTokens || 0, requestedRitual: ctl.task?.reviewRitual || latest.ritual?.requested || 'light' });
    if (budget.status === 'ok') { toast(`预算正常：余 ${budget.remainingTokens.toLocaleString()} token`); return; }
    const card = makeBudgetCard({ ...budget, requestedRitual: ctl.task?.reviewRitual || 'light' });
    await appendEvents(normalizeFactoryEvent({ id: `w68c-budget-manual-${ctl.task?.id || tinyHash(ctl.folder)}-${budget.capTokens}-${budget.usedTokens}`, type: 'help', title: `${budget.label} · 请选择`, content: `- 上限：${budget.capTokens.toLocaleString()} token\n- 已用：${budget.usedTokens.toLocaleString()} token\n- 余额：${budget.remainingTokens.toLocaleString()} token\n\n${productText(budget.reason)}`, stage: 'budget-pending', card }));
  }

  async function submitInstruction() {
    const input = root.querySelector('.fd-instruction textarea'); const text = input.value.trim();
    if (!text || !ctl.folder) return;
    input.value = '';
    await processInstruction(text);
  }

  let scrollTick = 0;
  stream.addEventListener('scroll', () => { if (scrollTick) return; scrollTick = requestAnimationFrame(() => { scrollTick = 0; renderVirtual(); }); });
  taskSelect.addEventListener('change', () => loadProject({ taskId: taskSelect.value }));
  root.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  root.querySelector('[data-a=refresh]').addEventListener('click', () => loadProject({ taskId: ctl.task?.id, folder: ctl.folder }));
  root.querySelector('[data-a=economics]').addEventListener('click', openEconomicsDialog);
  root.querySelector('[data-a=mobile]').addEventListener('click', createMobileApprovalPackage);
  root.querySelector('[data-a=close-compare]').addEventListener('click', () => root.classList.toggle('compare-closed'));
  root.querySelector('[data-a=budget]').addEventListener('click', openBudgetCard);
  root.querySelector('[data-a=health]').addEventListener('click', () => { const board = root.querySelector('.fd-health'); board.hidden = !board.hidden; });
  root.querySelector('[data-a=health-close]').addEventListener('click', () => { root.querySelector('.fd-health').hidden = true; });
  root.querySelectorAll('[data-pin]').forEach(btn => btn.addEventListener('click', () => openCompare(`${ctl.folder}/${btn.dataset.pin === 'bible' ? '圣经.md' : '判例库.md'}`)));
  const search = root.querySelector('.fd-search input');
  search.addEventListener('input', () => {
    ctl.query = search.value.trim(); const matches = findFactoryMatches(filterFactoryEvents(ctl.events, ctl.view), ctl.query);
    root.querySelector('.fd-search span').textContent = ctl.query ? `${matches.length}` : '';
    if (matches.length) { ctl.memory[matches[0].eventId] = false; saveMemory(); rebuildItems(matches[0].eventId); }
    else rebuildItems();
  });
  const form = root.querySelector('.fd-instruction');
  form.addEventListener('submit', e => { e.preventDefault(); submitInstruction(); });
  form.querySelector('textarea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitInstruction(); } });
  root.addEventListener('focusin', e => { if (current !== ctl && root.contains(e.target)) { current = ctl; contextKeys.set('module', MODULE); } });
  const scheduleReload = () => {
    clearTimeout(ctl.reloadTimer);
    ctl.reloadTimer = setTimeout(() => { ctl.reloadTimer = 0; loadProject({ taskId: ctl.task?.id, folder: ctl.folder }); }, 180);
  };
  ctl.liveListener = event => {
    const detail = event.detail || {};
    if (Date.now() < ctl.suppressReloadUntil) return;
    if (detail.taskId === ctl.task?.id || normPath(detail.folder) === ctl.folder) scheduleReload();
  };
  window.addEventListener('mazz:factory-workshop', ctl.liveListener);
  ctl.stopFileChanged = window.mazz?.on?.('file:changed', ({ path = '' } = {}) => {
    if (Date.now() < ctl.suppressReloadUntil) return;
    const target = normPath(path);
    if ([FACTORY_ARCHIVE_FILE, '圣经.md', '判例库.md', '成本台账.json', '终审状态.json'].some(name => target.toLowerCase() === `${ctl.folder}/${name}`.toLowerCase())) scheduleReload();
  });
  ctl.resizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect?.width || root.clientWidth;
    root.classList.toggle('narrow', width < 820);
  });
  ctl.resizeObserver.observe(root);
  ctl.loadProject = loadProject; ctl.appendEvents = appendEvents; ctl.openCompare = openCompare; ctl.setView = setView; ctl.processInstruction = processInstruction; ctl.performCardAction = performCardAction;
  ctl.dispose = () => { ctl.disposed = true; clearTimeout(ctl.reloadTimer); ctl.stopFileChanged?.(); ctl.resizeObserver?.disconnect(); window.removeEventListener('mazz:factory-workshop', ctl.liveListener); if (scrollTick) cancelAnimationFrame(scrollTick); };
  setView(ctl.view); populateTasks();
  ctl.startTimer = setTimeout(() => { ctl.startTimer = 0; loadProject({ taskId: taskSelect.value }); }, 0);
  return ctl;
}

export default {
  displayName: '智能创作台', icon: '🏭', readOnly: true, _forTests: { instances },
  create(container) { const ctl = createDesk(container); instances.set(container, ctl); return { container }; },
  activate(container) { const ctl = instances.get(container); if (!ctl) return; current = ctl; contextKeys.set('module', MODULE); window.MazzShell?.sideDock?.showTab?.('factory'); },
  deactivate(container) { if (current === instances.get(container)) current = null; },
  dispose(state) { const ctl = instances.get(state.container); if (ctl?.startTimer) clearTimeout(ctl.startTimer); ctl?.dispose(); instances.delete(state.container); },
  getContent(state) { const ctl = instances.get(state.container); return JSON.stringify({ mark: 'mazz-factorydesk-v1', taskId: ctl?.task?.id || '', folder: ctl?.folder || '', view: ctl?.view || 'workshop' }); },
  setContent(data, state) { const ctl = instances.get(state.container); if (!ctl || !data) return; if (ctl.startTimer) { clearTimeout(ctl.startTimer); ctl.startTimer = 0; } try { const obj = typeof data === 'string' ? JSON.parse(data) : data; if (obj?.view) ctl.setView(obj.view); ctl.loadProject({ taskId: obj?.taskId, folder: obj?.folder }); } catch {} },
  newDocument(state) { instances.get(state.container)?.loadProject({}); },
  getCharCount(state) { return instances.get(state.container)?.events.reduce((n, e) => n + e.content.length, 0) || 0; },
  getCursorPos() { return '创作流'; },
  toolbarHTML: `<div class="rb-group" data-label="创作流"><button class="rb-btn" data-command="factorydesk.refresh"><i class="ico">↻</i><span>重载档案</span></button><button class="rb-btn" data-command="factory.toggleDock"><i class="ico">🔥</i><span>指令台</span></button></div><div class="rb-group" data-label="视图"><button class="rb-btn" data-command="factorydesk.body"><i class="ico">¶</i><span>只看正文</span></button><button class="rb-btn" data-command="factorydesk.workshop"><i class="ico">🏭</i><span>创作流全景</span></button><button class="rb-btn" data-command="factorydesk.summary"><i class="ico">≡</i><span>摘要折叠</span></button></div>`,
  bindToolbar(panel) { panel.querySelectorAll('[data-command]').forEach(btn => btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command))); },
  contributes: {
    commands: [
      { id: 'factory.openDesk', title: '打开智能创作台', icon: '🏭', group: '智能创作', run: ({ taskId = '', folder = '', title = '' } = {}) => window.MazzHost?.openTab('factorydesk', { title: title || '智能创作台', content: JSON.stringify({ mark: 'mazz-factorydesk-v1', taskId, folder, view: 'workshop' }) }) },
      { id: 'factorydesk.refresh', title: '重载智能创作台', group: '智能创作', when: "module=='factorydesk'", run: () => current?.loadProject({ taskId: current.task?.id, folder: current.folder }) },
      { id: 'factorydesk.body', title: '智能创作台：只看正文', group: '智能创作', when: "module=='factorydesk'", run: () => current?.setView('body') },
      { id: 'factorydesk.workshop', title: '智能创作台：创作流全景', group: '智能创作', when: "module=='factorydesk'", run: () => current?.setView('workshop') },
      { id: 'factorydesk.summary', title: '智能创作台：摘要折叠', group: '智能创作', when: "module=='factorydesk'", run: () => current?.setView('summary') },
    ],
    keybindings: [{ command: 'factorydesk.refresh', key: 'ctrl+r', when: "module=='factorydesk'" }], menus: {}, bridges: [], aiActions: [],
  },
};
