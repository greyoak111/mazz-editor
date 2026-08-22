// W88 Library shelf DOM renderer.
//
// The shelf projection belongs to shelf-model.js. This file only owns the
// stable DOM/event/viewport layer: one delegated listener set, bounded card
// nodes, metadata through textContent, and deterministic focus restoration.

import { iconHtml } from '../../lib/svg-icons.js';
import { computeVirtualWindow } from './shelf-model.js';

const DEFAULTS = Object.freeze({
  cardWidth: 128,
  cardHeight: 226,
  columnGap: 16,
  rowGap: 16,
  paddingX: 20,
  paddingY: 18,
  overscanRows: 2,
  virtualThreshold: 160,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeCover(value) {
  const url = String(value || '');
  return /^(?:data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,|blob:|mazz-res:\/\/media\/)/i.test(url)
    ? url
    : '';
}

function setText(node, value) {
  node.textContent = String(value ?? '');
  return node;
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatIcon(format) {
  if (format === 'cbz' || format === 'manga-folder') return '🖼';
  if (format === 'pdf') return '📕';
  return '📖';
}

function createCard(item, { batchMode, selected }) {
  const { book, progress } = item;
  const card = element('div', 'lib-card');
  card.dataset.id = String(book.id || '');
  // Persisted book id, rather than path/content identity, is the DOM key. A
  // successful relink may change the source fingerprint but must not throw
  // away focus, selection or the visible card node.
  card.dataset.key = String(book.id || item.key || '');
  card.classList.toggle('batching', !!batchMode);
  card.classList.toggle('selected', !!selected);
  card.classList.toggle('is-missing', !!book.missing);

  if (batchMode) {
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', selected ? 'true' : 'false');
    card.tabIndex = -1;
    const checkbox = element('input', 'lib-card-cb');
    checkbox.type = 'checkbox';
    checkbox.checked = !!selected;
    checkbox.dataset.role = 'select';
    checkbox.setAttribute('aria-label', `选择《${book.title || '未命名书籍'}》`);
    card.appendChild(checkbox);
  } else {
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `打开《${book.title || '未命名书籍'}》`);
  }

  const cover = element('div', 'lib-cover');
  const coverUrl = safeCover(book.cover);
  if (coverUrl) {
    const image = document.createElement('img');
    image.src = coverUrl;
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'lazy';
    cover.appendChild(image);
  } else {
    const fallback = element('span', 'lib-cover-fallback');
    fallback.innerHTML = iconHtml(formatIcon(book.format));
    fallback.setAttribute('aria-hidden', 'true');
    cover.appendChild(fallback);
  }
  card.appendChild(cover);

  const title = setText(element('div', 'lib-card-title'), book.title || '未命名书籍');
  title.title = String(book.title || '未命名书籍');
  card.appendChild(title);
  const author = setText(element('div', 'lib-card-author'), book.author || String(book.format || '').toUpperCase());
  author.title = author.textContent;
  card.appendChild(author);

  const meta = element('div', 'lib-card-meta');
  meta.appendChild(setText(element('span', 'lib-card-cat'), book.category || '未分类'));
  if (book.favorite) {
    const favorite = element('span', 'lib-card-favorite');
    favorite.innerHTML = iconHtml('★');
    favorite.title = '已收藏';
    favorite.setAttribute('aria-label', '已收藏');
    meta.appendChild(favorite);
  }
  if (book.missing) {
    const missing = setText(element('span', 'lib-card-missing'), '源文件缺失');
    missing.title = '源文件缺失，需要重新定位';
    meta.appendChild(missing);
  }
  card.appendChild(meta);

  if (progress?.status !== 'unread') {
    const progressNode = element('div', 'lib-card-progress');
    const ratio = Math.max(0, Math.min(1, finite(progress.ratio, 0)));
    progressNode.setAttribute('role', 'progressbar');
    progressNode.setAttribute('aria-label', '阅读进度');
    progressNode.setAttribute('aria-valuemin', '0');
    progressNode.setAttribute('aria-valuemax', '100');
    progressNode.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    const fill = element('span', 'lib-card-progress-fill');
    fill.style.setProperty('--lib-progress', `${ratio * 100}%`);
    progressNode.appendChild(fill);
    card.appendChild(progressNode);
  }
  return card;
}

function cardSignature(item, batchMode, selected) {
  const { book = {}, progress = {} } = item || {};
  return JSON.stringify([
    book.id, book.title, book.author, book.category, book.format, book.cover,
    !!book.favorite, !!book.missing, !!batchMode, !!selected,
    progress.status, finite(progress.ratio, 0),
  ]);
}

export class LibraryShelfView {
  constructor({
    host,
    onOpen = () => {},
    onToggleBatch = () => {},
    onContext = () => {},
    ...layout
  } = {}) {
    if (!host?.addEventListener) throw new TypeError('LibraryShelfView requires a host element');
    this.host = host;
    this.options = { ...DEFAULTS, ...layout };
    this.onOpen = onOpen;
    this.onToggleBatch = onToggleBatch;
    this.onContext = onContext;
    this.items = [];
    this.itemByKey = new Map();
    this.mounted = new Map();
    this.batchMode = false;
    this.selected = new Set();
    this.emptyText = '书库空空如也——「导入书籍」放入第一本';
    this.destroyed = false;
    this._raf = 0;
    this._generation = 0;
    this._lastWindow = null;
    this._lastColumns = 1;
    this._resizeAnchor = null;

    this.rail = element('div', 'lib-shelf-rail');
    this.grid = element('div', 'lib-shelf-grid');
    this.rail.appendChild(this.grid);
    this.host.replaceChildren(this.rail);

    this._onScroll = () => this.schedulePaint();
    this._onClick = event => this.handleClick(event);
    this._onKeydown = event => this.handleKeydown(event);
    this._onContext = event => this.handleContext(event);
    this.host.addEventListener('scroll', this._onScroll, { passive: true });
    this.host.addEventListener('click', this._onClick);
    this.host.addEventListener('keydown', this._onKeydown);
    this.host.addEventListener('contextmenu', this._onContext);
    this._resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          // ResizeObserver runs after the host width changed, while the last
          // painted column count still describes what the user was looking at.
          // Capture that semantic viewport once; repeated observer deliveries
          // before the next paint must not replace it with new-width math.
          this._resizeAnchor ||= this.captureViewportAnchor();
          this.schedulePaint();
        })
      : null;
    this._resizeObserver?.observe(this.host);
  }

  update({ items = [], batchMode = false, selected = new Set(), emptyText } = {}) {
    if (this.destroyed) return;
    const focusedKey = this.host.querySelector('.lib-card:focus')?.dataset.key || null;
    this.items = Array.isArray(items) ? items : [];
    this.itemByKey = new Map(this.items.map(item => [String(item.book?.id || item.key || ''), item]));
    this.batchMode = !!batchMode;
    this.selected = selected instanceof Set ? new Set(selected) : new Set(Array.isArray(selected) ? selected : []);
    if (emptyText != null) this.emptyText = String(emptyText);
    this._generation += 1;
    this._focusKey = focusedKey;
    this.paint(true);
  }

  schedulePaint() {
    if (this.destroyed || this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.paint(false);
    });
  }

  captureViewportAnchor() {
    if (!this.items.length) return null;
    const columns = Math.max(1, this._lastColumns || 1);
    const stride = this.options.cardHeight + this.options.rowGap;
    const contentTop = Math.max(0, this.host.scrollTop - this.options.paddingY);
    const row = Math.max(0, Math.floor(contentTop / stride));
    const index = Math.min(this.items.length - 1, row * columns);
    const item = this.items[index];
    const key = String(item?.book?.id || item?.key || '');
    if (!key) return null;
    const cardTop = this.options.paddingY + (row * stride);
    return {
      key,
      columns,
      viewportOffset: cardTop - this.host.scrollTop,
    };
  }

  restoreViewportAnchor(anchor, columns, totalHeight) {
    if (!anchor?.key || anchor.columns === columns || !this.items.length) return false;
    const index = this.items.findIndex(item => String(item?.book?.id || item?.key || '') === anchor.key);
    if (index < 0) return false;
    const stride = this.options.cardHeight + this.options.rowGap;
    const row = Math.floor(index / Math.max(1, columns));
    const cardTop = this.options.paddingY + (row * stride);
    const maxScroll = Math.max(0, totalHeight + (this.options.paddingY * 2) - this.host.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(cardTop - finite(anchor.viewportOffset, 0), maxScroll));
    if (Math.abs(this.host.scrollTop - nextScrollTop) < 0.5) return false;
    this.host.scrollTop = nextScrollTop;
    return true;
  }

  layout() {
    const width = Math.max(1, this.host.clientWidth - (this.options.paddingX * 2));
    const columns = Math.max(1, Math.floor((width + this.options.columnGap) / (this.options.cardWidth + this.options.columnGap)));
    this._lastColumns = columns;
    const count = this.items.length;
    if (count < this.options.virtualThreshold) {
      const rows = Math.ceil(count / columns);
      const totalHeight = rows
        ? (rows * this.options.cardHeight) + ((rows - 1) * this.options.rowGap)
        : 0;
      return { startIndex: 0, endIndex: count, startRow: 0, endRow: rows, rows, columns, paddingTop: 0, totalHeight };
    }
    return computeVirtualWindow({
      count,
      scrollTop: Math.max(0, this.host.scrollTop - this.options.paddingY),
      viewportHeight: this.host.clientHeight,
      itemHeight: this.options.cardHeight,
      rowGap: this.options.rowGap,
      columns,
      overscanRows: this.options.overscanRows,
    });
  }

  paint(force) {
    if (this.destroyed) return;
    const focusedCard = this.host.querySelector('.lib-card:focus');
    if (focusedCard?.dataset.key) this._focusKey = focusedCard.dataset.key;
    if (!this.items.length) {
      this.rail.style.height = '100%';
      this.grid.style.transform = '';
      const empty = setText(element('div', 'lib-empty'), this.emptyText);
      this.grid.replaceChildren(empty);
      this._lastWindow = { startIndex: 0, endIndex: 0, columns: 1, totalHeight: 0 };
      return;
    }

    let window = this.layout();
    const resizeAnchor = this._resizeAnchor;
    this._resizeAnchor = null;
    if (this.restoreViewportAnchor(resizeAnchor, window.columns, window.totalHeight)) {
      window = this.layout();
    }
    const signature = [window.startIndex, window.endIndex, window.columns, this._generation].join(':');
    if (!force && this._signature === signature) return;
    this._signature = signature;
    this._lastWindow = window;
    this.rail.style.height = `${Math.max(1, window.totalHeight + (this.options.paddingY * 2))}px`;
    this.grid.style.setProperty('--lib-shelf-columns', String(window.columns));
    this.grid.style.transform = `translateY(${this.options.paddingY + window.paddingTop}px)`;

    const fragment = document.createDocumentFragment();
    const nextMounted = new Map();
    for (const item of this.items.slice(window.startIndex, window.endIndex)) {
      const key = String(item.book?.id || item.key || '');
      const selected = this.selected.has(item.book?.id);
      const signature = cardSignature(item, this.batchMode, selected);
      let card = this.mounted.get(key);
      if (!card || card._shelfSignature !== signature) {
        card = createCard(item, { batchMode: this.batchMode, selected });
        // A cover may be a legacy data URL. Keeping the reconciliation
        // signature in a data-* attribute duplicates that multi-megabyte URL
        // into DOM serialization on every paint.
        card._shelfSignature = signature;
      }
      nextMounted.set(key, card);
      fragment.appendChild(card);
    }
    this.grid.replaceChildren(fragment);
    this.mounted = nextMounted;
    if (this._focusKey) {
      const node = [...this.grid.querySelectorAll('.lib-card')].find(card => card.dataset.key === this._focusKey);
      if (node && !this.batchMode) queueMicrotask(() => node.isConnected && node.focus({ preventScroll: true }));
      this._focusKey = null;
    }
  }

  itemForCard(card) {
    return card ? this.itemByKey.get(String(card.dataset.key || '')) || null : null;
  }

  /**
   * Focus a stable shelf item even when virtualization does not currently
   * materialize it. This is the return path from the reader: a recent-sort
   * update may move the just-opened book to another row while the old scroll
   * position remains deep in the shelf.
   */
  async focusKey(value, { preventScroll = true } = {}) {
    if (this.destroyed || !this.items.length) return false;
    const key = String(value || '');
    const index = this.items.findIndex(item => String(item?.book?.id || item?.key || '') === key);
    if (index < 0) return false;

    const layout = this.layout();
    const stride = this.options.cardHeight + this.options.rowGap;
    const row = Math.floor(index / Math.max(1, layout.columns));
    const cardTop = this.options.paddingY + (row * stride);
    const cardBottom = cardTop + this.options.cardHeight;
    const viewportTop = this.host.scrollTop;
    const viewportBottom = viewportTop + this.host.clientHeight;
    let nextScrollTop = viewportTop;
    if (cardTop < viewportTop) nextScrollTop = cardTop;
    else if (cardBottom > viewportBottom) nextScrollTop = cardBottom - this.host.clientHeight;
    const maxScroll = Math.max(0, layout.totalHeight + (this.options.paddingY * 2) - this.host.clientHeight);
    this.host.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScroll));

    // A pending generic focus restoration must not race this explicit owner.
    this._focusKey = null;
    this.paint(true);
    const node = this.mounted.get(key) || [...this.grid.querySelectorAll('.lib-card')]
      .find(card => card.dataset.key === key);
    if (!node?.isConnected) return false;
    node.focus({ preventScroll: !!preventScroll });
    return node.ownerDocument?.activeElement === node;
  }

  handleClick(event) {
    const card = event.target?.closest?.('.lib-card');
    const item = this.itemForCard(card);
    if (!item) return;
    if (this.batchMode) {
      this.onToggleBatch(item.book, { checked: event.target?.checked, event });
      return;
    }
    this.onOpen(item.book, event);
  }

  handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target?.closest?.('.lib-card');
    const item = this.itemForCard(card);
    if (!item || this.batchMode) return;
    event.preventDefault();
    this.onOpen(item.book, event);
  }

  handleContext(event) {
    const card = event.target?.closest?.('.lib-card');
    const item = this.itemForCard(card);
    if (!item) return;
    event.preventDefault();
    this.onContext(item.book, event);
  }

  get metrics() {
    return {
      total: this.items.length,
      rendered: this.grid.querySelectorAll('.lib-card').length,
      columns: this._lastColumns,
      startIndex: this._lastWindow?.startIndex ?? 0,
      endIndex: this._lastWindow?.endIndex ?? 0,
      totalHeight: this._lastWindow?.totalHeight ?? 0,
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._resizeAnchor = null;
    this._resizeObserver?.disconnect();
    this.host.removeEventListener('scroll', this._onScroll);
    this.host.removeEventListener('click', this._onClick);
    this.host.removeEventListener('keydown', this._onKeydown);
    this.host.removeEventListener('contextmenu', this._onContext);
    this.grid.replaceChildren();
    this.itemByKey.clear();
    this.mounted.clear();
  }
}

export function createLibraryShelfView(options) {
  return new LibraryShelfView(options);
}

export const _forTests = Object.freeze({ safeCover, formatIcon, createCard, cardSignature, DEFAULTS });
