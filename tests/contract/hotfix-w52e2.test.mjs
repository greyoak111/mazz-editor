// tests/contract/hotfix-w52e2.test.mjs —— W52e② 契约（子窗滚动条全族 / 批注色板）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('子窗滚动条全族（军规④）', () => {
  test('panel-shared.css 存在且全族样式齐', () => {
    const css = readSrc('renderer/panels/panel-shared.css');
    assert.ok(css.includes('*::-webkit-scrollbar'), '全局滚动条族必须有');
    assert.ok(css.includes('.ps-scroll'), '滚动容器工具类必须有');
  });
  test('五窗统一链接（加载链核验——写了不算做了病绝育）', () => {
    for (const f of ['palette', 'shortcuts', 'favmgr', 'pwmgr', 'annotate']) {
      const html = readSrc(`renderer/panels/${f}.html`);
      assert.ok(html.includes('panel-shared.css'), `${f}.html 必须链接 panel-shared.css`);
    }
  });
  test('溢出容器 overflow 真实落盘', () => {
    assert.ok(readSrc('renderer/panels/palette.html').includes('main { flex:1; min-height:0; padding:6px 8px; overflow-y:auto; }'), 'palette main 必须 overflow-y:auto');
    assert.ok(readSrc('renderer/panels/shortcuts.html').includes('main { flex:1; min-height:0; padding:10px 16px; overflow-y:auto; }'), 'shortcuts main 必须 overflow-y:auto');
    assert.ok(readSrc('renderer/panels/favmgr.html').includes('overflow:auto; flex:1;'), 'favmgr main 必须保持 overflow:auto');
    assert.ok(readSrc('renderer/panels/pwmgr.html').includes('overflow:auto; flex:1;'), 'pwmgr main 必须保持 overflow:auto');
  });
});

describe('批注色板挤坨平反', () => {
  test('20px 圆形色板 + 10px 间距 + inline 块化（竖条案防回退）', () => {
    const html = readSrc('renderer/panels/annotate.html');
    assert.ok(html.includes('.bar .c { display: inline-block; width: 20px; height: 20px;'), '色板必须 20px 且块化（<i> inline 宽高无效=竖条案实锤）');
    assert.ok(html.includes('border-radius: 50%'), '色板必须圆形');
    assert.ok(html.includes('.bar #colors { display: inline-flex;'), '#colors 必须 flex 化');
    assert.ok(html.includes('align-items: center; gap: 10px;'), '条间距必须 10px');
  });
});
