// renderer/modules/browser/index.js —— 隐私浏览器（第 16 契约模块）
// webview 多标签 + 地址栏三模式 + 历史收藏 + 页内查找 + 隐私隔离 + SearXNG 内核（主进程代理）
// 隐私红线：搜索页不显示任何源站信息；结果链接直达目标站；跨域 Referer 由主进程剥离
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { menus } from '../../core/menu-service.js';
import { toast, modal, inputModal } from '../../shell/shell.js';
import { snapshotScript } from './clipper.js';
import { createClipRuntime } from './clip-runtime.js';
import { createHarvestRuntime } from './harvest-runtime.js';
import { captureWorkspaceEvent } from '../../lib/workspace-events.js';

const MODULE = 'browser';
const instances = new Map();
let current = null;
let tabSeq = 1;

const HOME = 'mazz://home';
const isElectron = () => !!window.mazz?.isElectron;
const nextViewId = () => {
  // BrowserViews 由主进程跨所有工作台窗口统一持有；renderer 内自增序号会让主窗/分窗都从 bt-1 起步，
  // 后创建的分窗因此把主窗同名 View 当 replaced 销毁。UUID 是协议身份，不再把进程内序号冒充全局 ID。
  const uuid = globalThis.crypto?.randomUUID?.();
  return `bt-${uuid || `${Date.now().toString(36)}-${tabSeq++}-${Math.random().toString(36).slice(2, 10)}`}`;
};

// W76：Context Collection 只读取当前 URL/标题，不复制 WebContents 或页面正文。
// 同一 canonical URL 在 Context Graph 中仍是同一 Node，各 Placement 可有自己的别名/备注。
window.MazzBrowserContextSubject = () => {
  const tab = current?.activeTab?.();
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) return null;
  return { kind: 'url', url: tab.url, label: tab.title || tab.url };
};

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
      <button class="br-nav" data-a="find" title="页内查找（Ctrl+F）">${iconHtml('🔍')}</button>
      <button class="br-nav" data-a="bookmark" title="收藏当前页（Ctrl+Shift+B）">${iconHtml('⭐')}</button>
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
  function openTab(url = HOME, { background = false, partition = 'persist:mazz-browser' } = {}) {
    const id = nextViewId();
    const viewWrap = document.createElement('div');
    viewWrap.className = 'br-view-wrap';
    viewWrap.dataset.tabId = id;
    viewWrap.dataset.partition = partition;
    const tab = { id, view: null, viewId: null, host: null, partition, title: '新标签页', url: HOME, el: null, canBack: false, canFwd: false };
    if (isElectron()) {
      // WebContentsView 时代：视图由主进程持有一等公民，宿主 div 只量尺寸摆位置——
      // 会话分离沿用：隐私浏览 persist:mazz-browser（反追踪）；投稿会话 persist:mazz-author（固定登录态）
      tab.viewId = id;
      tab.host = document.createElement('div');
      tab.host.className = 'br-view-host';
      viewWrap.appendChild(tab.host);
      // 创建就绪闸：renderHome/导航必等视图落地（竞态实锤——bv:js 抢在 bv:create 前到达=主页永远空白）
      tab.viewReady = window.mazz.invoke('bv:create', { tabId: id, partition, url: 'about:blank' }).catch(() => {});
    } else {
      tab.view = document.createElement('iframe');
      tab.view.className = 'br-webview';
      tab.view.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox');
      viewWrap.appendChild(tab.view);
      tab.host = tab.view;
      bindIframeView(tab);
    }
    ctl.views.appendChild(viewWrap);
    ctl.tabs.push(tab);
    renderTabs();
    if (!background) activate(id);
    tab.navigationReady = navigate(tab, url);
    return tab;
  }

  function activate(id) {
    const tab = ctl.tabs.find(t => t.id === id);
    if (!tab) return;
    ctl.activeId = id;
    ctl.tabs.forEach(t => t.host.parentElement.classList.toggle('on', t.id === id));
    ctl.addrEl.value = tab.url === HOME ? '' : tab.url;
    renderTabs();
    syncBounds();
    // 切回即聚焦唤醒输入（webview 时代要靠 focus 赌运气，视图时代主进程一句话的事）
    if (isElectron()) window.mazz.invoke('bv:focus', { tabId: tab.viewId }).catch(() => {});
    else try { tab.view.focus?.(); } catch {}
  }

  function closeTab(id) {
    const i = ctl.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const tab = ctl.tabs[i];
    if (isElectron() && tab.viewId) window.mazz.invoke('bv:destroy', { tabId: tab.viewId }).catch(() => {});
    tab.host.remove();
    tab.el?.remove();
    ctl.tabs.splice(i, 1);
    if (ctl.activeId === id) {
      const next = ctl.tabs[i] || ctl.tabs[i - 1];
      if (next) activate(next.id);
      else { ctl.activeId = null; renderTabs(); syncBounds(); }
    } else { renderTabs(); syncBounds(); }
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
    return queueNav(tab, url);
  }

  /** 导航统一入口：串行化队列（消灭竞跑）
   *  关键纪律：队首先 catch 一次——任何一次导航失败都不许污染队列，
   *  否则链式拒绝会让这个标签从此点哪都没反应（"冻住"的病根）。
   *  视图时代不再需要 dom-ready 赌注：视图在主进程创建即随时可 loadURL */
  function queueNav(tab, url) {
    tab.navQueue = (tab.navQueue || Promise.resolve()).catch(() => {});
    tab.navQueue = tab.navQueue.then(async () => {
      if (!tab.host?.isConnected) return; // 标签已关/宿主已摘，静默丢弃
      if (isElectron() && tab.viewReady) await tab.viewReady; // 视图落地才许写主页/导航（竞态闸）
      if (url === HOME) {
        tab.url = HOME; // 逻辑 URL 保持 mazz://home
        tab.title = '主页';
        renderTabs();
        if (ctl.activeId === tab.id) ctl.addrEl.value = '';
        // 自定义主页：直接加载用户设定的网址（逻辑身份仍是主页）
        const custom = (ctl.customHome || '').trim();
        if (custom) {
          tab.homeLoaded = false;
          if (isElectron()) await window.mazz.invoke('bv:nav', { tabId: tab.viewId, action: 'load', url: custom }).catch(() => {});
          else tab.view.src = custom;
          return;
        }
        // document.write 也是一次真实文档提交，必须并入导航队列等待完成。
        // 旧实现只发 IPC 不 await：下一条真网址先加载完，迟到的主页写入又把它覆盖，
        // JS Window 属性却仍残留，形成“状态探针正常、画面是主页/白屏”的假象。
        await renderHome(tab);
        return;
      }
      try {
        tab._errorPage = false;
        if (isElectron()) {
          if (!tab.host?.isConnected) return;
          await window.mazz.invoke('bv:nav', { tabId: tab.viewId, action: 'load', url }).catch(() => {});
        } else {
          tab.view.src = url;
        }
      } catch (e) { toast('打开失败：' + e.message); }
    }).catch(() => {}); // 双保险：链尾再兜一次，队列永远是 resolved
    return tab.navQueue;
  }

  /** Ctrl+滚轮缩放（注入客页 → console 通道回传） */
  function injectZoom(tab) {
    if (!isElectron() || !tab?.viewId || !tab.host?.isConnected) return;
    window.mazz.invoke('bv:js', {
      tabId: tab.viewId,
      code: `window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) { e.preventDefault(); console.log('MAZZ_ZOOM:' + e.deltaY); }
      }, { passive: false });`,
    }).catch(() => {});
  }

  // ==================== 摆位引擎（宿主矩形 → 主进程视图）+ 遮挡隐身 ====================
  /** 原生视图永远压在 DOM 之上：谁可见谁多大，由这里统一发令 */
  function syncBounds() {
    // 幽灵三钩出口：activate/deactivate 生命周期的显隐发令同口（挂 ctl 供 def 钩子直调）
    if (!isElectron()) return;
    const fs = ctl._htmlFs && ctl._htmlFs === ctl.activeId; // HTML5 全屏态：视图铺满主窗
    for (const tab of ctl.tabs) {
      const on = tab.id === ctl.activeId && !ctl._dragCloak && tab.host?.isConnected; // 全局弹层遮挡由 VisualCompositionRuntime 在主进程按宿主仲裁；这里只保留拖拽即时闸
      if (!on) { window.mazz.invoke('bv:bounds', { tabId: tab.viewId, visible: false }).catch(() => {}); continue; }
      let r;
      if (fs) r = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      else { const b = tab.host.getBoundingClientRect(); r = { x: b.left, y: b.top, width: b.width, height: b.height }; }
      window.mazz.invoke('bv:bounds', { tabId: tab.viewId, rect: r, visible: r.width > 2 && r.height > 2 }).catch(() => {});
    }
  }
  ctl.__sync = syncBounds; // 生命周期三钩发令口（activate 必显/deactivate 全场景隐统一走此）
  ctl.recompose = async (reason = 'renderer-layout') => {
    syncBounds();
    if (!isElectron()) return true;
    const active = activeTab();
    if (!active?.viewId) return false;
    return window.mazz.invoke('bv:recompose', { tabId: active.viewId, reason }).catch(() => false);
  };
  if (isElectron()) {
    // 布局跟随：容器尺寸/窗体尺寸变化即重摆
    try { new ResizeObserver(() => syncBounds()).observe(ctl.views); } catch {}
    window.addEventListener('resize', syncBounds);
  }

  /** 主页 HTML（主题变量化：明亮/黑暗/跟随系统 + ⚙ 设置面板） */
  function buildHomeHtml() {
    const recent = ctl.history.slice(0, 10);
    const theme = ctl.homeTheme || 'system';
    // 收藏按文件夹分组
    const folderBlocks = ctl.folders.map(f => {
      const items = ctl.bookmarks.filter(b => (b.folder || 'default') === f.id).slice(0, 8);
      if (!items.length && ctl.folders.length <= 1) return '';
      return `<h2>${iconHtml('📁')} ${escapeHtml(f.name)}${items.length ? '' : ' <small>（空）</small>'}</h2><div class="grid">${
        items.map(b => `<span class="card-wrap"><a class="card" href="${escapeAttr(b.url)}" title="${escapeAttr(b.url)}">${escapeHtml(b.name || b.title)}</a><span class="card-acts"><i data-act="rename" data-url="${escapeAttr(b.url)}">✎</i><i data-act="del-bm" data-url="${escapeAttr(b.url)}">✕</i></span></span>`).join('')
      }</div>`;
    }).join('');
    // 主题变量取自 Mazz 当前主题（跟随软件主题，与播放器同源），而非写死色板
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    const mazzVars = `--bg:${v('--bg', '#f7f6f3')};--fg:${v('--fg', '#2c2c2a')};--mut:${v('--fg-dim', '#83817a')};--faint:${v('--fg-dim', '#a3a19a')};--card:${v('--bg-soft', '#fff')};--bd:${v('--border', '#e0ded8')};--bd2:${v('--bg-hover', '#ecebe6')};--acc:${v('--accent', '#4f46e5')};--sh:rgba(0,0,0,.08)`;
    const lightVars = `--bg:#f7f6f3;--fg:#2c2c2a;--mut:#83817a;--faint:#a3a19a;--card:#fff;--bd:#e0ded8;--bd2:#ecebe6;--acc:#4f46e5;--sh:rgba(0,0,0,.05)`;
    const darkVars = `--bg:#1b1b1a;--fg:#e8e6e1;--mut:#9b9890;--faint:#7d7b74;--card:#262625;--bd:#3d3c39;--bd2:#333231;--acc:#818cf8;--sh:rgba(0,0,0,.4)`;
    const themeCss = theme === 'dark' ? `:root{${darkVars}}`
      : theme === 'light' ? `:root{${lightVars}}`
      : `:root{${mazzVars}}`; // 「跟随系统」= 跟随 Mazz 软件主题（v33 反馈：与播放器同一套变量）
    const tBtn = (v, label) => `<button class="tbtn${theme === v ? ' on' : ''}" data-act="theme" data-url="${v}">${label}</button>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${themeCss}
      /* SVG 图标钉死：webview 独立文档里没有 .mz-ico 尺寸规则，无 width/height 的 SVG 按默认 300×150
         甚至拉伸失控——收藏夹文件夹图案全屏巨大的总根（用户实图实锤） */
      .mz-ico{width:1.05em;height:1.05em;vertical-align:-0.15em;flex:none}
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
        ${tBtn('light', iconHtml('☀') + ' 明亮')}${tBtn('dark', iconHtml('🌙') + ' 黑暗')}${tBtn('system', iconHtml('◐') + ' 跟随系统')}
        <button class="tbtn" data-act="gear" title="主页设置">${iconHtml('⚙')}</button>
      </div>
      <div class="hset" id="hset">
        <div class="lbl">自定义主页</div>
        <input id="home-url" placeholder="留空则使用内置主页" value="${escapeAttr(ctl.customHome || '')}" spellcheck="false" />
        <div class="row">
          <button data-act="set-home">设为主页</button>
          <button class="ghost" data-act="reset-home">恢复内置</button>
        </div>
        <div class="lbl" style="margin-top:12px">账号密码</div>
        <div class="row"><button data-act="pw">${iconHtml('🔑')} 打开密码管理器</button></div>
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

  // Mazz 主题变化 → 重建主页（跟随软件主题）
  if (!ctl._themeWatch) {
    ctl._themeWatch = new MutationObserver(() => {
      for (const t of ctl.tabs || []) if (t.url === HOME) renderHome(t);
    });
    ctl._themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  async function renderHome(tab) {
    const html = buildHomeHtml();
    if (!isElectron()) {
      tab.view.srcdoc = html; // iframe 预览路径（视图时代 tab.view 为 null——裸赋必炸，主页渲染全灭的总根）
      // iframe/srcdoc：内联脚本被页面 CSP 拦截——父页直接绑定（srcdoc 与父页同源）
      tab.view.addEventListener('load', () => {
        const doc = tab.view.contentDocument;
        if (!doc) return;
        doc.getElementById('sf')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const v = doc.getElementById('q')?.value.trim();
          if (v) window.postMessage({ mazzSearch: v }, '*');
        });
        doc.addEventListener('click', (e) => {
          const t = e.target.closest('[data-act]');
          if (!t) return;
          e.preventDefault(); e.stopPropagation();
          const act = t.dataset.act;
          let url = t.dataset.url || '';
          if (act === 'gear') { doc.getElementById('hset')?.classList.toggle('open'); return; }
          if (act === 'set-home') url = doc.getElementById('home-url')?.value.trim() || '';
          window.postMessage({ mazzAct: act, url }, '*');
        }, true);
        doc.getElementById('home-url')?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); doc.querySelector('[data-act=set-home]')?.click(); }
        });
      }, { once: true });
    }
    if (isElectron() && tab.viewId) {
      // 视图时代：原地重写文档恒成立（about:blank 随时可写，零导航零 data: 历史污染）
      tab.homeLoaded = true;
      return window.mazz.invoke('bv:js', {
        tabId: tab.viewId,
        code: `document.open();document.write(${JSON.stringify(html)});document.close();`,
      }).catch(() => {});
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
    if (isElectron()) {
      // 错误页写进失败文档本体（URL 保持失败地址，返回导航天然正常——不进 data: 不污染历史）
      tab._errorPage = true;
      window.mazz.invoke('bv:js', {
        tabId: tab.viewId,
        code: `document.open();document.write(${JSON.stringify(html)});document.close();`,
      }).catch(() => {});
    } else {
      tab.view.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }
  }

  function friendlyError(desc, url) {
    if (/CERT|证书/i.test(desc)) return '证书验证失败——若确认站点可信，可在弹出的对话框中选择「信任此站点」。';
    if (/RESET|CLOSED|断开/i.test(desc)) return '连接被对方重置——该站点可能被当前网络环境拦截。';
    if (/TIMED_OUT|超时/i.test(desc)) return '连接超时——站点无响应或网络不通。';
    if (/FAILED|失败/i.test(desc)) return '网络无法到达该站点——可能被当前网络环境拦截（代理/防火墙/地域限制）。';
    if (/NAME|DNS|解析/i.test(desc)) return '域名解析失败——请检查网址拼写或当前 DNS 设置。';
    return '可稍后重试，或换个网址。';
  }

  // ==================== 视图事件（WebContentsView 时代：主进程转发 → 本路由器） ====================
  /** 客进程崩溃复活：毁旧建新（Min crashed 处置同款干脆），保留 partition 与逻辑 URL */
  async function reviveView(tab, reason) {
    if (!isElectron() || tab._reviving) return;
    tab._reviving = true;
    const cur = tab.url && tab.url !== HOME ? tab.url : null;
    toast('页面进程已重启' + (reason ? `（${reason}）` : ''));
    try { await window.mazz.invoke('bv:destroy', { tabId: tab.viewId }); } catch {}
    try { await window.mazz.invoke('bv:create', { tabId: tab.viewId, partition: tab.partition, url: 'about:blank' }); } catch {}
    tab._reviving = false;
    syncBounds();
    queueNav(tab, cur || HOME);
  }

  function handleBvEvent(tab, type, d) {
    switch (type) {
      case 'render-process-gone':
        if (d.reason === 'clean-exit') return;
        reviveView(tab, d.reason);
        return;
      case 'unresponsive':
        reviveView(tab, '无响应');
        return;
      case 'page-title-updated':
        if (isInternalUrl(tab.url)) return; // 内部页标题由导航逻辑管理（主页保持「主页」）
        tab.title = d.title || tab.url;
        renderTabs();
        return;
      case 'did-navigate': {
        // 内部页面（主页/about:blank 等）不覆盖标签逻辑 URL，也不进历史
        if (isInternalUrl(d.url)) return;
        // 自定义主页落地：保持主页逻辑身份，不进历史
        if (tab.url === HOME && ctl.customHome && normUrl(d.url) === normUrl(ctl.customHome)) {
          tab.homeLoaded = false;
          return;
        }
        // 被动导航 = 落地 URL 与目标 URL 不符（重定向/页面自跳）
        const passive = normUrl(d.url) !== normUrl(tab.url);
        tab.url = d.url;
        tab.homeLoaded = false;
        tab._errorPage = false; // 真导航落地即离开错误页
        if (ctl.activeId === tab.id) ctl.addrEl.value = d.url;
        pushHistory(d.url, tab.title, passive);
        window.MazzHost?.notifyChange(container);
        return;
      }
      case 'did-navigate-in-page':
        if (d.isMainFrame && !isInternalUrl(d.url)) {
          tab.url = d.url;
          tab._errorPage = false;
          if (ctl.activeId === tab.id) ctl.addrEl.value = d.url;
        }
        return;
      case 'console-message': {
        const msg = d.message || '';
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
          window.mazz.invoke('bv:zoom', { tabId: tab.viewId, factor: next }).catch(() => {});
          toast(`缩放 ${Math.round(next * 100)}%`);
        }
        if (msg === 'MAZZ_RETRY:1') queueNav(tab, tab.url);
        return;
      }
      case 'did-fail-load':
        if (d.isMainFrame && d.errorCode !== -3) {
          tab.title = '加载失败';
          renderTabs();
          renderLoadError(tab, { errorDescription: d.errorDescription || String(d.errorCode) });
        }
        return;
      case 'found-in-page': {
        const r = d.result || {};
        root.querySelector('.br-find-count').textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '无结果';
        return;
      }
      case 'ctx-action': {
        // 原生右键菜单动作回派（白屏根治：右键改主进程 popup 独立合成层，动作经此回 MazzCommands 零重写）
        contextKeys.set('browserMediaType', d.params?.mediaType || 'none');
        contextKeys.set('browserHasSelection', !!(d.params?.selectionText || '').trim());
        contextKeys.set('browserLinkUrl', d.params?.linkURL || '');
        ctl.contextParams = d.params || {};
        if (d.command) window.MazzCommands?.execute(d.command);
        return;
      }
      case 'open-url':
        if (d.url) openTab(d.url);
        return;
      case 'dom-ready':
      case 'did-stop-loading':
        injectZoom(tab);
        return;
      case 'key-reload': // F5/Ctrl+R 网页内按下（主进程拦截转发）——走 reloadTab 汇聚，主页重塞不白屏
        reloadTab(tab);
        return;
      case 'enter-html-full-screen':
        // HTML5 全屏：视图铺满主窗（原生表面压一切 DOM，真全屏零技巧）
        ctl._htmlFs = tab.viewId;
        syncBounds();
        return;
      case 'leave-html-full-screen':
        ctl._htmlFs = null;
        syncBounds();
        return;
    }
  }
  // 事件路由登记（每个模块实例一次）
  if (isElectron() && !ctl._bvWired) {
    ctl._bvWired = true;
    window.mazz.on('bv:event', ({ tabId, type, data }) => {
      const tab = ctl.tabs.find(t => t.viewId === tabId);
      if (tab) handleBvEvent(tab, type, data || {});
    });
  }

  /** iframe 预览路径（非 Electron：网页预览/契约环境） */
  function bindIframeView(tab) {
    const v = tab.view;
    // 契约/预览同体：DOM 事件即视图事件（导航系直进路由器，行为逻辑一处真源）
    v.addEventListener('did-navigate', (e) => handleBvEvent(tab, 'did-navigate', { url: e.url }));
    v.addEventListener('did-navigate-in-page', (e) => handleBvEvent(tab, 'did-navigate-in-page', { url: e.url, isMainFrame: e.isMainFrame !== false }));
    v.addEventListener('page-title-updated', (e) => handleBvEvent(tab, 'page-title-updated', { title: e.title }));
    // 主页搜索框：postMessage 通道（iframe 预览专用）
    window.addEventListener('message', (e) => {
      if (e.data?.mazzSearch) {
        const input = normalizeInput(e.data.mazzSearch);
        if (input?.type === 'url') navigate(tab, input.value);
        else if (input?.value) doSearch(input.value);
        return;
      }
      if (e.data?.mazzAct) handleHomeAction(e.data.mazzAct, e.data.url);
    });
    v.addEventListener('focus', () => { current = ctl; contextKeys.set('module', MODULE); });
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
    if (!passive) {
      let host = '';
      try { host = new URL(url).hostname; } catch {}
      captureWorkspaceEvent({ sourceModule: 'browser', action: 'view', objectRefs: [`url:${pageKey(url)}`], contextRefs: ['context:browser-history'], outcome: 'success', summary: `查看网页 · ${host || '网页'}` });
    }
  }

  /** 收藏当前页（命名 + 选文件夹 + 新建文件夹） */
  function bookmarkCurrent() {
    const t = activeTab();
    if (!t || isInternalUrl(t.url)) return;
    // W54 B3：全原生独立子窗格（DOM modal 浏览器前台必被压——W43 漏网收编）
    if (isElectron()) { window.mazz.invoke('panel:open', { kind: 'bookmark' }).catch(() => {}); return; }
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

  /** 收藏管理（W43 并行进程：原生子窗独立合成，与 WebContentsView 永不相见——白屏病根除；渲染层 modal 仅网页预览兜底） */
  function openBookmarkManager() {
    if (isElectron()) { window.mazz.invoke('panel:open', { kind: 'favmgr' }).catch(() => {}); return; }
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
    syncBounds(); // 面板开合改变可视区宽——视图即时重摆
  }
  function closePanel() {
    ctl.panelOpen = false;
    ctl.root.classList.remove('panel-open');
    syncBounds();
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
    findInActive('');
  }
  function findInActive(text, opts) {
    const t = activeTab();
    if (!t) return;
    if (isElectron()) window.mazz.invoke('bv:find', { tabId: t.viewId, text, opts }).catch(() => {});
    else if (text) t?.view.findInPage?.(text, opts);
    else t?.view.stopFindInPage?.('clearSelection');
  }
  ctl.findInput.addEventListener('input', () => findInActive(ctl.findInput.value));
  ctl.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFind();
    if (e.key === 'Enter' && ctl.findInput.value) findInActive(ctl.findInput.value, { findNext: true, forward: !e.shiftKey });
  });
  findbar.querySelector('[data-f=next]').addEventListener('click', () => findInActive(ctl.findInput.value, { findNext: true, forward: true }));
  findbar.querySelector('[data-f=prev]').addEventListener('click', () => findInActive(ctl.findInput.value, { findNext: true, forward: false }));
  findbar.querySelector('[data-f=close]').addEventListener('click', closeFind);

  // ==================== 工具栏按钮 ====================
  /** 历史前进/后退（视图时代：goBack 不再有 guest 代理挂起——结构性冻结已绝）
   *  错误页零跳链天然成立：错误页写进失败文档本体（URL=失败地址），历史里当前条目即失败页，
   *  回退 -1 自然落在失败前的好页——Min 要 -2 跳链是因为它的错误页另起内部条目，我们不产那个累赘。
   *  余味一件套：探活看门狗减重版——导航 3s 后客页无应答即复活（兜底保险，不是救命稻草） */
  async function historyNav(tab, dir) {
    if (!tab?.host?.isConnected) return;
    if (!isElectron()) {
      try { dir === 'back' ? tab.view.contentWindow.history.back() : tab.view.contentWindow.history.forward(); } catch {}
      return;
    }
    await window.mazz.invoke('bv:nav', { tabId: tab.viewId, action: dir === 'back' ? 'back' : 'forward' }).catch(() => {});
    clearTimeout(tab._navDog);
    tab._navDog = setTimeout(async () => {
      if (!tab.host?.isConnected) return;
      const r = await window.mazz.invoke('bv:js', { tabId: tab.viewId, code: '1' }).catch(() => null);
      if (r && typeof r === 'object' && r.__err) reviveView(tab, '导航探活失败');
    }, 3000);
  }
  root.querySelector('[data-a=back]').addEventListener('click', () => historyNav(activeTab(), 'back'));
  root.querySelector('[data-a=forward]').addEventListener('click', () => historyNav(activeTab(), 'forward'));
  /** 刷新唯一汇聚（工具栏钮 / Ctrl+R 命令 / 右键菜单三路同口）：
   *  主页是 document.write 原地重写的 about:blank——wc.reload() 重载的是空文档=白屏（真机实锤）；
   *  逻辑 URL 为主页时一律走 queueNav 重塞（自带竞态闸/自定义主页分支/主题重建），真网页才 wc.reload() */
  function reloadTab(t) {
    if (!t) return;
    if (t.url === HOME) { queueNav(t, HOME); return; }
    if (isElectron()) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'reload' }).catch(() => {});
    else if (t.view?.isConnected && t.view.contentWindow) { try { t.view.contentWindow.location.reload(); } catch { navigate(t, t.url); } }
  }
  root.querySelector('[data-a=reload]').addEventListener('click', () => reloadTab(activeTab()));
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
    // W43 并行面板回推：数据已变→装载+主页即刷；动作→开网址/指定条目填充
    window.mazz.on('panel:changed', (pl) => {
      if (pl?.kind !== 'favmgr') return;
      loadStore().then(() => { for (const t of ctl.tabs || []) if (t.url === HOME) renderHome(t); });
    });
    async function handleHarvestPanelAction(pl) {
      const push = payload => window.mazz.invoke('panel:push', { kind: 'harvest', payload }).catch(() => {});
      const refreshPromotionManagement = async message => {
        const management = await ctl.harvester.promotionManagement();
        push({ type: 'harvestPromotionManagement', management, message });
        return management;
      };
      try {
        if (pl.type === 'harvestExport') {
          const result = await ctl.harvester.exportSelection(pl);
          push({ type: 'harvestResult', message: `已导出：${result.path.split('/').pop()}` });
          toast(`AI 对话已导出：${result.path.split('/').pop()}`);
        } else if (pl.type === 'harvestStyle') {
          const result = await ctl.harvester.feedStyle(pl);
          push({ type: 'harvestResult', message: `已加入文风素材：${result.entry.label}` });
          toast(`已加入文风素材（${result.count} 条）`);
        } else if (pl.type === 'harvestMindmap') {
          await ctl.harvester.distillSelection(pl);
        } else if (pl.type === 'harvestPromote') {
          const result = await ctl.harvester.promoteSelection(pl);
          push({ type: 'harvestResult', clearSupersedes: true, message: '已升格为本地资产；身份、来源与撤销链已登记。' });
          toast('AI 对话已升格为本地资产');
        } else if (pl.type === 'harvestReviewPromotion') {
          const result = await ctl.harvester.reviewPromotionCandidate(pl);
          const approved = result.action === 'approve';
          push({
            type: 'harvestResult', closeReview: true, clearSupersedes: true,
            message: approved
              ? '结构化候选已批准入库；来源与人工决定已登记。'
              : '结构化候选已驳回；审阅证据已保留，未进入有效 Promotion。',
          });
          toast(approved ? '结构化候选已批准入库' : '结构化候选已驳回');
        } else if (pl.type === 'harvestPromotionList') {
          await refreshPromotionManagement('升格记录已刷新。');
        } else if (pl.type === 'harvestPromotionRevoke') {
          await ctl.harvester.revokePromotion(pl);
          await refreshPromotionManagement('所选升格记录已撤销；历史决定仍可追溯。');
          toast('升格记录已撤销');
        } else if (pl.type === 'harvestPromotionProject') {
          await ctl.harvester.manageEvidenceProjection({ ...pl, action: 'project' });
          await refreshPromotionManagement('已生成去正文、去路径的本地证据投影；尚未获得发布许可。');
          toast('本地证据投影已生成');
        } else if (pl.type === 'harvestProjectionWithdraw') {
          await ctl.harvester.manageEvidenceProjection({ ...pl, action: 'withdraw' });
          await refreshPromotionManagement('所选证据投影已撤回；历史记录仍可追溯。');
          toast('证据投影已撤回');
        }
      } catch (error) {
        const message = error?.message || String(error);
        push({
          type: 'harvestError', message,
          preserveSelection: pl.type === 'harvestReviewPromotion' || /^harvest(?:Promotion|Projection)/.test(pl.type || ''),
        });
        toast('AI 对话整理失败：' + message);
      }
    }
    window.mazz.on('panel:action', (pl) => {
      if (pl?.type === 'openUrl' && pl.url) openTab(pl.url);
      else if (pl?.type === 'fillPassword' && pl.id) fillPassword(pl.id);
      // 每个浏览器实例都订阅同一主窗信道；只允许当前实例响应一次，否则开过 N 个浏览器就会启动 N 份批队列。
      else if (pl?.type === 'clipBookmarks' && ctl === current) window.MazzCommands?.execute('browser.clipBookmarks');
      else if (/^harvest(?:Export|Style|Mindmap|Promote|ReviewPromotion)$/.test(pl?.type || '') && ctl === current) handleHarvestPanelAction(pl);
      else if (/^harvest(?:PromotionList|PromotionRevoke|PromotionProject|ProjectionWithdraw)$/.test(pl?.type || '') && ctl === current) handleHarvestPanelAction(pl);
      // W54 B3 收藏当前页桥（panel 子窗格：预填+保存，ctl 真相源）
      else if (pl?.type === 'bookmarkQuery') {
        const t = activeTab();
        window.mazz.invoke('panel:push', { kind: 'bookmark', payload: { type: 'bookmark', title: t?.title || '', url: t?.url || '', folders: ctl.folders || [] } }).catch(() => {});
      } else if (pl?.type === 'bookmarkSave') {
        let folderId = pl.folderId;
        if (folderId === '__new' && pl.newFolderName) {
          folderId = 'f' + Date.now();
          ctl.folders.push({ id: folderId, name: pl.newFolderName });
          saveFolders();
        }
        const t = activeTab();
        if (t && !isInternalUrl(t.url)) {
          const name = pl.name || t.title;
          const key = normUrl(t.url);
          ctl.bookmarks = ctl.bookmarks.filter(b => normUrl(b.url) !== key);
          ctl.bookmarks.unshift({ url: t.url, title: t.title, name, folder: folderId || 'default', at: Date.now() });
          saveBookmarks();
          window.mazz.invoke('panel:changed', { kind: 'favmgr' }).catch(() => {});
          toast(`已收藏到「${ctl.folders.find(f => f.id === folderId)?.name || '默认收藏夹'}」`);
        }
      }
    });
    // W47 密码智能记录：页面提交捕获 → 询问保存（Edge 同款；每站每人每会话只问一趟，绝不静默落库）
    window.mazz.on('bv:event', ({ type, data }) => {
      // W48 修改识别：密码已更改 → 询问更新保存（Edge 同款）
      if (type === 'pw-changed' && data?.id) {
        const ck = 'pwOffered|chg|' + data.id;
        if (ctl[ck]) return;
        ctl[ck] = true;
        toast(`${data.site}：密码已更改——更新保存的密码？`, [
          { label: '更新', fn: async () => {
              await window.mazz.invoke('pw:save', { entry: { id: data.id, site: data.site, username: data.username, password: data.password } });
              window.mazz.invoke('panel:changed', { kind: 'pwmgr' }).catch(() => {});
              toast('已更新保存的密码');
            } },
          { label: '暂不', ghost: true, fn: () => {} },
        ], 12000);
        return;
      }
      if (type !== 'pw-capture' || !data?.site) return;
      const key = 'pwOffered|' + data.site + '|' + (data.username || '');
      if (ctl[key]) return;
      ctl[key] = true;
      toast(`${data.site}：保存账号「${data.username || '（空）'}」的密码吗？`, [
        { label: '保存', fn: async () => {
            await window.mazz.invoke('pw:save', { entry: { site: data.site, username: data.username || '', password: data.password } });
            window.mazz.invoke('panel:changed', { kind: 'pwmgr' }).catch(() => {});
            toast('已保存到密码管理器');
          } },
        { label: '暂不', ghost: true, fn: () => {} },
      ], 12000);
    });
  }

  // 键盘（模块级）：Ctrl+T 新标签 / Ctrl+L 地址栏 / Ctrl+W 关标签
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); openTab(HOME); }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); ctl.addrEl.focus(); }
  });
  root.tabIndex = 0;

  // ==================== 暴露给命令的方法 ====================
  ctl.openUrl = (url) => navigate(activeTab(), url);
  ctl.openTab = (url) => openTab(url || HOME); // 真新建页签（newTab 命令此前错走 openUrl=当前签导航，E2E 实抓）
  ctl.search = (q) => doSearch(q);
  ctl.getSelection = async () => {
    const t = activeTab();
    if (!t || !isElectron()) return '';
    const r = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: 'window.getSelection().toString()' }).catch(() => null);
    return (r && typeof r === 'object' && r.__err) ? '' : (r ?? '');
  };
  ctl.getPageSnapshot = async () => {
    const t = activeTab();
    if (!t || !isElectron()) return null;
    const r = await window.mazz.invoke('bv:js', { tabId: t.viewId, code: snapshotScript(t.url) }).catch(() => null);
    return (r && typeof r === 'object' && r.__err) ? null : r;
  };
  ctl.getPageText = ctl.getPageSnapshot; // 旧桥兼容：返回值只增 images/adapter，不破坏调用方
  /** 测试口：在指定（或活动）视图客页执行 JS（E2E 探查唯一通道——webview 标签已死） */
  ctl.execJs = async (tabId, code) => {
    const id = tabId || activeTab()?.viewId;
    if (!id || !isElectron()) return null;
    return window.mazz.invoke('bv:js', { tabId: id, code }).catch(() => null);
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
    if (isElectron()) { window.mazz.invoke('panel:open', { kind: 'pwmgr' }).catch(() => {}); return; } // W43 并行子窗
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
  async function fillPassword(pwId = null) {
    const t = activeTab();
    if (!t || isInternalUrl(t.url)) { toast('当前页面无法填充'); return; }
    if (!isElectron()) { toast('填充功能仅在桌面端可用'); return; }
    const list = (await window.mazz.invoke('pw:list').catch(() => [])) || [];
    if (!list.length) { toast('密码库为空——先打开密码管理器添加'); return; }
    let host = '';
    try { host = new URL(t.url).hostname.toLowerCase(); } catch {}
    const match = (pwId && list.find(e => e.id === pwId)) || list.find(e => {
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
  ctl.activateTabRaw = activate;
  ctl.handleHomeAction = handleHomeAction;
  ctl.bookmarkCurrent = bookmarkCurrent;
  ctl.openBookmarkManager = openBookmarkManager;
  ctl.openPasswordManager = openPasswordManager;
  ctl.fillPassword = fillPassword;
  ctl.reloadTab = reloadTab; // 命令注册在模块顶层够不着 createBrowser 内部函数——实例方法出口（ReferenceError 实锤平反）
  ctl.clipper = createClipRuntime({ ctl, toast });
  ctl.harvester = createHarvestRuntime({ ctl, toast });

  // 初始：恢复内容会在 create() 返回后的同一任务里设置 _restoreRequested；Store 完成前不得擅开 HOME，
  // 否则分窗交接会先画一个临时主页，再拆掉重建，形成白闪并与真实恢复竞跑。
  ctl._storeReady = loadStore().then(() => {
    if (!ctl._restoreRequested && !ctl.tabs.length) return openTab(HOME);
    return null;
  });
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
    // W58c 根治：create 必须返回 ctl 本体（code 模块 W58 同款病——返回 { container } 让 inst.state 与真 ctl 分家，
    // pane:tabMoved 监听器拿 { container } 会令 __sync/recompose 成为空调，分屏后的原生 Surface 无法按新矩形重组）
    return ctl;
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeBrowserCtl = ctl; // 出站桥等外部调用入口（投稿会话拉起）
    contextKeys.set('module', MODULE);
    // 幽灵三钩①（页签一切一炸一片实锤）：切回必显——显隐不再靠 ResizeObserver/偶发事件赏饭
    if (isElectron()) queueMicrotask(() => { try { ctl.__sync?.(); } catch {} });
  },
  deactivate(container) {
    const ctl = instances.get(container);
    if (current === ctl) current = null;
    // 幽灵三钩②：切走必隐——deactivate 不发令=视图铺成鬼（图129 播放器里长主页实锤）
    if (ctl && isElectron()) {
      for (const t of ctl.tabs) {
        if (t.viewId) window.mazz.invoke('bv:bounds', { tabId: t.viewId, visible: false }).catch(() => {});
      }
    }
  },
  /** 幽灵三钩③：外壳关签/分窗摘除必收尸（module-registry detach 唯一出口） */
  dispose(state) {
    const ctl = instances.get(state?.container);
    if (!ctl || !isElectron()) return;
    for (const t of ctl.tabs) {
      if (t.viewId) window.mazz.invoke('bv:destroy', { tabId: t.viewId }).catch(() => {});
    }
    ctl.tabs = [];
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return '';
    return JSON.stringify({
      mark: 'mazz-browser-v1',
      activeIndex: Math.max(0, ctl.tabs.findIndex(t => t.id === ctl.activeId)),
      tabs: ctl.tabs.map(t => ({ url: t.url, title: t.title, partition: t.partition })),
    });
  },
  async setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    let obj;
    try {
      obj = JSON.parse(data);
    } catch { return; }
    if (obj?.mark !== 'mazz-browser-v1' || !Array.isArray(obj.tabs) || !obj.tabs.length) return;
    ctl._restoreRequested = true;
    await ctl._storeReady;
    const destroy = [];
    for (let i = ctl.tabs.length - 1; i >= 0; i--) {
      // 恢复只操作 state.container 对应 ctl，禁止经全局 current/MazzCommands 把内容开进另一窗的 Browser。
      if (isElectron() && ctl.tabs[i].viewId) destroy.push(window.mazz.invoke('bv:destroy', { tabId: ctl.tabs[i].viewId }).catch(() => false));
      ctl.tabs[i].host?.remove(); ctl.tabs[i].el?.remove();
    }
    await Promise.all(destroy);
    ctl.tabs.length = 0;
    ctl.activeId = null;
    const activeIndex = Math.min(obj.tabs.length - 1, Math.max(0, Number(obj.activeIndex) || 0));
    const restored = obj.tabs.map((saved, index) => {
      const tab = ctl.openTabRaw(saved.url || HOME, {
        background: true,
        partition: saved.partition || 'persist:mazz-browser',
      });
      if (saved.title) tab.title = String(saved.title);
      return tab;
    });
    ctl.activateTabRaw?.(restored[activeIndex]?.id);
    await Promise.all(restored.map(tab => Promise.resolve(tab.viewReady).then(() => tab.navQueue).catch(() => {})));
    ctl.__sync?.();
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
      <button class="rb-btn" data-command="browser.bookmark"><i class="ico">${iconHtml('☆')}</i><span>收藏</span></button>
      <button class="rb-btn" data-command="browser.find"><i class="ico">${iconHtml('🔍')}</i><span>页内查找</span></button>
    </div>
    <div class="rb-group" data-label="协同">
      <button class="rb-btn" data-command="browser.clipToNote"><i class="ico">${iconHtml('✂')}</i><span>摘录到笔记</span></button>
      <button class="rb-btn" data-command="browser.pageToLibrary"><i class="ico">${iconHtml('📥')}</i><span>网页剪藏</span></button>
      <button class="rb-btn" data-command="browser.harvestAiChat"><i class="ico">☷</i><span>AI 对话整理</span></button>
      <button class="rb-btn" data-command="browser.clipBookmarks"><i class="ico">⇊</i><span>批量剪藏</span></button>
      <button class="rb-btn" data-command="browser.shareLocal"><i class="ico">⌁</i><span>局域网分享</span></button>
      <button class="rb-btn" data-command="browser.manageBookmarks"><i class="ico">${iconHtml('📁')}</i><span>收藏管理</span></button>
      <button class="rb-btn" data-command="browser.exportBookmarks"><i class="ico">${iconHtml('📑')}</i><span>导出收藏</span></button>
      <button class="rb-btn" data-command="browser.bookmarksToContexts"><i class="ico">◫</i><span>转为上下文</span></button>
    </div>
    <div class="rb-group" data-label="搜索">
      <button class="rb-btn" data-command="browser.selfcheck"><i class="ico">${iconHtml('⚡')}</i><span>实例自检</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'browser.newTab', title: '新建浏览器标签', icon: '＋', group: '浏览器',
        when: "module=='browser'", run: () => current?.openTab?.(current.home) },
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
          toast('正在剪藏正文并本地化图片…');
          try {
            const result = await current.clipper.clipCurrent();
            toast(`已剪藏：${result.stem}.md · ${result.assets} 图${result.ocr ? ' · OCR 已补正文' : ''}`);
          } catch (error) { toast('剪藏失败：' + (error?.message || error)); }
        } },
      { id: 'browser.harvestAiChat', title: 'AI 对话整理（全量采集、导出与回喂）', icon: '☷', group: '桥接',
        when: "module=='browser'", run: async () => {
          if (!current) return;
          await window.mazz.invoke('panel:open', { kind: 'harvest' });
          const push = payload => window.mazz.invoke('panel:push', { kind: 'harvest', payload }).catch(() => {});
          push({ type: 'harvestLoading', message: '正在循环滚顶并识别对话结构…' });
          try {
            const result = await current.harvester.collectCurrent();
            push({ type: 'harvestSnapshot', ...result });
          } catch (error) {
            push({ type: 'harvestError', message: error?.message || String(error) });
          }
        } },
      { id: 'browser.clipBookmarks', title: '批量剪藏全部收藏（严格 2 并发）', icon: '⇊', group: '桥接',
        when: "module=='browser'", run: async () => {
          if (!current?.bookmarks?.length) { toast('暂无收藏'); return; }
          toast(`开始批量剪藏 ${current.bookmarks.length} 个收藏（2 并发）…`);
          try {
            const result = await current.clipper.clipBookmarks();
            toast(`收藏剪藏完成：成功 ${result.ok}，失败 ${result.failed}`);
          } catch (error) { toast('批量剪藏失败：' + (error?.message || error)); }
        } },
      { id: 'browser.clipUrlList', title: '批量剪藏剪贴板 URL 清单（严格 2 并发）', group: '桥接',
        when: "module=='browser'", run: async () => {
          try {
            const result = await current?.clipper.clipClipboardList();
            toast(`URL 清单剪藏完成：成功 ${result.ok}，失败 ${result.failed}`);
          } catch (error) { toast('URL 清单剪藏失败：' + (error?.message || error)); }
        } },
      { id: 'browser.shareLocal', title: '当前网页生成 10 分钟局域网链接', icon: '⌁', group: '桥接',
        when: "module=='browser'", run: async () => {
          if (!current) return;
          try {
            const share = await current.clipper.shareCurrent();
            await window.mazz.invoke('clipboard:write', { text: share.url });
            if (isElectron()) {
              // Browser 前台的 DOM modal 会被 WebContentsView 原生层遮挡；信息确认走 OS 原生对话框。
              await window.mazz.invoke('dialog:confirm', {
                title: '局域网临时分享',
                message: '链接已复制；同一局域网内可访问，10 分钟后自动失效。',
                detail: `${share.url}\n\n到期：${new Date(share.expiresAt).toLocaleString('zh-CN')} · 不经过云端`,
                buttons: ['知道了'],
              });
            } else {
              const m = modal('局域网临时分享');
              m.body.innerHTML = `<div style="min-width:440px;max-width:620px"><p style="margin:0 0 10px">链接已复制；同一局域网内可访问，10 分钟后自动失效。</p><input class="rb-input" style="width:100%;padding:7px 9px" readonly value="${escapeAttr(share.url)}"><div style="font-size:12px;color:#83817a;margin-top:8px">到期：${new Date(share.expiresAt).toLocaleString('zh-CN')} · 不经过云端</div></div>`;
            }
            toast('局域网临时链接已复制');
          } catch (error) { toast('分享失败：' + (error?.message || error)); }
        } },
      { id: 'browser.manageBookmarks', title: '收藏管理', icon: '📁', group: '浏览器',
        when: "module=='browser'", run: () => current?.openBookmarkManager() },
      { id: 'browser.exportBookmarks', title: '导出收藏为 Markdown', group: '浏览器',
        run: async () => {
          if (!current?.bookmarks.length) { toast('暂无收藏'); return; }
          const md = '# 浏览器收藏\n\n' + current.bookmarks.map(b => `- [${b.title}](${b.url})`).join('\n') + '\n';
          window.MazzHost?.openTab('markdown', { title: '浏览器收藏.md', content: md });
        } },
      { id: 'browser.bookmarksToContexts', title: '把收藏夹投影为多父上下文', group: '浏览器',
        when: "module=='browser'", run: async () => {
          if (!current?.bookmarks?.length) { toast('暂无收藏可投影'); return; }
          try {
            const result = await window.mazz.invoke('context:importBookmarks', { folders: current.folders || [], bookmarks: current.bookmarks });
            toast(`已投影 ${result.imported} 条收藏；原收藏未改变${result.failed ? `，${result.failed} 条无效记录已跳过` : ''}`);
          } catch (error) { toast('收藏投影失败：' + (error?.message || error)); }
        } },
      { id: 'browser.navBack', title: '后退', group: '浏览器', when: "module=='browser'",
        run: () => current && historyNav(current.activeTab(), 'back') },
      { id: 'browser.navForward', title: '前进', group: '浏览器', when: "module=='browser'",
        run: () => current && historyNav(current.activeTab(), 'forward') },
      { id: 'browser.navReload', title: '刷新', group: '浏览器', when: "module=='browser'",
        run: () => { const t = current?.activeTab(); if (!t) return; if (isElectron()) current.reloadTab?.(t); else current.openUrl(t.url); } },
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
      { id: 'browser.devtools', title: '开发者工具（F12）', icon: '🔧', group: '浏览器', when: "module=='browser'",
        run: () => { const t = current?.activeTab(); if (t) window.mazz.invoke('bv:devtools', { tabId: t.viewId }).catch(() => {}); } },
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
      { command: 'browser.devtools', key: 'f12', when: "module=='browser'" },
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
