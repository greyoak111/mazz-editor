import './_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { modules } from '../../renderer/core/module-registry.js';
import { assertNativeOpenContent, assertOfficeContainer } from '../../renderer/lib/file-open-policy.js';

const root = path.resolve('.');
const shell = fs.readFileSync(path.join(root, 'renderer/shell/shell.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload/bridge.js'), 'utf8');

const fakeModule = setContent => ({
  create: () => ({}), activate: () => {}, deactivate: () => {}, dispose: () => {},
  getContent: () => '', setContent, newDocument: () => {},
});

describe('W71 文件打开成功语义', () => {
  test('模块实例 readiness 收敛异步成功与失败且不产生未处理拒绝', async () => {
    modules.register('w71-ready-ok', fakeModule(async () => 'ok'));
    modules.register('w71-ready-fail', fakeModule(async () => { throw new Error('damaged'); }));
    assert.deepEqual(await modules.attach('w71-ok', 'w71-ready-ok', {}, 'payload').ready, { ok: true, error: null });
    const failed = await modules.attach('w71-fail', 'w71-ready-fail', {}, 'payload').ready;
    assert.equal(failed.ok, false);
    assert.match(failed.error.message, /damaged/);
    modules.detach('w71-ok');
    modules.detach('w71-fail');
  });

  test('失败导入必须先撤签，不能登记 recent/watch 或回报成功', () => {
    for (const token of [
      'const loaded = await inst.ready',
      'await this.discardFailedOpen(tab)',
      "await window.mazz?.invoke('recent:add'",
      "await window.mazz?.invoke('fs:watch'",
      'modules.instances.get(tab.id) !== inst',
    ]) assert.ok(shell.includes(token), `打开链缺少：${token}`);
    assert.ok(shell.indexOf('const loaded = await inst.ready') < shell.lastIndexOf("await window.mazz?.invoke('recent:add'"));
    assert.ok(shell.includes('const bookId = await libInst?.def.importPath?.'));
    assert.ok(shell.includes('if (!bookId)'));
  });

  test('轻量文件探针经过主进程与 preload 白名单，未知二进制不得落入文本编辑器', () => {
    assert.ok(main.includes("bus.handle('fs:probeFile'"));
    assert.ok(preload.includes("'fs:probeFile'"));
    assert.ok(shell.includes("probe.kind === 'binary'"));
    assert.ok(shell.includes("probe.kind === 'unsupported-encoding'"));
    assert.ok(shell.includes('DIRECT_OPEN_EXTENSIONS'));
  });

  test('专用本地格式损坏时拒绝，不回退成空白画板或 CSV', () => {
    assert.throws(() => assertNativeOpenContent('mazzsheet', '{bad'), /损坏|不完整/);
    assert.throws(() => assertNativeOpenContent('mazzsheet', JSON.stringify({ mark: 'wrong', sheets: [] })), /标识|结构/);
    assert.throws(() => assertNativeOpenContent('mazzdraw', JSON.stringify({ frames: [] })), /画帧/);
    assert.equal(assertNativeOpenContent('mazzdraw', JSON.stringify({ frames: [{}] })), true);
    assert.equal(assertNativeOpenContent('txt', 'anything'), true);
  });

  test('Office 二进制先验明 Open XML 容器，任意字节不能被表格解析器误认成功', () => {
    assert.throws(() => assertOfficeContainer('xlsx', new Uint8Array([1, 2, 3, 4])), /Open XML|损坏/);
    assert.equal(assertOfficeContainer('docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04])), true);
    assert.equal(assertOfficeContainer('txt', new Uint8Array([1])), true);
  });

  test('磁盘重载也等待异步解析完成，失败不清除现有脏态', () => {
    assert.ok(shell.includes('await inst.def.setContent(content, inst.state)'));
    assert.ok(shell.indexOf('await inst.def.setContent(content, inst.state)') < shell.indexOf('owner?.tabs.setDirty(tab.id, false)'));
  });
});
