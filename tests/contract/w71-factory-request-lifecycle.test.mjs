// tests/contract/w71-factory-request-lifecycle.test.mjs —— Factory renderer/main 取消协议与任务隔离
import './_setup.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const cfg = { baseURL: 'https://factory.invalid', apiKey: 'test-key', model: 'test-model' };

function installElectronBridge() {
  const listeners = new Set();
  const pending = new Map();
  const calls = [];
  window.mazz = {
    isElectron: true,
    on(channel, callback) {
      assert.equal(channel, 'factory:aiChunk');
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    invoke(channel, payload = {}) {
      calls.push({ channel, payload });
      if (channel === 'factory:aiChatStream' || channel === 'factory:aiChat') {
        return new Promise(resolve => pending.set(payload.requestId, resolve));
      }
      if (channel === 'factory:aiCancel') {
        pending.get(payload.requestId)?.({ ok: false, cancelled: true });
        pending.delete(payload.requestId);
        return Promise.resolve({ cancelled: true });
      }
      return Promise.resolve(null);
    },
  };
  return {
    calls,
    listeners,
    emit(payload) { for (const callback of [...listeners]) callback(payload); },
  };
}

const provider = await import('../../renderer/modules/factory/provider.js');

describe('W71 Factory AI renderer 取消协议', () => {
  test('连续 20 次外部 abort 都会通知主进程并摘除 aiChunk listener', async () => {
    const bridge = installElectronBridge();
    for (let index = 0; index < 20; index++) {
      const controller = new AbortController();
      const result = provider.chatStream({ cfg, user: `task-${index}`, signal: controller.signal });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(bridge.listeners.size, 1, `第 ${index + 1} 次监听未挂载`);
      controller.abort();
      assert.equal(await result, '');
      assert.equal(bridge.listeners.size, 0, `第 ${index + 1} 次监听未摘除`);
    }
    assert.equal(bridge.calls.filter(call => call.channel === 'factory:aiCancel').length, 20);
  });

  test('停止轮询不再依赖下一枚 SSE 分片，已收正文以半稿返回给断点逻辑', async () => {
    const bridge = installElectronBridge();
    let stopped = false;
    const result = provider.chatStream({ cfg, user: 'stalled-stream', shouldStop: () => stopped });
    await new Promise(resolve => setImmediate(resolve));
    const requestId = bridge.calls.find(call => call.channel === 'factory:aiChatStream').payload.requestId;
    bridge.emit({ requestId, delta: '已生成片段' });
    stopped = true;
    assert.equal(await result, '已生成片段');
    assert.equal(bridge.listeners.size, 0);
    assert.ok(bridge.calls.some(call => call.channel === 'factory:aiCancel' && call.payload.requestId === requestId));
  });

  test('非流式请求也接受 task signal，abort 后不会滞留 IPC Promise', async () => {
    const bridge = installElectronBridge();
    const controller = new AbortController();
    const result = provider.chat({ cfg, user: 'review-step', signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(() => result, error => error?.name === 'AbortError');
    assert.equal(bridge.calls.filter(call => call.channel === 'factory:aiCancel').length, 1);
  });
});

describe('W71 Factory AI 跨进程与任务 owner 契约', () => {
  test('preload 白名单、主进程注册表、超时与退出收尸形成闭环', () => {
    const preload = read('preload/bridge.js');
    const main = read('main/main.js');
    assert.ok(preload.includes("'factory:aiCancel'"));
    assert.ok(main.includes("bus.handle('factory:aiCancel'"));
    assert.match(main, /kind: 'stream', timeoutMs: 300000/);
    assert.match(main, /kind: 'chat', timeoutMs: 180000/);
    assert.ok(main.includes("factoryAiRequests.destroy('app-quit')"));
    assert.ok(main.includes('factoryAiRequests.cancelOwner(ownerId)'));
    assert.ok(main.includes("sender.once('destroyed'"));
    assert.ok(main.includes('req.attachReader(reader)'));
  });

  test('FactoryPanel 以 taskId 隔离 AbortController，单任务暂停不再污染整批', () => {
    const panel = read('renderer/modules/factory/index.js');
    assert.ok(panel.includes('this.taskControllers = new Map()'));
    assert.ok(panel.includes("this.abortTask(taskId, 'task-paused')"));
    assert.equal(/patch\.status === 'paused'[^{\n]*this\.stopRequested = true/.test(panel), false);
    assert.ok(panel.includes('signal: this.taskSignal(task)'));
    assert.ok(panel.includes('未把流式半稿冒充成正式成稿'));
    assert.ok(panel.includes("window.removeEventListener('mazz:factory-task-updated'"));
  });

  test('W68 正文改稿转补遗后，编辑窗切换到真实新路径供后续保存', () => {
    const editor = read('renderer/panels/fedit.html');
    assert.ok(editor.includes('filePath = p.path || filePath'));
    assert.ok(editor.includes('document.body.dataset.path = filePath'));
    assert.ok(editor.includes("$('#path').textContent = filePath"));
  });
});
