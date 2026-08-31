// renderer/modules/search/index.js —— 全局搜索：IndexedDB 全文索引 + 正则/类型过滤 + 结果直达
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { toast } from '../../shell/shell.js';
import { SearchIndex, listTextFiles, highlightLine } from './indexer.js';
import { finishWebResearch, prepareWebResearch } from './research-runtime.js';

const MODULE = 'search';
const instances = new Map();
let current = null;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function createSearch(container) {
  const root = document.createElement('div');
  root.className = 'gs-root';
  root.innerHTML = `
    <div class="gs-bar">
      <input class="gs-input" placeholder="全局搜索笔记与文件内容…（Enter 搜索）" spellcheck="false" />
      <label class="gs-opt"><input type="checkbox" class="gs-regex" /> 正则</label>
      <label class="gs-opt"><input type="checkbox" class="gs-case" /> 区分大小写</label>
      <select class="rb-select gs-type">
        <option value="all">全部类型</option>
        <option value="doc">文档 (.md/.txt)</option>
        <option value="sheet">表格 (.csv/.mazzsheet)</option>
        <option value="mindmap">导图 (.mindmap)</option>
        <option value="slide">演示 (.mazzslide)</option>
        <option value="draw">画板 (.mazzdraw)</option>
        <option value="code">代码</option>
      </select>
      <select class="rb-select gs-scope" title="搜索范围">
        <option value="both">文件名+内容</option><option value="name">仅文件名</option><option value="content">仅内容</option>
      </select>
      <button class="rb-btn" data-a="replace-mode" title="查找替换">${iconHtml('⇄')}<span>替换</span></button>
      <button class="rb-btn" data-a="rebuild" title="重建全文索引">${iconHtml('↻')}<span>重建索引</span></button>
    </div>
    <div class="gs-bar gs-replace-bar" style="display:none">
      <input class="gs-replace-input" placeholder="替换为…（留空 = 删除匹配）" spellcheck="false" />
      <select class="rb-select gs-range" title="替换范围">
        <option value="ws">全部（整个工作区）</option><option value="folder">指定文件夹…</option><option value="file">仅当前文件</option>
      </select>
      <button class="rb-btn" data-a="replace-preview" title="预览全部命中后再决定">预览替换</button>
      <button class="rb-btn" data-a="replace-seq" title="一处一处依次替换（可逐个跳过）">逐个替换</button>
      <button class="rb-btn" data-a="replace-all" title="确认后一键全部写回" style="color:var(--danger)">全部替换</button>
      <button class="rb-btn" data-a="replace-toggle" title="收起替换">收起</button>
    </div>
    <details class="gs-research">
      <summary>证据研究 · 七步检索</summary>
      <div class="gs-research-bar">
        <input class="gs-research-topic" placeholder="输入研究主题，先取材再人工核准来源" spellcheck="false" />
        <button class="rb-btn" data-a="research-prepare">生成来源清单</button>
        <button class="rb-btn" data-a="research-finish" disabled>核准并合成</button>
      </div>
      <div class="gs-research-stage">尚未取材。网页内容只当资料，不当指令。</div>
      <div class="gs-research-sources"></div>
    </details>
    <div class="gs-meta">索引准备中…</div>
    <div class="gs-results"><div class="gs-empty">输入关键词开始全局搜索</div></div>`;
  container.appendChild(root);

  const inputEl = root.querySelector('.gs-input');
  const regexEl = root.querySelector('.gs-regex');
  const caseEl = root.querySelector('.gs-case');
  const typeEl = root.querySelector('.gs-type');
  const scopeEl = root.querySelector('.gs-scope');
  const metaEl = root.querySelector('.gs-meta');
  const resultsEl = root.querySelector('.gs-results');
  const researchTopicEl = root.querySelector('.gs-research-topic');
  const researchStageEl = root.querySelector('.gs-research-stage');
  const researchSourcesEl = root.querySelector('.gs-research-sources');
  const researchPrepareEl = root.querySelector('[data-a=research-prepare]');
  const researchFinishEl = root.querySelector('[data-a=research-finish]');
  // B12b 收编：类型/范围两 select 子窗格化（隐藏保留作状态单源——取值读 .value 的旧路径零改动）
  import('../../lib/select-menu.js').then(({ selectProxy }) => { selectProxy(typeEl); selectProxy(scopeEl); });

  const ctl = {
    root, container,
    index: new SearchIndex(),
    lastQuery: '',
    fileCount: 0,
    researchPrepared: null,
    researchResultPath: '',
  };

  const showResearchPrepared = prepared => {
    ctl.researchPrepared = prepared;
    ctl.researchResultPath = '';
    researchFinishEl.textContent = '核准并合成';
    researchSourcesEl.innerHTML = prepared.sources.map(source => `
      <label class="gs-research-source">
        <input type="checkbox" data-source-id="${escapeHtml(source.id)}" checked />
        <span><b>${escapeHtml(source.title)}</b><small>${escapeHtml(source.domain || source.url)}</small></span>
      </label>`).join('');
    researchStageEl.textContent = `来源清单：${prepared.sources.length} 项；请人工取消不可信来源，再核准合成。`;
    researchFinishEl.disabled = false;
  };

  const stageText = row => { researchStageEl.textContent = `${row.label || row.stage}…`; };
  researchPrepareEl.addEventListener('click', async () => {
    const topic = researchTopicEl.value.trim();
    if (!topic) { toast('请先输入研究主题'); researchTopicEl.focus(); return; }
    researchPrepareEl.disabled = true;
    researchFinishEl.disabled = true;
    ctl.researchResultPath = '';
    researchFinishEl.textContent = '核准并合成';
    researchSourcesEl.innerHTML = '';
    try {
      showResearchPrepared(await prepareWebResearch(topic, { onStage: stageText }));
    } catch (error) {
      researchStageEl.textContent = `取材失败：${error.message || error}`;
      toast(researchStageEl.textContent);
    } finally { researchPrepareEl.disabled = false; }
  });

  researchFinishEl.addEventListener('click', async () => {
    if (!ctl.researchPrepared) return;
    const selectedIds = [...researchSourcesEl.querySelectorAll('[data-source-id]:checked')].map(el => el.dataset.sourceId);
    if (!selectedIds.length) { toast('至少核准一个来源'); return; }
    researchFinishEl.disabled = true;
    try {
      const done = await finishWebResearch(ctl.researchPrepared, { selectedIds, onStage: stageText });
      await ctl.index.updateFile(done.path);
      ctl.fileCount = ctl.index.mem.size;
      ctl.researchResultPath = done.path;
      researchFinishEl.textContent = '已合成入库';
      researchSourcesEl.querySelectorAll('[data-source-id]').forEach(el => { el.disabled = true; });
      researchStageEl.textContent = `报告已保存并登记全文索引：${done.path}`;
      toast('研究报告已保存并入索引');
    } catch (error) {
      researchStageEl.textContent = `合成失败：${error.message || error}`;
      toast(researchStageEl.textContent);
    } finally { researchFinishEl.disabled = !!ctl.researchResultPath; }
  });

  const onResearchSaved = async event => {
    const path = event.detail?.path;
    if (!path) return;
    await ctl.index.updateFile(path);
    ctl.fileCount = ctl.index.mem.size;
  };
  window.addEventListener('mazz:research-saved', onResearchSaved);
  ctl.showResearchPrepared = showResearchPrepared;
  ctl.dispose = () => window.removeEventListener('mazz:research-saved', onResearchSaved);

  async function rebuildIndex(force = false) {
    metaEl.textContent = '正在扫描工作区…';
    try {
      const files = await listTextFiles();
      const n = await ctl.index.reconcile(files, { force });
      ctl.fileCount = n;
      metaEl.textContent = `索引就绪：${n} 个文件${force ? '（已全量重建）' : ''}`;
    } catch (e) {
      metaEl.textContent = '索引构建失败：' + (e.message || e);
    }
  }

  function opts() {
    return { regex: regexEl.checked, caseSensitive: caseEl.checked, type: typeEl.value, scope: scopeEl.value };
  }

  function runQuery() {
    const q = inputEl.value.trim();
    ctl.lastQuery = q;
    if (!q) {
      resultsEl.innerHTML = '<div class="gs-empty">输入关键词开始全局搜索</div>';
      metaEl.textContent = ctl.fileCount ? `索引就绪：${ctl.fileCount} 个文件` : metaEl.textContent;
      return;
    }
    const o = opts();
    const { results, total, error } = ctl.index.query(q, o);
    if (error) {
      resultsEl.innerHTML = `<div class="gs-empty">${error}</div>`;
      return;
    }
    metaEl.textContent = `“${q}”：${results.length} 个文件 · ${total} 处命中`;
    if (!results.length) {
      resultsEl.innerHTML = '<div class="gs-empty">没有匹配结果</div>';
      return;
    }
    resultsEl.innerHTML = results.map(r => `
      <div class="gs-file">
        <div class="gs-file-head" data-path="${r.path.replace(/"/g, '&quot;')}">
          <span class="gs-file-name">${r.name}</span>
          <span class="gs-file-path">${r.path}</span>
        </div>
        ${r.hits.map(h => `
          <div class="gs-hit" data-path="${r.path.replace(/"/g, '&quot;')}" data-ln="${h.ln || 0}">
            <span class="gs-ln">${h.ln || '名'}</span><span class="gs-hit-t">${highlightLine(h.text, q, o)}</span>
            <button class="gs-peek" data-peek="${r.path.replace(/"/g, '&quot;')}" title="小窗预览并直接编辑" aria-label="小窗预览并直接编辑">${iconHtml('✎')}</button>
          </div>`).join('')}
      </div>`).join('');
    resultsEl.querySelectorAll('.gs-hit[data-path]').forEach(el =>
      el.addEventListener('click', () => openHit(el.dataset.path, +el.dataset.ln || 0)));
    resultsEl.querySelectorAll('.gs-file-head[data-path]').forEach(el =>
      el.addEventListener('click', () => openHit(el.dataset.path, 0)));
  }

  /** 打开命中文件并直达匹配位置（纯文本按行跳；文档预填查找词） */
  async function openHit(path, ln = 0) {
    try { await window.MazzCommands.execute('file.openPath', { path }); }
    catch { toast('打开失败：' + path); return; }
    if (ln > 0 && /\.txt$/i.test(path)) {
      setTimeout(() => window.__activeTextCtl?.jumpToLine?.(ln), 400);
      return;
    }
    const q = ctl.lastQuery;
    if (!q || regexEl.checked) return; // 正则模式不预填（查找条是普通搜索）
    setTimeout(() => {
      try { window.MazzCommands.execute('edit.find'); } catch {}
      setTimeout(() => {
        const input = document.querySelector('.f-find-input');
        if (input) {
          input.value = q;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 120);
    }, 350);
  }

  // 命中行小窗预览：显示上下文，可直接编辑保存并实时回写
  async function peekEdit(path) {
    let text = '';
    try { text = await window.mazz.invoke('fs:readFile', { path }); }
    catch (e) { toast('读取失败：' + e.message); return; }
    const { modal } = await import('../../shell/shell.js');
    const name = path.split(/[\\/]/).pop();
    const m = modal(`预览编辑：${name}`);
    m.el.classList.add('gs-peek-modal');
    m.body.innerHTML = `
      <div style="min-width:min(680px,86vw)">
        <div style="font-size:11.5px;color:var(--fg-dim);margin-bottom:6px">${path}</div>
        <textarea class="gs-peek-text rb-input" rows="14" spellcheck="false"></textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span style="font-size:11.5px;color:var(--fg-dim)">保存立即写回源文件并刷新索引</span>
          <div style="display:flex;gap:8px">
            <button class="rb-btn" id="peek-open" style="flex-direction:row">在编辑器中打开</button>
            <button class="rb-btn" id="peek-save" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存</button>
          </div>
        </div>
      </div>`;
    const ta = m.body.querySelector('.gs-peek-text');
    ta.value = text;
    // 定位到首个命中行
    const q = ctl.lastQuery;
    if (q) {
      const idx = text.indexOf(q);
      if (idx >= 0) { ta.focus(); ta.setSelectionRange(idx, idx + q.length); }
    }
    m.body.querySelector('#peek-save').addEventListener('click', async () => {
      try {
        await window.mazz.invoke('fs:writeFile', { path, content: ta.value });
        toast('已保存并写回源文件');
        // 打开中的标签同步重载（脏标签不覆盖）
        const openTab = window.MazzShell?.tabs?.tabs?.find?.(t => t.filePath === path);
        if (openTab) window.MazzShell.reloadTabFromDisk?.(openTab).catch(() => {});
        await rebuildIndex(true);
        runQuery();
        m.close();
      } catch (e) { toast('保存失败：' + e.message); }
    });
    m.body.querySelector('#peek-open').addEventListener('click', () => {
      m.close();
      openHit(path);
    });
  }
  resultsEl.addEventListener('click', (e) => {
    const peek = e.target.closest('.gs-peek');
    if (peek) { e.stopPropagation(); peekEdit(peek.dataset.peek); }
  });

  // 事件：输入防抖 + Enter 立即
  let debounce = null;
  inputEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(runQuery, 300);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(debounce); runQuery(); }
    e.stopPropagation();
  });
  [regexEl, caseEl, typeEl].forEach(el => el.addEventListener('change', runQuery));
  // —— 查找替换（v42 波次二） ——
  const replaceBar = root.querySelector('.gs-replace-bar');
  const rangeEl = root.querySelector('.gs-range');
  const replaceInputEl = root.querySelector('.gs-replace-input');
  root.querySelector('[data-a=replace-mode]').addEventListener('click', () => {
    const open = replaceBar.style.display !== 'none';
    replaceBar.style.display = open ? 'none' : '';
    if (!open) replaceInputEl.focus();
  });
  root.querySelector('[data-a=replace-toggle]').addEventListener('click', () => { replaceBar.style.display = 'none'; });

  async function rangePaths() {
    const r = rangeEl.value;
    if (r === 'ws') return null;
    if (r === 'file') {
      const tab = window.MazzShell?.tabs?.active;
      if (!tab?.filePath) { toast('当前标签没有已保存的文件'); return []; }
      return [tab.filePath];
    }
    // 指定文件夹
    const { listDirRec } = await import('./replace.js').catch(() => ({}));
    const ws = await ctl.getWorkspace?.() || await window.mazz.invoke('workspace:get');
    const sub = await import('../../shell/shell.js').then(async ({ inputModal }) =>
      inputModal('限定到哪个文件夹？（工作区相对路径，留空=根）', ''));
    if (sub == null) return false; // 取消
    const p = sub.trim() ? (ws + '/' + sub.trim().replace(/^\/+|\/+$/g, '')) : ws;
    return [p];
  }

  root.querySelector('[data-a=replace-preview]').addEventListener('click', async () => {
    const q = inputEl.value.trim();
    if (!q) { toast('先输入搜索词'); return; }
    const paths = await rangePaths();
    if (paths === false) return;
    const { collectHits, previewReplace, applyReplace } = await import('./replace.js');
    const groups = collectHits(ctl.index, q, { ...opts(), scope: opts().scope === 'both' ? 'content' : opts().scope, rangePaths: paths });
    if (!groups.length) { toast('没有命中'); return; }
    previewReplace(groups, {
      onConfirm: async (keep) => {
        const r = await applyReplace(ctl.index, keep, q, replaceInputEl.value, { ...opts(), shell: window.MazzShell });
        toast(`替换完成：${r.files} 个文件 ${r.count} 处${r.skipped.length ? '；跳过 ' + r.skipped.join('、') : ''}`);
        await rebuildIndex(true);
        runQuery();
      },
    });
  });
  // 全部替换：真直连（确认对话框报数后即写回，预览按钮留给想逐项排除的人）
  const doReplaceAll = async () => {
    const q = inputEl.value.trim();
    if (!q) { toast('先输入搜索词'); return; }
    const paths = await rangePaths();
    if (paths === false) return;
    const { collectHits, applyReplace } = await import('./replace.js');
    const groups = collectHits(ctl.index, q, { ...opts(), scope: opts().scope === 'both' ? 'content' : opts().scope, rangePaths: paths });
    const total = groups.reduce((a, g) => a + g.hits.filter(h => h.ln > 0).length, 0);
    if (!total) { toast('没有命中'); return; }
    const ok = await window.mazz.invoke('dialog:confirm', {
      title: '全部替换', message: `将「${q}」全部替换为「${replaceInputEl.value}」？\n${groups.length} 个文件 · ${total} 处命中`, buttons: ['全部替换', '取消'],
    }).catch(() => 1);
    if (ok !== 0) return;
    const r = await applyReplace(ctl.index, groups, q, replaceInputEl.value, { ...opts(), shell: window.MazzShell });
    toast(`替换完成：${r.files} 个文件 ${r.count} 处${r.skipped.length ? '；跳过 ' + r.skipped.join('、') : ''}`);
    await rebuildIndex(true);
    runQuery();
  };
  root.querySelector('[data-a=replace-all]').addEventListener('click', doReplaceAll);
  root.querySelector('[data-a=replace-seq]').addEventListener('click', async () => {
    const q = inputEl.value.trim();
    if (!q) { toast('先输入搜索词'); return; }
    const paths = await rangePaths();
    if (paths === false) return;
    const { collectHits, replaceSequential } = await import('./replace.js');
    const groups = collectHits(ctl.index, q, { ...opts(), scope: opts().scope === 'both' ? 'content' : opts().scope, rangePaths: paths });
    if (!groups.length) { toast('没有命中'); return; }
    replaceSequential(ctl.index, groups, q, replaceInputEl.value, {
      ...opts(), shell: window.MazzShell,
      onDone: async (n, skipped) => {
        toast(`逐个替换结束：已替换 ${n} 处${skipped?.length ? '；跳过 ' + skipped.join('、') : ''}`);
        await rebuildIndex(true);
        runQuery();
      },
    });
  });

  root.querySelector('[data-a=rebuild]').addEventListener('click', async () => {
    await rebuildIndex(true);
    runQuery();
    toast('全文索引已重建');
  });
  root.addEventListener('focusin', (e) => {
    if (current !== ctl && root.contains(e.target)) { current = ctl; contextKeys.set('module', MODULE); }
  });

  ctl.runQuery = runQuery;
  ctl.rebuildIndex = rebuildIndex;
  ctl.openHit = openHit;
  ctl.focusResearch = () => {
    root.querySelector('.gs-research').open = true;
    researchTopicEl.focus();
  };

  // 启动即后台建索引
  rebuildIndex();
  setTimeout(() => inputEl.focus(), 50);

  return ctl;
}

export default {
  displayName: '全局搜索',
  icon: '🔎',
  _forTests: { instances },

  create(container) {
    const ctl = createSearch(container);
    instances.set(container, ctl);
    return ctl;
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    contextKeys.set('module', MODULE);
    ctl.root.querySelector('.gs-input')?.focus();
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  dispose(state) {
    const container = state?.container || state;
    const ctl = instances.get(container);
    ctl?.dispose?.();
    instances.delete(container);
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return JSON.stringify({ mark: 'mazz-search-v1', q: ctl?.lastQuery || '' });
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj?.q) {
        ctl.root.querySelector('.gs-input').value = obj.q;
        ctl.runQuery();
      }
    } catch {}
  },
  newDocument() {},
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl?.lastQuery?.length || 0;
  },
  getCursorPos() { return '搜索'; },

  toolbarHTML: `
    <div class="rb-group" data-label="搜索">
      <button class="rb-btn" data-command="search.focus"><i class="ico">${iconHtml('🔎')}</i><span>聚焦搜索框</span></button>
      <button class="rb-btn" data-command="search.rebuild"><i class="ico">${iconHtml('↻')}</i><span>重建索引</span></button>
      <button class="rb-btn" data-command="search.research"><i class="ico">${iconHtml('⌁')}</i><span>证据研究</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'search.focus', title: '聚焦搜索框', group: '搜索', when: "module=='search'",
        run: () => current?.root.querySelector('.gs-input')?.focus() },
      { id: 'search.rebuild', title: '重建全文索引', group: '搜索',
        run: () => current?.rebuildIndex(true) },
      { id: 'search.research', title: '证据研究检索', group: '搜索',
        run: () => current?.focusResearch() },
    ],
    keybindings: [
      { command: 'search.focus', key: 'ctrl+shift+f', when: "module=='search'" },
    ],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
