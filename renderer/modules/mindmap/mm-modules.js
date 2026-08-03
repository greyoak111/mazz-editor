// renderer/modules/mindmap/mm-modules.js —— 导图功能模块注册骨架（kityminder 声明式 deals 同款）
// 功能=数据不是代码：一份 deals {defaultOptions/init/commands/events/renderers/shortcuts/destroy} 注册即挂，
// 引擎本体零改动。图形库/泳道/模板包/后续（叙事模式/混合画布/共编）全以 deals 形态落地。
const _modules = {};

/** 注册功能模块：mmRegister('shapes', deals) */
export function mmRegister(name, deals) { _modules[name] = deals; }

/** 已注册模块表（诊断/测试口） */
export function mmModuleNames() { return Object.keys(_modules); }

/**
 * 启动统一分派（导图实例创建时调用一次）
 * deals 契约（kityminder 对齐）：
 *  defaultOptions   模块自带默认配置（并入 ctl.mmOpts）
 *  init(ctl)        初始化（可建 DOM/挂状态）
 *  commands         {name: Command 构造器} → ctl.mmCommands[name]（实例化入池；命令=可查询可执行对象）
 *  events           {type: fn(ctl, e)}     → 挂 document（返回解挂器存 ctl._mmOff）
 *  renderers        {type: R 或 R[]}       → ctl.mmRenderers[type] 叠加注册（渲染管线消费）
 *  shortcuts        {key: commandName}     → ctl.mmShortcuts 快捷键表
 *  destroy(ctl)     实例销毁生命周期
 */
export function mmBoot(ctl) {
  ctl.mmOpts = ctl.mmOpts || {};
  ctl.mmCommands = ctl.mmCommands || {};
  ctl.mmRenderers = ctl.mmRenderers || {};
  ctl.mmShortcuts = ctl.mmShortcuts || {};
  ctl._mmOff = ctl._mmOff || [];
  for (const [name, d] of Object.entries(_modules)) {
    try {
      if (d.defaultOptions) Object.assign(ctl.mmOpts, d.defaultOptions);
      if (d.commands) for (const [k, C] of Object.entries(d.commands)) ctl.mmCommands[k.toLowerCase()] = new C();
      if (d.events) {
        for (const [type, fn] of Object.entries(d.events)) {
          const bound = (e) => fn(ctl, e);
          document.addEventListener(type, bound);
          ctl._mmOff.push(() => document.removeEventListener(type, bound));
        }
      }
      if (d.renderers) {
        for (const [type, R] of Object.entries(d.renderers)) {
          const list = ctl.mmRenderers[type] = ctl.mmRenderers[type] || [];
          for (const r of (Array.isArray(R) ? R : [R])) list.push(r);
        }
      }
      if (d.shortcuts) Object.assign(ctl.mmShortcuts, d.shortcuts);
      d.init?.(ctl);
    } catch (e) { console.warn('[mm-modules] ' + name + ' 启动失败：', e); }
  }
}

/** 实例销毁：全模块 destroy + 事件解挂 */
export function mmTeardown(ctl) {
  for (const [name, d] of Object.entries(_modules)) {
    try { d.destroy?.(ctl); } catch (e) { console.warn('[mm-modules] ' + name + ' 销毁失败：', e); }
  }
  for (const off of (ctl._mmOff || [])) { try { off(); } catch {} }
  ctl._mmOff = [];
}

/** 命令执行统一口（查询/执行分离：exec 前三态检查，kityminder execCommand 同款纪律） */
export function mmExec(ctl, name, ...args) {
  const cmd = ctl.mmCommands?.[String(name).toLowerCase()];
  if (!cmd) return false;
  if (typeof cmd.queryState === 'function' && cmd.queryState(ctl) === -1) return false; // 禁用态不执行
  return cmd.execute(ctl, ...args);
}
