import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { FactoryRunOwnerRegistry } = require('../../main/factory-run-owners.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');

function specimen() {
  let sequence = 0;
  const resources = new ResourceLedger({ now: () => ++sequence, historyLimit: 200 });
  const owners = new FactoryRunOwnerRegistry({ resourceLedger: resources, idFactory: () => `lease-${++sequence}` });
  return { owners, resources };
}

describe('W73h main-process Production Run owner', () => {
  test('同 owner 幂等；另一 renderer 必须阻断；错误 lease 不能抢释放', () => {
    const { owners, resources } = specimen();
    const first = owners.acquire({ runId: 'run-001', taskId: 'task-001', ownerId: 'renderer-a' });
    const idempotent = owners.acquire({ runId: 'run-001', taskId: 'task-001', ownerId: 'renderer-a' });
    assert.equal(first.ok, true);
    assert.equal(idempotent.code, 'IDEMPOTENT');
    assert.equal(idempotent.leaseId, first.leaseId);
    assert.equal(owners.acquire({ runId: 'run-001', taskId: 'task-001', ownerId: 'renderer-b' }).code, 'RUN_OWNER_ACTIVE');
    assert.equal(owners.release({ runId: 'run-001', leaseId: 'wrong', ownerId: 'renderer-a' }).code, 'RUN_OWNER_MISMATCH');
    assert.equal(resources.snapshot().byType['factory-run-owner'], 1);
    assert.equal(owners.release({ runId: 'run-001', leaseId: first.leaseId, ownerId: 'renderer-a' }).ok, true);
    assert.equal(resources.snapshot().activeCount, 0);
  });

  test('renderer 销毁只释放自己的 Run；转交后新 owner 可取得', () => {
    const { owners } = specimen();
    owners.acquire({ runId: 'run-a', taskId: 'task-a', ownerId: 'renderer-a' });
    owners.acquire({ runId: 'run-b', taskId: 'task-b', ownerId: 'renderer-b' });
    assert.equal(owners.releaseOwner('renderer-a', 'renderer-destroyed'), 1);
    assert.equal(owners.healthSnapshot().activeOwners, 1);
    assert.equal(owners.acquire({ runId: 'run-a', taskId: 'task-a', ownerId: 'renderer-b' }).ok, true);
    assert.equal(owners.destroy('app-quit'), 2);
    assert.equal(owners.healthSnapshot().activeOwners, 0);
  });

  test('20 轮 acquire/block/release/transfer 后 ResourceLedger 回到零基线', () => {
    const { owners, resources } = specimen();
    for (let index = 0; index < 20; index++) {
      const runId = `run-soak-${String(index + 1).padStart(2, '0')}`;
      const first = owners.acquire({ runId, taskId: `task-${index}`, ownerId: 'renderer-a' });
      assert.equal(owners.acquire({ runId, taskId: `task-${index}`, ownerId: 'renderer-b' }).code, 'RUN_OWNER_ACTIVE');
      assert.equal(owners.release({ runId, leaseId: first.leaseId, ownerId: 'renderer-a', reason: 'window-close' }).ok, true);
      const transferred = owners.acquire({ runId, taskId: `task-${index}`, ownerId: 'renderer-b' });
      assert.equal(transferred.ok, true);
      assert.equal(owners.release({ runId, leaseId: transferred.leaseId, ownerId: 'renderer-b', reason: 'task-settled' }).ok, true);
      assert.equal(owners.healthSnapshot().activeOwners, 0);
      assert.equal(resources.snapshot().activeCount, 0);
    }
    assert.equal(resources.snapshot({ includeReleased: true }).released.length, 40);
  });
});
