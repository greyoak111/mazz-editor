import './_setup.mjs';
import { readFileSync } from 'node:fs';
import { describe, test, assert } from '../harness.mjs';
import { exportEpubMarkdownRaw, searchEpubRaw } from '../../renderer/modules/library/book-operations.js';

const indexSource = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');

function fakeEpub(rawSections) {
  let rawLoads = 0;
  let materializedLoads = 0;
  let unloads = 0;
  const rawLimits = [];
  const byteLimits = [];
  return {
    title: 'Bounded Book', author: 'Mazz',
    spine: rawSections.map((_, i) => ({ id: `s-${i}`, href: `${i}.xhtml` })),
    toc: rawSections.map((_, i) => ({ label: `章节 ${i + 1}` })),
    async loadChapterRaw(item, options) {
      rawLoads++;
      rawLimits.push(options?.maxBytes);
      return rawSections[Number(String(item.id).slice(2))];
    },
    async loadChapter() { materializedLoads++; throw new Error('materialized path must stay unused'); },
    async readZipBytes(path, options) {
      byteLimits.push(options?.maxBytes);
      return path ? new Uint8Array([1, 2, 3]) : null;
    },
    unloadAll() { unloads++; },
    stats: () => ({ rawLoads, materializedLoads, unloads }),
    limits: () => ({ rawLimits: [...rawLimits], byteLimits: [...byteLimits] }),
  };
}

describe('W88 Library · bounded search and durable Markdown export', () => {
  test('书内搜索只扫 raw chapter，不填充阅读器 materialized residency', async () => {
    const epub = fakeEpub([
      { html: '<p>alpha only</p>', images: [] },
      { html: '<p>needle in chapter</p>', images: [] },
      { html: '<p>needle again</p>', images: [] },
    ]);
    const result = await searchEpubRaw(epub, 'needle', { limit: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.scanned, 3, '命中上限只限制结果数，不把未扫章节误报为已检索');
    assert.deepEqual(result.hits.map(hit => hit.idx), [1]);
    assert.deepEqual(epub.stats(), { rawLoads: 3, materializedLoads: 0, unloads: 0 });
    assert.deepEqual(epub.limits().rawLimits, Array(3).fill(8 * 1024 * 1024),
      'search must request bounded raw-section reads');
  });

  test('搜索 owner 失效后在当前 raw await 边界停止，且不抛未捕获拒绝', async () => {
    const epub = fakeEpub([
      { html: '<p>one</p>', images: [] },
      { html: '<p>two</p>', images: [] },
    ]);
    let aliveChecks = 0;
    const result = await searchEpubRaw(epub, 'two', { isAlive: () => ++aliveChecks < 3 });
    assert.equal(result.cancelled, true);
    assert.equal(result.scanned, 1, '只允许当前已完成的 raw chapter 计入扫描账');
    assert.equal(epub.stats().rawLoads, 1, 'owner 失效后不得启动下一章 I/O');
    assert.equal(epub.stats().materializedLoads, 0);
    assert.deepEqual(epub.limits().rawLimits, [8 * 1024 * 1024]);
  });

  test('Markdown 导出嵌入有界 data URL，绝不泄漏 blob/libimg session URL', async () => {
    const epub = fakeEpub([{
      html: '<h2>第一章</h2><p>正文<img src="libimg:0"></p>',
      images: [{ zipPath: 'OPS/image.png', ext: 'png' }],
    }]);
    const result = await exportEpubMarkdownRaw(epub, { maxImageBytes: 16, maxTotalImageBytes: 16 });
    assert.equal(result.ok, true);
    assert.equal(result.exportedSections, 1);
    assert.equal(result.embeddedImageBytes, 3);
    assert.match(result.content, /data:image\/png;base64,AQID/);
    assert.doesNotMatch(result.content, /blob:|libimg:/);
    assert.deepEqual(epub.stats(), { rawLoads: 1, materializedLoads: 0, unloads: 0 });
    assert.deepEqual(epub.limits(), {
      rawLimits: [8 * 1024 * 1024],
      byteLimits: [16],
    }, 'export must bound both raw chapter and decompressed image reads');
  });

  test('超限图片降为可读来源标记，不输出坏链接', async () => {
    const epub = fakeEpub([{
      html: '<p><img src="libimg:0"></p>',
      images: [{ zipPath: 'OPS/huge.webp', ext: 'webp' }],
    }]);
    const result = await exportEpubMarkdownRaw(epub, { maxImageBytes: 2, maxTotalImageBytes: 2 });
    assert.equal(result.omittedImages, 1);
    assert.match(result.content, /图像未内嵌：OPS\/huge\.webp/);
    assert.doesNotMatch(result.content, /blob:|libimg:|!\[图\]\(\)/);
  });

  test('产品接线在 Back/destroy 取消搜索导出，并在 finally 释放临时 EPUB owner', () => {
    assert.match(indexSource, /const\s+generation\s*=\s*\+\+ctl\._searchGen/);
    assert.match(indexSource, /searchEpubRaw\([\s\S]*?isAlive:\s*alive/);
    assert.match(indexSource, /const\s+generation\s*=\s*\+\+ctl\._exportGen/);
    assert.match(indexSource, /exportEpubMarkdownRaw\([\s\S]*?isAlive:\s*alive/);
    assert.match(indexSource, /finally\s*\{[\s\S]*?epub\?\.unloadAll\?\.\(\)/);
    const back = indexSource.slice(
      indexSource.indexOf("root.querySelector('[data-a=back]').addEventListener"),
      indexSource.indexOf("root.querySelector('[data-a=toc]').addEventListener"),
    );
    assert.match(back, /ctl\._searchGen\+\+/);
    assert.match(back, /ctl\._exportGen\+\+/);
    const destroy = indexSource.slice(indexSource.indexOf('ctl.prepareDestroy = () =>'));
    assert.match(destroy, /ctl\._searchGen\+\+/);
    assert.match(destroy, /ctl\._exportGen\+\+/);
  });
});
