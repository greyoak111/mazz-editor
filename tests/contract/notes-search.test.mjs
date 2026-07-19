// tests/contract/notes-search.test.mjs —— 第四阶段波次1：双链内核 / 笔记库索引 / 全局搜索
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

// ---- mock 桥：内存文件系统 + 工作区 ----
const WS = '/mock-ws';
const fsStore = new Map(); // path -> content
function writeMock(path, content) { fsStore.set(path, content); }
function mockTree() {
  // 从 fsStore 推导目录结构
  return {
    listDir: (dir) => {
      const prefix = dir === WS ? '' : dir.slice(WS.length + 1) + '/';
      const seen = new Map();
      for (const p of fsStore.keys()) {
        const rel = p.slice(WS.length + 1);
        if (!rel.startsWith(prefix)) continue;
        const rest = rel.slice(prefix.length);
        const seg = rest.split('/');
        if (seg.length === 1) {
          seen.set(p, { name: seg[0], isDir: false, path: p });
        } else {
          const dpath = WS + '/' + prefix + seg[0];
          if (!seen.has(dpath)) seen.set(dpath, { name: seg[0], isDir: true, path: dpath });
        }
      }
      return [...seen.values()];
    },
  };
}

window.mazz = {
  invoke: async (channel, payload) => {
    if (channel === 'workspace:get') return WS;
    if (channel === 'fs:readFile') {
      if (!fsStore.has(payload.path)) throw new Error('ENOENT');
      return fsStore.get(payload.path);
    }
    if (channel === 'fs:writeFile') { fsStore.set(payload.path, payload.content); return true; }
    if (channel === 'fs:listDir') return mockTree().listDir(payload.path);
    return null;
  },
};

window.MazzCommands = { execute: (id, args) => { window.__lastCmd = { id, args }; } };

const { parseMarkdown, serializeMarkdown, schema } = await import('../../renderer/modules/markdown/schema.js');
const lib = await import('../../renderer/modules/notes/library.js');
const { SearchIndex, createMemoryStore, highlightLine } = await import('../../renderer/modules/search/indexer.js');

describe('双链内核：[[wikilink]] 解析与序列化', () => {
  test('[[target]] 与 [[target|alias]] 解析为原子节点', () => {
    const doc = parseMarkdown('见 [[笔记A]] 和 [[笔记B|别名B]] 完。');
    const found = [];
    doc.descendants((node) => { if (node.type.name === 'wikilink') found.push(node.attrs); });
    assert.equal(found.length, 2);
    assert.equal(found[0].target, '笔记A');
    assert.equal(found[0].alias, '');
    assert.equal(found[1].target, '笔记B');
    assert.equal(found[1].alias, '别名B');
  });

  test('序列化往返：[[target]] / [[target|alias]] 文本守恒', () => {
    const md = '前文 [[笔记A]] 中 [[笔记B|别名]] 后';
    const doc = parseMarkdown(md);
    const out = serializeMarkdown(doc);
    assert.ok(out.includes('[[笔记A]]'), '无别名应输出 [[target]]');
    assert.ok(out.includes('[[笔记B|别名]]'), '有别名应输出 [[target|alias]]');
  });

  test('extractWikiLinks 提取目标（去别名、去重语义交给调用方）', () => {
    const links = lib.extractWikiLinks('[[A]] x [[B|b]] y [[A]] z [[ ]]');
    assert.deepEqual(links, ['A', 'B', 'A']);
  });
});

describe('笔记库：扫描 / 名称解析 / 反向链接', () => {
  test('扫库建索引 + resolveNote + getBacklinks', async () => {
    fsStore.clear();
    writeMock(WS + '/笔记A.md', '# A\n\n链接到 [[笔记B]]。\n');
    writeMock(WS + '/笔记B.md', '# B\n\n回链 [[笔记A]]，再指 [[笔记C]]。\n');
    writeMock(WS + '/每日笔记/2026-07-18.md', '# 今日\n\n见 [[笔记A]]。\n');
    writeMock(WS + '/无关.txt', 'hello');
    lib.invalidate();
    const data = await lib.scanLibrary({ force: true });
    assert.equal(data.entries.length, 3, '应扫到 3 个 .md');
    const hit = await lib.resolveNote('笔记b');
    assert.ok(hit, '大小写不敏感解析');
    assert.equal(hit.name, '笔记B');
    const bl = await lib.getBacklinks('笔记A');
    assert.equal(bl.length, 2, '笔记A 应有两条反链（B 与每日笔记）');
    const blC = await lib.getBacklinks('笔记C');
    assert.equal(blC.length, 1);
    assert.equal(blC[0].name, '笔记B');
  });

  test('openWikiLink：已存在则打开，不存在则创建', async () => {
    lib.invalidate();
    window.__lastCmd = null;
    await window.MazzNotes === undefined; // hook 由模块 create 安装；此处手动安装
    lib.installGlobalHook();
    await window.MazzNotes.openWikiLink('笔记A');
    assert.equal(window.__lastCmd?.id, 'file.openPath');
    assert.ok(window.__lastCmd.args.path.endsWith('笔记A.md'));
    await window.MazzNotes.openWikiLink('全新笔记');
    assert.ok(fsStore.has(WS + '/全新笔记.md'), '不存在的笔记应被创建');
    assert.ok(fsStore.get(WS + '/全新笔记.md').includes('# 全新笔记'));
  });
});

describe('全局搜索：索引与查询', () => {
  test('reconcile 增量 + query 分组命中 + 类型过滤', async () => {
    const store = createMemoryStore();
    const idx = new SearchIndex(store);
    fsStore.clear();
    writeMock(WS + '/a.md', '第一行关键词\n第二行\n关键词再来\n');
    writeMock(WS + '/b.txt', 'nothing here\n关键词 出现一次\n');
    writeMock(WS + '/c.csv', 'name,v\n关键词,1\n');
    const files = [
      { path: WS + '/a.md', name: 'a.md', ext: '.md' },
      { path: WS + '/b.txt', name: 'b.txt', ext: '.txt' },
      { path: WS + '/c.csv', name: 'c.csv', ext: '.csv' },
    ];
    await idx.reconcile(files);
    assert.equal(idx.mem.size, 3);
    const { results, total } = idx.query('关键词');
    assert.equal(results.length, 3);
    assert.ok(total >= 4);
    // 每文件最多 3 条命中
    const a = results.find(r => r.name === 'a.md');
    assert.ok(a.hits.length <= 3);
    assert.equal(a.hits[0].ln, 1, '命中行号正确');
    // 类型过滤
    const sheetOnly = idx.query('关键词', { type: 'sheet' });
    assert.equal(sheetOnly.results.length, 1);
    assert.equal(sheetOnly.results[0].name, 'c.csv');
    // 正则
    const re = idx.query('关键.', { regex: true });
    assert.ok(re.results.length >= 1);
    // 无效正则
    const bad = idx.query('([', { regex: true });
    assert.ok(bad.error, '无效正则应报错而非抛异常');
    // 增量：新文件入库、失踪移除
    writeMock(WS + '/d.md', '新文档 关键词\n');
    fsStore.delete(WS + '/b.txt');
    await idx.reconcile([
      { path: WS + '/a.md', name: 'a.md', ext: '.md' },
      { path: WS + '/c.csv', name: 'c.csv', ext: '.csv' },
      { path: WS + '/d.md', name: 'd.md', ext: '.md' },
    ]);
    assert.equal(idx.mem.size, 3, 'b.txt 应被移除、d.md 入库');
    assert.ok(idx.mem.has(WS + '/d.md'));
    assert.ok(!idx.mem.has(WS + '/b.txt'));
    // 持久层一致性
    const persisted = await store.getAll();
    assert.equal(persisted.length, 3);
  });

  test('highlightLine 高亮正确且防 XSS', () => {
    const html = highlightLine('a <b> 关键词 c', '关键词');
    assert.ok(html.includes('<mark>关键词</mark>'));
    assert.ok(html.includes('&lt;b&gt;'), 'HTML 应转义');
    assert.ok(!html.includes('<b>'));
  });
});
