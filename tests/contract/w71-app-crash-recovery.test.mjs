import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const CrashRecovery = require('../../main/crash-recovery.js');

const makeApp = dir => {
  const events = new Map();
  return {
    events,
    app: {
      getPath: () => dir,
      on: (name, fn) => {
        const list = events.get(name) || [];
        list.push(fn);
        events.set(name, list);
      },
    },
  };
};

const makeRecovery = dir => {
  const { app, events } = makeApp(dir);
  const handlers = new Map();
  new CrashRecovery({ app, bus: { handle: (name, fn) => handlers.set(name, fn) } });
  return { handlers, events };
};

const mainSender = id => ({
  id,
  getURL: () => 'mazz-res://app/index.html',
});

describe('W71 whole-app crash recovery ownership', () => {
  test('启动前事故快照与本轮新快照隔离，恢复后只删除已消费旧件', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-app-crash-contract-'));
    const snapshots = path.join(dir, 'snapshots');
    fs.mkdirSync(snapshots, { recursive: true });
    fs.writeFileSync(path.join(snapshots, 'RUNNING.flag'), JSON.stringify({ runId: 'crashed-run' }));
    fs.writeFileSync(path.join(snapshots, 'old.json'), JSON.stringify({
      tabId: 'tab-1', ownerId: 'crashed-run:1', title: '旧脏稿', filePath: 'D:/old.md',
      moduleId: 'markdown', content: 'old', dirty: true, pinned: true, progress: { from: 2, to: 5 }, savedAt: 1,
    }));
    fs.writeFileSync(path.join(snapshots, 'stale.json'), JSON.stringify({
      tabId: 'tab-8', ownerId: 'older-clean-run:1', filePath: 'D:/stale.md',
      moduleId: 'markdown', content: 'stale', dirty: true, savedAt: 999,
    }));
    const { handlers } = makeRecovery(dir);
    const event = { sender: mainSender(11) };
    try {
      const first = await handlers.get('crash:consumeAppRecovery')({}, event);
      assert.equal(first.reason, 'app-unclean');
      assert.equal(first.snapshots.length, 1);
      assert.equal(first.snapshots[0].content, 'old', '必须按 RUNNING.flag 的 runId 取事故批次，不能误取更晚的旧历史');
      assert.ok(first.snapshots[0].recoveryId);
      await handlers.get('snapshot:write')({
        tabId: 'tab-9', moduleId: 'markdown', content: 'new', dirty: true,
      }, event);
      const repeated = await handlers.get('crash:consumeAppRecovery')({}, event);
      assert.deepEqual(repeated.snapshots, first.snapshots, 'renderer reload 前不得把本轮快照混进事故批次');
      const done = await handlers.get('crash:finalizeAppRecovery')({
        recoveryIds: [first.snapshots[0].recoveryId],
      }, event);
      assert.deepEqual(done, { removed: 1, remaining: 0 });
      const records = await handlers.get('snapshot:list')();
      assert.equal(records.length, 2);
      assert.ok(records.some(record => record.content === 'new'));
      assert.ok(records.some(record => record.content === 'stale'));
      assert.equal(fs.existsSync(path.join(snapshots, 'RECOVERY_PENDING.flag')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('未作决定就正常退出时，pending 标记使下一轮继续提供事故材料', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-app-pending-contract-'));
    const snapshots = path.join(dir, 'snapshots');
    fs.mkdirSync(snapshots, { recursive: true });
    fs.writeFileSync(path.join(snapshots, 'RUNNING.flag'), JSON.stringify({ runId: 'old-run' }));
    fs.writeFileSync(path.join(snapshots, 'old.json'), JSON.stringify({
      tabId: 'tab-1', ownerId: 'old-run:1', filePath: 'D:/old.md', moduleId: 'markdown', content: 'old', savedAt: 1,
    }));
    try {
      const first = makeRecovery(dir);
      const offer = await first.handlers.get('crash:consumeAppRecovery')({}, { sender: mainSender(11) });
      assert.equal(offer.snapshots.length, 1);
      for (const fn of first.events.get('will-quit') || []) fn();
      assert.equal(fs.existsSync(path.join(snapshots, 'RUNNING.flag')), false);
      assert.equal(fs.existsSync(path.join(snapshots, 'RECOVERY_PENDING.flag')), true);

      const second = makeRecovery(dir);
      const repeated = await second.handlers.get('crash:consumeAppRecovery')({}, { sender: mainSender(12) });
      assert.equal(repeated.reason, 'app-unclean');
      assert.equal(repeated.snapshots.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('child 或其他页面不能消费和完成整应用恢复批次', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-app-owner-contract-'));
    const snapshots = path.join(dir, 'snapshots');
    fs.mkdirSync(snapshots, { recursive: true });
    fs.writeFileSync(path.join(snapshots, 'RUNNING.flag'), JSON.stringify({ runId: 'old-run' }));
    fs.writeFileSync(path.join(snapshots, 'old.json'), JSON.stringify({
      tabId: 'tab-1', ownerId: 'old-run:1', moduleId: 'markdown', content: 'x', savedAt: 1,
    }));
    const { handlers } = makeRecovery(dir);
    try {
      const child = { sender: { id: 22, getURL: () => 'mazz-res://app/index.html?role=child' } };
      assert.deepEqual(await handlers.get('crash:consumeAppRecovery')({}, child), { reason: null, snapshots: [] });
      assert.deepEqual(await handlers.get('crash:finalizeAppRecovery')({ discardAll: true }, child), { removed: 0, remaining: 0 });
      const panel = { sender: { id: 33, getURL: () => 'mazz-res://app/panel.html' } };
      assert.deepEqual(await handlers.get('crash:consumeAppRecovery')({}, panel), { reason: null, snapshots: [] });
      const main = { sender: mainSender(11) };
      const offer = await handlers.get('crash:consumeAppRecovery')({}, main);
      assert.equal(offer.snapshots.length, 1);
      const ignored = await handlers.get('crash:finalizeAppRecovery')({ discardAll: true }, main);
      assert.deepEqual(ignored, { removed: 1, remaining: 0 });
      assert.equal(fs.existsSync(path.join(snapshots, 'RECOVERY_PENDING.flag')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
