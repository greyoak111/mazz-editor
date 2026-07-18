// renderer/core/command-registry.js —— 命令注册表（单一事实源）
// 右键、快捷键、托盘、菜单栏、命令面板全部从这里取数；注册期查重
import { Emitter } from './events.js';
import { contextKeys } from './contextkey-service.js';

class CommandRegistry {
  constructor() {
    this.commands = new Map(); // id -> {id, title, run, icon, group, source}
    this.events = new Emitter();
  }

  /** 注册命令；重复 id 直接报错（注册期查重） */
  register(id, def) {
    if (!id || typeof def.run !== 'function') throw new Error(`[commands] 非法命令: ${id}`);
    if (this.commands.has(id)) {
      // 同一来源重复注册视为刷新（热更新模块），不同来源视为冲突
      if (this.commands.get(id).source !== def.source) {
        console.error(`[commands] 命令冲突: ${id}（${this.commands.get(id).source} vs ${def.source}）`);
        return false;
      }
    }
    this.commands.set(id, {
      id, title: def.title || id, run: def.run,
      icon: def.icon || null, group: def.group || '', source: def.source || 'core',
      when: def.when || null,
    });
    this.events.emit('changed');
    return true;
  }

  unregisterBySource(source) {
    for (const [id, c] of [...this.commands]) if (c.source === source) this.commands.delete(id);
    this.events.emit('changed');
  }

  has(id) { return this.commands.has(id); }
  get(id) { return this.commands.get(id); }

  /** 执行命令：when 不满足时拒绝 */
  async execute(id, ...args) {
    const cmd = this.commands.get(id);
    if (!cmd) { console.warn(`[commands] 未注册: ${id}`); return undefined; }
    if (cmd.when && !contextKeys.evaluate(cmd.when)) return undefined;
    return await cmd.run(...args);
  }

  /** 列出当前上下文可用命令（命令面板/菜单取数） */
  list({ includeDisabled = false } = {}) {
    return [...this.commands.values()]
      .filter(c => includeDisabled || !c.when || contextKeys.evaluate(c.when))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }
}

export const commands = new CommandRegistry();
