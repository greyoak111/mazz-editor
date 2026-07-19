// tests/contract/search-ui.test.mjs —— 全局搜索模块 UI 实例化：查询渲染 / 过滤 / 点击直达
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const WS = '/mock-ws-gs';
const fsStore = new Map();
function mockListDir(dir) {
  const prefix = dir === WS ? '' : dir.slice(WS.length + 1) + '/';
  const seen = new Map();
  for (const p of fsStore.keys()) {
    const rel = p.slice(WS.length + 1);
    if (!rel.startsWith(prefix)) continue;
    const seg = rel.slice(prefix.length).split('/');
    if (seg.length === 1) seen.set(p, { name: seg[0], isDir: false, path: p });
    else {
      const dpath = WS + '/' + prefix + seg[0];
      if (!seen.has(dpath)) seen.set(dpath, { name: seg[0], isDir: true, path: dpath });
    }
  }
  return [...seen.values()];
}

window.mazz = {
  invoke: async (channel, payload) => {
    if (channel === 'workspace:get') return WS;
    if (channel === 'fs:readFile') { if (!fsStore.has(payload.path)) throw new Error('ENOENT'); return fsStore.get(payload.path); }
    if (channel === 'fs:writeFile') { fsStore.set(payload.path, payload.content); return true; }
    if (channel === 'fs:listDir') return mockListDir(payload.path);
    return null;
  },
};
let lastCmd = null;
window.MazzCommands = { execute: (id, args) => { lastCmd = { id, args }; } };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, toast: () => {} };

const { default: searchModule } = await import('../../renderer/modules/search/index.js');
const { instances } = searchModule._forTests;
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

describe('全局搜索 UI：实例化与查询', () => {
  test('建索引后查询渲染分组结果 + mark 高亮 + 点击直达', async () => {
    fsStore.clear();
    fsStore.set(WS + '/笔记.md', '# 笔记\n\n这里有关键词出现。\n');
    fsStore.set(WS + '/数据.csv', 'a,b\n关键词,1\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    searchModule.create(container);
    await tick(150);
    const ctl = instances.get(container);
    assert.ok(container.querySelector('.gs-root'), '布局应挂载');
    assert.ok(ctl.fileCount >= 2, '应索引至少 2 个文件');
    // 输入查询
    const input = container.querySelector('.gs-input');
    input.value = '关键词';
    ctl.runQuery();
    const files = container.querySelectorAll('.gs-file');
    assert.equal(files.length, 2, '两个文件命中');
    assert.ok(container.querySelector('.gs-hit mark'), '命中词应 <mark> 高亮');
    assert.ok(container.querySelector('.gs-meta').textContent.includes('2 个文件'));
    // 点击命中 → file.openPath
    lastCmd = null;
    container.querySelector('.gs-hit').click();
    assert.equal(lastCmd?.id, 'file.openPath');
    // 类型过滤
    container.querySelector('.gs-type').value = 'sheet';
    ctl.runQuery();
    assert.equal(container.querySelectorAll('.gs-file').length, 1, '过滤后只剩 csv');
    assert.ok(container.querySelector('.gs-file-name').textContent.includes('数据'));
    container.remove();
  });

  test('正则模式与无效正则提示', async () => {
    fsStore.clear();
    fsStore.set(WS + '/x.md', 'abc123\nabd\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    searchModule.create(container);
    await tick(120);
    const ctl = instances.get(container);
    const input = container.querySelector('.gs-input');
    container.querySelector('.gs-regex').checked = true;
    input.value = 'ab[cd]\\d+';
    ctl.runQuery();
    assert.equal(container.querySelectorAll('.gs-hit').length, 1, '正则只匹配 abc123');
    input.value = '([';
    ctl.runQuery();
    assert.ok(container.querySelector('.gs-empty').textContent.includes('正则'), '无效正则应提示');
    container.remove();
  });
});
