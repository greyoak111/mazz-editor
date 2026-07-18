// renderer/modules/markdown/calc-block.js —— ```calc 算块：文档内可执行代码块（Python/JS 双后端）
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const calcKey = new PluginKey('mazz-calc');

// 结果缓存：按代码文本哈希，重渲染不丢输出
const resultCache = new Map();
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36); }

export function calcBlockPlugin() {
  return new Plugin({
    key: calcKey,
    props: {
      decorations(state) {
        const widgets = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'code_block' && (node.attrs.params || '').trim() === 'calc') {
            const code = node.textContent;
            const id = hash(code);
            widgets.push(Decoration.widget(pos + node.nodeSize, (view) => buildWidget(view, code, id), {
              side: 1, key: 'calc-' + id + '-' + pos,
            }));
          }
          return true;
        });
        return DecorationSet.create(state.doc, widgets);
      },
    },
  });
}

function buildWidget(view, code, id) {
  const wrap = document.createElement('div');
  wrap.className = 'calc-widget';
  wrap.contentEditable = 'false';

  const bar = document.createElement('div');
  bar.className = 'calc-bar';
  const runBtn = document.createElement('button');
  runBtn.className = 'calc-run';
  runBtn.textContent = '▶ 运行';
  const lang = document.createElement('span');
  lang.className = 'calc-lang';
  lang.textContent = 'Python';
  bar.append(runBtn, lang);

  const out = document.createElement('pre');
  out.className = 'calc-out';
  const cached = resultCache.get(id);
  if (cached) out.textContent = cached;
  else out.textContent = '（未运行）';

  runBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.mazz?.isElectron) { out.textContent = 'calc 算块需要桌面版（Python 内核）'; return; }
    runBtn.textContent = '⏳ 执行中…';
    runBtn.disabled = true;
    try {
      const r = await window.mazz.invoke('py:exec', { code });
      const text = r.output || '（无输出）';
      out.textContent = text;
      resultCache.set(id, text);
    } catch (err) {
      out.textContent = err.message;
    }
    runBtn.textContent = '▶ 运行';
    runBtn.disabled = false;
  });

  wrap.append(bar, out);
  return wrap;
}
