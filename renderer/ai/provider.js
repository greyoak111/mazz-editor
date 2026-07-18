// renderer/ai/provider.js —— AI 扩展层：Provider 注册表（只预留，不实现；默认 Provider = null）
// 未来接任何引擎（本地 ONNX / 远端 API）都不动主架构
class AIProviderRegistry {
  constructor() {
    this.providers = new Map(); // id -> {id, name, capabilities, complete, stream}
    this.activeId = null;
  }
  /** registerProvider({id, name, capabilities, complete, stream}) */
  register(def) {
    if (!def?.id || typeof def.complete !== 'function') {
      throw new Error('[ai] Provider 必须提供 {id, complete}');
    }
    this.providers.set(def.id, def);
    if (!this.activeId) this.activeId = def.id;
    return true;
  }
  unregister(id) {
    this.providers.delete(id);
    if (this.activeId === id) this.activeId = this.providers.keys().next().value || null;
  }
  get active() { return this.activeId ? this.providers.get(this.activeId) : null; }
  isConfigured() { return this.active != null; }
  list() { return [...this.providers.values()]; }
}

export const aiProviders = new AIProviderRegistry();
