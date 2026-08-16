// tests/contract/w71-external-change.test.mjs —— W71 外部文件变化单一状态机
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import {
  ExternalChangeService,
  externalChangeDecision,
  fileSignature,
  normalizeChangePath,
} from '../../renderer/core/external-change-service.js';

describe('W71 外部文件变化状态机', () => {
  test('删除 / 自写回声 / 干净重载 / 脏冲突互斥', () => {
    assert.equal(externalChangeDecision({ event: 'unlink', dirty: true }), 'delete');
    assert.equal(externalChangeDecision({ event: 'change', selfWrite: true, dirty: true }), 'self-write');
    assert.equal(externalChangeDecision({ event: 'change', dirty: false }), 'reload');
    assert.equal(externalChangeDecision({ event: 'change', dirty: true }), 'conflict');
    assert.equal(externalChangeDecision({ event: 'chmod' }), 'ignore');
  });

  test('Windows 路径与文件指纹稳定；自写只压匹配回声', () => {
    let now = 100;
    const scheduled = [];
    const service = new ExternalChangeService({
      now: () => now,
      ownWriteTtl: 50,
      setTimer: fn => { scheduled.push(fn); return { id: scheduled.length }; },
      clearTimer: () => {},
    });
    const stat = { exists: true, size: 12, mtime: 88.5 };
    assert.equal(normalizeChangePath('C:\\Work\\A.md'), 'c:/work/a.md');
    assert.equal(fileSignature(stat), '12:88.5');
    assert.equal(service.markOwnWrite('C:/WORK/A.md', stat), true);
    assert.equal(service.isOwnWrite('c:\\work\\a.md', stat), true);
    assert.equal(service.isOwnWrite('C:/work/a.md', { ...stat, mtime: 89 }), false, '外部新版本不得被自写标记吞掉');
    now = 151;
    assert.equal(service.isOwnWrite('C:/work/a.md', stat), false, '过期标记不得继续吞事件');
    service.dispose();
  });

  test('同一标签的变化事件防抖为一次决策', async () => {
    const queued = [];
    const cleared = new Set();
    const service = new ExternalChangeService({
      setTimer: fn => { const token = { fn }; queued.push(token); return token; },
      clearTimer: token => cleared.add(token),
    });
    const calls = [];
    service.schedule('tab-1', () => calls.push('old'));
    service.schedule('tab-1', () => calls.push('new'));
    for (const token of queued) if (!cleared.has(token)) await token.fn();
    assert.deepEqual(calls, ['new']);
    service.dispose();
  });

  test('fs:watch IPC 等待 chokidar ready 后才确认监听完成', () => {
    const source = fs.readFileSync(new URL('../../main/file-watcher.js', import.meta.url), 'utf8');
    const manager = fs.readFileSync(new URL('../../main/window-manager.js', import.meta.url), 'utf8');
    const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
    assert.ok(source.includes("watcher.once('ready', finish)"), '必须以真实 ready 事件形成确认点');
    assert.ok((source.match(/await this\.readyPromise/g) || []).length >= 3, '新建、重复根和追加根都必须等待初始 ready');
    assert.ok(source.includes('this._finishReady?.();'), 'ready 前关闭必须立即结算等待状态');
    assert.ok(source.includes('if (this._readyTimer) clearTimeout(this._readyTimer)'), 'ready/close 后不得残留十秒兜底 timer');
    assert.ok(manager.includes('broadcastShells(channel, payload)'), '工作台壳必须有主窗+分窗定向广播协议');
    assert.ok(manager.includes("win.on('enter-full-screen'") && manager.includes("win.on('leave-full-screen'"), '主窗与分窗必须各自回传全屏状态');
    assert.ok(source.includes("this.wm.broadcastShells('file:changed'"), 'watcher 外改必须抵达全部工作台壳');
    assert.equal((main.match(/broadcastShells\('file:changed'/g) || []).length, 2, '确定性删除与快记写入同样必须抵达分窗');
    for (const channel of ['window:isFullScreen', 'window:setTitle', 'window:isMaximized', 'window:toggleFullScreen']) {
      const start = main.indexOf(`bus.handle('${channel}'`);
      assert.ok(start >= 0 && main.slice(start, start + 260).includes('callerWin(event)'), `${channel} 必须按 IPC 调用者归属`);
    }
  });

  test('Shell 只有一条 file:changed 决策入口，另存为成功后才换路径', () => {
    const source = fs.readFileSync(new URL('../../renderer/shell/shell.js', import.meta.url), 'utf8');
    assert.equal((source.match(/window\.mazz\.on\('file:changed'/g) || []).length, 1, 'Shell 不得同时自动重载和另弹重载提示');
    assert.ok(source.includes('this.handleExternalFileChanged(payload)'), '外部变化必须进入单一处理器');
    assert.ok(source.includes("externalChangeDecision({ event, dirty: current.dirty })"), '脏/净状态必须统一判定');
    const saveStart = source.indexOf('async saveTab(tab');
    const saveEnd = source.indexOf('/** 关闭指定路径', saveStart);
    const saveBody = source.slice(saveStart, saveEnd);
    assert.ok(saveBody.indexOf('catch (e) { toast(`保存失败') < saveBody.indexOf('tab.filePath = target'), '另存为写入失败前不得改标签路径');
    assert.ok(saveBody.includes('this.externalChanges.markOwnWrite(target, signature)'), '自保存必须登记可核对指纹');
  });
});
