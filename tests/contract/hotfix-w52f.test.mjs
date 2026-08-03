// tests/contract/hotfix-w52f.test.mjs —— W52f 契约（真机五连骂平反：lean 无框/坞浮动记忆/焦点抢回/翻译插件收编/devtools 色调）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('lean 无框圆角+主进程兜底（W53 已退役：全原生子窗格路线）', () => {
  test('lean 体系全体退役', () => {
    const wm = readSrc('main/window-manager.js');
    assert.ok(!wm.includes('opts.lean'), 'createChild lean 形态必须退役');
    assert.ok(!wm.includes('transparent: lean'), 'lean 透明参必须退役');
    const mj = readSrc('main/main.js');
    assert.ok(!mj.includes('handoff.lean = true'), 'openChild lean 强制注入必须退役');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(!css.includes('data-window-mode'), 'lean CSS 规则必须退役');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(!sh.includes("windowMode = 'lean'"), '渲染层 lean 支路必须退役');
  });
});

describe('坞浮动记忆迁移', () => {
  test('_v:2 迁移标记+float 清零', () => {
    const src = readSrc('renderer/shell/side-dock.js');
    assert.ok(src.includes("saved._v !== 2"), '迁移版本闸必须有');
    assert.ok(src.includes('saved.float = null'), '老 float 记忆必须清零回停靠');
  });
});

describe('焦点抢回', () => {
  test('panel/children 关闭主窗 focus', () => {
    assert.ok(readSrc('main/panel-windows.js').includes('m.focus()'), 'panel 关闭必须抢焦点');
    assert.ok(readSrc('main/window-manager.js').includes('this.main.focus()'), 'children 关闭必须抢焦点');
  });
});

describe('翻译/插件管理收编（W53 全原生子窗格）', () => {
  test('三处入口收编 panel:open', () => {
    const tr = readSrc('renderer/translate.js');
    assert.ok(tr.includes("kind: 'translate'"), '翻译面板必须收编子窗格');
    assert.ok(!tr.includes('translateConfig') || tr.includes("kind: 'translate'"), '引擎设置并入翻译子窗格抽屉');
    assert.ok(readSrc('renderer/plugins/manager.js').includes("kind: 'plugins'"), '插件管理必须收编子窗格');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('translateStashInit') && sh.includes('translateQueryInit'), '翻译初始文本暂存透传桥必须有');
    assert.ok(sh.includes('pluginsQuery') && sh.includes('pluginsAction'), '插件管理桥必须有');
  });
});

describe('devtools 色调跟随（明暗两档平反）', () => {
  test('六主题色调表+cdt 直达+body 直钉', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes('DT_PALETTES'), '六主题色调表必须有');
    assert.ok(bv.includes("'#101226'") && bv.includes("'#86c5a0'"), 'indigo/moss 色调必须有');
    assert.ok(bv.includes('--sys-color-cdt-base-container'), 'cdt 直达变量必须有（探针实锤真管）');
    assert.ok(bv.includes('body { background: ${pal.bg} !important; }'), 'dark 直色规则必须 body 直钉');
    assert.ok(bv.includes("console.error('[devtools-theme]"), 'catch 必须开闸（真机失效不许静默）');
  });
});

describe('mobile-env module 化（常年隐身炸平反）', () => {
  test('index.html type=module', () => {
    const html = readSrc('renderer/index.html');
    assert.ok(html.includes('<script type="module" src="lib/mobile-env.js">'), 'mobile-env 必须 module 加载');
    assert.ok(!html.includes('<script src="lib/mobile-env.js">'), 'classic 加载必须绝迹');
  });
});
