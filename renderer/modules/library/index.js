// renderer/modules/library/index.js —— 自建书库（Neat Reader 级）
// 书架：分类自定义/封面自定义/批量增删 · 阅读室：进度条(页数+百分比)/大纲侧栏/三模式/缩放/主题/书签/书内搜索
import { iconHtml } from '../../lib/svg-icons.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast, inputModal, modal } from '../../shell/shell.js';
import { parseEpub, htmlToMarkdown } from './epub.js';
import { parseCbz } from './cbz.js';
import { parseMobi, paginateText, textPageToHtml, extractMobiImages, imageBytesToDataUrl } from './mobi.js';
import { buildMangaBook, imageUrl } from './manga.js';

const MODULE = 'library';
const instances = new Map();
let current = null;
const SHELF_KEY = 'library.books';
const PROGRESS_KEY = 'library.progress';
const CATS_KEY = 'library.categories';
const MARKS_KEY = 'library.bookmarks';

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const READ_THEMES = {
  paper: { name: '纸白', bg: '#fbf8f0', fg: '#3d3627' },
  sepia: { name: '羊皮纸', bg: '#f1e8d0', fg: '#4a3d28' },
  night: { name: '墨夜', bg: '#1c1f26', fg: '#c9cdd6' },
};

async function getShelf() {
  return (await window.mazz.invoke('settings:get', { key: SHELF_KEY }).catch(() => [])) || [];
}
async function saveShelf(books) {
  await window.mazz.invoke('settings:set', { key: SHELF_KEY, value: books }).catch(() => {});
}
async function getCats() {
  return (await window.mazz.invoke('settings:get', { key: CATS_KEY }).catch(() => [])) || [];
}
async function saveCats(cats) {
  await window.mazz.invoke('settings:set', { key: CATS_KEY, value: cats }).catch(() => {});
}
function decodeText(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes); } catch { return new TextDecoder('gbk').decode(bytes); }
}

function createLibrary(container) {
  const root = document.createElement('div');
  root.className = 'lib-root';
  root.innerHTML = `
    <div class="lib-shelf-view">
      <div class="lib-shelf-head">
        <b>${iconHtml('📚')} 我的书库</b>
        <button class="rb-btn" data-a="dl-site" title="打开电子书站（投稿会话登录后，下载自动入库）" style="font-size:11.5px">${iconHtml('⬇')} 下载站</button>
        <span class="lib-count"></span>
        <select class="lib-cat-filter rb-select" title="按分类筛选"></select>
        <button class="rb-btn" data-a="newcat" title="分类管理（新建/删除）">${iconHtml('✚')} 分类</button>
        <span style="flex:1"></span>
        <button class="rb-btn" data-a="batch" title="批量管理（多选删除）">${iconHtml('☑')} 批量管理</button>
        <button class="rb-btn" data-a="import">${iconHtml('＋')} 导入书籍</button>
        <button class="rb-btn" data-a="import-folder" title="把一个图片文件夹当漫画看（每话=一个图片子文件夹）">${iconHtml('🗂')} 导入漫画文件夹</button>
      </div>
      <div class="lib-shelf"></div>
      <div class="lib-batch-bar" style="display:none">
        <span class="lib-batch-n">已选 0 项</span>
        <button class="rb-btn" data-a="sel-all">全选</button>
        <button class="rb-btn" data-a="sel-none">全不选</button>
        <button class="rb-btn" data-a="sel-moveto">移到分类…</button>
        <button class="rb-btn" data-a="sel-del" style="color:var(--danger)">删除所选</button>
        <button class="rb-btn" data-a="sel-done">完成</button>
      </div>
    </div>
    <div class="lib-reader" style="display:none">
      <div class="lib-reader-bar">
        <button class="rb-btn" data-a="back">← 书架</button>
        <span class="lib-book-title"></span>
        <span style="flex:1"></span>
        <button class="rb-btn" data-a="toc" title="大纲/目录">${iconHtml('≡')}</button>
        <button class="rb-btn" data-a="search" title="书内搜索">${iconHtml('🔍')}</button>
        <button class="rb-btn" data-a="mark" title="添加书签">${iconHtml('🔖')}</button>
        <button class="rb-btn" data-a="marks" title="书签列表">${iconHtml('☰')}</button>
        <button class="rb-btn" data-a="clip" title="选中文字摘录到书摘笔记">${iconHtml('✍')} 摘录</button>
        <button class="rb-btn" data-a="export-md" title="整书导出为 Markdown 笔记">${iconHtml('⇪')}</button>
        <button class="rb-btn" data-a="direction" title="翻页方向：左到右 / 右到左（日漫习惯）">${iconHtml('⇄')}</button>
        <select class="lib-mode rb-select" title="阅读模式">
          <option value="single">单页</option><option value="double">双页</option><option value="scroll">滚动</option>
        </select>
        <select class="lib-read-theme rb-select" title="阅读主题">
          ${Object.entries(READ_THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
        </select>
        <button class="rb-btn" data-a="font-minus" title="字号减小">A−</button>
        <button class="rb-btn" data-a="font-plus" title="字号增大">A＋</button>
        <select class="lib-pagew rb-select" title="页宽（单页占窗格百分比，随窗格拖变——epub.js 正宗：页宽跟容器走，不写死 px）">
          <option value="0.5">页宽 50%</option><option value="0.6">页宽 60%</option>
          <option value="0.7" selected>页宽 70%</option><option value="0.8">页宽 80%</option>
          <option value="1">全宽 100%</option>
        </select>
      </div>
      <div class="lib-reader-main">
        <div class="lib-toc" style="display:none"></div>
        <div class="lib-content"><div class="lib-page"></div></div>
      </div>
      <div class="lib-progress">
        <button class="rb-btn" data-a="prev">‹</button>
        <div class="lib-prog-track"><div class="lib-prog-fill"></div></div>
        <span class="lib-pos"></span>
        <button class="rb-btn" data-a="next">›</button>
        <button class="rb-btn" data-a="prog-fold" title="收起进度条" style="padding:2px 6px">▾</button>
      </div>
      <div class="lib-progress-peek" style="display:none" title="展开进度条">▴</div>
    </div>`;
  container.appendChild(root);

  const shelfView = root.querySelector('.lib-shelf-view');
  const readerView = root.querySelector('.lib-reader');
  const shelfEl = root.querySelector('.lib-shelf');
  const tocEl = root.querySelector('.lib-toc');
  const pageEl = root.querySelector('.lib-page');
  const posEl = root.querySelector('.lib-pos');
  const progFill = root.querySelector('.lib-prog-fill');
  const contentEl = root.querySelector('.lib-content');

  const ctl = {
    root, container,
    book: null, chapterIdx: 0, pageIdx: 0,
    fontSize: 16, fontFamily: '', lineHeight: 1.8,
    readTheme: 'paper', mode: 'single', direction: 'ltr', // ltr 左到右 | rtl 右到左（日漫）
    catFilter: '', batchMode: false, batchSel: new Set(),
  };

  // ==================== 书架 ====================
  async function allCats() {
    const saved = await getCats();
    return ['未分类', ...saved.filter(c => c !== '未分类')];
  }

  async function renderShelf() {
    const books = await getShelf();
    const cats = await allCats();
    // 分类筛选下拉
    const filterSel = root.querySelector('.lib-cat-filter');
    filterSel.innerHTML = `<option value="">全部（${books.length}）</option>` + cats.map(c => {
      const n = books.filter(b => (b.category || '未分类') === c).length;
      return `<option value="${c}" ${ctl.catFilter === c ? 'selected' : ''}>${c}（${n}）</option>`;
    }).join('');
    const shown = ctl.catFilter ? books.filter(b => (b.category || '未分类') === ctl.catFilter) : books;
    root.querySelector('.lib-count').textContent = ctl.catFilter ? `${shown.length} 本` : `${books.length} 本`;
    shelfEl.innerHTML = shown.length ? shown.map(b => `
      <div class="lib-card${ctl.batchMode ? ' batching' : ''}${ctl.batchSel.has(b.id) ? ' selected' : ''}" data-id="${b.id}">
        ${ctl.batchMode ? `<input type="checkbox" class="lib-card-cb" ${ctl.batchSel.has(b.id) ? 'checked' : ''}>` : ''}
        <div class="lib-cover">${b.cover ? `<img src="${b.cover}" alt="">` : `<span class="lib-cover-fallback">${iconHtml(b.format === 'cbz' || b.format === 'manga-folder' ? '🖼' : b.format === 'pdf' ? '📕' : '📖')}</span>`}</div>
        <div class="lib-card-title">${b.title}</div>
        <div class="lib-card-author">${b.author || b.format.toUpperCase()}</div>
        <span class="lib-card-cat">${b.category || '未分类'}</span>
      </div>`).join('')
      : `<div class="lib-empty">书库空空如也——「导入书籍」放入第一本，或「导入漫画文件夹」开看漫画</div>`;
    shelfEl.querySelectorAll('.lib-card').forEach(card => {
      const id = card.dataset.id;
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('lib-card-cb')) return;
        if (ctl.batchMode) { toggleBatchSel(id); return; }
        openBook(id);
      });
      card.querySelector('.lib-card-cb')?.addEventListener('change', () => toggleBatchSel(id));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showBookMenu(e.clientX, e.clientY, shown.find(x => x.id === id));
      });
    });
    updateBatchBar();
  }

  function toggleBatchSel(id) {
    ctl.batchSel.has(id) ? ctl.batchSel.delete(id) : ctl.batchSel.add(id);
    renderShelf();
  }
  function updateBatchBar() {
    root.querySelector('.lib-batch-n').textContent = `已选 ${ctl.batchSel.size} 项`;
  }

  /** 书籍右键菜单：打开/封面/分类/导出/删除 */
  function showBookMenu(x, y, book) {
    if (!book) return;
    import('../../lib/dom-menu.js').then(({ showDomMenu }) => {
      showDomMenu([
        { label: '打开', fn: () => openBook(book.id) },
        { label: '设置封面…', fn: () => setCustomCover(book) },
        { label: '移到分类…', fn: () => moveBookCategory(book) },
        { label: '书名与作者…', fn: () => editBookMeta(book) },
        '-',
        ...(book.format === 'epub' ? [{ label: '导出为 Markdown 笔记', fn: () => exportBookMarkdown(book) }] : []),
        { label: '移出书架', fn: () => removeBooks([book.id]) },
      ], x, y);
    });
  }

  /** 自定义封面（漫画文件夹与无封面书籍通用） */
  /** 自定义书名与作者名（v35） */
  async function editBookMeta(book) {
    const m = modal('书名与作者');
    m.body.innerHTML = `
      <div style="min-width:340px">
        <div class="set-row"><label>书名</label><input id="bm-title" class="rb-input" style="width:64%" value="${(book.title || '').replace(/"/g, '&quot;')}"></div>
        <div class="set-row"><label>作者</label><input id="bm-author" class="rb-input" style="width:64%" value="${(book.author || '').replace(/"/g, '&quot;')}" placeholder="可留空"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="bm-ok" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存</button></div>
      </div>`;
    m.body.querySelector('#bm-ok').addEventListener('click', async () => {
      const t = m.body.querySelector('#bm-title').value.trim();
      const a = m.body.querySelector('#bm-author').value.trim();
      if (t) book.title = t;
      book.author = a;
      const books = await getShelf();
      const i = books.findIndex(x => x.id === book.id);
      if (i >= 0) { books[i] = book; await saveShelf(books); }
      renderShelf();
      if (ctl.book?.meta?.id === book.id) {
        root.querySelector('.lib-book-title').textContent = book.title;
        window.MazzHost?.setTabTitle(container, book.title);
      }
      toast('书名与作者已更新');
      m.close();
    });
  }

  async function setCustomCover(book) {
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '图片', extensions: IMG_EXTS }] }).catch(() => null);
    if (!p) return;
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
    const ext = p.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
    book.cover = `data:image/${ext};base64,${b64}`;
    const books = await getShelf();
    const i = books.findIndex(x => x.id === book.id);
    if (i >= 0) { books[i] = book; await saveShelf(books); }
    renderShelf();
    toast('封面已更新');
  }

  /** 移到分类 */
  async function moveBookCategory(book) {
    const cats = await allCats();
    const m = document.createElement('div');
    m.className = 'mazz-palette-mask';
    m.innerHTML = `<div class="mazz-palette" style="padding:16px 18px;min-width:280px">
      <b>移到分类</b>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
        ${cats.map(c => `<button class="rb-btn" data-c="${c}" style="flex-direction:row;justify-content:flex-start">${(book.category || '未分类') === c ? '✓ ' : ''}${c}</button>`).join('')}
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.remove(); });
    m.querySelectorAll('[data-c]').forEach(btn => btn.addEventListener('click', async () => {
      book.category = btn.dataset.c;
      const books = await getShelf();
      const i = books.findIndex(x => x.id === book.id);
      if (i >= 0) { books[i] = book; await saveShelf(books); }
      renderShelf();
      m.remove();
      toast(`已移到「${btn.dataset.c}」`);
    }));
  }

  async function removeBooks(ids) {
    const books = (await getShelf()).filter(x => !ids.includes(x.id));
    await saveShelf(books);
    ctl.batchSel.clear();
    renderShelf();
    toast(`已移出 ${ids.length} 本`);
  }

  // ==================== 导入 ====================
  async function importBook() {
    const p = await window.mazz.invoke('dialog:openFile', {
      filters: [{ name: '电子书/漫画/文档', extensions: ['epub', 'cbz', 'txt', 'mobi', 'azw3', 'pdf'] }],
      multi: true,
    });
    if (!p) return;
    const paths = Array.isArray(p) ? p : [p];
    let ok = 0;
    for (const path of paths) {
      const id = await importPath(path, { silent: paths.length > 1 });
      if (id) ok++;
    }
    if (paths.length > 1) toast(`批量导入完成：${ok}/${paths.length} 本入库`);
  }

  async function importMangaFolder() {
    const dir = await window.mazz.invoke('dialog:openFolder').catch(() => null);
    if (dir) await importMangaFolderPath(dir);
  }

  async function importMangaFolderPath(dir) {
    toast('正在解析漫画文件夹…');
    try {
      const book = await buildMangaBook(dir);
      const cover = await imageUrl(book.chapters[0].pages[0]);
      const books = await getShelf();
      const id = 'bk' + Date.now().toString(36);
      books.push({ id, title: book.title, author: '', cover, path: dir, format: 'manga-folder', category: '未分类', addedAt: Date.now() });
      await saveShelf(books);
      toast(`《${book.title}》已入库（${book.chapters.length} 话 ${book.chapters.reduce((n, c) => n + c.pages.length, 0)} 页）`);
      renderShelf();
      await openBook(id);
      return id;
    } catch (e) {
      toast('导入失败：' + (e.message || e));
      return null;
    }
  }

  async function importPath(p, { silent = false } = {}) {
    const ext = p.split('.').pop().toLowerCase();
    const name = p.split(/[\\/]/).pop();
    if (!silent) toast('正在解析 ' + name + '…');
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
      } else if (ext === 'mobi' || ext === 'azw3') {
        const m = await parseMobi(buf); // 三级防线（自研→lingo→优雅拒绝）
        meta = { title: m.title !== '未命名' ? m.title : name.replace(/\.(mobi|azw3)$/i, ''), author: m.author, cover: '' };
      } else if (ext === 'txt' || ext === 'pdf') {
        meta = { title: name.replace(/\.[^.]+$/, ''), author: '', cover: '' };
      } else {
        toast('暂不支持 .' + ext + '（epub/cbz/txt/mobi/azw3/pdf 之外的格式请先用 Calibre 转换）');
        return null;
      }
      const ws = (await window.mazz.invoke('workspace:get').catch(() => '')) || '';
      let dest = p;
      if (!ws || !p.replace(/\\/g, '/').startsWith(ws.replace(/\\/g, '/') + '/')) {
        dest = `${ws}/书库/${name}`;
        await window.mazz.invoke('fs:writeFileBase64', { path: dest, base64: b64 });
      }
      const books = await getShelf();
      const id = 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      books.push({ id, title: meta.title, author: meta.author || '', cover: meta.cover || '', path: dest, format: ext, category: '未分类', addedAt: Date.now() });
      await saveShelf(books);
      if (!silent) {
        toast(`《${meta.title}》已入库`);
        renderShelf();
        await openBook(id);
      } else renderShelf();
      return id;
    } catch (e) {
      if (!silent) toast('导入失败：' + (e.message || e));
      return null;
    }
  }

  // ==================== 阅读室 ====================
  async function openBook(id) {
    const book = (await getShelf()).find(b => b.id === id);
    if (!book) { toast('书籍不存在'); return; }
    try {
      let bytes = null;
      if (book.format !== 'manga-folder') {
        const b64 = await window.mazz.invoke('fs:readFileBase64', { path: book.path });
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      }
      ctl.book = { meta: book };
      const progress = (await window.mazz.invoke('settings:get', { key: PROGRESS_KEY }).catch(() => ({}))) || {};
      // 分栏屏位比例（重开恢复用；只在分栏横排布局完成后消费一次）
      ctl._pendingRatio = (typeof progress[id]?.ratio === 'number') ? progress[id].ratio : null;
      if (book.format === 'epub') {
        ctl.book.epub = await parseEpub(bytes.buffer);
        ctl.chapterIdx = Math.min(progress[id]?.chapter || 0, ctl.book.epub.spine.length - 1);
      } else if (book.format === 'manga-folder') {
        ctl.book.manga = await buildMangaBook(book.path);
        ctl.pageIdx = Math.min(progress[id]?.page || 0, ctl.book.manga.chapters.length - 1);
      } else if (book.format === 'pdf') {
        ctl.book.pdf = { url: window.mazz?.isElectron ? 'file://' + book.path.replace(/\\/g, '/') : URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/pdf' })) };
      } else if (book.format === 'txt' || book.format === 'mobi' || book.format === 'azw3') {
        // 图片型 mobi（漫画）：image records 图多（≥3）即按 cbz 漫画管线渲染——
        // 漫画型 mobi 正文是图片记录不是文字（「乱码」真相：只提了 HTML 骨架碎片，图一张没提）
        if (book.format !== 'txt') {
          const imgs = extractMobiImages(bytes.buffer);
          if (imgs.length >= 3) {
            const pages = imgs.map(im => imageBytesToDataUrl(im.mime, im.bytes));
            ctl.book.cbz = { count: pages.length, loadPage: async (i) => pages[i] };
            ctl.book.meta.format = 'cbz'; // 伪装 cbz 走漫画管线（单双页/进度/图宽全通）
            ctl.pageIdx = Math.min(progress[id]?.page || 0, pages.length - 1);
          }
        }
        if (!ctl.book.cbz) {
          const text = book.format === 'txt' ? decodeText(bytes) : (await parseMobi(bytes.buffer)).text; // 三级防线（自研→lingo→优雅拒绝）
          ctl.book.textBook = { pages: paginateText(text) };
          ctl.pageIdx = Math.min(progress[id]?.page || 0, ctl.book.textBook.pages.length - 1);
        }
      } else {
        ctl.book.cbz = await parseCbz(bytes.buffer);
        ctl.pageIdx = Math.min(progress[id]?.page || 0, ctl.book.cbz.count - 1);
      }
      shelfView.style.display = 'none';
      readerView.style.display = 'flex';
      root.querySelector('.lib-book-title').textContent = book.title;
      window.MazzHost?.setTabTitle(container, book.title);
      renderToc();
      applyReadTheme();
      await showCurrent();
    } catch (e) {
      toast('打开失败：' + (e.message || e));
    }
  }

  function saveProgress() {
    window.mazz.invoke('settings:get', { key: PROGRESS_KEY }).then((all) => {
      all = all || {};
      // 分栏比例统一存储：epub 存 chapter、文本类存 page，分栏横排一律附 ratio（屏位比例 0..1）
      const rec = ctl.book.meta.format === 'epub' ? { chapter: ctl.chapterIdx } : { page: ctl.pageIdx };
      if (ctl._flowWrap && typeof ctl._flowRatio === 'number') rec.ratio = +ctl._flowRatio.toFixed(5);
      all[ctl.book.meta.id] = rec;
      window.mazz.invoke('settings:set', { key: PROGRESS_KEY, value: all });
    }).catch(() => {});
  }

  /** 当前格式可分页总数 */
  /** 漫画文件夹扁平页流：单/双页按图片计数（此前按"话"计数，双页=两话并排，完全不是看漫画的逻辑） */
  function flatManga(b) {
    if (!b._flat) {
      b._flat = [];
      b.manga.chapters.forEach((ch, ci) => ch.pages.forEach((pg, pi) => b._flat.push({ ch: ci, page: pi, path: pg })));
    }
    return b._flat;
  }
  /** 章首在扁平流中的下标 */
  function flatIdxOfChapter(b, ci) {
    const f = flatManga(b);
    const i = f.findIndex(x => x.ch === ci);
    return i < 0 ? 0 : i;
  }

  function totalPages() {
    const b = ctl.book;
    if (!b) return 1;
    switch (b.meta.format) {
      case 'epub': return b.epub.spine.length;
      case 'manga-folder': return ctl.mode === 'scroll' ? b.manga.chapters.length : flatManga(b).length;
      case 'txt': case 'mobi': case 'azw3': return b.textBook.pages.length;
      case 'pdf': return 1;
      default: return b.cbz.count;
    }
  }
  function currentPos() { return ctl.book?.meta.format === 'epub' ? ctl.chapterIdx : ctl.pageIdx; }

  function updateProgressBar() {
    const b = ctl.book;
    // 滚动模式（文本类）：按滚动位置百分比报（漫画早已同此——此前锚定章节数，滚到底进度还停在章首）
    if (ctl.mode === 'scroll' && b && b.meta.format !== 'pdf' && b.meta.format !== 'cbz' && b.meta.format !== 'manga-folder') {
      const sh = contentEl.scrollHeight - contentEl.clientHeight;
      const pct = sh > 0 ? Math.round(contentEl.scrollTop / sh * 100) : 100;
      const cur = currentPos() + 1;
      const total = totalPages();
      const unit = b.meta.format === 'epub' ? '章' : '页';
      posEl.textContent = `第 ${cur}/${total} ${unit} · ${pct}%`;
      progFill.style.width = pct + '%';
      return;
    }
    // 切片横排：按屏数报进度（一屏=一页，百分比精确；_flowOffset 平移量定位）
    if (ctl._flowWrap && ctl.mode !== 'scroll' && b && b.meta.format !== 'cbz' && b.meta.format !== 'manga-folder' && b.meta.format !== 'pdf'
        && ctl._flowWrap.clientWidth > 0 && (ctl._flowWrap.querySelector('.lib-flow')?.scrollWidth || 0) > 0) {
      const w = ctl._flowWrap;
      const flow = w.querySelector('.lib-flow');
      const cols = Math.max(1, Math.round(flow.scrollWidth / w.clientWidth));
      const cur = Math.min(cols, Math.round((ctl._flowOffset || 0) / w.clientWidth) + 1);
      const pct = Math.round(cur / cols * 100);
      posEl.textContent = `第 ${cur}/${cols} 页 · ${pct}%`;
      progFill.style.width = pct + '%';
      return;
    }
    const total = totalPages();
    const cur = currentPos() + 1;
    const pct = Math.round(cur / total * 100);
    const unit = b?.meta.format === 'epub' ? '章' : '页';
    posEl.textContent = `第 ${cur}/${total} ${unit} · ${pct}%`;
    progFill.style.width = pct + '%';
  }

  // ==================== 大纲（侧栏） ====================
  function renderToc() {
    const b = ctl.book;
    if (!b) return;
    let items = [];
    if (b.meta.format === 'pdf') {
      tocEl.innerHTML = '<div class="lib-toc-item on">PDF 整卷（内建翻页缩放）</div>';
      return;
    }
    if (b.meta.format === 'epub') {
      const toc = b.epub.toc.length ? b.epub.toc : b.epub.spine.map((s, i) => ({ label: '第 ' + (i + 1) + ' 节', href: s.href }));
      items = toc.map((t, i) => {
        let idx = b.epub.spine.findIndex(s => s.href === t.href || t.href.endsWith(s.href) || s.href.endsWith(t.href));
        if (idx < 0) idx = i;
        return { label: t.label, idx };
      });
    } else if (b.meta.format === 'manga-folder') {
      items = b.manga.chapters.map((c, i) => ({ label: `${c.name}（${c.pages.length}p）`, idx: ctl.mode === 'scroll' ? i : flatIdxOfChapter(b, i) }));
    } else if (b.meta.format === 'txt' || b.meta.format === 'mobi' || b.meta.format === 'azw3') {
      items = b.textBook.pages.map((_, i) => ({ label: '第 ' + (i + 1) + ' 页', idx: i }));
    } else {
      items = Array.from({ length: b.cbz.count }, (_, i) => ({ label: '第 ' + (i + 1) + ' 页', idx: i }));
    }
    tocEl.innerHTML = items.map(it =>
      `<div class="lib-toc-item${it.idx === currentPos() ? ' on' : ''}" data-i="${it.idx}">${it.label}</div>`).join('');
    tocEl.querySelectorAll('.lib-toc-item').forEach(el => el.addEventListener('click', async () => {
      const i = +el.dataset.i;
      if (ctl.book.meta.format === 'epub') ctl.chapterIdx = i; else ctl.pageIdx = i;
      await showCurrent();
    }));
  }

  // ==================== 阅读渲染 ====================
  async function textPagesHtml(idx) {
    const b = ctl.book;
    if (b.meta.format === 'epub') {
      const item = b.epub.spine[idx];
      const ch = await b.epub.loadChapter(item);
      return ch.html;
    }
    return textPageToHtml(b.textBook.pages[idx]);
  }

  async function imagePageUrl(idx) {
    const b = ctl.book;
    if (b.meta.format === 'manga-folder') {
      return imageUrl(b.manga.chapters[idx].pages[0] ? b.manga.chapters[idx].pages[0] : '');
    }
    return b.cbz.loadPage(idx);
  }

  async function showCurrent() {
    const b = ctl.book;
    if (!b) return;
    // 漫画/PDF/分栏横排用全宽容器；纯文本纵向保留 760px 舒适宽
    const isImgOrFlow = b.meta.format === 'pdf' || b.meta.format === 'cbz' || b.meta.format === 'manga-folder' || ctl.mode !== 'scroll';
    pageEl.classList.toggle('lib-page--full', !!isImgOrFlow);
    pageEl.classList.remove('lib-manga-mode'); // 每次渲染前清模式类（漫画分支会按需重加，防文本/epub 串到漫画布局）
    contentEl.classList.toggle('lib-content--x', !!(ctl.mode !== 'scroll' && b.meta.format !== 'pdf'));
    applyTextStyle();
    if (b.meta.format === 'pdf') {
      pageEl.innerHTML = `<embed class="lib-pdf" src="${b.pdf.url}" type="application/pdf">`;
      updateProgressBar();
      renderToc();
      return;
    }
    const isImage = b.meta.format === 'cbz' || b.meta.format === 'manga-folder';
    if (ctl.mode === 'scroll') {
      // 滚动模式：全量串联
      if (isImage) {
        if (b.meta.format === 'manga-folder') {
          const ch = b.manga.chapters[ctl.pageIdx];
          const imgs = [];
          for (const p of ch.pages) imgs.push(`<img class="lib-manga-page" src="${await imageUrl(p)}" alt="">`);
          pageEl.innerHTML = imgs.join('');
        } else {
          const imgs = [];
          for (let i = 0; i < b.cbz.count; i++) imgs.push(`<img class="lib-manga-page" src="${await b.cbz.loadPage(i)}" alt="">`);
          pageEl.innerHTML = imgs.join('');
        }
        // 漫画滚动模式：滚动进度跟随（此前进度条失效）
        contentEl.onscroll = () => {
          const sh = contentEl.scrollHeight - contentEl.clientHeight;
          const pct = sh > 0 ? Math.round(contentEl.scrollTop / sh * 100) : 100;
          posEl.textContent = `${pct}%`;
          progFill.style.width = pct + '%';
        };
      } else {
        const total = totalPages();
        const htmls = [];
        for (let i = 0; i < total; i++) {
          const h = await textPagesHtml(i);
          htmls.push(`<div class="lib-scroll-page" data-i="${i}">${h}</div>`);
        }
        pageEl.innerHTML = htmls.join('<hr class="lib-page-sep">');
        // 滚动跟随进度
        const target = pageEl.querySelector(`[data-i="${currentPos()}"]`);
        if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
        contentEl.onscroll = () => {
          const pages = [...pageEl.querySelectorAll('.lib-scroll-page')];
          const mid = contentEl.scrollTop + contentEl.clientHeight / 3;
          let cur = 0;
          for (const p of pages) { if (p.offsetTop <= mid) cur = +p.dataset.i; }
          if (ctl.book.meta.format === 'epub') ctl.chapterIdx = cur; else ctl.pageIdx = cur;
          updateProgressBar();
        };
      }
    } else if (isImage) {
      // 图片类：单页=一图一屏（max-height 约束，杜绝底部被挡）；双页=中轴分割占满整格
      pageEl.classList.add('lib-manga-mode');
      if (b.meta.format === 'manga-folder') {
        // 扁平页流：单页=一张图，双页=相邻两张图（rtl 对调），章界自然跨越
        const flat = flatManga(b);
        const showImg = async (i) => `<img class="lib-manga-page" src="${await imageUrl(flat[i].path)}" alt="">`;
        ctl.pageIdx = Math.max(0, Math.min(ctl.pageIdx, flat.length - 1));
        if (ctl.mode === 'double' && ctl.pageIdx + 1 < flat.length) {
          let [l, r] = await Promise.all([showImg(ctl.pageIdx), showImg(ctl.pageIdx + 1)]);
          if (ctl.direction === 'rtl') [l, r] = [r, l];
          pageEl.innerHTML = `<div class="lib-double lib-double-full"><div>${l}</div><div>${r}</div></div>`;
        } else {
          pageEl.innerHTML = await showImg(ctl.pageIdx);
        }
      } else {
        const showOne = async (i) => `<img class="lib-manga-page" src="${await b.cbz.loadPage(i)}" alt="">`;
        if (ctl.mode === 'double' && ctl.pageIdx + 1 < b.cbz.count) {
          let [l, r] = await Promise.all([showOne(ctl.pageIdx), showOne(ctl.pageIdx + 1)]);
          if (ctl.direction === 'rtl') [l, r] = [r, l];
          pageEl.innerHTML = `<div class="lib-double lib-double-full"><div>${l}</div><div>${r}</div></div>`;
        } else {
          pageEl.innerHTML = await showOne(ctl.pageIdx);
        }
      }
    } else {
      // 文本类：单页/双页 = CSS 分栏横排仿书页（整书串联，章末自动续，一屏刚好一屏）
      const total = totalPages();
      const unit = b.meta.format === 'epub' ? '章' : '页';
      const htmls = [];
      for (let i = 0; i < total; i++) {
        const h = await textPagesHtml(i);
        htmls.push(`<span class="lib-chap-mark" data-i="${i}"></span>${i > 0 ? `<div class="lib-chap-sep">—— 第 ${i + 1} ${unit} ——</div>` : ''}${h}`);
      }
      pageEl.innerHTML = `<div class="lib-flow-wrap"><div class="lib-flow">${htmls.join('')}</div></div>`;
      const wrap = pageEl.querySelector('.lib-flow-wrap');
      // 翻页方向：rtl 时列从右排起（日漫习惯）
      wrap.style.direction = ctl.direction === 'rtl' ? 'rtl' : '';
      const flow = pageEl.querySelector('.lib-flow');

      // —— 切片定位：translateX(-offset) 平移内容显示当前屏（epub.js/foliate-js 正宗分页） ——
      const applyOffset = (off, smooth = false) => {
        const wrapW = wrap.clientWidth || 1;
        const max = Math.max(0, flow.scrollWidth - wrapW);
        ctl._flowOffset = Math.max(0, Math.min(off, max));
        flow.style.transition = smooth ? 'transform .22s ease' : '';
        flow.style.transform = `translateX(${-ctl._flowOffset}px)`;
        // 进度比例
        ctl._flowRatio = max > 0 ? ctl._flowOffset / max : 0;
        // 同步 currentPos（TOC 高亮用）：找当前屏最近的章标记
        const x = ctl._flowOffset + 4;
        const marks = [...flow.querySelectorAll('.lib-chap-mark')];
        // 布局有效性判定：全部 offsetLeft 相同=布局未就绪（jsdom 契约环境），此时不动 chapterIdx——
        // 否则全标记匹配误取最后一章（「打开就跳到第 2/2 章」的契约实锤）
        const layoutValid = marks.length > 1 && marks.some((m, i) => i > 0 && m.offsetLeft !== marks[0]?.offsetLeft);
        if (layoutValid) {
          let cur2 = 0;
          for (const mk of marks) { if (mk.offsetLeft <= x) cur2 = +mk.dataset.i; }
          if (ctl.book?.meta.format === 'epub') ctl.chapterIdx = cur2; else ctl.pageIdx = cur2;
        }
        updateProgressBar();
        ctl._flowHideT && clearTimeout(ctl._flowHideT);
        ctl._flowHideT = setTimeout(saveProgress, 600);
      };

      const layOut = () => {
        // 可视宽回退链：innerHTML 同步读 clientWidth 常为 0/旧值（超宽总根）——RAF 后必修正
        const w = wrap.parentElement?.clientWidth || pageEl.clientWidth || 0;
        if (!w) return;
        const gap = ctl.mode === 'double' ? 48 : 0;
        let pageW;
        if (ctl.mode === 'double') {
          // 双页：栏宽=半屏（中轴分割）
          pageW = Math.floor((w - gap) / 2);
        } else {
          // 单页：页宽=窗格宽×百分比（默认 70%——epub.js 正宗：页宽跟容器/窗格百分比走，不写死 px）
          const pct = ctl.pageWidth > 0 ? Math.min(ctl.pageWidth, 1) : 0.7;
          pageW = Math.floor(w * pct);
        }
        ctl._pageW = pageW;
        // 容器固定宽：单页=页宽，双页=2×页宽+gap（**容器永不超宽**——切片的核心，告别 overflow-x 全宽滚动）
        const wrapW = ctl.mode === 'double' ? Math.min(pageW * 2 + gap, w) : Math.min(pageW, w);
        wrap.style.width = wrapW + 'px';
        wrap.style.margin = '0 auto';
        wrap.style.overflow = 'hidden';
        // 内容分栏：栏宽=页宽（双页栏宽=半屏），高=容器高
        flow.style.columnWidth = pageW + 'px';
        flow.style.columnGap = gap + 'px';
        flow.style.height = '100%';
        // 保持当前屏位比例重定位
        applyOffset((ctl._flowRatio || 0) * Math.max(0, flow.scrollWidth - wrapW));
      };
      layOut();
      // 布局落定后必重排一次（同步读宽不可靠：目录开合/字号/窗格拖变全要跟上）
      requestAnimationFrame(() => { layOut(); });
      setTimeout(() => layOut(), 300);
      // 窗格拖动/窗口缩放实时跟随
      if (typeof ResizeObserver !== 'undefined') {
        if (ctl._flowRO) ctl._flowRO.disconnect();
        ctl._flowRO = new ResizeObserver(() => layOut());
        ctl._flowRO.observe(pageEl);
      }
      ctl._flowWrap = wrap;
      // 切片翻页口：步进=容器宽（单页+页宽，双页+2×页宽）
      ctl._flowNav = async (delta) => {
        // 章节显式步进：布局未就绪（jsdom 契约环境 clientWidth=0）时 translateX 无效，
        // 但 chapterIdx/pageIdx 必须走——否则翻页后进度文本不动（契约 2/2 实锤）
        const total = totalPages();
        if (ctl.book?.meta.format === 'epub') ctl.chapterIdx = Math.max(0, Math.min(ctl.chapterIdx + delta, total - 1));
        else ctl.pageIdx = Math.max(0, Math.min(ctl.pageIdx + delta, total - 1));
        if (!wrap.clientWidth) {
          // 布局未就绪：translateX 无效，回退 showCurrent 同步重排并落进度（契约「进度应写入」实锤）
          await showCurrent();
          return;
        }
        const step = wrap.clientWidth || ctl._pageW || 1;
        applyOffset((ctl._flowOffset || 0) + delta * step, true);
      };
      ctl._flowLayout = () => { layOut(); updateProgressBar(); };
      // 定位：有分栏屏位比例优先按比例恢复屏位（根治重开跳章首），否则锚到 currentPos 章标记
      if (typeof ctl._pendingRatio === 'number') {
        applyOffset(ctl._pendingRatio * Math.max(0, flow.scrollWidth - (wrap.clientWidth || 1)));
        ctl._pendingRatio = null;
      } else {
        const anchor = flow.querySelector(`[data-i="${currentPos()}"]`);
        if (anchor) applyOffset(anchor.offsetLeft);
        else applyOffset(0);
      }
    }
    if (ctl.mode !== 'scroll' && !(ctl._flowWrap && !isImage && b.meta.format !== 'pdf')) contentEl.scrollTop = 0;
    updateProgressBar();
    renderToc();
    saveProgress();
  }

  async function nav(delta) {
    const b = ctl.book;
    if (!b || b.meta.format === 'pdf') return;
    // 切片横排（文本类单/双页）：整屏平移翻页（容器宽步进，章末自然续章）
    if (ctl._flowNav && ctl.mode !== 'scroll' && b.meta.format !== 'cbz' && b.meta.format !== 'manga-folder') {
      await ctl._flowNav(delta);
      return;
    }
    const total = totalPages();
    const step = ctl.mode === 'double' ? delta * 2 : delta; // 扁平化后漫画文件夹双页也按图×2步进
    if (b.meta.format === 'epub') ctl.chapterIdx = Math.min(Math.max(ctl.chapterIdx + step, 0), total - 1);
    else ctl.pageIdx = Math.min(Math.max(ctl.pageIdx + step, 0), total - 1);
    await showCurrent();
  }

  // ==================== 阅读主题与样式 ====================
  function applyReadTheme() {
    const t = READ_THEMES[ctl.readTheme] || READ_THEMES.paper;
    contentEl.style.background = t.bg;
    pageEl.style.background = t.bg;
    pageEl.style.color = t.fg;
    applyTextStyle();
  }
  function applyTextStyle() {
    pageEl.style.fontSize = ctl.fontSize + 'px';
    pageEl.style.lineHeight = ctl.lineHeight;
    if (ctl.fontFamily) pageEl.style.fontFamily = ctl.fontFamily;
  }

  // ==================== 书签 ====================
  async function getMarks() {
    return (await window.mazz.invoke('settings:get', { key: MARKS_KEY }).catch(() => ({}))) || {};
  }
  async function addMark() {
    if (!ctl.book) return;
    const name = await inputModal('书签名称', `第 ${currentPos() + 1} 页`);
    if (name == null) return;
    const all = await getMarks();
    const list = all[ctl.book.meta.id] || [];
    list.push({ name: name.trim() || `第 ${currentPos() + 1} 页`, pos: currentPos(), at: Date.now() });
    all[ctl.book.meta.id] = list;
    window.mazz.invoke('settings:set', { key: MARKS_KEY, value: all });
    toast('书签已添加');
  }
  async function showMarks() {
    if (!ctl.book) return;
    const all = await getMarks();
    const list = all[ctl.book.meta.id] || [];
    if (!list.length) { toast('还没有书签'); return; }
    const m = document.createElement('div');
    m.className = 'mazz-palette-mask';
    m.innerHTML = `<div class="mazz-palette" style="padding:16px 18px;min-width:320px">
      <b>书签</b>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;max-height:50vh;overflow-y:auto">
        ${list.map((mk, i) => `<div style="display:flex;gap:6px;align-items:center">
          <button class="rb-btn" data-i="${i}" style="flex:1;flex-direction:row;justify-content:flex-start">🔖 ${mk.name}</button>
          <button class="rb-btn" data-del="${i}" title="删除">✕</button></div>`).join('')}
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.remove(); });
    m.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', async () => {
      const mk = list[+btn.dataset.i];
      if (ctl.book.meta.format === 'epub') ctl.chapterIdx = mk.pos; else ctl.pageIdx = mk.pos;
      m.remove();
      await showCurrent();
    }));
    m.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      list.splice(+btn.dataset.del, 1);
      all[ctl.book.meta.id] = list;
      window.mazz.invoke('settings:set', { key: MARKS_KEY, value: all });
      m.remove();
      showMarks();
    }));
  }

  // ==================== 书内搜索 ====================
  function showSearch() {
    if (!ctl.book || ctl.book.meta.format === 'pdf') { toast('PDF 请用内建查找'); return; }
    const bar = document.createElement('div');
    bar.className = 'lib-search-bar';
    bar.innerHTML = `<input class="rb-input" placeholder="书内搜索…" spellcheck="false"><button class="rb-btn">搜</button><button class="rb-btn lib-search-close">✕</button>`;
    root.querySelector('.lib-reader-bar').appendChild(bar);
    const input = bar.querySelector('input');
    input.focus();
    const doSearch = async () => {
      const q = input.value.trim();
      if (!q) return;
      const b = ctl.book;
      const hits = [];
      if (b.meta.format === 'epub') {
        for (let i = 0; i < b.epub.spine.length; i++) {
          const ch = await b.epub.loadChapter(b.epub.spine[i]);
          if (ch.html.replace(/<[^>]+>/g, '').toLowerCase().includes(q.toLowerCase())) hits.push({ label: (b.epub.toc[i]?.label || `第 ${i + 1} 节`) + '', idx: i });
        }
      } else if (b.textBook) {
        b.textBook.pages.forEach((p, i) => { if (p.toLowerCase().includes(q.toLowerCase())) hits.push({ label: `第 ${i + 1} 页`, idx: i }); });
      } else { toast('该格式不支持书内搜索'); bar.remove(); return; }
      const r = document.createElement('div');
      r.className = 'lib-search-results';
      r.innerHTML = hits.length
        ? hits.slice(0, 30).map(h => `<div class="lib-toc-item" data-i="${h.idx}">${h.label}</div>`).join('')
        : '<div style="padding:8px;color:var(--fg-dim)">无结果</div>';
      tocEl.style.display = 'block';
      tocEl.innerHTML = '';
      tocEl.appendChild(r);
      r.querySelectorAll('[data-i]').forEach(el => el.addEventListener('click', async () => {
        const i = +el.dataset.i;
        if (ctl.book.meta.format === 'epub') ctl.chapterIdx = i; else ctl.pageIdx = i;
        r.remove();
        bar.remove();
        renderToc();
        await showCurrent();
      }));
    };
    bar.querySelector('.rb-btn:not(.lib-search-close)').addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); e.stopPropagation(); });
    bar.querySelector('.lib-search-close').addEventListener('click', () => { bar.remove(); renderToc(); });
  }

  // ==================== 导出 ====================
  async function exportBookMarkdown(book) {
    const target = book || ctl.book?.meta;
    if (!target) return;
    if (target.format !== 'epub') { toast('仅 epub 支持整书导出 Markdown'); return; }
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
  root.querySelector('.lib-cat-filter').addEventListener('change', (e) => {
    ctl.catFilter = e.target.value;
    renderShelf();
  });
  root.querySelector('[data-a=newcat]').addEventListener('click', async () => {
    const books = await getShelf();
    const renderCatMgr = async () => {
      const cats = await getCats();
      return cats.map(c => {
        const n = books.filter(b => b.category === c).length;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bd,#eee)">
          <span style="flex:1">${c} <span style="color:var(--fg-dim);font-size:11px">（${n} 本）</span></span>
          <button class="fc-mini" data-delcat="${c}" style="color:var(--danger)">删除</button></div>`;
      }).join('') || '<div style="color:var(--fg-dim);padding:8px 0">还没有自定义分类</div>';
    };
    const m = modal('分类管理');
    m.body.innerHTML = `
      <div style="min-width:340px">
        <div class="cat-list">${await renderCatMgr()}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <input class="rb-input cat-newname" placeholder="新分类名" style="flex:1">
          <button class="rb-btn cat-add" style="flex-direction:row">＋ 新建</button>
        </div>
        <div style="font-size:11px;color:var(--fg-dim);margin-top:6px">删除分类不会删书，书自动归到「未分类」。</div>
      </div>`;
    m.body.querySelector('.cat-add').addEventListener('click', async () => {
      const name = m.body.querySelector('.cat-newname').value.trim();
      if (!name) return;
      const cats = await getCats();
      if (!cats.includes(name)) { cats.push(name); await saveCats(cats); }
      m.body.querySelector('.cat-list').innerHTML = await renderCatMgr();
      m.body.querySelector('.cat-newname').value = '';
      bindDel();
      renderShelf();
    });
    const bindDel = () => m.body.querySelectorAll('[data-delcat]').forEach(btn => btn.addEventListener('click', async () => {
      const c = btn.dataset.delcat;
      const ok = await window.mazz.invoke('dialog:confirm', { title: '删除分类', message: `删除分类「${c}」？其下书籍归入未分类。`, buttons: ['删除', '取消'] }).catch(() => 1);
      if (ok !== 0) return;
      await saveCats((await getCats()).filter(x => x !== c));
      // 归类：该分类的书全部回未分类
      const shelf = await getShelf();
      for (const b of shelf) if (b.category === c) b.category = '未分类';
      await saveShelf(shelf);
      if (ctl.catFilter === c) ctl.catFilter = '';
      m.body.querySelector('.cat-list').innerHTML = await renderCatMgr();
      bindDel();
      renderShelf();
    }));
    bindDel();
  });
  root.querySelector('[data-a=batch]').addEventListener('click', () => {
    ctl.batchMode = !ctl.batchMode;
    ctl.batchSel.clear();
    root.querySelector('.lib-batch-bar').style.display = ctl.batchMode ? 'flex' : 'none';
    renderShelf();
  });
  root.querySelector('[data-a=sel-all]').addEventListener('click', async () => {
    (await getShelf()).forEach(b => ctl.batchSel.add(b.id));
    renderShelf();
  });
  root.querySelector('[data-a=sel-none]').addEventListener('click', () => { ctl.batchSel.clear(); renderShelf(); });
  root.querySelector('[data-a=sel-moveto]').addEventListener('click', async () => {
    if (!ctl.batchSel.size) { toast('先勾选书籍'); return; }
    const cats = await allCats();
    const m = document.createElement('div');
    m.className = 'mazz-palette-mask';
    m.innerHTML = `<div class="mazz-palette" style="padding:16px 18px;min-width:280px"><b>${ctl.batchSel.size} 本移到分类</b>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
        ${cats.map(c => `<button class="rb-btn" data-c="${c}" style="flex-direction:row;justify-content:flex-start">${c}</button>`).join('')}
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.remove(); });
    m.querySelectorAll('[data-c]').forEach(btn => btn.addEventListener('click', async () => {
      const books = await getShelf();
      for (const b of books) if (ctl.batchSel.has(b.id)) b.category = btn.dataset.c;
      await saveShelf(books);
      ctl.batchSel.clear();
      m.remove();
      renderShelf();
      toast('已批量移动');
    }));
  });
  root.querySelector('[data-a=sel-del]').addEventListener('click', async () => {
    if (!ctl.batchSel.size) { toast('先勾选书籍'); return; }
    const r = await window.mazz.invoke('dialog:confirm', { title: '删除', message: `把 ${ctl.batchSel.size} 本移出书架？（不删源文件）`, buttons: ['删除', '取消'] });
    if (r === 0) await removeBooks([...ctl.batchSel]);
  });
  root.querySelector('[data-a=sel-done]').addEventListener('click', () => {
    ctl.batchMode = false;
    ctl.batchSel.clear();
    root.querySelector('.lib-batch-bar').style.display = 'none';
    renderShelf();
  });
  root.querySelector('[data-a=import]').addEventListener('click', importBook);
  root.querySelector('[data-a=import-folder]').addEventListener('click', importMangaFolder);
  root.querySelector('[data-a=back]').addEventListener('click', () => {
    readerView.style.display = 'none';
    shelfView.style.display = 'flex';
    ctl.book = null;
    window.MazzHost?.setTabTitle(container, '📚 书库');
    renderShelf();
  });
  root.querySelector('[data-a=toc]').addEventListener('click', () => {
    tocEl.style.display = tocEl.style.display === 'none' ? 'block' : 'none';
    // 目录开合 → 内容区宽度变化 → 分栏/双页重排（用户要求目录打开时自适应中轴分割）
    setTimeout(() => ctl._flowLayout?.(), 50);
  });
  root.querySelector('[data-a=search]').addEventListener('click', showSearch);
  root.querySelector('[data-a=mark]').addEventListener('click', addMark);
  root.querySelector('[data-a=marks]').addEventListener('click', showMarks);
  // 选区缓存：点「摘录」按钮时焦点转移会把正文选区折叠清空（实时 getSelection 必空=「无法摘录」总根）
  document.addEventListener('selectionchange', () => {
    const t = (window.getSelection()?.toString() || '').trim();
    if (t) ctl._lastSel = t;
  });
  root.querySelector('[data-a=clip]').addEventListener('click', async () => {
    const text = (window.getSelection()?.toString() || '').trim() || ctl._lastSel || '';
    if (!text) { toast('先选中一段文字'); return; }
    window.__libClipText = text; // 桥接命令直接读缓存（桥内同样被折叠坑）
    window.MazzCommands.execute('bridge.libToNote');
  });
  root.querySelector('[data-a=export-md]').addEventListener('click', () => exportBookMarkdown());
  root.querySelector('[data-a=prev]').addEventListener('click', () => nav(-1));
  root.querySelector('[data-a=next]').addEventListener('click', () => nav(1));
  root.querySelector('[data-a=direction]').addEventListener('click', (e) => {
    ctl.direction = ctl.direction === 'ltr' ? 'rtl' : 'ltr';
    e.currentTarget.classList.toggle('on', ctl.direction === 'rtl');
    e.currentTarget.title = ctl.direction === 'rtl' ? '翻页方向：右到左（日漫）⇄' : '翻页方向：左到右 ⇄';
    toast(ctl.direction === 'rtl' ? '右到左翻页（日漫习惯）' : '左到右翻页');
    showCurrent();
  });
  root.querySelector('.lib-mode').addEventListener('change', (e) => {
    ctl.mode = e.target.value;
    contentEl.onscroll = null;
    ctl._flowWrap = null;
    ctl._flowLayout = null;
    showCurrent();
  });
  root.querySelector('.lib-read-theme').addEventListener('change', (e) => {
    ctl.readTheme = e.target.value;
    applyReadTheme();
  });
  root.querySelector('[data-a=font-minus]').addEventListener('click', () => {
    ctl.fontSize = Math.max(12, ctl.fontSize - 1);
    applyTextStyle();
  });
  root.querySelector('.lib-pagew').addEventListener('change', (e) => {
    ctl.pageWidth = +e.target.value;
    if (ctl._flowLayout) ctl._flowLayout();
  });
  ctl.pageWidth = ctl.pageWidth ?? 0.7; // 仅初始化：0.7=窗格 70%（百分比，随窗格走；0=也按 70% 兜底）
  root.querySelector('[data-a=font-plus]').addEventListener('click', () => {
    ctl.fontSize = Math.min(32, ctl.fontSize + 1);
    applyTextStyle();
  });
  // 阅读滚轮：默认向下翻/滚，Ctrl+滚轮字号缩放（漫画为图宽缩放）
  contentEl.addEventListener('wheel', (e) => {
    if (!ctl.book || ctl.book.meta.format === 'pdf') return;
    e.preventDefault();
    const isImage = ctl.book.meta.format === 'cbz' || ctl.book.meta.format === 'manga-folder';
    if (e.ctrlKey || e.metaKey) {
      if (isImage) {
        // 漫画：Ctrl+滚轮缩放图宽（60%–130%）
        ctl.mangaZoom = Math.min(130, Math.max(50, (ctl.mangaZoom || 100) + (e.deltaY < 0 ? 5 : -5)));
        pageEl.querySelectorAll('.lib-manga-page').forEach(img => { img.style.width = ctl.mangaZoom + '%'; });
        toast('图宽 ' + ctl.mangaZoom + '%');
      } else {
        ctl.fontSize = Math.min(32, Math.max(12, ctl.fontSize + (e.deltaY < 0 ? 1 : -1)));
        applyTextStyle();
        ctl._flowLayout?.(); // 分栏重排
      }
      return;
    }
    if (ctl.mode === 'scroll') {
      contentEl.scrollTop += e.deltaY; // 滚动模式自然滚
      return;
    }
    if (ctl._flowWrap && !isImage) {
      // 分栏横排：滚轮横翻（带阈值防抖）
      const now = Date.now();
      if (Math.abs(e.deltaY) >= 20 && now - (ctl._flowWheelT || 0) > 220) {
        ctl._flowWheelT = now;
        nav(e.deltaY > 0 ? 1 : -1);
      }
      return;
    }
    if (Math.abs(e.deltaY) < 24) return;
    nav(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  // 进度条：3 秒无操作自动收起（可折叠）；peek/底部热区展开，交互重置计时
  const progBar = root.querySelector('.lib-progress');
  const progPeek = root.querySelector('.lib-progress-peek');
  let progTimer = null, progManualFold = false;
  function progShow(sticky = false) {
    progBar.classList.remove('collapsed');
    progPeek.style.display = 'none';
    clearTimeout(progTimer);
    if (!sticky) progTimer = setTimeout(progHide, 3000);
  }
  function progHide(manual = false) {
    if (manual) progManualFold = true; // 手动收起=粘滞：别再用鼠标一晃就顶出来挡字
    progBar.classList.add('collapsed');
    progPeek.style.display = 'block';
  }
  progPeek.addEventListener('click', () => { progManualFold = false; progShow(); });
  root.querySelector('[data-a=prog-fold]').addEventListener('click', () => progHide(true));
  contentEl.addEventListener('pointermove', () => { if (!progManualFold) progShow(); });
  contentEl.addEventListener('wheel', () => { if (!progManualFold) progShow(); }, { passive: true });
  progBar.addEventListener('pointerenter', () => { if (!progManualFold) progShow(true); }); // 手动折叠态：鼠标压上来也不顶回（此前无条件 progShow 抵消手动折叠）
  progBar.addEventListener('pointerleave', () => { if (!progManualFold) progShow(); }); // 同上：离开也不许把刚折叠的进度栏拉回来
  progShow();

  // 阅读页右键：摘录/复制/字号/返回
  pageEl.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const { showDomMenu } = await import('../../lib/dom-menu.js');
    const sel = (window.getSelection()?.toString() || '').trim();
    showDomMenu([
      { label: '摘录到书摘笔记', fn: () => window.MazzCommands.execute('bridge.libToNote'), disabled: !sel },
      { label: '复制选中', fn: () => navigator.clipboard?.writeText(sel), disabled: !sel },
      '-',
      { label: '字号 +', fn: () => { ctl.fontSize = Math.min(32, ctl.fontSize + 1); applyTextStyle(); } },
      { label: '字号 −', fn: () => { ctl.fontSize = Math.max(12, ctl.fontSize - 1); applyTextStyle(); } },
      { label: '添加书签', fn: () => addMark() },
      '-',
      { label: '返回书架', fn: () => root.querySelector('[data-a=back]').click() },
    ], e.clientX, e.clientY);
  });

  // 「下载站」：投稿会话打开电子书站（cookie 持久，下载的 epub/mobi/pdf 自动存工作区书库并入库）
  root.querySelector('[data-a=dl-site]')?.addEventListener('click', async () => {
    // 预置公版/正版电子书站（投稿会话打开，cookie 持久；下载自动入库）
    const { showDomMenu } = await import('../../lib/dom-menu.js');
    const SITES = [
      ['书格（古籍公版高清）', 'https://shuge.org'],
      ['好读（台湾公版精校）', 'https://haodoo.net'],
      ['Project Gutenberg（公版英文）', 'https://www.gutenberg.org'],
      ['标准网（epub 精校）', 'https://standardebooks.org'],
      ['— 自定义站点…', ''],
    ];
    const rect = root.querySelector('[data-a=dl-site]').getBoundingClientRect();
    showDomMenu(SITES.map(([label, url]) => ({
      label,
      fn: async () => {
        let target = url;
        if (!target) {
          const { inputModal } = await import('../../shell/shell.js');
          target = (await inputModal('打开电子书站（登录一次后长期有效）', 'https://'))?.trim();
          if (!target) return;
        }
        window.MazzShell.openTab('browser', { title: '电子书下载站', content: '' });
        setTimeout(() => window.__activeBrowserCtl?.openTabRaw(target, { partition: 'persist:mazz-author' }), 800);
        toast('在打开的站点里登录并下载——电子书会自动入库');
      },
    })), rect.left, rect.bottom + 4);
  });

  // 投稿会话下载完成 → 自动入库
  if (window.mazz?.on) {
    window.mazz.on('library:download', async ({ path, name }) => {
      try {
        await importPath(path);
        toast(`📚 已自动入库：${name}`);
        renderShelf();
      } catch (e) { toast('入库失败：' + e.message); }
    });
  }

  ctl.importBook = importBook;
  ctl.importPath = importPath;
  ctl.importMangaFolderPath = importMangaFolderPath;
  ctl.renderShelf = renderShelf;
  ctl.openBook = openBook;
  ctl.exportBookMarkdown = exportBookMarkdown;

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
    window.__activeLibraryCtl = ctl;
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return JSON.stringify({ mark: 'mazz-library-v2', bookId: ctl?.book?.meta?.id || null });
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj?.bookId) ctl.openBook?.(obj.bookId);
    } catch {}
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.renderShelf();
  },
  getCharCount() { return 0; },
  getCursorPos() { return '书库'; },
  /** 从文件路径直接入库并打开 */
  async importPath(path, state) {
    const ctl = instances.get(state.container);
    return ctl?.importPath(path);
  },
  /** 从文件夹路径直接入库为漫画 */
  async importMangaFolderPath(path, state) {
    const ctl = instances.get(state.container);
    return ctl?.importMangaFolderPath(path);
  },

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
      { id: 'library.import', title: '导入书籍（epub/cbz/txt/mobi/azw3/pdf）', group: '书库',
        run: () => current?.importBook() },
      { id: 'library.exportMd', title: '导出当前书籍为 Markdown', group: '书库',
        run: () => current?.exportBookMarkdown() },
    ],
    keybindings: [],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
