// tests/contract/hotfix-w58i.test.mjs —— W58i 契约（字体/字号 picklist 通用格收编）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('字体/字号选择格全原生独立子窗（picklist 通用格）', () => {
  test('kind 注册+定位同例+失焦收+标题', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes('|picklist)'), 'kind 白名单必须有 picklist');
    assert.ok(pw.includes("kind === 'picklist' ? (opts.w || 340)"), '尺寸默认必须有');
    assert.ok(pw.includes("kind === 'ctxmenu' || kind === 'picklist'"), '屏坐标定位+翻边必须同例');
    assert.ok(pw.includes("if (kind === 'ctxmenu' || kind === 'picklist') win.on('blur'"), '失焦收必须同例');
    assert.ok(pw.includes("picklist: '选择'"), '标题必须有');
  });
  test('picklist.html 全家桶（主题/检索/键位/内滚唯一）', () => {
    const html = readSrc('renderer/panels/picklist.html');
    assert.ok(html.includes("type: 'themeSnapshot'"), '主题快照桥必须有');
    assert.ok(html.includes("type !== 'picklistData'"), '数据消费必须有');
    assert.ok(html.includes("type: 'picklistPick'"), 'pick 桥必须有');
    assert.ok(html.includes('ArrowDown') && html.includes('Enter'), '键盘导航必须有');
    assert.ok(html.includes('overflow: hidden; }'), '文档级滚动锁必须有');
    assert.ok(html.includes('allowFree'), '自由值通道必须有（字号自定义/字体自输）');
  });
  test('壳桥+pickers 双收编', () => {
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes("pl.type === 'picklistQuery'") && sh.includes("pl.type === 'picklistPick'"), '壳双桥必须有');
    assert.ok(sh.includes('window.__picklistPending'), 'pending stash 必须有');
    const pk = readSrc('renderer/shell/pickers.js');
    assert.ok(pk.includes("kind: 'picklist'"), 'pickers 必须走 picklist');
    assert.ok((pk.match(/window.__picklistPending = \{/g) || []).length === 2, '字体/字号双 stash 必须齐');
    assert.ok(pk.includes('searchable: true, allowFree: true'), '检索+自由值必须开');
  });
});
