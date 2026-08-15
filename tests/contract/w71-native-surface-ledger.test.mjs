// tests/contract/w71-native-surface-ledger.test.mjs —— W71 原生 Surface 资源账本契约
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W71 Native Surface ResourceLedger', () => {
  test('主窗、分窗与快记窗登记并在 closed 释放', () => {
    const source = read('main/window-manager.js');
    assert.ok(source.includes("type: 'browser-window'"));
    for (const kind of ["'main'", "'child'", "'quick-note'"]) {
      assert.ok(source.includes(`this.trackWindow(win, ${kind})`), `缺 ${kind} 资源登记`);
    }
    assert.ok(source.includes("release(key, { reason: 'window-closed' })"));
  });

  test('PanelWindow 统一经 _prepare 登记并释放', () => {
    const source = read('main/panel-windows.js');
    assert.ok(source.includes("type: 'panel-window'"));
    assert.ok(source.includes("release(ledgerKey, { reason: 'panel-closed' })"));
    assert.ok(source.includes('this._prepare(win'), '所有面板族必须汇聚到统一准备路径');
  });

  test('WebContentsView 的替换、宿主关闭和外部销毁均幂等释放', () => {
    const source = read('main/browser-views.js');
    assert.ok(source.includes("type: 'web-contents-view'"));
    assert.ok(source.includes("this.destroy(tabId, 'replaced')"));
    assert.ok(source.includes("this.destroy(tabId, 'host-window-closed')"));
    assert.ok(source.includes("view.webContents.once('destroyed'"));
    assert.ok(source.includes("this._releaseResource(rec, 'web-contents-destroyed')"));
  });

  test('总装配共享同一个 ResourceLedger', () => {
    const source = read('main/main.js');
    assert.equal((source.match(/new ResourceLedger\(\)/g) || []).length, 1);
    assert.ok(/new WindowManager\(\{[\s\S]{0,180}resourceLedger \}\)/.test(source));
    assert.ok(source.includes('new PanelWindows({ bus, win: () => wm.main, resourceLedger })'));
    assert.ok(/new BrowserViews\([\s\S]{0,180}resourceLedger/.test(source));
    assert.ok(source.includes("wm.trackWindow(win, 'print-worker')"), '临时打印 BrowserWindow 也必须进入账本');
  });
});
