// W71 C2：正式主链图标、恢复、保存失败与资源退役门槛
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { Tabs } from '../../renderer/shell/tabs.js';
import { iconHtmlById, moduleIconId, registerIcon } from '../../renderer/core/icon-registry.js';
import fs from 'node:fs';

const WS = '/w71-formal';
const settings = new Map();
const files = new Map();
let failWrites = false;
let writeDelayMs = 0;
let downloadListeners = 0;
const dirtyStates = [];
const titles = [];

window.mazz = {
  isElectron: true,
  on(channel) {
    if (channel === 'library:download') downloadListeners++;
    return () => { if (channel === 'library:download') downloadListeners--; };
  },
  async invoke(channel, payload = {}) {
    if (channel === 'settings:get') return settings.get(payload.key);
    if (channel === 'settings:set') { settings.set(payload.key, payload.value); return true; }
    if (channel === 'workspace:get') return WS;
    if (channel === 'fs:readFileBase64') return Buffer.from(files.get(payload.path) || '', 'utf8').toString('base64');
    if (channel === 'fs:readFile') {
      if (!files.has(payload.path)) throw new Error('ENOENT');
      return files.get(payload.path);
    }
    if (channel === 'fs:writeFile') {
      if (failWrites) throw new Error('simulated write failure');
      if (writeDelayMs) await new Promise(resolve => setTimeout(resolve, writeDelayMs));
      files.set(payload.path, payload.content);
      return true;
    }
    if (channel === 'fs:stat') return { exists: files.has(payload.path), size: 1, mtimeMs: 1 };
    if (channel === 'fs:listDir') {
      return [...files.keys()]
        .filter(path => path.startsWith(`${payload.path}/`) && !path.slice(payload.path.length + 1).includes('/'))
        .map(path => ({ name: path.split('/').pop(), isDir: false, path }));
    }
    return null;
  },
};
window.MazzCommands = { execute: () => {} };
window.MazzHost = {
  notifyChange: () => {},
  setTabTitle: (_container, title) => titles.push(title),
  setTabDirty: (_container, dirty) => dirtyStates.push(!!dirty),
  openTab: () => {},
  toast: () => {},
};

const { default: libraryModule } = await import('../../renderer/modules/library/index.js');
const { default: notesModule } = await import('../../renderer/modules/notes/index.js');

const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

describe('W71 C2 正式主链收敛', () => {
  test('正式组件具备键盘焦点、禁用态与窄窗可达样式', () => {
    const css = fs.readFileSync(new URL('../../renderer/styles/base.css', import.meta.url), 'utf8');
    assert.match(css, /:focus-visible\s*\{/);
    assert.match(css, /outline:\s*2px solid var\(--accent\)/);
    assert.match(css, /\.rb-btn:disabled\s*\{/);
    assert.match(css, /\.lib-reader-bar[^\{]*\{[^}]*overflow-x:\s*auto/s);
    assert.match(css, /\.lib-shelf-head[^\{]*\{[^}]*overflow-x:\s*auto/s);
  });

  test('页签标题变化不改变稳定 iconId → SVG', () => {
    registerIcon(moduleIconId('library'), '📚');
    const bar = document.createElement('div');
    const area = document.createElement('div');
    document.body.append(bar, area);
    const tabs = new Tabs(bar, area);
    const tab = tabs.add({ title: '书库', moduleId: 'library', iconId: moduleIconId('library') });
    const firstSvg = bar.querySelector('.t-icon').innerHTML;
    assert.match(firstSvg, /^<svg\b/);
    assert.equal(bar.querySelector('.t-icon').dataset.iconId, 'module.library');
    for (const title of ['一本书', '书库', '一本书（已恢复）']) {
      tabs.setTitle(tab.id, title);
      assert.equal(bar.querySelector('.t-icon').dataset.iconId, 'module.library');
      assert.equal(bar.querySelector('.t-icon').innerHTML, firstSvg);
      assert.equal(bar.querySelector('.t-label').textContent, title);
    }
    assert.match(iconHtmlById('module.library'), /^<svg\b/);
    bar.remove();
    area.remove();
  });

  test('书库恢复、返回与 20 次开关共用一个图标语义并清空 owner', async () => {
    const path = `${WS}/书库/fixture.txt`;
    files.set(path, 'W71 library fixture');
    settings.set('library.books', [{ id: 'w71-book', title: '封板样书', author: '', cover: '', path, format: 'txt', addedAt: 1 }]);
    const selectionCounts = { add: 0, remove: 0 };
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, listener, options) => {
      if (type === 'selectionchange') selectionCounts.add++;
      return add(type, listener, options);
    };
    document.removeEventListener = (type, listener, options) => {
      if (type === 'selectionchange') selectionCounts.remove++;
      return remove(type, listener, options);
    };
    try {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = libraryModule.create(container);
      assert.equal(await libraryModule.setContent(JSON.stringify({ mark: 'mazz-library-v2', bookId: 'w71-book' }), state), true);
      assert.equal(titles.at(-1), '封板样书');
      container.querySelector('[data-a=back]').click();
      assert.equal(titles.at(-1), '书库');
      assert.equal(titles.at(-1).includes('📚'), false, 'emoji 不得再次写入标题业务状态');
      libraryModule.dispose(state);
      assert.equal(libraryModule._forTests.instances.size, 0);

      for (let i = 0; i < 20; i++) {
        const node = document.createElement('div');
        document.body.appendChild(node);
        const loopState = libraryModule.create(node);
        libraryModule.dispose(loopState);
      }
      await tick();
      assert.equal(libraryModule._forTests.instances.size, 0);
      assert.equal(downloadListeners, 0);
      assert.equal(selectionCounts.add, selectionCounts.remove);
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
  });

  test('笔记写入失败保留 dirty，成功后才清除，关闭释放实例', async () => {
    const path = `${WS}/封板笔记.md`;
    files.set(path, '# 初稿\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = notesModule.create(container);
    await tick(80);
    const ctl = notesModule._forTests.instances.get(container);
    await ctl.openNote(path);
    ctl.currentPath = path;
    ctl.dirty = true;
    failWrites = true;
    assert.equal(await ctl.saveNow(), false);
    assert.equal(ctl.dirty, true);
    assert.equal(dirtyStates.at(-1), true);
    failWrites = false;
    writeDelayMs = 80;
    const inFlight = ctl.saveNow();
    assert.ok(ctl._savePromise, '在途写盘必须有明确 owner');
    assert.equal(await notesModule.beforeClose(state), true, '关闭屏障必须等待同一在途写盘');
    assert.equal(await inFlight, true);
    writeDelayMs = 0;
    assert.equal(ctl._savePromise, null);
    assert.equal(ctl.dirty, false);
    assert.equal(dirtyStates.at(-1), false);
    assert.equal(notesModule.managedSave, true);
    notesModule.dispose(state);
    assert.equal(notesModule._forTests.instances.size, 0);
    assert.equal(container.childElementCount, 0);
  });

  test('笔记恢复意图不会被迟到的每日笔记启动流程覆盖', async () => {
    const path = `${WS}/恢复目标.md`;
    files.set(path, '# 恢复目标\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = notesModule.create(container);
    assert.equal(await notesModule.setContent(JSON.stringify({ mark: 'mazz-notes-v1', path }), state), true);
    await tick(100);
    const ctl = notesModule._forTests.instances.get(container);
    assert.equal(ctl.currentPath, path);
    assert.equal(ctl.currentName, '恢复目标');
    notesModule.dispose(state);
  });
});
