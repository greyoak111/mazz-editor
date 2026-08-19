import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MemoryGovernor } = require('../../main/memory-governor.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');

describe('W67 MemoryGovernor', () => {
  test('Snapshot / Delta / process 分账与历史上限确定', () => {
    let now = 0;
    let rss = 100;
    const ledger = new ResourceLedger({ now: () => now });
    const governor = new MemoryGovernor({
      resourceLedger: ledger,
      now: () => now,
      processMemory: () => ({ rss, heapTotal: 50, heapUsed: 30, external: 4, arrayBuffers: 2 }),
      appMetrics: () => [{ pid: 1, type: 'Browser', memory: { workingSetSize: rss / 1024 } }],
      historyLimit: 12,
    });
    governor.sample();
    const key = ledger.register({ type: 'browser-view', id: 'one' });
    now = 60_000; rss = 220;
    governor.sample({ lagMs: 12 });
    const summary = governor.summary({ includeHistory: true });
    assert.equal(summary.schema, 'mazz.memory-governor/v0');
    assert.equal(summary.delta.totalWorkingSetBytes, 120);
    assert.equal(summary.delta.activeResources, 1);
    assert.equal(summary.trend.workingSetBytesPerMinute, 120);
    assert.equal(summary.current.eventLoopLagMs, 12);
    ledger.release(key);
  });

  test('工作集和资源预算产生 WARN/CRITICAL，但不擅自杀资源', () => {
    const pressure = [];
    const ledger = new ResourceLedger();
    const keys = ['a', 'b', 'c'].map(id => ledger.register({ type: 'browser-view', id }));
    const governor = new MemoryGovernor({
      resourceLedger: ledger,
      processMemory: () => ({ rss: 300, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      appMetrics: () => [{ pid: 2, type: 'Tab', memory: { workingSetSize: 300 / 1024 } }],
      budgets: { totalWorkingSetBytes: 100, mainRssBytes: 100, processWorkingSetBytes: 100, resourceCaps: { 'browser-view': 2 } },
      onPressure: row => pressure.push(row.state),
    });
    const row = governor.sample();
    assert.equal(row.state, 'CRITICAL');
    assert.equal(row.violations.some(item => item.kind === 'resource-cap'), true);
    assert.equal(ledger.snapshot().activeCount, 3, 'Governor 只观测和报警，不越权杀用户资源');
    assert.deepEqual(pressure, ['CRITICAL']);
    keys.forEach(key => ledger.release(key));
  });

  test('start/stop 幂等且定时采样记录 event-loop lag', () => {
    let now = 0;
    let tick;
    let clears = 0;
    const governor = new MemoryGovernor({
      now: () => now,
      processMemory: () => ({}), appMetrics: () => [],
      setTimer: fn => { tick = fn; return { unref() {} }; },
      clearTimer: () => { clears += 1; }, sampleIntervalMs: 1000,
    });
    assert.equal(governor.start(), true);
    assert.equal(governor.start(), false);
    now = 1250; tick();
    assert.equal(governor.summary().current.eventLoopLagMs, 250);
    assert.equal(governor.stop(), true);
    assert.equal(governor.stop(), false);
    assert.equal(clears, 1);
  });
});
