// renderer/core/command-palette.js —— 命令面板：模糊搜索全部命令/文件/符号
import { commands } from './command-registry.js';
import { keymap, displayKey } from './keymap-service.js';
import { t } from '../i18n/index.js';

/** 子序列模糊匹配打分：连续命中/词首命中加权 */
export function fuzzyScore(query, text) {
  if (!query) return { score: 0, ranges: [] };
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, lastHit = -2;
  const ranges = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 1;
      if (ti === lastHit + 1) bonus += 3;
      if (ti === 0 || /[\s\-_/.]/.test(t[ti - 1])) bonus += 2;
      if (text[ti] !== q[qi] && /[A-Z]/.test(text[ti])) bonus += 1;
      score += bonus;
      ranges.push(ti);
      lastHit = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return { score: score - t.length * 0.01, ranges };
}

class CommandPalette {
  constructor() {
    this.el = null;
    this.providers = [];
  }

  addProvider(p) { this.providers.push(p); }

  open(providerId = null) {
    if (this.el) { this.close(); return; }
    const provider = providerId ? this.providers.find(p => p.id === providerId) : this.providers[0];
    if (!provider) return;
    this.active = provider;

    this.el = document.createElement('div');
    this.el.className = 'mazz-palette-mask';
    this.el.innerHTML = `
      <div class="mazz-palette">
        <div class="mazz-palette-tabs">${this.providers.map(p =>
          `<button data-p="${p.id}" class="${p.id === provider.id ? 'on' : ''}">${p.label}</button>`).join('')}</div>
        <input class="mazz-palette-input" placeholder="${provider.placeholder}" spellcheck="false" />
        <div class="mazz-palette-list"></div>
      </div>`;
    document.body.appendChild(this.el);
    const input = this.el.querySelector('input');
    const list = this.el.querySelector('.mazz-palette-list');
    this.items = []; this.selected = 0;

    const render = () => {
      const q = input.value.trim();
      const raw = this.active.getItems(q) || [];
      this.items = raw.map(it => ({ ...it, _f: fuzzyScore(q, it.label) }))
        .filter(it => !q || it._f)
        .sort((a, b) => (b._f?.score || 0) - (a._f?.score || 0))
        .slice(0, 30);
      this.selected = 0;
      this.renderList(list);
    };

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.selected); }
    });
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
    this.el.querySelectorAll('[data-p]').forEach(btn => btn.addEventListener('click', () => {
      this.active = this.providers.find(p => p.id === btn.dataset.p);
      this.el.querySelectorAll('[data-p]').forEach(b => b.classList.toggle('on', b === btn));
      input.placeholder = this.active.placeholder;
      input.value = ''; render(); input.focus();
    }));
    render(); input.focus();
  }

  renderList(list) {
    list.innerHTML = this.items.map((it, i) => `
      <div class="mazz-palette-item ${i === this.selected ? 'sel' : ''}" data-i="${i}">
        <span class="pi-icon">${it.icon || '›'}</span>
        <span class="pi-label">${highlight(it.label, it._f?.ranges)}</span>
        ${it.detail ? `<span class="pi-detail">${escapeHtml(it.detail)}</span>` : ''}
        ${it.key ? `<span class="pi-key">${it.key}</span>` : ''}
      </div>`).join('') || `<div class="mazz-palette-empty">无匹配结果</div>`;
    list.querySelectorAll('.mazz-palette-item').forEach(el =>
      el.addEventListener('mousedown', () => this.pick(+el.dataset.i)));
  }

  move(d) {
    if (!this.items.length) return;
    this.selected = (this.selected + d + this.items.length) % this.items.length;
    const list = this.el.querySelector('.mazz-palette-list');
    list.querySelectorAll('.mazz-palette-item').forEach((el, i) =>
      el.classList.toggle('sel', i === this.selected));
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  pick(i) {
    const it = this.items[i];
    if (!it) return;
    this.close();
    this.active.onPick(it);
  }
  close() { this.el?.remove(); this.el = null; }
}

function highlight(label, ranges) {
  if (!ranges?.length) return escapeHtml(label);
  const set = new Set(ranges);
  return [...label].map((c, i) =>
    set.has(i) ? `<b>${escapeHtml(c)}</b>` : escapeHtml(c)).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export const palette = new CommandPalette();

/** 默认命令源：从命令注册表取数 */
export function registerCommandSource() {
  palette.addProvider({
    id: 'commands', label: '命令', placeholder: t('输入命令名称…'),
    getItems: () => commands.list().map(c => ({
      id: c.id, label: t(c.title), icon: c.icon, group: c.group,
      key: displayKey(keymap.keyForCommand(c.id)),
    })),
    onPick: (item) => commands.execute(item.id),
  });
}
