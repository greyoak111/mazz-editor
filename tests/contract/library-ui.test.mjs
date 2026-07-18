// tests/contract/library-ui.test.mjs —— 书库 UI：书架渲染 / 打开阅读 / 翻页 / 移出书架
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

// ---- 构造测试 epub 的 base64 ----
async function makeEpubB64() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
  zip.file('content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>UI 测试书</dc:title><dc:creator>李四</dc:creator></metadata>
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`);
  zip.file('ch1.xhtml', '<html><body><h1>开篇章</h1><p>内容甲</p></body></html>');
  zip.file('ch2.xhtml', '<html><body><h1>续章</h1><p>内容乙</p></body></html>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  return buf.toString('base64');
}

let epubB64 = '';
const settings = new Map();
window.mazz = {
  invoke: async (channel, payload) => {
    if (channel === 'settings:get') return settings.get(payload.key);
    if (channel === 'settings:set') { settings.set(payload.key, payload.value); return true; }
    if (channel === 'workspace:get') return '/mock-ws';
    if (channel === 'fs:readFileBase64') return epubB64;
    if (channel === 'fs:writeFileBase64') return true;
    return null;
  },
};
window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };

const { default: libraryModule } = await import('../../renderer/modules/library/index.js');
const { instances } = libraryModule._forTests;
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

describe('书库 UI', () => {
  test('书架渲染 + 打开 epub 阅读 + 翻页 + 进度记忆', async () => {
    epubB64 = await makeEpubB64();
    settings.set('library.books', [
      { id: 'bk1', title: 'UI 测试书', author: '李四', cover: '', path: '/mock-ws/书库/test.epub', format: 'epub', addedAt: 1 },
      { id: 'bk2', title: '漫画册', author: '', cover: '', path: '/mock-ws/书库/m.cbz', format: 'cbz', addedAt: 2 },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    libraryModule.create(container);
    await tick();
    // 书架两张卡
    const cards = container.querySelectorAll('.lib-card');
    assert.equal(cards.length, 2, '书架两本书');
    assert.ok(cards[0].textContent.includes('UI 测试书'));
    // 打开第一本
    const ctl = instances.get(container);
    await ctl.openBook('bk1');
    await tick(150);
    assert.ok(container.querySelector('.lib-reader').style.display !== 'none', '阅读器应显示');
    assert.ok(container.querySelector('.lib-page').innerHTML.includes('开篇章'), '应渲染第一章');
    assert.ok(container.querySelector('.lib-pos').textContent.includes('1/2'));
    // 翻页
    container.querySelector('[data-a=next]').click();
    await tick(120);
    assert.ok(container.querySelector('.lib-page').innerHTML.includes('续章'), '应到第二章');
    assert.ok(container.querySelector('.lib-pos').textContent.includes('2/2'));
    // 进度已记忆
    const progress = settings.get('library.progress');
    assert.equal(progress?.bk1?.chapter, 1, '进度应写入');
    // 目录按钮
    container.querySelector('[data-a=toc]').click();
    assert.ok(container.querySelector('.lib-toc').style.display !== 'none', '目录应展开');
    container.remove();
  });

  test('右键 10 号菜单：移出书架', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    libraryModule.create(container);
    await tick();
    const card = container.querySelector('.lib-card');
    card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    await tick(30);
    const menu = document.querySelector('.mazz-menu');
    assert.ok(menu, '右键菜单应出现');
    assert.ok(menu.textContent.includes('移出书架'));
    assert.ok(menu.textContent.includes('导出为 Markdown'));
    menu.querySelector('[data-a=remove]').click();
    await tick(60);
    assert.equal((settings.get('library.books') || []).length, 1, '应移出一本');
    assert.equal(container.querySelectorAll('.lib-card').length, 1, '书架同步刷新');
    container.remove();
  });
});
