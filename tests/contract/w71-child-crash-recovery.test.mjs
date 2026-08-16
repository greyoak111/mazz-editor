import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const CrashRecovery = require('../../main/crash-recovery.js');
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

describe('W71 child renderer crash recovery', () => {
  test('局部崩溃凭证只允许原 child WebContents 一次消费', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-child-crash-contract-'));
    const handlers = new Map();
    const appEvents = new Map();
    const app = {
      getPath: () => dir,
      on: (name, fn) => {
        const list = appEvents.get(name) || [];
        list.push(fn);
        appEvents.set(name, list);
      },
    };
    const bus = { handle: (name, fn) => handlers.set(name, fn) };
    new CrashRecovery({ app, bus });
    const child = { id: 22, getURL: () => 'mazz-res://app/index.html?role=child', once: () => {} };
    try {
      await handlers.get('snapshot:write')({
        tabId: 'tab-1', title: '脏稿', filePath: 'D:/x.md', moduleId: 'markdown', content: 'child',
        dirty: true, pinned: true, progress: { from: 2, to: 6 },
      }, { sender: child });
      await handlers.get('snapshot:write')({
        tabId: 'tab-1', title: '主窗', filePath: 'D:/main.md', moduleId: 'markdown', content: 'main', dirty: true,
      }, { sender: { id: 11 } });
      for (const fn of appEvents.get('render-process-gone') || []) fn({}, child, { reason: 'crashed' });

      const wrong = await handlers.get('crash:consumeRendererRecovery')({}, { sender: { id: 11 } });
      assert.deepEqual(wrong, { crashed: false, snapshots: [] });
      const owned = await handlers.get('crash:consumeRendererRecovery')({}, { sender: child });
      assert.equal(owned.crashed, true);
      assert.equal(owned.snapshots.length, 1);
      assert.deepEqual(owned.snapshots[0].progress, { from: 2, to: 6 });
      assert.equal(owned.snapshots[0].dirty, true);
      assert.equal(owned.snapshots[0].pinned, true);
      const consumed = await handlers.get('crash:consumeRendererRecovery')({}, { sender: child });
      assert.deepEqual(consumed, { crashed: false, snapshots: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('恢复后只清当前 owner 的旧 tabId，不碰新标签或其他窗口', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-child-prune-contract-'));
    const handlers = new Map();
    const app = { getPath: () => dir, on: () => {} };
    const bus = { handle: (name, fn) => handlers.set(name, fn) };
    new CrashRecovery({ app, bus });
    try {
      const childEvent = { sender: { id: 22 } };
      await handlers.get('snapshot:write')({ tabId: 'tab-7', moduleId: 'markdown', content: 'old' }, childEvent);
      await handlers.get('snapshot:write')({ tabId: 'tab-1', moduleId: 'markdown', content: 'new' }, childEvent);
      await handlers.get('snapshot:write')({ tabId: 'tab-7', moduleId: 'markdown', content: 'other' }, { sender: { id: 11 } });
      const removed = await handlers.get('snapshot:pruneOwned')({
        removeTabIds: ['tab-7'], keepTabIds: ['tab-1'],
      }, childEvent);
      assert.equal(removed, 1);
      const records = await handlers.get('snapshot:list')();
      assert.equal(records.length, 2);
      assert.ok(records.some(x => x.ownerId.endsWith(':22') && x.tabId === 'tab-1'));
      assert.ok(records.some(x => x.ownerId.endsWith(':11') && x.tabId === 'tab-7'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('renderer 只在 child crash 凭证存在时自动恢复，并保留状态字段', () => {
    const snapshots = read('renderer/core/snapshot-service.js');
    const shell = read('renderer/shell/shell.js');
    const app = read('renderer/app.js');
    assert.ok(snapshots.includes("role === 'child'"));
    assert.ok(snapshots.includes("invoke('crash:consumeRendererRecovery')"));
    assert.ok(snapshots.includes("reason: 'renderer-crash'"));
    assert.ok(shell.includes('snapshotPayload(tab, inst'));
    for (const field of ['dirty: !!tab?.dirty', 'pinned: !!tab?.pinned', 'progress: typeof inst?.def?.captureProgress']) {
      assert.ok(shell.includes(field), `恢复快照缺少 ${field}`);
    }
    assert.ok(shell.includes('await snapshots.pruneRecovered(restoredOldIds, restoredNewIds)'));
    assert.ok(shell.includes(".replace(/(?:（已恢复）)+$/, '') + '（已恢复）'"), '重复崩溃不得累加恢复后缀');
    assert.ok(app.includes("contextKeys.set('windowRole', startupWindowRole)"), 'reload 首帧必须从 URL 确认 child 身份');
  });
});
