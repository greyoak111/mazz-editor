// tests/unit/core.test.mjs —— 系统层核心逻辑单元测试
import { describe, test, assert } from '../harness.mjs';
import { contextKeys } from '../../renderer/core/contextkey-service.js';
import { commands } from '../../renderer/core/command-registry.js';
import { normalizeKeyString, normalizeKeyEvent, displayKey, keymap } from '../../renderer/core/keymap-service.js';
import { fuzzyScore } from '../../renderer/core/command-palette.js';

describe('上下文键服务（when 表达式）', () => {
  test('裸标识符取真值', () => {
    contextKeys.set('hasSelection', true);
    assert.equal(contextKeys.evaluate('hasSelection'), true);
    contextKeys.set('hasSelection', false);
    assert.equal(contextKeys.evaluate('hasSelection'), false);
  });
  test('== 与 != 比较', () => {
    contextKeys.set('module', 'markdown');
    assert.equal(contextKeys.evaluate("module=='markdown'"), true);
    assert.equal(contextKeys.evaluate("module=='text'"), false);
    assert.equal(contextKeys.evaluate("module!='text'"), true);
  });
  test('&& / || / ! / 括号', () => {
    contextKeys.set('module', 'markdown');
    contextKeys.set('hasSelection', true);
    assert.equal(contextKeys.evaluate("module=='markdown' && hasSelection"), true);
    assert.equal(contextKeys.evaluate("module=='text' || hasSelection"), true);
    assert.equal(contextKeys.evaluate("!hasSelection"), false);
    assert.equal(contextKeys.evaluate("(module=='text' || module=='markdown') && hasSelection"), true);
  });
  test('空表达式恒真；非法表达式返回 false', () => {
    assert.equal(contextKeys.evaluate(''), true);
    assert.equal(contextKeys.evaluate(null), true);
    assert.equal(contextKeys.evaluate('module==='), false);
  });
});

describe('命令注册表', () => {
  test('注册与执行', async () => {
    let hit = 0;
    commands.register('test.inc', { title: '递增', run: () => { hit++; return 42; }, source: 'test' });
    const r = await commands.execute('test.inc');
    assert.equal(r, 42);
    assert.equal(hit, 1);
    commands.unregisterBySource('test');
  });
  test('跨来源重复注册视为冲突', () => {
    commands.register('test.dup', { title: 'A', run: () => {}, source: 'a' });
    const ok = commands.register('test.dup', { title: 'B', run: () => {}, source: 'b' });
    assert.equal(ok, false);
    commands.unregisterBySource('a');
    commands.unregisterBySource('b');
  });
  test('when 不满足时拒绝执行', async () => {
    let hit = 0;
    contextKeys.set('never', false);
    commands.register('test.gated', { title: 'G', run: () => { hit++; }, when: 'never', source: 'test' });
    await commands.execute('test.gated');
    assert.equal(hit, 0);
    commands.unregisterBySource('test');
  });
});

describe('快捷键服务', () => {
  test('键位字符串规范化（修饰键排序）', () => {
    assert.equal(normalizeKeyString('Shift+Ctrl+P'), normalizeKeyString('ctrl+shift+p'));
    assert.equal(normalizeKeyString('CmdOrCtrl+S'), normalizeKeyString('ctrl+s'));
  });
  test('键盘事件规范化', () => {
    const norm = normalizeKeyEvent({ key: 'P', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
    assert.equal(norm, normalizeKeyString('ctrl+shift+p'));
  });
  test('resolve 走 when 表达式；覆盖层优先并可屏蔽', () => {
    keymap.register({ key: 'ctrl+t', command: 'browser.newTab', when: "module=='browser'", source: 'test' });
    keymap.register({ key: 'ctrl+t', command: 'other.thing', when: "module=='text'", source: 'test' });
    contextKeys.set('module', 'browser');
    assert.equal(keymap.resolve(normalizeKeyString('ctrl+t')), 'browser.newTab');
    contextKeys.set('module', 'markdown');
    assert.equal(keymap.resolve(normalizeKeyString('ctrl+t')), undefined);
    keymap.setOverlay([{ key: 'ctrl+t', command: 'user.custom' }]);
    contextKeys.set('module', 'browser');
    assert.equal(keymap.resolve(normalizeKeyString('ctrl+t')), 'user.custom');
    keymap.setOverlay([{ key: 'ctrl+t', command: '-browser.newTab' }]);
    assert.equal(keymap.resolve(normalizeKeyString('ctrl+t')), null);
    keymap.setOverlay([]);
    keymap.unregisterBySource('test');
  });
  test('冲突自动检测', () => {
    keymap.conflicts.length = 0;
    keymap.register({ key: 'ctrl+q', command: 'a.x', source: 'test' });
    keymap.register({ key: 'ctrl+q', command: 'b.y', source: 'test' });
    assert.equal(keymap.conflicts.length, 1);
    keymap.unregisterBySource('test');
  });
  test('displayKey 展示', () => {
    assert.ok(displayKey(normalizeKeyString('ctrl+shift+p')).includes('P'));
  });
});

describe('命令面板模糊搜索', () => {
  test('子序列命中', () => {
    assert.ok(fuzzyScore('md', 'Markdown') !== null);
    assert.ok(fuzzyScore('保存', '保存') !== null);
  });
  test('连续与词首命中得分更高', () => {
    const a = fuzzyScore('abc', 'abc-xyz');
    const b = fuzzyScore('abc', 'a-b-c');
    assert.ok(a.score > b.score);
  });
  test('未匹配完返回 null', () => {
    assert.equal(fuzzyScore('xyz', 'abc'), null);
  });
});
