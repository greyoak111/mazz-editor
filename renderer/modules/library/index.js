// renderer/modules/library/index.js —— 自建书库：书架（导入/元数据/右键10号）+ 电子书与漫画阅读器 + epub→Markdown
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';
import { parseEpub, htmlToMarkdown } from './epub.js';
import { parseCbz } from './cbz.js';

const MODULE = 'library';
const instances = new Map();
let current = null;
const SHELF_KEY = 'library.books';
const PROGRESS_KEY = 'library.progress';

async function getShelf() {
  return (await window.mazz.invoke('settings:get', { key: SHELF_KEY }).catch(() => [])) || [];
}
async function saveShelf(books) {
  await window.mazz.invoke('settings:set', { key: SHELF_KEY, value: books }).catch(() => {});
}

function createLibrary(container) {
  const root = document.createElement('div');
  root.className = 'lib-root';
  root.innerHTML = `
    <div class="lib-shelf-view">
      <div class="lib-shelf-head">
        <b>📚 我的书库</b>
        <span class="lib-count"></span>
        <span style="flex:1"></span>
        <button class="rb-btn" data-a="import">＋ 导入书籍（epub / cbz）</button>
      </div>
      <div class="lib-shelf"></div>
    </div>
    <div class="lib-reader" style="display:none">
      <div class="lib-reader-bar">
        <button class="rb-btn" data-a="back">← 书架</button>
        <span class="lib-book-title"></span>
        <span style="flex:1"></span>
        <button class="rb-btn" data-a="toc" title="目录">≡ 目录</button>
        <button class="rb-btn" data-a="clip" title="选中文字摘录到书摘笔记（桥接 #7）">✍ 摘录</button>
        <button class="rb-btn" data-a="export-md" title="整书导出为 Markdown 笔记">⇪ 导出MD</button>
        <button class="rb-btn" data-a="prev">‹ 上一章</button>
        <span class="lib-pos"></span>
        <button class="rb-btn" data-a="next">下一章 ›</button>
        <button class="rb-btn" data-a="font-minus" title="字号减小">A−</button>
        <button class="rb-btn" data-a="font-plus" title="字号增大">A＋</button>
      </div>
      <div class="lib-reader-main">
        <div class="lib-toc" style="display:none"></div>
        <div class="lib-content"><div class="lib-page"></div></div>
      </div>
    </div>`;
  container.appendChild(root);

  const shelfView = root.querySelector('.lib-shelf-view');
  const readerView = root.querySelector('.lib-reader');
  const shelfEl = root.querySelector('.lib-shelf');
  const tocEl = root.querySelector('.lib-toc');
  const pageEl = root.querySelector('.lib-page');
  const posEl = root.querySelector('.lib-pos');

  const ctl = {
    root, container,
    book: null,       // 当前打开的书籍运行时 {meta, epub|cbz, format}
    chapterIdx: 0,
    pageIdx: 0,       // 漫画页
    fontSize: 17,
  };

  // ==================== 书架 ====================
  async function renderShelf() {
    const books = await getShelf();
    root.querySelector('.lib-count').textContent = books.length ? `（${books.length} 本）` : '';
    shelfEl.innerHTML = books.length ? books.map(b => `
      <div class="lib-card" data-id="${b.id}" title="${b.title}${b.author ? ' · ' + b.author : ''}">
        <div class="lib-cover">${b.cover ? `<img src="${b.cover}" alt="">` : `<span class="lib-cover-fallback">${b.format === 'cbz' ? '🖼' : '📖'}</span>`}</div>
        <div class="lib-card-title">${b.title}</div>
        <div class="lib-card-author">${b.author || b.format.toUpperCase()}</div>
      </div>`).join('')
      : `<div class="lib-empty">书库空空如也——点击「导入书籍」放入第一本 epub 或 cbz 漫画</div>`;
    shelfEl.querySelectorAll('.lib-card').forEach(card => {
      card.addEventListener('click', () => openBook(card.dataset.id));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showBookMenu(e.clientX, e.clientY, books.find(x => x.id === card.dataset.id));
      });
    });
  }

  /** 右键 10 号上下文（书库条目） */
  function showBookMenu(x, y, book) {
    if (!book) return;
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    menu.innerHTML = `
      <div class="mazz-menu-item" data-a="open">打开</div>
      <div class="mazz-menu-item" data-a="export">导出为 Markdown 笔记</div>
      <div class="mazz-menu-sep"></div>
      <div class="mazz-menu-item" data-a="remove">移出书架</div>`;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    const close = () => menu.remove();
    setTimeout(() => window.addEventListener('mousedown', close, { once: true }), 0);
    menu.querySelector('[data-a=open]').addEventListener('click', () => { openBook(book.id); close(); });
    menu.querySelector('[data-a=export]').addEventListener('click', async () => { close(); await exportBookMarkdown(book); });
    menu.querySelector('[data-a=remove]').addEventListener('click', async () => {
      close();
      const books = (await getShelf()).filter(x => x.id !== book.id);
      await saveShelf(books);
      toast(`《${book.title}》已移出书架`);
      renderShelf();
    });
  }

  // ==================== 导入 ====================
  async function importBook() {
    if (!window.mazz?.isElectron) { toast('导入书籍需要桌面版'); return; }
    const p = await window.mazz.invoke('dialog:openFile', {
      filters: [{ name: '电子书/漫画', extensions: ['epub', 'cbz'] }],
    });
    if (!p) return;
    const ext = p.split('.').pop().toLowerCase();
    const name = p.split(/[\\/]/).pop();
    toast('正在解析 ' + name + '…');
    try {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = bytes.buffer;
      let meta;
      if (ext === 'epub') {
        const epub = await parseEpub(buf);
        meta = { title: epub.title, author: epub.author, cover: epub.cover };
      } else if (ext === 'cbz') {
        const cbz = await parseCbz(buf);
        const cover = await cbz.loadPage(0);
        meta = { title: name.replace(/\.cbz$/i, ''), author: '', cover };
      } else {
        toast('暂不支持 .' + ext + '（mobi/azw3/cbr 请先用 Calibre 转 epub/cbz）');
        return;
      }
      // 复制进书库目录
      const ws = await window.mazz.invoke('workspace:get');
      const dest = `${ws}/书库/${name}`;
      await window.mazz.invoke('fs:writeFileBase64', { path: dest, base64: b64 });
      const books = await getShelf();
      const id = 'bk' + Date.now().toString(36);
      books.push({ id, title: meta.title, author: meta.author || '', cover: meta.cover || '', path: dest, format: ext, addedAt: Date.now() });
      await saveShelf(books);
      toast(`《${meta.title}》已入库`);
      renderShelf();
    } catch (e) {
      toast('导入失败：' + (e.message || e));
    }
  }

  // ==================== 阅读器 ====================
  async function openBook(id) {
    const book = (await getShelf()).find(b => b.id === id);
    if (!book) { toast('书籍不存在'); return; }
    try {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: book.path });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      ctl.book = { meta: book };
      if (book.format === 'epub') {
        ctl.book.epub = await parseEpub(bytes.buffer);
        const progress = (await window.mazz.invoke('settings:get', { key: PROGRESS_KEY }).catch(() => ({}))) || {};
        ctl.chapterIdx = Math.min(progress[id]?.chapter || 0, ctl.book.epub.spine.length - 1);
      } else {
        ctl.book.cbz = await parseCbz(bytes.buffer);
        const progress = (await window.mazz.invoke('settings:get', { key: PROGRESS_KEY }).catch(() => ({}))) || {};
        ctl.pageIdx = Math.min(progress[id]?.page || 0, ctl.book.cbz.count - 1);
      }
      shelfView.style.display = 'none';
      readerView.style.display = 'flex';
      root.querySelector('.lib-book-title').textContent = book.title;
      window.MazzHost?.setTabTitle(container, '📖 ' + book.title);
      renderToc();
      await showCurrent();
    } catch (e) {
      toast('打开失败：' + (e.message || e));
    }
  }

  function saveProgress() {
    window.mazz.invoke('settings:get', { key: PROGRESS_KEY }).then((all) => {
      all = all || {};
      all[ctl.book.meta.id] = ctl.book.meta.format === 'epub' ? { chapter: ctl.chapterIdx } : { page: ctl.pageIdx };
      window.mazz.invoke('settings:set', { key: PROGRESS_KEY, value: all });
    }).catch(() => {});
  }

  function renderToc() {
    const b = ctl.book;
    if (b.meta.format === 'epub') {
      const toc = b.epub.toc.length ? b.epub.toc : b.epub.spine.map((s, i) => ({ label: '第 ' + (i + 1) + ' 节', href: s.href }));
      tocEl.innerHTML = toc.map((t, i) => {
        // 目录条目对应 spine 索引（按 href 匹配，失败则按序号）
        let idx = b.epub.spine.findIndex(s => s.href === t.href || t.href.endsWith(s.href) || s.href.endsWith(t.href));
        if (idx < 0) idx = i;
        return `<div class="lib-toc-item${idx === ctl.chapterIdx ? ' on' : ''}" data-i="${idx}">${t.label}</div>`;
      }).join('');
    } else {
      tocEl.innerHTML = Array.from({ length: b.cbz.count }, (_, i) =>
        `<div class="lib-toc-item${i === ctl.pageIdx ? ' on' : ''}" data-i="${i}">第 ${i + 1} 页</div>`).join('');
    }
    tocEl.querySelectorAll('.lib-toc-item').forEach(el => el.addEventListener('click', async () => {
      const i = +el.dataset.i;
      if (ctl.book.meta.format === 'epub') ctl.chapterIdx = i; else ctl.pageIdx = i;
      await showCurrent();
    }));
  }

  async function showCurrent() {
    const b = ctl.book;
    if (b.meta.format === 'epub') {
      const item = b.epub.spine[ctl.chapterIdx];
      const ch = await b.epub.loadChapter(item);
      pageEl.innerHTML = ch.html;
      pageEl.style.fontSize = ctl.fontSize + 'px';
      posEl.textContent = `${ctl.chapterIdx + 1}/${b.epub.spine.length}`;
    } else {
      const url = await b.cbz.loadPage(ctl.pageIdx);
      pageEl.innerHTML = `<img class="lib-manga-page" src="${url}" alt="">`;
      posEl.textContent = `${ctl.pageIdx + 1}/${b.cbz.count}`;
    }
    root.querySelector('.lib-content').scrollTop = 0;
    renderToc();
    saveProgress();
  }

  async function nav(delta) {
    const b = ctl.book;
    if (b.meta.format === 'epub') {
      ctl.chapterIdx = Math.min(Math.max(ctl.chapterIdx + delta, 0), b.epub.spine.length - 1);
    } else {
      ctl.pageIdx = Math.min(Math.max(ctl.pageIdx + delta, 0), b.cbz.count - 1);
    }
    await showCurrent();
  }

  async function exportBookMarkdown(book) {
    const target = book || ctl.book?.meta;
    if (!target) return;
    if (target.format !== 'epub') { toast('漫画暂不支持导出 Markdown'); return; }
    try {
      toast('正在导出…');
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: target.path });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const epub = await parseEpub(bytes.buffer);
      const parts = [`# ${epub.title}\n`, epub.author ? `> 作者：${epub.author}\n` : ''];
      for (const item of epub.spine) {
        const ch = await epub.loadChapter(item);
        const md = htmlToMarkdown(ch.html);
        if (md.trim()) parts.push(md);
      }
      window.MazzHost?.openTab('markdown', { title: target.title + '.md', content: parts.join('\n\n') });
      toast('已导出为 Markdown 文档');
    } catch (e) { toast('导出失败：' + (e.message || e)); }
  }

  // ==================== 事件 ====================
  root.querySelector('[data-a=import]').addEventListener('click', importBook);
  root.querySelector('[data-a=back]').addEventListener('click', () => {
    readerView.style.display = 'none';
    shelfView.style.display = 'flex';
    ctl.book = null;
    window.MazzHost?.setTabTitle(container, '📚 书库');
    renderShelf();
  });
  root.querySelector('[data-a=toc]').addEventListener('click', () => {
    tocEl.style.display = tocEl.style.display === 'none' ? 'block' : 'none';
  });
  root.querySelector('[data-a=prev]').addEventListener('click', () => nav(-1));
  root.querySelector('[data-a=next]').addEventListener('click', () => nav(1));
  root.querySelector('[data-a=export-md]').addEventListener('click', () => exportBookMarkdown());
  root.querySelector('[data-a=clip]').addEventListener('click', async () => {
    const text = (window.getSelection()?.toString() || '').trim();
    if (!text) { toast('先在书页里选中一段文字'); return; }
    try {
      const file = await window.MazzBridges.execute('lib.toNote', {
        text,
        book: ctl.book?.meta?.title || '未命名',
        where: ctl.book?.meta?.format === 'epub' ? `第 ${ctl.chapterIdx + 1} 章` : `第 ${ctl.pageIdx + 1} 页`,
      });
      toast('已摘录到 ' + file.split(/[\\/]/).pop());
    } catch (e) { toast(e.message); }
  });
  root.querySelector('[data-a=font-minus]').addEventListener('click', async () => { ctl.fontSize = Math.max(13, ctl.fontSize - 1); await showCurrent(); });
  root.querySelector('[data-a=font-plus]').addEventListener('click', async () => { ctl.fontSize = Math.min(28, ctl.fontSize + 1); await showCurrent(); });
  // 键盘翻页
  root.tabIndex = 0;
  root.addEventListener('keydown', (e) => {
    if (!ctl.book) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') nav(-1);
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') nav(1);
  });
  root.addEventListener('focusin', (e) => {
    if (current !== ctl && root.contains(e.target)) { current = ctl; contextKeys.set('module', MODULE); }
  });

  ctl.openBook = openBook;
  ctl.importBook = importBook;
  ctl.exportBookMarkdown = exportBookMarkdown;
  ctl.renderShelf = renderShelf;

  renderShelf();
  return ctl;
}

export default {
  displayName: '书库',
  icon: '📚',
  _forTests: { instances },

  create(container) {
    const ctl = createLibrary(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeLibraryCtl = ctl; // 桥接 #7 取数
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return JSON.stringify({ mark: 'mazz-library-v1', bookId: ctl?.book?.meta?.id || null });
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj?.bookId) ctl.openBook(obj.bookId);
    } catch {}
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.renderShelf();
  },
  getCharCount(state) { return 0; },
  getCursorPos() { return '书库'; },

  toolbarHTML: `
    <div class="rb-group" data-label="书库">
      <button class="rb-btn" data-command="library.import"><i class="ico">＋</i><span>导入书籍</span></button>
      <button class="rb-btn" data-command="library.exportMd"><i class="ico">⇪</i><span>导出MD</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'library.import', title: '导入书籍（epub/cbz）', group: '书库',
        run: () => current?.importBook() },
      { id: 'library.exportMd', title: '当前书籍导出为 Markdown', group: '书库', when: "module=='library'",
        run: () => current?.exportBookMarkdown() },
    ],
    keybindings: [],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
