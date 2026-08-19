'use strict';

const { EXTERNAL_TOOL_ADAPTER_PROTOCOL } = require('./foundation/external-tool-adapter');

class ExternalToolService {
  constructor({ bus, adapters = [] } = {}) {
    if (!bus || typeof bus.handle !== 'function') throw new Error('ExternalToolService 需要 IPC bus');
    this.adapters = new Map();
    for (const adapter of adapters) this.register(adapter);
    bus.handle('externalTool:list', async () => this.list());
    bus.handle('externalTool:probe', async ({ adapterId } = {}) => this.adapter(adapterId).probe());
    bus.handle('externalTool:run', async ({ adapterId, request } = {}) => this.adapter(adapterId).run(request));
    bus.handle('externalTool:cancel', async ({ adapterId, runId } = {}) => this.adapter(adapterId).cancel(runId));
    bus.handle('externalTool:dispose', async ({ adapterId, reason } = {}) => this.adapter(adapterId).dispose(reason || 'renderer-dispose'));
  }

  register(adapter) {
    if (!adapter || adapter.protocol !== EXTERNAL_TOOL_ADAPTER_PROTOCOL) throw new Error('外部工具 Adapter 协议不兼容');
    if (this.adapters.has(adapter.id)) throw new Error(`外部工具 Adapter 重复: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return adapter;
  }

  adapter(adapterId) {
    const adapter = this.adapters.get(String(adapterId || '').trim());
    if (!adapter) throw new Error(`外部工具 Adapter 不存在: ${adapterId || ''}`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()].map(adapter => ({
      id: adapter.id,
      toolId: adapter.toolId,
      displayName: adapter.displayName,
      provenance: adapter.provenance,
    }));
  }

  async disposeAll(reason = 'app-quit') {
    await Promise.allSettled([...this.adapters.values()].map(adapter => adapter.dispose(reason)));
  }
}

module.exports = { ExternalToolService };
