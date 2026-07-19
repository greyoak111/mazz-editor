// renderer/modules/browser/index.js —— 隐私浏览器（第 16 契约模块）
// webview 多标签 + 地址栏三模式 + 历史收藏 + 页内查找 + 隐私隔离 + SearXNG 内核（主进程代理）
// 隐私红线：搜索页不显示任何源站信息；结果链接直达目标站；跨域 Referer 由主进程剥离
import { contextKeys } from '../../core/contextkey-service.js';
import { menus } from '../../core/menu-service.js';
import { toast, modal, inputModal } from '../../shell/shell.js';

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
      view.setAttribute('src', 'about:blank'); // 空 webview 必须给初始页，否则可能永不触发 dom-ready
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
    queueNav(tab, url);
  }

  /** 导航统一入口：dom-ready 队列 + 串行化（消灭 ERR_ABORTED 竞跑） */
  function queueNav(tab, url) {
    tab.navQueue = tab.navQueue || Promise.resolve();
    tab.navQueue = tab.navQueue.then(async () => {
      if (!tab.domReady && isElectron()) {
        await Promise.race([
          new Promise((resolve) => tab.view.addEventListener('dom-ready', resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, 3000)), // 超时兜底：绝不无限等待
        ]);
        tab.domReady = true;
      }
      if (url === HOME) {
        tab.url = HOME; // 逻辑 URL 保持 mazz://home（renderHome 加载的 data: 不覆盖它）
        tab.title = '主页';
        renderTabs();
        if (ctl.activeId === tab.id) ctl.addrEl.value = '';
        // 自定义主页：直接加载用户设定的网址（逻辑身份仍是主页）
        const custom = (ctl.customHome || '').trim();
        if (custom) {
          tab.homeLoaded = false;
          try {
            if (isElectron()) await tab.view.loadURL(custom).catch(() => {});
            else tab.view.src = custom;
          } catch {}
          return;
        }
        renderHome(tab);
        // 等主页落地再放下一个导航（消灭 data: ERR_ABORTED 噪音）
        if (isElectron()) {
          await Promise.race([
            new Promise((resolve) => tab.view.addEventListener('did-stop-loading', resolve, { once: true })),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ]);
        }
        return;
      }
      try {
        if (isElectron()) {
          await tab.view.loadURL(url).catch(() => {});
        } else {
          tab.view.src = url;
        }
      } catch (e) { toast('打开失败：' + e.message); }
    });
    return tab.navQueue;
  }

  /** Ctrl+滚轮缩放（注入客页 → console 通道回传） */
  function injectZoom(tab) {
    if (!isElectron()) return;
    tab.view.executeJavaScript(`
      window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) { e.preventDefault(); console.log('MAZZ_ZOOM:' + e.deltaY); }
      }, { passive: false });
    `).catch(() => {});
  }

  /** 主页 HTML（主题变量化：明亮/黑暗/跟随系统 + ⚙ 设置面板） */
  function buildHomeHtml() {
    const recent = ctl.history.slice(0, 10);
    const theme = ctl.homeTheme || 'system';
    // 收藏按文件夹分组
    const folderBlocks = ctl.folders.map(f => {
      const items = ctl.bookmarks.filter(b => (b.folder || 'default') === f.id).slice(0, 8);
      if (!items.length && ctl.folders.length <= 1) return '';
      return `<h2>📁 ${escapeHtml(f.name)}${items.length ? '' : ' <small>（空）</small>'}</h2><div class="grid">${
        items.map(b => `<span class="card-wrap"><a class="card" href="${escapeAttr(b.url)}" title="${escapeAttr(b.url)}">${escapeHtml(b.name || b.title)}</a><span class="card-acts"><i data-act="rename" data-url="${escapeAttr(b.url)}">✎</i><i data-act="del-bm" data-url="${escapeAttr(b.url)}">✕</i></span></span>`).join('')
      }</div>`;
    }).join('');
    const lightVars = `--bg:#f7f6f3;--fg:#2c2c2a;--mut:#83817a;--faint:#a3a19a;--card:#fff;--bd:#e0ded8;--bd2:#ecebe6;--acc:#4f46e5;--sh:rgba(0,0,0,.05)`;
    const darkVars = `--bg:#1b1b1a;--fg:#e8e6e1;--mut:#9b9890;--faint:#7d7b74;--card:#262625;--bd:#3d3c39;--bd2:#333231;--acc:#818cf8;--sh:rgba(0,0,0,.4)`;
    const themeCss = theme === 'dark' ? `:root{${darkVars}}`
      : theme === 'light' ? `:root{${lightVars}}`
      : `:root{${lightVars}}@media (prefers-color-scheme:dark){:root{${darkVars}}}`;
    const tBtn = (v, label) => `<button class="tbtn${theme === v ? ' on' : ''}" data-act="theme" data-url="${v}">${label}</button>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${themeCss}
      body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:40px 40px 30px}
      .hero{text-align:center;margin:4vh 0 26px}
      h1{font-size:30px;margin:0 0 4px}h1 b{color:var(--acc)}
      .sub{color:var(--mut);font-size:13px}
      form{display:flex;justify-content:center}
      .searchbox{display:flex;width:min(560px,90%);background:var(--card);border:1.5px solid var(--bd);border-radius:999px;overflow:hidden;box-shadow:0 2px 12px var(--sh)}
      .searchbox:focus-within{border-color:var(--acc)}
      #q{flex:1;border:0;outline:0;padding:13px 20px;font-size:15px;background:transparent;color:var(--fg)}
      button{border:0;background:var(--acc);color:#fff;padding:0 26px;font-size:14px;cursor:pointer}
      button:hover{filter:brightness(1.1)}
      h2{font-size:13px;color:var(--mut);margin:24px 0 8px;font-weight:600}
      .grid{display:flex;flex-wrap:wrap;gap:10px}
      a.card{display:block;padding:10px 14px;background:var(--card);border:1px solid var(--bd);border-radius:9px;color:var(--fg);text-decoration:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
      a.card:hover{border-color:var(--acc)}
      .card-wrap{display:flex;align-items:center;gap:2px;max-width:240px}
      .card-acts{display:none;gap:2px}
      .card-wrap:hover .card-acts{display:inline-flex}
      .card-acts i{font-style:normal;cursor:pointer;color:var(--faint);font-size:12px;padding:1px 4px;border-radius:3px}
      .card-acts i:hover{color:var(--acc);background:var(--bd2)}
      .privacy{position:fixed;left:0;right:0;bottom:0;padding:12px 40px;font-size:11.5px;color:var(--faint);line-height:1.8;border-top:1px solid var(--bd2);background:var(--bg)}
      .htop{position:fixed;top:14px;right:16px;display:flex;gap:6px;align-items:center;z-index:9}
      .tbtn{border:1px solid var(--bd);background:var(--card);color:var(--fg);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
      .tbtn.on{border-color:var(--acc);color:var(--acc)}
      .tbtn:hover{border-color:var(--acc)}
      .hset{display:none;position:fixed;top:46px;right:16px;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;box-shadow:0 6px 24px var(--sh);width:300px;z-index:9}
      .hset.open{display:block}
      .hset .lbl{font-size:12px;color:var(--mut);margin:4px 0 6px;font-weight:600}
      .hset input{width:100%;box-sizing:border-box;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:6px;padding:7px 9px;font-size:12.5px;outline:none}
      .hset input:focus{border-color:var(--acc)}
      .hset .row{display:flex;gap:6px;margin-top:8px}
      .hset .row button{flex:1;padding:7px 0;border-radius:6px;font-size:12.5px}
      .hset .row .ghost{background:transparent;color:var(--mut);border:1px solid var(--bd)}
      .hset .hint{font-size:11px;color:var(--faint);margin-top:8px;line-height:1.6}
    </style></head><body>
      <div class="htop">
        ${tBtn('light', '☀ 明亮')}${tBtn('dark', '🌙 黑暗')}${tBtn('system', '◐ 跟随系统')}
        <button class="tbtn" data-act="gear" title="主页设置">⚙</button>
      </div>
      <div class="hset" id="hset">
        <div class="lbl">自定义主页</div>
        <input id="home-url" placeholder="留空则使用内置主页" value="${escapeAttr(ctl.customHome || '')}" spellcheck="false" />
        <div class="row">
          <button data-act="set-home">设为主页</button>
          <button class="ghost" data-act="reset-home">恢复内置</button>
        </div>
        <div class="lbl" style="margin-top:12px">账号密码</div>
        <div class="row"><button data-act="pw">🔑 打开密码管理器</button></div>
        <div class="hint">主题按钮即时生效并记忆；自定义主页后，新建标签页将直接打开该网址。</div>
      </div>
      <div class="hero">
        <h1>◆ <b>Mazz</b> 搜索</h1>
        <div class="sub">SearXNG 隐私搜索内核 · 主进程代理 · 源站零暴露</div>
      </div>
      <form id="sf"><div class="searchbox">
        <input id="q" autocomplete="off" autofocus placeholder="输入关键词回车搜索，或输入网址直达…" />
        <button type="submit">搜索</button>
      </div></form>
      ${folderBlocks}
      <h2>最近访问</h2><div class="grid">${recent.length ? recent.map(h => `<span class="card-wrap"><a class="card" href="${escapeAttr(h.url)}" title="${escapeAttr(h.url)}">${escapeHtml(h.name || h.title)}</a><span class="card-acts"><i data-act="rename-his" data-url="${escapeAttr(h.url)}">✎</i><i data-act="del-his" data-url="${escapeAttr(h.url)}">✕</i></span></span>`).join('') : '<span style="color:var(--mut);font-size:12px">暂无历史</span>'}</div>
      <div class="privacy">独立会话隔离 · UA 归一化 · 跨域 Referer 剥离 · 追踪域名拦截 · 第三方 Cookie 限制<br>搜索经主进程代理转发，本页与任何网页都无法获知搜索通道信息</div>
      <script>
        document.getElementById('sf').addEventListener('submit', function(e) {
          e.preventDefault();
          var v = document.getElementById('q').value.trim();
          if (!v) return;
          try { console.log('MAZZ_Q:' + v); } catch (_) {}
          try { parent.postMessage({ mazzSearch: v }, '*'); } catch (_) {}
        });
        document.addEventListener('click', function(e) {
          var t = e.target.closest('[data-act]');
          if (!t) return;
          e.preventDefault(); e.stopPropagation();
          var act = t.dataset.act, url = t.dataset.url || '';
          if (act === 'gear') { document.getElementById('hset').classList.toggle('open'); return; }
          if (act === 'set-home') { url = document.getElementById('home-url').value.trim(); }
          try { console.log('MAZZ_ACT:' + act + '|' + url); } catch (_) {}
          try { parent.postMessage({ mazzAct: act, url: url }, '*'); } catch (_) {}
        }, true);
        document.getElementById('home-url').addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); document.querySelector('[data-act=set-home]').click(); }
        });
      </script>
    </body></html>`;
  }

  function renderHome(tab) {
    const html = buildHomeHtml();
    tab.view.srcdoc = html; // iframe 预览路径
    if (isElectron() && tab.view.setAttribute) {
      if (tab.homeLoaded && tab.domReady && tab.view.executeJavaScript) {
        // 已在主页：原地重写文档，零导航（根除 ERR_ABORTED 连击）
        tab.view.executeJavaScript(
          `document.open();document.write(${JSON.stringify(html)});document.close();`
        ).catch(() => {
          tab.homeLoaded = false;
          tab.view.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
          tab.homeLoaded = true;
        });
      } else {
        // 首次：webview 无 srcdoc，用 data URL（经统一队列，dom-ready 已就绪）
        tab.view.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        tab.homeLoaded = true;
      }
    }
  }

  /** 加载失败页（替代空白页，含原因与重试） */
  function renderLoadError(tab, e) {
    const desc = e.errorDescription || String(e.errorCode);
    const friendly = friendlyError(desc, tab.url);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f7f6f3;color:#2c2c2a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
      .box{max-width:460px;text-align:center;padding:32px}
      h2{font-size:20px;margin:0 0 10px;color:#c2410c}
      p{color:#83817a;font-size:13px;line-height:1.8;margin:6px 0}
      code{background:#e3e1da;padding:2px 7px;border-radius:5px;font-size:12px}
      button{margin-top:18px;border:0;background:#4f46e5;color:#fff;padding:9px 26px;border-radius:8px;font-size:14px;cursor:pointer}
    </style></head><body><div class="box">
      <h2>😕 页面加载失败</h2>
      <p><code>${escapeHtml(tab.url)}</code></p>
      <p>${escapeHtml(desc)}</p>
      <p>${escapeHtml(friendly)}</p>
      <button onclick="console.log('MAZZ_RETRY:1')">重试</button>
    </div></body></html>`;
    tab.view.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  function friendlyError(desc, url) {
    if (/CERT|证书/i.test(desc)) return '证书验证失败——若确认站点可信，可在弹出的对话框中选择「信任此站点」。';
    if (/RESET|CLOSED|断开/i.test(desc)) return '连接被对方重置——该站点可能被当前网络环境拦截。';
    if (/TIMED_OUT|超时/i.test(desc)) return '连接超时——站点无响应或网络不通。';
    if (/FAILED|失败/i.test(desc)) return '网络无法到达该站点——可能被当前网络环境拦截（代理/防火墙/地域限制）。';
    if (/NAME|DNS|解析/i.test(desc)) return '域名解析失败——请检查网址拼写或当前 DNS 设置。';
    return '可稍后重试，或换个网址。';
  }

  // ==================== webview 事件 ====================
  function bindView(tab) {
    const v = tab.view;
    v.addEventListener('page-title-updated', (e) => {
      if (isInternalUrl(tab.url)) return; // 内部页标题由导航逻辑管理（主页保持「主页」）
      tab.title = e.title || tab.url;
      renderTabs();
    });
    v.addEventListener('did-navigate', (e) => {
      // 内部页面（主页 data:/about:blank 等）不覆盖标签逻辑 URL，也不进历史
      if (isInternalUrl(e.url)) return;
      // 自定义主页落地：保持主页逻辑身份，不进历史
      if (tab.url === HOME && ctl.customHome && normUrl(e.url) === normUrl(ctl.customHome)) {
        tab.homeLoaded = false; // 自定义主页非内置文档，不可原地重写
        return;
      }
      // 被动导航 = 落地 URL 与目标 URL 不符（重定向/页面自跳）
      const passive = normUrl(e.url) !== normUrl(tab.url);
      tab.url = e.url;
      tab.homeLoaded = false; // 已离开主页
      if (ctl.activeId === tab.id) ctl.addrEl.value = e.url;
      pushHistory(e.url, tab.title, passive);
      window.MazzHost?.notifyChange(container);
    });
    v.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame && !isInternalUrl(e.url)) {
        tab.url = e.url;
        if (ctl.activeId === tab.id) ctl.addrEl.value = e.url;
      }
    });
    // 主页搜索框：postMessage 通道（iframe 预览与 webview 通用）
    window.addEventListener('message', (e) => {
      if (e.data?.mazzSearch) {
        const input = normalizeInput(e.data.mazzSearch);
        if (input?.type === 'url') navigate(tab, input.value);
        else if (input?.value) doSearch(input.value);
        return;
      }
      if (e.data?.mazzAct) handleHomeAction(e.data.mazzAct, e.data.url);
    });
    // 主页搜索框：console 通道（Electron webview 专用）
    v.addEventListener('console-message', (e) => {
      const msg = e.message || '';
      if (msg.startsWith('MAZZ_Q:')) {
        const q = msg.slice(7).trim();
        if (!q) return;
        const input = normalizeInput(q);
        if (input?.type === 'url') navigate(tab, input.value);
        else if (input?.value) doSearch(input.value);
      }
      if (msg.startsWith('MAZZ_ACT:')) {
        const [act, url] = msg.slice(9).split('|');
        handleHomeAction(act, decodeURIComponent(url || ''));
      }
      if (msg.startsWith('MAZZ_ZOOM:')) {
        const dy = parseFloat(msg.slice(10));
        if (isNaN(dy)) return;
        const cur = tab.zoom || 1;
        const next = Math.min(3, Math.max(0.3, cur + (dy < 0 ? 0.1 : -0.1)));
        tab.zoom = next;
        v.setZoomFactor(next);
        toast(`缩放 ${Math.round(next * 100)}%`);
      }
      if (msg === 'MAZZ_RETRY:1') {
        queueNav(tab, tab.url);
      }
    });
    v.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame && e.errorCode !== -3) {
        tab.title = '加载失败';
        renderLoadError(tab, e);
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
    // 每次页面加载完成都注入缩放脚本（跨页不失效）
    v.addEventListener('dom-ready', () => injectZoom(tab));
  }

  // ==================== 历史/收藏（自定义命名/删除/文件夹分类） ====================
  /** 内部页面 URL（主页 data:/about:blank/blob: 等）——不进历史/收藏，不覆盖标签逻辑 URL */
  function isInternalUrl(u) {
    if (!u) return true;
    return u === HOME || u === 'about:blank' || u === 'about:srcdoc'
      || u.startsWith('data:') || u.startsWith('blob:')
      || u.startsWith('mazz:') || u.startsWith('chrome:') || u.startsWith('devtools:');
  }
  async function loadStore() {
    try {
      const rawHistory = (await window.mazz.invoke('settings:get', { key: 'browser.history' })) || [];
      const rawBookmarks = (await window.mazz.invoke('settings:get', { key: 'browser.bookmarks' })) || [];
      // 清洗历史遗留的内部页面条目（主页/about:blank 等顽固分子）
      ctl.history = rawHistory.filter(h => h && h.url && !isInternalUrl(h.url));
      ctl.bookmarks = rawBookmarks.filter(b => b && b.url && !isInternalUrl(b.url));
      if (ctl.history.length !== rawHistory.length) saveHistory();
      if (ctl.bookmarks.length !== rawBookmarks.length) saveBookmarks();
      ctl.folders = (await window.mazz.invoke('settings:get', { key: 'browser.folders' })) || [{ id: 'default', name: '默认收藏夹' }];
      ctl.homeTheme = (await window.mazz.invoke('settings:get', { key: 'browser.homeTheme' })) || 'system';
      ctl.customHome = (await window.mazz.invoke('settings:get', { key: 'browser.customHome' })) || '';
    } catch { ctl.folders = ctl.folders || [{ id: 'default', name: '默认收藏夹' }]; }
    // 会话级历史屏蔽集：删除过的条目，自动重定向不再写回（显式访问仍会进）
    ctl.historyBlock = ctl.historyBlock || new Set();
  }
  /** URL 归一化（身份比较用：去 hash/尾斜杠/小写主机） */
  function normUrl(u) {
    try {
      const x = new URL(u);
      x.hash = '';
      let s = x.href;
      if (s.endsWith('/')) s = s.slice(0, -1);
      return s.toLowerCase();
    } catch { return (u || '').toLowerCase(); }
  }
  /** 页面级身份（origin+pathname，忽略 query/hash）——登录跳转页参数每次变，页面不会变 */
  function pageKey(u) {
    try { const x = new URL(u); return (x.origin + x.pathname).toLowerCase(); }
    catch { return normUrl(u); }
  }

  function saveBookmarks() {
    window.mazz.invoke('settings:set', { key: 'browser.bookmarks', value: ctl.bookmarks }).catch(() => {});
  }
  function saveFolders() {
    window.mazz.invoke('settings:set', { key: 'browser.folders', value: ctl.folders }).catch(() => {});
  }
  function saveHistory() {
    window.mazz.invoke('settings:set', { key: 'browser.history', value: ctl.history }).catch(() => {});
  }
  function pushHistory(url, title, passive = false) {
    if (isInternalUrl(url)) return;
    const key = normUrl(url);
    // 已删除条目：被动导航（重定向/页面自跳）不再写回；显式访问解除屏蔽
    // 匹配粒度 = 页面级（origin+pathname）：登录跳转页 query 每次变也逃不掉
    if (passive && ctl.historyBlock?.has(pageKey(url))) return;
    if (!passive) ctl.historyBlock?.delete(pageKey(url));
    ctl.history = ctl.history.filter(h => normUrl(h.url) !== key);
    ctl.history.unshift({ url, title: title || url, at: Date.now() });
    ctl.history = ctl.history.slice(0, 200);
    saveHistory();
  }

  /** 收藏当前页（命名 + 选文件夹 + 新建文件夹） */
  function bookmarkCurrent() {
    const t = activeTab();
    if (!t || isInternalUrl(t.url)) return;
    const m = modal('收藏当前页');
    const folderOpts = (sel) => ctl.folders.map(f =>
      `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
    m.body.innerHTML = `
      <div class="set-row"><label>名称</label><input id="bm-name" class="rb-input" style="width:70%" value="${escapeAttr(t.title)}"></div>
      <div class="set-row"><label>网址</label><span style="font-size:11.5px;color:var(--fg-dim);max-width:70%;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.url)}</span></div>
      <div class="set-row"><label>收藏夹</label><select id="bm-folder" class="rb-select">${folderOpts('default')}<option value="__new">＋ 新建收藏夹…</option></select></div>
      <div class="set-row" id="bm-newfold-row" style="display:none"><label>新收藏夹名</label><input id="bm-newfold" class="rb-input" style="width:70%" placeholder="输入名称"></div>
      <div class="set-row"><label></label><button id="bm-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">收藏</button></div>`;
    const sel = m.body.querySelector('#bm-folder');
    sel.addEventListener('change', () => {
      m.body.querySelector('#bm-newfold-row').style.display = sel.value === '__new' ? 'flex' : 'none';
    });
    m.body.querySelector('#bm-go').addEventListener('click', async () => {
      let folderId = sel.value;
      if (folderId === '__new') {
        const name = m.body.querySelector('#bm-newfold').value.trim();
        if (!name) { toast('请输入收藏夹名称'); return; }
        folderId = 'f' + Date.now();
        ctl.folders.push({ id: folderId, name });
        saveFolders();
      }
      const name = m.body.querySelector('#bm-name').value.trim() || t.title;
      const key = normUrl(t.url);
      ctl.bookmarks = ctl.bookmarks.filter(b => normUrl(b.url) !== key);
      ctl.bookmarks.unshift({ url: t.url, title: t.title, name, folder: folderId, at: Date.now() });
      saveBookmarks();
      m.close();
      toast(`已收藏到「${ctl.folders.find(f => f.id === folderId)?.name}」`);
    });
  }

  /** 收藏管理（文件夹新建/命名/删除 + 条目重命名/删除/移动） */
  function openBookmarkManager() {
    const m = modal('收藏管理');
    const render = () => {
      const foldersHtml = ctl.folders.map(f => {
        const items = ctl.bookmarks.filter(b => (b.folder || 'default') === f.id);
        return `
        <div class="bm-folder" data-fid="${f.id}">
          <div class="bm-folder-head">
            <span class="bm-fold-name">📁 ${escapeHtml(f.name)} <small>(${items.length})</small></span>
            <span class="bm-fold-acts">
              <button data-a="rename" title="重命名收藏夹">✎</button>
              ${f.id !== 'default' ? `<button data-a="delfolder" title="删除收藏夹（条目移到默认）">✕</button>` : ''}
            </span>
          </div>
          <div class="bm-items">
            ${items.length ? items.map(b => `
              <div class="bm-item" data-url="${escapeAttr(b.url)}">
                <span class="bm-item-name">${escapeHtml(b.name || b.title)}</span>
                <span class="bm-item-acts">
                  <button data-a="rename-item" title="重命名">✎</button>
                  <button data-a="move" title="移动到…">⇢</button>
                  <button data-a="del" title="删除">✕</button>
                </span>
              </div>`).join('') : '<div class="bm-empty">（空）</div>'}
          </div>
        </div>`;
      }).join('');
      m.body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <button id="bm-add-folder" class="rb-btn" style="flex-direction:row">＋ 新建收藏夹</button>
          <button id="bm-clear-history" class="rb-btn" style="flex-direction:row">清空最近访问</button>
        </div>
        <div style="max-height:55vh;overflow-y:auto">${foldersHtml}</div>`;
      m.body.querySelector('#bm-add-folder').addEventListener('click', async () => {
        const name = await inputModal('新建收藏夹');
        if (name?.trim()) {
          ctl.folders.push({ id: 'f' + Date.now(), name: name.trim() });
          saveFolders();
          render();
        }
      });
      m.body.querySelector('#bm-clear-history').addEventListener('click', () => {
        ctl.history.forEach(h => ctl.historyBlock?.add(pageKey(h.url))); // 全部屏蔽自动写回
        ctl.history = [];
        saveHistory();
        toast('最近访问已清空');
      });
      m.body.querySelectorAll('.bm-folder').forEach(fEl => {
        const fid = fEl.dataset.fid;
        fEl.querySelector('[data-a=rename]')?.addEventListener('click', async () => {
          const f = ctl.folders.find(x => x.id === fid);
          const name = await inputModal('重命名收藏夹', f?.name || '');
          if (name?.trim()) { f.name = name.trim(); saveFolders(); render(); }
        });
        fEl.querySelector('[data-a=delfolder]')?.addEventListener('click', () => {
          ctl.bookmarks.forEach(b => { if ((b.folder || 'default') === fid) b.folder = 'default'; });
          ctl.folders = ctl.folders.filter(x => x.id !== fid);
          saveFolders(); saveBookmarks(); render();
        });
        fEl.querySelectorAll('.bm-item').forEach(it => {
          const url = it.dataset.url;
          const ukey = normUrl(url);
          const bm = ctl.bookmarks.find(b => normUrl(b.url) === ukey);
          it.querySelector('[data-a=rename-item]').addEventListener('click', async () => {
            const name = await inputModal('重命名收藏', bm?.name || bm?.title || '');
            if (name?.trim()) { bm.name = name.trim(); saveBookmarks(); render(); }
          });
          it.querySelector('[data-a=move]').addEventListener('click', async () => {
            const names = ctl.folders.map((f, i) => `${i + 1}. ${f.name}`).join('；');
            const pick = await inputModal(`移动到收藏夹（${names}）——输入序号`);
            const idx = parseInt(pick, 10) - 1;
            if (idx >= 0 && ctl.folders[idx]) { bm.folder = ctl.folders[idx].id; saveBookmarks(); render(); }
          });
          it.querySelector('[data-a=del]').addEventListener('click', () => {
            ctl.bookmarks = ctl.bookmarks.filter(b => normUrl(b.url) !== ukey);
            saveBookmarks(); render();
          });
        });
      });
    };
    render();
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
  root.querySelector('[data-a=bookmark]').addEventListener('click', bookmarkCurrent);
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
  /** 主页快捷动作：重命名/删除（收藏与历史，URL 归一化匹配）+ 主题/自定义主页/密码管理器 */
  async function handleHomeAction(act, url) {
    const urlFree = ['reset-home', 'pw', 'set-home'].includes(act);
    if (!urlFree && !url) return;
    const key = normUrl(url || '');
    const refresh = () => {
      // 只有当前标签是主页才重渲染（且走队列防抖，消灭 ERR_ABORTED 连击）
      const t = activeTab();
      if (t && t.url === HOME) queueNav(t, HOME);
    };
    if (act === 'rename') {
      const bm = ctl.bookmarks.find(b => normUrl(b.url) === key);
      if (!bm) return;
      const name = await inputModal('重命名收藏', bm.name || bm.title || '');
      if (name?.trim()) { bm.name = name.trim(); saveBookmarks(); refresh(); }
    } else if (act === 'del-bm') {
      ctl.bookmarks = ctl.bookmarks.filter(b => normUrl(b.url) !== key);
      saveBookmarks();
      refresh();
    } else if (act === 'rename-his') {
      const h = ctl.history.find(x => normUrl(x.url) === key);
      if (!h) return;
      const name = await inputModal('重命名记录', h.name || h.title || '');
      if (name?.trim()) { h.name = name.trim(); saveHistory(); refresh(); }
    } else if (act === 'del-his') {
      ctl.historyBlock?.add(pageKey(url)); // 屏蔽自动重定向写回（按页面级身份，query 变化也屏蔽）
      ctl.history = ctl.history.filter(x => normUrl(x.url) !== key);
      saveHistory();
      refresh();
    } else if (act === 'theme') {
      ctl.homeTheme = ['light', 'dark', 'system'].includes(url) ? url : 'system';
      window.mazz.invoke('settings:set', { key: 'browser.homeTheme', value: ctl.homeTheme }).catch(() => {});
      refresh();
    } else if (act === 'set-home' || act === 'reset-home') {
      let v = act === 'reset-home' ? '' : (url || '').trim();
      if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      ctl.customHome = v;
      window.mazz.invoke('settings:set', { key: 'browser.customHome', value: v }).catch(() => {});
      toast(v ? '主页已设为：' + v : '已恢复内置主页');
      refresh();
    } else if (act === 'pw') {
      openPasswordManager();
    }
  }

  // ==================== 密码管理器（safeStorage 加密，主进程存储） ====================
  async function openPasswordManager() {
    const m = modal('密码管理器');
    const encAvail = await window.mazz.invoke('pw:available').catch(() => false);
    const rowStyle = 'display:flex;align-items:center;gap:6px;padding:8px 4px;border-bottom:1px solid var(--bd2,#ecebe6)';
    const btnStyle = 'border:1px solid var(--bd,#e0ded8);background:transparent;border-radius:5px;cursor:pointer;padding:2px 7px;font-size:12px;color:inherit';
    const render = async () => {
      const list = (await window.mazz.invoke('pw:list').catch(() => [])) || [];
      m.body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:12px">
          <button id="pw-add" class="rb-btn" style="flex-direction:row">＋ 添加账号</button>
          <span style="font-size:11.5px;color:#83817a">${encAvail ? '🔒 系统级加密存储（safeStorage）' : '⚠ 系统加密不可用，密码以编码形式保存'}</span>
        </div>
        <div id="pw-form" style="display:none;border:1px solid var(--bd,#e0ded8);border-radius:8px;padding:10px 12px;margin-bottom:10px">
          <input id="pwf-id" type="hidden">
          <div style="display:grid;grid-template-columns:64px 1fr;gap:6px;align-items:center;font-size:12.5px">
            <label>站点</label><input id="pwf-site" class="rb-input" placeholder="如 zhihu.com" spellcheck="false">
            <label>用户名</label><input id="pwf-user" class="rb-input" spellcheck="false">
            <label>密码</label><input id="pwf-pass" class="rb-input" type="password" spellcheck="false">
            <label>备注</label><input id="pwf-note" class="rb-input" spellcheck="false">
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
            <button id="pwf-cancel" class="rb-btn" style="flex-direction:row">取消</button>
            <button id="pwf-save" class="rb-btn" style="flex-direction:row">保存</button>
          </div>
        </div>
        <div style="max-height:46vh;overflow-y:auto">
          ${list.length ? list.map(e => `
            <div class="pw-item" data-id="${escapeAttr(e.id)}" style="${rowStyle}">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px">${escapeHtml(e.site || '（未命名站点）')}</div>
                <div style="font-size:12px;color:#83817a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.username || '')}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
              </div>
              <span class="pw-secret" data-shown="0" style="font-family:monospace;font-size:12px;min-width:76px;text-align:right">••••••</span>
              <button data-a="show" style="${btnStyle}" title="显示/隐藏">👁</button>
              <button data-a="copy" style="${btnStyle}" title="复制密码">📋</button>
              <button data-a="edit" style="${btnStyle}" title="编辑">✎</button>
              <button data-a="del" style="${btnStyle}" title="删除">✕</button>
            </div>`).join('')
          : '<div style="color:#83817a;font-size:12.5px;padding:18px 0;text-align:center">还没有保存的账号——点「添加账号」开始</div>'}
        </div>`;
      // 新增/编辑表单
      const form = m.body.querySelector('#pw-form');
      const openForm = (entry) => {
        form.style.display = 'block';
        m.body.querySelector('#pwf-id').value = entry?.id || '';
        m.body.querySelector('#pwf-site').value = entry?.site || '';
        m.body.querySelector('#pwf-user').value = entry?.username || '';
        m.body.querySelector('#pwf-pass').value = entry?.password || '';
        m.body.querySelector('#pwf-note').value = entry?.note || '';
        m.body.querySelector('#pwf-site').focus();
      };
      m.body.querySelector('#pw-add').addEventListener('click', () => openForm(null));
      m.body.querySelector('#pwf-cancel').addEventListener('click', () => { form.style.display = 'none'; });
      m.body.querySelector('#pwf-save').addEventListener('click', async () => {
        const entry = {
          id: m.body.querySelector('#pwf-id').value || undefined,
          site: m.body.querySelector('#pwf-site').value.trim(),
          username: m.body.querySelector('#pwf-user').value.trim(),
          password: m.body.querySelector('#pwf-pass').value,
          note: m.body.querySelector('#pwf-note').value.trim(),
        };
        if (!entry.site && !entry.username) { toast('至少填写站点或用户名'); return; }
        await window.mazz.invoke('pw:save', { entry }).catch(() => {});
        toast('已保存');
        render();
      });
      // 条目操作
      m.body.querySelectorAll('.pw-item').forEach(it => {
        const id = it.dataset.id;
        const entry = list.find(x => x.id === id);
        const secret = it.querySelector('.pw-secret');
        it.querySelector('[data-a=show]').addEventListener('click', () => {
          const shown = secret.dataset.shown === '1';
          secret.dataset.shown = shown ? '0' : '1';
          secret.textContent = shown ? '••••••' : (entry?.password || '');
        });
        it.querySelector('[data-a=copy]').addEventListener('click', async () => {
          await window.mazz.invoke('clipboard:write', { text: entry?.password || '' }).catch(() => {});
          toast('密码已复制');
        });
        it.querySelector('[data-a=edit]').addEventListener('click', () => openForm(entry));
        it.querySelector('[data-a=del]').addEventListener('click', async () => {
          await window.mazz.invoke('pw:delete', { id }).catch(() => {});
          toast('已删除');
          render();
        });
      });
    };
    await render();
  }

  /** 在当前网页填充已保存的账号密码（按站点域名匹配） */
  async function fillPassword() {
    const t = activeTab();
    if (!t || isInternalUrl(t.url)) { toast('当前页面无法填充'); return; }
    if (!isElectron()) { toast('填充功能仅在桌面端可用'); return; }
    const list = (await window.mazz.invoke('pw:list').catch(() => [])) || [];
    if (!list.length) { toast('密码库为空——先打开密码管理器添加'); return; }
    let host = '';
    try { host = new URL(t.url).hostname.toLowerCase(); } catch {}
    const match = list.find(e => {
      const s = (e.site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
      return s && (host === s || host.endsWith('.' + s) || host.includes(s) || s.includes(host));
    });
    if (!match) { toast(`没有匹配 ${host || '当前站点'} 的账号`); return; }
    const js = `(function(){
      var pw = document.querySelector('input[type=password]');
      if (!pw) return 'no-field';
      var scope = pw.closest('form') || document;
      var user = scope.querySelector('input[type=email],input[type=tel],input[name*=user i],input[name*=account i],input[name*=login i],input[name*=mail i],input[type=text],input:not([type])');
      function setVal(el, v) {
        el.focus(); el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (user) setVal(user, ${JSON.stringify(match.username)});
      setVal(pw, ${JSON.stringify(match.password)});
      return 'ok';
    })()`;
    try {
      const r = await t.view.executeJavaScript(js);
      toast(r === 'ok' ? `已填充：${match.username}` : '页面上没有找到密码输入框');
    } catch (e) { toast('填充失败：' + (e.message || e)); }
  }

  ctl.activeTab = activeTab;
  ctl.closeFind = closeFind;
  ctl.closeTabFn = closeTab;
  ctl.openTabRaw = openTab;
  ctl.handleHomeAction = handleHomeAction;
  ctl.bookmarkCurrent = bookmarkCurrent;
  ctl.openBookmarkManager = openBookmarkManager;
  ctl.openPasswordManager = openPasswordManager;
  ctl.fillPassword = fillPassword;

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
  // 测试调试面（契约测试用，不参与运行时逻辑）
  _forTests: { instances, HOME },

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
      <button class="rb-btn" data-command="browser.manageBookmarks"><i class="ico">📁</i><span>收藏管理</span></button>
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
      { id: 'browser.manageBookmarks', title: '收藏管理', icon: '📁', group: '浏览器',
        when: "module=='browser'", run: () => current?.openBookmarkManager() },
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
      { id: 'browser.passwordManager', title: '密码管理器', group: '浏览器', when: "module=='browser'",
        run: () => current?.openPasswordManager() },
      { id: 'browser.fillPassword', title: '填充账号密码', group: '浏览器', when: "module=='browser'",
        run: () => current?.fillPassword() },
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
        { command: 'browser.fillPassword', title: '填充账号密码', group: '2_page' },
        { command: 'browser.passwordManager', title: '密码管理器', group: '3_util' },
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
