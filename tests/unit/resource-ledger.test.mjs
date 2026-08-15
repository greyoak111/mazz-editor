// tests/unit/resource-ledger.test.mjs —— W71 资源账本行为测试
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger, safeValue } = require('../../main/resource-ledger.js');

describe('W71 ResourceLedger', () => {
  test('登记、更新、释放与按类型统计闭环', () => {
    let now = 100;
    const ledger = new ResourceLedger({ now: () => ++now, historyLimit: 3 });
    const pty = ledger.register({ type: 'pty', id: 'term-1', owner: 'terminal', meta: { cwd: 'D:/work' } });
    const agent = ledger.register({ type: 'agent-session', id: 's-1', owner: 'fake', state: 'starting' });
    assert.equal(ledger.snapshot().activeCount, 2);
    assert.deepEqual(ledger.snapshot().byType, { pty: 1, 'agent-session': 1 });
    assert.equal(ledger.update(agent, { state: 'running', meta: { step: 1 } }), true);
    assert.equal(ledger.release(pty, { reason: 'user-kill', state: 'cancelled' }), true);
    assert.equal(ledger.release(pty), false, '重复释放必须幂等');
    const snap = ledger.snapshot({ includeReleased: true });
    assert.equal(snap.activeCount, 1);
    assert.equal(snap.active[0].state, 'running');
    assert.equal(snap.released[0].releaseReason, 'user-kill');
  });

  test('重复活动键拒绝，敏感元数据不进入账本', () => {
    const ledger = new ResourceLedger();
    ledger.register({ type: 'pty', id: 'same', meta: { token: 'leak', nested: { password: 'leak', ok: 'yes' } } });
    assert.throws(() => ledger.register({ type: 'pty', id: 'same' }), /重复登记/);
    const meta = ledger.snapshot().active[0].meta;
    assert.equal(meta.token, '[redacted]');
    assert.equal(meta.nested.password, '[redacted]');
    assert.equal(meta.nested.ok, 'yes');
    assert.equal(safeValue({ apiKey: 'x' }).apiKey, '[redacted]');
  });
});
