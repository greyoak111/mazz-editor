// tests/contract/w71-core-module-recovery.test.mjs —— representative serializable-module recovery gate contract
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const root = path.resolve('.');
const shell = fs.readFileSync(path.join(root, 'renderer/shell/shell.js'), 'utf8');
const e2e = fs.readFileSync(path.join(root, 'tests/e2e/w71-core-module-crash-recovery.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('W71 representative serializable-module crash recovery', () => {
  test('快照与交接契约保全内容、脏态、钉住态和模块身份', () => {
    for (const token of [
      'moduleId: inst?.name || tab?.moduleId',
      'content: safeGet(() => inst?.def?.getContent(inst.state))',
      'dirty: !!tab?.dirty',
      'pinned: !!tab?.pinned',
      'content: snapshot.content',
      'if (snapshot.pinned)',
      'if (snapshot.dirty)',
    ]) assert.ok(shell.includes(token), `恢复契约缺少：${token}`);
  });

  test('packaged gate 固定覆盖六种互异的正式内容编辑器', () => {
    const required = ['text', 'code', 'sheet', 'slide', 'mindmap', 'draw'];
    for (const moduleId of required) {
      assert.ok(e2e.includes(`moduleId: '${moduleId}'`), `门禁缺少 ${moduleId}`);
    }
    assert.equal(new Set(required).size, 6);
    assert.equal(pkg.scripts['test:w71:core-module-crash'], 'node tests/e2e/w71-core-module-crash-recovery.mjs');
  });

  test('门禁使用整棵进程强杀并区分事故批次与当前未保存稿', () => {
    for (const token of [
      "execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F']",
      "waitForSelector('.recovery-bar'",
      "window.mazz.invoke('snapshot:clearAll')",
      'currentUnsavedSnapshotsExplicitlyDiscardedForCleanRestartCheck: true',
      'cleanRestartHasNoOffer: true',
    ]) assert.ok(e2e.includes(token), `门禁缺少事故/清理语义：${token}`);
  });

  test('完整主义扩展保留为远期，不能冒充本轮 Hard Gate', () => {
    for (const deferred of [
      'original-window-pane-focus-order topology restoration',
      'all-module/all-combination exhaustive recovery',
      'notes/library/viewer runtime-reference recovery matrix',
    ]) assert.ok(e2e.includes(deferred), `缺少远期保留项：${deferred}`);
  });
});
