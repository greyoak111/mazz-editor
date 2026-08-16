// renderer/help/index.js —— 帮助中心：目录导航 + 全文搜索 + Markdown 渲染
import { commands } from '../core/command-registry.js';
import { keymap } from '../core/keymap-service.js';
import { HELP_SECTIONS } from './content.js';
import { SENIOR_SECTIONS } from './content-senior.js';
import { t } from '../i18n/index.js';
import { visibleHelpSections } from '../core/product-maturity.js';

// ==================== mini Markdown 渲染器（帮助文档专用子集） ====================
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
}

export function renderHelpMd(md) {
  const lines = String(md).split('\n');
  const out = [];
  let inCode = false, inTable = false, listType = null;
  const closeList = () => { if (listType) { out.push(listType === 'ul' ? '</ul>' : '</ol>'); listType = null; } };
  const closeTable = () => { if (inTable) { out.push('</table>'); inTable = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      closeList(); closeTable();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(esc(raw) + '\n'); continue; }
    if (!line.trim()) { closeList(); closeTable(); continue; }
    // 表格
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      closeList();
      if (!inTable) { out.push('<table class="help-table">'); inTable = true; }
      out.push('<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      continue;
    }
    closeTable();
    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    // 列表
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    // 引用
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
    // 普通段落
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  if (inCode) out.push('</pre>');
  return out.join('');
}

// ==================== 帮助查看器 ====================
let helpEl = null;

export function openHelp(sectionId) {
  closeHelp();
  const mask = document.createElement('div');
  mask.className = 'mazz-palette-mask help-mask';
  mask.innerHTML = `
    <div class="help-dialog">
      <div class="help-side">
        <div class="help-side-head">
          <b>❓ ${t('使用指南')}</b>
          <select class="help-ver rb-select" title="文档版本切换">
            <option value="std">喂饭级（常规详细版）</option>
            <option value="senior">喂奶级（零基础老人版）</option>
          </select>
          <input class="help-search" placeholder="${t('搜索帮助内容…')}" spellcheck="false" />
        </div>
        <div class="help-toc"></div>
      </div>
      <div class="help-body">
        <button class="help-close rb-btn" title="关闭（Esc）">✕</button>
        <div class="help-content"></div>
      </div>
    </div>`;
  document.body.appendChild(mask);
  helpEl = mask;

  const tocEl = mask.querySelector('.help-toc');
  const contentEl = mask.querySelector('.help-content');
  const searchEl = mask.querySelector('.help-search');
  const verEl = mask.querySelector('.help-ver');
  // 喂奶级/喂饭级互切（记忆选择）
  let SECTIONS = visibleHelpSections(HELP_SECTIONS);
  try {
    const v = localStorage.getItem('mazz.help.ver');
    if (v === 'senior') { SECTIONS = visibleHelpSections(SENIOR_SECTIONS); verEl.value = 'senior'; }
  } catch {}
  verEl.addEventListener('change', () => {
    SECTIONS = visibleHelpSections(verEl.value === 'senior' ? SENIOR_SECTIONS : HELP_SECTIONS);
    try { localStorage.setItem('mazz.help.ver', verEl.value); } catch {}
    renderToc();
    show(SECTIONS[0].id);
  });

  function show(id) {
    const sec = SECTIONS.find(s => s.id === id) || SECTIONS[0];
    contentEl.innerHTML = renderHelpMd(sec.body);
    contentEl.scrollTop = 0;
    tocEl.querySelectorAll('.help-toc-item').forEach(el =>
      el.classList.toggle('on', el.dataset.id === sec.id));
    mask.dataset.current = sec.id;
  }

  function renderToc(filter = '') {
    const f = filter.trim().toLowerCase();
    const items = f
      ? SECTIONS.filter(s => (s.title + s.body).toLowerCase().includes(f))
      : SECTIONS;
    tocEl.innerHTML = items.map(s =>
      `<div class="help-toc-item" data-id="${s.id}">${s.icon} ${s.title}</div>`).join('')
      || '<div class="help-toc-empty">' + t('（无匹配章节）') + '</div>';
    tocEl.querySelectorAll('.help-toc-item').forEach(el =>
      el.addEventListener('click', () => show(el.dataset.id)));
    // 搜索态：直接显示第一个匹配章节
    if (f && items.length) show(items[0].id);
  }

  searchEl.addEventListener('input', () => renderToc(searchEl.value));
  searchEl.addEventListener('keydown', (e) => e.stopPropagation());
  mask.querySelector('.help-close').addEventListener('click', closeHelp);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeHelp(); });
  mask.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });

  renderToc();
  show(sectionId || SECTIONS[0].id);
  searchEl.focus();
}

export function closeHelp() {
  helpEl?.remove();
  helpEl = null;
}

export function registerHelpCommands() {
  commands.register('help.open', {
    title: '使用指南（帮助中心）', icon: '❓', group: '帮助',
    run: () => {
      // W52③ 全应用子窗（大 UI 零重写；网页预览留 modal 兜底）
      if (window.mazz?.isElectron) { window.mazz.invoke('panel:open', { kind: 'help' }).catch(() => openHelp()); return; } // W53 全原生独立子窗格
      openHelp();
    },
  });
  keymap.register({ command: 'help.open', key: 'f1' });
}
