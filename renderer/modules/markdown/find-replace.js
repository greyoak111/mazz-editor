// renderer/modules/markdown/find-replace.js —— 查找替换面板（含正则）
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const findKey = new PluginKey('mazz-find');

function buildDeco(doc, matches, index) {
  if (!matches?.length) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: 'find-hit' + (i === index ? ' cur' : '') }));
  return DecorationSet.create(doc, decos);
}

export function findPlugin() {
  return new Plugin({
    key: findKey,
    state: {
      init: () => ({ matches: [], index: -1, deco: DecorationSet.empty }),
      apply(tr, old) {
        const meta = tr.getMeta(findKey);
        if (meta) return { ...meta, deco: buildDeco(tr.doc, meta.matches, meta.index) };
        if (tr.docChanged && old.matches.length) {
          const matches = old.matches
            .map(m => ({ from: tr.mapping.map(m.from, 1), to: tr.mapping.map(m.to, -1) }))
            .filter(m => m.from < m.to);
          const index = Math.min(old.index, matches.length - 1);
          return { matches, index, deco: buildDeco(tr.doc, matches, index) };
        }
        return old;
      },
    },
    props: {
      decorations(state) { return findKey.getState(state).deco; },
    },
  });
}

function computeMatches(doc, query, { regex, caseSensitive }) {
  const matches = [];
  if (!query) return matches;
  let re = null;
  if (regex) {
    try { re = new RegExp(query, caseSensitive ? 'g' : 'gi'); }
    catch { return null; } // 非法正则
  }
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text;
    if (re) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      }
    } else {
      const hay = caseSensitive ? text : text.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      let i = 0;
      while (needle && (i = hay.indexOf(needle, i)) !== -1) {
        matches.push({ from: pos + i, to: pos + i + needle.length });
        i += needle.length;
      }
    }
    return true;
  });
  return matches;
}

export class FindReplaceBar {
  constructor(view, hostEl) {
    this.view = view;
    this.hostEl = hostEl;
    this.el = null;
    this.opts = { regex: false, caseSensitive: false };
  }

  get state() { return findKey.getState(this.view.state); }

  open(withReplace = false) {
    if (!this.el) this.build();
    this.el.style.display = 'flex';
    this.el.querySelector('.f-replace-row').style.display = withReplace ? 'flex' : 'none';
    const input = this.el.querySelector('.f-find-input');
    // 带入当前选中文本
    const { from, to, empty } = this.view.state.selection;
    if (!empty && to - from < 100) input.value = this.view.state.doc.textBetween(from, to);
    input.focus(); input.select();
    this.search();
  }

  close() {
    if (this.el) this.el.style.display = 'none';
    this.setMatches([], -1);
    this.view.focus();
  }

  build() {
    const el = document.createElement('div');
    el.className = 'findbar';
    el.style.display = 'none';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:5px">
        <div style="display:flex;gap:5px;align-items:center">
          <input class="f-find-input" placeholder="查找…" spellcheck="false" />
          <span class="f-count"></span>
          <button data-a="prev" title="上一个（Shift+F3）">↑</button>
          <button data-a="next" title="下一个（F3）">↓</button>
          <button data-a="case" title="区分大小写">Aa</button>
          <button data-a="regex" title="正则表达式">.*</button>
          <button data-a="close" title="关闭（Esc）">✕</button>
        </div>
        <div class="f-replace-row" style="display:none;gap:5px;align-items:center">
          <input class="f-replace-input" placeholder="替换为…" spellcheck="false" />
          <button data-a="replace" title="替换当前">替换</button>
          <button data-a="replaceAll" title="全部替换">全部</button>
        </div>
      </div>`;
    this.hostEl.appendChild(el);
    this.el = el;
    const findInput = el.querySelector('.f-find-input');
    const replaceInput = el.querySelector('.f-replace-input');
    findInput.addEventListener('input', () => this.search());
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.prev() : this.next(); }
      if (e.key === 'Escape') this.close();
    });
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.replaceCurrent(); }
      if (e.key === 'Escape') this.close();
    });
    el.querySelector('[data-a=next]').addEventListener('click', () => this.next());
    el.querySelector('[data-a=prev]').addEventListener('click', () => this.prev());
    el.querySelector('[data-a=close]').addEventListener('click', () => this.close());
    el.querySelector('[data-a=replace]').addEventListener('click', () => this.replaceCurrent());
    el.querySelector('[data-a=replaceAll]').addEventListener('click', () => this.replaceAll());
    const caseBtn = el.querySelector('[data-a=case]');
    const regexBtn = el.querySelector('[data-a=regex]');
    caseBtn.addEventListener('click', () => {
      this.opts.caseSensitive = !this.opts.caseSensitive;
      caseBtn.classList.toggle('on', this.opts.caseSensitive);
      this.search();
    });
    regexBtn.addEventListener('click', () => {
      this.opts.regex = !this.opts.regex;
      regexBtn.classList.toggle('on', this.opts.regex);
      this.search();
    });
  }

  setMatches(matches, index) {
    this.view.dispatch(this.view.state.tr.setMeta(findKey, { matches, index }));
    const count = this.el?.querySelector('.f-count');
    if (count) {
      count.textContent = matches == null ? '正则错误'
        : matches.length ? `${index + 1}/${matches.length}` : '无结果';
    }
  }

  search() {
    const q = this.el.querySelector('.f-find-input').value;
    const matches = computeMatches(this.view.state.doc, q, this.opts);
    if (matches === null) { this.setMatches(null, -1); return; }
    // 从光标位置起找最近命中
    const pos = this.view.state.selection.from;
    let index = matches.findIndex(m => m.from >= pos);
    if (index < 0) index = matches.length ? 0 : -1;
    this.setMatches(matches, index);
    if (index >= 0) this.scrollToMatch(index);
  }

  jump(delta) {
    const { matches, index } = this.state;
    if (!matches.length) return;
    const next = (index + delta + matches.length) % matches.length;
    this.setMatches(matches, next);
    this.scrollToMatch(next);
  }
  next() { this.jump(1); }
  prev() { this.jump(-1); }

  scrollToMatch(index) {
    const m = this.state.matches[index];
    if (!m) return;
    const sel = TextSelection.create(this.view.state.doc, m.from, m.to);
    this.view.dispatch(this.view.state.tr.setSelection(sel).scrollIntoView());
  }

  replaceCurrent() {
    const { matches, index } = this.state;
    const m = matches[index];
    if (!m) return;
    const replacement = this.el.querySelector('.f-replace-input').value;
    const text = this.view.state.doc.textBetween(m.from, m.to);
    let out = replacement;
    if (this.opts.regex) {
      try { out = text.replace(new RegExp(this.el.querySelector('.f-find-input').value, this.opts.caseSensitive ? '' : 'i'), replacement); }
      catch { return; }
    }
    this.view.dispatch(this.view.state.tr.insertText(out, m.from, m.to));
    this.search();
  }

  replaceAll() {
    const { matches } = this.state;
    if (!matches.length) return;
    const replacement = this.el.querySelector('.f-replace-input').value;
    const query = this.el.querySelector('.f-find-input').value;
    const tr = this.view.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const text = this.view.state.doc.textBetween(m.from, m.to);
      let out = replacement;
      if (this.opts.regex) {
        try { out = text.replace(new RegExp(query, this.opts.caseSensitive ? '' : 'i'), replacement); }
        catch { return; }
      }
      tr.insertText(out, m.from, m.to);
    }
    this.view.dispatch(tr);
    this.search();
  }
}
