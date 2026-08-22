// tests/contract/sidebar-panels.test.mjs —— 侧栏多页签面板契约（v39 思源工作区）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const WS = '/mock-ws';
const fsStore = new Map();
const settingsStore = new Map();
window.mazz = {
  invoke: async (channel, payload = {}) => {
    if (channel === 'workspace:get') return WS;
    if (channel === 'fs:readFile') {
      if (!fsStore.has(payload.path)) throw new Error('ENOENT');
      return fsStore.get(payload.path);
    }
    if (channel === 'fs:writeFile') { fsStore.set(payload.path, payload.content); return true; }
    if (channel === 'fs:mkdir') return true;
    if (channel === 'fs:listDir') {
      const prefix = payload.path + '/';
      const seen = new Map();
      for (const p of fsStore.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const seg = rest.split('/');
        if (seg.length === 1) seen.set(p, { name: seg[0], isDir: false, path: p, mtimeMs: fsStore.get(p + '#mt') || 0, ctimeMs: 0 });
        else {
          const dp = prefix + seg[0];
          if (!seen.has(dp)) seen.set(dp, { name: seg[0], isDir: true, path: dp, mtimeMs: 0, ctimeMs: 0 });
        }
      }
      return [...seen.values()];
    }
    if (channel === 'settings:get') return settingsStore.get(payload.key) ?? null;
    if (channel === 'settings:set') { settingsStore.set(payload.key, payload.value); return true; }
    return null;
  },
};

const { FileTree } = await import('../../renderer/shell/file-tree.js');
const { SidebarPanels } = await import('../../renderer/shell/sidebar-panels.js');

describe('侧栏面板（v39）', () => {
  test('智能创作生成期间合并文件事件，收口后目录树只补刷一次', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let busy = true;
    let refreshes = 0;
    const ft = new FileTree(root, {
      onOpenFile: () => {}, onNewFile: () => {}, onNewFolder: () => {}, getWorkspace: async () => WS,
      shouldDeferExternalRefresh: () => busy,
      externalRefreshDelay: 5,
      deferredRefreshPoll: 5,
    });
    ft.refresh = async () => { refreshes += 1; };

    ft.queueExternalRefresh(`${WS}/Output/任务状态.json`);
    ft.queueExternalRefresh(`${WS}/Output/创作蓝图.md`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(refreshes, 0, '生成活跃时不得重建文件树');

    busy = false;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(refreshes, 1, '生成收口后多次文件变更只能合并为一次补刷');
    root.remove();
  });

  test('FileTree 排序选单：名称/自然/时间 × 升降 + 手动', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="sidebar-head"></div><div class="filetree"></div>';
    document.body.appendChild(root);
    const ft = new FileTree(root, { onOpenFile: () => {}, onNewFile: () => {}, onNewFolder: () => {}, getWorkspace: async () => WS });
    const mk = (name, extra = {}) => ({ name, isDir: false, path: WS + '/' + name, ...extra });
    const entries = [mk('p10.md', { mtimeMs: 1 }), mk('p2.md', { mtimeMs: 9 }), mk('b.md', { mtimeMs: 5 }), mk('a.md', { mtimeMs: 3 })];
    ft.sortMode = 'natural-asc';
    const naturalAsc = ft.applyOrder(entries, WS).map(e => e.name);
    // 自然升序：字母序为主但数字按数值（关键判定：p2 必须在 p10 前）
    assert(naturalAsc.indexOf('p2.md') < naturalAsc.indexOf('p10.md'), '自然排序应 p2<p10：' + naturalAsc);
    assert(naturalAsc.indexOf('a.md') < naturalAsc.indexOf('b.md'), '自然排序应 a<b');
    ft.sortMode = 'natural-desc';
    assert(ft.applyOrder(entries, WS)[0].name === 'p10.md', '自然降序首项应 p10.md（asc 的反转）');
    ft.sortMode = 'mtime-desc';
    assert(ft.applyOrder(entries, WS)[0].name === 'p2.md', 'mtime 降序首项应 p2.md(9)');
    ft.sortMode = 'name-asc';
    assert(ft.applyOrder(entries, WS)[0].name === 'a.md', '名称升序首项应 a.md');
    root.remove();
  });

  test('已关闭文件夹：关闭过滤入组 + 恢复回主树', async () => {
    fsStore.clear();
    fsStore.set(WS + '/甲/a.md', '# A');
    fsStore.set(WS + '/乙/b.md', '# B');
    settingsStore.clear();
    const root = document.createElement('div');
    root.innerHTML = '<div class="sidebar-head"></div><div class="filetree"></div>';
    document.body.appendChild(root);
    const ft = new FileTree(root, { onOpenFile: () => {}, onNewFile: () => {}, onNewFolder: () => {}, getWorkspace: async () => WS });
    ft._closedDirs = null;
    await ft.closeDir(WS + '/甲');
    let dirs = await ft.getClosedDirs();
    assert(dirs.length === 1 && dirs[0].path === WS + '/甲', '应入已关闭组');
    const frag = await ft.renderDir(WS, 0);
    const names = [...frag.querySelectorAll('.ft-node')].map(n => n.dataset.path);
    assert(!names.includes(WS + '/甲'), '主树应过滤已关闭');
    assert(names.includes(WS + '/乙'), '乙应保留');
    const group = await ft.renderClosedDirs();
    assert(group && group.textContent.includes('甲'), '已关闭组应显示甲');
    await ft.reopenDir(WS + '/甲');
    dirs = await ft.getClosedDirs();
    assert(dirs.length === 0, '恢复后已关闭组应空');
    root.remove();
  });

  test('标签聚合：#标签 扫描分组合计数', async () => {
    fsStore.set(WS + '/x.md', '今天 #读书 很有收获 #随笔');
    fsStore.set(WS + '/sub/y.md', '#读书 第二章');
    const shell = { tabs: { active: null }, openFile: () => {}, workspace: Promise.resolve(WS) };
    const sb = document.createElement('div');
    sb.innerHTML = '<div class="sidebar-head"></div><div class="filetree"></div>';
    document.body.appendChild(sb);
    const panels = new SidebarPanels({ sidebar: sb, fileTree: { getWorkspace: async () => WS }, shell });
    await panels.refreshTags(true);
    const html = panels.tagsList.innerHTML;
    assert(html.includes('读书'), '应有读书标签');
    assert(html.includes('随笔'), '应有随笔标签');
    assert(html.includes('y.md') && html.includes('x.md'), '文件应入组');
    sb.remove();
  });

  test('反链识别：[[wikilink]] 与纯文本提及分流', async () => {
    fsStore.set(WS + '/目标.md', '# 目标');
    fsStore.set(WS + '/linker.md', '见 [[目标]] 与 [[目标|别名]]');
    fsStore.set(WS + '/mention.md', '我今天想到目标这个词');
    fsStore.set(WS + '/none.md', '完全无关');
    const shell = { tabs: { active: { filePath: WS + '/目标.md', title: '目标.md' } }, openFile: () => {}, workspace: Promise.resolve(WS) };
    const sb = document.createElement('div');
    sb.innerHTML = '<div class="sidebar-head"></div><div class="filetree"></div>';
    document.body.appendChild(sb);
    const panels = new SidebarPanels({ sidebar: sb, fileTree: { getWorkspace: async () => WS }, shell });
    await panels.refreshBacklinks();
    assert(panels.backLinksEl.textContent.includes('linker.md'), 'linker 应入反链：' + panels.backLinksEl.textContent);
    assert(!panels.backLinksEl.textContent.includes('mention.md'), 'mention 不应入反链');
    assert(panels.backMentionsEl.textContent.includes('mention.md'), 'mention 应入提及');
    assert(!panels.backMentionsEl.textContent.includes('none.md'), 'none 不应出现');
    sb.remove();
  });
});
