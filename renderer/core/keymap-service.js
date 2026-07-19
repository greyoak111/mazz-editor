// renderer/core/keymap-service.js —— 快捷键服务：默认层 + 用户覆盖层 + 注册期冲突检测
import { commands } from './command-registry.js';
import { contextKeys } from './contextkey-service.js';

const MOD_ORDER = ['ctrl', 'cmd', 'alt', 'shift', 'meta'];
// 修饰键排前（0-4），普通键排后（9）
function rank(p) { const i = MOD_ORDER.indexOf(p); return i < 0 ? 9 : i; }

export function normalizeKeyEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push(isMac() ? 'cmd' : 'meta');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let key = e.key.toLowerCase();
  const alias = {
    ' ': 'space', 'arrowup': 'up', 'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right',
    'escape': 'esc', 'delete': 'del',
  };
  key = alias[key] ?? key;
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null;
  parts.push(key);
  return parts.sort((a, b) => rank(a) - rank(b)).join('+');
}

/** 将 "Ctrl+Shift+P" 规范化为内部序 */
export function normalizeKeyString(str) {
  const parts = str.toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  const alias = { 'cmdorctrl': isMac() ? 'cmd' : 'ctrl', 'option': 'alt' };
  const mapped = parts.map(p => alias[p] || p);
  const mods = mapped.filter(p => MOD_ORDER.includes(p));
  const rest = mapped.filter(p => !MOD_ORDER.includes(p));
  return [...mods, ...rest].sort((a, b) => rank(a) - rank(b)).join('+');
}

function isMac() {
  const plat = (typeof window !== 'undefined' && window.mazz?.platform)
    || (typeof navigator !== 'undefined' && navigator.platform) || '';
  return plat.toLowerCase().includes('mac');
}

/** 内部序 → 展示用 "Ctrl+Shift+P" */
export function displayKey(norm) {
  if (!norm) return '';
  const cap = { ctrl: 'Ctrl', cmd: '⌘', alt: isMac() ? '⌥' : 'Alt', shift: isMac() ? '⇧' : 'Shift', meta: 'Meta' };
  return norm.split('+').map(p => cap[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join(isMac() ? '' : '+');
}

class KeymapService {
  constructor() {
    this.defaults = [];   // {key, command, when, source}
    this.overlay = [];    // 用户层：keybindings.json
    this.conflicts = [];
    this.recorder = null; // 录制按键回调（可视化编辑器用）
  }

  /** 注册默认键位；冲突自动检测提示 */
  register({ key, command, when, source }) {
    const norm = normalizeKeyString(key);
    const hit = this.defaults.find(b => b.key === norm && (b.when || '') === (when || ''));
    if (hit && hit.command !== command) {
      this.conflicts.push({ key: norm, a: hit.command, b: command, when: when || '' });
      console.warn(`[keymap] 键位冲突 ${displayKey(norm)}: ${hit.command} vs ${command}`);
    }
    this.defaults.push({ key: norm, command, when: when || null, source: source || 'core' });
  }

  unregisterBySource(source) { this.defaults = this.defaults.filter(b => b.source !== source); }

  /** 用户覆盖层：同键覆盖默认；command 以 '-' 开头表示移除 */
  setOverlay(entries) {
    this.overlay = (entries || []).map(e => ({
      key: normalizeKeyString(e.key), command: e.command, when: e.when || null,
    }));
  }

  resolve(normKey) {
    // 覆盖层优先；'-' 前缀屏蔽默认
    for (let i = this.overlay.length - 1; i >= 0; i--) {
      const b = this.overlay[i];
      if (b.key === normKey && contextKeys.evaluate(b.when)) {
        return b.command.startsWith('-') ? null : b.command;
      }
    }
    for (let i = this.defaults.length - 1; i >= 0; i--) {
      const b = this.defaults[i];
      if (b.key === normKey && contextKeys.evaluate(b.when)) return b.command;
    }
    return undefined;
  }

  /** 命令 → 键位（菜单/工具提示展示） */
  keyForCommand(commandId) {
    const ov = this.overlay.find(b => b.command === commandId);
    if (ov) return ov.key;
    const def = this.defaults.find(b => b.command === commandId);
    return def ? def.key : '';
  }

  attach() {
    window.addEventListener('keydown', (e) => {
      if (this.recorder) {
        e.preventDefault(); e.stopPropagation();
        this.recorder(normalizeKeyEvent(e));
        return;
      }
      const norm = normalizeKeyEvent(e);
      if (!norm) return;
      const commandId = this.resolve(norm);
      if (commandId === null) { e.preventDefault(); return; } // 显式屏蔽
      if (commandId === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      commands.execute(commandId);
    }, true); // capture：先于编辑器自身键位
  }
}

export const keymap = new KeymapService();
