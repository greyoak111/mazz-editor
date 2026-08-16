// tests/contract/w71-monaco-lifecycle.test.mjs —— Monaco/Code 宿主生命周期与 packaged worker Gate
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W71 Monaco / Code 生命周期契约', () => {
  test('Code 模块实现幂等宿主退役并清空编辑器、模型、DOM 与活动锚点', () => {
    const code = read('renderer/modules/code/index.js');
    assert.ok(code.includes('dispose(state)'));
    assert.ok(code.includes('if (!ctl || ctl.disposed) return'));
    assert.ok(code.includes('ctl.editor?.dispose?.()'));
    assert.ok(code.includes('ctl.model?.dispose?.()'));
    assert.ok(code.includes('ctl.themeObserver?.disconnect?.()'));
    assert.ok(code.includes('instances.delete(state.container)'));
    assert.ok(code.includes('window.__activeCodeCtl = null'));
  });

  test('Monaco 迟到初始化、内容轮询和拖拽全局监听都受 disposed owner 约束', () => {
    const code = read('renderer/modules/code/index.js');
    assert.match(code, /const monaco = await getMonaco\(\);\s+if \(ctl\.disposed\) return/);
    assert.ok(code.includes('ctl.pendingTextTimer = setInterval'));
    assert.ok(code.includes('clearInterval(ctl.pendingTextTimer)'));
    assert.ok(code.includes('ctl.cancelGripDrag?.()'));
    assert.ok(code.includes("window.removeEventListener('pointermove', move)"));
  });

  test('TerminalPanel 对称摘除 IPC listener，销毁全部 PTY，并封堵异步 create 迟到', () => {
    const terminal = read('renderer/modules/code/terminal-view.js');
    assert.ok(terminal.includes('this.eventUnsubscribers.push'));
    assert.ok(terminal.includes('if (this.disposed)'));
    assert.ok(terminal.includes("window.mazz.invoke('term:kill', { id: res.id || id })"));
    assert.ok(terminal.includes('for (const id of [...this.terms.keys()]) this.kill(id)'));
    assert.ok(terminal.includes('unsubscribe?.()'));
  });

  test('DebugService 对称退役 gutter timer、Monaco disposable、IPC listener 与活跃 DAP', () => {
    const debug = read('renderer/modules/code/debug.js');
    assert.ok(debug.includes('this.eventUnsubscribe = window.mazz.on'));
    assert.ok(debug.includes('clearInterval(this.gutterTimer)'));
    assert.ok(debug.includes('disposable?.dispose?.()'));
    assert.ok(debug.includes("window.mazz?.invoke('debug:stop')"));
    assert.ok(debug.includes('this.panel?.remove()'));
    assert.ok(debug.includes("event === 'terminated'"));
  });

  test('Monaco Worker 记录真实创建、错误和 terminate，不把文件存在冒充运行', () => {
    const setup = read('renderer/modules/code/monaco-setup.js');
    assert.ok(setup.includes('getMonacoWorkerDiagnostics'));
    assert.ok(setup.includes('workerDiagnostics.created += 1'));
    assert.ok(setup.includes("worker.addEventListener('error'"));
    assert.ok(setup.includes('workerDiagnostics.terminated += 1'));
    assert.ok(setup.includes("name: `mazz-monaco-${label || 'editor'}`"));
  });
});
