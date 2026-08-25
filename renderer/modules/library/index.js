// renderer/modules/library/index.js —— 自建书库（Neat Reader 级）
// 书架：分类自定义/封面自定义/批量增删 · 阅读室：进度条(页数+百分比)/大纲侧栏/三模式/缩放/主题/书签/书内搜索
import { iconHtml } from '../../lib/svg-icons.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast, modal } from '../../shell/shell.js';
import { parseEpub } from './epub.js';
import { readBookCache, writeBookCache } from './cache.js';
import { rulesForBook, processHtmlText } from './clean.js';
import { parseCbz, makeBytesPager } from './cbz.js';
import { parseMobi, paginateText, textPageToHtml, inspectMobiStructure, imageBytesToDataUrl } from './mobi.js';
import { buildMangaBook, imageUrl } from './manga.js';
import { applyComicFitVariables, createComicViewport } from './comic-viewport.js';
import { createTextViewport } from './text-viewport.js';
import { planSpread } from './spread-planner.js';
import { COVER_LIMITS, persistCover } from './cover-cache.js';
import { createLibraryLocatorStore, mergeLocatorRecords } from './locator-store.js';
import { canonicalWorkspace, createLibraryRepository } from './repository.js';
import { drainAcquisitionInbox } from './acquisition-inbox.js';
import { createLibraryResourceSurface } from './resource-surface.js';
import { createReaderInput } from './reader-input.js';
import { createReaderPreferencesStore, appearanceForReaderController } from './reader-prefs.js';
import { createShelfViewModel } from './shelf-model.js';
import { createLibraryShelfView } from './shelf-view.js';
import { exportEpubMarkdownRaw, searchEpubRaw } from './book-operations.js';
import {
  advancePhysicalPage,
  chapterBridgeLocator,
  chapterBridgeOffset,
  computeReaderPageGeometry,
  normalizeReaderMargin,
  normalizeReaderMode,
  pagedSectionWindow,
  physicalPageOffset,
  spreadOffsetForPhysicalPage,
} from './reader-pagination.js';

const MODULE = 'library';
const instances = new Map();
let current = null;
// Import work is shared across every Library tab in this renderer. A source
// path and, after hashing, a content fingerprint both converge to one durable
// receipt; otherwise two tabs can return different ids for the same copy.
const sourceImportInFlight = new Map();
const contentImportInFlight = new Map();
const destinationImportTails = new Map();

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
export const LIBRARY_SOURCE_LIMITS = Object.freeze({
  archiveBytes: 128 * 1024 * 1024,
  textBytes: 32 * 1024 * 1024,
  coverBytes: COVER_LIMITS.inputBytes,
});
const READ_THEMES = {
  paper: { name: '纸白', bg: '#fbf8f0', fg: '#3d3627' },
  sepia: { name: '羊皮纸', bg: '#f1e8d0', fg: '#4a3d28' },
  night: { name: '墨夜', bg: '#1c1f26', fg: '#c9cdd6' },
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const normalizedPath = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/**
 * `fs:stat` is allowed to fail for permission/transport reasons.  Only an
 * explicit negative result with no contradictory error code, or ENOENT, is
 * evidence that the source itself disappeared.
 */
export function isExplicitMissingSourceStat(stat) {
  if (!stat || stat.exists !== false) return false;
  const code = String(stat.code || stat.errorCode || '').trim().toUpperCase();
  return !code || code === 'ENOENT';
}
export function librarySourceLimit(format) {
  return String(format || '').toLowerCase() === 'txt'
    ? LIBRARY_SOURCE_LIMITS.textBytes
    : LIBRARY_SOURCE_LIMITS.archiveBytes;
}
export function assertLibrarySourceWithinLimit(stat, format, label = '书籍') {
  const size = Number(stat?.size);
  const limit = librarySourceLimit(format);
  if (!Number.isFinite(size) || size < 0 || size <= limit) return limit;
  const error = new Error(`${label}过大：当前安全读取上限为 ${Math.round(limit / 1024 / 1024)} MiB`);
  error.code = 'LIBRARY_SOURCE_TOO_LARGE';
  error.size = size;
  error.limit = limit;
  throw error;
}
const insideWorkspace = (file, workspace) => {
  const child = normalizedPath(file), root = normalizedPath(workspace);
  return !!root && (child === root || child.startsWith(root + '/'));
};
async function shortFingerprint(bytes) {
  try {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...hash.subarray(0, 10)].map(n => n.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 2166136261;
    for (const n of bytes) { h ^= n; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
function importOwnerError() {
  return Object.assign(new Error('工作区已切换；请在当前工作区重新执行导入'), {
    code: 'LIBRARY_WORKSPACE_OWNER_CHANGED',
  });
}

function withImportTail(key, work) {
  const previous = destinationImportTails.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(work);
  destinationImportTails.set(key, task);
  return task.finally(() => {
    if (destinationImportTails.get(key) === task) destinationImportTails.delete(key);
  });
}

function disposeBookHandle(book) {
  if (!book) return;
  clearTimeout(book._appearanceTimer);
  book._appearanceTimer = null;
  book._pendingAppearance = null;
  try { book._comicViewport?.destroy?.(); } catch {}
  try { book._textViewport?.destroy?.(); } catch {}
  try { book.cbz?.unloadAll?.(); } catch {}
  try { book.epub?.unloadAll?.(); } catch {}
  try {
    if (book.pdf?._objectUrl?.startsWith?.('blob:')) URL.revokeObjectURL(book.pdf._objectUrl);
  } catch {}
}

export function decodeText(bytes) {
  const input = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes?.buffer || bytes || new ArrayBuffer(0), bytes?.byteOffset || 0, bytes?.byteLength);
  if (input[0] === 0xff && input[1] === 0xfe) return new TextDecoder('utf-16le').decode(input);
  if (input[0] === 0xfe && input[1] === 0xff) return new TextDecoder('utf-16be').decode(input);
  // TextDecoder is non-fatal by default: malformed UTF-8 becomes U+FFFD and
  // never reaches a catch block, which made the old GBK fallback unreachable.
  // Probe strictly, then decode the complete stream with the winning codec.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(input); } catch {}
  try { return new TextDecoder('gb18030', { fatal: true }).decode(input); } catch {}
  try { return new TextDecoder('gbk').decode(input); } catch {}
  return new TextDecoder('windows-1252').decode(input);
}

export function shouldTreatMobiAsComic({ imageCount = 0, text = '' } = {}) {
  // A successful MOBI parser already rejects skeleton/junk streams. Any
  // surviving readable text, however short (poem, captioned picture book), is
  // authoritative; image fallback is reserved for a truly textless owner.
  return Number(imageCount) >= 3 && String(text || '').trim().length === 0;
}

function createLibrary(container) {
  const root = document.createElement('div');
  root.className = 'lib-root';
  root.innerHTML = `
    <div class="lib-shelf-view">
      <div class="lib-shelf-head">
        <b>${iconHtml('📚')} 我的书库</b>
        <div class="lib-view-switch" role="tablist" aria-label="书库视图">
          <button class="rb-btn on" role="tab" aria-selected="true" data-a="view-shelf">书架</button>
          <button class="rb-btn" role="tab" aria-selected="false" data-a="view-resource">资源</button>
        </div>
        <button class="rb-btn" data-a="dl-site" title="打开电子书站（普通下载；入库需明确授权或手动导入）" style="font-size:11.5px">${iconHtml('⬇')} 下载站</button>
        <span class="lib-count"></span>
        <select class="lib-cat-filter rb-select" title="按分类筛选"></select>
        <button class="rb-btn" data-a="newcat" title="分类管理（新建/删除）">${iconHtml('✚')} 分类</button>
        <span style="flex:1"></span>
        <button class="rb-btn" data-a="batch" title="批量管理（多选删除）">${iconHtml('☑')} 批量管理</button>
        <button class="rb-btn" data-a="import">${iconHtml('＋')} 导入书籍</button>
        <button class="rb-btn" data-a="import-folder" title="把一个图片文件夹当漫画看（每话=一个图片子文件夹）">${iconHtml('🗂')} 导入漫画文件夹</button>
      </div>
      <div class="lib-shelf-toolbar" role="search" aria-label="书架检索与筛选">
        <label class="lib-shelf-query-wrap">${iconHtml('🔍')}<span class="sr-only">搜索书架</span><input class="lib-shelf-query rb-input" type="search" placeholder="搜索书名、作者、分类…" autocomplete="off" spellcheck="false"></label>
        <select class="lib-shelf-sort rb-select" title="书架排序">
          <option value="recent">最近阅读</option><option value="title">书名</option><option value="author">作者</option>
          <option value="progress">阅读进度</option><option value="imported">最近导入</option>
        </select>
        <button class="rb-btn lib-shelf-favorite" data-a="shelf-favorite" aria-pressed="false" title="只看收藏">${iconHtml('☆')}<span>收藏</span></button>
        <select class="lib-shelf-format rb-select" title="按格式筛选"><option value="">全部格式</option></select>
        <select class="lib-shelf-missing rb-select" title="按源文件状态筛选">
          <option value="all">全部状态</option><option value="available">文件可用</option><option value="only">文件缺失</option>
        </select>
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
    <div class="lib-resource-view" style="display:none">
      <div class="lib-resource-head">
        <button class="rb-btn" data-resource-back>${iconHtml('←')} 书架</button>
        <div>
          <b>资源</b>
          <span class="lib-resource-summary">正在读取持久资源账…</span>
        </div>
        <span style="flex:1"></span>
        <button class="rb-btn" data-resource-refresh>刷新</button>
        <button class="rb-btn" data-resource-repair>修复状态</button>
      </div>
      <div class="lib-resource-searchbar">
        <input class="rb-input lib-resource-query" type="search" placeholder="搜索官方目录中的书名或作者…" autocomplete="off" spellcheck="false">
        <div class="lib-resource-providers"></div>
        <button class="rb-btn" data-resource-search>搜索</button>
        <button class="rb-btn" data-resource-more hidden>继续下一页</button>
      </div>
      <div class="lib-resource-scroll">
        <details class="lib-resource-config">
          <summary>来源与法域设置</summary>
          <div class="lib-resource-form-grid">
            <label>Catalog contact<input class="rb-input lib-resource-contact" placeholder="email 或公共 HTTPS 联系页"></label>
            <label>法域<select class="rb-select lib-resource-jurisdiction"><option value="">未指定</option><option value="US">US</option></select></label>
            <button class="rb-btn" data-resource-save-config>保存基本设置</button>
          </div>
          <div class="lib-resource-opds-list"></div>
          <div class="lib-resource-form-grid lib-resource-opds-form">
            <input class="rb-input lib-resource-opds-provider" placeholder="provider-id">
            <input class="rb-input lib-resource-opds-name" placeholder="显示名称">
            <input class="rb-input lib-resource-opds-root" placeholder="https://…/catalog">
            <input class="rb-input lib-resource-opds-search" placeholder="https://…?q={query}">
            <select class="rb-select lib-resource-opds-version"><option value="1.2">OPDS 1.2</option><option value="2.0">OPDS 2.0</option></select>
            <button class="rb-btn" data-resource-add-opds>添加自有 OPDS</button>
          </div>
          <p class="lib-resource-note">只接受无凭据的公共 HTTPS OPDS；自有 OPDS 的权利状态始终为“未知”，不会因配置来源而自动授权下载。</p>
        </details>
        <details class="lib-resource-manual">
          <summary>手动 HTTPS 候选</summary>
          <div class="lib-resource-form-grid">
            <input class="rb-input lib-resource-manual-url" placeholder="https://…/book.epub">
            <input class="rb-input lib-resource-manual-title" placeholder="书名">
            <input class="rb-input lib-resource-manual-authors" placeholder="作者（逗号分隔）">
            <input class="rb-input lib-resource-manual-language" placeholder="语言（可空）">
            <select class="rb-select lib-resource-manual-format"><option>epub</option><option>pdf</option><option>txt</option><option>mobi</option><option>azw3</option><option>cbz</option></select>
            <button class="rb-btn" data-resource-add-manual>保存候选</button>
          </div>
          <p class="lib-resource-note">手动地址只建立候选，默认 Rights=unknown；本波不会把“有 URL”当成“有权获取”。</p>
        </details>
        <section class="lib-resource-section">
          <h3>候选与版本</h3>
          <div class="lib-resource-candidates"></div>
        </section>
        <section class="lib-resource-section">
          <h3>取得与修复</h3>
          <div class="lib-resource-jobs"></div>
        </section>
      </div>
    </div>
    <div class="lib-reader" style="display:none">
      <div class="lib-reader-bar">
        <button class="rb-btn" data-a="back">${iconHtml('←')}<span>书架</span></button>
        <span class="lib-book-title"></span>
        <span style="flex:1"></span>
        <button class="rb-btn" data-a="toc" title="大纲/目录">${iconHtml('≡')}</button>
        <button class="rb-btn" data-a="search" title="书内搜索">${iconHtml('🔍')}</button>
        <button class="rb-btn" data-a="mark" title="添加书签">${iconHtml('🔖')}</button>
        <button class="rb-btn" data-a="marks" title="书签列表">${iconHtml('☰')}</button>
        <button class="rb-btn" data-a="clip" title="选中文字摘录到书摘笔记">${iconHtml('✍')} 摘录</button>
        <button class="rb-btn" data-a="evidence" title="复制可重新定位的证据引用">${iconHtml('⌖')} 证据定位</button>
        <button class="rb-btn" data-a="export-md" title="整书导出为 Markdown 笔记">${iconHtml('⇪')}</button>
        <button class="rb-btn" data-a="direction" title="翻页方向：左到右 / 右到左（日漫习惯）">${iconHtml('⇄')}</button>
        <select class="lib-mode rb-select" title="阅读模式">
          <option value="single">单页</option><option value="double">双页</option><option value="scroll">滚动</option>
        </select>
        <select class="lib-read-theme rb-select" title="阅读主题">
          ${Object.entries(READ_THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
        </select>
        <button class="rb-btn" data-a="font-minus" title="字号减小"><span data-ui-icon-text>A</span>${iconHtml('―')}</button>
        <button class="rb-btn" data-a="font-plus" title="字号增大"><span data-ui-icon-text>A</span>${iconHtml('+')}</button>
        <select class="lib-pagew rb-select" title="纸张宽度（版心留白另行设置）">
          <option value="0.5">页宽 50%</option><option value="0.6">页宽 60%</option>
          <option value="0.7" selected>页宽 70%</option><option value="0.8">页宽 80%</option>
          <option value="1">全宽 100%</option>
        </select>
        <select class="lib-margin rb-select" title="版心留白（独立于纸张宽度）">
          <option value="compact">版心 紧凑</option><option value="comfortable" selected>版心 舒适</option>
          <option value="spacious">版心 宽松</option>
        </select>
        <select class="lib-zh rb-select" title="简繁转换（OpenCC 字表+高频词纠偏，随书记忆）">
          <option value="">原文</option><option value="t2s">转简体</option><option value="s2t">转繁体</option>
        </select>
        <button class="rb-btn" data-a="clean-rules" title="净化规则（替换/删除，字面或正则，全书或本书——网文广告/水印清洗）">${iconHtml('⛨')} 净化</button>
      </div>
      <div class="lib-reader-main">
        <div class="lib-toc" style="display:none"></div>
        <div class="lib-content"><div class="lib-page"></div></div>
      </div>
      <div class="lib-progress" role="group" aria-label="阅读进度">
        <button class="rb-btn lib-progress-nav" type="button" data-a="prev" aria-label="上一页" title="上一页">‹</button>
        <div class="lib-prog-track" role="slider" tabindex="0" title="点击或使用方向键跳转" aria-label="跳转阅读进度" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="尚未开始">
          <div class="lib-prog-fill"></div>
        </div>
        <span class="lib-pos"><span class="lib-pos-location"></span><span class="lib-pos-separator" aria-hidden="true"> · </span><span class="lib-pos-percent"></span></span>
        <button class="rb-btn lib-progress-nav" type="button" data-a="next" aria-label="下一页" title="下一页">›</button>
        <button class="rb-btn lib-progress-toggle" type="button" data-a="prog-fold" aria-expanded="true" aria-label="收起阅读进度栏" title="收起阅读进度栏">
          <span class="lib-progress-toggle-icon" aria-hidden="true">${iconHtml('▾')}</span>
          <span class="lib-progress-toggle-label lib-progress-toggle-label--expanded">收起</span>
          <span class="lib-progress-toggle-label lib-progress-toggle-label--collapsed">展开</span>
        </button>
      </div>
    </div>`;
  container.appendChild(root);

  const shelfView = root.querySelector('.lib-shelf-view');
  const readerView = root.querySelector('.lib-reader');
  const shelfEl = root.querySelector('.lib-shelf');
  const tocEl = root.querySelector('.lib-toc');
  const pageEl = root.querySelector('.lib-page');
  const posEl = root.querySelector('.lib-pos');
  const posLocationEl = root.querySelector('.lib-pos-location');
  const posPercentEl = root.querySelector('.lib-pos-percent');
  const progTrack = root.querySelector('.lib-prog-track');
  const progFill = root.querySelector('.lib-prog-fill');
  const contentEl = root.querySelector('.lib-content');

  const ctl = {
    root, container,
    book: null, chapterIdx: 0, pageIdx: 0,
    fontSize: 16, fontFamily: '', lineHeight: 1.8, pageMargin: 'comfortable', turnEffect: 'fade',
    readTheme: 'paper', mode: 'single', direction: 'ltr', // ltr 左到右 | rtl 右到左（日漫）
    catFilter: '', batchMode: false, batchSel: new Set(),
    shelf: {
      records: [], progress: {}, categories: [], snapshot: null,
      query: '', sort: 'recent', favoriteOnly: false, format: '', missing: 'all',
      loadGen: 0, queryTimer: null, composing: false, model: null,
    },
    _destroyed: false, _destroying: false, _destroyPromise: null,
    _destroyReceipt: null, _destroyOutcomePromise: null, _resolveDestroyOutcome: null,
    _handoffProvisional: false, _handoffDiscardable: false,
    _openGen: 0, _searchGen: 0, _exportGen: 0,
    _lifecycleGen: 0, _ownedOverlays: new Set(),
    _acquisitionInboxOff: null,
    _resourceChangedOff: null,
  };

  // Back, workspace hand-off and tab destruction are independent async
  // durability transactions. They must never restore `root.inert` from a
  // stale boolean snapshot: whichever transaction finishes first would then
  // unlock (or permanently lock) the other one. Each transaction owns one
  // reason and releases only that reason.
  const inheritedLifecycleInert = !!root.inert;
  const lifecycleInertOwners = new Set();
  function syncLifecycleInert() {
    root.inert = inheritedLifecycleInert || lifecycleInertOwners.size > 0;
    return root.inert;
  }
  function acquireLifecycleInert(owner) {
    lifecycleInertOwners.add(owner);
    return syncLifecycleInert();
  }
  function releaseLifecycleInert(owner) {
    lifecycleInertOwners.delete(owner);
    return syncLifecycleInert();
  }

  function registerOwnedOverlay(element, close) {
    if (!element || typeof close !== 'function') return () => {};
    let finalized = false;
    let observer = null;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      observer?.disconnect();
      ctl._ownedOverlays.delete(dispose);
    };
    const dispose = () => {
      if (finalized) return;
      try { close(); } finally { finalize(); }
    };
    observer = new MutationObserver(() => {
      if (!element.isConnected) finalize();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctl._ownedOverlays.add(dispose);
    return dispose;
  }

  function ownModal(handle) {
    if (!handle?.el) return handle;
    handle.close = registerOwnedOverlay(handle.el, handle.close);
    return handle;
  }

  function ownMask(mask) {
    return registerOwnedOverlay(mask, () => mask.remove());
  }

  function ownDomMenu(menu) {
    if (!menu) return menu;
    registerOwnedOverlay(menu, () => menu.__mazzClose?.({ restoreFocus: false }));
    return menu;
  }

  function closeOwnedOverlays() {
    for (const dispose of [...ctl._ownedOverlays]) {
      try { dispose(); } catch {}
    }
    ctl._ownedOverlays.clear();
  }

  function ownedInputModal(title, initial = '') {
    return new Promise(resolve => {
      if (ctl._destroyed) { resolve(null); return; }
      const m = ownModal(modal(title));
      m.body.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;min-width:340px">
          <input class="rb-input lib-owned-input" style="flex:1;padding:6px 8px" value="${escapeHtml(initial)}">
          <button class="rb-btn lib-owned-input-ok" style="flex-direction:row">确定</button>
        </div>`;
      const input = m.body.querySelector('.lib-owned-input');
      let settled = false;
      const removalObserver = new MutationObserver(() => {
        if (!m.el.isConnected) finish(null, false);
      });
      const finish = (value, close = true) => {
        if (settled) return;
        settled = true;
        removalObserver.disconnect();
        if (close) m.close();
        resolve(value);
      };
      removalObserver.observe(document.documentElement, { childList: true, subtree: true });
      m.body.querySelector('.lib-owned-input-ok').addEventListener('click', () => finish(input.value));
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') finish(input.value);
        else if (event.key === 'Escape') finish(null);
        else return;
        event.stopPropagation();
      });
      requestAnimationFrame(() => { if (!ctl._destroyed && m.el.isConnected) input.focus(); });
    });
  }
  let repositoryBindingSeq = 0;

  function createRepositoryBinding(workspace) {
    const repository = createLibraryRepository({
      invoke: window.mazz.invoke.bind(window.mazz),
      ...(workspace !== undefined ? { workspace } : {}),
    });
    const ready = repository.init();
    const binding = {
      id: ++repositoryBindingSeq,
      repository,
      ready,
      locatorStore: null,
      pending: new Set(),
      retiring: false,
      acquisitionAbortController: new AbortController(),
      acquisitionDrain: null,
    };
    // Locator durability is deliberately closed over this repository rather
    // than the mutable active binding. A final position captured for workspace
    // A can therefore never be redirected into workspace B while A retires.
    const scopedProgressInvoke = async (channel, payload = {}) => {
      await ready;
      if (channel === 'settings:get') return repository.getValue('progress');
      if (channel === 'settings:set') {
        const patch = payload.libraryLocatorPatch;
        const bookId = String(patch?.bookId || '').trim();
        if (!bookId || !patch?.record || typeof patch.record !== 'object' || Array.isArray(patch.record)) {
          throw new Error('Library locator patch 无效');
        }
        return repository.mutate('progress', draft => {
          draft[bookId] = JSON.parse(JSON.stringify(patch.record));
          return draft;
        });
      }
      return window.mazz.invoke(channel, payload);
    };
    binding.locatorStore = createLibraryLocatorStore({
      invoke: scopedProgressInvoke,
      progress: window.MazzProgress,
    });
    return binding;
  }

  let repositoryBinding = createRepositoryBinding();
  let repository = repositoryBinding.repository;
  let repositoryReady = repositoryBinding.ready;
  let locatorStore = repositoryBinding.locatorStore;

  function installRepositoryBinding(binding) {
    repositoryBinding = binding;
    repository = binding.repository;
    repositoryReady = binding.ready;
    locatorStore = binding.locatorStore;
    ctl.repository = repository;
    ctl.locatorStore = locatorStore;
    ctl.repositoryBinding = binding;
  }

  function bindingOwnerError() {
    const error = importOwnerError();
    error.stale = true;
    return error;
  }

  function requireActiveBinding(binding = repositoryBinding) {
    if (ctl._destroyed || ctl._destroying || ctl._workspaceRebinding || binding !== repositoryBinding || binding.retiring) {
      throw bindingOwnerError();
    }
    return binding;
  }

  function trackBindingOperation(binding, operation) {
    const task = Promise.resolve(operation);
    binding.pending.add(task);
    task.finally(() => binding.pending.delete(task)).catch(() => {});
    return task;
  }

  async function readRepository(operation, binding = repositoryBinding) {
    requireActiveBinding(binding);
    await binding.ready;
    // Reads already in flight may finish against their immutable old owner.
    // Every UI caller also carries a generation/owner gate, so the result can
    // be discarded without ever being painted into the new workspace.
    return trackBindingOperation(binding, operation(binding.repository));
  }

  async function mutateRepository(partition, updater, binding = repositoryBinding) {
    requireActiveBinding(binding);
    await binding.ready;
    requireActiveBinding(binding);
    const operation = binding.repository.mutate(partition, updater);
    return (await trackBindingOperation(binding, operation)).value;
  }

  const getShelf = (binding = repositoryBinding) => readRepository(repo => repo.listBooks(), binding);
  const mutateShelf = async (updater, binding = repositoryBinding) => {
    requireActiveBinding(binding);
    await binding.ready;
    requireActiveBinding(binding);
    return (await trackBindingOperation(binding, binding.repository.mutateBooks(updater))).value;
  };
  const settleRetiringShelf = async (updater, binding) => {
    await binding.ready;
    return (await trackBindingOperation(binding, binding.repository.mutateBooks(updater))).value;
  };
  const getCats = (binding = repositoryBinding) => readRepository(repo => repo.getValue('categories'), binding);
  const getAllRules = (binding = repositoryBinding) => readRepository(repo => repo.getValue('cleanRules'), binding);
  const mutateAllRules = (updater, binding = repositoryBinding) => mutateRepository('cleanRules', updater, binding);
  installRepositoryBinding(repositoryBinding);

  function acquisitionBindingHasWriteAuthority(owner) {
    return owner === repositoryBinding
      && !owner.retiring
      && !ctl._destroyed
      && !ctl._destroying
      && !ctl._workspaceRebinding
      && !ctl._handoffProvisional
      && !ctl._handoffDiscardable;
  }

  function acquisitionBindingIsCurrent(owner) {
    return acquisitionBindingHasWriteAuthority(owner)
      && !owner.acquisitionAbortController?.signal.aborted;
  }

  function abortAcquisitionBinding(binding, reason) {
    ctl.resourceSurface?.abort?.();
    const controller = binding?.acquisitionAbortController;
    if (!controller || controller.signal.aborted) return false;
    const error = Object.assign(new Error(`Library Inbox replay stopped: ${reason}`), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
    controller.abort(error);
    return true;
  }

  function resumePendingAcquisition(binding = repositoryBinding) {
    if (!acquisitionBindingHasWriteAuthority(binding)) return Promise.resolve(null);
    const aborted = binding.acquisitionAbortController?.signal.aborted === true;
    if (!binding.acquisitionAbortController || aborted) {
      binding.acquisitionAbortController = new AbortController();
    }
    if (aborted && binding.acquisitionDrain) {
      const previous = binding.acquisitionDrain;
      return Promise.resolve(previous).catch(() => null).then(() => (
        acquisitionBindingIsCurrent(binding) ? drainPendingAcquisition(binding) : null
      ));
    }
    return drainPendingAcquisition(binding);
  }

  function drainPendingAcquisition(binding = repositoryBinding) {
    if (!acquisitionBindingIsCurrent(binding)) return Promise.resolve(null);
    if (binding.acquisitionDrain) return binding.acquisitionDrain;
    const operation = drainAcquisitionInbox({
      bridge: { invoke: window.mazz.invoke.bind(window.mazz) },
      repository: binding.repository,
      binding,
      bindingVerifier: ({ binding: owner }) => acquisitionBindingIsCurrent(owner),
      signal: binding.acquisitionAbortController.signal,
    }).then(async result => {
      // A shelf CAS may have succeeded even when the main-process completion
      // response failed. Any completed drain/list is therefore a reason to
      // re-read the durable shelf instead of trusting an earlier warm snapshot.
      if (result && acquisitionBindingIsCurrent(binding)) {
        await renderShelf({ reload: true }).catch(() => null);
      }
      return result;
    }).catch(error => {
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
          || error?.stale || error?.code === 'LIBRARY_INBOX_STALE_BINDING'
          || !acquisitionBindingHasWriteAuthority(binding)) return null;
      console.warn('[library-acquisition] Inbox replay:', error?.code || 'LIBRARY_INBOX_REPLAY_FAILED');
      return null;
    });
    const tracked = trackBindingOperation(binding, operation);
    binding.acquisitionDrain = tracked;
    tracked.finally(() => {
      if (binding.acquisitionDrain === tracked) binding.acquisitionDrain = null;
    }).catch(() => {});
    return tracked;
  }

  ctl.resumePendingAcquisition = () => resumePendingAcquisition(repositoryBinding);

  const resourceSurface = createLibraryResourceSurface({
    root,
    invoke: window.mazz.invoke.bind(window.mazz),
    getWorkspacePath: () => repositoryBinding.repository.identity?.canonical || '',
    canUse: () => acquisitionBindingHasWriteAuthority(repositoryBinding),
    track: operation => trackBindingOperation(repositoryBinding, operation),
    toast,
  });
  ctl.resourceSurface = resourceSurface;

  function readerAppearanceSnapshot() {
    return {
      mode: normalizeReaderMode(ctl.mode),
      direction: ctl.direction,
      font: ctl.fontFamily || '',
      fontSize: ctl.fontSize,
      lineHeight: ctl.lineHeight,
      pageWidth: ctl.pageWidth ?? 0.7,
      pageMargin: normalizeReaderMargin(ctl.pageMargin),
      turnEffect: 'fade',
      theme: ctl.readTheme,
      zoom: ctl.mangaZoom || 100,
      spread: {
        cover: ctl.spreadCoverSingle !== false,
        parity: Math.abs(Math.trunc(Number(ctl.spreadOffset) || 0)) % 2,
        fit: ctl.spreadFit || 'contain',
      },
    };
  }

  function queueReaderAppearance(owner = ctl.book, delay = 140) {
    if (!owner?._prefs || ctl._destroyed || ctl._handoffProvisional) return Promise.resolve({ ok: false, skipped: true });
    owner._pendingAppearance = readerAppearanceSnapshot();
    clearTimeout(owner._appearanceTimer);
    owner._appearanceTimer = setTimeout(() => {
      owner._appearanceTimer = null;
      const snapshot = owner._pendingAppearance;
      owner._pendingAppearance = null;
      if (snapshot) owner._prefs.saveAppearance(snapshot).catch?.(() => {});
    }, Math.max(0, Number(delay) || 0));
    return Promise.resolve({ ok: true, queued: true });
  }

  async function flushReaderAppearance(owner = ctl.book, { capture = true } = {}) {
    if (ctl._handoffProvisional) return [];
    if (!owner?._prefs) return [];
    if (capture && ctl.book === owner) owner._pendingAppearance = readerAppearanceSnapshot();
    clearTimeout(owner._appearanceTimer);
    owner._appearanceTimer = null;
    const snapshot = owner._pendingAppearance;
    owner._pendingAppearance = null;
    const committed = snapshot ? await owner._prefs.saveAppearance(snapshot) : null;
    const receipts = await owner._prefs.flush();
    const failed = [committed, ...(Array.isArray(receipts) ? receipts : [])]
      .filter(receipt => receipt?.ok === false);
    if (failed.length) {
      throw Object.assign(new Error('阅读外观偏好未能持久化'), {
        code: 'LIBRARY_APPEARANCE_DURABILITY_FAILED', receipts: failed,
      });
    }
    return receipts;
  }

  function syncReaderControls() {
    const values = new Map([
      ['.lib-mode', normalizeReaderMode(ctl.mode)],
      ['.lib-read-theme', ctl.readTheme],
      ['.lib-pagew', String(ctl.pageWidth ?? 0.7)],
      ['.lib-margin', normalizeReaderMargin(ctl.pageMargin)],
    ]);
    for (const [selector, value] of values) {
      const select = root.querySelector(selector);
      if (!select) continue;
      select.value = String(value);
      try { root._libSelectProxies?.get(selector)?.setCurrent(String(value)); } catch {}
    }
    const direction = root.querySelector('[data-a=direction]');
    direction?.classList.toggle('on', ctl.direction === 'rtl');
    if (direction) direction.title = ctl.direction === 'rtl'
      ? '翻页方向：右到左（日漫）⇄'
      : '翻页方向：左到右 ⇄';
  }

  function applyReaderAppearance(appearance) {
    const fields = appearanceForReaderController(appearance);
    ctl.mode = normalizeReaderMode(fields.mode);
    ctl.direction = fields.direction;
    ctl.fontFamily = fields.fontFamily;
    ctl.fontSize = fields.fontSize;
    ctl.lineHeight = fields.lineHeight;
    ctl.pageWidth = fields.pageWidth;
    ctl.pageMargin = fields.pageMargin;
    ctl.turnEffect = 'fade';
    ctl.readTheme = fields.readTheme;
    ctl.mangaZoom = fields.mangaZoom;
    ctl.spreadCoverSingle = fields.spreadCoverSingle;
    // spread-planner's public "parity" preference is its runtime offset.
    ctl.spreadOffset = fields.spreadParity;
    ctl.spreadFit = fields.spreadFit;
    syncReaderControls();
  }

  function scheduleReaderAction(action, { report = true } = {}) {
    const owner = ctl.book;
    const generation = ctl._openGen;
    const previous = ctl._readerActionTail || Promise.resolve();
    const task = previous.catch(() => false).then(async () => {
      if (ctl._destroyed || ctl._openGen !== generation || ctl.book !== owner) return false;
      return action();
    });
    const guarded = task.catch(error => {
      if (report && !ctl._destroyed && ctl._openGen === generation && ctl.book === owner) {
        toast('翻页失败：' + (error?.message || error));
      }
      return false;
    });
    ctl._readerActionTail = guarded;
    return guarded;
  }

  async function jumpReaderBoundary(toEnd) {
    if (!ctl.book || ctl.book.meta.format === 'pdf') return;
    const position = toEnd ? Math.max(0, totalPages() - 1) : 0;
    if (ctl.book.meta.format === 'epub') ctl.chapterIdx = position;
    else ctl.pageIdx = position;
    const textOwner = ['epub', 'txt', 'mobi', 'azw3'].includes(ctl.book.meta.format);
    ctl._pendingRatio = ctl.mode === 'scroll' && textOwner ? (toEnd ? 1 : 0) : null;
    ctl._pendingAnchor = ctl.mode !== 'scroll' && textOwner
      ? { kind: 'chapter-edge', edge: toEnd ? 'end' : 'start', m: position }
      : null;
    await showCurrent();
  }

  function handleReaderCommand(command, meta) {
    if (!ctl.book) return false;
    // 连续模式保留浏览器原生滚动语义。Page/Arrow/Space/Home/End 与
    // 触控滑动都不应被错误翻译为“重建下一章”。
    if (ctl.mode === 'scroll' && (meta?.source === 'swipe' || meta?.source === 'keyboard')
        && ['next', 'previous', 'first', 'last'].includes(command)) return false;
    if (command === 'next') { if (ctl.book.meta.format === 'pdf') return false; void scheduleReaderAction(() => nav(1)); return true; }
    if (command === 'previous') { if (ctl.book.meta.format === 'pdf') return false; void scheduleReaderAction(() => nav(-1)); return true; }
    if (command === 'first') { if (ctl.book.meta.format === 'pdf') return false; void scheduleReaderAction(() => jumpReaderBoundary(false)); return true; }
    if (command === 'last') { if (ctl.book.meta.format === 'pdf') return false; void scheduleReaderAction(() => jumpReaderBoundary(true)); return true; }
    if (command === 'search') { if (ctl.book.meta.format === 'pdf') return false; showSearch(); return true; }
    if (command === 'escape') {
      const search = root.querySelector('.lib-search-bar');
      if (search) { search.remove(); renderToc(); return true; }
      if (tocEl.style.display !== 'none') {
        tocEl.style.display = 'none';
        setTimeout(() => ctl._flowLayout?.(), 0);
        return true;
      }
    }
    return false;
  }

  const readerInput = createReaderInput({
    host: readerView,
    wheel: false, // 保留现有 scroll/paged/Ctrl+wheel 精细实现，避免双消费。
    getDirection: () => ctl.direction,
    onCommand: handleReaderCommand,
  });
  ctl.readerInput = readerInput;

  function handoffReaderFocus({ generation, owner, origin }) {
    return readerInput.requestFocus({
      frame: ctl._frame,
      fallback: contentEl,
      guard: () => {
        if (ctl._destroyed || ctl._openGen !== generation || ctl.book !== owner
            || readerView.style.display === 'none') return false;
        const active = document.activeElement;
        // The hidden shelf card still owns focus after Enter. Body/HTML cover
        // pointer-open browsers that do not focus role=button divs. Once the
        // user explicitly selects a reader toolbar control, none of these
        // cases match and every iframe/load retry permanently yields.
        return !active || active === document.body || active === document.documentElement
          || active === origin || !!origin?.contains?.(active)
          || active === ctl._frame || active === contentEl;
      },
    });
  }

  function openBookForUser(id, origin = document.activeElement) {
    return openBook(id, { focusReader: true, focusOrigin: origin });
  }

  const shelfRenderer = createLibraryShelfView({
    host: shelfEl,
    onOpen: (book, event) => openBookForUser(
      book.id,
      event?.target?.closest?.('.lib-card') || document.activeElement,
    ),
    onToggleBatch: (book, { checked }) => toggleBatchSel(book.id, checked),
    onContext: (book, event) => showBookMenu(event.clientX, event.clientY, book),
  });
  ctl.shelfView = shelfRenderer;

  // ==================== 书架 ====================
  async function allCats() {
    const saved = await getCats();
    return ['未分类', ...saved.filter(c => c !== '未分类')];
  }

  function setSelectOptions(select, entries, selected) {
    if (!select) return;
    const fragment = document.createDocumentFragment();
    for (const [value, label] of entries) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(label);
      option.selected = String(value) === String(selected ?? '');
      fragment.appendChild(option);
    }
    select.replaceChildren(fragment);
  }

  // A chapter's `ratio` is an in-chapter column position. Shelf cards need a
  // whole-book value and must never reinterpret that legacy field as 62% of
  // the book. The projection is a clone; the durable locator stays untouched.
  function shelfProgressProjection(raw) {
    const result = {};
    for (const [id, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const projected = { ...value };
      const total = Number(projected.totalPages ?? projected.totalChapters ?? projected.total);
      let overall = Number(projected.overallRatio ?? projected.pct);
      if (!Number.isFinite(overall) && Number.isFinite(total) && total > 0) {
        if (Number.isFinite(Number(projected.page))) overall = (Number(projected.page) + 1) / total;
        else if (Number.isFinite(Number(projected.chapter))) overall = (Number(projected.chapter) + 1) / total;
      }
      if (Number.isFinite(overall)) projected.ratio = Math.max(0, Math.min(1, overall));
      else delete projected.ratio;
      result[id] = projected;
    }
    return result;
  }

  function syncShelfFilters(snapshot) {
    const categoryEntries = [['', `全部（${snapshot.total}）`]];
    const categoryCounts = new Map(snapshot.facets.category.map(item => [item.key, item.count]));
    for (const category of ctl.shelf.categories) {
      categoryEntries.push([category, `${category}（${categoryCounts.get(category) || 0}）`]);
    }
    setSelectOptions(root.querySelector('.lib-cat-filter'), categoryEntries, ctl.catFilter);
    const formatEntries = [['', '全部格式'], ...snapshot.facets.format.map(item => [item.key, `${item.key.toUpperCase()}（${item.count}）`])];
    setSelectOptions(root.querySelector('.lib-shelf-format'), formatEntries, ctl.shelf.format);
    root.querySelector('.lib-shelf-sort').value = ctl.shelf.sort;
    root.querySelector('.lib-shelf-missing').value = ctl.shelf.missing;
    const favorite = root.querySelector('[data-a=shelf-favorite]');
    favorite.classList.toggle('on', ctl.shelf.favoriteOnly);
    favorite.setAttribute('aria-pressed', ctl.shelf.favoriteOnly ? 'true' : 'false');
    favorite.querySelector('svg')?.setAttribute('data-state', ctl.shelf.favoriteOnly ? 'on' : 'off');
    for (const selector of ['.lib-cat-filter', '.lib-shelf-sort', '.lib-shelf-format', '.lib-shelf-missing']) {
      const select = root.querySelector(selector);
      try { root._libSelectProxies?.get(selector)?.setCurrent(select?.value ?? ''); } catch {}
    }
  }

  function paintShelfState({ resetScroll = false } = {}) {
    const baseModel = ctl.shelf.model || createShelfViewModel({
      records: ctl.shelf.records, progress: ctl.shelf.progress,
    });
    const model = baseModel.with({
      query: ctl.shelf.query,
      sort: ctl.shelf.sort,
      filters: {
        category: ctl.catFilter,
        favorites: ctl.shelf.favoriteOnly,
        format: ctl.shelf.format,
        missing: ctl.shelf.missing,
      },
    });
    ctl.shelf.model = model;
    const snapshot = model.snapshot();
    ctl.shelf.snapshot = snapshot;
    syncShelfFilters(snapshot);
    if (resetScroll) shelfEl.scrollTop = 0;
    root.querySelector('.lib-count').textContent = snapshot.filteredTotal === snapshot.total
      ? `${snapshot.total} 本`
      : `${snapshot.filteredTotal} / ${snapshot.total} 本`;
    shelfRenderer.update({
      items: snapshot.items,
      batchMode: ctl.batchMode,
      selected: ctl.batchSel,
      emptyText: snapshot.total
        ? '没有符合当前搜索与筛选的书籍'
        : '书库空空如也——「导入书籍」放入第一本，或「导入漫画文件夹」开看漫画',
    });
    shelfEl.setAttribute('aria-busy', 'false');
    updateBatchBar();
    return snapshot;
  }

  async function renderShelf(options = {}) {
    const { reload = true, resetScroll = false } = options || {};
    if (reload || !ctl.shelf.records.length) {
      const generation = ++ctl.shelf.loadGen;
      const binding = repositoryBinding;
      shelfEl.setAttribute('aria-busy', 'true');
      let books, cats, progress;
      try {
        [books, cats, progress] = await Promise.all([
          getShelf(binding), getCats(binding).then(saved => ['未分类', ...saved.filter(c => c !== '未分类')]),
          readRepository(repo => repo.getValue('progress'), binding).catch(() => ({})),
        ]);
      } catch (error) {
        if (error?.stale || ctl._destroyed || binding !== repositoryBinding) return null;
        throw error;
      }
      if (ctl._destroyed || ctl._workspaceRebinding || binding !== repositoryBinding
          || generation !== ctl.shelf.loadGen) return null;
      ctl.shelf.records = books;
      ctl.shelf.categories = cats;
      ctl.shelf.progress = shelfProgressProjection(progress);
      ctl.shelf.model = createShelfViewModel({ records: books, progress: ctl.shelf.progress });
    }
    return paintShelfState({ resetScroll });
  }

  function toggleBatchSel(id, checked) {
    const shouldSelect = typeof checked === 'boolean' ? checked : !ctl.batchSel.has(id);
    if (shouldSelect) ctl.batchSel.add(id); else ctl.batchSel.delete(id);
    paintShelfState();
  }
  function updateBatchBar() {
    root.querySelector('.lib-batch-n').textContent = `已选 ${ctl.batchSel.size} 项`;
  }

  /** 书籍右键菜单：打开/封面/分类/导出/删除 */
  function showBookMenu(x, y, book) {
    if (!book || ctl._destroyed) return;
    const lifecycleGen = ctl._lifecycleGen;
    const alive = () => !ctl._destroyed && ctl._lifecycleGen === lifecycleGen;
    import('../../lib/dom-menu.js').then(({ showDomMenu }) => {
      if (!alive()) return;
      ownDomMenu(showDomMenu([
        { label: '打开', fn: () => { if (alive()) void openBookForUser(book.id); } },
        { label: '设置封面…', fn: () => { if (alive()) void setCustomCover(book); } },
        { label: '移到分类…', fn: () => { if (alive()) void moveBookCategory(book); } },
        { label: '书名与作者…', fn: () => { if (alive()) void editBookMeta(book); } },
        '-',
        ...(book.format === 'epub' ? [{ label: '导出为 Markdown 笔记', fn: () => { if (alive()) void exportBookMarkdown(book); } }] : []),
        { label: '移出书架', fn: () => { if (alive()) void removeBooks([book.id]); } },
      ], x, y));
    });
  }

  /** 自定义封面（漫画文件夹与无封面书籍通用） */
  /** 自定义书名与作者名（v35） */
  async function editBookMeta(book) {
    if (ctl._destroyed) return;
    const lifecycleGen = ctl._lifecycleGen;
    const bookId = book.id;
    const m = ownModal(modal('书名与作者'));
    m.body.innerHTML = `
      <div style="min-width:340px">
        <div class="set-row"><label>书名</label><input id="bm-title" class="rb-input" style="width:64%" value="${escapeHtml(book.title || '')}"></div>
        <div class="set-row"><label>作者</label><input id="bm-author" class="rb-input" style="width:64%" value="${escapeHtml(book.author || '')}" placeholder="可留空"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="bm-ok" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存</button></div>
      </div>`;
    m.body.querySelector('#bm-ok').addEventListener('click', async () => {
      const t = m.body.querySelector('#bm-title').value.trim();
      const a = m.body.querySelector('#bm-author').value.trim();
      if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) { m.close(); return; }
      const title = t || book.title || '';
      await mutateShelf(books => books.map(x => x.id === bookId ? { ...x, title, author: a } : x));
      if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) { m.close(); return; }
      book.title = title;
      book.author = a;
      renderShelf();
      if (ctl.book?.meta?.id === bookId) {
        root.querySelector('.lib-book-title').textContent = title;
        window.MazzHost?.setTabTitle(container, title);
      }
      toast('书名与作者已更新');
      m.close();
    });
  }

  async function setCustomCover(book) {
    if (ctl._destroyed) return;
    const lifecycleGen = ctl._lifecycleGen;
    const alive = () => !ctl._destroyed && ctl._lifecycleGen === lifecycleGen;
    const binding = repositoryBinding;
    const bookId = book.id;
    const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '图片', extensions: IMG_EXTS }] }).catch(() => null);
    if (!p || !alive()) return;
    const st = await window.mazz.invoke('fs:stat', { path: p }).catch(() => null);
    if (!alive()) return;
    if (Number(st?.size) > COVER_LIMITS.inputBytes) {
      toast(`封面文件过大（上限 ${Math.round(COVER_LIMITS.inputBytes / 1024 / 1024)} MiB）`);
      return;
    }
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p, maxBytes: COVER_LIMITS.inputBytes });
    if (!alive()) return;
    const ext = p.split('.').pop().toLowerCase();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const workspace = await captureImportWorkspace(binding);
    if (!alive()) return;
    const persisted = await trackBindingOperation(binding, persistCover({
      invoke: window.mazz.invoke.bind(window.mazz), workspace, bookId, bytes, ext,
    }));
    if (!alive() || binding.retiring || binding !== repositoryBinding) {
      if (persisted.coverPath) {
        await trackBindingOperation(
          binding,
          window.mazz.invoke('fs:delete', { path: persisted.coverPath }).catch(() => {}),
        );
      }
      return;
    }
    await captureImportWorkspace(binding);
    if (!alive()) return;
    const cover = persisted.cover || '';
    const coverPath = persisted.coverPath || '';
    await mutateShelf(books => books.map(x => x.id === bookId
      ? { ...x, cover, coverPath }
      : x), binding);
    if (!alive()) return;
    book.cover = cover;
    book.coverPath = coverPath;
    renderShelf();
    toast('封面已更新');
  }

  /** 移到分类 */
  async function moveBookCategory(book) {
    if (ctl._destroyed) return;
    const lifecycleGen = ctl._lifecycleGen;
    const bookId = book.id;
    const cats = await allCats();
    if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) return;
    const m = document.createElement('div');
    m.className = 'mazz-palette-mask';
    m.innerHTML = `<div class="mazz-palette" style="padding:16px 18px;min-width:280px">
      <b>移到分类</b>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
        ${cats.map(c => `<button class="rb-btn" data-c="${escapeHtml(c)}" style="flex-direction:row;justify-content:flex-start">${(book.category || '未分类') === c ? iconHtml('✓') : ''}<span>${escapeHtml(c)}</span></button>`).join('')}
      </div></div>`;
    document.body.appendChild(m);
    const closeMask = ownMask(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeMask(); });
    m.querySelectorAll('[data-c]').forEach(btn => btn.addEventListener('click', async () => {
      const category = btn.dataset.c;
      if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) { closeMask(); return; }
      await mutateShelf(books => books.map(x => x.id === bookId ? { ...x, category } : x));
      if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) { closeMask(); return; }
      book.category = category;
      renderShelf();
      closeMask();
      toast(`已移到「${category}」`);
    }));
  }

  async function removeBooks(ids) {
    if (ctl._destroyed) return;
    await mutateShelf(books => books.filter(x => !ids.includes(x.id)));
    for (const id of ids) ctl.batchSel.delete(id);
    if (ctl._destroyed) return;
    renderShelf();
    toast(`已移出 ${ids.length} 本`);
  }

  // ==================== 导入 ====================
  async function importBook() {
    if (ctl._destroyed || ctl._destroying || ctl._workspaceRebinding) return null;
    const binding = repositoryBinding;
    const p = await window.mazz.invoke('dialog:openFile', {
      filters: [{ name: '电子书/漫画/文档', extensions: ['epub', 'cbz', 'txt', 'mobi', 'azw3', 'pdf'] }],
      multi: true,
    });
    if (!p || binding !== repositoryBinding || binding.retiring || ctl._workspaceRebinding) return null;
    const paths = Array.isArray(p) ? p : [p];
    let ok = 0;
    for (const path of paths) {
      const id = await importPath(path, { silent: paths.length > 1 });
      if (id) ok++;
    }
    if (paths.length > 1) toast(`批量导入完成：${ok}/${paths.length} 本入库`);
  }

  async function importMangaFolder() {
    if (ctl._destroyed || ctl._destroying || ctl._workspaceRebinding) return null;
    const binding = repositoryBinding;
    const dir = await window.mazz.invoke('dialog:openFolder').catch(() => null);
    if (dir && binding === repositoryBinding && !binding.retiring && !ctl._workspaceRebinding) {
      await importMangaFolderPath(dir);
    }
  }

  async function captureImportWorkspace(binding = repositoryBinding) {
    requireActiveBinding(binding);
    await binding.ready;
    requireActiveBinding(binding);
    const raw = (await window.mazz.invoke('workspace:get').catch(() => '')) || '';
    requireActiveBinding(binding);
    if (canonicalWorkspace(raw) !== binding.repository.identity.canonical) throw importOwnerError();
    return raw;
  }

  async function cleanupImportPaths(paths) {
    for (const path of [...new Set((paths || []).filter(Boolean))]) {
      await window.mazz.invoke('fs:delete', { path }).catch(() => {});
    }
  }

  async function materializeWorkspaceImport({ workspace, name, b64, fingerprint, binding }) {
    await captureImportWorkspace(binding);
    if (window.mazz.isElectron === true) {
      const receipt = await window.mazz.invoke('library:importMaterialize', {
        workspace, name, base64: b64, fingerprint,
      });
      if (!receipt?.path || !insideWorkspace(receipt.path, workspace)) {
        throw Object.assign(new Error('主进程返回了无效的书库导入路径'), {
          code: 'LIBRARY_IMPORT_INVALID_RECEIPT',
        });
      }
      return receipt;
    }

    // Browser/Capacitor preview has no shared Electron main process.  Retain a
    // local collision-safe fallback there; desktop imports must never enter it.
    const extDot = name.lastIndexOf('.');
    const stem = extDot > 0 ? name.slice(0, extDot) : name;
    const suffix = extDot > 0 ? name.slice(extDot) : '';
    const root = workspace.replace(/[\\/]+$/, '');
    let dest = `${root}/书库/${name}`;
    if ((await window.mazz.invoke('fs:stat', { path: dest }).catch(() => null))?.exists) {
      dest = `${root}/书库/${stem} (${fingerprint.slice(0, 8)})${suffix}`;
      let serial = 2;
      while ((await window.mazz.invoke('fs:stat', { path: dest }).catch(() => null))?.exists) {
        dest = `${root}/书库/${stem} (${fingerprint.slice(0, 8)}-${serial++})${suffix}`;
      }
    }
    await captureImportWorkspace(binding);
    await window.mazz.invoke('fs:writeFileBase64', { path: dest, base64: b64 });
    return { path: dest, created: true, fallback: true, sourceHash: fingerprint };
  }

  async function finalizeWorkspaceImport(receipt, keep) {
    if (!receipt?.created) return { ok: true, owned: false };
    if (receipt.fallback) {
      if (!keep && receipt.path) await window.mazz.invoke('fs:delete', { path: receipt.path });
      return { ok: true, owned: true, kept: !!keep, deleted: !keep };
    }
    return window.mazz.invoke('library:importFinalize', {
      receiptId: receipt.receiptId, keep: keep === true,
    });
  }

  async function importMangaFolderPath(dir) {
    toast('正在解析漫画文件夹…');
    const binding = repositoryBinding;
    try {
      await captureImportWorkspace(binding);
      const book = await buildMangaBook(dir);
      const cover = await imageUrl(book.chapters[0].pages[0]);
      await captureImportWorkspace(binding);
      const id = 'bk' + Date.now().toString(36);
      const updated = await mutateShelf(books => [...books, {
        id, title: book.title, author: '', cover, path: dir, sourcePath: dir,
        format: 'manga-folder', category: '未分类', addedAt: Date.now(), repositoryScope: 'external',
      }], binding);
      try { await captureImportWorkspace(binding); }
      catch (error) {
        // Compensate only through the immutable old binding. The rebind gate
        // tracks this task and will not install the new owner until it settles.
        await settleRetiringShelf(books => books.filter(item => item.id !== id), binding);
        throw error;
      }
      const durableId = updated.find(item => normalizedPath(item.sourcePath || item.path) === normalizedPath(dir))?.id || id;
      toast(`《${book.title}》已入库（${book.chapters.length} 话 ${book.chapters.reduce((n, c) => n + c.pages.length, 0)} 页）`);
      renderShelf();
      await openBookForUser(durableId);
      return durableId;
    } catch (e) {
      toast('导入失败：' + (e.message || e));
      return null;
    }
  }

  async function commitPreparedImport({ p, ext, name, b64, bytes, fingerprint }, binding) {
    requireActiveBinding(binding);
    const contentKey = `${binding.repository.identity.hash}\u0000${fingerprint}`;
    const existing = contentImportInFlight.get(contentKey);
    if (existing) return existing;

    const task = (async () => {
      let temporaryHandle = null;
      let importReceipt = null;
      const createdPaths = [];
      const id = 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      try {
        const initialBooks = await getShelf(binding);
        const initialDuplicate = initialBooks.find(book => book.sourceHash === fingerprint
          || normalizedPath(book.sourcePath || book.path) === normalizedPath(p));
        if (initialDuplicate) return { id: initialDuplicate.id, title: initialDuplicate.title, duplicate: true };

        let meta;
        let coverSpec = null;
        if (ext === 'epub') {
          const epub = await parseEpub(bytes.buffer);
          temporaryHandle = epub;
          if (epub.coverRaw) {
            const coverBytes = await epub.readZipBytes(epub.coverRaw.zipPath, { maxBytes: COVER_LIMITS.inputBytes });
            if (coverBytes) coverSpec = { bytes: coverBytes, ext: epub.coverRaw.ext };
          }
          meta = { title: epub.title, author: epub.author, cover: '' };
        } else if (ext === 'cbz') {
          const cbz = await parseCbz(bytes.buffer);
          temporaryHandle = cbz;
          const rawCover = await cbz.readPage(0, { maxBytes: COVER_LIMITS.inputBytes });
          if (rawCover?.bytes) coverSpec = { bytes: rawCover.bytes, mime: rawCover.mime };
          meta = { title: name.replace(/\.cbz$/i, ''), author: '', cover: '' };
        } else if (ext === 'mobi' || ext === 'azw3') {
          const inspection = inspectMobiStructure(bytes.buffer);
          if (inspection.imageDominant) {
            const firstImage = inspection.images[0];
            if (firstImage?.bytes) coverSpec = { bytes: firstImage.bytes, mime: firstImage.mime };
            meta = {
              title: inspection.title !== '未命名' ? inspection.title : name.replace(/\.(mobi|azw3)$/i, ''),
              author: inspection.author || '',
              cover: '',
            };
          } else {
            const mobi = await parseMobi(bytes.buffer);
            meta = {
              title: mobi.title !== '未命名' ? mobi.title : name.replace(/\.(mobi|azw3)$/i, ''),
              author: mobi.author,
              cover: '',
            };
          }
        } else if (ext === 'txt' || ext === 'pdf') {
          meta = { title: name.replace(/\.[^.]+$/, ''), author: '', cover: '' };
        } else {
          throw Object.assign(new Error(`暂不支持 .${ext}（请先用 Calibre 转换）`), { code: 'LIBRARY_UNSUPPORTED_FORMAT' });
        }

        let workspace = await captureImportWorkspace(binding);
        if (coverSpec) {
          const persisted = await persistCover({
            invoke: window.mazz.invoke.bind(window.mazz), workspace, bookId: id, ...coverSpec,
          });
          meta.cover = persisted.cover || '';
          if (persisted.coverPath) createdPaths.push(persisted.coverPath);
          workspace = await captureImportWorkspace(binding);
        }

        const destinationKey = `${binding.repository.identity.hash}\u0000${normalizedPath(name)}`;
        return await withImportTail(destinationKey, async () => {
          workspace = await captureImportWorkspace(binding);
          const currentBooks = await getShelf(binding);
          const duplicate = currentBooks.find(book => book.sourceHash === fingerprint
            || normalizedPath(book.sourcePath || book.path) === normalizedPath(p));
          if (duplicate) {
            await cleanupImportPaths(createdPaths);
            return { id: duplicate.id, title: duplicate.title, duplicate: true };
          }

          let dest = p;
          let authoritativeFingerprint = fingerprint;
          if (workspace && !insideWorkspace(p, workspace)) {
            importReceipt = await materializeWorkspaceImport({ workspace, name, b64, fingerprint, binding });
            dest = importReceipt.path;
            authoritativeFingerprint = importReceipt.sourceHash || fingerprint;
          }

          await captureImportWorkspace(binding);
          const record = {
            id, title: meta.title, author: meta.author || '', cover: meta.cover || '',
            path: dest, sourcePath: p, sourceHash: authoritativeFingerprint, format: ext,
            category: '未分类', addedAt: Date.now(),
          };
          if (!workspace || !insideWorkspace(dest, workspace)) record.repositoryScope = 'external';
          const durableBooks = await mutateShelf(books => {
            const existingBook = books.find(book => book.sourceHash === authoritativeFingerprint
              || normalizedPath(book.sourcePath || book.path) === normalizedPath(p));
            return existingBook ? books : [...books, record];
          }, binding);
          const durable = durableBooks.find(book => book.sourceHash === authoritativeFingerprint
            || normalizedPath(book.sourcePath || book.path) === normalizedPath(p));

          if (durable?.id !== id) {
            await finalizeWorkspaceImport(importReceipt, false).catch(() => null);
            importReceipt = null;
            await cleanupImportPaths(createdPaths);
            return { id: durable?.id, title: durable?.title || meta.title, duplicate: true };
          }

          try { await captureImportWorkspace(binding); }
          catch (error) {
            await settleRetiringShelf(books => books.filter(book => book.id !== id), binding);
            throw error;
          }
          // Once the repository points at our copy it must never be removed,
          // even if acknowledging the receipt is interrupted by teardown.
          await finalizeWorkspaceImport(importReceipt, true).catch(() => null);
          importReceipt = null;
          return { id: durable.id, title: durable.title || meta.title, duplicate: false };
        });
      } catch (error) {
        await finalizeWorkspaceImport(importReceipt, false).catch(() => null);
        importReceipt = null;
        await cleanupImportPaths(createdPaths);
        throw error;
      } finally {
        try { temporaryHandle?.unloadAll?.(); } catch {}
      }
    })();
    contentImportInFlight.set(contentKey, task);
    return task.finally(() => {
      if (contentImportInFlight.get(contentKey) === task) contentImportInFlight.delete(contentKey);
    });
  }

  async function prepareImport(p, binding) {
    await captureImportWorkspace(binding);
    const ext = p.split('.').pop().toLowerCase();
    const name = p.split(/[\\/]/).pop();
    const sourceStat = await window.mazz.invoke('fs:stat', { path: p });
    const maxBytes = assertLibrarySourceWithinLimit(sourceStat, ext, name || '书籍');
    const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p, maxBytes });
    await captureImportWorkspace(binding);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fingerprint = await shortFingerprint(bytes);
    return commitPreparedImport({ p, ext, name, b64, bytes, fingerprint }, binding);
  }

  async function importPath(p, { silent = false } = {}) {
    const name = String(p || '').split(/[\\/]/).pop();
    if (!p || !name) return null;
    if (!silent) toast('正在解析 ' + name + '…');
    const binding = repositoryBinding;
    await binding.ready;
    requireActiveBinding(binding);
    const sourceKey = `${binding.repository.identity.hash}\u0000${normalizedPath(p)}`;
    let task = sourceImportInFlight.get(sourceKey);
    if (!task) {
      task = trackBindingOperation(binding, prepareImport(p, binding));
      sourceImportInFlight.set(sourceKey, task);
      task.finally(() => {
        if (sourceImportInFlight.get(sourceKey) === task) sourceImportInFlight.delete(sourceKey);
      }).catch(() => {});
    }
    try {
      const receipt = await task;
      requireActiveBinding(binding);
      if (!receipt?.id) return null;
      await renderShelf();
      if (!silent) {
        toast(receipt.duplicate ? `《${receipt.title}》已在书架中` : `《${receipt.title}》已入库`);
        await openBookForUser(receipt.id);
      }
      return receipt.id;
    } catch (e) {
      if (!silent) toast('导入失败：' + (e.message || e));
      return null;
    }
  }

  // ==================== 阅读室 ====================
  function withOpenCommit(work) {
    const previous = ctl._openCommitTail || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    ctl._openCommitTail = gate;
    return previous.catch(() => {}).then(work).finally(() => {
      release();
      if (ctl._openCommitTail === gate) ctl._openCommitTail = null;
    });
  }

  async function openBook(id, { focusReader = false, focusOrigin = null } = {}) {
    readerInput.cancelFocusRequest();
    let binding;
    try { binding = requireActiveBinding(repositoryBinding); }
    catch { return false; }
    const gen = ++ctl._openGen;
    const book = (await getShelf(binding)).find(b => b.id === id);
    if (ctl._destroyed || gen !== ctl._openGen) return false;
    if (!book) { toast('书籍不存在'); return false; }
    let candidate = { meta: { ...book } };
    let sourceStat = null;
    const stillCurrent = () => !ctl._destroyed && !ctl._workspaceRebinding
      && binding === repositoryBinding && !binding.retiring && gen === ctl._openGen;
    const readBytes = async () => {
      const maxBytes = assertLibrarySourceWithinLimit(sourceStat, book.format, book.title || '书籍');
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: book.path, maxBytes });
      if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };
    try {
      await binding.ready;
      // A transient repository read failure is not an empty locator ledger.
      // Opening at page one and later saving would overwrite the real last
      // position, so the candidate transaction fails closed here.
      const progress = (await readRepository(
        repo => repo.getValue('progress'), binding,
      )) || {};
      // R1：同步位置账按文件路径取件，覆盖旧版仅按 bookId 的单机记忆。
      const synced = window.MazzProgress?.get ? await window.MazzProgress.get('library', book.path).catch(() => null) : null;
      if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });
      if (synced?.value) progress[id] = mergeLocatorRecords(progress[id], synced);
      // 外观偏好与 locator 分账：候选书在解析期间就完成 workspace/book
      // scoped 加载，但直到整个候选可提交前绝不改写当前 controller。
      candidate._prefs = createReaderPreferencesStore({
        invoke: window.mazz.invoke.bind(window.mazz),
        workspace: binding.repository.identity.canonical,
        book,
      });
      candidate._repositoryBinding = binding;
      sourceStat = await window.mazz.invoke('fs:stat', { path: book.path }).catch(() => null);
      if (isExplicitMissingSourceStat(sourceStat)) {
        const error = new Error('源文件不存在或已移动');
        error.code = 'LIBRARY_SOURCE_MISSING';
        error.sourceMissing = true;
        throw error;
      }
      if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });
      let nextChapter = 0, nextPage = 0;
      if (book.format === 'epub') {
        // 缓存命中时不再先把整份源书读入 renderer；只有缓存失效才读取/解析源文件。
        const cached = sourceStat?.exists === true && await readBookCache(book.id, sourceStat, {
          workspace: binding.repository.identity.canonical,
          invoke: window.mazz.invoke.bind(window.mazz),
        }).catch(() => null);
        candidate.epub = cached || await parseEpub((await readBytes()).buffer);
        candidate.epub._srcStat = sourceStat?.exists === true ? sourceStat : null;
        const savedSpineId = progress[id]?.spineItemId;
        const remappedChapter = savedSpineId == null
          ? -1
          : candidate.epub.spine.findIndex(item => String(item?.id) === String(savedSpineId));
        nextChapter = Math.max(0, Math.min(
          remappedChapter >= 0 ? remappedChapter : (Number(progress[id]?.chapter) || 0),
          candidate.epub.spine.length - 1,
        ));
      } else if (book.format === 'manga-folder') {
        candidate.manga = await buildMangaBook(book.path);
        const flatCount = candidate.manga.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);
        nextPage = Math.max(0, Math.min(Number(progress[id]?.page) || 0, Math.max(0, flatCount - 1)));
      } else if (book.format === 'pdf') {
        if (window.mazz?.isElectron) candidate.pdf = { url: 'mazz-res://media/' + encodeURIComponent(book.path.replace(/\\/g, '/')) };
        else {
          const objectUrl = URL.createObjectURL(new Blob([(await readBytes()).buffer], { type: 'application/pdf' }));
          candidate.pdf = { url: objectUrl, _objectUrl: objectUrl };
        }
      } else if (book.format === 'txt' || book.format === 'mobi' || book.format === 'azw3') {
        const bytes = await readBytes();
        let parsedMobi = null;
        let mobiParseError = null;
        // 普通电子书也常含封面和插图：先做不解压正文的 PDB 结构探测。只有长图片序列
        // 且图像字节占绝对主导的出版物才直达漫画管线；其余仍以可读正文为权威。
        if (book.format !== 'txt') {
          const inspection = inspectMobiStructure(bytes.buffer);
          const imgs = inspection.images;
          if (inspection.imageDominant) {
            candidate.cbz = makeBytesPager(imgs, async (i) => imgs[i]);
            candidate.meta.format = 'cbz';
            candidate.mobiRoute = 'image-dominant';
            nextPage = Math.min(progress[id]?.page || 0, imgs.length - 1);
          } else {
            try { parsedMobi = await parseMobi(bytes.buffer); } catch (error) {
              if (error?.code === 'LIBRARY_MOBI_RESOURCE_LIMIT' || error?.code === 'LIBRARY_MOBI_METADATA_INVALID') throw error;
              mobiParseError = error;
            }
            const readableText = String(parsedMobi?.text || '').trim();
            if (shouldTreatMobiAsComic({ imageCount: imgs.length, text: readableText })) {
              candidate.cbz = makeBytesPager(imgs, async (i) => imgs[i]);
              candidate.meta.format = 'cbz';
              candidate.mobiRoute = 'image-fallback';
              nextPage = Math.min(progress[id]?.page || 0, imgs.length - 1);
            }
          }
        }
        if (!candidate.cbz) {
          if (book.format !== 'txt' && !parsedMobi) throw mobiParseError || new Error('未解析到 MOBI 正文');
          const text = book.format === 'txt' ? decodeText(bytes) : parsedMobi.text; // 三级防线（自研→lingo→优雅拒绝）
          candidate.textBook = { pages: paginateText(text) };
          nextPage = Math.min(progress[id]?.page || 0, candidate.textBook.pages.length - 1);
        }
      } else {
        candidate.cbz = await parseCbz((await readBytes()).buffer);
        nextPage = Math.min(progress[id]?.page || 0, candidate.cbz.count - 1);
      }
      const cleanRules = rulesForBook(await getAllRules(), book.id);
      if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });

      // 候选解析可并发，但 owner 换代必须串行。A 渲染期 B 到达时，
      // A 仍要先成为“最后健康 owner”，再由 B 从 A 继续提交；
      // A 渲染失败则无条件回滚到 A 之前的健康 owner，不以 openGen 为回滚许可。
      const transaction = await withOpenCommit(async () => {
        if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });
        const oldBook = ctl.book;
        const oldId = oldBook?.meta?.id;
        const rollback = oldBook ? {
          book: oldBook,
          chapterIdx: ctl.chapterIdx,
          pageIdx: ctl.pageIdx,
          appearance: readerAppearanceSnapshot(),
          pendingRatio: ctl._pendingRatio,
          pendingAnchor: ctl._pendingAnchor,
          cleanRules: ctl._cleanRules,
          zhMode: ctl.zhMode,
          procCache: ctl._procCache,
          chapSizes: ctl._chapSizes,
        } : null;

        const positionWrite = oldBook ? saveProgress() : Promise.resolve({ accepted: false });
        await positionWrite;
        await Promise.all([
          oldId ? (oldBook?._repositoryBinding || binding).locatorStore.flush(oldId) : Promise.resolve([]),
          oldBook ? flushReaderAppearance(oldBook) : Promise.resolve([]),
        ]);
        if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });
        // 在旧 owner 的最后一笔外观 durable 后再读候选偏好；同书
        // reopen 不会把刚写入的字号/主题回滚为解析开始时的旧快照。
        const preferenceState = await candidate._prefs.load({ legacyRecord: progress[id] });
        if (!stillCurrent()) throw Object.assign(new Error('stale open'), { stale: true });
        candidate._appearance = preferenceState.appearance;

        const nextBook = candidate;
        candidate = null; // 从此由提交闸独占负责释放/回滚。
        retireFlowOwner();
        retireReaderFrame();
        ctl._renderGen = (ctl._renderGen || 0) + 1;
        ctl.book = nextBook;
        applyReaderAppearance(nextBook._appearance);
        delete nextBook._appearance;
        ctl.chapterIdx = nextChapter;
        ctl.pageIdx = nextPage;
        // A paged reopen is restored from its semantic DOM/text locator.  The
        // old whole-chapter pixel ratio is retained only by continuous mode.
        ctl._pendingRatio = ctl.mode === 'scroll' && typeof progress[id]?.ratio === 'number'
          ? progress[id].ratio
          : null;
        ctl._pendingAnchor = progress[id]?.anchor || null;
        ctl._procCache = {};
        ctl._chapSizes = [];
        resourceSurface.hide({ showShelf: false });
        shelfView.style.display = 'none';
        readerView.style.display = 'flex';
        root.querySelector('.lib-book-title').textContent = book.title;
        window.MazzHost?.setTabTitle(container, book.title);
        ctl._cleanRules = cleanRules;
        ctl.zhMode = progress[id]?.zh || '';
        root.querySelector('.lib-zh').value = ctl.zhMode || '';
        root._zhProxy?.setCurrent(ctl.zhMode || '');
        syncReaderControls();
        renderToc();
        applyReadTheme();

        try {
          await showCurrent();
          // showCurrent deliberately abandons late work when render/open
          // generations change.  That early return is not a successful owner
          // commit: close/workspace/open B may have invalidated this candidate.
          // Convert it into the transaction's rollback path so the last fully
          // rendered owner remains the only healthy recovery point.
          if (!stillCurrent() || ctl.book !== nextBook) {
            throw Object.assign(new Error('stale reader render'), { stale: true });
          }
          if (focusReader && stillCurrent() && ctl.book === nextBook) {
            handoffReaderFocus({ generation: gen, owner: nextBook, origin: focusOrigin });
          }
        } catch (renderError) {
          // 此时下一个 open 仍在闸外，因此即使本请求已 stale，
          // rollback.book 仍是唯一的 last healthy owner，绝不得因 generation 变化丢弃。
          if (ctl.book === nextBook && !ctl._destroyed) {
            ctl._renderGen = (ctl._renderGen || 0) + 1;
            retireFlowOwner();
            retireReaderFrame();
            disposeBookHandle(nextBook);
            ctl.book = null;
            if (rollback?.book) {
              ctl.book = rollback.book;
              ctl.chapterIdx = rollback.chapterIdx;
              ctl.pageIdx = rollback.pageIdx;
              ctl._pendingRatio = rollback.pendingRatio;
              ctl._pendingAnchor = rollback.pendingAnchor;
              ctl._cleanRules = rollback.cleanRules;
              ctl.zhMode = rollback.zhMode;
              ctl._procCache = rollback.procCache || {};
              ctl._chapSizes = rollback.chapSizes || [];
              applyReaderAppearance(rollback.appearance);
              root.querySelector('.lib-zh').value = ctl.zhMode || '';
              root._zhProxy?.setCurrent(ctl.zhMode || '');
              shelfView.style.display = 'none';
              readerView.style.display = 'flex';
              root.querySelector('.lib-book-title').textContent = rollback.book.meta.title;
              window.MazzHost?.setTabTitle(container, rollback.book.meta.title);
              renderToc();
              applyReadTheme();
              try {
                await showCurrent();
              } catch (rollbackError) {
                renderError.rollbackError = rollbackError;
                disposeBookHandle(rollback.book);
                ctl.book = null;
              }
            }
            if (!ctl.book && !ctl._destroyed) {
              retireReaderFrame();
              readerView.style.display = 'none';
              shelfView.style.display = 'flex';
              window.MazzHost?.setTabTitle(container, '书库');
              await renderShelf({ reload: true }).catch(() => {});
            }
          } else {
            // destroy/back 可以越过 open 闸；它们已拥有新视觉状态，
            // 本事务只收走自己的隐藏 owner，不回覆外部状态。
            disposeBookHandle(nextBook);
            disposeBookHandle(rollback?.book);
          }
          throw renderError;
        }

        // 渲染成功才释放旧 owner。此时即使 B 已让 A stale，A 也是 B
        // 开始提交前的健康回滚点，不能再回滚/销毁 A。
        disposeBookHandle(oldBook);
        return {
          owner: ctl.book === nextBook && !ctl._destroyed ? nextBook : null,
          requestCurrent: stillCurrent(),
        };
      });

      if (!transaction.owner || !transaction.requestCurrent || ctl.book !== transaction.owner) return false;
      // Only a successfully rendered candidate becomes "recent". Repository
      // failure must not tear down an already healthy reader owner.
      const openedAt = Date.now();
      transaction.owner.meta.lastOpenedAt = openedAt;
      transaction.owner.meta.missing = false;
      if (!ctl._handoffProvisional) {
        await mutateShelf(books => books.map(entry => entry.id === id
          ? { ...entry, lastOpenedAt: openedAt, missing: false }
          : entry), binding).catch(() => null);
      }
      if (!stillCurrent() || ctl.book !== transaction.owner) return false;
      // 首开后台写预处理缓存（下次零解析直开——只疼第一次）
      if (!ctl._handoffProvisional && transaction.owner.meta?.format === 'epub' && transaction.owner.epub
          && !transaction.owner.epub._fromCache && transaction.owner.epub._srcStat) {
        const cacheOwner = transaction.owner;
        writeBookCache(book.id, cacheOwner.epub._srcStat, cacheOwner.epub, {
          isAlive: () => !ctl._destroyed && ctl.book === cacheOwner,
          workspace: binding.repository.identity.canonical,
          invoke: window.mazz.invoke.bind(window.mazz),
        }).catch(() => {});
      }
      return true;
    } catch (e) {
      disposeBookHandle(candidate);
      if (e?.sourceMissing && stillCurrent()) {
        await mutateShelf(books => books.map(entry => entry.id === id
          ? { ...entry, missing: true }
          : entry), binding).catch(() => null);
        if (stillCurrent()) await renderShelf({ reload: true }).catch(() => null);
      }
      if (!e?.stale && !ctl._destroyed && gen === ctl._openGen) toast('打开失败：' + (e.message || e));
      return false;
    }
  }

  function progressRecord() {
    if (!ctl.book?.meta) return null;
    const textScrollLocator = ctl.book._textViewport?.captureLocator?.() || null;
    if (textScrollLocator && Number.isInteger(textScrollLocator.section)) {
      if (ctl.book.meta.format === 'epub') ctl.chapterIdx = textScrollLocator.section;
      else ctl.pageIdx = textScrollLocator.section;
    }
    // 连续阅读保留章节内语义比例；分页阅读只存 DOM/文本锚，不再持久化
    // 字号、页宽一变就失真的像素/屏位比例。
    const rec = ctl.book.meta.format === 'epub' ? { chapter: ctl.chapterIdx } : { page: ctl.pageIdx };
    if (textScrollLocator) {
      rec.ratio = +Math.max(0, Math.min(1, Number(textScrollLocator.ratio) || 0)).toFixed(5);
      if (Number.isFinite(Number(textScrollLocator.progression))) {
        rec.progression = +Math.max(0, Math.min(1, Number(textScrollLocator.progression))).toFixed(5);
      }
      if (Number.isFinite(Number(textScrollLocator.scrollTop))) rec.scrollTop = +Number(textScrollLocator.scrollTop).toFixed(2);
      if (ctl.book.meta.format === 'epub' && textScrollLocator.sectionId != null) {
        rec.spineItemId = String(textScrollLocator.sectionId);
      }
    }
    if (ctl.zhMode) rec.zh = ctl.zhMode; // 简繁偏好随书记忆
    // 内容锚 + 字数加权百分比（koodo handleRecord 模型：锚内容不锚屏位，改字号/页宽/单双页后恢复不漂）
    const anch = captureAnchor();
    if (anch) { rec.anchor = anch; rec.pct = +weightedPct(anch).toFixed(5); }
    const total = Math.max(1, totalPages());
    rec.totalPages = total;
    rec.updatedAt = Date.now();
    const unit = ctl.book.meta.format === 'epub' ? ctl.chapterIdx : ctl.pageIdx;
    const discrete = ['cbz', 'manga-folder', 'pdf'].includes(ctl.book.meta.format);
    const within = discrete ? 1 : (typeof rec.ratio === 'number' ? rec.ratio : 0);
    rec.overallRatio = typeof rec.progression === 'number'
      ? rec.progression
      : typeof rec.pct === 'number'
      ? rec.pct
      : +Math.max(0, Math.min(1, (unit + within) / total)).toFixed(5);
    return rec;
  }

  function saveProgress(record = progressRecord(), ownerMeta = ctl.book?.meta, ownerBinding = ctl.book?._repositoryBinding || repositoryBinding) {
    const rec = record;
    const meta = ownerMeta;
    if (!rec || !meta?.id || ctl._handoffProvisional) return Promise.resolve({ accepted: false, provisional: ctl._handoffProvisional });
    // id/path/record 在调用点同步快照；下一微任务即使已切书也绝不串写。
    if (!ownerBinding || ownerBinding.retiring || ownerBinding !== repositoryBinding || ctl._workspaceRebinding) {
      return Promise.resolve({ accepted: false, stale: true });
    }
    return trackBindingOperation(ownerBinding, ownerBinding.locatorStore.put({
      bookId: meta.id, path: meta.path, record: rec,
    }));
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
      case 'manga-folder': return flatManga(b).length;
      case 'txt': case 'mobi': case 'azw3': return b.textBook.pages.length;
      case 'pdf': return 1;
      default: return b.cbz.count;
    }
  }
  function currentPos() { return ctl.book?.meta.format === 'epub' ? ctl.chapterIdx : ctl.pageIdx; }

  function commitProgress(pct, location) {
    const value = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    const label = `${location} · ${value}%`;
    posLocationEl.textContent = location;
    posPercentEl.textContent = value + '%';
    posEl.setAttribute('aria-label', label);
    progFill.style.width = value + '%';
    progTrack.setAttribute('aria-valuenow', String(value));
    progTrack.setAttribute('aria-valuetext', label);
  }

  function updateProgressBar() {
    const b = ctl.book;
    // 滚动模式（文本类）：按帧内滚动位置百分比报（沙箱帧后滚动发生在帧内，不再读壳 contentEl）
    if (ctl.mode === 'scroll' && b && b.meta.format !== 'pdf' && b.meta.format !== 'cbz' && b.meta.format !== 'manga-folder') {
      const se = ctl._textScrollHost || (ctl._fdoc ? (ctl._fdoc.scrollingElement || ctl._fdoc.documentElement) : contentEl);
      const sh = se.scrollHeight - se.clientHeight;
      const pct = sh > 0 ? Math.round(se.scrollTop / sh * 100) : 100;
      const cur = currentPos() + 1;
      const total = totalPages();
      const unit = b.meta.format === 'epub' ? '章' : '页';
      commitProgress(pct, `第 ${cur}/${total} ${unit}`);
      return;
    }
    // 分页文本：临时 rail 只装当前章与邻章，不能冒充全书进度。
    // 用已有稳定 locator 的「章/源页 + 章内比例」表达全书进度，不绑字号后的像素屏位。
    if (ctl._flowWrap && ctl.mode !== 'scroll' && b && b.meta.format !== 'cbz' && b.meta.format !== 'manga-folder' && b.meta.format !== 'pdf'
        && ctl._flowWrap.clientWidth > 0 && (ctl._flowWrap.querySelector('.lib-flow')?.scrollWidth || 0) > 0) {
      const total = Math.max(1, totalPages());
      const anchor = ctl._captureStableAnchor?.() || captureAnchor();
      const section = Math.max(0, Math.min(total - 1, Number.isFinite(Number(anchor?.m)) ? Number(anchor.m) : currentPos()));
      const within = Math.max(0, Math.min(1, Number(anchor?.r) || 0));
      const unit = b.meta.format === 'epub' ? '章' : '页';
      commitProgress(Math.round((section + within) / total * 100), `第 ${section + 1}/${total} ${unit}`);
      return;
    }
    const total = totalPages();
    const cur = currentPos() + 1;
    const pct = Math.round(cur / total * 100);
    const unit = b?.meta.format === 'epub' ? '章' : '页';
    commitProgress(pct, `第 ${cur}/${total} ${unit}`);
  }

  async function seekProgress(ratio) {
    const b = ctl.book;
    if (!b || b.meta.format === 'pdf') return;
    const targetRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const total = Math.max(1, totalPages());
    const isImage = b.meta.format === 'cbz' || b.meta.format === 'manga-folder';
    if (ctl.mode === 'scroll') {
      if (isImage && b._comicViewport?.goTo) {
        await b._comicViewport.goTo(Math.round(targetRatio * (total - 1)));
      } else if (!isImage && b._textViewport?.goTo) {
        const scaled = targetRatio * total;
        const section = Math.min(total - 1, Math.floor(scaled));
        const within = targetRatio >= 1 ? 1 : scaled - section;
        await b._textViewport.goTo(section, { ratio: within });
      } else {
        const scrollHost = ctl._textScrollHost || contentEl;
        scrollHost.scrollTop = targetRatio * Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      }
      updateProgressBar();
      return;
    }
    if (ctl._flowWrap && !isImage) {
      const scaled = targetRatio * total;
      const section = Math.min(total - 1, Math.floor(scaled));
      const within = targetRatio >= 1 ? 1 : scaled - section;
      if (b.meta.format === 'epub') ctl.chapterIdx = section;
      else ctl.pageIdx = section;
      ctl._pendingRatio = null;
      ctl._pendingAnchor = { kind: 'dom-text', m: section, r: within };
      await showCurrent();
      return;
    }
    const target = Math.round(targetRatio * (total - 1));
    if (b.meta.format === 'epub') ctl.chapterIdx = target;
    else ctl.pageIdx = target;
    await showCurrent();
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
      items = b.manga.chapters.map((c, i) => ({ label: `${c.name}（${c.pages.length}p）`, idx: flatIdxOfChapter(b, i) }));
    } else if (b.meta.format === 'txt' || b.meta.format === 'mobi' || b.meta.format === 'azw3') {
      items = b.textBook.pages.map((_, i) => ({ label: '第 ' + (i + 1) + ' 页', idx: i }));
    } else {
      items = Array.from({ length: b.cbz.count }, (_, i) => ({ label: '第 ' + (i + 1) + ' 页', idx: i }));
    }
    tocEl.innerHTML = items.map(it =>
      `<div class="lib-toc-item${it.idx === currentPos() ? ' on' : ''}" data-i="${it.idx}" role="button" tabindex="0">${escapeHtml(it.label)}</div>`).join('');
    tocEl.querySelectorAll('.lib-toc-item').forEach(el => el.addEventListener('click', async () => {
      const i = +el.dataset.i;
      if (ctl.book.meta.format === 'epub') ctl.chapterIdx = i; else ctl.pageIdx = i;
      await showCurrent();
    }));
    tocEl.querySelectorAll('.lib-toc-item').forEach(el => el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); el.click();
    }));
  }

  // ==================== 阅读渲染 ====================
  async function textPagesHtml(idx, resourceOwner = null) {
    const b = ctl.book;
    let raw;
    if (b.meta.format === 'epub') {
      const item = b.epub.spine[idx];
      const ch = await b.epub.loadChapter(item, resourceOwner);
      if (!ch) throw new Error('章节加载已被较新的阅读视口接管');
      raw = ch.html;
    } else {
      raw = textPageToHtml(b.textBook.pages[idx]);
    }
    // 加工链（净化规则 + 简繁转换）：DOM 文本节点级，按章缓存——规则/简繁版本戳一变才回炉
    const owner = `${b.meta.id}:${b.meta.format === 'epub' ? b.epub.spine[idx]?.id || idx : idx}`;
    const ver = `${owner}:${ctl._rulesVer || 0}:${ctl.zhMode || ''}`;
    // Materialized EPUB HTML may contain chapter-owned blob URLs. Those URLs
    // are deliberately revoked when a virtualized section leaves the resident
    // window, so caching that HTML would resurrect revoked image references on
    // a later revisit. Cache only resource-free HTML; materialized chapters are
    // reprocessed from their freshly rewritten URL set.
    const ownsSessionUrls = b.meta.format === 'epub' && /\bblob:/i.test(raw);
    if (ownsSessionUrls) {
      delete ctl._procCache?.[idx];
      return processHtmlText(raw, { rules: ctl._cleanRules || [], zhMode: ctl.zhMode || '' });
    }
    ctl._procCache = ctl._procCache || {};
    if (ctl._procCache[idx]?.ver !== ver) {
      const out = processHtmlText(raw, { rules: ctl._cleanRules || [], zhMode: ctl.zhMode || '' });
      ctl._procCache[idx] = { ver, html: out };
    }
    return ctl._procCache[idx].html;
  }

  async function imagePageUrl(idx) {
    const b = ctl.book;
    if (b.meta.format === 'manga-folder') {
      return imageUrl(b.manga.chapters[idx].pages[0] ? b.manga.chapters[idx].pages[0] : '');
    }
    return b.cbz.loadPage(idx);
  }

  // ==================== 沙箱阅读帧（koodo 式隔离：书籍样式/脚本与壳互不渗漏，自研净室复刻） ====================
  function frameCss() {
    const t = READ_THEMES[ctl.readTheme] || READ_THEMES.paper;
    const ff = ctl.fontFamily ? `font-family:${ctl.fontFamily};` : '';
    return `html,body{margin:0;padding:0;height:100%;}
html{background:color-mix(in srgb,${t.bg} 94%,${t.fg} 6%);}
body{--reader-paper:${t.bg};--reader-ink:${t.fg};--reader-stage:color-mix(in srgb,${t.bg} 94%,${t.fg} 6%);--reader-stage-block:12px;color:${t.fg};background:var(--reader-stage);font-size:${ctl.fontSize}px;line-height:${ctl.lineHeight};${ff}box-sizing:border-box;overflow:hidden;padding:var(--reader-stage-block) 0;}
body.lib-scroll{overflow-y:auto;padding:var(--reader-stage-block) 0 54px;background:var(--reader-stage);}
img{max-width:100%;} a{color:inherit;text-underline-offset:.16em;}
.lib-flow-wrap{position:relative;height:100%;overflow:hidden;margin:0 auto;background:var(--reader-paper);border:1px solid color-mix(in srgb,var(--reader-ink) 11%,transparent);border-radius:2px;box-shadow:0 1px 2px color-mix(in srgb,var(--reader-ink) 8%,transparent),0 12px 34px color-mix(in srgb,var(--reader-ink) 10%,transparent);isolation:isolate;}
.lib-flow-wrap::after{content:'';position:absolute;z-index:3;pointer-events:none;top:0;bottom:0;left:50%;width:var(--reader-spread-gutter,0px);transform:translateX(-50%);opacity:0;background:linear-gradient(90deg,color-mix(in srgb,var(--reader-ink) 8%,transparent),transparent 36%,transparent 64%,color-mix(in srgb,var(--reader-ink) 8%,transparent));}
.lib-flow-wrap[data-spread="double"]::after{opacity:1;}
.lib-flow-wrap.is-turn-fade{animation:reader-page-fade 150ms ease-out;}
.lib-flow{position:relative;z-index:1;height:100%;box-sizing:border-box;padding:var(--reader-pad-block,36px) var(--reader-pad-inline,44px);will-change:transform;overflow-wrap:break-word;}
.lib-flow :where(p){margin:.12em 0 .82em;text-align:justify;text-justify:inter-ideograph;orphans:2;widows:2;}
.lib-flow :where(h1,h2,h3,h4,h5,h6){line-height:1.38;margin:1.15em 0 .68em;break-after:avoid;}
.lib-flow :where(blockquote){margin:1em 1.4em;padding-inline-start:1em;border-inline-start:2px solid color-mix(in srgb,var(--reader-ink) 24%,transparent);opacity:.9;}
.lib-flow :where(pre,table){max-width:100%;overflow:auto;}
.lib-flow :where(img,svg){display:block;margin:.65em auto;max-height:calc(100% - 1.3em);object-fit:contain;}
.lib-flow .lib-chap-mark{display:block;break-before:column;}
.lib-chap-sep{text-align:center;opacity:.55;font-size:.85em;margin:.6em 0;}
.lib-scroll-page{padding:24px 32px;}
.lib-page--text-virtual{min-height:100%;}
.lib-text-reel{box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;width:min(var(--reader-scroll-sheet,760px),calc(100% - 20px));min-height:calc(100vh - var(--reader-stage-block) * 2);margin:0 auto;background:var(--reader-paper);border:1px solid color-mix(in srgb,var(--reader-ink) 11%,transparent);border-radius:2px;box-shadow:0 1px 2px color-mix(in srgb,var(--reader-ink) 8%,transparent),0 12px 34px color-mix(in srgb,var(--reader-ink) 10%,transparent);}
.lib-text-slot{position:relative;box-sizing:border-box;contain:layout style;}
.lib-text-section-content{box-sizing:border-box;width:100%;padding:var(--reader-scroll-pad-block,36px) var(--reader-scroll-pad-inline,44px) calc(var(--reader-scroll-pad-block,36px) + 18px);margin:0 auto;overflow-wrap:break-word;}
.lib-text-section-content :where(p){margin:.12em 0 .82em;text-align:justify;text-justify:inter-ideograph;orphans:2;widows:2;}
.lib-text-section-content :where(h1,h2,h3,h4,h5,h6){line-height:1.38;margin:1.15em 0 .68em;}
.lib-text-placeholder{display:block;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(127,127,127,.035),transparent);}
.lib-text-slot.is-loading::after{content:'正在排版…';position:absolute;top:32px;left:50%;transform:translateX(-50%);opacity:.5;font-size:12px;}
.lib-text-slot.is-error::after{content:'本节加载失败';position:absolute;top:32px;left:50%;transform:translateX(-50%);color:#b42318;font-size:12px;}
hr.lib-page-sep{border:0;border-top:1px dashed #0002;margin:0;}
@keyframes reader-page-fade{0%{opacity:.72}100%{opacity:1}}
@media (prefers-reduced-motion:reduce){.lib-flow,.lib-flow-wrap{transition:none!important;animation:none!important}}`;
  }
  function applyFrameStyle() { if (ctl._fstyle) ctl._fstyle.textContent = frameCss(); }
  function retireReaderFrame() {
    const frame = ctl._frame;
    if (frame) readerInput.detachFrame(frame);
    frame?.remove?.();
    ctl._frame = null;
    ctl._frameReady = null;
    ctl._fdoc = null;
    ctl._fstyle = null;
  }
  function retireFlowOwner({ preservePosition = false } = {}) {
    if (preservePosition && ctl._flowWrap?.isConnected && ctl._pendingAnchor == null) {
      ctl._pendingAnchor = captureAnchor();
      ctl._pendingRatio = null;
    }
    ctl._flowRO?.disconnect?.();
    if (ctl._flowRAF != null) cancelAnimationFrame(ctl._flowRAF);
    clearTimeout(ctl._flowTimer);
    clearTimeout(ctl._flowResizeTimer);
    clearTimeout(ctl._flowHideT);
    clearTimeout(ctl._pageTurnTimer);
    ctl._flowRO = null;
    ctl._flowRAF = null;
    ctl._flowTimer = null;
    ctl._flowResizeTimer = null;
    ctl._flowHideT = null;
    ctl._pageTurnTimer = null;
    ctl._flowWrap = null;
    ctl._flowNav = null;
    ctl._flowLayout = null;
    ctl._captureStableAnchor = null;
    ctl._applyOffset = null;
    ctl._stepOf = null;
  }
  const READER_FRAME_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob: data:; media-src 'none'; font-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const READER_FRAME_SRCDOC = `<!doctype html><html><head><meta charset="utf-8"><meta data-mazz-reader-csp http-equiv="Content-Security-Policy" content="${READER_FRAME_CSP}"></head><body></body></html>`;

  async function readerFrameDocument(frame) {
    const isReady = doc => !!doc?.head?.querySelector?.('meta[data-mazz-reader-csp]') && !!doc.body;
    if (isReady(frame.contentDocument)) return frame.contentDocument;
    return new Promise(resolve => {
      let settled = false;
      let timer = null;
      const finish = (doc) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        frame.removeEventListener('load', onLoad, false);
        resolve(doc || null);
      };
      const onLoad = () => {
        const doc = frame.contentDocument;
        if (isReady(doc)) finish(doc);
      };
      frame.addEventListener('load', onLoad, false);
      // Chromium commits srcdoc before this guard expires. DOM-only contract
      // environments may expose an inert about:blank document without parsing
      // srcdoc; install the identical static bootstrap there so behavior tests
      // exercise the same CSP-bearing DOM rather than a source-string shim.
      timer = setTimeout(() => {
        if (!frame.isConnected) { finish(null); return; }
        const doc = frame.contentDocument;
        if (doc && !isReady(doc)) {
          try {
            doc.open();
            doc.write(READER_FRAME_SRCDOC);
            doc.close();
          } catch {}
        }
        finish(isReady(frame.contentDocument) ? frame.contentDocument : null);
      }, 180);
    });
  }

  async function ensureFrame() {
    if (ctl._frame && ctl._frame.isConnected && ctl._fdoc) return ctl._frame;
    if (ctl._frame && ctl._frame.isConnected && ctl._frameReady) return ctl._frameReady;
    retireReaderFrame();
    pageEl.innerHTML = '';
    const f = document.createElement('iframe');
    f.className = 'lib-book-frame';
    f.setAttribute('sandbox', 'allow-same-origin'); // 书的脚本默认禁跑（koodo 同款纪律）
    f.srcdoc = READER_FRAME_SRCDOC;
    ctl._frame = f;
    pageEl.appendChild(f);
    const ready = (async () => {
      const d = await readerFrameDocument(f);
      if (!d || ctl._frame !== f || !f.isConnected) return null;
      const st = d.createElement('style');
      d.head.appendChild(st);
      ctl._fdoc = d; ctl._fstyle = st;
      readerInput.attachFrame(f);
      applyFrameStyle();
      // 帧内选区缓存：点「摘录」按钮焦点转移折叠选区（壳内同款坑，帧内同款缓存解）
      d.addEventListener('selectionchange', () => {
        const t = (f.contentWindow.getSelection?.()?.toString() || '').trim();
        if (t) ctl._lastSel = t;
      });
      // Sanitized chapters retain fragment links only; every click is still
      // intercepted so the srcdoc document can never navigate itself.
      d.addEventListener('click', (e) => {
        const a = e.target.closest?.('a');
        if (!a) return;
        e.preventDefault(); e.stopPropagation();
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#')) {
          const id = decodeURIComponent(href.slice(1));
          const tgt = d.getElementById(id) || d.querySelector(`[name="${CSS.escape(id)}"]`);
          if (!tgt) return;
          if (ctl._flowWrap && ctl._applyOffset) {
            ctl._applyOffset(Math.max(0, tgt.offsetLeft - (ctl._pageGeometry?.pagePaddingInline || 0)), true);
          }
          else tgt.scrollIntoView?.();
        }
      });
      // 帧内滚轮/右键/指针——iframe 不冒泡到壳，事件桥各接一份
      d.addEventListener('wheel', (e) => onReaderWheel(e, true), { passive: false });
      d.addEventListener('pointermove', () => { if (!progManualFold) progShow(); });
      d.addEventListener('contextmenu', (e) => { const r = f.getBoundingClientRect(); onReaderContext(e, r.left, r.top); }); // 帧坐标系→壳坐标系
      return f;
    })();
    ctl._frameReady = ready;
    try { return await ready; } finally { if (ctl._frameReady === ready) ctl._frameReady = null; }
  }

  // ==================== 内容锚与字数加权进度（koodo handleRecord 模型：锚内容不锚屏位，重排免疫） ====================
  const flowEl = () => ctl._fdoc?.querySelector('.lib-flow') || null;
  function readerMotionReduced() {
    try { return !!ctl._frame?.contentWindow?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
    catch { return false; }
  }
  function signalPageTurn(target) {
    if (!target || readerMotionReduced()) return 0;
    const classes = ['is-turn-fade'];
    target.classList.remove(...classes);
    // Restart the short feedback animation even when the user turns rapidly.
    void target.offsetWidth;
    target.classList.add('is-turn-fade');
    clearTimeout(ctl._pageTurnTimer);
    ctl._pageTurnTimer = setTimeout(() => {
      target.classList?.remove?.(...classes);
      ctl._pageTurnTimer = null;
    }, 170);
    return 150;
  }
  async function decodeReaderImage(img) {
    if (!img) return null;
    try {
      if (typeof img.decode === 'function') await img.decode();
    } catch (error) {
      if (!img.naturalWidth && !img.complete) throw error;
    }
    return img;
  }
  function signalOuterPageTurn(target, delta) {
    if (!target || readerMotionReduced() || typeof target.animate !== 'function') return;
    ctl._outerTurnAnimation?.cancel?.();
    ctl._outerTurnAnimation = target.animate([{ opacity: 0.72 }, { opacity: 1 }], {
      duration: 150,
      easing: 'ease-out',
    });
    ctl._outerTurnAnimation.finished.catch(() => {}).finally(() => {
      ctl._outerTurnAnimation = null;
    });
  }
  const topOf = (node, flow) => { let n = node; while (n && n.parentElement && n.parentElement !== flow) n = n.parentElement; return n; };
  const xpathOf = (node, flow) => {
    const idx = []; let n = node;
    while (n && n !== flow) { const p = n.parentElement; if (!p) break; idx.unshift([...p.children].indexOf(n)); n = p; }
    return idx.join('/');
  };
  const resolveXpath = (path) => {
    let n = flowEl(); if (!n || !path) return null;
    for (const i of String(path).split('/').map(Number)) { if (!n?.children?.[i]) return null; n = n.children[i]; }
    return n;
  };
  const nodePathOf = (node, flow) => {
    const parts = []; let current = node;
    while (current && current !== flow) {
      const parent = current.parentNode;
      if (!parent) return '';
      parts.unshift([...parent.childNodes].indexOf(current));
      current = parent;
    }
    return current === flow ? parts.join('/') : '';
  };
  const resolveNodePath = (path) => {
    let node = flowEl();
    if (!node || typeof path !== 'string' || !path) return null;
    for (const index of path.split('/').map(Number)) {
      if (!Number.isInteger(index) || !node?.childNodes?.[index]) return null;
      node = node.childNodes[index];
    }
    return node;
  };
  const rectIntersects = (rect, bounds, inset = 1) => !!(rect && bounds
    && Number.isFinite(Number(rect.left)) && Number.isFinite(Number(rect.right))
    && Number.isFinite(Number(rect.top)) && Number.isFinite(Number(rect.bottom))
    && rect.right > bounds.left + inset && rect.left < bounds.right - inset
    && rect.bottom > bounds.top + inset && rect.top < bounds.bottom - inset);
  const caretRect = (doc, node, offset) => {
    if (!doc?.createRange || !node) return null;
    try {
      const range = doc.createRange();
      const length = node.nodeType === 3
        ? String(node.textContent || '').length
        : Number(node.childNodes?.length) || 0;
      const start = Math.max(0, Math.min(length, Number(offset) || 0));
      range.setStart(node, start);
      if (node.nodeType === 3 && start < length) range.setEnd(node, start + 1);
      else range.collapse(true);
      return range.getClientRects?.()[0] || range.getBoundingClientRect?.() || null;
    } catch { return null; }
  };
  const caretPoint = () => {
    const doc = ctl._fdoc;
    const wrap = ctl._flowWrap;
    if (!doc || !wrap) return null;
    const rect = wrap.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    const x = rect.left + Math.min(rect.width - 8, (ctl._pageGeometry?.pagePaddingInline || 36) + 8);
    const ys = [
      rect.top + Math.min(rect.height - 8, (ctl._pageGeometry?.pagePaddingBlock || 32) + 8),
      rect.top + rect.height * .32,
      rect.top + rect.height * .5,
    ];
    for (const y of ys) {
      const pos = doc.caretPositionFromPoint?.(x, y);
      if (pos?.offsetNode) {
        const point = { node: pos.offsetNode, offset: pos.offset };
        if (rectIntersects(caretRect(doc, point.node, point.offset), rect)) return point;
      }
      const range = doc.caretRangeFromPoint?.(x, y);
      if (range?.startContainer) {
        const point = { node: range.startContainer, offset: range.startOffset };
        if (rectIntersects(caretRect(doc, point.node, point.offset), rect)) return point;
      }
    }
    return null;
  };
  const semanticBlocks = (flow = flowEl()) => flow
    ? [...flow.children].filter(ch => !ch.classList?.contains('lib-chap-mark') && !ch.classList?.contains('lib-chap-sep'))
    : [];
  /** 当前物理页首个可见顶层块。 */
  function firstVisibleBlock() {
    const flow = flowEl();
    if (!flow || !ctl._flowWrap?.clientWidth) return null;
    const wrapRect = ctl._flowWrap.getBoundingClientRect?.();
    if (wrapRect?.width && wrapRect?.height && ctl._fdoc?.createRange) {
      for (const block of semanticBlocks(flow)) {
        try {
          const range = ctl._fdoc.createRange();
          range.selectNodeContents(block);
          if ([...(range.getClientRects?.() || [])].some(rect => rectIntersects(rect, wrapRect))) return block;
        } catch { /* fall back to the physical-column ledger below */ }
      }
    }
    const off = ctl._flowOffset || 0, wrapW = ctl._flowWrap.clientWidth;
    for (const ch of semanticBlocks(flow)) {
      const left = ch.offsetLeft - off;
      if (left + (ch.offsetWidth || 1) > 2 && left < wrapW) return ch;
    }
    return null;
  }
  /** 锚块章归属（回溯最近章标记） */
  function chapterOfBlock(top) {
    let s = top, m = 0;
    while (s) { if (s.classList?.contains('lib-chap-mark')) { m = +s.dataset.i; break; } s = s.previousElementSibling; }
    return m;
  }
  function captureAnchor() {
    const flow = flowEl();
    const caret = caretPoint();
    const caretElement = caret?.node?.nodeType === 1 ? caret.node : caret?.node?.parentElement;
    const el = caretElement && flow?.contains?.(caretElement) ? topOf(caretElement, flow) : firstVisibleBlock();
    if (!el || !flow) return null;
    const top = topOf(el, flow);
    const blocks = semanticBlocks(flow);
    const chapter = chapterOfBlock(top);
    const chapterBlocks = blocks.filter(block => chapterOfBlock(block) === chapter);
    const blockIndex = Math.max(0, chapterBlocks.indexOf(top));
    const locator = {
      kind: 'dom-text',
      p: xpathOf(el, flow),
      t: (el.textContent || '').trim().slice(0, 80),
      m: chapter,
      r: chapterBlocks.length > 1 ? blockIndex / (chapterBlocks.length - 1) : 0,
    };
    if (caret?.node && flow.contains?.(caret.node)) {
      const text = String(caret.node.textContent || '');
      const offset = Math.max(0, Math.min(text.length, Number(caret.offset) || 0));
      locator.tp = nodePathOf(caret.node, flow);
      locator.o = offset;
      locator.q = text.slice(offset, offset + 48).trim();
    }
    return locator;
  }
  /** 字数加权全书百分比：Σ前序章字数/总字数 + 章内块序位占比×本章字数/总字数 */
  function weightedPct(anch) {
    const sizes = ctl._chapSizes || [];
    if (!anch || !sizes.length) return ctl._flowRatio || 0;
    const total = sizes.reduce((a, x) => a + (Number(x) || 1), 0) || 1;
    const before = sizes.slice(0, anch.m).reduce((a, x) => a + (Number(x) || 1), 0);
    let frac = 0;
    const flow = flowEl();
    const node = resolveXpath(anch.p);
    if (flow && node) {
      const blocks = [];
      let s = topOf(node, flow);
      while (s && !s.classList?.contains('lib-chap-mark')) s = s.previousElementSibling;
      const start = s;
      let count = 0, idx = -1;
      let cur = start ? start.nextElementSibling : flow.firstElementChild;
      const top = topOf(node, flow);
      while (cur && !cur.classList?.contains('lib-chap-mark')) {
        if (!cur.classList?.contains('lib-chap-sep')) { if (cur === top) idx = count; count++; }
        cur = cur.nextElementSibling;
      }
      if (count > 0 && idx >= 0) frac = idx / count;
    }
    return (before + (sizes[anch.m] || 0) * frac) / total;
  }

  function applyScrollTextGeometry() {
    const doc = ctl._fdoc;
    if (!doc?.body) return null;
    const width = doc.documentElement?.clientWidth || ctl._frame?.clientWidth || pageEl.clientWidth || 720;
    const height = doc.documentElement?.clientHeight || ctl._frame?.clientHeight || pageEl.clientHeight || 720;
    const geometry = computeReaderPageGeometry({
      viewportWidth: width,
      viewportHeight: height,
      mode: 'single',
      pageWidth: ctl.pageWidth,
      margin: ctl.pageMargin,
      fontSize: ctl.fontSize,
      lineHeight: ctl.lineHeight,
    });
    ctl._pageGeometry = geometry;
    doc.body.style.setProperty('--reader-stage-block', `${geometry.outerBlock}px`);
    doc.body.style.setProperty('--reader-scroll-sheet', `${geometry.sheetWidth}px`);
    doc.body.style.setProperty('--reader-scroll-pad-inline', `${geometry.pagePaddingInline}px`);
    doc.body.style.setProperty('--reader-scroll-pad-block', `${geometry.pagePaddingBlock}px`);
    return geometry;
  }

  function applyComicSizing() {
    return applyComicFitVariables(pageEl, {
      pageWidth: ctl.pageWidth,
      zoom: ctl.mangaZoom,
    });
  }

  function captureReaderReflowLocator() {
    return ctl.book?._textViewport?.captureLocator?.()
      || ctl.book?._comicViewport?.captureLocator?.()
      || ctl._captureStableAnchor?.()
      || null;
  }

  function reflowReaderGeometry(continuousLocator = null) {
    const format = ctl.book?.meta?.format;
    const isImage = format === 'cbz' || format === 'manga-folder';
    if (isImage) {
      const viewport = ctl.book?._comicViewport;
      const locator = continuousLocator || viewport?.captureLocator?.() || null;
      applyComicSizing();
      if (locator) viewport?.restoreLocator?.(locator);
      return;
    }
    if (ctl.mode === 'scroll' && ctl.book?._textViewport) {
      const viewport = ctl.book._textViewport;
      const locator = continuousLocator
        || viewport.captureStableLocator?.()
        || viewport.captureLocator?.();
      applyScrollTextGeometry();
      viewport.refresh?.({ locator });
      return;
    }
    ctl._flowLayout?.(continuousLocator);
  }

  async function showCurrent() {
    // Capture the outgoing continuous viewport before its height ledger is
    // retired. Paged mode receives a semantic section/block locator; only a
    // continuous-to-continuous rebuild is allowed to retain the section ratio.
    const outgoingTextLocator = ctl.book?._textViewport?.captureLocator?.() || null;
    if (outgoingTextLocator && Number.isInteger(outgoingTextLocator.section)) {
      if (ctl.book.meta.format === 'epub') ctl.chapterIdx = outgoingTextLocator.section;
      else ctl.pageIdx = outgoingTextLocator.section;
      const sectionRatio = Number.isFinite(Number(outgoingTextLocator.ratio))
        ? Math.max(0, Math.min(1, Number(outgoingTextLocator.ratio))) : 0;
      if (ctl.mode === 'scroll') {
        ctl._pendingRatio = sectionRatio;
      } else {
        ctl._pendingAnchor = {
          kind: 'section-ratio', m: outgoingTextLocator.section,
          sectionId: outgoingTextLocator.sectionId, r: sectionRatio,
        };
        ctl._pendingRatio = null;
      }
    }
    retireFlowOwner({ preservePosition: true });
    const renderGen = (ctl._renderGen || 0) + 1;
    ctl._renderGen = renderGen;
    const b = ctl.book;
    if (!b) return;
    const renderAlive = () => !ctl._destroyed && ctl._renderGen === renderGen && ctl.book === b;
    b._comicViewport?.destroy?.();
    b._comicViewport = null;
    b._textViewport?.destroy?.();
    b._textViewport = null;
    ctl._textScrollHost = null;
    contentEl.onscroll = null;
    // 漫画/PDF/文本全类全宽容器（沙箱帧占满 pageEl，阅读留白由帧内 CSS 自理）
    const isText = ['epub', 'txt', 'mobi', 'azw3'].includes(b.meta.format);
    const isImgOrFlow = b.meta.format === 'pdf' || b.meta.format === 'cbz' || b.meta.format === 'manga-folder' || isText || ctl.mode !== 'scroll';
    pageEl.classList.toggle('lib-page--full', !!isImgOrFlow);
    pageEl.classList.remove('lib-manga-mode'); // 每次渲染前清模式类（漫画分支会按需重加，防文本/epub 串到漫画布局）
    contentEl.classList.toggle('lib-content--x', !!(ctl.mode !== 'scroll' && b.meta.format !== 'pdf'));
    applyTextStyle();
    if (b.meta.format === 'pdf') {
      retireReaderFrame();
      pageEl.innerHTML = `<embed class="lib-pdf" src="${b.pdf.url}" type="application/pdf">`;
      updateProgressBar();
      renderToc();
      return;
    }
    const isImage = b.meta.format === 'cbz' || b.meta.format === 'manga-folder';
    if (ctl.mode === 'scroll') {
      // 滚动模式：只实体化当前视口与邻页；300 页书也只保留个位数图片 owner。
      if (isImage) {
        retireReaderFrame();
        const flat = b.meta.format === 'manga-folder' ? flatManga(b) : null;
        const count = flat ? flat.length : b.cbz.count;
        const loadPage = flat ? (i) => imageUrl(flat[i]?.path || '') : (i) => b.cbz.loadPage(i);
        applyComicSizing();
        b._comicViewport = createComicViewport({
          host: contentEl,
          mount: pageEl,
          count,
          initialPage: Math.max(0, Math.min(ctl.pageIdx, count - 1)),
          loadPage,
          releaseOutside: flat ? () => {} : (keep) => b.cbz.unloadOutside?.(keep),
          isAlive: renderAlive,
          onPage: (page) => {
            if (!renderAlive()) return;
            ctl.pageIdx = page;
            updateProgressBar();
            clearTimeout(ctl._flowHideT);
            ctl._flowHideT = setTimeout(saveProgress, 500);
          },
        });
        updateProgressBar();
        renderToc();
        saveProgress();
        return;
      } else {
        // 文本连续阅读：100+ 章只保留当前 ±1，卸载章维持实测高度，滚动条不坍塌。
        if (!await ensureFrame() || !renderAlive()) return;
        const total = totalPages();
        const center = Math.max(0, Math.min(currentPos(), total - 1));
        ctl._fdoc.body.classList.remove('lib-paged');
        ctl._fdoc.body.classList.add('lib-scroll');
        applyFrameStyle();
        applyScrollTextGeometry();
        // In a standards-mode iframe CSS overflow on body is owned by the
        // document scrolling element (normally <html>). Mount the section rail
        // in body, but read/write position and listen for scrolling on the real
        // root scroller so chapter-relative locators survive reopen/reflow.
        const scrollHost = ctl._fdoc.scrollingElement || ctl._fdoc.documentElement || ctl._fdoc.body;
        ctl._textScrollHost = scrollHost;
        const textResourceOwner = Symbol(`library-text:${renderGen}`);
        b._textViewport = createTextViewport({
          host: scrollHost,
          mount: ctl._fdoc.body,
          count: total,
          initialSection: center,
          initialLocator: {
            section: center,
            sectionId: b.meta.format === 'epub' ? (b.epub.spine[center]?.id || center) : center,
            ratio: Number.isFinite(Number(ctl._pendingAnchor?.r))
              ? Number(ctl._pendingAnchor.r)
              : Number.isFinite(Number(ctl._pendingRatio)) ? Number(ctl._pendingRatio) : 0,
          },
          estimateHeight: Math.max(520, ctl._frame?.clientHeight || pageEl.clientHeight || 720),
          loadSection: async (i) => {
            const html = await textPagesHtml(i, textResourceOwner);
            if (!renderAlive()) return null;
            const size = html.replace(/<[^>]+>/g, '').length || 1;
            if (!Array.isArray(ctl._chapSizes) || ctl._chapSizes.length !== total) ctl._chapSizes = Array(total).fill(1);
            ctl._chapSizes[i] = size;
            return { html };
          },
          getSectionId: (i) => b.meta.format === 'epub' ? (b.epub.spine[i]?.id || i) : i,
          releaseOutside: (keepIds) => {
            if (b.meta.format === 'epub') b.epub.unloadOutside?.(keepIds, textResourceOwner);
          },
          isAlive: renderAlive,
          onSection: (section) => {
            if (!renderAlive()) return;
            if (b.meta.format === 'epub') ctl.chapterIdx = section; else ctl.pageIdx = section;
            updateProgressBar();
            clearTimeout(ctl._flowHideT);
            ctl._flowHideT = setTimeout(saveProgress, 500);
          },
        });
        await b._textViewport.ready;
        if (!renderAlive()) return;
        if (typeof ResizeObserver !== 'undefined') {
          ctl._flowRO?.disconnect?.();
          ctl._flowRO = new ResizeObserver(() => {
            if (!renderAlive() || ctl.book?._textViewport !== b._textViewport) return;
            const locator = b._textViewport.captureStableLocator?.()
              || b._textViewport.captureLocator?.();
            reflowReaderGeometry(locator);
          });
          ctl._flowRO.observe(pageEl);
        }
        ctl._pendingRatio = null;
        ctl._pendingAnchor = null;
        updateProgressBar();
        renderToc();
        saveProgress();
        return;
      }
    } else if (isImage) {
      // 图片类：单页=一图一屏（max-height 约束，杜绝底部被挡）；双页=中轴分割占满整格
      pageEl.classList.add('lib-manga-mode');
      retireReaderFrame();
      const flat = b.meta.format === 'manga-folder' ? flatManga(b) : null;
      const count = flat ? flat.length : b.cbz.count;
      ctl.pageIdx = Math.max(0, Math.min(ctl.pageIdx, count - 1));
      applyComicSizing();
      const loadPage = flat ? (i) => imageUrl(flat[i]?.path || '') : (i) => b.cbz.loadPage(i);
      const aspect = b._pageAspect ||= new Map();
      const coverSingle = ctl.spreadCoverSingle !== false;
      const spread = planSpread({
        count, index: ctl.pageIdx, mode: ctl.mode, direction: ctl.direction,
        coverSingle,
        offset: ctl.mode === 'double'
          ? spreadOffsetForPhysicalPage(ctl.pageIdx, { coverSingle })
          : ctl.spreadOffset || 0,
        aspect: (i) => aspect.get(i) || 0,
      });
      const makeImg = async (descriptor) => {
        if (!descriptor || descriptor.kind !== 'page') return null;
        const url = await loadPage(descriptor.index);
        if (!renderAlive()) return null;
        const img = document.createElement('img');
        img.className = 'lib-manga-page';
        img.alt = `第 ${descriptor.index + 1} 页`;
        img.decoding = 'async';
        img.addEventListener('load', () => {
          if (!img.naturalWidth || !img.naturalHeight) return;
          const ratio = img.naturalWidth / img.naturalHeight;
          const previous = aspect.get(descriptor.index) || 0;
          aspect.set(descriptor.index, ratio);
          if (ctl.mode === 'double' && previous <= 1.15 && ratio > 1.15 && renderAlive()) {
            void scheduleReaderAction(() => showCurrent());
          }
        }, { once: true });
        img.src = url;
        await decodeReaderImage(img);
        return renderAlive() ? img : null;
      };
      // Decode the candidate page(s) off-DOM.  The currently visible page stays
      // intact until its replacement is actually ready, so a slow image never
      // turns into a blank flash.
      const nextPage = document.createDocumentFragment();
      if (spread.layout === 'single' || spread.layout === 'wide') {
        const img = await makeImg(spread.pages[0]);
        if (!renderAlive()) return;
        if (img) nextPage.appendChild(img);
      } else {
        const spreadEl = document.createElement('div');
        spreadEl.className = 'lib-double lib-double-full';
        for (const side of ['left', 'right']) {
          const slot = document.createElement('div');
          slot.className = `lib-spread-slot lib-spread-slot--${side}`;
          const descriptor = spread.slots[side];
          if (descriptor?.kind === 'page') {
            const img = await makeImg(descriptor);
            if (!renderAlive()) return;
            if (img) slot.appendChild(img);
          } else {
            slot.classList.add('is-blank');
            slot.setAttribute('aria-hidden', 'true');
          }
          spreadEl.appendChild(slot);
        }
        nextPage.appendChild(spreadEl);
      }
      if (!renderAlive()) return;
      pageEl.replaceChildren(nextPage);
      if (ctl._pendingTurnDirection) {
        signalOuterPageTurn(pageEl, ctl._pendingTurnDirection);
        ctl._pendingTurnDirection = 0;
      }
      if (!flat) b.cbz.unloadOutside?.(new Set([
        ...spread.pageIndices,
        ctl.pageIdx - 1, ctl.pageIdx + 1,
      ].filter(Number.isInteger)));
    } else {
      // 文本类：一次只实体化当前章；章内分栏，跨章在边界原子切换。
      if (!await ensureFrame() || !renderAlive()) return;
      const total = totalPages();
      const unit = b.meta.format === 'epub' ? '章' : '页';
      const htmls = [];
      if (!Array.isArray(ctl._chapSizes) || ctl._chapSizes.length !== total) ctl._chapSizes = Array(total).fill(1);
      const only = Math.max(0, Math.min(currentPos(), total - 1));
      // One neighbour per side makes the CSS column rail continuous across a
      // chapter boundary. In double view this is the difference between the
      // requested overlapping N/N+1 → N+1/N+2 motion and an atomic two-page
      // jump to a freshly mounted chapter.
      const sectionIndices = pagedSectionWindow(only, total, ctl._pendingAnchor);
      for (const i of sectionIndices) {
        const h = await textPagesHtml(i);
        if (!renderAlive()) return;
        ctl._chapSizes[i] = h.replace(/<[^>]+>/g, '').length || 1;
        htmls.push(`<span class="lib-chap-mark" data-i="${i}"></span>${h}`);
      }
      if (b.meta.format === 'epub') {
        const keep = new Set(sectionIndices.map(i => b.epub.spine[i]?.id).filter(Boolean));
        b.epub.unloadOutside?.(keep);
      }
      ctl._fdoc.body.classList.remove('lib-scroll');
      ctl._fdoc.body.classList.add('lib-paged');
      ctl._fdoc.body.innerHTML = `<div class="lib-flow-wrap"><div class="lib-flow">${htmls.join('')}</div></div>`;
      applyFrameStyle();
      const wrap = ctl._fdoc.querySelector('.lib-flow-wrap');
      ctl._flowWrap = wrap;
      // 翻页方向：rtl 时列从右排起（日漫习惯）。
      wrap.style.direction = ctl.direction === 'rtl' ? 'rtl' : '';
      const flow = ctl._fdoc.querySelector('.lib-flow');

      // ResizeObserver fires after Chromium has already committed the changed
      // iframe geometry.  The old semantic reading point therefore cannot be
      // reconstructed inside its callback.  Keep the last stable locator in
      // lock-step with every page/layout mutation and replay that snapshot.
      let stableSemanticLocator = ctl._pendingAnchor && typeof ctl._pendingAnchor === 'object'
        ? { ...ctl._pendingAnchor }
        : null;
      let resizeSemanticLocator = null;
      let resizeSemanticEpoch = 0;
      const rememberSemanticLocator = locator => {
        if (!locator || typeof locator !== 'object') return stableSemanticLocator;
        stableSemanticLocator = { ...locator };
        return stableSemanticLocator;
      };
      ctl._captureStableAnchor = () => (resizeSemanticLocator || stableSemanticLocator)
        ? { ...(resizeSemanticLocator || stableSemanticLocator) }
        : (captureAnchor() || null);

      // —— 切片定位：offset 始终是物理页距的整数倍。 ——
      const applyOffset = (off, smooth = false, turnDirection = 0, semanticLocator = null) => {
        if (!renderAlive() || ctl._flowWrap !== wrap) return;
        // A deliberate page turn supersedes an in-flight resize transaction.
        // Reflow replay always supplies its locked semantic locator, whereas a
        // user navigation calls applyOffset without one.
        if (!semanticLocator && resizeSemanticLocator) {
          resizeSemanticLocator = null;
          resizeSemanticEpoch++;
          clearTimeout(ctl._flowResizeTimer);
          ctl._flowResizeTimer = null;
        }
        const wrapW = wrap.clientWidth || 1;
        const pitch = Math.max(1, ctl._pageGeometry?.pagePitch || ctl._pageW || 1);
        const rawMax = Math.max(0, flow.scrollWidth - wrapW);
        const max = Math.max(0, Math.floor(rawMax / pitch) * pitch);
        ctl._flowOffset = Math.max(0, Math.min(Math.round((Number(off) || 0) / pitch) * pitch, max));
        flow.style.transition = '';
        flow.style.transform = `translateX(${-ctl._flowOffset}px)`;
        if (smooth && turnDirection) signalPageTurn(wrap, turnDirection);
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
        // A reflow-safe chapter-edge locator is an explicit owner decision,
        // not a hint to be overwritten by column-marker rounding. During a
        // resize burst Chromium can briefly report the preceding marker as
        // leading even though the restored physical page is the next
        // chapter's first page. Keep controller state atomic with the
        // semantic locator so later resizes/progress writes cannot fall back
        // to the low chapter.
        if (semanticLocator?.kind === 'chapter-edge' && Number.isFinite(Number(semanticLocator.m))) {
          if (ctl.book?.meta.format === 'epub') ctl.chapterIdx = Number(semanticLocator.m);
          else ctl.pageIdx = Number(semanticLocator.m);
        }
        const bridge = !semanticLocator && stableSemanticLocator?.kind === 'chapter-bridge'
          ? stableSemanticLocator : null;
        const highMark = bridge
          ? flow.querySelector(`.lib-chap-mark[data-i="${Number(bridge.high)}"]`)
          : null;
        const highStart = highMark ? offOf(highMark) : Infinity;
        const crossedBridge = !!bridge && ctl._flowOffset >= highStart - 1;
        if (crossedBridge) {
          if (ctl.book?.meta.format === 'epub') ctl.chapterIdx = Number(bridge.high);
          else ctl.pageIdx = Number(bridge.high);
        }
        updateProgressBar();
        ctl._flowHideT && clearTimeout(ctl._flowHideT);
        ctl._flowHideT = setTimeout(saveProgress, 600);
        const captured = semanticLocator || captureAnchor();
        // A bridge is a temporary overlapping spread. Once its high chapter's
        // first physical page becomes the leading page, never retain an
        // off-screen caret from the low chapter: Chromium can return one for a
        // transformed multicolumn rail. A chapter-edge locator is the exact,
        // reflow-safe meaning of this position.
        rememberSemanticLocator(crossedBridge
          ? { kind: 'chapter-edge', edge: 'start', m: Number(bridge.high) }
          : captured);
      };
      ctl._applyOffset = applyOffset; // 帧内锚点链接经此定位

      // 双页只是同时展示两个物理页；阅读游标仍按一页距推进。
      const gapOf = () => ctl._pageGeometry?.physicalGutter ?? (ctl.mode === 'double' ? 18 : 0);
      const pitchOf = () => ctl._pageGeometry?.pagePitch || ((ctl._pageW || 0) + gapOf());
      const stepOf = () => pitchOf() || 1;
      ctl._stepOf = stepOf; // 进度条页数分母同基准（步进与报数同一把尺）

      const maxOffset = () => Math.max(0, flow.scrollWidth - (wrap.clientWidth || 1));
      const offOf = (node) => physicalPageOffset({
        contentOffset: node?.offsetLeft || 0,
        pagePaddingInline: ctl._pageGeometry?.pagePaddingInline || 0,
        pagePitch: stepOf(),
        maxOffset: maxOffset(),
      });
      const nodeForLocator = (locator) => {
        if (!locator || locator.kind === 'chapter-edge') return null;
        let node = locator.p ? resolveXpath(locator.p) : null;
        const fingerprint = String(locator.t || '').trim().slice(0, 20);
        if (node && fingerprint && !String(node.textContent || '').trim().startsWith(fingerprint)) node = null;
        const chapter = Number.isInteger(Number(locator.m)) ? Number(locator.m) : null;
        const candidates = semanticBlocks(flow).filter(block => chapter == null || chapterOfBlock(block) === chapter);
        if (!node && fingerprint) {
          node = candidates.find(block => String(block.textContent || '').trim().startsWith(fingerprint)) || null;
        }
        if (!node && Number.isFinite(Number(locator.r))) {
          const index = Math.round(Math.max(0, Math.min(1, Number(locator.r))) * Math.max(0, candidates.length - 1));
          node = candidates[index] || null;
        }
        return node;
      };
      const contentOffsetForLocator = (locator, fallbackNode) => {
        const textNode = locator?.tp ? resolveNodePath(locator.tp) : null;
        if (textNode && ctl._fdoc?.createRange) {
          const text = String(textNode.textContent || '');
          const offset = Math.max(0, Math.min(text.length, Number(locator.o) || 0));
          const quote = String(locator.q || '').trim();
          if (!quote || text.slice(offset).trimStart().startsWith(quote.slice(0, 20))) {
            try {
              const range = ctl._fdoc.createRange();
              range.setStart(textNode, offset);
              range.collapse(true);
              const rect = range.getClientRects?.()[0] || range.getBoundingClientRect?.();
              const wrapRect = wrap.getBoundingClientRect?.();
              if (rect && wrapRect && Number.isFinite(rect.left) && Number.isFinite(wrapRect.left)) {
                return Math.max(0, rect.left - wrapRect.left);
              }
            } catch {}
          }
        }
        return fallbackNode?.offsetLeft || 0;
      };
      const restoreSemanticLocator = (locator) => {
        if (!locator) return false;
        if (locator.kind === 'chapter-bridge') {
          const highMark = flow.querySelector(`.lib-chap-mark[data-i="${Number(locator.high)}"]`);
          if (!highMark) return false;
          applyOffset(chapterBridgeOffset({
            highOffset: highMark.offsetLeft,
            pagePitch: stepOf(),
            maxOffset: maxOffset(),
          }), false, 0, locator);
          return true;
        }
        if (locator.kind === 'chapter-edge') {
          const mark = flow.querySelector(`.lib-chap-mark[data-i="${Number(locator.m)}"]`);
          if (!mark) return false;
          const start = offOf(mark);
          const end = (() => {
            const nextMark = [...flow.querySelectorAll('.lib-chap-mark')]
              .find(candidate => Number(candidate.dataset.i) > Number(locator.m));
            return nextMark ? Math.max(start, offOf(nextMark) - stepOf()) : maxOffset();
          })();
          applyOffset(locator.edge === 'end' ? end : start, false, 0, locator);
          return true;
        }
        const node = nodeForLocator(locator);
        const fingerprint = String(locator.t || '').trim().slice(0, 20);
        window.__restoreDbg = {
          kind: locator.kind || 'legacy-dom', p: locator.p || '', fingerprint,
          nodeText: String(node?.textContent || '').trim().slice(0, 20),
          nodeOffL: node?.offsetLeft ?? null, ok: !!node,
          max: maxOffset(), wrapW: wrap.clientWidth,
        };
        if (!node) return false;
        applyOffset(physicalPageOffset({
          contentOffset: contentOffsetForLocator(locator, node),
          pagePaddingInline: ctl._pageGeometry?.pagePaddingInline || 0,
          pagePitch: stepOf(),
          maxOffset: maxOffset(),
        }), false, 0, locator);
        return true;
      };

      const layOut = (semanticLocator = null) => {
        if (!renderAlive() || ctl._flowWrap !== wrap) return;
        // 帧已退役（离书/换书后 RO 迟发）直接弃权——空 _fdoc 硬读必炸（异常警察实锤）
        if (!ctl._fdoc) return;
        // 可视宽回退链：innerHTML 同步读 clientWidth 常为 0/旧值（超宽总根）——RAF 后必修正
        const w = ctl._fdoc.documentElement?.clientWidth || wrap.parentElement?.clientWidth || pageEl.clientWidth || 0;
        const h = ctl._fdoc.documentElement?.clientHeight || pageEl.clientHeight || 0;
        if (!w) return;
        // Semantic locator was captured before this call. Remove the old
        // transform while measuring the same text point in the new geometry.
        flow.style.transition = '';
        flow.style.transform = '';
        const geometry = computeReaderPageGeometry({
          viewportWidth: w,
          viewportHeight: h,
          mode: normalizeReaderMode(ctl.mode),
          pageWidth: ctl.pageWidth,
          margin: ctl.pageMargin,
          fontSize: ctl.fontSize,
          lineHeight: ctl.lineHeight,
        });
        ctl._pageGeometry = geometry;
        const pageW = geometry.sheetWidth;
        ctl._pageW = pageW;
        // 容器固定宽：单页=页宽，双页=2×页宽+实体中缝。
        const wrapW = Math.min(geometry?.wrapWidth || pageW, w);
        wrap.style.width = wrapW + 'px';
        wrap.style.margin = '0 auto';
        wrap.style.overflow = 'hidden';
        wrap.dataset.spread = geometry?.effectiveMode === 'double' ? 'double' : 'single';
        wrap.style.setProperty('--reader-spread-gutter', `${geometry?.physicalGutter || 0}px`);
        ctl._fdoc.body.style.setProperty('--reader-stage-block', `${geometry?.outerBlock || 10}px`);
        flow.style.setProperty('--reader-pad-inline', `${geometry?.pagePaddingInline || 36}px`);
        flow.style.setProperty('--reader-pad-block', `${geometry?.pagePaddingBlock || 32}px`);
        // 内容栏只是版心；columnGap 同时包含前页右留白、实体中缝和后页左留白。
        flow.style.columnWidth = `${geometry.contentWidth}px`;
        flow.style.columnGap = `${geometry.columnGap}px`;
        flow.style.columnFill = 'auto';
        flow.style.height = '100%';
        const locator = semanticLocator || stableSemanticLocator;
        if (locator) restoreSemanticLocator(locator);
        else applyOffset(ctl._flowOffset || 0);
      };
      layOut();
      // Reopen/reflow accepts semantic anchors only. Legacy ratio evidence is
      // intentionally ignored in paged mode because it describes old pixels.
      const pendingLocator = ctl._pendingAnchor;
      const hadPending = restoreSemanticLocator(pendingLocator);
      if (!hadPending) {
        const anchor = flow.querySelector(`[data-i="${currentPos()}"]`);
        if (anchor) applyOffset(offOf(anchor));
        else applyOffset(0);
      }
      // 布局落定后必重排（同步读宽不可靠：目录开合/字号/窗格拖变全要跟上）；重排在即重放恢复
      ctl._flowRAF = requestAnimationFrame(() => {
        if (!renderAlive() || ctl._flowWrap !== wrap) return;
        layOut();
        if (hadPending) restoreSemanticLocator(pendingLocator);
      });
      ctl._flowTimer = setTimeout(() => {
        if (!renderAlive() || ctl._flowWrap !== wrap) return;
        layOut();
        if (hadPending) restoreSemanticLocator(pendingLocator);
        ctl._pendingAnchor = null;
        ctl._pendingRatio = null;
      }, 320);
      // 窗格拖动/窗口缩放实时跟随
      if (typeof ResizeObserver !== 'undefined') {
        if (ctl._flowRO) ctl._flowRO.disconnect();
        ctl._flowRO = new ResizeObserver(() => {
          if (!renderAlive() || ctl._flowWrap !== wrap) return;
          // One BrowserWindow resize produces a burst of callbacks with mixed
          // intermediate geometries. Snapshot once, replay that same semantic
          // point for the whole burst, and do not let caret sampling from an
          // intermediate frame become the next canonical locator.
          resizeSemanticLocator ||= stableSemanticLocator
            ? { ...stableSemanticLocator }
            : null;
          const locator = resizeSemanticLocator ? { ...resizeSemanticLocator } : null;
          if (!locator) return;
          const token = ++resizeSemanticEpoch;
          layOut(locator);
          clearTimeout(ctl._flowResizeTimer);
          ctl._flowResizeTimer = setTimeout(() => {
            if (!renderAlive() || ctl._flowWrap !== wrap || token !== resizeSemanticEpoch) return;
            layOut(locator);
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (!renderAlive() || ctl._flowWrap !== wrap || token !== resizeSemanticEpoch) return;
              rememberSemanticLocator(locator);
              resizeSemanticLocator = null;
              ctl._flowResizeTimer = null;
            }));
          }, 180);
        });
        ctl._flowRO.observe(pageEl);
      }
      if (ctl._pendingTurnDirection) {
        signalPageTurn(wrap, ctl._pendingTurnDirection, { chapter: true });
        ctl._pendingTurnDirection = 0;
      }
      // 切片翻页口：贴网自矫正（koodo 纪律——先 Math.round 取整贴网再 ±1 页，漂移不累积）
      ctl._flowNav = async (delta) => {
        if (!renderAlive() || ctl._flowWrap !== wrap) return;
        const total = totalPages();
        if (!wrap.clientWidth) {
          const next = advancePhysicalPage(currentPos(), delta, total);
          if (ctl.book?.meta.format === 'epub') ctl.chapterIdx = next;
          else ctl.pageIdx = next;
          ctl._pendingAnchor = { kind: 'chapter-edge', edge: delta < 0 ? 'end' : 'start', m: next };
          await showCurrent();
          return;
        }
        const step = stepOf();
        const cur = Math.round((ctl._flowOffset || 0) / step);
        const last = Math.max(0, Math.floor(Math.max(0, flow.scrollWidth - wrap.clientWidth) / step));
        if ((delta > 0 && cur < last) || (delta < 0 && cur > 0)) {
          applyOffset((cur + delta) * step, true, delta);
          return;
        }
        const next = advancePhysicalPage(currentPos(), delta, total);
        if (next === currentPos()) return;
        const bridge = ctl._pageGeometry?.effectiveMode === 'double'
          ? chapterBridgeLocator(currentPos(), next, total)
          : null;
        if (ctl.book?.meta.format === 'epub') ctl.chapterIdx = next; else ctl.pageIdx = next;
        ctl._pendingRatio = null;
        ctl._pendingAnchor = bridge || { kind: 'chapter-edge', edge: delta < 0 ? 'end' : 'start', m: next };
        ctl._pendingTurnDirection = delta;
        await showCurrent();
      };
      ctl._flowLayout = (semanticLocator = null) => {
        if (!renderAlive() || ctl._flowWrap !== wrap) return;
        const locator = semanticLocator
          || (stableSemanticLocator ? { ...stableSemanticLocator } : captureAnchor());
        layOut(locator);
        updateProgressBar();
      };
    }
    if (ctl.mode !== 'scroll' && !(ctl._flowWrap && !isImage && b.meta.format !== 'pdf')) contentEl.scrollTop = 0;
    updateProgressBar();
    renderToc();
    saveProgress();
  }

  async function nav(delta) {
    const b = ctl.book;
    if (!b || b.meta.format === 'pdf') return;
    const isImage = b.meta.format === 'cbz' || b.meta.format === 'manga-folder';
    if (isImage && ctl.mode === 'double') {
      const count = totalPages();
      const next = advancePhysicalPage(ctl.pageIdx, delta, count);
      if (next !== ctl.pageIdx) {
        ctl.pageIdx = next;
        ctl._pendingTurnDirection = delta;
      }
      await showCurrent();
      return;
    }
    // 切片横排（文本类单/双页）：整屏平移翻页（容器宽步进，章末自然续章）
    if (ctl._flowNav && ctl.mode !== 'scroll' && b.meta.format !== 'cbz' && b.meta.format !== 'manga-folder') {
      await ctl._flowNav(delta);
      return;
    }
    const total = totalPages();
    const step = Math.sign(delta);
    const before = currentPos();
    if (b.meta.format === 'epub') ctl.chapterIdx = Math.min(Math.max(ctl.chapterIdx + step, 0), total - 1);
    else ctl.pageIdx = Math.min(Math.max(ctl.pageIdx + step, 0), total - 1);
    if (currentPos() !== before) ctl._pendingTurnDirection = delta;
    await showCurrent();
  }

  // ==================== 阅读主题与样式 ====================
  function applyReadTheme() {
    const t = READ_THEMES[ctl.readTheme] || READ_THEMES.paper;
    const stage = `color-mix(in srgb, ${t.bg} 94%, ${t.fg} 6%)`;
    const textOwner = ['epub', 'txt', 'mobi', 'azw3'].includes(ctl.book?.meta?.format);
    contentEl.style.background = stage;
    pageEl.style.background = textOwner ? 'transparent' : t.bg;
    pageEl.style.color = t.fg;
    applyTextStyle();
  }
  function applyTextStyle() {
    pageEl.style.fontSize = ctl.fontSize + 'px';
    pageEl.style.lineHeight = ctl.lineHeight;
    if (ctl.fontFamily) pageEl.style.fontFamily = ctl.fontFamily;
    applyFrameStyle(); // 沙箱帧内样式同步（主题/字号/行高/字体重写帧内 <style>，帧外样式进不去帧）
  }

  // ==================== 书签 ====================
  async function getMarks() {
    return (await readRepository(repo => repo.getValue('bookmarks')).catch(() => ({}))) || {};
  }
  async function addMark() {
    const owner = ctl.book;
    if (!owner) return;
    const bookId = owner.meta.id;
    const pos = currentPos();
    const name = await ownedInputModal('书签名称', `第 ${pos + 1} 页`);
    if (name == null || ctl._destroyed || ctl.book !== owner) return;
    const mark = { name: name.trim() || `第 ${pos + 1} 页`, pos, at: Date.now() };
    await mutateRepository('bookmarks', all => {
      const list = Array.isArray(all[bookId]) ? [...all[bookId]] : [];
      list.push(mark);
      all[bookId] = list;
    });
    if (!ctl._destroyed && ctl.book === owner) toast('书签已添加');
  }
  async function showMarks() {
    const owner = ctl.book;
    if (!owner) return;
    const bookId = owner.meta.id;
    const all = await getMarks();
    if (ctl._destroyed || ctl.book !== owner) return;
    const list = (all[bookId] || []).map(mark => ({ ...mark }));
    if (!list.length) { toast('还没有书签'); return; }
    const m = document.createElement('div');
    m.className = 'mazz-palette-mask';
    m.innerHTML = `<div class="mazz-palette" style="padding:16px 18px;min-width:320px">
      <b>书签</b>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;max-height:50vh;overflow-y:auto">
        ${list.map((mk, i) => `<div style="display:flex;gap:6px;align-items:center">
          <button class="rb-btn" data-i="${i}" style="flex:1;flex-direction:row;justify-content:flex-start">${iconHtml('🔖')}<span>${escapeHtml(mk.name)}</span></button>
          <button class="rb-btn" data-del="${i}" title="删除" aria-label="删除书签">${iconHtml('✕')}</button></div>`).join('')}
      </div></div>`;
    document.body.appendChild(m);
    const closeMask = ownMask(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeMask(); });
    m.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', async () => {
      const mk = list[+btn.dataset.i];
      if (!mk || ctl._destroyed || ctl.book !== owner) { closeMask(); return; }
      if (owner.meta.format === 'epub') ctl.chapterIdx = mk.pos; else ctl.pageIdx = mk.pos;
      closeMask();
      await scheduleReaderAction(() => showCurrent());
    }));
    m.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      const selected = list[+btn.dataset.del];
      if (!selected || ctl._destroyed || ctl.book !== owner) { closeMask(); return; }
      await mutateRepository('bookmarks', draft => {
        const fresh = Array.isArray(draft[bookId]) ? [...draft[bookId]] : [];
        const removeAt = fresh.findIndex(mark => mark?.at === selected.at
          && mark?.pos === selected.pos && mark?.name === selected.name);
        if (removeAt >= 0) fresh.splice(removeAt, 1);
        draft[bookId] = fresh;
      });
      closeMask();
      if (!ctl._destroyed && ctl.book === owner) void showMarks().catch(() => {});
    }));
  }

  // ==================== 书内搜索 ====================
  function showSearch() {
    if (!ctl.book || ctl.book.meta.format === 'pdf') { toast('PDF 请用内建查找'); return; }
    const existing = root.querySelector('.lib-search-bar');
    if (existing) { existing.querySelector('input')?.focus(); return; }
    const bar = document.createElement('div');
    bar.className = 'lib-search-bar';
    bar.innerHTML = `<input class="rb-input" placeholder="书内搜索…" spellcheck="false"><button class="rb-btn">搜</button><button class="rb-btn lib-search-close" title="关闭搜索" aria-label="关闭搜索">${iconHtml('✕')}</button>`;
    root.querySelector('.lib-reader-bar').appendChild(bar);
    const input = bar.querySelector('input');
    input.focus();
    const cancelSearch = () => { ctl._searchGen++; };
    const closeSearch = () => { cancelSearch(); bar.remove(); renderToc(); };
    const doSearch = async () => {
      const q = input.value.trim();
      if (!q) return;
      const b = ctl.book;
      const generation = ++ctl._searchGen;
      const alive = () => !ctl._destroyed && ctl.book === b && generation === ctl._searchGen && bar.isConnected;
      let hits = [];
      if (b.meta.format === 'epub') {
        const result = await searchEpubRaw(b.epub, q, { isAlive: alive, limit: 30 });
        if (result.cancelled || !alive()) return;
        hits = result.hits;
      } else if (b.textBook) {
        b.textBook.pages.forEach((p, i) => { if (p.toLowerCase().includes(q.toLowerCase())) hits.push({ label: `第 ${i + 1} 页`, idx: i }); });
      } else { toast('该格式不支持书内搜索'); bar.remove(); return; }
      if (!alive()) return;
      const r = document.createElement('div');
      r.className = 'lib-search-results';
      r.innerHTML = hits.length
        ? hits.slice(0, 30).map(h => `<div class="lib-toc-item" data-i="${h.idx}" role="button" tabindex="0">${escapeHtml(h.label)}</div>`).join('')
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
      r.querySelectorAll('[data-i]').forEach(el => el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); el.click();
      }));
    };
    const runSearch = () => { void doSearch().catch(error => { if (bar.isConnected) toast('搜索失败：' + (error?.message || error)); }); };
    bar.querySelector('.rb-btn:not(.lib-search-close)').addEventListener('click', runSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
      if (e.key === 'Escape') closeSearch();
      e.stopPropagation();
    });
    bar.querySelector('.lib-search-close').addEventListener('click', closeSearch);
  }

  // ==================== 导出 ====================
  async function exportBookMarkdown(book) {
    if (ctl._destroyed || ctl._destroying || ctl._workspaceRebinding) return false;
    const target = book || ctl.book?.meta;
    if (!target) return;
    if (target.format !== 'epub') { toast('仅 epub 支持整书导出 Markdown'); return; }
    const generation = ++ctl._exportGen;
    const binding = repositoryBinding;
    const alive = () => !ctl._destroyed && !ctl._destroying && !ctl._workspaceRebinding
      && binding === repositoryBinding && !binding.retiring && generation === ctl._exportGen;
    let epub = null;
    try {
      toast('正在导出…');
      const sourceStat = await window.mazz.invoke('fs:stat', { path: target.path }).catch(() => null);
      const maxBytes = assertLibrarySourceWithinLimit(sourceStat, target.format, target.title || '书籍');
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: target.path, maxBytes });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (!alive()) return;
      epub = await parseEpub(bytes.buffer);
      if (!alive()) return;
      const result = await exportEpubMarkdownRaw(epub, {
        title: epub.title,
        author: epub.author,
        isAlive: alive,
      });
      if (!result.ok || result.cancelled || !alive()) return;
      window.MazzHost?.openTab('markdown', { title: target.title + '.md', content: result.content });
      toast(result.omittedImages
        ? `已导出为 Markdown；${result.omittedImages} 张超限图片以来源标记保留`
        : '已导出为 Markdown 文档');
    } catch (e) {
      if (alive()) toast('导出失败：' + (e.message || e));
    } finally {
      try { epub?.unloadAll?.(); } catch {}
    }
  }

  // ==================== Workspace owner rebind ====================
  let workspaceRebindRequest = 0;

  function beginWorkspaceRetirement() {
    if (ctl._workspaceRetirement) return ctl._workspaceRetirement;
    const binding = repositoryBinding;
    binding.retiring = true;
    ctl._workspaceRebinding = true;
    abortAcquisitionBinding(binding, 'workspace-retirement');
    acquireLifecycleInert('workspace');
    root.dataset.workspaceRebinding = 'true';

    // Invalidate every async producer before the first await. This is the
    // ownership hand-off point: no subsequent open/search/export/UI mutation
    // is allowed to start on the retiring repository.
    ctl._lifecycleGen++;
    ctl._openGen++;
    ctl._searchGen++;
    ctl._exportGen++;
    ctl._renderGen = (ctl._renderGen || 0) + 1;
    ctl.shelf.loadGen++;
    clearTimeout(ctl.shelf.queryTimer);
    ctl.shelf.queryTimer = null;
    closeOwnedOverlays();
    root.querySelector('.lib-search-bar')?.remove();
    readerInput.cancelFocusRequest();

    // Durability is a preflight: keep the old DOM/resource owner alive until
    // both its ledgers and the replacement repository are known-good. On any
    // failure the exact old reader/shelf can be made interactive again.
    shelfEl.setAttribute('aria-busy', 'true');

    // A candidate may already be installed while its slow render is pending.
    // The generation invalidation above makes that transaction roll back, but
    // the last healthy owner is unknown until its commit gate settles. Defer
    // owner/locator capture to drainRetiringBinding().
    const retirement = {
      binding,
      resourceWasVisible: resourceSurface.isVisible(),
      openCommit: ctl._openCommitTail,
      readerAction: ctl._readerActionTail,
      prepared: false,
      retiring: null,
      retiringId: '',
      durability: null,
    };
    ctl._workspaceRetirement = retirement;
    return retirement;
  }

  function prepareWorkspaceRetirementDurability(retirement) {
    if (retirement.prepared) return retirement.durability;
    retirement.prepared = true;
    const binding = retirement.binding;
    const retiring = ctl.book;
    const retiringId = retiring?.meta?.id || '';
    const retiringProgress = retiring ? progressRecord() : null;
    retirement.retiring = retiring;
    retirement.retiringId = retiringId;
    const positionWrite = retiringProgress && retiringId
      ? trackBindingOperation(binding, binding.locatorStore.put({
        bookId: retiringId,
        path: retiring.meta.path,
        record: retiringProgress,
      }))
      : Promise.resolve({ accepted: false });
    // flushReaderAppearance snapshots the mutable controller synchronously
    // before its first await; it remains scoped by the retiring book's prefs.
    const appearanceWrite = retiring ? flushReaderAppearance(retiring) : Promise.resolve([]);
    retirement.durability = Promise.all([
      positionWrite.then(() => retiringId ? binding.locatorStore.flush(retiringId) : []),
      appearanceWrite,
    ]);
    return retirement.durability;
  }

  async function drainRetiringBinding(retirement) {
    const binding = retirement.binding;
    // Freeze first, then let the invalidated open/navigation transactions
    // settle. Only the resulting healthy owner may be snapshotted or released.
    await Promise.all([
      Promise.resolve(retirement.openCommit).catch(() => null),
      Promise.resolve(retirement.readerAction).catch(() => null),
    ]);
    prepareWorkspaceRetirementDurability(retirement);
    await binding.ready.catch(() => null);
    await retirement.durability;
    // A mutation that passed requireActiveBinding just before the workspace
    // event may register during the first wait. Drain to a fixed point so the
    // new binding is never installed while an old durable task can still land.
    while (binding.pending.size) {
      await Promise.all([...binding.pending]);
    }
    await binding.locatorStore.flushAll();
  }

  async function waitForDestroyPreflight() {
    while (ctl._destroying && !ctl._destroyed) {
      const destroyTask = ctl._destroyReceipt ? ctl._destroyOutcomePromise : ctl._destroyPromise;
      if (destroyTask) await destroyTask.catch(() => false);
      else await Promise.resolve();
    }
    return !ctl._destroyed && !ctl._destroying;
  }

  async function restoreWorkspaceRetirement(retirement, error) {
    if (retirement !== ctl._workspaceRetirement || ctl._destroyed) return false;
    // Closing and workspace switching may enter their durability preflights in
    // the same turn. Never unlock or re-render while destroy owns the final
    // locator snapshot: doing so would let a late navigation mutate the reader
    // after that snapshot. If close fails, resume only after its gate has
    // cleared `_destroying`; if it succeeds, there is nothing left to restore.
    await waitForDestroyPreflight();
    if (retirement !== ctl._workspaceRetirement || ctl._destroyed) return false;
    retirement.binding.retiring = false;
    ctl._workspaceRetirement = null;
    ctl._workspaceRebinding = false;
    releaseLifecycleInert('workspace');
    delete root.dataset.workspaceRebinding;
    shelfEl.setAttribute('aria-busy', 'false');
    // A render/navigation invalidated in the event turn may have yielded while
    // rebuilding the old owner. Re-render from its still-live handle so retry
    // starts from a coherent visual controller instead of a half frame.
    if (ctl.book === retirement.retiring && readerView.style.display !== 'none') {
      await showCurrent().catch(() => false);
    } else if (readerView.style.display === 'none') {
      await renderShelf({ reload: true }).catch(() => null);
    }
    void resumePendingAcquisition(retirement.binding);
    if (retirement.resourceWasVisible) void resourceSurface.resume();
    if (error) toast('书库切换工作区失败，已保留原工作区：' + (error?.message || error));
    return false;
  }

  function commitWorkspaceRetirement(retirement, next) {
    // requestWorkspaceRebind waits for an in-flight destroy preflight before
    // entering this synchronous commit. Keep a local guard as a future-proof
    // invariant: B may never become observable while close still owns A's
    // final locator snapshot.
    if (ctl._destroyed || ctl._destroying || retirement !== ctl._workspaceRetirement
        || !retirement.prepared || ctl.book !== retirement.retiring) return false;
    const retiring = retirement.retiring;
    const resumeResource = retirement.resourceWasVisible;
    // Only now is old durability proven and the new repository initialized.
    // Release every old visual/resource owner before making the new binding
    // observable to shelf actions.
    readerView.style.display = 'none';
    shelfView.style.display = 'flex';
    window.MazzHost?.setTabTitle(container, '书库');
    retireFlowOwner();
    retireReaderFrame();
    disposeBookHandle(retiring);
    if (ctl.book === retiring) ctl.book = null;
    ctl._readerActionTail = null;
    ctl._procCache = {};
    ctl._chapSizes = [];
    ctl._lastSel = '';
    installRepositoryBinding(next);
    resetShelfForWorkspace();
    ctl._workspaceRetirement = null;
    ctl._workspaceRebinding = false;
    releaseLifecycleInert('workspace');
    delete root.dataset.workspaceRebinding;
    if (resumeResource) resourceSurface.show();
    return true;
  }

  function resetShelfForWorkspace() {
    ctl.catFilter = '';
    ctl.batchMode = false;
    ctl.batchSel.clear();
    ctl.shelf.records = [];
    ctl.shelf.progress = {};
    ctl.shelf.categories = [];
    ctl.shelf.snapshot = null;
    ctl.shelf.model = null;
    ctl.shelf.query = '';
    ctl.shelf.sort = 'recent';
    ctl.shelf.favoriteOnly = false;
    ctl.shelf.format = '';
    ctl.shelf.missing = 'all';
    shelfQuery.value = '';
    root.querySelector('.lib-batch-bar').style.display = 'none';
    shelfEl.scrollTop = 0;
  }

  function requestWorkspaceRebind(path) {
    if (ctl._handoffProvisional) return Promise.resolve(false);
    const directTarget = path == null ? '' : String(path);
    if (!ctl._workspaceRebinding && directTarget
        && canonicalWorkspace(directTarget) === repository.identity?.canonical) {
      return Promise.resolve(true);
    }
    const request = ++workspaceRebindRequest;
    const retirement = beginWorkspaceRetirement();
    const targetReady = directTarget
      ? Promise.resolve(directTarget)
      : window.mazz.invoke('workspace:get').catch(() => '');
    const previous = ctl._workspaceRebindTail || Promise.resolve();
    const task = previous.catch(() => false).then(async () => {
      const target = await targetReady;
      if (ctl._destroyed || request !== workspaceRebindRequest) return false;
      let next = null;
      try {
        await drainRetiringBinding(retirement);
        if (ctl._destroyed || request !== workspaceRebindRequest) return false;
        next = createRepositoryBinding(target);
        await next.ready;
        // Repository.init establishes identity only. Warm every partition the
        // first shelf paint needs (including migration/CAS) while the old owner
        // is still alive, so an unreadable new store cannot strand a blank tab.
        const [books, categories, progress] = await trackBindingOperation(next, Promise.all([
          next.repository.listBooks(),
          next.repository.getValue('categories'),
          next.repository.getValue('progress'),
        ]));
        if (ctl._destroyed || request !== workspaceRebindRequest) {
          next.retiring = true;
          return false;
        }
        // A close may start while B is warming. Its success removes this tab;
        // its failure restores the still-live controller. In neither case may
        // the rebind commit unlock or replace the owner during that preflight.
        if (!await waitForDestroyPreflight() || request !== workspaceRebindRequest) {
          next.retiring = true;
          return false;
        }
        if (!commitWorkspaceRetirement(retirement, next)) {
          next.retiring = true;
          return false;
        }
        ctl.shelf.records = books;
        ctl.shelf.categories = ['未分类', ...categories.filter(c => c !== '未分类')];
        ctl.shelf.progress = shelfProgressProjection(progress);
        ctl.shelf.model = createShelfViewModel({ records: books, progress: ctl.shelf.progress });
        const painted = paintShelfState({ resetScroll: true });
        void drainPendingAcquisition(next);
        return !ctl._destroyed && request === workspaceRebindRequest && !!painted;
      } catch (error) {
        if (next) next.retiring = true;
        if (!ctl._destroyed && request === workspaceRebindRequest) {
          return restoreWorkspaceRetirement(retirement, error);
        }
        return false;
      }
    });
    ctl._workspaceRebindTail = task;
    return task;
  }

  ctl.rebindWorkspace = requestWorkspaceRebind;
  ctl.detachWorkspaceRebind = () => {
    workspaceRebindRequest++;
    try { ctl._workspaceOff?.(); } catch {}
    ctl._workspaceOff = null;
  };
  if (window.mazz?.on) {
    ctl._workspaceOff = window.mazz.on('workspace:changed', ({ path } = {}) => {
      void requestWorkspaceRebind(path).catch(error => {
        if (!ctl._destroyed) toast('书库切换工作区失败：' + (error?.message || error));
      });
    });
    // Wake payloads are intentionally ignored. The durable main-process list
    // is the only source of receipt path/hash/Workspace truth.
    ctl._acquisitionInboxOff = window.mazz.on('library:acquisitionInboxReady', () => {
      void resumePendingAcquisition(repositoryBinding);
    });
    ctl._resourceChangedOff = window.mazz.on('library:resourceChanged', () => {
      void resourceSurface.resume();
    });
  }

  // ==================== 事件 ====================
  root.querySelector('[data-a=view-shelf]').addEventListener('click', () => {
    resourceSurface.hide();
    root.querySelector('[data-a=view-shelf]').classList.add('on');
    root.querySelector('[data-a=view-shelf]').setAttribute('aria-selected', 'true');
    root.querySelector('[data-a=view-resource]').classList.remove('on');
    root.querySelector('[data-a=view-resource]').setAttribute('aria-selected', 'false');
  });
  root.querySelector('[data-a=view-resource]').addEventListener('click', () => {
    if (!resourceSurface.show()) return;
    root.querySelector('[data-a=view-shelf]').classList.remove('on');
    root.querySelector('[data-a=view-shelf]').setAttribute('aria-selected', 'false');
    root.querySelector('[data-a=view-resource]').classList.add('on');
    root.querySelector('[data-a=view-resource]').setAttribute('aria-selected', 'true');
  });
  root.querySelector('[data-resource-back]').addEventListener('click', () => {
    root.querySelector('[data-a=view-shelf]').classList.add('on');
    root.querySelector('[data-a=view-shelf]').setAttribute('aria-selected', 'true');
    root.querySelector('[data-a=view-resource]').classList.remove('on');
    root.querySelector('[data-a=view-resource]').setAttribute('aria-selected', 'false');
  });
  root.querySelector('.lib-cat-filter').addEventListener('change', (e) => {
    ctl.catFilter = e.target.value;
    paintShelfState({ resetScroll: true });
  });
  const shelfQuery = root.querySelector('.lib-shelf-query');
  const applyShelfQuery = () => {
    if (ctl.shelf.composing || ctl._destroyed) return;
    clearTimeout(ctl.shelf.queryTimer);
    ctl.shelf.queryTimer = setTimeout(() => {
      ctl.shelf.queryTimer = null;
      ctl.shelf.query = shelfQuery.value;
      paintShelfState({ resetScroll: true });
    }, 80);
  };
  shelfQuery.addEventListener('compositionstart', () => { ctl.shelf.composing = true; });
  shelfQuery.addEventListener('compositionend', () => {
    ctl.shelf.composing = false;
    applyShelfQuery();
  });
  shelfQuery.addEventListener('input', applyShelfQuery);
  root.querySelector('.lib-shelf-sort').addEventListener('change', (event) => {
    ctl.shelf.sort = event.target.value || 'recent';
    paintShelfState({ resetScroll: true });
  });
  root.querySelector('.lib-shelf-format').addEventListener('change', (event) => {
    ctl.shelf.format = event.target.value || '';
    paintShelfState({ resetScroll: true });
  });
  root.querySelector('.lib-shelf-missing').addEventListener('change', (event) => {
    ctl.shelf.missing = event.target.value || 'all';
    paintShelfState({ resetScroll: true });
  });
  root.querySelector('[data-a=shelf-favorite]').addEventListener('click', () => {
    ctl.shelf.favoriteOnly = !ctl.shelf.favoriteOnly;
    paintShelfState({ resetScroll: true });
  });
  root.querySelector('[data-a=newcat]').addEventListener('click', async () => {
    if (ctl._destroyed) return;
    const lifecycleGen = ctl._lifecycleGen;
    const alive = () => !ctl._destroyed && ctl._lifecycleGen === lifecycleGen;
    const books = await getShelf();
    if (!alive()) return;
    const renderCatMgr = async () => {
      const cats = await getCats();
      if (!alive()) return '';
      return cats.map(c => {
        const n = books.filter(b => b.category === c).length;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bd,#eee)">
          <span style="flex:1">${escapeHtml(c)} <span style="color:var(--fg-dim);font-size:11px">（${n} 本）</span></span>
          <button class="fc-mini" data-delcat="${escapeHtml(c)}" style="color:var(--danger)">删除</button></div>`;
      }).join('') || '<div style="color:var(--fg-dim);padding:8px 0">还没有自定义分类</div>';
    };
    const initialList = await renderCatMgr();
    if (!alive()) return;
    const m = ownModal(modal('分类管理'));
    m.body.innerHTML = `
      <div style="min-width:340px">
        <div class="cat-list">${initialList}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <input class="rb-input cat-newname" placeholder="新分类名" style="flex:1">
          <button class="rb-btn cat-add" style="flex-direction:row">${iconHtml('＋')}<span>新建</span></button>
        </div>
        <div style="font-size:11px;color:var(--fg-dim);margin-top:6px">删除分类不会删书，书自动归到「未分类」。</div>
      </div>`;
    m.body.querySelector('.cat-add').addEventListener('click', async () => {
      const name = m.body.querySelector('.cat-newname').value.trim();
      if (!name || !alive()) return;
      await mutateRepository('categories', cats => {
        if (!cats.includes(name)) cats.push(name);
      });
      if (!alive()) { m.close(); return; }
      m.body.querySelector('.cat-list').innerHTML = await renderCatMgr();
      if (!alive()) { m.close(); return; }
      m.body.querySelector('.cat-newname').value = '';
      bindDel();
      renderShelf();
    });
    const bindDel = () => m.body.querySelectorAll('[data-delcat]').forEach(btn => btn.addEventListener('click', async () => {
      const c = btn.dataset.delcat;
      if (!alive()) { m.close(); return; }
      const ok = await window.mazz.invoke('dialog:confirm', { title: '删除分类', message: `删除分类「${c}」？其下书籍归入未分类。`, buttons: ['删除', '取消'] }).catch(() => 1);
      if (ok !== 0 || !alive()) return;
      await mutateRepository('categories', cats => cats.filter(x => x !== c));
      if (!alive()) { m.close(); return; }
      // 归类：该分类的书全部回未分类
      await mutateShelf(books => books.map(b => b.category === c ? { ...b, category: '未分类' } : b));
      if (!alive()) { m.close(); return; }
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
    const binding = repositoryBinding;
    const lifecycleGen = ctl._lifecycleGen;
    try {
      // The painted shelf is already an immutable projection of this binding;
      // use it synchronously when available. A cold fallback read must carry
      // both owner and lifecycle gates so a late Workspace-A result can never
      // repopulate Workspace-B's selection (same ids are valid across
      // workspaces).
      const books = ctl.shelf.snapshot
        ? [...ctl.shelf.records]
        : await getShelf(binding);
      if (ctl._lifecycleGen !== lifecycleGen) return;
      requireActiveBinding(binding);
      ctl.batchSel.clear();
      for (const book of books) ctl.batchSel.add(book.id);
      renderShelf();
    } catch (error) {
      if (!error?.stale && !ctl._destroyed) toast('全选失败：' + (error?.message || error));
    }
  });
  root.querySelector('[data-a=sel-none]').addEventListener('click', () => { ctl.batchSel.clear(); renderShelf(); });
  root.querySelector('[data-a=sel-moveto]').addEventListener('click', async () => {
    if (!ctl.batchSel.size) { toast('先勾选书籍'); return; }
    const lifecycleGen = ctl._lifecycleGen;
    const selectedIds = new Set(ctl.batchSel);
    const cats = await allCats();
    if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) return;
    const m = document.createElement('div');
    m.className = 'mazz-palette-mask';
    m.innerHTML = `<div class="mazz-palette" style="padding:16px 18px;min-width:280px"><b>${selectedIds.size} 本移到分类</b>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
        ${cats.map(c => `<button class="rb-btn" data-c="${escapeHtml(c)}" style="flex-direction:row;justify-content:flex-start">${escapeHtml(c)}</button>`).join('')}
      </div></div>`;
    document.body.appendChild(m);
    const closeMask = ownMask(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeMask(); });
    m.querySelectorAll('[data-c]').forEach(btn => btn.addEventListener('click', async () => {
      const category = btn.dataset.c;
      if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) { closeMask(); return; }
      await mutateShelf(books => books.map(b => selectedIds.has(b.id) ? { ...b, category } : b));
      if (ctl._destroyed || ctl._lifecycleGen !== lifecycleGen) { closeMask(); return; }
      for (const id of selectedIds) ctl.batchSel.delete(id);
      closeMask();
      renderShelf();
      toast('已批量移动');
    }));
  });
  root.querySelector('[data-a=sel-del]').addEventListener('click', async () => {
    if (!ctl.batchSel.size) { toast('先勾选书籍'); return; }
    const lifecycleGen = ctl._lifecycleGen;
    const selectedIds = [...ctl.batchSel];
    const r = await window.mazz.invoke('dialog:confirm', { title: '删除', message: `把 ${selectedIds.length} 本移出书架？（不删源文件）`, buttons: ['删除', '取消'] });
    if (r === 0 && !ctl._destroyed && ctl._lifecycleGen === lifecycleGen) await removeBooks(selectedIds);
  });
  root.querySelector('[data-a=sel-done]').addEventListener('click', () => {
    ctl.batchMode = false;
    ctl.batchSel.clear();
    root.querySelector('.lib-batch-bar').style.display = 'none';
    renderShelf();
  });
  root.querySelector('[data-a=import]').addEventListener('click', importBook);
  root.querySelector('[data-a=import-folder]').addEventListener('click', importMangaFolder);
  root.querySelector('[data-a=back]').addEventListener('click', async () => {
    if (ctl._backPending || ctl._destroyed || !ctl.book) return;
    ctl._backPending = true;
    acquireLifecycleInert('back');
    readerInput.cancelFocusRequest();
    ctl._searchGen++;
    ctl._exportGen++;
    root.querySelector('.lib-search-bar')?.remove();
    const backFocusOrigin = document.activeElement;
    const openCommit = ctl._openCommitTail;
    const backGen = ++ctl._openGen; // 令更早的候选 open 失效；更晚 open 仍可赢得 owner。
    let retiring = null;
    let retiringId = '';
    let retiringBinding = repositoryBinding;
    let retiringFrame = null;
    try {
      // Both an admitted reader action and a candidate render may own mutable
      // geometry. Invalidating above makes the candidate roll back; wait for
      // both gates before selecting the healthy book whose locator is durable.
      await Promise.all([
        Promise.resolve(ctl._readerActionTail).catch(() => null),
        Promise.resolve(openCommit).catch(() => null),
      ]);
      if (ctl._destroyed || ctl._openGen !== backGen || !ctl.book) {
        ctl._backPending = false;
        releaseLifecycleInert('back');
        return;
      }
      retiring = ctl.book;
      retiringId = retiring?.meta?.id || '';
      retiringBinding = retiring?._repositoryBinding || repositoryBinding;
      retiringFrame = ctl._frame;
      const retiringProgress = retiring ? progressRecord() : null;
      if (retiring) await saveProgress(retiringProgress, retiring.meta, retiringBinding);
      await Promise.all([
        retiringId ? retiringBinding.locatorStore.flush(retiringId) : Promise.resolve([]),
        retiring ? flushReaderAppearance(retiring) : Promise.resolve([]),
      ]);
      if (ctl._destroyed || ctl._openGen !== backGen || ctl.book !== retiring) {
        ctl._backPending = false;
        releaseLifecycleInert('back');
        return;
      }
    } catch (error) {
      ctl._backPending = false;
      releaseLifecycleInert('back');
      toast('阅读位置未能写入磁盘，已留在当前书籍；请检查磁盘空间或目录权限后重试');
      return;
    }

    readerView.style.display = 'none';
    shelfView.style.display = 'flex';
    window.MazzHost?.setTabTitle(container, '书库');
    // 等虚拟书架真正落 DOM 后再恢复焦点；否则 replaceChildren 会立刻
    // 吃掉刚 focus 的旧卡片。
    const shelfPaint = renderShelf();
    ctl._renderGen = (ctl._renderGen || 0) + 1;
    disposeBookHandle(retiring);
    retireFlowOwner();
    retireReaderFrame();
    ctl.book = null;
    ctl._procCache = {};
    ctl._backPending = false;
    releaseLifecycleInert('back');
    await shelfPaint;
    const active = document.activeElement;
    const mayRestoreFocus = !active || active === document.body || active === document.documentElement
      || active === backFocusOrigin || active === retiringFrame || readerView.contains(active);
    if (mayRestoreFocus && retiringId) {
      if (typeof shelfRenderer.focusKey === 'function') {
        await shelfRenderer.focusKey(retiringId, { preventScroll: true });
      } else {
        const returnCard = [...shelfEl.querySelectorAll('.lib-card')]
          .find(card => card.dataset.id === String(retiringId));
        returnCard?.focus?.({ preventScroll: true });
      }
    }
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
  const onDocumentSelectionChange = () => {
    const t = (window.getSelection()?.toString() || '').trim();
    if (t) ctl._lastSel = t;
  };
  document.addEventListener('selectionchange', onDocumentSelectionChange);
  root.querySelector('[data-a=clip]').addEventListener('click', async () => {
    const text = readSelection() || ctl._lastSel || ''; // 帧内选区优先（沙箱帧后正文选区在帧里）
    if (!text) { toast('先选中一段文字'); return; }
    window.__libClipText = text; // 桥接命令直接读缓存（桥内同样被折叠坑）
    window.MazzCommands.execute('bridge.libToNote');
  });
  root.querySelector('[data-a=export-md]').addEventListener('click', () => exportBookMarkdown());
  root.querySelector('[data-a=prev]').addEventListener('click', () => { void scheduleReaderAction(() => nav(-1)); });
  root.querySelector('[data-a=next]').addEventListener('click', () => { void scheduleReaderAction(() => nav(1)); });
  root.querySelector('[data-a=direction]').addEventListener('click', (e) => {
    ctl.direction = ctl.direction === 'ltr' ? 'rtl' : 'ltr';
    e.currentTarget.classList.toggle('on', ctl.direction === 'rtl');
    e.currentTarget.title = ctl.direction === 'rtl' ? '翻页方向：右到左（日漫）⇄' : '翻页方向：左到右 ⇄';
    toast(ctl.direction === 'rtl' ? '右到左翻页（日漫习惯）' : '左到右翻页');
    queueReaderAppearance();
    void scheduleReaderAction(() => showCurrent());
  });
  root.querySelector('.lib-mode').addEventListener('change', (e) => {
    ctl.mode = normalizeReaderMode(e.target.value);
    contentEl.onscroll = null;
    queueReaderAppearance();
    void scheduleReaderAction(() => showCurrent());
  });
  root.querySelector('.lib-read-theme').addEventListener('change', (e) => {
    ctl.readTheme = e.target.value;
    applyReadTheme();
    queueReaderAppearance();
  });
  root.querySelector('[data-a=font-minus]').addEventListener('click', () => {
    const locator = captureReaderReflowLocator();
    ctl.fontSize = Math.max(12, ctl.fontSize - 1);
    applyTextStyle();
    reflowReaderGeometry(locator);
    queueReaderAppearance();
  });
  root.querySelector('.lib-pagew').addEventListener('change', (e) => {
    const locator = captureReaderReflowLocator();
    ctl.pageWidth = +e.target.value;
    reflowReaderGeometry(locator);
    queueReaderAppearance();
  });
  root.querySelector('.lib-margin').addEventListener('change', (e) => {
    const locator = captureReaderReflowLocator();
    ctl.pageMargin = normalizeReaderMargin(e.target.value);
    reflowReaderGeometry(locator);
    queueReaderAppearance();
  });
  // 简繁转换：版本戳驱动章节回炉 + 随书记忆
  root.querySelector('.lib-zh').addEventListener('change', (e) => {
    ctl.zhMode = e.target.value;
    saveProgress();
    void scheduleReaderAction(() => showCurrent());
  });
  // B12b 收编：书库工具栏五 select 子窗格化（隐藏保留作状态单源；分类筛选选项动态——开格重读自带保鲜）
  import('../../lib/select-menu.js').then(({ selectProxy }) => {
    if (ctl._destroyed) return;
    root._libSelectProxies ||= new Map();
    for (const cls of ['.lib-cat-filter', '.lib-shelf-sort', '.lib-shelf-format', '.lib-shelf-missing', '.lib-mode', '.lib-read-theme', '.lib-pagew', '.lib-margin', '.lib-zh']) {
      const s = root.querySelector(cls); if (!s) continue;
      const px = selectProxy(s);
      root._libSelectProxies.set(cls, px);
      if (cls === '.lib-zh') root._zhProxy = px; // 随书恢复直赋值时的文案同步口
      try { px?.setCurrent?.(s.value); } catch {}
    }
  });
  // 净化规则管理（替换/删除 × 字面/正则 × 全书/本书）
  root.querySelector('[data-a=clean-rules]').addEventListener('click', async () => {
    const owner = ctl.book;
    if (!owner) return;
    const bookId = owner.meta.id;
    const ownerAlive = () => !ctl._destroyed && ctl.book === owner;
    const ruleIdentity = rule => String(rule?.id || [
      rule?.name, rule?.pattern, rule?.match, rule?.type, rule?.replacement, rule?.scope, rule?.bookId,
    ].map(value => String(value ?? '')).join('\u0000'));
    const m = ownModal(modal('净化规则'));
    const renderList = (rules) => rules.map((r, i) => `
      <div style="display:flex;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--bd,#eee);font-size:12.5px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.pattern || '')}">
          <b>${r.type === 'delete' ? '删' : '换'}</b> ${escapeHtml(r.name || r.pattern || '')}
          <span style="color:var(--fg-dim);font-size:11px">${r.match === 'regex' ? '正则' : '字面'} · ${r.scope === 'all' ? '全书' : '本书'}${r.type !== 'delete' && r.replacement ? ' → ' + escapeHtml(r.replacement) : ''}</span>
        </span>
        <button class="fc-mini" data-delrule="${i}" style="color:var(--danger)">删除</button>
      </div>`).join('') || '<div style="color:var(--fg-dim);padding:8px 0">还没有规则——网文广告与站点水印的清洗层</div>';
    const redraw = async () => {
      if (!ownerAlive()) { m.close(); return; }
      const rules = await getAllRules();
      if (!ownerAlive()) { m.close(); return; }
      m.body.querySelector('.cr-list').innerHTML = renderList(rules);
      m.body.querySelectorAll('[data-delrule]').forEach(btn => btn.addEventListener('click', async () => {
        const selected = rules[+btn.dataset.delrule];
        if (!selected || !ownerAlive()) { m.close(); return; }
        let changed = false;
        const cur = await mutateAllRules(draft => {
          if (!ownerAlive()) return draft;
          const removeAt = draft.findIndex(rule => ruleIdentity(rule) === ruleIdentity(selected));
          if (removeAt >= 0) { draft.splice(removeAt, 1); changed = true; }
          return draft;
        });
        if (!ownerAlive()) { m.close(); return; }
        if (!changed) { void redraw().catch(() => {}); return; }
        ctl._cleanRules = rulesForBook(cur, bookId);
        ctl._rulesVer = (ctl._rulesVer || 0) + 1;
        void redraw().catch(() => {});
        void scheduleReaderAction(() => showCurrent());
      }));
    };
    m.body.innerHTML = `
      <div style="min-width:480px;max-width:620px">
        <div class="cr-list" style="max-height:32vh;overflow-y:auto"></div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center">
          <input class="rb-input cr-name" placeholder="规则名（可空）" style="width:110px">
          <input class="rb-input cr-pattern" placeholder="匹配内容（如：广告|水印网址）" style="flex:1;min-width:150px">
          <select class="rb-select cr-match"><option value="plain">字面</option><option value="regex">正则</option></select>
          <select class="rb-select cr-type"><option value="delete">删除</option><option value="replace">替换为</option></select>
          <input class="rb-input cr-rep" placeholder="替换为（删除留空）" style="width:120px">
          <select class="rb-select cr-scope"><option value="all">全书</option><option value="book">本书</option></select>
          <button class="rb-btn cr-add" style="flex-direction:row">${iconHtml('＋')}<span>添加</span></button>
        </div>
        <div style="font-size:11px;color:var(--fg-dim);margin-top:6px">规则按序生效；作用于文本节点（永不碰标签结构）；坏正则会自动跳过。</div>
      </div>`;
    m.body.querySelector('.cr-add').addEventListener('click', async () => {
      const pattern = m.body.querySelector('.cr-pattern').value;
      if (!pattern || !ownerAlive()) return;
      const nextRule = {
        id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: m.body.querySelector('.cr-name').value.trim(),
        pattern,
        match: m.body.querySelector('.cr-match').value,
        type: m.body.querySelector('.cr-type').value,
        replacement: m.body.querySelector('.cr-rep').value,
        scope: m.body.querySelector('.cr-scope').value,
        bookId,
      };
      const rules = await mutateAllRules(draft => {
        if (ownerAlive()) draft.push(nextRule);
        return draft;
      });
      if (!ownerAlive()) { m.close(); return; }
      ctl._cleanRules = rulesForBook(rules, bookId);
      ctl._rulesVer = (ctl._rulesVer || 0) + 1;
      void redraw().catch(() => {});
      void scheduleReaderAction(() => showCurrent());
    });
    void redraw().catch(() => { if (ownerAlive()) toast('读取净化规则失败'); });
  });
  ctl.pageWidth = ctl.pageWidth ?? 0.7; // 纸张宽度；版心由 pageMargin 独立决定。
  ctl.pageMargin = normalizeReaderMargin(ctl.pageMargin);
  ctl.turnEffect = 'fade';
  root.querySelector('[data-a=font-plus]').addEventListener('click', () => {
    const locator = captureReaderReflowLocator();
    ctl.fontSize = Math.min(32, ctl.fontSize + 1);
    applyTextStyle();
    reflowReaderGeometry(locator);
    queueReaderAppearance();
  });
  // 阅读滚轮：默认向下翻/滚，Ctrl+滚轮字号缩放（漫画为图宽缩放）
  // 壳内 contentEl 与沙箱帧内各挂一份（iframe 事件不冒泡到壳——帧内滚动/翻页全靠这座桥）
  function onReaderWheel(e, inFrame = false) {
    if (!ctl.book || ctl.book.meta.format === 'pdf') return;
    const isImage = ctl.book.meta.format === 'cbz' || ctl.book.meta.format === 'manga-folder';
    // 帧内文本滚动模式：原生滚动放行（不 preventDefault，让帧自己滚）
    if (inFrame && !isImage && ctl.mode === 'scroll' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      if (isImage) {
        // 漫画：Ctrl+滚轮缩放图宽（60%–130%）
        ctl.mangaZoom = Math.min(130, Math.max(50, (ctl.mangaZoom || 100) + (e.deltaY < 0 ? 5 : -5)));
        reflowReaderGeometry();
        toast('图宽 ' + ctl.mangaZoom + '%');
        queueReaderAppearance();
      } else {
        const locator = captureReaderReflowLocator();
        ctl.fontSize = Math.min(32, Math.max(12, ctl.fontSize + (e.deltaY < 0 ? 1 : -1)));
        applyTextStyle();
        reflowReaderGeometry(locator);
        queueReaderAppearance();
      }
      return;
    }
    if (ctl.mode === 'scroll') {
      contentEl.scrollTop += e.deltaY; // 壳内滚动模式（漫画）自然滚
      return;
    }
    if (ctl._flowWrap && !isImage) {
      // 分栏横排：滚轮横翻（带阈值防抖）
      const now = Date.now();
      if (Math.abs(e.deltaY) >= 20 && now - (ctl._flowWheelT || 0) > 220) {
        ctl._flowWheelT = now;
        void scheduleReaderAction(() => nav(e.deltaY > 0 ? 1 : -1));
      }
      return;
    }
    if (Math.abs(e.deltaY) < 24) return;
    void scheduleReaderAction(() => nav(e.deltaY > 0 ? 1 : -1));
  }
  contentEl.addEventListener('wheel', (e) => onReaderWheel(e, false), { passive: false });
  // 进度栏：3 秒无操作收为同高紧凑态。不卸载栏本身，分页视口高度始终不变。
  const progBar = root.querySelector('.lib-progress');
  const progToggle = root.querySelector('[data-a=prog-fold]');
  let progTimer = null, progManualFold = false;
  function syncProgressChrome(collapsed) {
    progBar.classList.toggle('collapsed', collapsed);
    progToggle.setAttribute('aria-expanded', String(!collapsed));
    progToggle.setAttribute('aria-label', collapsed ? '展开阅读进度栏' : '收起阅读进度栏');
    progToggle.title = collapsed ? '展开阅读进度栏' : '收起阅读进度栏';
  }
  function progShow(sticky = false) {
    syncProgressChrome(false);
    clearTimeout(progTimer);
    if (!sticky) progTimer = setTimeout(progHide, 3000);
  }
  function progHide(manual = false) {
    if (!manual && progBar.matches(':focus-within')) { progShow(); return; }
    if (manual) progManualFold = true; // 手动收起=粘滞：别再用鼠标一晃就顶出来挡字
    clearTimeout(progTimer);
    syncProgressChrome(true);
  }
  progToggle.addEventListener('click', () => {
    if (progBar.classList.contains('collapsed')) {
      progManualFold = false;
      progShow();
    } else {
      progHide(true);
    }
  });
  const seekFromPointer = (event) => {
    const rect = progTrack.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    void scheduleReaderAction(() => seekProgress((event.clientX - rect.left) / rect.width));
  };
  progTrack.addEventListener('click', seekFromPointer);
  progTrack.addEventListener('keydown', (event) => {
    const current = Math.max(0, Math.min(100, Number(progTrack.getAttribute('aria-valuenow')) || 0));
    const step = event.shiftKey ? 10 : 5;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? 100
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step
      : null;
    if (next == null) return;
    event.preventDefault();
    void scheduleReaderAction(() => seekProgress(next / 100));
  });
  contentEl.addEventListener('pointermove', () => { if (!progManualFold) progShow(); });
  contentEl.addEventListener('wheel', () => { if (!progManualFold) progShow(); }, { passive: true });
  progBar.addEventListener('pointerenter', () => { if (!progManualFold) progShow(true); }); // 手动折叠态：鼠标压上来也不顶回（此前无条件 progShow 抵消手动折叠）
  progBar.addEventListener('pointerleave', () => { if (!progManualFold) progShow(); }); // 同上：离开也不许把刚折叠的进度栏拉回来
  progBar.addEventListener('focusin', () => {
    clearTimeout(progTimer);
    if (!progManualFold && !progBar.classList.contains('collapsed')) progShow(true);
  });
  progBar.addEventListener('focusout', () => { if (!progManualFold) progShow(); });
  progShow();

  // 阅读页右键：摘录/复制/字号/返回（壳页与沙箱帧内共用——帧内坐标系需换算到壳）
  const readSelection = () => (ctl._frame?.contentWindow?.getSelection?.()?.toString() || '').trim() || (window.getSelection()?.toString() || '').trim();
  root.querySelector('[data-a=evidence]').addEventListener('click', async () => {
    const book = ctl.book;
    if (!book?.meta?.path) { toast('请先打开一本书'); return; }
    const openGen = ctl._openGen;
    const lifecycleGen = ctl._lifecycleGen;
    const ownerAlive = () => !ctl._destroyed && ctl._lifecycleGen === lifecycleGen
      && ctl._openGen === openGen && ctl.book === book;
    try {
      let mediaType = '', logicalLocation = null, quote = readSelection();
      if (book.meta.format === 'epub') {
        const item = book.epub.spine[ctl.chapterIdx];
        if (!quote) { toast('请先选中一句文字；EPUB 证据会绑定逻辑章节与短句，不绑定字号后的屏位'); return; }
        mediaType = 'epub';
        logicalLocation = { kind: 'epub-quote', spineItemId: item.id, href: item.href, textQuote: quote.slice(0, 500) };
      } else if (book.meta.format === 'cbz' || book.meta.format === 'manga-folder') {
        if (book.meta.format === 'manga-folder') { toast('漫画文件夹尚不是单一可寻址资产；请导入 CBZ 后建立证据定位'); return; }
        mediaType = 'comic';
        logicalLocation = { kind: 'comic-panel', page: ctl.pageIdx + 1, panelId: `page-${ctl.pageIdx + 1}` };
        quote = '';
      } else if (book.meta.format === 'pdf') {
        const pageText = await ownedInputModal('PDF 页码', '1');
        if (pageText == null || !ownerAlive()) return;
        const page = Number(pageText);
        quote = await ownedInputModal('这一页的定位短句', quote || '');
        if (!ownerAlive()) return;
        if (!Number.isInteger(page) || page < 1 || !quote?.trim()) { toast('PDF 证据需要有效页码与定位短句'); return; }
        mediaType = 'pdf'; logicalLocation = { kind: 'pdf-quote', page, textQuote: quote.trim() };
      } else {
        toast('当前书籍格式尚未提供稳定证据定位'); return;
      }
      if (!ownerAlive()) return;
      const anchor = await window.mazz.invoke('evidence:createAnchorForPath', {
        path: book.meta.path, mediaType, logicalLocation, quote,
        context: { title: book.meta.title || '', createdBy: 'library-evidence-action' },
      });
      if (!ownerAlive()) return;
      await window.mazz.invoke('clipboard:write', { text: JSON.stringify(anchor, null, 2) });
      toast('证据定位已复制');
    } catch (error) { toast('复制证据定位失败：' + (error?.message || error)); }
  });
  async function onReaderContext(e, ox = 0, oy = 0) {
    e.preventDefault();
    const owner = ctl.book;
    const lifecycleGen = ctl._lifecycleGen;
    const ownerAlive = () => !ctl._destroyed && ctl._lifecycleGen === lifecycleGen && ctl.book === owner;
    const { showDomMenu } = await import('../../lib/dom-menu.js');
    if (!ownerAlive()) return;
    const sel = readSelection();
    ownDomMenu(showDomMenu([
      { label: '摘录到书摘笔记', fn: () => { if (!ownerAlive()) return; const t = readSelection() || ctl._lastSel || ''; if (t) { window.__libClipText = t; window.MazzCommands.execute('bridge.libToNote'); } }, disabled: !sel },
      { label: '复制选中', fn: () => { if (ownerAlive()) void navigator.clipboard?.writeText(sel); }, disabled: !sel },
      '-',
      { label: '字号 +', fn: () => { if (!ownerAlive()) return; const locator = captureReaderReflowLocator(); ctl.fontSize = Math.min(32, ctl.fontSize + 1); applyTextStyle(); reflowReaderGeometry(locator); queueReaderAppearance(); } },
      { label: '字号 −', fn: () => { if (!ownerAlive()) return; const locator = captureReaderReflowLocator(); ctl.fontSize = Math.max(12, ctl.fontSize - 1); applyTextStyle(); reflowReaderGeometry(locator); queueReaderAppearance(); } },
      { label: '添加书签', fn: () => { if (ownerAlive()) void addMark(); } },
      '-',
      { label: '返回书架', fn: () => { if (ownerAlive()) root.querySelector('[data-a=back]').click(); } },
    ], e.clientX + ox, e.clientY + oy));
  }
  pageEl.addEventListener('contextmenu', (e) => onReaderContext(e));

  // 「下载站」：投稿会话保留登录态。普通站点下载仍由 Electron
  // 正常处理；只有未来资源面预登记的 Rights-authorized intent 才进入
  // W93 acquisition staging/Inbox，点击下载本身绝不等于版权结论。
  root.querySelector('[data-a=dl-site]')?.addEventListener('click', async () => {
    if (ctl._destroyed) return;
    const lifecycleGen = ctl._lifecycleGen;
    const alive = () => !ctl._destroyed && ctl._lifecycleGen === lifecycleGen;
    // 这些是人工浏览入口，不是机器可判权的 Source Adapter。
    const { showDomMenu } = await import('../../lib/dom-menu.js');
    if (!alive()) return;
    const SITES = [
      ['书格（古籍公版高清）', 'https://shuge.org'],
      ['好读（台湾公版精校）', 'https://haodoo.net'],
      ['Project Gutenberg（公版英文）', 'https://www.gutenberg.org'],
      ['标准网（epub 精校）', 'https://standardebooks.org'],
      ['— 自定义站点…', ''],
    ];
    const rect = root.querySelector('[data-a=dl-site]').getBoundingClientRect();
    ownDomMenu(showDomMenu(SITES.map(([label, url]) => ({
      label,
      fn: async () => {
        if (!alive()) return;
        let target = url;
        if (!target) {
          target = (await ownedInputModal('打开电子书站（登录一次后长期有效）', 'https://'))?.trim();
          if (!target) return;
        }
        if (!alive()) return;
        window.MazzShell.openTab('browser', { title: '电子书下载站', content: '' });
        setTimeout(() => { if (alive()) window.__activeBrowserCtl?.openTabRaw(target, { partition: 'persist:mazz-author' }); }, 800);
        toast('站点下载仍按普通下载处理；需要入库时请使用“导入书籍”');
      },
    })), rect.left, rect.bottom + 4));
  });

  ctl.importBook = importBook;
  ctl.importPath = importPath;
  ctl.importMangaFolderPath = importMangaFolderPath;
  ctl.renderShelf = renderShelf;
  ctl.openBook = openBook;
  ctl.exportBookMarkdown = exportBookMarkdown;
  ctl.captureProgress = progressRecord;
  ctl.applyProgress = async (rec) => {
    if (ctl._destroyed || ctl._destroying || ctl._workspaceRebinding || !ctl.book || !rec) return;
    ctl._pendingRatio = ctl.mode === 'scroll' && typeof rec.ratio === 'number' ? rec.ratio : null;
    ctl._pendingAnchor = rec.anchor || null;
    if (ctl.book.meta.format === 'epub') ctl.chapterIdx = Math.max(0, Math.min(Number(rec.chapter) || 0, totalPages() - 1));
    else ctl.pageIdx = Math.max(0, Math.min(Number(rec.page) || 0, totalPages() - 1));
    if (rec.zh != null) ctl.zhMode = rec.zh || '';
    await showCurrent();
  };
  ctl.setHandoffProvisional = (enabled) => {
    ctl._handoffProvisional = !!enabled;
    if (enabled) {
      ctl._handoffDiscardable = true;
      abortAcquisitionBinding(repositoryBinding, 'handoff-provisional');
      acquireLifecycleInert('handoff-provisional');
    } else {
      releaseLifecycleInert('handoff-provisional');
    }
    return true;
  };
  ctl.finalizeHandoff = () => {
    ctl._handoffDiscardable = false;
    void resumePendingAcquisition(repositoryBinding);
    void resourceSurface.resume();
    return true;
  };
  ctl.discardHandoff = () => {
    if (!ctl._handoffDiscardable) return Promise.resolve(false);
    if (ctl._handoffDiscardPromise) return ctl._handoffDiscardPromise;
    ctl._destroying = true;
    abortAcquisitionBinding(repositoryBinding, 'handoff-discard');
    acquireLifecycleInert('handoff-discard');
    readerInput.cancelFocusRequest();
    closeOwnedOverlays();
    ctl._openGen++;
    ctl._searchGen++;
    ctl._exportGen++;
    ctl._renderGen = (ctl._renderGen || 0) + 1;
    const task = (async () => {
      await Promise.all([
        Promise.resolve(ctl._readerActionTail).catch(() => null),
        Promise.resolve(ctl._openCommitTail).catch(() => null),
      ]);
      const retiring = ctl.book;
      // A provisional target never acquired write authority.  Teardown is
      // therefore deliberately resource-only: no locator/prefs/repository
      // flush and no normal durable destroy path.
      ctl._destroyed = true;
      ctl.detachWorkspaceRebind?.();
      try { ctl._acquisitionInboxOff?.(); } catch {}
      ctl._acquisitionInboxOff = null;
      try { ctl._resourceChangedOff?.(); } catch {}
      ctl._resourceChangedOff = null;
      resourceSurface.destroy();
      ctl._lifecycleGen++;
      clearTimeout(progTimer);
      clearTimeout(ctl.shelf.queryTimer);
      closeOwnedOverlays();
      retireFlowOwner();
      disposeBookHandle(retiring);
      readerInput.dispose();
      shelfRenderer.destroy();
      for (const proxy of root._libSelectProxies?.values?.() || []) {
        try { proxy?.destroy?.(); } catch {}
      }
      root._libSelectProxies?.clear?.();
      retireReaderFrame();
      document.removeEventListener('selectionchange', onDocumentSelectionChange);
      root.remove();
      instances.delete(container);
      if (current === ctl) current = null;
      if (window.__activeLibraryCtl === ctl) window.__activeLibraryCtl = null;
      ctl._destroying = false;
      return true;
    })();
    ctl._handoffDiscardPromise = task;
    return task;
  };
  ctl.abortDestroy = (receipt = ctl._destroyReceipt) => {
    if (ctl._destroyed) return false;
    if (ctl._destroyReceipt && receipt && receipt !== ctl._destroyReceipt) return false;
    ctl._destroying = false;
    ctl._destroyPromise = null;
    ctl._destroyReceipt = null;
    releaseLifecycleInert('destroy');
    ctl._resolveDestroyOutcome?.('aborted');
    ctl._resolveDestroyOutcome = null;
    ctl._destroyOutcomePromise = null;
    void resumePendingAcquisition(repositoryBinding);
    void resourceSurface.resume();
    return true;
  };

  ctl.prepareDestroy = () => {
    if (ctl._destroyed) return Promise.resolve({ alreadyDestroyed: true });
    if (ctl._destroyReceipt) return Promise.resolve(ctl._destroyReceipt);
    if (ctl._destroyPromise) return ctl._destroyPromise;
    ctl._destroying = true;
    abortAcquisitionBinding(repositoryBinding, 'destroy-preflight');
    acquireLifecycleInert('destroy');
    readerInput.cancelFocusRequest();
    ctl._destroyOutcomePromise = new Promise(resolve => { ctl._resolveDestroyOutcome = resolve; });
    // Invalidate parse/search/render producers before the first durability
    // await.  An already-started reader command is allowed to settle below,
    // then its final locator is captured exactly once.
    ctl._openGen++;
    ctl._searchGen++;
    ctl._exportGen++;
    ctl._renderGen = (ctl._renderGen || 0) + 1;
    // Durability is a preflight, not a post-mortem receipt. DOM, active owner,
    // overlays and native resources stay installed until commitDestroy().
    const task = (async () => {
      // A candidate owner commit may already have installed B but still be
      // rendering it. Invalidating the generations above makes that commit
      // take its rollback branch; wait for the gate before choosing the owner
      // whose locator is durable. Otherwise a failed close could restore a
      // half-rendered B after the commit released healthy A.
      const openCommit = ctl._openCommitTail;
      await Promise.all([
        Promise.resolve(ctl._readerActionTail).catch(() => null),
        Promise.resolve(openCommit).catch(() => null),
      ]);
      const retiring = ctl.book;
      const retiringId = retiring?.meta?.id;
      const retiringBinding = retiring?._repositoryBinding || repositoryBinding;
      const retiringProgress = retiring ? progressRecord() : null;
      const positionWrite = retiring && retiringProgress && retiringId
        ? trackBindingOperation(retiringBinding, retiringBinding.locatorStore.put({
          bookId: retiringId,
          path: retiring.meta.path,
          record: retiringProgress,
        }))
        : Promise.resolve({ ok: true, skipped: true });
      const appearanceWrite = retiring ? flushReaderAppearance(retiring) : Promise.resolve([]);
      await Promise.all([
        positionWrite.then(() => retiringId ? retiringBinding.locatorStore.flush(retiringId) : []),
        appearanceWrite,
      ]);
      // Operations which entered the immutable repository owner immediately
      // before `_destroying` was raised must also reach their CAS/Store commit
      // before the tab can disappear. Drain to a fixed point because a task's
      // completion handler may enqueue its final projection in the same turn.
      while (retiringBinding.pending.size) {
        await Promise.all([...retiringBinding.pending]);
      }
      await retiringBinding.locatorStore.flushAll();
      const receipt = Object.freeze({
        owner: ctl,
        retiring,
        binding: retiringBinding,
        lifecycleGeneration: ctl._lifecycleGen,
      });
      ctl._destroyReceipt = receipt;
      ctl._destroyPromise = null;
      return receipt;
    })().catch(error => {
      ctl.abortDestroy();
      throw error;
    });
    ctl._destroyPromise = task;
    return task;
  };

  ctl.commitDestroy = (receipt = ctl._destroyReceipt) => {
    if (ctl._destroyed) return true;
    if (!receipt || receipt !== ctl._destroyReceipt || receipt.owner !== ctl) return false;
    ctl._destroyed = true;
    ctl.detachWorkspaceRebind?.();
    try { ctl._acquisitionInboxOff?.(); } catch {}
    ctl._acquisitionInboxOff = null;
    try { ctl._resourceChangedOff?.(); } catch {}
    ctl._resourceChangedOff = null;
    resourceSurface.destroy();
    ctl._lifecycleGen++;
    clearTimeout(progTimer);
    clearTimeout(ctl.shelf.queryTimer);
    closeOwnedOverlays();
    retireFlowOwner();
    disposeBookHandle(receipt.retiring);
    readerInput.dispose();
    shelfRenderer.destroy();
    for (const proxy of root._libSelectProxies?.values?.() || []) {
      try { proxy?.destroy?.(); } catch {}
    }
    root._libSelectProxies?.clear?.();
    retireReaderFrame();
    document.removeEventListener('selectionchange', onDocumentSelectionChange);
    root.remove();
    instances.delete(container);
    if (current === ctl) current = null;
    if (window.__activeLibraryCtl === ctl) window.__activeLibraryCtl = null;
    ctl._destroying = false;
    releaseLifecycleInert('destroy');
    ctl._destroyReceipt = null;
    ctl._destroyPromise = null;
    ctl._resolveDestroyOutcome?.('committed');
    ctl._resolveDestroyOutcome = null;
    ctl._destroyOutcomePromise = null;
    return true;
  };

  ctl.destroy = async () => {
    if (ctl._destroyed) return true;
    const receipt = await ctl.prepareDestroy();
    return ctl.commitDestroy(receipt);
  };

  renderShelf();
  void repositoryReady.then(() => drainPendingAcquisition(repositoryBinding)).catch(error => {
    if (!ctl._destroyed) console.warn('[library-acquisition] initial Inbox replay:', error?.code || 'LIBRARY_INBOX_REPLAY_FAILED');
  });
  return ctl;
}

export default {
  displayName: '书库',
  icon: '📚',
  progressKind: 'library',
  // LocatorStore + LibraryRepository own version arbitration and durability.
  // Shell's generic ProgressRelay must not become a second competing writer.
  ownsProgressPersistence: true,
  progressPath(state) { return instances.get(state.container)?.book?.meta?.path || ''; },
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
    void ctl.resumePendingAcquisition?.();
    void ctl.resourceSurface?.resume?.();
  },
  deactivate(container) {
    const ctl = instances.get(container);
    if (current === ctl) current = null;
    if (window.__activeLibraryCtl === ctl) window.__activeLibraryCtl = null;
  },
  setHandoffProvisional(enabled, state) {
    return instances.get(state?.container)?.setHandoffProvisional?.(enabled);
  },
  finalizeHandoff(state) {
    return instances.get(state?.container)?.finalizeHandoff?.();
  },
  discard(state) {
    const ctl = instances.get(state?.container) || state;
    return ctl?.discardHandoff?.();
  },
  prepareDispose(_context, state) {
    const ctl = instances.get(state?.container) || state;
    return ctl?.prepareDestroy?.();
  },
  commitDispose(receipt, state) {
    const ctl = instances.get(state?.container) || state;
    return ctl?.commitDestroy?.(receipt);
  },
  abortDispose(receipt, state) {
    const ctl = instances.get(state?.container) || state;
    return ctl?.abortDestroy?.(receipt);
  },
  dispose(state) {
    const ctl = instances.get(state?.container) || state;
    return ctl?.destroy?.();
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return JSON.stringify({ mark: 'mazz-library-v2', bookId: ctl?.book?.meta?.id || null });
  },
  async setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj?.bookId) return await ctl.openBook?.(obj.bookId);
    } catch {}
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.renderShelf();
  },
  getCharCount() { return 0; },
  getCursorPos() { return '书库'; },
  captureProgress(state) { return instances.get(state.container)?.captureProgress?.() || null; },
  applyProgress(value, state) { return instances.get(state.container)?.applyProgress?.(value); },
  async captureHandoffOwner(state) {
    const ctl = instances.get(state?.container);
    if (!ctl?.repository) return null;
    await ctl.repository.init();
    return ctl.repository.identity?.canonical || null;
  },
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
      <button class="rb-btn" data-command="library.import"><i class="ico">${iconHtml('＋')}</i><span>导入书籍</span></button>
      <button class="rb-btn" data-command="library.exportMd"><i class="ico">${iconHtml('⇪')}</i><span>导出MD</span></button>
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
