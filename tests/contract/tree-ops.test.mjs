// tests/contract/tree-ops.test.mjs —— 工作区文件树：资源管理器式操作契约
// 覆盖：新建落点判定 · 剪切/复制/粘贴（递归/重名避让）· 手动排序 · 新建类型覆盖 · pptx 导入
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const { installBrowserBridge } = await import('../../renderer/lib/browser-bridge.js');
installBrowserBridge();
const mazz = window.mazz;
const { FileTree } = await import('../../renderer/shell/file-tree.js');
const { NEW_FILE_TYPES, NEW_FILE_DEFAULTS, BINARY_EXTS, makeBinaryDoc } = await import('../../renderer/shell/shell.js');

function makeTree() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tree = new FileTree(host, {
    onOpenFile: () => {}, onNewFile: () => {}, onNewFolder: () => {},
    getWorkspace: async () => '/workspace',
  });
  tree.defaults = { NEW_FILE_TYPES, NEW_FILE_DEFAULTS, BINARY_EXTS, makeBinaryDoc };
  return tree;
}

describe('新建落点判定', () => {
  test('未选中 → 工作区根；选中文件夹 → 其内；选中文件 → 明确报错', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:writeFile', { path: '/workspace/a.md', content: 'x' });
    await mazz.invoke('fs:mkdir', { path: '/workspace/dir1' });
    assert.deepEqual(tree.resolveTargetDir(), { dir: null });
    tree.select({ path: '/workspace/dir1', isDir: true });
    assert.deepEqual(tree.resolveTargetDir(), { dir: '/workspace/dir1' });
    tree.select({ path: '/workspace/a.md', isDir: false });
    const r = tree.resolveTargetDir();
    assert.equal(r.error, '文件下无法新建内容，请选中文件夹');
    // 粘贴落点：选中文件 → 其父目录（资源管理器习惯）
    assert.equal(tree.resolvePasteDir(), '/workspace');
  });
});

describe('剪切/复制/粘贴', () => {
  test('复制文件夹（含嵌套）→ 递归落位', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:writeFile', { path: '/workspace/src/f1.md', content: '一' });
    await mazz.invoke('fs:writeFile', { path: '/workspace/src/sub/f2.md', content: '二' });
    await mazz.invoke('fs:mkdir', { path: '/workspace/dst' });
    tree.select({ path: '/workspace/src', isDir: true });
    tree.cutCopy('copy');
    tree.select({ path: '/workspace/dst', isDir: true });
    await tree.paste();
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/dst/src/f1.md' }), '一');
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/dst/src/sub/f2.md' }), '二');
    // 源仍在（复制非剪切）
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/src/f1.md' }), '一');
  });

  test('剪切文件 → 移动并清空剪贴板；文件夹禁入自身', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:writeFile', { path: '/workspace/mv.md', content: 'M' });
    tree.select({ path: '/workspace/mv.md', isDir: false });
    tree.cutCopy('cut');
    tree.select({ path: '/workspace/dir1', isDir: true }); // 移入子目录
    await tree.paste();
    assert.equal(tree.clip, null);
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/dir1/mv.md' }), 'M');
    assert.equal((await mazz.invoke('fs:stat', { path: '/workspace/mv.md' })).exists, false);
    // 禁止把文件夹贴进自身
    tree.select({ path: '/workspace/dst', isDir: true });
    tree.cutCopy('copy');
    await tree.paste(); // 落点=/workspace/dst，源=/workspace/dst → 拒绝
    assert.equal((await mazz.invoke('fs:stat', { path: '/workspace/dst/dst' })).exists, false);
  });

  test('复制重名 → 自动 (2) 后缀', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:writeFile', { path: '/workspace/dup.md', content: 'D' });
    tree.select({ path: '/workspace/dup.md', isDir: false });
    tree.cutCopy('copy');
    tree.select(null);
    await tree.paste();
    assert.equal(await mazz.invoke('fs:readFile', { path: '/workspace/dup (2).md' }), 'D');
  });
});

describe('自动命名与行内新建', () => {
  test('uniqueChildName：新建文件夹 / (1) / (2) 递增避让', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:mkdir', { path: '/workspace/新建文件夹' });
    await mazz.invoke('fs:mkdir', { path: '/workspace/新建文件夹 (1)' });
    assert.equal(await tree.uniqueChildName('/workspace', '新建文件夹'), '新建文件夹 (2)');
    assert.equal(await tree.uniqueChildName('/workspace', '新建文件', '.md'), '新建文件.md');
  });

  test('startInlineCreate(folder)：自动名落位并进入改名条', async () => {
    const tree = makeTree();
    await tree.startInlineCreate(null, 'folder');
    const input = document.querySelector('.ft-rename-input');
    assert.ok(input, '应出现行内输入框');
    assert.ok(/^新建文件夹( \(\d+\))?$/.test(input.value), '自动名应符合规范: ' + input.value);
    const st = await mazz.invoke('fs:stat', { path: '/workspace/' + input.value });
    assert.equal(st.exists, true);
  });

  test('startInlineCreate(file)：输入框不含后缀 + 后缀下拉默认 .md；Enter 确认', async () => {
    const tree = makeTree();
    let opened = null;
    tree.onOpenFile = (p) => { opened = p; };
    await tree.startInlineCreate(null, 'file');
    const input = document.querySelector('.ft-rename-input');
    const sel = document.querySelector('.ft-rename-ext');
    assert.ok(input && sel, '应有输入框与后缀下拉');
    assert.equal(input.value, '新建文件'); // 不含后缀
    assert.equal(sel.value, '.md');
    // 改名 + 换后缀 → Enter
    input.value = '周报';
    sel.value = '.txt';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await mazz.invoke('fs:stat', { path: '/workspace/周报.txt' })).exists, true);
    assert.equal(opened, '/workspace/周报.txt');
    // 自动名原文件已不存在（被改名）
    assert.equal((await mazz.invoke('fs:stat', { path: '/workspace/新建文件.md' })).exists, false);
  });

  test('Esc 保留自动名', async () => {
    const tree = makeTree();
    await tree.startInlineCreate(null, 'file');
    const input = document.querySelector('.ft-rename-input');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await mazz.invoke('fs:stat', { path: '/workspace/新建文件.md' })).exists, true);
  });

  test('文件夹行内按钮：目录节点有添加文件夹/添加文件/⋯ 三个按钮', async () => {
    makeTree();
    await mazz.invoke('fs:mkdir', { path: '/workspace/dirbtn' });
    const tree = makeTree();
    await tree.refresh();
    const node = [...document.querySelectorAll('.ft-node')].find(n => n.dataset.path === '/workspace/dirbtn');
    const btns = node.querySelectorAll('.ft-more');
    assert.equal(btns.length, 3);
    assert.equal(btns[0].getAttribute('aria-label'), '在此文件夹内新建文件夹'); // 添加文件夹靠左
    assert.equal(btns[1].getAttribute('aria-label'), '在此文件夹内新建文件');
    assert.ok(btns[0].querySelector('svg[stroke="currentColor"]'), '添加文件夹必须是主题自适应 SVG');
    assert.ok(btns[1].querySelector('svg[stroke="currentColor"]'), '添加文件必须是主题自适应 SVG');
    assert.equal(node.getAttribute('role'), 'treeitem');
    assert.equal(node.getAttribute('aria-expanded'), 'false');
  });
});

describe('双击/长按重命名', () => {
  test('双击已选中文件行 → 行内改名（无后缀下拉）→ 改名后发出事件', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:writeFile', { path: '/workspace/dbl.md', content: 'x' });
    await tree.refresh();
    const node = [...document.querySelectorAll('.ft-node')].find(n => n.dataset.path === '/workspace/dbl.md');
    // 未选中时双击不应触发
    node.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(document.querySelector('.ft-rename-input'), null);
    // 选中后双击 → 改名条
    tree.select({ path: '/workspace/dbl.md', isDir: false });
    let renamed = null;
    const { bus } = await import('../../renderer/core/events.js');
    const off = bus.on('filetree:renamed', (p) => { renamed = p; });
    node.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.ft-rename-input');
    assert.ok(input, '应出现行内输入框');
    assert.equal(input.value, 'dbl'); // 不含后缀
    assert.equal(document.querySelector('.ft-rename-ext'), null); // 重命名无后缀下拉
    input.value = '改名后';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await mazz.invoke('fs:stat', { path: '/workspace/改名后.md' })).exists, true);
    assert.deepEqual(renamed, { from: '/workspace/dbl.md', to: '/workspace/改名后.md' });
    off();
  });

  test('触屏长按触发重命名', async () => {
    const tree = makeTree();
    await mazz.invoke('fs:writeFile', { path: '/workspace/long.md', content: 'x' });
    await tree.refresh();
    const node = [...document.querySelectorAll('.ft-node')].find(n => n.dataset.path === '/workspace/long.md');
    const ev = new window.Event('pointerdown', { bubbles: true });
    ev.pointerType = 'touch'; ev.pointerId = 1; ev.clientX = 50; ev.clientY = 5;
    node.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 700));
    assert.ok(document.querySelector('.ft-rename-input'), '长按应出现行内输入框');
    // 清理：Esc 退出
    document.querySelector('.ft-rename-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
});

describe('手动排序', () => {
  test('applyOrder 按存储序排，未记录项排尾', () => {
    const tree = makeTree();
    tree.order = { '/workspace': ['b.md', 'a.md'] };
    const entries = [
      { name: 'a.md', isDir: false }, { name: 'b.md', isDir: false }, { name: 'z.md', isDir: false },
    ];
    const sorted = tree.applyOrder(entries, '/workspace');
    assert.deepEqual(sorted.map(e => e.name), ['b.md', 'a.md', 'z.md']);
  });
});

describe('新建文件类型', () => {
  test('覆盖常用办公与导出格式', () => {
    const exts = NEW_FILE_TYPES.map(t => t.ext);
    for (const e of ['md', 'txt', 'docx', 'csv', 'mazzsheet', 'xlsx', 'mazzslide', 'pptx', 'mindmap', 'mazzdraw', 'js', 'py']) {
      assert.ok(exts.includes(e), '缺少类型: ' + e);
    }
  });
});

describe('pptx 导入', () => {
  test('导出→导入回环：标题/要点/分页', async () => {
    const { parseOutline } = await import('../../renderer/modules/slide/outline.js');
    const { exportPptx } = await import('../../renderer/modules/slide/pptx.js');
    const { SLIDE_THEMES } = await import('../../renderer/modules/slide/themes.js');
    const { pptxToOutline } = await import('../../renderer/modules/slide/pptx-import.js');
    const buf = await exportPptx(parseOutline('# 封面\n- 要点甲\n- 要点乙\n---\n# 第二页\n- 内容\n'), SLIDE_THEMES[0], { fileName: 't' });
    const outline = await pptxToOutline(buf);
    assert.ok(outline.includes('# 封面'), '应含第一页标题');
    assert.ok(outline.includes('- 要点甲'), '应含要点');
    assert.ok(outline.includes('---'), '应含分页符');
    assert.ok(outline.includes('# 第二页'), '应含第二页标题');
  });
});
