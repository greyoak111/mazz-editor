// renderer/modules/factory/desk.js —— W68b Factory Desk：三栏活稿车间正式窗格模块
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { toast } from '../../shell/shell.js';
import {
  FACTORY_ARCHIVE_FILE, appendFactoryArchiveText, buildFactoryDebateThreads,
  buildFactoryVirtualItems, computeFactoryVirtualWindow, filterFactoryEvents,
  findFactoryMatches, normalizeFactoryEvent, parseFactoryArchive,
} from './workshop.js';

const MODULE = 'factorydesk';
const TASKS_KEY = 'mazz.factory.tasks';
const VIEW_KEY = 'mazz.factory.desk.view';
const instances = new Map();
let current = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pathName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const normPath = p => String(p || '').replace(/\\/g, '/').replace(/\/$/, '');
const typeLabel = Object.freeze({ body: '正文', skeleton: '骨架', review: '审理', verdict: '裁决', help: '请示', system: '系统' });

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
      <div class="fd-brand"><b>Factory Desk</b><span>活稿车间</span></div>
      <select class="fd-task-select" aria-label="选择工厂项目"></select>
      <div class="fd-views" role="tablist">
        <button data-view="body">只看正文</button><button data-view="workshop">车间全景</button><button data-view="summary">摘要折叠</button>
      </div>
      <label class="fd-search">⌕ <input placeholder="窗内搜索并展开…" spellcheck="false"><span></span></label>
      <button class="fd-icon" data-a="refresh" title="从工厂群档案重载">↻</button>
    </header>
    <section class="fd-pins">
      <button class="fd-pin" data-pin="bible"><i>圣经</i><b>等待载入</b><span>—</span></button>
      <button class="fd-pin" data-pin="precedent"><i>判例</i><b>等待载入</b><span>—</span></button>
      <div class="fd-stat"><i>成本</i><b data-stat="cost">0</b><span>token</span></div>
      <div class="fd-stat"><i>回稿率</i><b data-stat="return">0%</b><span>已裁决单元</span></div>
      <div class="fd-stat"><i>在途</i><b data-stat="flight">0</b><span>项目</span></div>
    </section>
    <main class="fd-grid">
      <aside class="fd-directory"><div class="fd-pane-head"><b>章节目录</b><span data-dir-count>0</span></div><div class="fd-dir-list"></div></aside>
      <section class="fd-center">
        <div class="fd-stream" tabindex="0"><div class="fd-vtop"></div><div class="fd-vitems"></div><div class="fd-vbottom"></div><div class="fd-empty">选择一个已有输出目录的工厂任务</div></div>
        <form class="fd-instruction"><textarea rows="2" placeholder="向车间交办；@human 请示会保留为卡片。Ctrl+Enter 发送" spellcheck="false"></textarea><button>交办</button></form>
      </section>
      <aside class="fd-compare"><div class="fd-pane-head"><b>工件对照</b><button data-a="close-compare">收起</button></div><div class="fd-files"></div><article class="fd-preview"><div class="fd-preview-empty">点目录或卡片工件，在此对照</div></article></aside>
    </main>`;
  container.appendChild(root);
  return root;
}

function createDesk(container) {
  const root = makeRoot(container);
  const ctl = {
    root, container, task: null, folder: '', events: [], view: localStorage.getItem(VIEW_KEY) || 'workshop',
    memory: {}, items: [], heights: {}, files: [], query: '', activeEventId: '', archiveHash: '', disposed: false,
    threads: [], threadMap: new Map(), startTimer: 0,
  };
  const stream = root.querySelector('.fd-stream');
  const itemHost = root.querySelector('.fd-vitems');
  const taskSelect = root.querySelector('.fd-task-select');

  const memoryKey = () => `mazz.factory.desk.collapse.${tinyHash(ctl.folder)}`;
  const loadMemory = () => { try { ctl.memory = JSON.parse(localStorage.getItem(memoryKey())) || {}; } catch { ctl.memory = {}; } };
  const saveMemory = () => localStorage.setItem(memoryKey(), JSON.stringify(ctl.memory));

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
    host.innerHTML = rows.length ? rows.map(unit => `<div class="fd-dir-unit"><button data-jump="${esc(unit.events[0].id)}"><b>${unit.no ? `第 ${unit.no} ${esc(unit.unitName)}` : '公共区'}</b><span>${unit.events.length} 件</span></button>${unit.events.map(e => `<button class="fd-dir-event type-${e.type}" data-jump="${esc(e.id)}"><i>${esc(typeLabel[e.type])}</i>${esc(e.title)}</button>`).join('')}</div>`).join('') : '<div class="fd-side-empty">群档暂无事件</div>';
    host.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => jumpToEvent(btn.dataset.jump, true)));
  }

  function cardHtml(item) {
    const e = item.event;
    const thread = ctl.threadMap.get(e.id);
    const threadBadge = thread ? `<button class="fd-thread" data-thread="${esc(thread.id)}" data-event="${esc(e.id)}" title="跳到本辩论线程下一件">↕ ${thread.index + 1}/${thread.total}</button>` : '';
    const continuation = item.chunkCount > 1 ? `<span class="fd-chunk">${item.chunkIndex + 1}/${item.chunkCount}</span>` : '';
    const progress = e.progress == null ? '' : `<div class="fd-progress"><i style="width:${e.progress}%"></i><span>${e.progress}%</span></div>`;
    if (item.collapsed) return `<article class="fd-card collapsed type-${e.type} tone-${e.tone || 'plain'}" data-event="${esc(e.id)}" data-item="${esc(item.id)}"><button class="fd-fold" title="就地展开">›</button><span class="fd-tag">${esc(typeLabel[e.type])}</span><b>${esc(e.title)}</b>${threadBadge}<time>${esc(String(e.createdAt).slice(0, 16).replace('T', ' '))}</time>${progress}</article>`;
    const actions = e.type === 'help' ? '<div class="fd-human"><button data-human="批准">批准</button><button data-human="驳回">驳回</button><button data-human="补证">要求补证</button></div>' : '';
    return `<article class="fd-card type-${e.type} tone-${e.tone || 'plain'}" data-event="${esc(e.id)}" data-item="${esc(item.id)}"><header><button class="fd-fold" title="折叠">⌄</button><span class="fd-tag">${esc(typeLabel[e.type])}</span><b>${esc(e.title)}</b>${continuation}${threadBadge}<time>${esc(String(e.createdAt).slice(0, 16).replace('T', ' '))}</time></header>${progress}<div class="fd-md">${renderMarkdown(item.content, ctl.query)}</div>${e.artifactPath ? `<button class="fd-artifact" data-path="${esc(e.artifactPath)}">工件 ↗ ${esc(pathName(e.artifactPath))}</button>` : ''}${actions}</article>`;
  }

  function bindCards() {
    itemHost.querySelectorAll('.fd-card').forEach(card => {
      card.querySelector('.fd-fold')?.addEventListener('click', () => {
        const id = card.dataset.event; ctl.memory[id] = !card.classList.contains('collapsed'); saveMemory(); rebuildItems(id);
      });
      card.querySelector('[data-path]')?.addEventListener('click', () => openCompare(card.querySelector('[data-path]').dataset.path));
      card.querySelector('[data-thread]')?.addEventListener('click', event => { event.stopPropagation(); jumpThread(event.currentTarget.dataset.thread, event.currentTarget.dataset.event); });
      card.querySelectorAll('[data-human]').forEach(btn => btn.addEventListener('click', () => appendHumanDecision(card.dataset.event, btn.dataset.human)));
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
    const setPin = (name, text) => {
      const btn = root.querySelector(`[data-pin=${name}]`); const old = btn.dataset.hash || '';
      const hash = tinyHash(text); btn.dataset.hash = hash;
      btn.querySelector('b').textContent = text ? `${text.length.toLocaleString()} 字` : '尚未建立';
      btn.querySelector('span').textContent = old && old !== hash ? '有更新' : (text ? `版本 ${hash.slice(0, 5)}` : '—');
      btn.classList.toggle('changed', !!old && old !== hash);
    };
    setPin('bible', bible); setPin('precedent', precedent);
    root.querySelector('[data-stat=cost]').textContent = Number(costs.totalTokens || 0).toLocaleString();
    const verdictUnits = new Set(ctl.events.filter(e => e.type === 'verdict').map(e => e.unitNo || e.id));
    const returnedUnits = new Set(ctl.events.filter(e => e.tone === 'disagreement' || (e.stage === 'repair' && !/(?:^|\n)\s*-\s*(?:无|本轮未执行)/.test(e.content))).map(e => e.unitNo || e.id));
    root.querySelector('[data-stat=return]').textContent = verdictUnits.size ? `${Math.min(100, Math.round(returnedUnits.size / verdictUnits.size * 100))}%` : '0%';
  }

  async function renderFiles() {
    ctl.files = await listFiles(ctl.folder);
    const host = root.querySelector('.fd-files');
    host.innerHTML = ctl.files.length ? ctl.files.map(row => `<button data-file="${esc(row.path)}" style="--depth:${row.level}"><span>${/\.json$/i.test(row.name) ? '{}' : '¶'}</span>${esc(row.name)}</button>`).join('') : '<div class="fd-side-empty">暂无可对照工件</div>';
    host.querySelectorAll('[data-file]').forEach(btn => btn.addEventListener('click', () => openCompare(btn.dataset.file)));
  }

  async function openCompare(path) {
    const text = await readOptional(path);
    const preview = root.querySelector('.fd-preview');
    preview.innerHTML = `<header><b>${esc(pathName(path))}</b><button data-open>在编辑器打开</button></header><div class="fd-md">${/\.json$/i.test(path) ? `<pre><code>${esc(text)}</code></pre>` : renderMarkdown(text)}</div>`;
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
    rebuildItems();
    if (ctl.events.length) jumpToEvent(ctl.events.at(-1).id, false);
    window.MazzHost?.setTabTitle(container, `${ctl.task?.label || '工厂'} · 活稿车间`);
  }

  async function appendEvents(events) {
    if (!ctl.folder) return false;
    const path = `${ctl.folder}/${FACTORY_ARCHIVE_FILE}`;
    const old = await readOptional(path);
    const next = appendFactoryArchiveText(old, events, { title: `${ctl.task?.label || 'Mazz'} · 工厂群` });
    if (next !== old) await window.mazz.invoke('fs:writeFile', { path, content: next });
    await loadProject({ taskId: ctl.task?.id, folder: ctl.folder });
    return true;
  }

  async function appendHumanDecision(eventId, decision) {
    const target = ctl.events.find(e => e.id === eventId);
    await appendEvents(normalizeFactoryEvent({ type: 'verdict', title: `人工席 · ${decision}`, content: `@human 对「${target?.title || eventId}」作出：**${decision}**。`, unitNo: target?.unitNo || 0, unitName: target?.unitName || '单元', stage: 'hearing', tone: 'verdict', threadId: target?.threadId || `human-${eventId}` }));
  }

  async function submitInstruction() {
    const input = root.querySelector('.fd-instruction textarea'); const text = input.value.trim();
    if (!text || !ctl.folder) return;
    input.value = '';
    await appendEvents(normalizeFactoryEvent({ type: text.includes('@human') ? 'help' : 'system', title: text.includes('@human') ? '人工请示' : '指令台交办', content: text, stage: text.includes('@human') ? 'consultation' : 'instruction' }));
    const panel = window.MazzShell?.sideDock?.factoryPanel;
    if (panel?.agentInputEl) { panel.agentInputEl.value = text; panel.submitAgent?.(); }
    else { window.MazzCommands.execute('factory.toggleDock').catch(() => {}); toast('指令已归档；智能创作坞已打开'); }
  }

  let scrollTick = 0;
  stream.addEventListener('scroll', () => { if (scrollTick) return; scrollTick = requestAnimationFrame(() => { scrollTick = 0; renderVirtual(); }); });
  taskSelect.addEventListener('change', () => loadProject({ taskId: taskSelect.value }));
  root.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  root.querySelector('[data-a=refresh]').addEventListener('click', () => loadProject({ taskId: ctl.task?.id, folder: ctl.folder }));
  root.querySelector('[data-a=close-compare]').addEventListener('click', () => root.classList.toggle('compare-closed'));
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
  ctl.liveListener = event => {
    const detail = event.detail || {};
    if (detail.taskId === ctl.task?.id || normPath(detail.folder) === ctl.folder) loadProject({ taskId: ctl.task?.id, folder: ctl.folder });
  };
  window.addEventListener('mazz:factory-workshop', ctl.liveListener);
  ctl.resizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect?.width || root.clientWidth;
    root.classList.toggle('narrow', width < 820);
  });
  ctl.resizeObserver.observe(root);
  ctl.loadProject = loadProject; ctl.appendEvents = appendEvents; ctl.openCompare = openCompare; ctl.setView = setView;
  ctl.dispose = () => { ctl.disposed = true; ctl.resizeObserver?.disconnect(); window.removeEventListener('mazz:factory-workshop', ctl.liveListener); if (scrollTick) cancelAnimationFrame(scrollTick); };
  setView(ctl.view); populateTasks();
  ctl.startTimer = setTimeout(() => { ctl.startTimer = 0; loadProject({ taskId: taskSelect.value }); }, 0);
  return ctl;
}

export default {
  displayName: '活稿车间', icon: '🏭', readOnly: true, _forTests: { instances },
  create(container) { const ctl = createDesk(container); instances.set(container, ctl); return { container }; },
  activate(container) { const ctl = instances.get(container); if (!ctl) return; current = ctl; contextKeys.set('module', MODULE); window.MazzShell?.sideDock?.showTab?.('factory'); },
  deactivate(container) { if (current === instances.get(container)) current = null; },
  dispose(state) { const ctl = instances.get(state.container); if (ctl?.startTimer) clearTimeout(ctl.startTimer); ctl?.dispose(); instances.delete(state.container); },
  getContent(state) { const ctl = instances.get(state.container); return JSON.stringify({ mark: 'mazz-factorydesk-v1', taskId: ctl?.task?.id || '', folder: ctl?.folder || '', view: ctl?.view || 'workshop' }); },
  setContent(data, state) { const ctl = instances.get(state.container); if (!ctl || !data) return; if (ctl.startTimer) { clearTimeout(ctl.startTimer); ctl.startTimer = 0; } try { const obj = typeof data === 'string' ? JSON.parse(data) : data; if (obj?.view) ctl.setView(obj.view); ctl.loadProject({ taskId: obj?.taskId, folder: obj?.folder }); } catch {} },
  newDocument(state) { instances.get(state.container)?.loadProject({}); },
  getCharCount(state) { return instances.get(state.container)?.events.reduce((n, e) => n + e.content.length, 0) || 0; },
  getCursorPos() { return '活稿流'; },
  toolbarHTML: `<div class="rb-group" data-label="车间"><button class="rb-btn" data-command="factorydesk.refresh"><i class="ico">↻</i><span>重载群档</span></button><button class="rb-btn" data-command="factory.toggleDock"><i class="ico">🔥</i><span>调度坞</span></button></div><div class="rb-group" data-label="视图"><button class="rb-btn" data-command="factorydesk.body"><i class="ico">¶</i><span>只看正文</span></button><button class="rb-btn" data-command="factorydesk.workshop"><i class="ico">🏭</i><span>车间全景</span></button><button class="rb-btn" data-command="factorydesk.summary"><i class="ico">≡</i><span>摘要折叠</span></button></div>`,
  bindToolbar(panel) { panel.querySelectorAll('[data-command]').forEach(btn => btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command))); },
  contributes: {
    commands: [
      { id: 'factory.openDesk', title: '打开 Factory Desk 活稿车间', icon: '🏭', group: '智能创作', run: ({ taskId = '', folder = '', title = '' } = {}) => window.MazzHost?.openTab('factorydesk', { title: title || 'Factory Desk · 活稿车间', content: JSON.stringify({ mark: 'mazz-factorydesk-v1', taskId, folder, view: 'workshop' }) }) },
      { id: 'factorydesk.refresh', title: '重载活稿车间', group: '智能创作', when: "module=='factorydesk'", run: () => current?.loadProject({ taskId: current.task?.id, folder: current.folder }) },
      { id: 'factorydesk.body', title: '活稿车间：只看正文', group: '智能创作', when: "module=='factorydesk'", run: () => current?.setView('body') },
      { id: 'factorydesk.workshop', title: '活稿车间：车间全景', group: '智能创作', when: "module=='factorydesk'", run: () => current?.setView('workshop') },
      { id: 'factorydesk.summary', title: '活稿车间：摘要折叠', group: '智能创作', when: "module=='factorydesk'", run: () => current?.setView('summary') },
    ],
    keybindings: [{ command: 'factorydesk.refresh', key: 'ctrl+r', when: "module=='factorydesk'" }], menus: {}, bridges: [], aiActions: [],
  },
};
