// renderer/modules/markdown/link-bubble.js —— 链接气泡：悬停/选中链接时弹出（打开/复制/编辑/移除）
import { Plugin, PluginKey } from 'prosemirror-state';
import { inputModal } from '../../shell/shell.js';

export const linkBubbleKey = new PluginKey('mazz-link-bubble');

export function linkBubblePlugin({ onOpenExternal }) {
  let bubble = null;

  function hide() { bubble?.remove(); bubble = null; }

  function show(view, href, pos) {
    hide();
    bubble = document.createElement('div');
    bubble.className = 'link-bubble';
    bubble.innerHTML = `<a href="#" title="${escapeAttr(href)}">${escapeHtml(href)}</a>
      <button data-a="open">打开</button><button data-a="copy">复制</button>
      <button data-a="edit">编辑</button><button data-a="remove">移除</button>`;
    document.body.appendChild(bubble);
    const coords = view.coordsAtPos(pos);
    const rect = bubble.getBoundingClientRect();
    bubble.style.left = Math.min(coords.left, window.innerWidth - rect.width - 10) + 'px';
    bubble.style.top = (coords.bottom + 8) + 'px';

    bubble.querySelector('[data-a=open]').addEventListener('click', (e) => { e.preventDefault(); onOpenExternal(href); });
    bubble.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); onOpenExternal(href); });
    bubble.querySelector('[data-a=copy]').addEventListener('click', async () => {
      await window.mazz?.invoke('clipboard:write', { text: href }).catch(() => navigator.clipboard?.writeText(href));
      hide();
    });
    bubble.querySelector('[data-a=edit]').addEventListener('click', async () => {
      const next = await inputModal('链接地址', href);
      if (next == null) return;
      const { state } = view;
      const $pos = state.doc.resolve(pos);
      const mark = state.schema.marks.link;
      // 找到链接覆盖范围
      let from = pos, to = pos;
      state.doc.nodesBetween(Math.max(0, pos - 1), Math.min(state.doc.content.size, pos + 1), (node, p) => {
        if (node.isText && mark.isInSet(node.marks)) {
          from = p; to = p + node.nodeSize;
        }
      });
      view.dispatch(state.tr.removeMark(from, to, mark).addMark(from, to, mark.create({ href: next })));
      hide();
    });
    bubble.querySelector('[data-a=remove]').addEventListener('click', () => {
      const { state } = view;
      const mark = state.schema.marks.link;
      let from = pos, to = pos;
      state.doc.nodesBetween(Math.max(0, pos - 1), Math.min(state.doc.content.size, pos + 1), (node, p) => {
        if (node.isText && mark.isInSet(node.marks)) { from = p; to = p + node.nodeSize; }
      });
      view.dispatch(state.tr.removeMark(from, to, mark));
      hide();
    });
  }

  return new Plugin({
    key: linkBubbleKey,
    view() {
      return {
        update(view) {
          const { state } = view;
          const { from, empty } = state.selection;
          const linkMark = state.schema.marks.link;
          let href = null;
          if (linkMark) {
            if (empty) {
              const marks = state.storedMarks || state.doc.resolve(from).marks();
              const found = marks.find(m => m.type === linkMark);
              if (found) href = found.attrs.href;
            } else {
              state.doc.nodesBetween(from, Math.min(from + 1, state.doc.content.size), (node) => {
                const found = node.marks?.find(m => m.type === linkMark);
                if (found) href = found.attrs.href;
              });
            }
          }
          if (href) show(view, href, from);
          else hide();
        },
        destroy: hide,
      };
    },
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
