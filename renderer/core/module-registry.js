// renderer/core/module-registry.js —— 模块注册表：契约 v1 + contributes 协议
// 准入门槛：契约行为测试全绿才允许进 modules/（见 tests/contract）
import { commands } from './command-registry.js';
import { keymap } from './keymap-service.js';
import { menus } from './menu-service.js';
import { contextKeys } from './contextkey-service.js';
import { moduleIconId, registerIcon, unregisterIcon } from './icon-registry.js';

const REQUIRED = ['create', 'activate', 'deactivate', 'getContent', 'setContent', 'newDocument'];

export class ModuleRegistry {
  constructor() {
    this.defs = new Map();      // name -> def
    this.instances = new Map(); // tabId -> {name, def, container, state}
    // 单签与整窗关闭都复用同一 prepare -> commit/abort 协议。只有
    // prepare 阶段允许失败；commit 只做资源收尸，不能再把半拆窗口交还用户。
    this.pendingDisposals = new Set();
    this.disposalByTab = new Map();
    this._ownerGeneration = 0;
    this._disposeAttempt = 0;
    this._registryDisposeAttempt = null;
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
    def.iconId = def.iconId || moduleIconId(name);
    registerIcon(def.iconId, def.icon);
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
    unregisterIcon(this.defs.get(name)?.iconId);
    this.defs.delete(name);
    commands.unregisterBySource(name);
    keymap.unregisterBySource(name);
    menus.removeBySource(name);
  }

  get(name) { return this.defs.get(name); }
  list() { return [...this.defs.values()]; }

  /** 为标签页实例化模块 */
  attach(tabId, name, container, restoreContent, { activate = true, provisional = false } = {}) {
    const def = this.defs.get(name);
    if (!def) throw new Error(`[modules] 未注册模块: ${name}`);
    // attach 是同步 API，不能偷偷启动旧 owner 的异步耐久关闭后立刻用
    // 同一个 tabId 覆盖它；那会使迟到 commit 删除新 owner。调用方必须先
    // await detach，handoff 回滚/恢复路径也遵守这一边界。
    if (this._registryDisposeAttempt || this.instances.has(tabId) || this.disposalByTab.has(tabId)) {
      throw new Error(`[modules] 标签仍有 owner，attach 前必须完成 detach: ${tabId}`);
    }
    const state = def.create(container) || {};
    const inst = { name, def, container, state, ready: null, ownerGeneration: ++this._ownerGeneration };
    this.instances.set(tabId, inst);
    if (provisional) def.setHandoffProvisional?.(true, state);
    // setContent 既允许同步模块，也允许 DOCX/XLSX 这类异步导入模块。
    // ready 永不向外抛出未处理拒绝；外壳必须依据 {ok,error} 决定是否把标签登记为“已打开”。
    let loadResult;
    try {
      loadResult = restoreContent != null ? def.setContent(restoreContent, state) : undefined;
    } catch (error) {
      loadResult = Promise.reject(error);
    }
    inst.ready = Promise.resolve(loadResult).then(
      () => ({ ok: true, error: null }),
      error => ({ ok: false, error }),
    );
    if (activate) def.activate(container, state);
    return inst;
  }

  /** Publish an inert provisional instance only after the source owner has
   * passed its durability close. */
  commitProvisional(tabId) {
    const inst = this.instances.get(tabId);
    if (!inst) return false;
    return inst.def.setHandoffProvisional?.(false, inst.state) !== false;
  }

  async prepareHandoffCommit(tabId, context = {}) {
    const inst = this.instances.get(tabId);
    if (!inst) return false;
    if (typeof inst.def.prepareHandoffCommit !== 'function') return true;
    return (await inst.def.prepareHandoffCommit(context, inst.state)) !== false;
  }

  finalizeHandoff(tabId) {
    const inst = this.instances.get(tabId);
    if (!inst) return false;
    inst.def.finalizeHandoff?.(inst.state);
    return true;
  }

  /** Roll back a target-side provisional without entering the normal durable
   * close ledger. Modules with persistent state must provide `discard()`;
   * ordinary modules retain their existing dispose cleanup as a fallback. */
  async discard(tabId) {
    const inst = this.instances.get(tabId);
    if (!inst) return true;
    this.instances.delete(tabId);
    try { inst.def.deactivate(inst.container, inst.state); } catch (e) { console.error(e); }
    try {
      const cleanup = inst.def.discard || inst.def.dispose;
      if (cleanup && await cleanup.call(inst.def, inst.state) === false) return false;
    } catch (e) {
      console.error('[modules] provisional discard 失败:', e?.message || e);
      return false;
    }
    return true;
  }

  _entry(tabId, inst) {
    return {
      tabId,
      inst,
      ownerGeneration: inst?.ownerGeneration,
      prepareStarted: false,
      prepared: false,
      receipt: undefined,
    };
  }

  _sameOwner(entry) {
    const live = this.instances.get(entry.tabId);
    return live === entry.inst && live?.ownerGeneration === entry.ownerGeneration;
  }

  async _prepareEntry(entry, context) {
    if (!this._sameOwner(entry)) {
      throw Object.assign(new Error(`[modules] ${entry.tabId} owner 已变化`), {
        code: 'MODULE_DISPOSE_OWNER_CHANGED', tabId: entry.tabId,
      });
    }
    entry.prepareStarted = true;
    if (typeof entry.inst.def.prepareDispose === 'function') {
      const receipt = await entry.inst.def.prepareDispose(context, entry.inst.state);
      if (receipt === false) {
        throw Object.assign(new Error(`[modules] ${entry.inst.name} 未通过耐久预检`), {
          code: 'MODULE_DISPOSE_DURABILITY_FAILED', tabId: entry.tabId, module: entry.inst.name,
        });
      }
      entry.receipt = receipt;
    }
    entry.prepared = true;
    return entry;
  }

  /**
   * Prepare a stable snapshot of every live owner. No instance is removed or
   * deactivated here. A failed attempt aborts only receipts created by this
   * attempt, so an earlier failure can never poison a later retry.
   */
  async prepareAll(context = {}) {
    if (this._registryDisposeAttempt || this.disposalByTab.size) {
      throw Object.assign(new Error('仍有标签正在关闭，请稍后重试'), { code: 'MODULE_DISPOSE_IN_PROGRESS' });
    }
    const attempt = {
      id: ++this._disposeAttempt,
      context,
      wholeRegistry: true,
      state: 'preparing',
      entries: [...this.instances].map(([tabId, inst]) => this._entry(tabId, inst)),
      failures: [],
    };
    this._registryDisposeAttempt = attempt;
    try {
      for (const entry of attempt.entries) await this._prepareEntry(entry, context);
      if (this.instances.size !== attempt.entries.length || attempt.entries.some(entry => !this._sameOwner(entry))) {
        throw Object.assign(new Error('关闭预检期间模块 owner 发生变化'), { code: 'MODULE_DISPOSE_OWNER_CHANGED' });
      }
      attempt.state = 'prepared';
      return attempt;
    } catch (error) {
      attempt.failures.push(error instanceof Error ? error : new Error(String(error)));
      await this.abortPrepared(attempt);
      throw error;
    }
  }

  async abortPrepared(attempt) {
    if (!attempt || attempt.state === 'aborted' || attempt.state === 'committed') return true;
    let ok = true;
    for (const entry of [...attempt.entries].reverse()) {
      if (!entry.prepareStarted || typeof entry.inst.def.abortDispose !== 'function') continue;
      try {
        if (await entry.inst.def.abortDispose(entry.receipt, entry.inst.state, attempt.context) === false) ok = false;
      } catch (error) {
        ok = false;
        attempt.failures.push(error instanceof Error ? error : new Error(String(error)));
        console.error('[modules] abortDispose 失败:', error?.message || error);
      }
    }
    attempt.state = 'aborted';
    if (this._registryDisposeAttempt === attempt) this._registryDisposeAttempt = null;
    return ok;
  }

  /** Commit is entered only after every fallible durability gate succeeded. */
  async commitPrepared(attempt) {
    if (!attempt || attempt.state !== 'prepared') return false;
    if ((attempt.wholeRegistry && this.instances.size !== attempt.entries.length)
        || attempt.entries.some(entry => !this._sameOwner(entry))) {
      await this.abortPrepared(attempt);
      throw Object.assign(new Error('提交关闭时模块 owner 已变化'), { code: 'MODULE_DISPOSE_OWNER_CHANGED' });
    }
    attempt.state = 'committing';
    // Validate the whole owner set before removing the first instance. From
    // this line onward cleanup failures are diagnostic, not durability NACKs.
    for (const entry of attempt.entries) this.instances.delete(entry.tabId);
    const cleanup = attempt.entries.map(async entry => {
      const { inst } = entry;
      try { inst.def.deactivate(inst.container, inst.state); } catch (error) {
        console.error('[modules] deactivate 失败:', error?.message || error);
      }
      try {
        if (typeof inst.def.commitDispose === 'function') {
          const committed = await inst.def.commitDispose(entry.receipt, inst.state, attempt.context);
          if (committed === false) throw new Error(`[modules] ${inst.name} commitDispose 拒绝提交`);
        } else {
          await inst.def.dispose?.(inst.state);
        }
      } catch (error) {
        // Durability is already proven and owners are being destroyed. Keeping
        // a half-dead window open would be worse than completing resource
        // cleanup, so observe the failure and continue the close commit.
        attempt.failures.push(error instanceof Error ? error : new Error(String(error)));
        console.error('[modules] commitDispose 资源收尸失败:', error?.message || error);
      }
    });
    await Promise.all(cleanup);
    attempt.state = 'committed';
    if (this._registryDisposeAttempt === attempt) this._registryDisposeAttempt = null;
    return true;
  }

  detach(tabId) {
    if (this._registryDisposeAttempt) return Promise.resolve(false);
    const inst = this.instances.get(tabId);
    if (!inst) return this.disposalByTab.get(tabId) || Promise.resolve(true);
    if (this.disposalByTab.has(tabId)) return this.disposalByTab.get(tabId);

    const pending = (async () => {
      const attempt = {
        id: ++this._disposeAttempt,
        context: { reason: 'tab-close' },
        wholeRegistry: false,
        state: 'preparing',
        entries: [this._entry(tabId, inst)],
        failures: [],
      };
      try {
        await this._prepareEntry(attempt.entries[0], attempt.context);
        attempt.state = 'prepared';
        return await this.commitPrepared(attempt);
      } catch (error) {
        attempt.failures.push(error instanceof Error ? error : new Error(String(error)));
        await this.abortPrepared(attempt);
        console.error('[modules] dispose 耐久预检失败:', error?.message || error);
        return false;
      }
    })();
    this.pendingDisposals.add(pending);
    this.disposalByTab.set(tabId, pending);
    pending.finally(() => {
      this.pendingDisposals.delete(pending);
      if (this.disposalByTab.get(tabId) === pending) this.disposalByTab.delete(tabId);
    });
    return pending;
  }

  /** 等待当前及等待期间新登记的 dispose 全部收讫。 */
  async waitForDisposals() {
    while (this.pendingDisposals.size) {
      await Promise.allSettled([...this.pendingDisposals]);
    }
    return true;
  }

  /** 兼容调用：内部仍严格经过全量 prepare，再一次性 commit。 */
  async disposeAll(reason = 'window-close') {
    await this.waitForDisposals();
    const attempt = await this.prepareAll({ reason });
    return this.commitPrepared(attempt);
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
