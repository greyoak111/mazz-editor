// tests/contract/browser-w34.test.mjs —— 白屏根治「原生菜单+invalidate」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('右键菜单原生 popup 化（并行 surface 根治）', () => {
  test('主进程 Menu 构建与弹出', () => {
    const src = readSrc('main/browser-views.js');
    assert.ok(/Menu\s*} = require\('electron'\)/.test(src), 'Menu 必须入主进程解构');
    assert.ok(src.includes('Menu.buildFromTemplate'), '原生模板必须构建');
    assert.ok(src.includes('.popup({ window: this.wm.main'), '必须绑主窗 popup');
    assert.ok(src.includes('setTimeout'), '弹出必须延迟下一帧（deepseek 弹药：给渲染器绘制时间）');
    assert.ok(src.includes('browser.navBack') && src.includes('browser.bookmark') && src.includes('browser.pageToLibrary'), '菜单动作必须全');
    assert.ok(src.includes("label: '摘录到笔记'") && src.includes("label: 'SearXNG 搜索选中内容'"), '选区条件项必须有');
    assert.ok(src.includes('_lastCtxMenuAt'), '弹出探针时间戳必须有');
  });
  test('动作回派与 DOM 菜单退役', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(src.includes("case 'ctx-action'"), 'ctx-action 回派必须有');
    assert.ok(!src.includes("menus.show('browser/page'"), '网页右键 DOM 菜单必须退役（白屏源头）');
    assert.ok(src.includes("menus.show('browser/tab'"), '标签右键 DOM 菜单不受影响（标签在主窗 DOM 区）');
  });
});

describe('invalidate 强制重绘', () => {
  test('恢复正药与探针', () => {
    const src = readSrc('main/browser-views.js');
    assert.ok(src.includes('webContents.invalidate()'), 'invalidate 必须在恢复路径');
    assert.ok(src.includes('_invalidateCount'), 'invalidate 计数探针必须有');
    assert.ok(src.includes('invalidateCount'), 'bv:state 必须暴露计数');
  });
});
