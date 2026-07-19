// tests/contract/help.test.mjs —— 帮助中心：渲染器 / 章节完整性 / 查看器交互
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { renderHelpMd, openHelp, closeHelp } = await import('../../renderer/help/index.js');
const { HELP_SECTIONS } = await import('../../renderer/help/content.js');

describe('帮助中心：Markdown 渲染器', () => {
  test('标题/列表/表格/行内格式/代码块', () => {
    const html = renderHelpMd('# 大标题\n\n## 小节\n\n- 项目一\n- 项目二\n\n1. 第一\n2. 第二\n\n普通 **加粗** 和 `代码` 以及 *斜体*。\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode block <b>\n```\n\n> 引用一句\n');
    assert.ok(html.includes('<h2>大标题</h2>'));
    assert.ok(html.includes('<h3>小节</h3>'));
    assert.ok(html.includes('<ul>') && html.includes('<li>项目一</li>'));
    assert.ok(html.includes('<ol>') && html.includes('<li>第一</li>'));
    assert.ok(html.includes('<b>加粗</b>'));
    assert.ok(html.includes('<code>代码</code>'));
    assert.ok(html.includes('<i>斜体</i>'));
    assert.ok(html.includes('help-table') && html.includes('<td>列A</td>') && html.includes('<td>1</td>'));
    assert.ok(html.includes('code block &lt;b&gt;'), '代码块内应转义不解析');
    assert.ok(html.includes('<blockquote>引用一句</blockquote>'));
  });

  test('XSS 注入被转义', () => {
    const html = renderHelpMd('普通 <script>alert(1)</script> 文本');
    assert.ok(!html.includes('<script>'), '脚本应被转义');
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

describe('帮助中心：内容完整性', () => {
  test('章节数量与结构', () => {
    assert.ok(HELP_SECTIONS.length >= 15, `应有 ≥15 章（实际 ${HELP_SECTIONS.length}）`);
    const ids = new Set();
    for (const s of HELP_SECTIONS) {
      assert.ok(s.id && s.title && s.icon, '每章需 id/title/icon');
      assert.ok(!ids.has(s.id), '章节 id 不重复: ' + s.id);
      ids.add(s.id);
      assert.ok(s.body.length > 300, `章节内容不应过短: ${s.id}`);
      assert.ok(!s.body.includes('undefined'), `章节不含 undefined: ${s.id}`);
    }
  });

  test('关键功能章节覆盖（新功能不遗漏）', () => {
    const all = HELP_SECTIONS.map(s => s.id).join(',');
    for (const id of ['quickstart', 'markdown', 'sheet', 'slide', 'code', 'browser', 'notes', 'search',
      'mindmap', 'draw', 'library', 'tools', 'windows', 'plugins', 'sync', 'bridge', 'shortcuts', 'faq']) {
      assert.ok(all.includes(id), '缺少章节: ' + id);
    }
    // 易遗漏的新功能关键词
    const text = HELP_SECTIONS.map(s => s.body).join('\n');
    for (const kw of ['批注', '密码管理器', '洋葱皮', '双链', '配对码', '.maz', 'Word 样式映射', '每日笔记', '填充']) {
      assert.ok(text.includes(kw), `帮助内容应提及: ${kw}`);
    }
  });
});

describe('帮助中心：查看器交互', () => {
  test('打开/目录/切换/搜索/关闭', () => {
    openHelp();
    const mask = document.querySelector('.help-mask');
    assert.ok(mask, '帮助应打开');
    assert.ok(mask.querySelector('.help-content').innerHTML.includes('快速上手'), '默认显示第一章');
    const items = mask.querySelectorAll('.help-toc-item');
    assert.equal(items.length, HELP_SECTIONS.length, '目录应列全部章节');
    // 切换章节
    const target = [...items].find(el => el.dataset.id === 'browser');
    target.click();
    assert.ok(mask.querySelector('.help-content').innerHTML.includes('隐私浏览器'));
    // 搜索过滤
    const search = mask.querySelector('.help-search');
    search.value = '洋葱皮';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(mask.querySelectorAll('.help-toc-item').length >= 1, '搜索应有结果');
    assert.ok(mask.querySelector('.help-content').innerHTML.includes('洋葱皮'), '搜索态应直显匹配章节');
    // 关闭
    closeHelp();
    assert.ok(!document.querySelector('.help-mask'), '应关闭');
  });
});
