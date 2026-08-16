// renderer/core/command-registry.js —— 命令注册表（单一事实源）
// 右键、快捷键、托盘、菜单栏、命令面板全部从这里取数；注册期查重
import { Emitter } from './events.js';
import { contextKeys } from './contextkey-service.js';
import { MATURITY, maturityLabel, resolveCommandMaturity } from './product-maturity.js';

const DANGEROUS_COMMAND = /(?:delete|remove|clear|overwrite|publish|post|upload|删除|移除|清空|覆盖|投稿|发布)/i;

export class CommandRegistry {
  constructor() {
    this.commands = new Map(); // id -> {id, title, run, icon, group, source}
    this.events = new Emitter();
  }

  /** 注册命令；重复 id 直接报错（注册期查重） */
  register(id, def) {
    if (!id || typeof def.run !== 'function') throw new Error(`[commands] 非法命令: ${id}`);
    const maturity = resolveCommandMaturity(id);
    // Hidden 只隐藏产品入口，后端/实现代码仍保留，待自身 Activation Gate 通过后再改表。
    if (maturity === MATURITY.HIDDEN) return false;
    if (this.commands.has(id)) {
      // 同一来源重复注册视为刷新（热更新模块），不同来源视为冲突
      if (this.commands.get(id).source !== def.source) {
        console.error(`[commands] 命令冲突: ${id}（${this.commands.get(id).source} vs ${def.source}）`);
        return false;
      }
    }
    const title = maturityLabel(def.title || id, maturity);
    this.commands.set(id, {
      id, title, run: def.run, maturity,
      icon: def.icon || null, group: def.group || '', source: def.source || 'core',
      when: def.when || null,
      // W62a：所有入口仍以命令注册表为单源；agent 只拿脱敏工具卡，不接触 run 函数。
      agent: def.agent === false ? false : {
        description: def.agent?.description || title,
        argsSchema: def.agent?.argsSchema || { type: 'object', additionalProperties: false },
        danger: def.agent?.danger ?? DANGEROUS_COMMAND.test(`${id} ${def.title || ''}`),
        undo: def.agent?.undo || null,
      },
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
  isEnabled(id) {
    const cmd = this.commands.get(id);
    return !!cmd && (!cmd.when || contextKeys.evaluate(cmd.when));
  }

  /** 执行命令：when 不满足时拒绝 */
  async execute(id, ...args) {
    const cmd = this.commands.get(id);
    if (!cmd) { console.warn(`[commands] 未注册: ${id}`); return undefined; }
    if (!this.isEnabled(id)) return undefined;
    return await cmd.run(...args);
  }

  /** 列出当前上下文可用命令（命令面板/菜单取数） */
  list({ includeDisabled = false } = {}) {
    return [...this.commands.values()]
      .filter(c => includeDisabled || !c.when || contextKeys.evaluate(c.when))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }

  /** 导出给 AI 路由器的闭集工具卡；函数体、来源内部状态一律不外泄。 */
  toolCards({ includeDisabled = true } = {}) {
    return this.list({ includeDisabled })
      .filter(c => c.agent !== false)
      .map(c => ({
        id: c.id, title: c.title, group: c.group || '', when: c.when || '',
        maturity: c.maturity,
        description: c.agent.description, argsSchema: c.agent.argsSchema,
        danger: !!c.agent.danger, undo: c.agent.undo || null,
      }));
  }
}

export const commands = new CommandRegistry();
