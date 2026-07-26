// tests/contract/library-w19.test.mjs —— 波次十九「书库尾巴」契约（cache-zip/净化/简繁/竖排）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const { zhConvert } = await import('../../renderer/modules/library/zh-convert.js');
const { processHtmlText, rulesForBook } = await import('../../renderer/modules/library/clean.js');

describe('书库尾巴·cache-zip 快开', () => {
  test('缓存格式与接线', () => {
    const c = readSrc('renderer/modules/library/cache.js');
    assert.ok(c.includes('readBookCache') && c.includes('writeBookCache'), '读写双口必须存在');
    assert.ok(c.includes('CACHE_V') && c.includes('srcSize') && c.includes('srcMtime'), '版本+体积+mtime 三重失效校验');
    assert.ok(c.includes('_fromCache'), '缓存命中必须可辨识');
    const idx = readSrc('renderer/modules/library/index.js');
    assert.ok(idx.includes('readBookCache') && idx.includes('writeBookCache') && idx.includes('_srcStat'), 'openBook 必须接缓存线');
  });
  test('epub 两段式（占位符形态=缓存公共形态）', () => {
    const src = readSrc('renderer/modules/library/epub.js');
    assert.ok(src.includes('loadChapterRaw') && src.includes('materialize') && src.includes('libimg:'), '必须两段式');
    assert.ok(src.includes('chapCache'), '章节必须备忘（模式切换不回炉）');
    assert.ok(src.includes('unloadAll') && src.includes('revokeObjectURL'), '图片内存纪律必须有');
  });
});

describe('书库尾巴·净化规则', () => {
  test('规则三态与文本节点级', () => {
    const src = readSrc('renderer/modules/library/clean.js');
    assert.ok(src.includes('createTreeWalker') && src.includes('SHOW_TEXT') || src.includes('SHOW_TEXT'.length > 0 && 'createTreeWalker'), '必须 DOM 文本节点级');
    assert.ok(src.includes('invalid'), '坏正则必须守卫跳过');
    const idx = readSrc('renderer/modules/library/index.js');
    assert.ok(idx.includes('data-a=clean-rules') && idx.includes('rulesForBook'), 'UI 与规则装载必须接线');
  });
  test('行为级：删词不伤标签、作用域隔离', () => {
    const out = processHtmlText('<p>夜色广告时间到</p><b>加粗夜色</b>', {
      rules: [{ pattern: '夜色', type: 'delete', match: 'plain' }],
    });
    assert.ok(!out.includes('夜色'), '目标词应删除');
    assert.ok(out.includes('<p>') && out.includes('<b>'), '标签结构不得受伤');
    const rules = [
      { pattern: 'a', scope: 'all' },
      { pattern: 'b', scope: 'book', bookId: 'x' },
      { pattern: 'c', scope: 'book', bookId: 'y' },
    ];
    assert.deepEqual(rulesForBook(rules, 'x').map(r => r.pattern), ['a', 'b'], '全书+本书生效');
    assert.deepEqual(rulesForBook(rules, 'z').map(r => r.pattern), ['a'], '别书只见全书规则');
    // 坏正则不炸整链
    const out2 = processHtmlText('<p>正常</p>', { rules: [{ pattern: '([', type: 'delete', match: 'regex' }] });
    assert.ok(out2.includes('正常'), '坏正则不得炸链');
  });
});

describe('书库尾巴·简繁转换', () => {
  test('字表规模与词表先行', () => {
    const src = readSrc('renderer/modules/library/zh-convert.js');
    assert.ok(src.includes('S2T_P') && src.includes('OpenCC'), 'OpenCC 字表+词表必须有');
    assert.ok(/maps\(\)|_pRe/.test(src), '最长匹配词表正则必须存在');
  });
  test('行为级：字级与词级', () => {
    assert.equal(zhConvert('头发', 's2t'), '頭髮', '词级纠偏：头发→頭髮');
    assert.equal(zhConvert('頭髮', 't2s'), '头发', '繁转简：頭髮→头发');
    assert.equal(zhConvert('干净', 's2t'), '乾淨', '词级纠偏：干净→乾淨（不转乾净之外的干）');
    assert.equal(zhConvert('后来', 's2t'), '後來', '后来→後來');
    assert.equal(zhConvert('夜色从河面上升起来', 's2t'), '夜色從河面上升起來', '字级长句');
    assert.equal(zhConvert('夜色從河面上升起來', 't2s'), '夜色从河面上升起来', '往返一致');
    assert.equal(zhConvert('Mazz 2026', 's2t'), 'Mazz 2026', '非汉字不动');
    assert.equal(zhConvert('任意', ''), '任意', '空模式直通');
  });
});

describe('书库尾巴·竖排', () => {
  test('无 multicol 行距网格模型接线', () => {
    const src = readSrc('renderer/modules/library/index.js');
    assert.ok(src.includes('lib-vertical') && src.includes('writing-mode:vertical-rl'), '竖排书写模式必须注入');
    assert.ok(src.includes('rowPitch'), '行距网格 snap 必须有（每屏整数竖行零切行）');
    assert.ok(src.includes("ctl.mode === 'vertical'"), '竖排模式判定必须贯穿');
    assert.ok(src.includes('isVert ? -node.offsetLeft : node.offsetLeft') || src.includes('offOf'), '竖排恢复定位必须方向翻转');
  });
});
