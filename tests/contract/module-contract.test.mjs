// tests/contract/module-contract.test.mjs —— 模块契约行为测试（准入门槛：全绿才允许进 modules/）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { modules } from '../../renderer/core/module-registry.js';
import { commands } from '../../renderer/core/command-registry.js';
import { contextKeys } from '../../renderer/core/contextkey-service.js';
import { normalizeKeyString } from '../../renderer/core/keymap-service.js';
import markdownModule from '../../renderer/modules/markdown/index.js';
import textModule from '../../renderer/modules/text/index.js';
import notesModule from '../../renderer/modules/notes/index.js';
import searchModule from '../../renderer/modules/search/index.js';

const MODULES = [
  ['markdown', markdownModule],
  ['text', textModule],
  ['notes', notesModule],
  ['search', searchModule],
];

describe('模块契约 v1：形状校验', () => {
  for (const [name, def] of MODULES) {
    test(`${name}：契约方法齐全`, () => {
      for (const fn of ['create', 'activate', 'deactivate', 'getContent', 'setContent', 'newDocument']) {
        assert.equal(typeof def[fn], 'function', `缺少 ${fn}()`);
      }
    });
  }
  test('重复注册抛错', () => {
    modules.register('markdown', markdownModule);
    assert.throws(() => modules.register('markdown', markdownModule), /重复注册/);
    modules.register('text', textModule);
  });
});

describe('模块契约 v1：contributes 协议校验', () => {
  const seenCmds = new Set();
  for (const [name, def] of MODULES) {
    const c = def.contributes || {};
    test(`${name}：命令 id 唯一且 run/title 齐全`, () => {
      for (const cmd of c.commands || []) {
        assert.ok(/^[a-z][\w.]*\.[\w.]+$/i.test(cmd.id), `命令 id 格式: ${cmd.id}`);
        assert.ok(!seenCmds.has(cmd.id), `命令冲突: ${cmd.id}`);
        seenCmds.add(cmd.id);
        assert.equal(typeof cmd.run, 'function', `${cmd.id} 缺 run`);
        assert.ok(cmd.title, `${cmd.id} 缺 title`);
      }
    });
    test(`${name}：键位可规范化且 when 可求值`, () => {
      for (const kb of c.keybindings || []) {
        const norm = normalizeKeyString(kb.key);
        assert.ok(norm.length > 0, `键位非法: ${kb.key}`);
        assert.doesNotThrow(() => contextKeys.evaluate(kb.when), `when 非法: ${kb.when}`);
      }
    });
    test(`${name}：菜单引用的 when 可求值`, () => {
      for (const [menuId, items] of Object.entries(c.menus || {})) {
        for (const it of items) {
          assert.ok(it.command, `${menuId} 菜单项缺 command`);
          assert.doesNotThrow(() => contextKeys.evaluate(it.when), `when 非法: ${it.when}`);
        }
      }
    });
  }
});

describe('模块契约 v1：生命周期与内容往返', () => {
  // 内容往返语义只对文档型模块成立（工具型模块 getContent 返回状态 JSON）
  const DOC_MODULES = MODULES.filter(([name]) => ['markdown', 'text'].includes(name));
  for (const [name, def] of DOC_MODULES) {
    test(`${name}：create/activate/deactivate + set/get/newDocument`, () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = def.create(container);
      def.activate(container, state);
      const sample = name === 'markdown' ? '# 契约测试\n\n内容' : '契约测试内容';
      def.setContent(sample, state);
      const got = def.getContent(state);
      assert.ok(got.includes('契约测试'), `内容未注入: ${String(got).slice(0, 60)}`);
      def.newDocument(state);
      assert.equal(def.getContent(state).trim(), '');
      assert.ok(def.getCharCount(state) >= 0);
      def.deactivate(container, state);
      container.remove();
    });
  }
});

describe('命令注册表：模块贡献的命令已注册', () => {
  test('markdown 关键命令存在', () => {
    for (const id of ['markdown.toggleBold', 'markdown.toggleItalic', 'markdown.toggleStrike', 'markdown.insertLink']) {
      assert.ok(commands.has(id), `缺少命令 ${id}`);
    }
  });
  test('text 关键命令存在', () => {
    assert.ok(commands.has('text.toggleWrap'));
  });
});
