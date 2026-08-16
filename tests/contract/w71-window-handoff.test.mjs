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

describe('W71 多窗口标签交接', () => {
  test('主进程只在目标 renderer 确认收讫后提交迁移', () => {
    const main = read('main/main.js');
    assert.ok(main.includes("bus.handle('window:handoffAck'"));
    assert.ok(main.includes('pending.targetId !== event?.sender?.id'), 'ACK 必须校验目标 WebContents owner');
    assert.ok(main.includes('timer = setTimeout(() => finish(false), 12000)'), '交接必须有确定 timeout');
    assert.ok(main.includes("target.webContents.once('render-process-gone', onGone)"), '目标 renderer 崩溃必须判交接失败');
    assert.ok(main.includes('return deliverHandoff(child, handoff)'), '已有子窗必须等待 ACK');
    assert.ok(main.includes('return deliverHandoff(wm.main, handoff)'), '移回主窗必须等待 ACK');
  });

  test('renderer 交接保留内容、dirty、pinned 与进度，并在 ACK 前落恢复材料', () => {
    const shell = read('renderer/shell/shell.js');
    for (const field of ['dirty: !!tab.dirty', 'pinned: !!tab.pinned', 'progress,']) {
      assert.ok(shell.includes(field), `handoff 缺少 ${field}`);
    }
    assert.ok(shell.includes('await snapshots.writeOne(tab.id)'), '脏稿必须在 ACK 前落新 owner 快照');
    assert.ok(shell.includes("window.mazz.invoke('window:handoffAck'"), '目标 renderer 必须显式 ACK');
    assert.ok(shell.includes("if (!ok) throw new Error('目标窗口未确认接收')"), '新子窗未 ACK 时源标签不得关闭');
  });

  test('同名 tabId 的多 renderer 快照互不覆盖、互不误删', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-snapshot-owner-'));
    const handlers = new Map();
    const app = { getPath: () => dir, on: () => {} };
    const bus = { handle: (name, fn) => handlers.set(name, fn) };
    new CrashRecovery({ app, bus });
    const write = handlers.get('snapshot:write');
    const list = handlers.get('snapshot:list');
    const clear = handlers.get('snapshot:clear');
    try {
      await write({ tabId: 'tab-1', moduleId: 'markdown', content: 'main' }, { sender: { id: 11 } });
      await write({ tabId: 'tab-1', moduleId: 'markdown', content: 'child' }, { sender: { id: 22 } });
      const both = await list();
      assert.equal(both.length, 2);
      assert.ok(both.some(x => x.ownerId.endsWith(':11')));
      assert.ok(both.some(x => x.ownerId.endsWith(':22')));
      await clear({ tabId: 'tab-1' }, { sender: { id: 11 } });
      const remaining = await list();
      assert.equal(remaining.length, 1);
      assert.ok(remaining[0].ownerId.endsWith(':22'));
      assert.equal(remaining[0].content, 'child');
      const nextHandlers = new Map();
      new CrashRecovery({ app, bus: { handle: (name, fn) => nextHandlers.set(name, fn) } });
      await nextHandlers.get('snapshot:write')(
        { tabId: 'tab-1', moduleId: 'markdown', content: 'next-run' },
        { sender: { id: 22 } },
      );
      const crossRun = await nextHandlers.get('snapshot:list')();
      assert.equal(crossRun.length, 2, '新进程复用 WebContents/tabId 也不得覆盖旧恢复材料');
      assert.equal(new Set(crossRun.map(x => x.ownerId)).size, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
