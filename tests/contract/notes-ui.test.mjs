// tests/contract/notes-ui.test.mjs —— 笔记模块 UI 实例化：列表/编辑器/反链/每日笔记/图谱
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const WS = '/mock-ws-ui';
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
window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };

const { default: notesModule } = await import('../../renderer/modules/notes/index.js');
const { instances } = notesModule._forTests;
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

describe('笔记模块 UI：实例化与交互', () => {
  test('create 挂载布局 + 嵌入 markdown 编辑器 + 列表渲染', async () => {
    fsStore.clear();
    fsStore.set(WS + '/笔记A.md', '# A\n\n链到 [[笔记B]]。\n');
    fsStore.set(WS + '/笔记B.md', '# B\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = notesModule.create(container);
    await tick(120);
    assert.ok(container.querySelector('.notes-root'), '根布局应挂载');
    assert.ok(container.querySelector('.notes-side'), '侧栏应存在');
    assert.ok(container.querySelector('.ProseMirror'), 'markdown 编辑器应嵌入');
    const items = container.querySelectorAll('.notes-item');
    assert.ok(items.length >= 2, '列表应渲染笔记');
    notesModule.deactivate(container);
    container.remove();
  });

  test('openNote 注入内容 + 反链面板显示来源笔记', async () => {
    fsStore.clear();
    fsStore.set(WS + '/笔记A.md', '# A\n\n链到 [[笔记B]]。\n');
    fsStore.set(WS + '/笔记B.md', '# B 标题\n\n正文。\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    notesModule.create(container);
    await tick(120);
    const ctl = instances.get(container);
    await ctl.openNote(WS + '/笔记B.md');
    await tick(80);
    assert.equal(ctl.currentName, '笔记B');
    const pm = container.querySelector('.ProseMirror');
    assert.ok(pm.textContent.includes('B 标题'), '编辑器应显示笔记内容');
    const bl = container.querySelector('.bl-list');
    assert.ok(bl.textContent.includes('笔记A'), '反链应显示来源笔记A');
    container.remove();
  });

  test('openDaily 自动创建今日笔记并打开', async () => {
    fsStore.clear();
    const container = document.createElement('div');
    document.body.appendChild(container);
    notesModule.create(container);
    await tick(80);
    const ctl = instances.get(container);
    await ctl.openDaily();
    const today = Object.keys([...fsStore.keys()]).length;
    const dailyPath = [...fsStore.keys()].find(p => p.includes('每日笔记'));
    assert.ok(dailyPath, '每日笔记文件应创建');
    assert.ok(fsStore.get(dailyPath).startsWith('# '), '应有标题模板');
    assert.ok(ctl.currentPath.includes('每日笔记'), '应打开每日笔记');
    container.remove();
  });

  test('图谱模式挂载 canvas 并产出布局', async () => {
    fsStore.clear();
    fsStore.set(WS + '/甲.md', '# 甲\n\n[[乙]]\n');
    fsStore.set(WS + '/乙.md', '# 乙\n');
    const container = document.createElement('div');
    document.body.appendChild(container);
    notesModule.create(container);
    await tick(100);
    const ctl = instances.get(container);
    await ctl.refreshLibrary(); // 强制重建（清掉上个用例的缓存）
    ctl.setMode('graph');
    await tick(80);
    assert.equal(ctl.mode, 'graph');
    assert.ok(ctl.graph, '图谱实例应创建');
    const names = ctl.graph.nodes.map(n => n.name);
    assert.ok(names.includes('甲') && names.includes('乙'), '应含甲乙两节点');
    assert.equal(ctl.graph.edges.length, 1, '甲乙之间一条边（每日笔记无链接）');
    const pair = new Set([ctl.graph.nodes[ctl.graph.edges[0].s].name, ctl.graph.nodes[ctl.graph.edges[0].t].name]);
    assert.ok(pair.has('甲') && pair.has('乙'), '边应连接甲与乙');
    assert.ok(container.querySelector('.notes-graph canvas'), 'canvas 应挂载');
    container.remove();
  });
});
