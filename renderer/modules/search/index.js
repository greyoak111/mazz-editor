// renderer/modules/search/index.js —— 全局搜索：IndexedDB 全文索引 + 正则/类型过滤 + 结果直达
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';
import { SearchIndex, listTextFiles, highlightLine } from './indexer.js';

const MODULE = 'search';
const instances = new Map();
let current = null;

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
        <option value="sheet">表格 (.csv)</option>
        <option value="code">代码</option>
      </select>
      <button class="rb-btn" data-a="rebuild" title="重建全文索引">↻ 重建索引</button>
    </div>
    <div class="gs-meta">索引准备中…</div>
    <div class="gs-results"><div class="gs-empty">输入关键词开始全局搜索</div></div>`;
  container.appendChild(root);

  const inputEl = root.querySelector('.gs-input');
  const regexEl = root.querySelector('.gs-regex');
  const caseEl = root.querySelector('.gs-case');
  const typeEl = root.querySelector('.gs-type');
  const metaEl = root.querySelector('.gs-meta');
  const resultsEl = root.querySelector('.gs-results');

  const ctl = {
    root, container,
    index: new SearchIndex(),
    lastQuery: '',
    fileCount: 0,
  };

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
    return { regex: regexEl.checked, caseSensitive: caseEl.checked, type: typeEl.value };
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
          <div class="gs-hit" data-path="${r.path.replace(/"/g, '&quot;')}">
            <span class="gs-ln">${h.ln}</span>${highlightLine(h.text, q, o)}
          </div>`).join('')}
      </div>`).join('');
    resultsEl.querySelectorAll('[data-path]').forEach(el =>
      el.addEventListener('click', () => openHit(el.dataset.path)));
  }

  /** 打开命中文件并尝试预填查找词直达匹配 */
  async function openHit(path) {
    try { await window.MazzCommands.execute('file.openPath', { path }); }
    catch { toast('打开失败：' + path); return; }
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
    return { container };
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
      <button class="rb-btn" data-command="search.focus"><i class="ico">🔎</i><span>聚焦搜索框</span></button>
      <button class="rb-btn" data-command="search.rebuild"><i class="ico">↻</i><span>重建索引</span></button>
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
    ],
    keybindings: [
      { command: 'search.focus', key: 'ctrl+shift+f', when: "module=='search'" },
    ],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
