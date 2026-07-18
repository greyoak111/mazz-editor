// renderer/core/module-registry.js —— 模块注册表：契约 v1 + contributes 协议
// 准入门槛：契约行为测试全绿才允许进 modules/（见 tests/contract）
import { commands } from './command-registry.js';
import { keymap } from './keymap-service.js';
import { menus } from './menu-service.js';
import { contextKeys } from './contextkey-service.js';

const REQUIRED = ['create', 'activate', 'deactivate', 'getContent', 'setContent', 'newDocument'];

class ModuleRegistry {
  constructor() {
    this.defs = new Map();      // name -> def
    this.instances = new Map(); // tabId -> {name, def, container, state}
  }

  /** MazzModules.register('name', def) —— 契约校验 + contributes 处理 */
  register(name, def) {
    if (this.defs.has(name)) throw new Error(`[modules] 重复注册: ${name}`);
    for (const fn of REQUIRED) {
      if (typeof def[fn] !== 'function') throw new Error(`[modules] ${name} 缺少契约方法 ${fn}()`);
    }
    def.name = name;
    def.displayName = def.displayName || name;
    def.icon = def.icon || '📄';
    this.defs.set(name, def);
    this._processContributes(name, def);
    return def;
  }

  _processContributes(name, def) {
    const c = def.contributes || {};
    for (const cmd of c.commands || []) {
      commands.register(cmd.id, { ...cmd, source: name });
    }
    for (const kb of c.keybindings || []) {
      keymap.register({ ...kb, source: name });
    }
    for (const [menuId, items] of Object.entries(c.menus || {})) {
      menus.contribute(menuId, items.map(it => ({ ...it, source: name })));
    }
    for (const bridge of c.bridges || []) {
      window.MazzBridges?.register({ ...bridge, source: name });
    }
    for (const action of c.aiActions || []) {
      window.MazzAI?.contributes.addAction({ ...action, source: name });
    }
  }

  unregister(name) {
    this.defs.delete(name);
    commands.unregisterBySource(name);
    keymap.unregisterBySource(name);
    menus.removeBySource(name);
  }

  get(name) { return this.defs.get(name); }
  list() { return [...this.defs.values()]; }

  /** 为标签页实例化模块 */
  attach(tabId, name, container, restoreContent) {
    const def = this.defs.get(name);
    if (!def) throw new Error(`[modules] 未注册模块: ${name}`);
    this.detach(tabId);
    const state = def.create(container) || {};
    const inst = { name, def, container, state };
    this.instances.set(tabId, inst);
    if (restoreContent != null) def.setContent(restoreContent, state);
    def.activate(container, state);
    return inst;
  }

  detach(tabId) {
    const inst = this.instances.get(tabId);
    if (inst) {
      try { inst.def.deactivate(inst.container, inst.state); } catch (e) { console.error(e); }
      this.instances.delete(tabId);
    }
  }

  activateTab(tabId) {
    const inst = this.instances.get(tabId);
    if (!inst) return null;
    inst.def.activate(inst.container, inst.state);
    contextKeys.set('module', inst.name);
    return inst;
  }
  deactivateTab(tabId) {
    const inst = this.instances.get(tabId);
    if (inst) inst.def.deactivate(inst.container, inst.state);
  }
}

export const modules = new ModuleRegistry();
// 全局入口（契约文档命名）
if (typeof window !== 'undefined') window.MazzModules = modules;
