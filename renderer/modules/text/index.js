// renderer/modules/text/index.js —— 纯文本模块（验证契约可插拔：TXT 读写，即开即用）
import { contextKeys } from '../../core/contextkey-service.js';
import { menus } from '../../core/menu-service.js';

const MODULE = 'text';
const instances = new Map(); // container -> {ta}
let current = null;

function getSelection(ta) { return ta.selectionStart !== ta.selectionEnd; }

export default {
  displayName: '纯文本',
  icon: '🄣',

  create(container) {
    const ta = document.createElement('textarea');
    ta.className = 'txt-editor';
    ta.spellcheck = true;
    ta.placeholder = '纯文本，即开即用…';
    container.appendChild(ta);
    const inst = { ta, container };
    instances.set(container, inst);

    ta.addEventListener('input', () => window.MazzHost?.notifyChange(container));
    ta.addEventListener('focus', () => {
      if (current !== inst) { current = inst; contextKeys.set('module', MODULE); }
    });
    const syncSel = () => { if (current === inst) contextKeys.set('hasSelection', getSelection(ta)); };
    ta.addEventListener('select', syncSel);
    ta.addEventListener('keyup', syncSel);
    ta.addEventListener('mouseup', syncSel);
    ta.addEventListener('contextmenu', (e) => {
      if (window.mazz?.isElectron) { menus.pushModel('editor/context'); return; }
      e.preventDefault();
      menus.show('editor/context', { x: e.clientX, y: e.clientY, preferDom: true });
    });
    return { container };
  },
  activate(container) {
    const inst = instances.get(container);
    if (!inst) return;
    current = inst;
    contextKeys.set('module', MODULE);
    contextKeys.set('hasSelection', getSelection(inst.ta));
    inst.ta.focus();
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },

  getContent(state) { return instances.get(state.container)?.ta.value ?? ''; },
  setContent(data, state) {
    const inst = instances.get(state.container);
    if (inst) inst.ta.value = typeof data === 'string' ? data : '';
  },
  newDocument(state) { this.setContent('', state); },
  getCharCount(state) { return instances.get(state.container)?.ta.value.length ?? 0; },
  getCursorPos(state) {
    const ta = instances.get(state.container)?.ta;
    if (!ta) return '';
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const col = ta.selectionStart - before.lastIndexOf('\n');
    return `行 ${line}，列 ${col}`;
  },

  toolbarHTML: `
    <div class="rb-group" data-label="编辑">
      <button class="rb-btn" data-command="text.undo"><i class="ico">↩</i><span>撤销</span></button>
      <button class="rb-btn" data-command="text.redo"><i class="ico">↪</i><span>重做</span></button>
    </div>
    <div class="rb-group" data-label="换行">
      <button class="rb-btn" data-command="text.toggleWrap"><i class="ico">↵</i><span>自动换行</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'text.undo', title: '撤销', group: '编辑', when: "module=='text'",
        run: () => document.execCommand('undo') },
      { id: 'text.redo', title: '重做', group: '编辑', when: "module=='text'",
        run: () => document.execCommand('redo') },
      { id: 'text.toggleWrap', title: '切换自动换行', group: '编辑', when: "module=='text'",
        run: () => { if (current) current.ta.wrap = current.ta.wrap === 'soft' ? 'off' : 'soft'; } },
      { id: 'text.cut', title: '剪切', group: '编辑', when: "module=='text' && hasSelection",
        run: () => document.execCommand('cut') },
      { id: 'text.copy', title: '复制', group: '编辑', when: "module=='text' && hasSelection",
        run: () => document.execCommand('copy') },
      { id: 'text.paste', title: '粘贴', group: '编辑', when: "module=='text'",
        run: async () => {
          if (!current) return;
          const t = window.mazz?.isElectron
            ? (await window.mazz.invoke('clipboard:read')).text
            : await navigator.clipboard.readText().catch(() => '');
          if (t) {
            const { ta } = current;
            const s = ta.selectionStart, e = ta.selectionEnd;
            ta.setRangeText(t, s, e, 'end');
            window.MazzHost?.notifyChange(current.container);
          }
        } },
      { id: 'text.selectAll', title: '全选', group: '编辑', when: "module=='text'",
        run: () => current?.ta.select() },
    ],
    keybindings: [
      { command: 'text.undo', key: 'ctrl+z', when: "module=='text'" },
      { command: 'text.redo', key: 'ctrl+y', when: "module=='text'" },
    ],
    menus: {
      'editor/context': [
        { command: 'text.cut', title: '剪切', when: "module=='text' && hasSelection", group: '1_clip' },
        { command: 'text.copy', title: '复制', when: "module=='text' && hasSelection", group: '1_clip' },
        { command: 'text.paste', title: '粘贴', when: "module=='text'", group: '1_clip' },
        { command: 'text.selectAll', title: '全选', when: "module=='text' && !hasSelection", group: '1_clip' },
      ],
    },
    bridges: [],
    aiActions: [],
  },
};
