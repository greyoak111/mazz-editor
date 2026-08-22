import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_READER_APPEARANCE,
  appearanceForReaderController,
  createReaderPreferencesStore,
  migrateReaderRecord,
  normalizeReaderAppearance,
  readerBookPrefsKey,
  readerPrefsKeys,
  readerWorkspacePrefsKey,
  splitReaderRecord,
} from '../../renderer/modules/library/reader-prefs.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(initial = {}) {
  const settings = new Map(Object.entries(initial));
  const calls = [];
  const invoke = async (channel, payload) => {
    calls.push({ channel, payload: structuredClone(payload || {}) });
    if (channel === 'workspace:get') return 'D:/Books';
    if (channel === 'settings:get') {
      await wait(3);
      return structuredClone(settings.get(payload.key) ?? null);
    }
    if (channel === 'settings:set') {
      await wait(2);
      settings.set(payload.key, structuredClone(payload.value));
      return true;
    }
    throw new Error(`unexpected ${channel}`);
  };
  return { invoke, calls, read: key => structuredClone(settings.get(key)) };
}

describe('Library reader preferences', () => {
  test('旧扁平记录严格拆成 locator / appearance，未知字段不丢', () => {
    const legacy = {
      chapter: 8,
      ratio: 1.7,
      spineItemId: '  ch-09  ',
      fontFamily: '  Source Han Serif  ',
      readTheme: 'night',
      mangaZoom: 900,
      mode: 'double',
      direction: 'rtl',
      coverSingle: false,
      spreadOffset: 3,
      fitMode: 'width',
      futureLocatorOrPlugin: { untouched: true },
    };
    const split = splitReaderRecord(legacy);
    assert.deepEqual(split.locator, { chapter: 8, ratio: 1, spineItemId: 'ch-09' });
    assert.equal(split.appearance.font, 'Source Han Serif');
    assert.equal(split.appearance.theme, 'night');
    assert.equal(split.appearance.zoom, 400, '缩放按可用范围钳制');
    assert.deepEqual(split.appearance.spread, { cover: false, parity: 1, fit: 'width' });
    assert.deepEqual(split.unknown.futureLocatorOrPlugin, { untouched: true });

    const migrated = migrateReaderRecord(legacy);
    assert.deepEqual(migrated.futureLocatorOrPlugin, { untouched: true });
    assert.equal(migrated.schema, 1);
    assert.equal(migrated.locator.chapter, 8);
    assert.equal(migrated.appearance.mode, 'double');
    assert.equal(Object.prototype.hasOwnProperty.call(migrated.appearance, 'chapter'), false);
  });

  test('外观规范化有稳定默认值、合理边界并保留扩展字段', () => {
    const appearance = normalizeReaderAppearance({
      mode: 'unsupported', direction: 'sideways', fontSize: 2, lineHeight: 8,
      pageWidth: 9, theme: 'custom-paper', zoom: 12,
      spread: { cover: true, parity: -3, fit: 'smart', gutter: 18 },
      narrationRate: 1.25,
    });
    assert.equal(appearance.mode, DEFAULT_READER_APPEARANCE.mode);
    assert.equal(appearance.direction, DEFAULT_READER_APPEARANCE.direction);
    assert.equal(appearance.fontSize, 10);
    assert.equal(appearance.lineHeight, 3.2);
    assert.equal(appearance.pageWidth, 1);
    assert.equal(appearance.theme, 'custom-paper');
    assert.equal(appearance.zoom, 25);
    assert.deepEqual(appearance.spread, { cover: true, parity: 1, fit: 'smart', gutter: 18 });
    assert.equal(appearance.narrationRate, 1.25);
  });

  test('workspace/book key 对分隔符与 Windows 大小写稳定，跨书严格隔离', () => {
    const a = readerPrefsKeys('D:\\Reading\\Shelf\\', { path: 'D:\\Reading\\Shelf\\A.epub' });
    const b = readerPrefsKeys('d:/reading/shelf', { path: 'd:/reading/shelf/a.epub' });
    assert.deepEqual(a, b);
    assert.equal(readerWorkspacePrefsKey('D:/Reading/Shelf'), a.workspace);
    assert.equal(readerBookPrefsKey('D:/Reading/Shelf', 'book-a'), readerBookPrefsKey('D:/Reading/Shelf', 'book-a'));
    assert.notEqual(readerBookPrefsKey('D:/Reading/Shelf', 'book-a'), readerBookPrefsKey('D:/Reading/Shelf', 'book-b'));
    assert.notEqual(readerWorkspacePrefsKey('D:/Reading/Shelf'), readerWorkspacePrefsKey('D:/Other/Shelf'));
    assert.match(a.book, /^library\.reader\.v1\.[0-9a-f]{16}\.book\.[0-9a-f]{16}\.appearance$/);
  });

  test('load 按 legacy < workspace < book 合并外观，同时单独归还定位证据', async () => {
    const keys = readerPrefsKeys('D:/Books', 'book-a');
    const fx = fixture({
      [keys.workspace]: {
        schema: 1,
        appearance: { fontSize: 19, theme: 'sepia', spread: { fit: 'height', workspaceOnly: true } },
      },
      [keys.book]: {
        schema: 1,
        locator: { page: 11 }, // 旧异常混存：读取但不当外观
        appearance: { theme: 'night', zoom: 135, spread: { parity: 1 } },
      },
    });
    const store = createReaderPreferencesStore({ invoke: fx.invoke, workspace: 'D:/Books', book: 'book-a' });
    const loaded = await store.load({
      legacyRecord: { chapter: 3, anchor: { t: 'quote' }, mode: 'scroll', fontSize: 17, coverSingle: false },
    });
    assert.equal(loaded.appearance.mode, 'scroll');
    assert.equal(loaded.appearance.fontSize, 19);
    assert.equal(loaded.appearance.theme, 'night');
    assert.equal(loaded.appearance.zoom, 135);
    assert.deepEqual(loaded.appearance.spread, {
      cover: false, parity: 1, fit: 'height', workspaceOnly: true,
    });
    assert.deepEqual(loaded.locator, { chapter: 3, anchor: { t: 'quote' }, page: 11 });
    assert.deepEqual(loaded.keys, keys);
  });

  test('外观读取故障 fail closed，不把暂态错误解释为默认值并回写覆盖', async () => {
    const keys = readerPrefsKeys('D:/Books', 'book-read-failed');
    const writes = [];
    let failed = false;
    const invoke = async (channel, payload) => {
      if (channel === 'settings:get') {
        if (!failed && payload.key === keys.book) {
          failed = true;
          throw Object.assign(new Error('temporary store outage'), { code: 'EIO' });
        }
        return payload.key === keys.book
          ? { schema: 1, appearance: { theme: 'night', fontSize: 24 } }
          : null;
      }
      if (channel === 'settings:set') {
        writes.push(structuredClone(payload));
        return true;
      }
      throw new Error(`unexpected ${channel}`);
    };
    const store = createReaderPreferencesStore({
      invoke, workspace: 'D:/Books', book: 'book-read-failed',
    });
    await assert.rejects(() => store.load(), error => error?.code === 'EIO');
    assert.equal(writes.length, 0, '失败的 load 不得生成默认外观写入');
    const retry = await store.load();
    assert.equal(retry.appearance.theme, 'night');
    assert.equal(retry.appearance.fontSize, 24);
  });

  test('并发 RMW 串行且调用瞬间快照；保留未知顶层/外观/locator 字段', async () => {
    const key = readerBookPrefsKey('D:/Books', 'book-a');
    const fx = fixture({
      [key]: {
        schema: 1,
        vendorStamp: { version: 7 },
        locator: { chapter: 4, futureAnchor: 'keep' },
        appearance: { mode: 'single', pluginContrast: 0.8, spread: { gutter: 12 } },
      },
    });
    const one = createReaderPreferencesStore({ invoke: fx.invoke, workspace: 'D:/Books', book: 'book-a' });
    const two = createReaderPreferencesStore({ invoke: fx.invoke, workspace: 'D:/Books', book: 'book-a' });
    const mutable = { fontSize: 22, customInk: '#123456', spread: { fit: 'width' } };
    const p1 = one.saveAppearance(mutable);
    mutable.fontSize = 70;
    mutable.spread.fit = 'mutated-after-call';
    const p2 = two.saveAppearance({ lineHeight: 2.15, spread: { parity: 1 } });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.ok, true); assert.equal(r2.ok, true);
    const stored = fx.read(key);
    assert.deepEqual(stored.vendorStamp, { version: 7 });
    assert.deepEqual(stored.locator, { chapter: 4, futureAnchor: 'keep' });
    assert.equal(stored.appearance.pluginContrast, 0.8);
    assert.equal(stored.appearance.customInk, '#123456');
    assert.equal(stored.appearance.fontSize, 22, 'save 必须同步快照 mutable patch');
    assert.equal(stored.appearance.lineHeight, 2.15, '第二次 RMW 不得覆盖第一次字段');
    assert.deepEqual(stored.appearance.spread, { gutter: 12, fit: 'width', parity: 1 });
    assert.deepEqual(await one.flush(), []);
  });

  test('外观 save 对交互返回失败回执，但 flush 向关闭耐久闸拒绝', async () => {
    const store = createReaderPreferencesStore({
      workspace: 'D:/Books', book: 'book-failed',
      invoke: async (channel) => {
        if (channel === 'settings:get') return null;
        if (channel === 'settings:set') throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        throw new Error(`unexpected ${channel}`);
      },
    });
    const receipt = await store.saveAppearance({ fontSize: 23 });
    assert.equal(receipt.ok, false, '普通控件事件不得产生 unhandled rejection');
    await assert.rejects(() => store.flush(), error => (
      error?.code === 'LIBRARY_APPEARANCE_DURABILITY_FAILED'
      && error.receipts?.[0]?.scope === 'book'
    ), '关闭/换书 flush 必须显式拒绝，不能把写盘失败伪装成功');
  });

  test('legacy migration 只写外观 key，定位由调用方交给 LocatorStore', async () => {
    const fx = fixture();
    const store = createReaderPreferencesStore({ invoke: fx.invoke, workspace: 'D:/Books', book: 'book-z' });
    const result = await store.migrateLegacy({
      page: 42, ratio: 0.6, anchor: { p: '2/1', t: '证据' },
      mode: 'vertical', direction: 'rtl', fontFamily: 'Noto Serif SC',
    });
    assert.deepEqual(result.locator, { page: 42, ratio: 0.6, anchor: { p: '2/1', t: '证据' } });
    assert.equal(result.appearance.mode, 'vertical');
    assert.equal(result.receipt.ok, true);
    const key = readerBookPrefsKey('D:/Books', 'book-z');
    const stored = fx.read(key);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'locator'), false, '新偏好记录不得重新混入 locator');
    assert.equal(stored.appearance.font, 'Noto Serif SC');
  });

  test('controller 适配只做字段别名，不改变规范值', () => {
    const ctl = appearanceForReaderController({
      mode: 'double', direction: 'rtl', font: 'Noto Serif SC', fontSize: 20,
      lineHeight: 2, pageWidth: 0.8, theme: 'night', zoom: 125,
      spread: { cover: false, parity: 1, fit: 'width' },
    });
    assert.deepEqual(ctl, {
      mode: 'double', direction: 'rtl', fontFamily: 'Noto Serif SC', fontSize: 20,
      lineHeight: 2, pageWidth: 0.8, readTheme: 'night', mangaZoom: 125,
      spreadCoverSingle: false, spreadParity: 1, spreadFit: 'width',
    });
  });

  test('W88 主链原子加载、耐久 flush、控件同步与全部外观入口已接线', () => {
    const source = readFileSync(new URL('../../renderer/modules/library/index.js', import.meta.url), 'utf8');
    const loadAt = source.indexOf('candidate._prefs.load({ legacyRecord: progress[id] })');
    const commitAt = source.indexOf('ctl.book = nextBook');
    assert.ok(loadAt > 0 && loadAt < commitAt, '候选偏好必须在原子换主之前完整加载');
    assert.match(source, /applyReaderAppearance\(nextBook\._appearance\)/);
    assert.match(source, /ctl\.spreadOffset\s*=\s*fields\.spreadParity/);
    assert.match(source, /root\._libSelectProxies\?\.get\(selector\)\?\.setCurrent/);

    const oldFlushAt = source.indexOf('oldBook ? flushReaderAppearance(oldBook)');
    const oldDisposeAt = source.indexOf('disposeBookHandle(oldBook)', oldFlushAt);
    assert.ok(oldFlushAt > 0 && oldFlushAt < oldDisposeAt, '换书必须先 flush 外观再释放旧 owner');
    assert.match(source, /retiring \? flushReaderAppearance\(retiring\)[\s\S]*?ctl\._destroyed = true/);
    assert.match(source, /retiring \? flushReaderAppearance\(retiring\)[\s\S]*?disposeBookHandle\(retiring\)/);

    const queueCalls = source.match(/queueReaderAppearance\(\)/g) || [];
    assert.ok(queueCalls.length >= 9, '方向/模式/主题/字号/页宽/滚轮缩放/右键字号均须排队保存');
    assert.match(source, /owner\._pendingAppearance\s*=\s*readerAppearanceSnapshot\(\)/);
    assert.match(source, /owner\._prefs\.saveAppearance\(snapshot\)/);
  });
});
