// tests/contract/hotfix-w62b.test.mjs —— W62b 入站桥补强契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  buildClipMarkdown, parseUrlList, resolveClipAdapter, runPool, shouldUseVision, snapshotScript,
} from '../../renderer/modules/browser/clipper.js';

const require = createRequire(import.meta.url);
const LanSync = require('../../main/lansync.js');
const SearxService = require('../../main/searx.js');
const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const memStore = () => {
  const values = new Map();
  return { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) };
};

describe('W62b 剪藏纯内核', () => {
  test('站点适配器按域名收敛，未知站点稳定回退 generic', () => {
    assert.equal(resolveClipAdapter('https://mp.weixin.qq.com/s/abc').id, 'wechat');
    assert.equal(resolveClipAdapter('https://zhuanlan.zhihu.com/p/1').id, 'zhihu');
    assert.equal(resolveClipAdapter('https://example.org/a').id, 'generic');
    const script = snapshotScript('https://juejin.cn/post/1');
    assert.match(script, /article-content/);
    assert.match(script, /currentSrc/);
    assert.equal(/outerHTML/.test(script), false, '不受信 HTML 不得带回应用');
  });

  test('正文与图片快照不设内容数量阈值，OCR 路由不再以字数决定', async () => {
    const clipper = await import('../../renderer/modules/browser/clipper.js');
    const script = clipper.snapshotScript('https://example.test/article');
    assert.equal(script.includes('slice(0, 60000)'), false);
    assert.equal(script.includes('slice(0, 24)'), false);
    assert.equal(clipper.shouldUseVision({ text: '有正文', images: [{ width: 1200, height: 800 }] }), false);
    assert.equal(clipper.shouldUseVision({ text: '', images: [{ width: 1200, height: 800 }] }), true);
  });

  test('图片本地化与视觉回退逐图处理全量候选，单图失败仍保留来源', () => {
    const runtime = src('renderer/modules/browser/clip-runtime.js');
    assert.equal(runtime.includes('slice(0, 12)'), false);
    assert.equal(runtime.includes('page.images?.[0]'), false);
    assert.match(runtime, /for \(const \[index, image\] of \(Array\.isArray\(page\?\.images\)/);
    assert.match(runtime, /runPool\(sources/);
    const md = buildClipMarkdown({
      page: { title: '全图剪藏', url: 'https://a.test/x' },
      assets: [{ alt: '远程图', source: 'https://a.test/fail.png', localized: false, error: 'network failed' }],
      ocrNotice: 'vision failed',
    });
    assert.match(md, /!\[远程图\]\(https:\/\/a\.test\/fail\.png\)/);
    assert.match(md, /图片本地化失败/);
    assert.match(md, /OCR 未完整处理：vision failed/);
  });

  test('运行时实处理超过旧 24/12 帽的全部图片', async () => {
    const { createClipRuntime } = await import('../../renderer/modules/browser/clip-runtime.js');
    const originalMazz = window.mazz;
    const imageWrites = [];
    window.mazz = {
      invoke: async (channel, payload = {}) => {
        if (channel === 'workspace:get') return 'D:/clip-contract';
        if (channel === 'fs:stat') return { exists: false };
        if (channel === 'clip:fetchImage') return { ok: true, base64: 'AA==', mime: 'image/png', url: payload.url };
        if (channel === 'fs:writeFileBase64') imageWrites.push(payload.path);
        return true;
      },
    };
    try {
      const runtime = createClipRuntime();
      const images = Array.from({ length: 30 }, (_, index) => ({ src: `https://img.test/${index}.png`, alt: `图 ${index}` }));
      const result = await runtime.savePage({ title: '三十图', url: 'https://a.test/x', text: '已有正文', images });
      assert.equal(result.assets, 30);
      assert.equal(result.localizedAssets, 30);
      assert.equal(result.imageFailures.length, 0);
      assert.equal(imageWrites.length, 30);
    } finally {
      window.mazz = originalMazz;
    }
  });

  test('复用并发池严格最多 2 件、保序并隔离单件失败', async () => {
    let active = 0, maxActive = 0;
    const result = await runPool([1, 2, 3, 4, 5], async n => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 8));
      active--;
      if (n === 3) throw new Error('坏页');
      return n * 10;
    });
    assert.equal(maxActive, 2);
    assert.deepEqual(result.map(row => row.ok ? row.value : row.error), [10, 20, '坏页', 40, 50]);
  });

  test('URL 清单去重、图片页判别、Markdown 本地资源引用齐套', () => {
    assert.deepEqual(parseUrlList('甲 https://a.test/x\nhttps://a.test/x\n乙：https://b.test/y。'), ['https://a.test/x', 'https://b.test/y']);
    assert.equal(shouldUseVision({ text: '短文', images: [{ src: 'https://a.test/page.png', width: 900, height: 1200 }] }), false, '有正文时不得再按字数阈值切换 OCR');
    assert.equal(shouldUseVision({ text: '', images: [{ src: 'https://a.test/page.png', width: 900, height: 1200 }] }), true);
    assert.equal(shouldUseVision({ text: '正文'.repeat(400), images: [] }), false);
    const md = buildClipMarkdown({
      page: { title: '证据页', url: 'https://a.test/x', text: '正文', adapter: 'generic' },
      assets: [{ alt: '图一', relativePath: 'assets/证据页-01.png' }], ocrText: '图中文字', capturedAt: '2026-08-13',
    });
    assert.match(md, /来源：https:\/\/a\.test\/x/);
    assert.match(md, /图片页 OCR[\s\S]*图中文字/);
    assert.match(md, /!\[图一\]\(assets\/证据页-01\.png\)/);
  });

  test('服务端批量抓取能解析相对图片并拒绝内联资源', () => {
    const out = SearxService.extractArticleText('<title>图页</title><article><img data-src="/a.png"><img src="data:image/png;base64,AA"><p>正文</p></article>', 'https://site.test/post/1');
    assert.deepEqual(out.images, ['https://site.test/a.png']);
    assert.match(out.text, /正文/);
  });
});

describe('W62b 临时局域网分享与产品接线', () => {
  test('临时分享只读、转义页面、保留 Markdown 原文并可主动回收', async () => {
    const sync = new LanSync({ store: memStore(), workspace: process.cwd() });
    const share = await sync.createTempShare({ title: '北向洋流', content: '# 正文\n<script>alert(1)</script>', ttlMs: 60_000 });
    assert.match(share.token, /^[a-f0-9]{32}$/);
    const html = await (await fetch(share.loopbackUrl)).text();
    assert.match(html, /北向洋流/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    const markdown = await (await fetch(share.loopbackUrl + '.md')).text();
    assert.equal(markdown, '# 正文\n<script>alert(1)</script>');
    assert.equal(sync.status().tempShareCount, 1);
    await sync.stopTempShare();
    assert.equal(sync.status().tempShareCount, 0);
  });

  test('主进程、预加载、BrowserView 抓帧、视觉 OCR 与收藏面板入口齐套', () => {
    const searx = src('main/searx.js');
    const preload = src('preload/bridge.js');
    const browser = src('renderer/modules/browser/index.js');
    const runtime = src('renderer/modules/browser/clip-runtime.js');
    const favmgr = src('renderer/panels/favmgr.html');
    const main = src('main/main.js');
    assert.ok(searx.includes("bus.handle('clip:fetchImage'") && preload.includes("'clip:fetchImage'"));
    assert.ok(preload.includes("'sync:tempShare'") && main.includes('const lanSync = new LanSync') && main.includes('lanSync.stop()'));
    assert.ok(browser.includes('browser.clipBookmarks') && browser.includes('browser.clipUrlList') && browser.includes('browser.shareLocal'));
    assert.ok(runtime.includes("invoke('bv:capture'") && runtime.includes('visionChat') && runtime.includes('concurrency: 2') && runtime.includes('mazz-res://workspace/'));
    assert.ok(main.includes("rel.startsWith('workspace/')") && main.includes('stat.size > 8 * 1024 * 1024'));
    assert.ok(favmgr.includes('id="clipall"') && favmgr.includes("type: 'clipBookmarks'"));
  });
});
