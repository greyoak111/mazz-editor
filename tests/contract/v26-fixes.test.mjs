// tests/contract/v26-fixes.test.mjs —— v26 实机修复回归契约
// 覆盖：表格单元格内容坐标（双重滚动）· 导图文档版本/连接线自定义序列化 · 主题包路径
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

describe('表格：单元格用内容坐标（滚动不再双重扣减）', () => {
  test('makeCell 的 left/top 与滚动量无关', async () => {
    const { Workbook } = await import('../../renderer/modules/sheet/model.js');
    const { SheetGrid, DEFAULT_COL_W } = await import('../../renderer/modules/sheet/grid.js');
    const wb = new Workbook();
    wb.sheet.setRaw(2, 3, 'x');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new SheetGrid(host, wb, {});
    const cell = [...grid.spaceEl.querySelectorAll('.sg-cell')].find(e => +e.dataset.r === 2 && +e.dataset.c === 3);
    assert.ok(cell, '单元格应渲染');
    // 内容坐标：colX(3) = 2 列 × 默认宽
    const expectX = 2 * DEFAULT_COL_W;
    assert.equal(parseInt(cell.style.left, 10), expectX, 'left 必须是内容坐标（不含滚动扣减）');
    // 滚动后重渲染：可视区所有单元格依然是内容坐标（不允许出现扣过滚动量的坐标）
    grid.scrollEl.scrollLeft = 500;
    grid.render();
    const all = [...grid.spaceEl.querySelectorAll('.sg-cell')];
    assert.ok(all.length, '滚动后仍有单元格渲染');
    for (const el of all) {
      const c = +el.dataset.c, r = +el.dataset.r;
      assert.equal(parseInt(el.style.left, 10), grid.colX(c), `(${r},${c}) left 必须是内容坐标`);
      assert.equal(parseInt(el.style.top, 10), grid.rowY(r), `(${r},${c}) top 必须是内容坐标`);
    }
    host.remove();
  });
});

describe('导图：文档序列化保留连接线自定义', () => {
  test('v:3 + parentLinks mode/waypoints + 节点 linkMode/linkWps 往返', async () => {
    const { createNode, createParentLink, serializeDoc, parseDoc } = await import('../../renderer/modules/mindmap/model.js');
    const r = createNode('根', 'root');
    const a = createNode('甲'); const b = createNode('乙');
    a.linkMode = 'straight';
    a.linkWps = [{ x: 100, y: 50 }, { x: 100, y: 120 }];
    a.linkColor = '#ff0000'; a.linkWidth = 3;
    r.children.push(a, b);
    const pl = createParentLink(a.id, b.id);
    pl.mode = 'straight'; pl.waypoints = [{ x: 60, y: 60 }]; pl.color = '#00ff00'; pl.note = '跨链';
    const doc = { v: 3, mode: 'lr', scheme: 0, roots: [r], notes: [], refLines: [], parentLinks: [pl], linkStyle: null };
    const back = parseDoc(serializeDoc(doc));
    assert.equal(back.roots[0].children[0].linkMode, 'straight');
    assert.equal(back.roots[0].children[0].linkWps.length, 2);
    assert.equal(back.roots[0].children[0].linkColor, '#ff0000');
    assert.equal(back.parentLinks[0].mode, 'straight');
    assert.equal(back.parentLinks[0].waypoints.length, 1);
    assert.equal(back.parentLinks[0].note, '跨链');
  });

  test('提取文档为导图的 doc 必须带 v:3（否则 parseDoc 回退空大纲）', async () => {
    // 模拟 shell.markdown.toMindmap 组装的 doc
    const { parseDoc } = await import('../../renderer/modules/mindmap/model.js');
    const { createNode } = await import('../../renderer/modules/mindmap/model.js');
    const doc = { v: 3, mode: 'lr', scheme: 0, roots: [createNode('文档标题')], notes: [], refLines: [], parentLinks: [], linkStyle: null };
    const back = parseDoc(JSON.stringify(doc));
    assert.equal(back.roots[0].text, '文档标题', 'v:3 文档必须按 JSON 解析而非回退大纲');
  });
});

describe('主题包：工作区路径持久化', () => {
  test('保存/导入落在工作区 themes/ 下（不是系统根目录）', async () => {
    if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
    if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;
    const { installBrowserBridge } = await import('../../renderer/lib/browser-bridge.js');
    installBrowserBridge();
    const ts = await import('../../renderer/lib/theme-store.js');
    const dir = await ts.themesDir();
    assert.ok(dir.startsWith('/workspace'), `主题目录应在工作区下，实际：${dir}`);
    const p = await ts.savePack('v26 契约', { name: 'v26 契约', base: 'paper', vars: { bg: '#111' } });
    assert.ok(p.startsWith('/workspace/themes'), `主题包路径应在工作区 themes/ 下，实际：${p}`);
    await ts.deletePack('v26 契约');
  });
});
