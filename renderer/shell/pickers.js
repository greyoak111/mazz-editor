// renderer/shell/pickers.js —— 共享选择器组件：本机字体 / 字号 / 颜色（Office 式预设 + 自由调节）
let fontCache = null;
async function systemFonts() {
  if (fontCache) return fontCache;
  try {
    if (window.mazz?.isElectron) fontCache = await window.mazz.invoke('app:fonts');
  } catch {}
  if (!fontCache?.length) {
    fontCache = ['微软雅黑', '黑体', '宋体', '仿宋', '楷体', '等线', '苹方-简', 'PingFang SC',
      'Segoe UI', 'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Consolas', 'Courier New'];
  }
  return fontCache;
}

// ==================== 字体选择器（本机字体库 + 搜索） ====================
export class FontFamilyPicker {
  constructor(root, { onChange, width = 168 }) {
    this.onChange = onChange;
    this.value = '';
    this.el = document.createElement('div');
    this.el.className = 'pk-font';
    this.el.style.width = width + 'px';
    this.el.innerHTML = `<input class="rb-input pk-font-input" placeholder="字体（搜索本机字体库）" spellcheck="false" />
      <div class="pk-drop"></div>`;
    root.appendChild(this.el);
    this.input = this.el.querySelector('.pk-font-input');
    this.drop = this.el.querySelector('.pk-drop');
    this.input.addEventListener('focus', () => this.show());
    this.input.addEventListener('input', () => { this.render(); this.onChange?.(this.input.value); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
      if (e.key === 'Enter') { this.hide(); this.onChange?.(this.input.value); }
    });
    document.addEventListener('mousedown', (e) => { if (!this.el.contains(e.target)) this.hide(); });
  }
  set(v) { this.value = v; this.input.value = v || ''; this.input.placeholder = v || '字体'; }
  async show() {
    // 用 fixed 定位逃出 Ribbon 裁剪，列表可滚动
    const rect = this.input.getBoundingClientRect();
    this.drop.style.position = 'fixed';
    this.drop.style.left = rect.left + 'px';
    this.drop.style.top = (rect.bottom + 4) + 'px';
    this.drop.style.minWidth = Math.max(rect.width, 200) + 'px';
    this.drop.style.maxHeight = '300px';
    this.drop.style.overflowY = 'auto';
    this.drop.style.display = 'block';
    this.render();
  }
  hide() { this.drop.style.display = 'none'; }
  async render() {
    const fonts = await systemFonts();
    const q = this.input.value.trim().toLowerCase();
    const list = fonts.filter(f => f.toLowerCase().includes(q)).slice(0, 80);
    this.drop.innerHTML = list.map(f =>
      `<div class="pk-item" style="font-family:'${f}'" data-f="${f}">${f}</div>`).join('') ||
      '<div class="pk-empty">无匹配字体</div>';
    this.drop.querySelectorAll('.pk-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.set(el.dataset.f);
        this.hide();
        this.onChange?.(el.dataset.f);
      });
    });
  }
}

// ==================== 字号选择器（预设 + 自由输入） ====================
export class FontSizePicker {
  constructor(root, { onChange, presets = [8, 9, 10.5, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72] }) {
    this.onChange = onChange;
    this.presets = presets;
    this.el = document.createElement('div');
    this.el.className = 'pk-size';
    this.el.innerHTML = `<input class="rb-input pk-size-input" spellcheck="false" /><div class="pk-drop"></div>`;
    root.appendChild(this.el);
    this.input = this.el.querySelector('.pk-size-input');
    this.drop = this.el.querySelector('.pk-drop');
    this.input.addEventListener('focus', () => this.show());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.commit(); this.hide(); }
      if (e.key === 'Escape') this.hide();
    });
    this.input.addEventListener('change', () => this.commit());
    document.addEventListener('mousedown', (e) => { if (!this.el.contains(e.target)) this.hide(); });
  }
  set(v) { this.input.value = v ?? ''; }
  commit() {
    const v = parseFloat(this.input.value);
    if (!isNaN(v) && v > 0 && v <= 500) this.onChange?.(v);
  }
  show() {
    const rect = this.input.getBoundingClientRect();
    this.drop.style.position = 'fixed';
    this.drop.style.left = rect.left + 'px';
    this.drop.style.top = (rect.bottom + 4) + 'px';
    this.drop.style.minWidth = rect.width + 'px';
    this.drop.style.maxHeight = '300px';
    this.drop.style.overflowY = 'auto';
    this.drop.style.display = 'block';
    this.drop.innerHTML = this.presets.map(s => `<div class="pk-item" data-s="${s}">${s}</div>`).join('');
    this.drop.querySelectorAll('.pk-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.set(el.dataset.s);
        this.hide();
        this.onChange?.(parseFloat(el.dataset.s));
      });
    });
  }
  hide() { this.drop.style.display = 'none'; }
}

// ==================== 颜色选择器（预设色板 + 原生自由色） ====================
const PALETTE = [
  // Office 式主题色 + 标准色
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#1155cc', '#20124d', '#4c1130'],
  ['#274e13', '#38761d', '#bf9000', '#bf6000', '#85200c', '#990000', '#0b5394', '#073763', '#351c75', '#741b47'],
];

export class ColorPicker {
  constructor(root, { onChange, label = '颜色', swatch = true }) {
    this.onChange = onChange;
    this.value = '#000000';
    this.el = document.createElement('div');
    this.el.className = 'pk-color';
    this.el.innerHTML = `
      <button class="rb-btn pk-color-btn" title="${label}">
        ${swatch ? '<span class="pk-swatch"></span>' : ''}<span class="pk-label">${label}</span>
      </button>
      <div class="pk-drop pk-palette"></div>`;
    root.appendChild(this.el);
    this.btn = this.el.querySelector('.pk-color-btn');
    this.drop = this.el.querySelector('.pk-drop');
    this.btn.addEventListener('click', () => this.toggle());
    document.addEventListener('mousedown', (e) => { if (!this.el.contains(e.target)) this.hide(); });
  }
  set(v) {
    this.value = v;
    const sw = this.el.querySelector('.pk-swatch');
    if (sw) sw.style.background = v;
  }
  toggle() {
    const opening = this.drop.style.display !== 'block';
    if (opening) {
      const rect = this.btn.getBoundingClientRect();
      this.drop.style.position = 'fixed';
      this.drop.style.left = rect.left + 'px';
      this.drop.style.top = (rect.bottom + 4) + 'px';
      this.drop.style.display = 'block';
      this.render();
    } else {
      this.drop.style.display = 'none';
    }
  }
  hide() { this.drop.style.display = 'none'; }
  render() {
    this.drop.innerHTML = `
      <div class="pk-grid">${PALETTE.flat().map(c => `<span class="pk-cell" data-c="${c}" style="background:${c}" title="${c}"></span>`).join('')}</div>
      <div class="pk-custom"><label>自定义</label><input type="color" class="pk-native"></div>`;
    this.drop.querySelectorAll('.pk-cell').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.set(el.dataset.c);
        this.hide();
        this.onChange?.(el.dataset.c);
      });
    });
    this.drop.querySelector('.pk-native').addEventListener('input', (e) => {
      this.set(e.target.value);
      this.onChange?.(e.target.value);
    });
  }
}
