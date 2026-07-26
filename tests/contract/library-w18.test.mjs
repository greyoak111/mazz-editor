// tests/contract/library-w18.test.mjs —— 波次十八「再造书库」架构契约（koodo 净室复刻五件套）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const { makeBytesPager } = await import('../../renderer/modules/library/cbz.js');

describe('再造书库·沙箱帧隔离', () => {
  test('沙箱帧机制存在于源码', () => {
    const src = readSrc('renderer/modules/library/index.js');
    assert.ok(src.includes('lib-book-frame'), '必须有沙箱帧类名');
    assert.ok(src.includes('allow-same-origin'), '帧 sandbox 必须是 allow-same-origin（书的脚本禁跑）');
    assert.ok(src.includes('ensureFrame') && src.includes('applyFrameStyle'), '帧创建与样式注入必须成对');
    assert.ok(readSrc('renderer/styles/base.css').includes('.lib-book-frame'), 'base.css 必须有帧样式');
  });
  test('帧内事件桥（wheel/contextmenu/selectionchange/click 链接拦截）', () => {
    const src = readSrc('renderer/modules/library/index.js');
    assert.ok(src.includes("addEventListener('wheel', (e) => onReaderWheel(e, true)"), '帧内滚轮必须桥接');
    assert.ok(src.includes("addEventListener('contextmenu'"), '帧内右键必须桥接');
    assert.ok(src.includes("addEventListener('selectionchange'"), '帧内选区缓存必须桥接');
    assert.ok(src.includes('preventDefault(); e.stopPropagation();') || src.includes('e.preventDefault()'), '帧内链接必须拦截');
  });
});

describe('再造书库·步进几何与贴网自矫正', () => {
  test('双页步进=2×(页宽+gap)——修复 48px 累积漂移', () => {
    const src = readSrc('renderer/modules/library/index.js');
    assert.ok(src.includes('pitchOf') && src.includes('stepOf'), '必须有栏距/步进几何函数');
    assert.ok(/stepOf\s*=\s*\(\)\s*=>.*2\s*\*\s*pitchOf/.test(src), '双页屏步进必须是 2×栏距');
    assert.ok(src.includes("columnFill = 'auto'"), 'column-fill:auto 逐栏填满（分页必要条件）');
  });
  test('翻页先取整贴网再 ±1 页（漂移自矫正）', () => {
    const src = readSrc('renderer/modules/library/index.js');
    assert.ok(/Math\.round\(\(ctl\._flowOffset \|\| 0\) \/ step\)/.test(src), '必须 Math.round 贴网再翻页');
  });
});

describe('再造书库·内容锚进度', () => {
  test('锚点三件套与字数加权', () => {
    const src = readSrc('renderer/modules/library/index.js');
    for (const k of ['captureAnchor', 'weightedPct', 'resolveXpath', 'firstVisibleBlock', '_chapSizes']) {
      assert.ok(src.includes(k), `缺 ${k}`);
    }
    assert.ok(src.includes('rec.anchor = anch') && src.includes('rec.pct'), '进度记录必须含 anchor/pct 字段');
    assert.ok(src.includes('_pendingAnchor'), '重开必须消费内容锚');
  });
});

describe('再造书库·漫画内存纪律', () => {
  test('blob URL + revoke 机制存在于源码', () => {
    const src = readSrc('renderer/modules/library/cbz.js');
    assert.ok(src.includes('createObjectURL') && src.includes('revokeObjectURL'), '必须 blob 化与释放');
    assert.ok(src.includes('unloadOutside'), '必须有翻页窗口外释放');
    assert.ok(src.includes('canBlob'), '必须有 jsdom 回退守卫');
    const idx = readSrc('renderer/modules/library/index.js');
    assert.ok(idx.includes('unloadOutside') && idx.includes('unloadAll'), '翻页/离书必须释放');
  });
  test('pager 行为级：URL 形态随环境且缓存可释放', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const pager = makeBytesPager([{ mime: 'image/png', bytes }, { mime: 'image/png', bytes }], async (i) => ({ mime: 'image/png', bytes }));
    const u0 = await pager.loadPage(0);
    const canBlob = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    assert.ok(u0.startsWith(canBlob ? 'blob:' : 'data:image/png;base64,'), 'URL 形态必须随环境（blob 优先，无则 dataURL）');
    assert.equal(pager.cachedCount(), 1, '加载后缓存 1');
    await pager.loadPage(1);
    assert.equal(pager.cachedCount(), 2, '缓存 2');
    pager.unloadOutside(new Set([1]));
    assert.equal(pager.cachedCount(), 1, '窗口外应释放只剩 1');
    pager.unloadAll();
    assert.equal(pager.cachedCount(), 0, '离书应全放');
  });
});
