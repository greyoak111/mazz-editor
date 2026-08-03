// tests/contract/hotfix-w52e.test.mjs —— W52e 契约（browserViews 作用域病绝育 / F12 网页内拦截 / 主页刷新白屏根除）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('browserViews 作用域病绝育', () => {
  test('静态注册表模式（照 PanelWindows.all）', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes('static all = new Set()'), 'BrowserViews 静态注册表必须有');
    assert.ok(bv.includes('BrowserViews.all.add(this)'), '构造自注册必须有');
  });
  test('theme:broadcast 走注册表不走局部 const', () => {
    const mj = readSrc('main/main.js');
    assert.ok(mj.includes("const BrowserViews = require('./browser-views'); // 模块级"), '模块级 require 必须有');
    assert.ok(mj.includes('for (const bvs of BrowserViews.all) bvs.rethemeAllDevTools(id)'), '句柄必须遍历注册表');
    // 反摆烂断言：老病灶（句柄裸引用 browserViews 局部变量）必须绝迹
    assert.ok(!mj.includes('\n    browserViews.rethemeAllDevTools(id)'), '局部 const 裸引用必须绝迹');
  });
});

describe('F12 网页内拦截', () => {
  test('before-input-event 拦截 F12 toggle', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes("wc.on('before-input-event'"), 'before-input-event 必须有（网页聚焦时 keymap 收不到）');
    assert.ok(bv.includes("input.key === 'F12'"), 'F12 判定必须有');
    assert.ok(bv.includes('event.preventDefault()'), 'preventDefault 必须有（防网页自绑）');
    assert.ok(bv.includes('wc.isDevToolsOpened()') && bv.includes('wc.closeDevTools()'), 'toggle 语义必须有（已开则关）');
    assert.ok(bv.includes("wc.openDevTools({ mode: 'detach' })"), 'detach 打开必须有');
  });
  test('F5/Ctrl+R 转渲染层汇聚（防主页白屏）', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes("input.key === 'F5'"), 'F5 拦截必须有');
    assert.ok(bv.includes("String(input.key).toLowerCase() === 'r'"), 'Ctrl+R 拦截必须有');
    assert.ok(bv.includes("this.emit(tabId, 'key-reload', {})"), 'key-reload 转发必须有');
  });
});

describe('主页刷新白屏根除', () => {
  test('reloadTab 唯一汇聚', () => {
    const bi = readSrc('renderer/modules/browser/index.js');
    assert.ok(bi.includes('function reloadTab(t)'), 'reloadTab 汇聚必须有');
    assert.ok(bi.includes("if (t.url === HOME) { queueNav(t, HOME); return; }"), '主页必须重塞不 reload');
    assert.ok(bi.includes("root.querySelector('[data-a=reload]').addEventListener('click', () => reloadTab(activeTab()))"), '工具栏钮必须走汇聚');
    // 反摆烂断言：命令注册不得再裸发 bv:nav reload（绕过汇聚）
    assert.ok(!bi.includes("run: () => { const t = current?.activeTab(); if (!t) return; if (isElectron()) window.mazz.invoke('bv:nav', { tabId: t.viewId, action: 'reload' })"), '命令裸 reload 必须绝迹');
  });
  test('key-reload 消费端', () => {
    const bi = readSrc('renderer/modules/browser/index.js');
    assert.ok(bi.includes("case 'key-reload'"), 'key-reload case 必须有');
  });
});
