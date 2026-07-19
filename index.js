// renderer/modules/browser/index.js —— 隐私浏览器（第 16 契约模块）
// webview 多标签 + 地址栏三模式 + 历史收藏 + 页内查找 + 隐私隔离 + SearXNG 内核（主进程代理）
// 隐私红线：搜索页不显示任何源站信息；结果链接直达目标站；跨域 Referer 由主进程剥离
import { contextKeys } from '../../core/contextkey-service.js';
import { menus } from '../../core/menu-service.js';
import { toast, modal } from '../../shell/shell.js';

const MODULE = 'browser';
const instances = new Map();
let current = null;
let tabSeq = 1;

const HOME = 'mazz://home';
const isElectron = () => !!window.mazz?.isElectron;

function createBrowser(container) {
  const root = document.createElement('div');
  root.className = 'browser-root';
  root.innerHTML = `
    <div class="br-bar">
      <button class="br-nav" data-a="back" title="后退（Alt+←）">←</button>
      <button class="br-nav" data-a="forward" title="前进（Alt+→）">→</button>
      <button class="br-nav" data-a="reload" title="刷新（Ctrl+R）">⟳</button>
      <button class="br-nav" data-a="home" title="主页">⌂</button>
      <input class="br-addr" placeholder="输入网址，或关键词搜索（Enter 直达 / 搜索）" spellcheck="false" />
      <button class="br-nav" data-a="find" title="页内查找（Ctrl+F）">🔍</button>
      <button class="br-nav" data-a="bookmark" title="收藏当前页（Ctrl+Shift+B）">☆</button>
      <button class="br-nav" data-a="newtab" title="新标签（Ctrl+T）">＋</button>
    </div>
    <div class="br-findbar">
      <input class="br-find-input" placeholder="页内查找…" spellcheck="false" />
      <span class="br-find-count"></span>
      <button class="br-nav" data-f="prev">↑</button>
      <button class="br-nav" data-f="next">↓</button>
      <button class="br-nav" data-f="close">✕</button>
    </div>
    <div class="br-body">
      <div class="br-tabs"></div>
      <div class="br-main">
        <div class="br-views"></div>
        <div class="br-panel">
          <div class="br-panel-head">
            <span class="br-panel-title">搜索</span>
            <div class="br-panel-acts">
              <button data-p="insert" title="结果插入文档">插入文档</button>
              <button data-p="selfcheck" title="实例连通性自检">自检</button>
              <button data-p="close">✕</button>
            </div>
          </div>
          <div class="br-panel-body"></div>
        </div>
      </div>
    </div>`;
  container.appendChild(root);

  const ctl = {
    container, root,
    tabs: [], // {id, view(webview), title, url, el(tab DOM)}
    activeId: null,
    home: HOME,
    history: [],
    bookmarks: [],
    panelOpen: false,
    views: root.querySelector('.br-views'),
    tabsEl: root.querySelector('.br-tabs'),
    addrEl: root.querySelector('.br-addr'),
    panelEl: root.querySelector('.br-panel'),
    panelBody: root.querySelector('.br-panel-body'),
    findbar: root.querySelector('.br-findbar'),
    findInput: root.querySelector('.br-find-input'),
  };

  // ==================== 标签管理 ====================
  function openTab(url = HOME, { background = false } = {}) {
    const id = 'bt-' + tabSeq++;
    const viewWrap = document.createElement('div');
    viewWrap.className = 'br-view-wrap';
    viewWrap.dataset.tabId = id;
    let view;
    if (isElectron()) {
      view = document.createElement('webview');
      view.setAttribute('partition', 'persist:mazz-browser');
      view.setAttribute('allowpopups', '');
      view.className = 'br-webview';
    } else {
      view = document.createElement('iframe');
      view.className = 'br-webview';
      view.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox');
    }
    viewWrap.appendChild(view);
    ctl.views.appendChild(viewWrap);

    const tab = { id, view, title: '新标签页', url: HOME, el: null, canBack: false, canFwd: false };
    ctl.tabs.push(tab);
    bindView(tab);
    renderTabs();
    if (!background) activate(id);
    navigate(tab, url);
    return tab;
  }

  function activate(id) {
    const tab = ctl.tabs.find(t => t.id === id);
    if (!tab) return;
    ctl.activeId = id;
    ctl.tabs.forEach(t => t.view.parentElement.classList.toggle('on', t.id === id));
    ctl.addrEl.value = tab.url === HOME ? '' : tab.url;
    renderTabs();
  }

  function closeTab(id) {
    const i = ctl.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const tab = ctl.tabs[i];
    tab.view.remove();
    tab.el?.remove();
    ctl.tabs.splice(i, 1);
    if (ctl.activeId === id) {
      const next = ctl.tabs[i] || ctl.tabs[i - 1];
      if (next) activate(next.id);
      else { ctl.activeId = null; renderTabs(); }
    } else renderTabs();
    if (!ctl.tabs.length) openTab(HOME);
  }

  function renderTabs() {
    ctl.tabsEl.innerHTML = '';
    for (const t of ctl.tabs) {
      const el = document.createElement('div');
      el.className = 'br-tab' + (t.id === ctl.activeId ? ' on' : '');
      el.innerHTML = `<span class="br-tab-title"></span><button class="br-tab-close">✕</button>`;
      el.querySelector('.br-tab-title').textContent = t.title.slice(0, 24) || '新标签页';
      el.title = t.url;
      el.addEventListener('click', (e) => { if (!e.target.closest('.br-tab-close')) activate(t.id); });
      el.querySelector('.br-tab-close').addEventListener('click', () => closeTab(t.id));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ctl.activeId = t.id;
        menus.show('browser/tab', { x: e.clientX, y: e.clientY, preferDom: true });
      });
      t.el = el;
      ctl.tabsEl.appendChild(el);
    }
  }

  function activeTab() { return ctl.tabs.find(t => t.id === ctl.activeId) || null; }

  // ==================== 导航 ====================
  function normalizeInput(text) {
    const t = text.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return { type: 'url', value: t };
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) && !t.includes(' ')) return { type: 'url', value: 'https://' + t };
    return { type: 'search', value: t };
  }

  async function navigate(tab, url) {
    if (!tab || !url) return;
    tab.url = url;
    if (url === HOME) {
      renderHome(tab);
      tab.title = '主页';
      renderTabs();
      return;
    }
    try {
      if (isElectron()) view_setUrl(tab, url);
      else tab.view.src = url;
    } catch (e) { toast('打开失败：' + e.message); }
  }
  function view_setUrl(tab, url) {
    if (tab.view.loadURL) tab.view.loadURL(url).catch(() => {});
    else tab.view.src = url;
  }

  function renderHome(tab) {
    const recent = ctl.history.slice(0, 8);
    const marks = ctl.bookmarks.slice(0, 12);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f7f6f3;color:#2c2c2a;margin:0;padding:40px 40px 30px}
      .hero{text-align:center;margin:4vh 0 26px}
      h1{font-size:30px;margin:0 0 4px}h1 b{color:#4f46e5}
      .sub{color:#83817a;font-size:13px}
      form{display:flex;justify-content:center}
      .searchbox{display:flex;width:min(560px,90%);background:#fff;border:1.5px solid #e0ded8;border-radius:999px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.05)}
      .searchbox:focus-within{border-color:#4f46e5}
      #q{flex:1;border:0;outline:0;padding:13px 20px;font-size:15px;background:transparent;color:#2c2c2a}
      button{border:0;background:#4f46e5;color:#fff;padding:0 26px;font-size:14px;cursor:pointer}
      button:hover{filter:brightness(1.1)}
      h2{font-size:13px;color:#83817a;margin:24px 0 8px;font-weight:600}
      .grid{display:flex;flex-wrap:wrap;gap:10px}
      a.card{display:block;padding:10px 14px;background:#fff;border:1px solid #e0ded8;border-radius:9px;color:#2c2c2a;text-decoration:none;font-size:13px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      a.card:hover{border-color:#4f46e5}
      .privacy{position:fixed;left:0;right:0;bottom:0;padding:12px 40px;font-size:11.5px;color:#a3a19a;line-height:1.8;border-top:1px solid #ecebe6;background:#f7f6f3}
    </style></head><body>
      <div class="hero">
        <h1>◆ <b>Mazz</b> 搜索</h1>
        <div class="sub">SearXNG 隐私搜索内核 · 主进程代理 · 源站零暴露</div>
      </div>
      <form id="sf"><div class="searchbox">
        <input id="q" autocomplete="off" autofocus placeholder="输入关键词回车搜索，或输入网址直达…" />
        <button type="submit">搜索</button>
      </div></form>
      <h2>收藏</h2><div class="grid">${marks.length ? marks.map(m => `<a class="card" href="${escapeAttr(m.url)}">${escapeHtml(m.title)}</a>`).join('') : '<span style="color:#83817a;font-size:12px">暂无收藏（☆ 收藏当前页）</span>'}</div>
      <h2>最近访问</h2><div class="grid">${recent.length ? recent.map(h => `<a class="card" href="${escapeAttr(h.url)}">${escapeHtml(h.title)}</a>`).join('') : '<span style="color:#83817a;font-size:12px">暂无历史</span>'}</div>
      <div class="privacy">独立会话隔离 · UA 归一化 · 跨域 Referer 剥离 · 追踪域名拦截 · 第三方 Cookie 限制<br>搜索经主进程代理转发，本页与任何网页都无法获知搜索通道信息</div>
      <script>
        document.getElementById('sf').addEventListener('submit', function(e) {
          e.preventDefault();
          var v = document.getElementById('q').value.trim();
          if (v) location.hash = '#mazz-q=' + encodeURIComponent(v);
        });
      </script>
    </body></html>`;
    tab.view.srcdoc = html;
    if (isElectron() && tab.view.setAttribute) {
      // webview 无 srcdoc，用 data URL
      tab.view.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }
  }

  // ==================== webview 事件 ====================
  function bindView(tab) {
    const v = tab.view;
    v.addEventListener('page-title-updated', (e) => { tab.title = e.title || tab.url; renderTabs(); });
    v.addEventListener('did-navigate', (e) => {
      tab.url = e.url;
      if (ctl.activeId === tab.id) ctl.addrEl.value = e.url;
      pushHistory(e.url, tab.title);
      window.MazzHost?.notifyChange(container);
    });
    v.addEventListener('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return;
      // 主页搜索框：hash 拦截 → 走搜索/直达
      if (e.url.includes('#mazz-q=')) {
        const q = decodeURIComponent(e.url.split('#mazz-q=')[1] || '');
        const input = normalizeInput(q);
        if (input?.type === 'url') navigate(tab, input.value);
        else if (input?.value) doSearch(input.value);
        return;
      }
      tab.url = e.url;
      if (ctl.activeId === tab.id) ctl.addrEl.value = e.url;
    });
    v.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame && e.errorCode !== -3) {
        tab.title = '加载失败';
        toast(`页面加载失败：${e.errorDescription || e.errorCode}`);
      }
    });
    v.addEventListener('found-in-page', (e) => {
      const r = e.result;
      root.querySelector('.br-find-count').textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '无结果';
    });
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    // webview 的 context-menu 事件（Electron）：右键 7/8 号上下文
    v.addEventListener('context-menu', (e) => {
      if (!isElectron()) return;
      const p = e.params || {};
      contextKeys.set('browserMediaType', p.mediaType || 'none');
      contextKeys.set('browserHasSelection', !!(p.selectionText || '').trim());
      contextKeys.set('browserLinkUrl', p.linkURL || '');
      menus.show('browser/page', { x: p.x, y: p.y, preferDom: true });
      ctl.contextParams = p;
    });
    v.addEventListener('focus', () => { current = ctl; contextKeys.set('module', MODULE); });
  }

  // ==================== 历史/收藏 ====================
  async function loadStore() {
    try {
      ctl.history = (await window.mazz.invoke('settings:get', { key: 'browser.history' })) || [];
      ctl.bookmarks = (await window.mazz.invoke('settings:get', { key: 'browser.bookmarks' })) || [];
    } catch {}
  }
  function pushHistory(url, title) {
    if (!url || url.startsWith('data:') || url === HOME) return;
    ctl.history = ctl.history.filter(h => h.url !== url);
    ctl.history.unshift({ url, title: title || url, at: Date.now() });
    ctl.history = ctl.history.slice(0, 200);
    window.mazz.invoke('settings:set', { key: 'browser.history', value: ctl.history }).catch(() => {});
  }

  // ==================== 地址栏 ====================
  ctl.addrEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const input = normalizeInput(ctl.addrEl.value);
    if (!input) return;
    if (input.type === 'url') {
      navigate(activeTab(), input.value);
    } else {
      await doSearch(input.value);
    }
  });
  ctl.addrEl.addEventListener('focus', () => ctl.addrEl.select());

  // ==================== 搜索（主进程代理，源站不可见） ====================
  async function doSearch(query) {
    if (!isElectron()) {
      showPanelMessage('浏览器预览无法直连搜索实例（跨域限制），请在桌面版使用搜索');
      return;
    }
    openPanel();
    ctl.panelBody.innerHTML = `<div class="br-loading">正在搜索「${escapeHtml(query)}」…</div>`;
    const res = await window.mazz.invoke('searx:search', { query });
    if (!res.ok) {
      ctl.panelBody.innerHTML = `
        <div class="br-error">
          <div>搜索失败：${escapeHtml(res.error || '未知错误')}</div>
          ${res.selfcheck ? renderSelfcheck(res.selfcheck) : '<button class="rb-btn" style="flex-direction:row" id="br-selfcheck">实例自检</button>'}
        </div>`;
      ctl.panelBody.querySelector('#br-selfcheck')?.addEventListener('click', runSelfcheck);
      return;
    }
    if (!res.results.length) {
      ctl.panelBody.innerHTML = `<div class="br-loading">「${escapeHtml(query)}」无结果</div>`;
      return;
    }
    renderResults(query, res);
  }

  function renderResults(query, res) {
    ctl.lastResults = { query, results: res.results };
    ctl.panelBody.innerHTML = `
      <div class="br-result-head">${res.results.length} 条结果 · 引擎聚合 ${[...new Set(res.results.map(r => r.engine))].slice(0, 6).join(' / ')}</div>
      ${res.suggestions?.length ? `<div class="br-suggests">相关：${res.suggestions.slice(0, 5).map(s => `<a href="#" data-q="${escapeAttr(s)}">${escapeHtml(s)}</a>`).join(' · ')}</div>` : ''}
      ${res.results.map((r, i) => `
        <div class="br-result" data-url="${escapeAttr(r.url)}" data-title="${escapeAttr(r.title)}">
          <a class="br-result-title" href="#">${escapeHtml(r.title)}</a>
          <div class="br-result-url">${escapeHtml(prettyUrl(r.url))}</div>
          <div class="br-result-snippet">${escapeHtml(r.content || '')}</div>
        </div>`).join('')}`;
    ctl.panelBody.querySelectorAll('.br-result-title, .br-result').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const host = el.closest('.br-result');
        if (host) navigate(activeTab(), host.dataset.url);
      });
    });
    ctl.panelBody.querySelectorAll('[data-q]').forEach(el => {
      el.addEventListener('click', (e) => { e.preventDefault(); doSearch(el.dataset.q); });
    });
  }

  function renderSelfcheck(sc) {
    return `<div class="br-selfcheck">${sc.checks.map(c =>
      `<div class="${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'} ${escapeHtml(c.name)}：${escapeHtml(c.detail)}</div>`).join('')}</div>`;
  }
  async function runSelfcheck() {
    const sc = await window.mazz.invoke('searx:selfcheck');
    ctl.panelBody.innerHTML = `<div class="br-result-head">实例连通性自检</div>` + renderSelfcheck(sc);
  }

  function openPanel() {
    ctl.panelOpen = true;
    ctl.root.classList.add('panel-open');
  }
  function closePanel() {
    ctl.panelOpen = false;
    ctl.root.classList.remove('panel-open');
  }
  function showPanelMessage(msg) {
    openPanel();
    ctl.panelBody.innerHTML = `<div class="br-loading">${escapeHtml(msg)}</div>`;
  }

  // ==================== 页内查找 ====================
  const findbar = ctl.findbar;
  function openFind() {
    findbar.classList.add('on');
    ctl.findInput.focus();
    ctl.findInput.select();
  }
  function closeFind() {
    findbar.classList.remove('on');
    const t = activeTab();
    t?.view.stopFindInPage?.('clearSelection');
  }
  ctl.findInput.addEventListener('input', () => {
    const t = activeTab();
    const text = ctl.findInput.value;
    if (!text) { t?.view.stopFindInPage?.('clearSelection'); return; }
    t?.view.findInPage?.(text);
  });
  ctl.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFind();
    if (e.key === 'Enter') {
      const t = activeTab();
      if (ctl.findInput.value) t?.view.findInPage?.(ctl.findInput.value, { findNext: true, forward: !e.shiftKey });
    }
  });
  findbar.querySelector('[data-f=next]').addEventListener('click', () => activeTab()?.view.findInPage?.(ctl.findInput.value, { findNext: true, forward: true }));
  findbar.querySelector('[data-f=prev]').addEventListener('click', () => activeTab()?.view.findInPage?.(ctl.findInput.value, { findNext: true, forward: false }));
  findbar.querySelector('[data-f=close]').addEventListener('click', closeFind);

  // ==================== 工具栏按钮 ====================
  root.querySelector('[data-a=back]').addEventListener('click', () => activeTab()?.view.goBack?.());
  root.querySelector('[data-a=forward]').addEventListener('click', () => activeTab()?.view.goForward?.());
  root.querySelector('[data-a=reload]').addEventListener('click', () => {
    const t = activeTab();
    if (!t) return;
    t.view.reload ? t.view.reload() : navigate(t, t.url);
  });
  root.querySelector('[data-a=home]').addEventListener('click', () => navigate(activeTab(), HOME));
  root.querySelector('[data-a=find]').addEventListener('click', openFind);
  root.querySelector('[data-a=newtab]').addEventListener('click', () => openTab(HOME));
  root.querySelector('[data-a=bookmark]').addEventListener('click', async () => {
    const t = activeTab();
    if (!t || t.url === HOME) return;
    ctl.bookmarks = ctl.bookmarks.filter(b => b.url !== t.url);
    ctl.bookmarks.unshift({ url: t.url, title: t.title, at: Date.now() });
    await window.mazz.invoke('settings:set', { key: 'browser.bookmarks', value: ctl.bookmarks }).catch(() => {});
    toast('已收藏');
  });
  ctl.panelEl.querySelector('[data-p=close]').addEventListener('click', closePanel);
  ctl.panelEl.querySelector('[data-p=selfcheck]').addEventListener('click', runSelfcheck);
  ctl.panelEl.querySelector('[data-p=insert]').addEventListener('click', () => {
    if (!ctl.lastResults) { toast('先做一次搜索'); return; }
    const { query, results } = ctl.lastResults;
    const md = `## 搜索：${query}\n\n` + results.slice(0, 10).map(r => `- [${r.title}](${r.url})${r.content ? ' — ' + r.content.slice(0, 80) : ''}`).join('\n') + '\n';
    window.MazzHost?.openTab('markdown', { title: `搜索_${query}.md`, content: md });
  });

  // 新窗审批事件（主进程转发）：弹窗改在模块内开标签
  if (isElectron()) {
    window.mazz.on('browser:openUrl', ({ url }) => { if (url) openTab(url); });
  }

  // 键盘（模块级）：Ctrl+T 新标签 / Ctrl+L 地址栏 / Ctrl+W 关标签
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); openTab(HOME); }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); ctl.addrEl.focus(); }
  });
  root.tabIndex = 0;

  // ==================== 暴露给命令的方法 ====================
  ctl.openUrl = (url) => navigate(activeTab(), url);
  ctl.search = (q) => doSearch(q);
  ctl.getSelection = async () => {
    const t = activeTab();
    if (!t || !isElectron()) return '';
    try { return await t.view.executeJavaScript('window.getSelection().toString()'); } catch { return ''; }
  };
  ctl.getPageText = async () => {
    const t = activeTab();
    if (!t || !isElectron()) return null;
    try {
      const r = await t.view.executeJavaScript(`(() => {
        const art = document.querySelector('article') || document.body;
        return { title: document.title, url: location.href, text: art.innerText.slice(0, 20000) };
      })()`);
      return r;
    } catch { return null; }
  };
  ctl.activeTab = activeTab;
  ctl.closeFind = closeFind;
  ctl.closeTabFn = closeTab;
  ctl.openTabRaw = openTab;

  // 初始
  loadStore().then(() => openTab(HOME));
  return ctl;
}

function prettyUrl(url) {
  try { const u = new URL(url); return u.host + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname); }
  catch { return url; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ==================== 模块契约 ====================
export default {
  displayName: '浏览器',
  icon: '🌐',

  create(container) {
    const ctl = createBrowser(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return '';
    return JSON.stringify({ mark: 'mazz-browser-v1', tabs: ctl.tabs.map(t => ({ url: t.url, title: t.title })) });
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = JSON.parse(data);
      if (obj.mark === 'mazz-browser-v1' && obj.tabs?.length) {
        for (let i = ctl.tabs.length - 1; i >= 0; i--) {
          ctl.tabs[i].view.remove(); ctl.tabs[i].el?.remove();
        }
        ctl.tabs.length = 0;
        obj.tabs.forEach(t => ctl.openTabWith ? null : null);
        // 逐个打开（复用 openTab）
        for (const t of obj.tabs) window.MazzCommands?.execute('browser.openUrl', { url: t.url });
      }
    } catch {}
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    if (ctl) window.MazzCommands?.execute('browser.newTab');
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl ? ctl.tabs.length : 0;
  },
  getCursorPos(state) {
    const ctl = instances.get(state.container);
    return ctl ? `${ctl.tabs.length} 个标签` : '';
  },

  toolbarHTML: `
    <div class="rb-group" data-label="导航">
      <button class="rb-btn" data-command="browser.newTab"><i class="ico">＋</i><span>新标签</span></button>
      <button class="rb-btn" data-command="browser.home"><i class="ico">⌂</i><span>主页</span></button>
      <button class="rb-btn" data-command="browser.bookmark"><i class="ico">☆</i><span>收藏</span></button>
      <button class="rb-btn" data-command="browser.find"><i class="ico">🔍</i><span>页内查找</span></button>
    </div>
    <div class="rb-group" data-label="协同">
      <button class="rb-btn" data-command="browser.clipToNote"><i class="ico">✂</i><span>摘录到笔记</span></button>
      <button class="rb-btn" data-command="browser.pageToLibrary"><i class="ico">📥</i><span>网页剪藏</span></button>
      <button class="rb-btn" data-command="browser.exportBookmarks"><i class="ico">📑</i><span>导出收藏</span></button>
    </div>
    <div class="rb-group" data-label="搜索">
      <button class="rb-btn" data-command="browser.selfcheck"><i class="ico">⚡</i><span>实例自检</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'browser.newTab', title: '新建浏览器标签', icon: '＋', group: '浏览器',
        when: "module=='browser'", run: () => { if (current) { const t = current.activeTab(); if (t) current.openUrl(current.home); } } },
      { id: 'browser.openUrl', title: '打开网址', group: '浏览器',
        run: ({ url }) => { if (current && url) current.openUrl(url); } },
      { id: 'browser.home', title: '回主页', group: '浏览器', when: "module=='browser'",
        run: () => current?.openUrl(current.home) },
      { id: 'browser.bookmark', title: '收藏当前页', group: '浏览器', when: "module=='browser'",
        run: () => current?.root.querySelector('[data-a=bookmark]').click() },
      { id: 'browser.find', title: '页内查找', group: '浏览器', when: "module=='browser'",
        run: () => current?.root.querySelector('[data-a=find]').click() },
      { id: 'browser.selfcheck', title: '搜索实例自检', group: '浏览器',
        run: async () => {
          if (!window.mazz?.isElectron) { toast('桌面版可用'); return; }
          current?.panelEl.querySelector('[data-p=selfcheck]').click();
          current?.root.classList.add('panel-open');
        } },
      { id: 'browser.clipToNote', title: '选中内容摘录到笔记（含 URL/标题/时间戳）', icon: '✂', group: '桥接',
        when: "module=='browser'",
        run: async () => {
          if (!current) return;
          const text = await current.getSelection();
          const t = current.activeTab();
          if (!text?.trim()) { toast('请先在网页中选中内容'); return; }
          const stamp = new Date().toLocaleString('zh-CN');
          const note = `> ${text.trim()}\n\n—— 摘自 [${t.title}](${t.url}) · ${stamp}`;
          await window.mazz.invoke('quicknote:save', { text: note });
          toast('已摘录到每日笔记');
        } },
      { id: 'browser.pageToLibrary', title: '网页剪藏（正文 → 书库/网页剪藏）', icon: '📥', group: '桥接',
        when: "module=='browser'",
        run: async () => {
          if (!current) return;
          const page = await current.getPageText();
          if (!page?.text) { toast('正文提取失败'); return; }
          const ws = await window.mazz.invoke('workspace:get');
          const dir = `${ws}/网页剪藏`;
          await window.mazz.invoke('fs:mkdir', { path: dir });
          const name = page.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '剪藏';
          const md = `# ${page.title}\n\n> 来源：${page.url}\n> 剪藏时间：${new Date().toLocaleString('zh-CN')}\n\n${page.text}\n`;
          await window.mazz.invoke('fs:writeFile', { path: `${dir}/${name}.md`, content: md });
          toast(`已剪藏：${name}.md`);
        } },
      { id: 'browser.exportBookmarks', title: '导出收藏为 Markdown', group: '浏览器',
        run: async () => {
          if (!current?.bookmarks.length) { toast('暂无收藏'); return; }
          const md = '# 浏览器收藏\n\n' + current.bookmarks.map(b => `- [${b.title}](${b.url})`).join('\n') + '\n';
          window.MazzHost?.openTab('markdown', { title: '浏览器收藏.md', content: md });
        } },
      { id: 'browser.navBack', title: '后退', group: '浏览器', when: "module=='browser'",
        run: () => current?.activeTab()?.view.goBack?.() },
      { id: 'browser.navForward', title: '前进', group: '浏览器', when: "module=='browser'",
        run: () => current?.activeTab()?.view.goForward?.() },
      { id: 'browser.navReload', title: '刷新', group: '浏览器', when: "module=='browser'",
        run: () => { const t = current?.activeTab(); if (t) t.view.reload ? t.view.reload() : current.openUrl(t.url); } },
      { id: 'browser.copyUrl', title: '复制页面地址', group: '浏览器', when: "module=='browser'",
        run: async () => {
          const t = current?.activeTab();
          if (t) { await window.mazz.invoke('clipboard:write', { text: t.url }); toast('地址已复制'); }
        } },
      { id: 'browser.searchSelection', title: 'SearXNG 搜索选中内容', group: '浏览器', when: "module=='browser'",
        run: async () => {
          const text = await current?.getSelection();
          if (text?.trim()) current?.search(text.trim());
        } },
      { id: 'browser.closeTab', title: '关闭标签', group: '浏览器', when: "module=='browser'",
        run: () => { const t = current?.activeTab(); if (t) current?.closeTabFn(t.id); } },
      { id: 'browser.duplicateTab', title: '复制标签', group: '浏览器', when: "module=='browser'",
        run: () => { const t = current?.activeTab(); if (t) window.MazzCommands.execute('browser.openUrl', { url: t.url }); } },
    ],
    keybindings: [
      { command: 'browser.find', key: 'ctrl+f', when: "module=='browser'" },
      { command: 'browser.bookmark', key: 'ctrl+shift+b', when: "module=='browser'" },
    ],
    menus: {
      // 7 号上下文：浏览器·网页
      'browser/page': [
        { command: 'browser.navBack', title: '后退', group: '1_nav' },
        { command: 'browser.navForward', title: '前进', group: '1_nav' },
        { command: 'browser.navReload', title: '刷新', group: '1_nav' },
        { command: 'browser.pageToLibrary', title: '页面存为笔记（剪藏）', group: '2_page' },
        { command: 'browser.bookmark', title: '收藏', group: '2_page' },
        { command: 'browser.copyUrl', title: '复制页面地址', group: '3_util' },
        { command: 'browser.clipToNote', title: '摘录到笔记', when: 'browserHasSelection', group: '4_sel' },
        { command: 'browser.searchSelection', title: 'SearXNG 搜索选中内容', when: 'browserHasSelection', group: '4_sel' },
      ],
      // 浏览器·标签
      'browser/tab': [
        { command: 'browser.closeTab', title: '关闭标签', group: '1_tab' },
        { command: 'browser.duplicateTab', title: '复制标签', group: '1_tab' },
      ],
    },
    bridges: [],
    aiActions: [],
  },
};
