// tests/unit/factory-ai-requests.test.mjs —— Factory AI 主进程请求 owner 生命周期
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger } = require('../../main/resource-ledger.js');
const { FactoryAiRequestRegistry } = require('../../main/factory-ai-requests.js');

describe('Factory AI 请求注册表', () => {
  test('连续 20 次取消/关签会取消 reader、清除 timer 并回到账本基线', async () => {
    const ledger = new ResourceLedger({ historyLimit: 100 });
    const registry = new FactoryAiRequestRegistry({ resourceLedger: ledger });
    let readerCancels = 0;
    let readerReleases = 0;
    for (let index = 0; index < 20; index++) {
      const req = registry.begin(`stream-${index}`, { kind: 'stream', timeoutMs: 60000, model: 'test-model' });
      req.attachReader({
        async cancel() { readerCancels++; },
        releaseLock() { readerReleases++; },
      });
      assert.equal(ledger.snapshot().byType['factory-ai-request'], 1);
      assert.equal(await registry.cancel(req.id, 'test-stop'), true);
      assert.equal(req.signal.aborted, true);
      await req.close();
      assert.equal(ledger.snapshot().activeCount, 0, `第 ${index + 1} 次请求未释放`);
    }
    assert.equal(readerCancels, 20);
    assert.equal(readerReleases, 20);
    assert.equal(registry.snapshot().length, 0);
    assert.equal(ledger.snapshot({ includeReleased: true }).released.length, 20);
  });

  test('超时归注册表所有，重复 requestId 不会覆盖仍活跃的 owner', async () => {
    let timeoutCallback = null;
    let cleared = 0;
    const registry = new FactoryAiRequestRegistry({
      setTimer: callback => { timeoutCallback = callback; return 17; },
      clearTimer: token => { if (token === 17) cleared++; },
    });
    const req = registry.begin('timeout-one', { timeoutMs: 25 });
    assert.throws(() => registry.begin('timeout-one'), /duplicate requestId/);
    timeoutCallback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(req.signal.aborted, true);
    assert.equal(req.cancelReason, 'timeout');
    await req.close();
    assert.equal(cleared, 1);
    assert.equal(registry.snapshot().length, 0);
  });

  test('destroy 会统一取消并关签全部遗留请求', async () => {
    const registry = new FactoryAiRequestRegistry();
    const requests = Array.from({ length: 4 }, (_, index) => registry.begin(`quit-${index}`, { timeoutMs: 60000 }));
    await registry.destroy('app-quit');
    assert.equal(registry.snapshot().length, 0);
    assert.equal(requests.every(request => request.signal.aborted), true);
  });

  test('renderer owner 销毁只取消自己的请求，不能误杀另一窗口', async () => {
    const registry = new FactoryAiRequestRegistry();
    const mine = registry.begin('mine', { ownerId: 'renderer-1', timeoutMs: 60000 });
    const other = registry.begin('other', { ownerId: 'renderer-2', timeoutMs: 60000 });
    assert.equal(await registry.cancel('other', 'forbidden', { ownerId: 'renderer-1' }), false);
    assert.equal(await registry.cancelOwner('renderer-1'), 1);
    assert.equal(mine.signal.aborted, true);
    assert.equal(other.signal.aborted, false);
    await mine.close();
    await other.close();
  });
});
