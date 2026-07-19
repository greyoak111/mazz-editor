// tests/contract/save-filters.test.mjs —— 保存过滤器：code 分支在 title 缺失/常规下不抛错（回归：保存无反应）
import { describe, test, assert } from '../harness.mjs';

const { saveFiltersFor } = await import('../../renderer/shell/shell.js');

describe('saveFiltersFor 保存过滤器', () => {
  test('code：title 为 undefined/null/空串时不抛错，默认 js 优先', () => {
    for (const title of [undefined, null, '', '未命名']) {
      const filters = saveFiltersFor({ name: 'code', state: { container: null } }, title);
      assert.ok(Array.isArray(filters), '应返回数组');
      assert.equal(filters[0].name, 'JS 文件', `title=${title} 应默认 js 优先`);
      assert.equal(filters[filters.length - 1].name, '所有文件', '末尾应有所有文件兜底');
    }
  });

  test('code：当前扩展名置顶且不重复', () => {
    const filters = saveFiltersFor({ name: 'code', state: { container: null } }, 'main.py');
    assert.equal(filters[0].name, 'PY 文件', 'py 应置顶');
    const names = filters.map(f => f.name);
    assert.equal(new Set(names).size, names.length, '格式不应重复');
    assert.ok(names.includes('TS 文件') && names.includes('TXT 文件'), '应含全代码格式');
  });

  test('code：无扩展名标题默认 js 优先', () => {
    const filters = saveFiltersFor({ name: 'code', state: { container: null } }, '未命名');
    assert.equal(filters[0].name, 'JS 文件');
  });

  test('markdown：docx/html 在列，md 优先', () => {
    const filters = saveFiltersFor({ name: 'markdown', state: {} }, '文档.md');
    const names = filters.map(f => f.name);
    assert.ok(names[0].includes('Markdown'));
    assert.ok(names.includes('Word 文档'));
    assert.ok(names.includes('HTML 网页'));
    assert.equal(filters[filters.length - 1].name, '所有文件');
  });

  test('sheet/mindmap/draw/slide：各自格式优先且全格式可选', () => {
    const cases = [
      ['sheet', 'Mazz 表格', ['Excel 工作簿', 'CSV 逗号分隔']],
      ['mindmap', '思维导图', ['Markdown 大纲']],
      ['draw', '画板文档', ['PNG 图片']],
      ['slide', 'Mazz 演示', ['PowerPoint 演示文稿']],
    ];
    for (const [mod, first, others] of cases) {
      const filters = saveFiltersFor({ name: mod, state: {} }, 'x');
      assert.ok(filters[0].name.includes(first.replace('Mazz ', '')), `${mod} 应 ${first} 优先`);
      for (const o of others) assert.ok(filters.some(f => f.name.includes(o.split(' ')[0])), `${mod} 应含 ${o}`);
      assert.equal(filters[filters.length - 1].name, '所有文件');
    }
  });

  test('未知模块：默认文档格式 + 所有文件兜底', () => {
    const filters = saveFiltersFor({ name: 'nonexist', state: {} }, 'x');
    assert.ok(filters.length >= 2);
    assert.equal(filters[filters.length - 1].name, '所有文件');
  });
});
