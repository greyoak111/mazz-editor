// tests/contract/hotfix-w66.test.mjs —— W66 契约（裁剪自适应根治/打包哑火根治/面板入坞）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('① 裁剪位置自适应根治', () => {
  test('viewwrap 局部坐标系+现测缩放+RO 重贴', () => {
    const ie = readSrc('renderer/modules/viewer/imgedit.js');
    assert.ok(ie.includes('ie-viewwrap'), 'viewwrap 包裹必须在');
    assert.ok(ie.includes('new ResizeObserver'), '尺寸观察必须在（漂移实锤根治）');
    assert.ok(ie.includes('this._ro.observe(this.host)'), '宿主观察必须在');
    assert.ok(ie.includes('this._ro?.disconnect()'), 'destroy 断观察必须在');
    assert.ok(ie.includes('left: x + \'px\', top: y + \'px\''), 'viewwrap 局部坐标必须在');
    assert.ok(!ie.includes("this.el.querySelector('.ie-stage').getBoundingClientRect()"), 'stage 偏移四路数学必须绝迹');
    const css = readSrc('renderer/styles/base.css');
    assert.ok(css.includes('.ie-viewwrap'), 'viewwrap 样式必须在');
  });
});

describe('② 打包哑火根治', () => {
  test('四命令解构带默认+无目标人话', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("run: async ({ path: p } = {})"), '解构默认必须有（ctxmenuPick 无载荷实锤）');
    assert.ok((sh.match(/\{ path: p \} = \{\}/g) || []).length >= 4, '四命令必须全带默认');
    assert.ok(sh.includes('archTarget'), 'archTarget 人话目标件必须有');
    assert.ok(sh.includes('请先在文件树选中压缩包或目标文件/文件夹'), '无目标提示必须有');
    assert.ok(sh.includes("R('archive.openPanel'"), '面板门命令必须有');
  });
});

describe('③ 压缩面板入坞可发现', () => {
  test('坞卡+空态开门', () => {
    const sd = readSrc('renderer/shell/side-dock.js');
    assert.ok(sd.includes("cmd: 'archive.openPanel'") && sd.includes("ico: '📦'"), '坞卡必须在（iconHtml 统一风格）');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("pl.type === 'archiveOpenDialog'"), '开档对话桥必须有');
    const ah = readSrc('renderer/panels/archive.html');
    assert.ok(ah.includes('b-open') && ah.includes('打开压缩包…'), '空态开门钮必须在');
  });
});
