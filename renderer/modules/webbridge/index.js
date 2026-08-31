// renderer/modules/webbridge/index.js —— 出站桥（P0）：文档 → 投稿网站
// 管线：当前文档 → 选站点 → 拉起投稿页（投稿会话 partition）→ 注入 → 校验回报
// P0 覆盖：markdown 直贴（掘金/CSDN/简书）+ manual 剪贴板兜底；paste-html 留待 P1
import { toast, modal } from '../../shell/shell.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { ADAPTERS } from './adapters.js';

const AUTHOR_PARTITION = 'persist:mazz-author'; // 投稿会话：与隐私浏览（persist:mazz-browser）物理隔离

/** 取当前 markdown 文档 {title, text}（无则 null；走 __activeMarkdownCtl 稳定引用，不走可被覆盖的注册表） */
function currentDoc(shell) {
  const tab = shell?.tabs?.active;
  if (!tab) return null;
  const ctl = window.__activeMarkdownCtl;
  if (!ctl?.getMarkdown) return null;
  const text = ctl.getMarkdown();
  if (typeof text !== 'string') return null;
  return { title: (tab.title || '未命名').replace(/\.(md|markdown|mazz)$/i, ''), text };
}

/** 注入脚本（在投稿页内执行）：填标题 + markdown 直贴正文 */
function buildInjectScript({ title, text, adapter }) {
  const payload = JSON.stringify({ title, text });
  return `(async () => {
    const p = ${payload};
    const setNativeValue = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // 标题
    const titleSel = ${JSON.stringify(adapter.title || '')};
    if (titleSel) {
      const t = document.querySelector(titleSel);
      if (t) setNativeValue(t, p.title);
    }
    // CodeMirror（ByteMD/CSDN/掘金系）
    const cmEl = document.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) { cmEl.CodeMirror.setValue(p.text); cmEl.CodeMirror.focus(); return { ok: true, via: 'codemirror' }; }
    // textarea 兜底
    const ta = document.querySelector(${JSON.stringify((adapter.editors || []).filter(s => s === 'textarea').join(', ') || 'textarea')});
    if (ta) { setNativeValue(ta, p.text); ta.focus(); return { ok: true, via: 'textarea' }; }
    // contenteditable：塞 pre 文本（不解析 HTML，纯 markdown 文本）
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce) { ce.innerText = p.text; ce.dispatchEvent(new Event('input', { bubbles: true })); return { ok: true, via: 'contenteditable' }; }
    return { ok: false, reason: 'editor-not-found' };
  })()`;
}

/** 主流程：当前文档 → 站点选择 → 拉起 → 注入 */
export async function docToWeb(shell) {
  const doc = currentDoc(shell);
  if (!doc || !doc.text.trim()) { toast('当前没有可投稿的 Markdown 文档'); return; }

  // 站点选择弹窗（多选批量 / 单选直投）
  const m = modal('投稿到网站（出站桥）');
  m.body.innerHTML = `
    <div style="min-width:400px">
      <div style="font-size:12.5px;color:var(--fg-dim);margin-bottom:8px">把「${doc.title}」发送到（勾选多站走队列逐站投）：</div>
      ${ADAPTERS.map(a => `
        <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer">
          <input type="checkbox" class="wb-chk" data-id="${a.id}" style="margin-top:3px">
          <span><b>${a.name}</b><br><span style="color:var(--fg-dim);font-size:11.5px">${a.note}</span></span>
        </label>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="rb-btn" id="wb-single" style="flex-direction:row">单站直投</button>
        <button class="rb-btn" id="wb-queue" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">队列批量投</button>
      </div>
      <div class="wb-status" style="font-size:12.5px;color:var(--fg-dim);margin-top:6px"></div>
      <div class="wb-queue-list" style="margin-top:8px"></div>
    </div>`;
  const status = m.body.querySelector('.wb-status');
  const picked = () => [...m.body.querySelectorAll('.wb-chk:checked')].map(c => ADAPTERS.find(a => a.id === c.dataset.id)).filter(Boolean);
  m.body.querySelector('#wb-single').addEventListener('click', async () => {
    const list = picked();
    if (list.length !== 1) { status.textContent = '单站直投请勾选恰好一个站点'; return; }
    status.textContent = '正在处理…';
    await launchToSite(shell, doc, list[0], status, m);
  });
  m.body.querySelector('#wb-queue').addEventListener('click', async () => {
    const list = picked();
    if (!list.length) { status.textContent = '先勾选要投的站点'; return; }
    const { queue } = await import('./queue.js');
    const listEl = m.body.querySelector('.wb-queue-list');
    const renderQ = (items) => {
      const ICON = { pending: iconHtml('⏳'), injecting: iconHtml('⚡'), review: iconHtml('✅'), failed: iconHtml('✗') };
      listEl.innerHTML = items.map(it => `
        <div style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:4px 0;border-top:1px solid var(--border)">
          <span>${ICON[it.status] || ''}</span><b>${it.adapter.name}</b>
          <span style="color:var(--fg-dim);font-size:11.5px;flex:1">${it.note}</span>
          ${it.status === 'failed' ? '<button class="fc-mini" data-retry="' + it.adapter.id + '">重试</button>' : ''}
        </div>`).join('');
      listEl.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => {
        const it = queue.items.find(x => x.adapter.id === b.dataset.retry);
        if (it) { queue.retry(it); queue.start(doc, (ad, d) => launchToSite(shell, d, ad, status, m, { keepOpen: true })); }
      }));
    };
    queue.onChange = renderQ;
    queue.enqueue(list);
    renderQ(queue.items);
    await queue.start(doc, (ad, d) => launchToSite(shell, d, ad, status, m, { keepOpen: true }));
  });
}

/** 拉起投稿页并注入（投稿会话 partition） */
async function launchToSite(shell, doc, adapter, status, dlg, opts = {}) {
  if (adapter.mode === 'manual') {
    await window.mazz.invoke('clipboard:write', { text: doc.text }).catch(() => navigator.clipboard?.writeText(doc.text));
    const url = await import('../../shell/shell.js').then(async ({ inputModal }) => inputModal('打开哪个页面？（粘贴投稿地址）', 'https://'));
    if (url?.trim()) shell.openTab('browser', { title: '投稿', url: url.trim() });
    toast('Markdown 已复制——到页面里 Ctrl+V 即可');
    dlg.close();
    return;
  }

  status.textContent = `正在拉起 ${adapter.name}（首次使用请先登录，登录态长期保留）…`;
  // 浏览器窗格打开投稿页（投稿会话 persist:mazz-author，与隐私浏览隔离）
  const { tab } = shell.openTab('browser', { title: `投稿 → ${adapter.name}`, content: '' });
  dlg.close();
  toast(`正在拉起 ${adapter.name}，页面就绪后自动填入…`);

  // paste-html 模式：markdown→HTML + 本地图片收集（P1 粘贴注入）
  let pastePayload = null;
  if (adapter.mode === 'paste-html') {
    status.textContent = '正在转换内容与本地图片…';
    const { mdToHtml, docToHtml, collectImages, placeholderize, buildPasteScript } = await import('./paste.js');
    const ws = await window.mazz.invoke('workspace:get').catch(() => '');
    // 首选编辑器渲染 DOM（最标准 HTML）；无编辑器时 mini 渲染兜底
    let html = docToHtml(window.__activeMarkdownCtl) || mdToHtml(doc.text);
    const images = await collectImages(html, { workspace: ws });
    // 图片转 base64 内联到注入脚本（File 不能跨 WebContentsView IPC 传参，base64 重建）
    for (const img of images) {
      const buf = await img.file.arrayBuffer();
      let bin = '';
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
      img.fileB64 = btoa(bin);
    }
    html = placeholderize(html, images);
    pastePayload = { title: doc.title, html, images, adapter };
  }

  // 等浏览器模块激活后，用投稿会话 partition 创建投稿标签
  let brCtl = null;
  let brTab = null;
  for (let i = 0; i < 25; i++) {
    if (brTab?.viewId) break;
    await new Promise(r => setTimeout(r, 300));
    const candidate = window.__activeBrowserCtl;
    if (candidate?.openTabRaw && candidate?.execJs) {
      brCtl = candidate;
      brTab = brCtl.openTabRaw(adapter.url, { partition: AUTHOR_PARTITION });
    }
  }
  if (!brCtl || !brTab?.viewId) { toast('浏览器未就绪，请重试'); return { ok: false, reason: 'browser-not-ready' }; }

  // WebContentsView 不在 renderer DOM；等待现有 Browser controller 的创建/导航队列，
  // 再沿 ctl.execJs → bv:js → webContents.executeJavaScript 注入。
  await Promise.resolve(brTab.viewReady).catch(() => false);
  await Promise.resolve(brTab.navigationReady || brTab.navQueue).catch(() => false);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    await wait(700);
    if (!brCtl.tabs?.includes(brTab) || !brTab.host?.isConnected) break;
    try {
      const code = adapter.mode === 'paste-html' && pastePayload
        ? (await import('./paste.js')).buildPasteScript(pastePayload)
        : buildInjectScript({ title: doc.title, text: doc.text, adapter });
      const r = await brCtl.execJs(brTab.viewId, code, { userGesture: true });
      if (r?.ok) {
        toast(`✅ 已填入「${doc.title}」（${r.via}）——请检查后自行发布`);
        return { ok: true, via: r.via, images: r.images || 0, tabId: brTab.id, viewId: brTab.viewId };
      }
      // editor-not-found / 页面跳转中的 __err / 暂无客页：继续等页面就绪。
    } catch { /* 页面跳转中，下一轮再试 */ }
  }
  await window.mazz.invoke('clipboard:write', { text: doc.text }).catch(() => {});
  toast(`未能自动填入（可能需先登录 ${adapter.name}）——Markdown 已复制，Ctrl+V 即可`);
  return { ok: false, reason: 'editor-not-found（可能需登录）', tabId: brTab.id, viewId: brTab.viewId };
}

/** 命令注册 */
export function registerWebBridge(commands) {
  commands.register('bridge.docToWeb', {
    title: '投稿到网站（出站桥）', icon: '📤', group: '输出',
    when: "module=='markdown'",
    run: () => docToWeb(window.MazzShell),
  });
}
