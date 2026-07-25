// tests/contract/draw-v2.test.mjs —— 笔刷引擎/ABR 校验/Ribbon 折叠/转换映射契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { BRUSH_TYPES, DEFAULT_BRUSHES, colorWithAlpha, parseAbr } = await import('../../renderer/modules/draw/brushes.js');
const { needsConvert, extOf } = await import('../../renderer/lib/extern-convert.js');
const { Ribbon } = await import('../../renderer/shell/ribbon.js');

describe('笔刷引擎', () => {
  test('笔型注册表完整（7 类 + 印章）', () => {
    for (const t of ['pen', 'pencil', 'marker', 'airbrush', 'watercolor', 'calligraphy', 'soft', 'stamp']) {
      assert.ok(BRUSH_TYPES[t], '缺笔型: ' + t);
    }
    assert.ok(BRUSH_TYPES.airbrush.stamp && BRUSH_TYPES.soft.stamp, '喷枪/柔边应为印章渲染');
  });
  test('默认笔刷参数合法且互不相同', () => {
    assert.ok(DEFAULT_BRUSHES.length >= 7);
    assert.ok(DEFAULT_BRUSHES.every(b => b.size > 0 && b.opacity > 0 && b.opacity <= 1));
    assert.ok(DEFAULT_BRUSHES.find(b => b.type === 'airbrush').size > DEFAULT_BRUSHES.find(b => b.type === 'pen').size);
  });
  test('colorWithAlpha 解析', () => {
    assert.equal(colorWithAlpha('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
    assert.equal(colorWithAlpha('#1a1a1a', 1), 'rgba(26,26,26,1)');
  });
});

describe('ABR 解析（校验路径）', () => {
  test('非 abr 版本头 → 明确报错', () => {
    const buf = new Uint8Array([0, 3, 0, 0]).buffer; // version=3 不支持
    assert.throws(() => parseAbr(buf), /v6/);
  });
});

describe('外部打开格式映射', () => {
  test('自创格式判定', () => {
    assert.ok(needsConvert('mazzsheet'));
    assert.ok(needsConvert('mazzslide'));
    assert.ok(needsConvert('mazzdraw'));
    assert.ok(!needsConvert('docx'));
    assert.ok(!needsConvert('md'));
    assert.equal(extOf('a/b/c.mazzdraw'), 'mazzdraw');
  });
});

describe('Ribbon 二级折叠', () => {
  test('超 7 个按钮自动收进「更多」', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const rb = new Ribbon(host);
    const buttons = Array.from({ length: 12 }, (_, i) => ({ command: 'c' + i, icon: '·', label: 'btn' + i }));
    const g = rb.group('测试组', buttons);
    const direct = g.querySelectorAll(':scope > .rb-btn:not(.rb-more)').length;
    assert.equal(direct, 7, '一级只显示 7 个');
    const more = g.querySelector('.rb-more');
    assert.ok(more, '应有「更多」按钮');
    // 点更多 → 弹出二级菜单含 5 个
    more.click();
    const pop = document.querySelector('.rb-more-pop');
    assert.ok(pop, '二级菜单应弹出');
    assert.equal(pop.querySelectorAll('.rb-btn').length, 5);
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  });
});
