// W88 Library security and workspace/import-race gates.
//
// This is deliberately an integration contract rather than a source-string
// assertion: persisted metadata must stay inert in the actual shelf, TOC and
// clean-rule DOM, and an import may never cross the repository workspace that
// owns the Library tab.  Safe implementations may reject a stale import or
// rebind it to the new workspace, but they may not leak it into the old one.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';
import { createLibraryRepository } from '../../renderer/modules/library/repository.js';
import { processHtmlText } from '../../renderer/modules/library/clean.js';
import { parseEpub, EPUB_CHAPTER_IMAGE_LIMITS } from '../../renderer/modules/library/epub.js';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const ATTACKS = Object.freeze({
  title: '<img data-w88-xss="title" src=x>',
  author: '<svg data-w88-xss="author"></svg>',
  category: '<details open data-w88-xss="category">分类</details>',
  toc: '<iframe data-w88-xss="toc"></iframe>',
  ruleName: '<img data-w88-xss="rule-name" src=x>',
  pattern: '</span><img data-w88-xss="rule-pattern" src=x><span>',
  replacement: '<svg data-w88-xss="rule-replacement"></svg>',
});

async function maliciousEpubB64() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
  zip.file('OPS/content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title><![CDATA[${ATTACKS.title}]]></dc:title><dc:creator><![CDATA[${ATTACKS.author}]]></dc:creator></metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine toc="ncx"><itemref idref="c1"/></spine>
    </package>`);
  zip.file('OPS/toc.ncx', `<?xml version="1.0"?>
    <ncx><navMap><navPoint id="n1"><navLabel><text><![CDATA[${ATTACKS.toc}]]></text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>`);
  zip.file('OPS/chapter.xhtml', `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:svg="http://www.w3.org/2000/svg">
      <head>
        <meta http-equiv="refresh" content="0;url=https://evil.invalid/refresh"/>
        <base href="https://evil.invalid/base/"/>
        <link rel="stylesheet" href="https://evil.invalid/book.css"/>
        <style>@import "https://evil.invalid/import.css"; .leak { background:url(https://evil.invalid/bg.png) }</style>
      </head>
      <body onload="fetch('https://evil.invalid/onload')">
        <meta http-equiv="refresh" content="0;url=https://evil.invalid/body-refresh"/>
        <base href="https://evil.invalid/body-base/"/>
        <link rel="stylesheet" href="https://evil.invalid/body.css"/>
        <style>.body-leak { background:url(https://evil.invalid/body-bg.png) }</style>
        <p id="local">W88 inert chapter body</p>
        <img id="local-raster" src="images/safe.png" srcset="https://evil.invalid/2x.png 2x"
          imagesrcset="images/safe.png 1x" lowsrc="images/safe.png" dynsrc="//evil.invalid/dynamic.png"
          style="background:url(https://evil.invalid/inline.png)" onerror="fetch('https://evil.invalid/error')"/>
        <img id="remote-raster" src="https://evil.invalid/remote.png"/>
        <a id="remote-link" href="https://evil.invalid/link" ping="https://evil.invalid/ping"
          style="background:url(https://evil.invalid/link-bg.png)" onclick="location='https://evil.invalid/click'">external</a>
        <a id="fragment-link" href="#local">local fragment</a>
        <video src="https://evil.invalid/movie.mp4" poster="https://evil.invalid/poster.png">
          <source src="https://evil.invalid/movie.webm"/><track src="https://evil.invalid/sub.vtt"/>
        </video>
        <audio src="https://evil.invalid/audio.mp3"/>
        <svg:svg>
          <svg:use href="https://evil.invalid/icons.svg#x"/>
          <svg:foreignObject><iframe src="https://evil.invalid/frame"/></svg:foreignObject>
          <svg:image id="local-svg-image" href="images/safe.png" onerror="alert(1)"/>
        </svg:svg>
        <div id="css-value" data-image="url(https://evil.invalid/data.png)" style="color:red">safe text</div>
      </body>
    </html>`);
  // Valid 1x1 PNG: the sanitizer must retain ZIP-local images through the
  // libimg materialization path while rejecting every network carrier above.
  zip.file('OPS/images/safe.png', Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
  return (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
}

async function manyImageEpubBuffer(imageCount) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
  zip.file('OPS/content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Many image budget</dc:title></metadata>
      <manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`);
  zip.file('OPS/chapter.xhtml', `<html><body>${Array.from({ length: imageCount }, (_, i) =>
    `<img id="many-${i}" src="images/${i}.png"/>`).join('')}</body></html>`);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  for (let i = 0; i < imageCount; i++) zip.file(`OPS/images/${i}.png`, png);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function assertLocalOnlyChapter(html, { materialized = false } = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const forbiddenElements = doc.body.querySelectorAll(
    'meta,base,link,style,script,iframe,frame,object,embed,audio,video,source,track,foreignObject,use,form,input,button',
  );
  assert.equal(forbiddenElements.length, 0,
    `automatic request/script carriers survived: ${[...forbiddenElements].map(node => node.outerHTML).join(' | ')}`);
  for (const element of doc.body.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      // Namespace identifiers are inert identifiers, not navigable resource
      // URLs; XML serialization may re-introduce them even after source attrs
      // were removed.
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      assert.ok(!name.startsWith('on'), `event handler survived: ${name}=${value}`);
      assert.notEqual(name, 'style', `inline CSS survived on ${element.tagName}`);
      assert.notEqual(name, 'srcset', `srcset survived on ${element.tagName}`);
      assert.ok(!['imagesrcset', 'dynsrc', 'lowsrc', 'srcdoc'].includes(name),
        `legacy/deferred request carrier survived: ${name}=${value}`);
      const controlledImage = materialized
        && ['src', 'href'].includes(name)
        && /^(?:blob:|data:image\/)/.test(value)
        && ['IMG', 'IMAGE'].includes(String(element.localName || element.tagName).split(':').pop().toUpperCase());
      assert.ok(controlledImage || !/(?:https?|file|ftp|javascript|vbscript|data|blob)\s*:|(?:^|\s|["'(])\/\/|url\s*\(|@import\b/i.test(value),
        `remote/active attribute survived: ${name}=${value}`);
    }
  }
  assert.equal(doc.querySelector('#remote-raster'), null, 'remote image element must be removed');
  assert.equal(doc.querySelector('#remote-link')?.hasAttribute('href'), false, 'remote link target must be stripped');
  assert.equal(doc.querySelector('#fragment-link')?.getAttribute('href'), '#local', 'same-document fragment must remain usable');
  return doc;
}

function createBridge({ workspace = 'D:/W88-Security', fileBase64 = '', delayWrites = false } = {}) {
  const settings = new Map();
  const files = new Map();
  const writes = [];
  const listeners = new Map();
  let activeWorkspace = workspace;
  let progressOk = true;
  let progressDelay = 0;
  let progressPutPlan = [];
  let progressPutHits = 0;
  let failSettingsFor = '';
  let settingsGateFor = '';
  let settingsGate = null;
  let settingsGateHits = 0;
  const invoke = async (channel, payload = {}) => {
    if (channel === 'workspace:get') return activeWorkspace;
    const settingsKeys = Array.isArray(payload.entries)
      ? payload.entries.map(entry => String(entry?.key || ''))
      : [String(payload.key || '')];
    if (channel.startsWith('settings:') && settingsGate && settingsGateFor
        && settingsKeys.some(key => key.includes(settingsGateFor))) {
      settingsGateHits++;
      await settingsGate;
    }
    if (channel.startsWith('settings:') && failSettingsFor
        && settingsKeys.some(key => key.includes(failSettingsFor))) {
      throw Object.assign(new Error('simulated repository bootstrap failure'), { code: 'EIO' });
    }
    if (channel === 'settings:get') return settings.has(payload.key)
      ? structuredClone(settings.get(payload.key))
      : null;
    if (channel === 'settings:set') {
      settings.set(payload.key, structuredClone(payload.value));
      return true;
    }
    if (channel === 'settings:compareAndSet') {
      const entries = Array.isArray(payload.entries) ? payload.entries : [payload];
      for (const entry of entries) {
        const current = settings.has(entry.key) ? settings.get(entry.key) : null;
        if (JSON.stringify(current) !== JSON.stringify(entry.expected)) {
          return { ok: false, key: entry.key, current: structuredClone(current) };
        }
      }
      for (const entry of entries) settings.set(entry.key, structuredClone(entry.value));
      return { ok: true };
    }
    if (channel === 'fs:readFileBase64') return files.get(payload.path) || fileBase64;
    if (channel === 'fs:stat') return { exists: files.has(payload.path), size: 0, mtime: 0 };
    if (channel === 'fs:mkdir') return true;
    if (channel === 'fs:writeFileBase64') {
      if (delayWrites) await wait(15);
      writes.push(payload.path);
      files.set(payload.path, payload.base64);
      return true;
    }
    return null;
  };
  const on = (channel, callback) => {
    let bucket = listeners.get(channel);
    if (!bucket) listeners.set(channel, bucket = new Set());
    bucket.add(callback);
    return () => bucket.delete(callback);
  };
  const emit = (channel, payload) => {
    for (const callback of [...(listeners.get(channel) || [])]) callback(payload);
  };
  return {
    settings, files, writes, invoke, on, emit,
    progress: {
      put: async () => {
        progressPutHits++;
        const planned = progressPutPlan.length ? progressPutPlan.shift() : null;
        const delay = planned && typeof planned === 'object'
          ? Math.max(0, Number(planned.delay) || 0)
          : progressDelay;
        if (delay) await wait(delay);
        if (planned == null) return progressOk;
        return typeof planned === 'object' ? planned.ok !== false : planned !== false;
      },
      flushAll: async () => { if (progressDelay) await wait(progressDelay); return progressOk; },
    },
    get workspace() { return activeWorkspace; },
    set workspace(value) { activeWorkspace = value; },
    get progressOk() { return progressOk; },
    set progressOk(value) { progressOk = value !== false; },
    get progressDelay() { return progressDelay; },
    set progressDelay(value) { progressDelay = Math.max(0, Number(value) || 0); },
    get progressPutHits() { return progressPutHits; },
    set progressPutPlan(value) { progressPutPlan = Array.isArray(value) ? [...value] : []; },
    get failSettingsFor() { return failSettingsFor; },
    set failSettingsFor(value) { failSettingsFor = String(value || ''); },
    get settingsGateHits() { return settingsGateHits; },
    setSettingsGate(match, promise) {
      settingsGateFor = String(match || '');
      settingsGate = promise ? Promise.resolve(promise) : null;
      settingsGateHits = 0;
    },
  };
}

function installHost(bridge) {
  window.mazz = { invoke: bridge.invoke, on: bridge.on };
  window.MazzCommands = { execute: () => {} };
  window.MazzHost = {
    notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {},
  };
  window.MazzProgress = bridge.progress;
}

const { default: libraryModule } = await import('../../renderer/modules/library/index.js');

async function mountLibrary(bridge) {
  installHost(bridge);
  const container = document.createElement('div');
  document.body.appendChild(container);
  libraryModule.create(container);
  const ctl = libraryModule._forTests.instances.get(container);
  // create() already owns repository.init(); invoking it a second time here
  // creates a false concurrent migration/CAS claimant instead of waiting for
  // the product bootstrap. Observe that owner rather than racing it.
  for (let i = 0; i < 30 && !ctl.repository.identity; i++) await wait(10);
  assert.ok(ctl.repository.identity, 'Library repository bootstrap did not settle');
  await wait(140);
  return { container, ctl };
}

function assertNoInjectedElement(scope, label) {
  const injected = scope.querySelectorAll('[data-w88-xss]');
  assert.equal(injected.length, 0,
    `${label}: persisted strings must be text/attributes only, generated ${[...injected].map(node => node.outerHTML).join(' | ')}`);
}

describe('W88 Library persisted-string XSS boundary', () => {
  test('title / author / category / TOC remain text and never generate DOM elements', async () => {
    const b64 = await maliciousEpubB64();
    const bridge = createBridge({ fileBase64: b64 });
    bridge.files.set('D:/W88-Security/书库/evil.epub', b64);
    bridge.settings.set('library.books', [{
      id: 'evil-book', title: ATTACKS.title, author: ATTACKS.author,
      category: ATTACKS.category, cover: '', path: 'D:/W88-Security/书库/evil.epub',
      format: 'epub', addedAt: 1,
    }]);
    bridge.settings.set('library.categories', [ATTACKS.category]);
    const { container, ctl } = await mountLibrary(bridge);
    try {
      assertNoInjectedElement(container, 'shelf metadata');
      assert.equal(container.querySelector('.lib-card-title')?.textContent, ATTACKS.title);
      assert.equal(container.querySelector('.lib-card-author')?.textContent, ATTACKS.author);
      assert.equal(container.querySelector('.lib-card-cat')?.textContent, ATTACKS.category);

      assert.equal(await ctl.openBook('evil-book'), true);
      await wait(140);
      const frame = container.querySelector('iframe.lib-book-frame');
      assert.ok(frame, 'EPUB reader must render inside the constrained reader frame');
      assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin',
        'reader sandbox may retain origin access for the host but must not grant script execution');
      assert.ok(!frame.getAttribute('sandbox').includes('allow-scripts'), 'reader sandbox must not allow scripts');
      assert.ok(frame.srcdoc.includes('Content-Security-Policy') && frame.srcdoc.includes("default-src 'none'"),
        'the actual reader srcdoc must bootstrap with a deny-by-default CSP');
      const csp = frame.contentDocument?.querySelector('meta[data-mazz-reader-csp]')?.getAttribute('content') || '';
      assert.ok(csp.includes("default-src 'none'"), `reader document lost default deny CSP: ${csp}`);
      assert.ok(csp.includes("connect-src 'none'") && csp.includes("media-src 'none'"),
        `reader document must block network and media: ${csp}`);
      assert.ok(csp.includes('img-src blob: data:'), `reader document must allow only materialized local images: ${csp}`);
      container.querySelector('[data-a="toc"]').click();
      await wait(20);
      assertNoInjectedElement(container, 'EPUB TOC');
      assert.equal(container.querySelector('.lib-toc-item')?.textContent, ATTACKS.toc);
    } finally {
      ctl.destroy();
      container.remove();
    }
  });

  test('chapter sanitization removes every automatic request carrier while ZIP-local images still render', async () => {
    const b64 = await maliciousEpubB64();
    const epub = await parseEpub(Buffer.from(b64, 'base64'));
    try {
      const raw = await epub.loadChapterRaw(epub.spine[0]);
      assert.equal(raw.images.length, 2, 'both HTML and SVG ZIP-local image references must enter the controlled image ledger');
      assert.ok(raw.html.includes('libimg:0') && raw.html.includes('libimg:1'),
        `local images were not rewritten to inert placeholders: ${raw.html}`);
      const rawDoc = assertLocalOnlyChapter(raw.html);
      assert.equal(rawDoc.querySelector('#local-raster')?.getAttribute('src'), 'libimg:0');
      assert.equal(rawDoc.querySelector('#local-svg-image')?.getAttribute('href'), 'libimg:1');

      const renderedChapter = await epub.loadChapter(epub.spine[0]);
      const rendered = renderedChapter?.html || '';
      assert.ok(!rendered.includes('libimg:'), `placeholder escaped materialization: ${rendered}`);
      const renderedDoc = assertLocalOnlyChapter(rendered, { materialized: true });
      const urls = [
        renderedDoc.querySelector('#local-raster')?.getAttribute('src'),
        renderedDoc.querySelector('#local-svg-image')?.getAttribute('href'),
      ];
      assert.ok(urls.every(url => /^(?:blob:|data:image\/)/.test(url || '')),
        `ZIP-local images must materialize to renderer-owned blob/data URLs: ${JSON.stringify(urls)}`);
      assert.ok(!rendered.includes('evil.invalid'), `remote endpoint survived sanitized materialization: ${rendered}`);
    } finally {
      epub.unloadAll();
    }
  });

  test('a real many-entry EPUB stops image decompression at the per-chapter count budget', async () => {
    const total = EPUB_CHAPTER_IMAGE_LIMITS.count + 3;
    const epub = await parseEpub(await manyImageEpubBuffer(total));
    const reads = [];
    try {
      for (let i = 0; i < total; i++) {
        const entry = epub.zip.file(`OPS/images/${i}.png`);
        const stream = entry.internalStream.bind(entry);
        entry.internalStream = (...args) => { reads.push(i); return stream(...args); };
      }
      const chapter = await epub.loadChapter(epub.spine[0]);
      assert.deepEqual(reads, Array.from({ length: EPUB_CHAPTER_IMAGE_LIMITS.count }, (_, i) => i),
        'budget exhaustion must prevent every later ZIP entry from starting decompression');
      assert.doesNotMatch(chapter.html, /libimg:/, 'budgeted HTML must not retain a live custom-scheme placeholder');
      const doc = new DOMParser().parseFromString(`<body>${chapter.html}</body>`, 'text/html');
      assert.equal(doc.querySelectorAll('[data-libimg-missing]').length, 3,
        'every image past the count budget must degrade to an inert missing marker');
      const controlled = [...doc.querySelectorAll('img')]
        .filter(image => /^(?:blob:|data:image\/)/.test(image.getAttribute('src') || ''));
      assert.equal(controlled.length, EPUB_CHAPTER_IMAGE_LIMITS.count,
        'all images inside the count budget must remain readable');
      assert.ok(epub.liveImageCount() <= EPUB_CHAPTER_IMAGE_LIMITS.count,
        `live blob ownership exceeded the chapter budget: ${epub.liveImageCount()}`);
    } finally {
      epub.unloadAll();
      assert.equal(epub.liveImageCount(), 0);
    }
  });

  test('rule name / pattern / replacement remain inert in rule manager and in processed book HTML', async () => {
    const bridge = createBridge();
    const textPath = 'D:/W88-Security/书库/rules.txt';
    bridge.files.set(textPath, Buffer.from('needle', 'utf8').toString('base64'));
    bridge.settings.set('library.books', [{
      id: 'rules-book', title: 'Rules book', author: '', category: '', cover: '',
      path: textPath, format: 'txt', addedAt: 1,
    }]);
    bridge.settings.set('library.cleanrules', [
      { name: ATTACKS.ruleName, pattern: 'needle', match: 'plain', type: 'replace', replacement: ATTACKS.replacement, scope: 'all' },
      { name: '', pattern: ATTACKS.pattern, match: 'plain', type: 'delete', replacement: '', scope: 'all' },
    ]);
    const { container, ctl } = await mountLibrary(bridge);
    try {
      assert.equal(await ctl.openBook('rules-book'), true, 'rule manager requires a live reader owner');
      container.querySelector('[data-a="clean-rules"]').click();
      await wait(60);
      const dialog = document.querySelector('.cr-list')?.closest('[role="dialog"],.modal,.mazz-modal') || document.body;
      assertNoInjectedElement(dialog, 'clean-rule manager');
      const ruleText = document.querySelector('.cr-list')?.textContent || '';
      assert.ok(ruleText.includes(ATTACKS.ruleName), 'rule name must remain readable as literal text');
      assert.ok(ruleText.includes(ATTACKS.replacement), 'replacement must remain readable as literal text');

      const processed = processHtmlText('<p>needle</p>', {
        rules: [{ pattern: 'needle', match: 'plain', type: 'replace', replacement: ATTACKS.replacement }],
      });
      const parsed = new DOMParser().parseFromString(processed, 'text/html');
      assertNoInjectedElement(parsed, 'processed chapter replacement');
      assert.ok(parsed.body.textContent.includes(ATTACKS.replacement), 'replacement is text, not markup');
    } finally {
      ctl.destroy();
      container.remove();
      document.querySelectorAll('.mazz-palette-mask,.modal-mask,.mazz-modal-mask').forEach(node => node.remove());
    }
  });
});

describe('W88 Library workspace/import race boundary', () => {
  test('a live Library tab retires A durably before rebinding its shelf and locator to B', async () => {
    const bridge = createBridge({ workspace: 'D:/Owner-A', fileBase64: Buffer.from('fallback').toString('base64') });
    const aPath = 'D:/Owner-A/书库/a.txt';
    const bPath = 'D:/Owner-B/书库/b.txt';
    bridge.files.set(aPath, Buffer.from('owner A chapter').toString('base64'));
    bridge.files.set(bPath, Buffer.from('owner B chapter').toString('base64'));
    const repoASeed = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Owner-A' });
    const repoBSeed = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Owner-B' });
    await repoASeed.mutateBooks(() => [{
      id: 'owner-a-book', title: 'Only A', author: '', category: '未分类', cover: '',
      path: aPath, sourcePath: aPath, format: 'txt', addedAt: 1,
    }]);
    await repoBSeed.mutateBooks(() => [{
      id: 'owner-b-book', title: 'Only B', author: '', category: '未分类', cover: '',
      path: bPath, sourcePath: bPath, format: 'txt', addedAt: 2,
    }]);

    const { container, ctl } = await mountLibrary(bridge);
    try {
      assert.equal(ctl.repository.identity.canonical, 'd:/owner-a');
      assert.equal(await ctl.openBook('owner-a-book'), true);
      const oldRepository = ctl.repository;
      const before = {
        open: ctl._openGen, search: ctl._searchGen, export: ctl._exportGen,
        lifecycle: ctl._lifecycleGen,
      };

      bridge.workspace = 'D:/Owner-B';
      bridge.emit('workspace:changed', { path: 'D:/Owner-B' });
      // Owner invalidation is synchronous, before repository init/IO yields.
      assert.equal(ctl.book?.meta?.id, 'owner-a-book',
        'old reader owner must stay alive until durability and B bootstrap both succeed');
      assert.equal(container.querySelector('.lib-reader').style.display, 'flex');
      assert.equal(container.querySelector('.lib-root').inert, true, 'old shelf must not accept actions during hand-off');
      assert.ok(ctl._openGen > before.open && ctl._searchGen > before.search
        && ctl._exportGen > before.export && ctl._lifecycleGen > before.lifecycle,
      'workspace hand-off must invalidate every async UI producer before awaiting');

      for (let i = 0; i < 80 && ctl.repository.identity?.canonical !== 'd:/owner-b'; i++) await wait(10);
      await ctl._workspaceRebindTail;
      assert.notEqual(ctl.repository, oldRepository, 'repository object must be replaced, not relabelled');
      assert.equal(ctl.book, null, 'old reader owner must release in the successful binding commit');
      assert.equal(ctl.repository.identity.canonical, 'd:/owner-b');
      assert.equal(ctl.locatorStore, ctl.repositoryBinding.locatorStore,
        'locator owner must change in the same commit as the repository');
      assert.equal(container.querySelector('.lib-root').inert, false);
      assert.deepEqual((await ctl.repository.listBooks()).map(book => book.id), ['owner-b-book']);
      assert.equal(container.querySelector('.lib-card-title')?.textContent, 'Only B',
        'visible shelf must be painted only after B becomes the canonical owner');

      const oldProgress = await oldRepository.getValue('progress');
      assert.ok(oldProgress['owner-a-book'], 'A reader locator must be flushed into A before B installs');
      assert.deepEqual(await ctl.repository.getValue('progress'), {},
        'A locator must never be redirected into B');

      bridge.files.set('E:/Incoming/after-rebind.txt', Buffer.from('new B import').toString('base64'));
      const imported = await ctl.importPath('E:/Incoming/after-rebind.txt', { silent: true });
      assert.ok(imported, 'new owner must accept work after the rebind gate opens');
      assert.equal((await oldRepository.listBooks()).some(book => book.id === imported), false,
        'post-rebind durable work leaked back into A');
      assert.equal((await ctl.repository.listBooks()).some(book => book.id === imported), true,
        'post-rebind durable work did not land in B');
    } finally {
      ctl.detachWorkspaceRebind();
      await ctl.destroy();
      container.remove();
    }
  });

  test('rapid workspace events coalesce and never expose the obsolete middle repository', async () => {
    const bridge = createBridge({ workspace: 'D:/Rapid-A' });
    const { container, ctl } = await mountLibrary(bridge);
    try {
      bridge.workspace = 'D:/Rapid-B';
      bridge.emit('workspace:changed', { path: 'D:/Rapid-B' });
      bridge.workspace = 'D:/Rapid-C';
      bridge.emit('workspace:changed', { path: 'D:/Rapid-C' });
      await ctl._workspaceRebindTail;
      assert.equal(ctl.repository.identity.canonical, 'd:/rapid-c');
      assert.equal(ctl._workspaceRebinding, false);
      assert.equal(container.querySelector('.lib-root').inert, false);
    } finally {
      ctl.detachWorkspaceRebind();
      await ctl.destroy();
      container.remove();
    }
  });

  test('failed durability preflight restores the exact old owner and a later workspace event can retry', async () => {
    const bridge = createBridge({ workspace: 'D:/Retry-A' });
    const path = 'D:/Retry-A/书库/retry.txt';
    bridge.files.set(path, Buffer.from('retry owner').toString('base64'));
    const seed = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Retry-A' });
    await seed.mutateBooks(() => [{
      id: 'retry-book', title: 'Retry owner', author: '', category: '未分类', cover: '',
      path, sourcePath: path, format: 'txt', addedAt: 1,
    }]);
    const { container, ctl } = await mountLibrary(bridge);
    try {
      assert.equal(await ctl.openBook('retry-book'), true);
      const oldRepository = ctl.repository;
      const oldBook = ctl.book;
      bridge.progressOk = false;
      bridge.workspace = 'D:/Retry-B';
      bridge.emit('workspace:changed', { path: 'D:/Retry-B' });
      assert.equal(await ctl._workspaceRebindTail, false);

      assert.equal(ctl.repository, oldRepository, 'failed preflight must not publish the B repository');
      assert.equal(ctl.book, oldBook, 'failed preflight must not dispose the live A reader handle');
      assert.equal(ctl.repository.identity.canonical, 'd:/retry-a');
      assert.equal(ctl._workspaceRebinding, false);
      assert.equal(ctl.repositoryBinding.retiring, false);
      assert.equal(container.querySelector('.lib-root').inert, false);
      assert.equal(container.querySelector('.lib-reader').style.display, 'flex');

      bridge.progressOk = true;
      bridge.emit('workspace:changed', { path: 'D:/Retry-B' });
      assert.equal(await ctl._workspaceRebindTail, true, 'a later event must retry from a fresh A snapshot');
      assert.equal(ctl.repository.identity.canonical, 'd:/retry-b');
      assert.equal(ctl.book, null);
    } finally {
      ctl.detachWorkspaceRebind();
      await ctl.destroy();
      container.remove();
    }
  });

  test('new repository bootstrap failure never releases A or leaves the Library inert', async () => {
    const bridge = createBridge({ workspace: 'D:/Bootstrap-A' });
    const targetProbe = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Bootstrap-B' });
    await targetProbe.init();
    const { container, ctl } = await mountLibrary(bridge);
    try {
      const oldRepository = ctl.repository;
      bridge.failSettingsFor = targetProbe.identity.hash;
      bridge.workspace = 'D:/Bootstrap-B';
      bridge.emit('workspace:changed', { path: 'D:/Bootstrap-B' });
      assert.equal(await ctl._workspaceRebindTail, false);
      assert.equal(ctl.repository, oldRepository);
      assert.equal(ctl.repository.identity.canonical, 'd:/bootstrap-a');
      assert.equal(ctl._workspaceRebinding, false);
      assert.equal(ctl.repositoryBinding.retiring, false);
      assert.equal(container.querySelector('.lib-root').inert, false);

      bridge.failSettingsFor = '';
      bridge.emit('workspace:changed', { path: 'D:/Bootstrap-B' });
      assert.equal(await ctl._workspaceRebindTail, true);
      assert.equal(ctl.repository.identity.canonical, 'd:/bootstrap-b');
    } finally {
      ctl.detachWorkspaceRebind();
      await ctl.destroy();
      container.remove();
    }
  });

  test('failed rebind cannot unlock reader actions while destroy owns the final locator snapshot', async () => {
    const bridge = createBridge({ workspace: 'D:/Close-Race-A' });
    const path = 'D:/Close-Race-A/书库/race.txt';
    bridge.files.set(path, Buffer.from('close race owner').toString('base64'));
    const seed = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Close-Race-A' });
    await seed.mutateBooks(() => [{
      id: 'close-race-book', title: 'Close race', author: '', category: '未分类', cover: '',
      path, sourcePath: path, format: 'txt', addedAt: 1,
    }]);
    const { container, ctl } = await mountLibrary(bridge);
    let closed = false;
    try {
      assert.equal(await ctl.openBook('close-race-book'), true);
      const oldBook = ctl.book;
      bridge.progressOk = false;
      bridge.progressDelay = 20;
      bridge.workspace = 'D:/Close-Race-B';
      bridge.emit('workspace:changed', { path: 'D:/Close-Race-B' });
      const destroying = ctl.destroy();
      await wait(5);
      assert.equal(ctl._destroying, true);
      assert.equal(container.querySelector('.lib-root').inert, true,
        'rebind rollback must not unlock actions during destroy preflight');
      await assert.rejects(destroying, error => error?.code === 'LIBRARY_LOCATOR_DURABILITY_FAILED');
      assert.equal(await ctl._workspaceRebindTail, false);
      assert.equal(ctl._destroyed, false);
      assert.equal(ctl.book, oldBook);
      assert.equal(ctl._workspaceRebinding, false);
      assert.equal(container.querySelector('.lib-root').inert, false,
        'after close failure the old owner must become usable and retryable');

      bridge.progressOk = true;
      bridge.progressDelay = 0;
      assert.equal(await ctl.destroy(), true);
      closed = true;
    } finally {
      if (!closed) {
        bridge.progressOk = true;
        bridge.progressDelay = 0;
        ctl.detachWorkspaceRebind();
        await ctl.destroy().catch(() => null);
      }
      container.remove();
    }
  });

  test('successful rebind waits out a failing destroy preflight and publishes B interactive exactly once', async () => {
    const bridge = createBridge({ workspace: 'D:/Commit-Race-A' });
    const aPath = 'D:/Commit-Race-A/书库/race.txt';
    bridge.files.set(aPath, Buffer.from('commit race owner').toString('base64'));
    const seed = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Commit-Race-A' });
    await seed.mutateBooks(() => [{
      id: 'commit-race-book', title: 'Commit race', author: '', category: '未分类', cover: '',
      path: aPath, sourcePath: aPath, format: 'txt', addedAt: 1,
    }]);
    const targetProbe = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Commit-Race-B' });
    await targetProbe.init();

    const { container, ctl } = await mountLibrary(bridge);
    let closed = false;
    const bootstrapGate = deferred();
    try {
      assert.equal(await ctl.openBook('commit-race-book'), true);
      const oldRepository = ctl.repository;
      bridge.setSettingsGate(targetProbe.identity.hash, bootstrapGate.promise);
      // Rebind A locator succeeds. The later destroy snapshot reaches the same
      // progress projection but fails slowly, leaving B enough time to warm.
      bridge.progressPutPlan = [{ ok: true }, { ok: false, delay: 120 }];
      bridge.workspace = 'D:/Commit-Race-B';
      bridge.emit('workspace:changed', { path: 'D:/Commit-Race-B' });

      for (let i = 0; i < 80 && bridge.settingsGateHits < 1; i++) await wait(2);
      assert.ok(bridge.settingsGateHits > 0, 'B warmup must be held after A durability completed');

      const destroying = ctl.destroy();
      for (let i = 0; i < 80 && bridge.progressPutHits < 2; i++) await wait(2);
      assert.equal(bridge.progressPutHits, 2, 'destroy must own its independent final A locator write');
      bootstrapGate.resolve();
      await wait(30);

      assert.equal(ctl._destroying, true, 'the slow destroy durability gate must still own the controller');
      assert.equal(ctl.repository, oldRepository,
        'B must not become observable while destroy still owns A final locator snapshot');
      assert.equal(container.querySelector('.lib-root').inert, true,
        'no success path may unlock the tab during destroy preflight');

      await assert.rejects(destroying, error => error?.code === 'LIBRARY_LOCATOR_DURABILITY_FAILED');
      assert.equal(await ctl._workspaceRebindTail, true,
        'after close failure the already-warmed rebind must finish rather than strand the tab');
      assert.equal(ctl._destroyed, false);
      assert.equal(ctl._workspaceRebinding, false);
      assert.equal(ctl.repository.identity.canonical, 'd:/commit-race-b');
      assert.equal(container.querySelector('.lib-root').inert, false,
        'B must be interactive after every lifecycle owner releases its inert lock');

      assert.equal(await ctl.destroy(), true);
      closed = true;
    } finally {
      bootstrapGate.resolve();
      if (!closed) {
        bridge.progressOk = true;
        bridge.progressPutPlan = [];
        ctl.detachWorkspaceRebind();
        await ctl.destroy().catch(() => null);
      }
      container.remove();
    }
  });

  test('aborted Back releases only its own inert lock while a failing destroy remains authoritative', async () => {
    const bridge = createBridge({ workspace: 'D:/Back-Close-Race' });
    const path = 'D:/Back-Close-Race/书库/race.txt';
    bridge.files.set(path, Buffer.from('back close race').toString('base64'));
    const seed = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Back-Close-Race' });
    await seed.mutateBooks(() => [{
      id: 'back-close-book', title: 'Back close race', author: '', category: '未分类', cover: '',
      path, sourcePath: path, format: 'txt', addedAt: 1,
    }]);

    const { container, ctl } = await mountLibrary(bridge);
    let closed = false;
    try {
      assert.equal(await ctl.openBook('back-close-book'), true);
      const oldBook = ctl.book;
      bridge.progressPutPlan = [{ ok: false, delay: 60 }];
      container.querySelector('[data-a="back"]').click();
      assert.equal(ctl._backPending, true);
      assert.equal(container.querySelector('.lib-root').inert, true);

      const destroying = ctl.destroy();
      await wait(10);
      assert.equal(ctl._backPending, false, 'destroy generation must abort the older Back transaction');
      assert.equal(ctl._destroying, true);
      assert.equal(container.querySelector('.lib-root').inert, true,
        'Back may release only its own lock; destroy still owns interaction exclusion');

      await assert.rejects(destroying, error => error?.code === 'LIBRARY_LOCATOR_DURABILITY_FAILED');
      assert.equal(ctl._destroyed, false);
      assert.equal(ctl.book, oldBook);
      assert.equal(container.querySelector('.lib-root').inert, false,
        'failed destroy must not replay the stale Back-era inert state');

      bridge.progressPutPlan = [];
      assert.equal(await ctl.destroy(), true);
      closed = true;
    } finally {
      if (!closed) {
        bridge.progressOk = true;
        bridge.progressPutPlan = [];
        ctl.detachWorkspaceRebind();
        await ctl.destroy().catch(() => null);
      }
      container.remove();
    }
  });

  test('a stale Library tab cannot persist a new-workspace import into its old repository', async () => {
    const bridge = createBridge({ workspace: 'D:/Race-A', fileBase64: Buffer.from('race payload').toString('base64') });
    const { container, ctl } = await mountLibrary(bridge);
    try {
      assert.equal(ctl.repository.identity.canonical, 'd:/race-a');
      bridge.workspace = 'D:/Race-B';
      const importedId = await ctl.importPath('E:/Incoming/race.txt', { silent: true });
      await wait(40);

      const oldBooks = await ctl.repository.listBooks();
      assert.deepEqual(oldBooks, [], 'workspace B import leaked into stale workspace A repository');

      const repoB = createLibraryRepository({ invoke: bridge.invoke, workspace: 'D:/Race-B' });
      const newBooks = await repoB.listBooks();
      if (importedId != null) {
        assert.ok(newBooks.some(book => book.id === importedId),
          'accepted stale import must be owned by the new workspace repository');
      } else {
        assert.equal(bridge.writes.length, 0,
          'a rejected stale import must stop before creating an orphan physical copy');
      }
    } finally {
      ctl.destroy();
      container.remove();
    }
  });

  test('parallel imports of one source converge to one durable id and one physical copy', async () => {
    const bridge = createBridge({
      workspace: 'D:/Race-Same', fileBase64: Buffer.from('same source bytes').toString('base64'), delayWrites: true,
    });
    const { container, ctl } = await mountLibrary(bridge);
    try {
      const results = await Promise.all([
        ctl.importPath('E:/Incoming/same.txt', { silent: true }),
        ctl.importPath('E:/Incoming/same.txt', { silent: true }),
      ]);
      const books = await ctl.repository.listBooks();
      assert.equal(books.length, 1, `parallel duplicate import must converge to one record, got ${books.length}`);
      assert.ok(results.every(id => id === books[0].id),
        `every caller must receive the durable id ${books[0].id}, got ${JSON.stringify(results)}`);
      assert.equal(bridge.writes.length, 1,
        `parallel duplicate import must share one copy operation, got ${bridge.writes.length}`);
    } finally {
      ctl.destroy();
      container.remove();
    }
  });
});
