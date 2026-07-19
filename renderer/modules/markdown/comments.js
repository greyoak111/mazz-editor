// renderer/modules/markdown/comments.js —— 批注：扫描 / 面板 / 增删操作
import { TextSelection } from 'prosemirror-state';

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** 扫描文档中的批注（相邻同文本批注合并） */
export function scanComments(doc) {
  const raw = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const m = node.marks.find(x => x.type.name === 'comment');
    if (m) raw.push({ pos, end: pos + node.nodeSize, text: m.attrs.text, quote: node.text });
  });
  const merged = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && last.text === c.text && last.end === c.pos) { last.end = c.end; last.quote += c.quote; }
    else merged.push({ ...c });
  }
  return merged;
}

export class CommentsPanel {
  constructor(view, host, { onChange } = {}) {
    this.view = view;
    this.onChange = onChange;
    this.el = document.createElement('div');
    this.el.className = 'cm-panel';
    host.appendChild(this.el);
    this.render();
  }

  render() {
    this.list = scanComments(this.view.state.doc);
    this.el.innerHTML = `<div class="toc-title">批注（${this.list.length}）</div>` + (this.list.length
      ? this.list.map((c, i) => `
        <div class="cm-item" data-i="${i}">
          <div class="cm-quote" title="${esc(c.quote)}">${esc(c.quote)}</div>
          <div class="cm-text">${esc(c.text)}</div>
          <div class="cm-meta">
            <span></span>
            <span class="cm-acts"><button data-a="loc">定位</button><button data-a="del">删除</button></span>
          </div>
        </div>`).join('')
      : '<div class="toc-empty">（无批注——选中文字后点「添加批注」）</div>');
    this.el.querySelectorAll('.cm-item').forEach(el => {
      const c = this.list[+el.dataset.i];
      el.querySelector('[data-a=loc]').addEventListener('click', () => {
        const $pos = this.view.state.doc.resolve(Math.min(c.pos + 1, this.view.state.doc.content.size));
        const tr = this.view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView();
        this.view.dispatch(tr);
        this.view.focus();
      });
      el.querySelector('[data-a=del]').addEventListener('click', () => {
        const tr = this.view.state.tr.removeMark(c.pos, c.end, this.view.state.schema.marks.comment);
        this.view.dispatch(tr.scrollIntoView());
        this.render();
        this.onChange?.();
      });
    });
  }

  update() { this.render(); }
  destroy() { this.el.remove(); }
}
