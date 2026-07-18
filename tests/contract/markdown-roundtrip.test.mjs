// tests/contract/markdown-roundtrip.test.mjs —— 文档内核：Markdown 双向序列化往返（无头环境真实实例化）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { parseMarkdown, serializeMarkdown } from '../../renderer/modules/markdown/schema.js';
import markdownModule from '../../renderer/modules/markdown/index.js';

const FIXTURE = `# 标题一

这是一段 **加粗** 和 *斜体* 和 \`行内代码\` 和 ~~删除线~~。

## 标题二

> 引用块

- 无序甲
- 无序乙

1. 有序一
2. 有序二

\`\`\`js
const x = 1;
\`\`\`

[链接文字](https://example.com)

---
`;

describe('Markdown 序列化往返', () => {
  test('解析：关键元素全部进入文档树', () => {
    const doc = parseMarkdown(FIXTURE);
    let heads = 0, quote = 0, bullet = 0, ordered = 0, code = 0, hr = 0;
    let hasStrong = false, hasEm = false, hasCode = false, hasStrike = false, hasLink = false;
    doc.descendants((node) => {
      if (node.type.name === 'heading') heads++;
      if (node.type.name === 'blockquote') quote++;
      if (node.type.name === 'bullet_list') bullet++;
      if (node.type.name === 'ordered_list') ordered++;
      if (node.type.name === 'code_block') code++;
      if (node.type.name === 'horizontal_rule') hr++;
      node.marks?.forEach(m => {
        if (m.type.name === 'strong') hasStrong = true;
        if (m.type.name === 'em') hasEm = true;
        if (m.type.name === 'code') hasCode = true;
        if (m.type.name === 'strike') hasStrike = true;
        if (m.type.name === 'link') hasLink = true;
      });
      return true;
    });
    assert.equal(heads, 2);
    assert.equal(quote, 1);
    assert.equal(bullet, 1);
    assert.equal(ordered, 1);
    assert.equal(code, 1);
    assert.equal(hr, 1);
    assert.ok(hasStrong && hasEm && hasCode && hasStrike && hasLink, '行内标记缺失');
  });

  test('序列化：关键语法标记全部保留', () => {
    const md = serializeMarkdown(parseMarkdown(FIXTURE));
    for (const marker of ['# 标题一', '**加粗**', '行内代码', '~~删除线~~', '> 引用块', '无序甲', '1. 有序一', '```', 'https://example.com', '---']) {
      assert.ok(md.includes(marker), `序列化丢失: ${marker}\n—— 实际输出 ——\n${md}`);
    }
  });

  test('二次往返稳定（parse→serialize→parse→serialize 收敛）', () => {
    const once = serializeMarkdown(parseMarkdown(FIXTURE));
    const twice = serializeMarkdown(parseMarkdown(once));
    assert.equal(once, twice);
  });

  test('表格与脚注：双向序列化', () => {
    const src = `# 表格与脚注

| 名称 | 数量 |
| --- | --- |
| 苹果 | 5 |
| 香蕉 | 3 |

正文含脚注[^1]。

[^1]: 这是脚注内容。
`;
    const doc = parseMarkdown(src);
    let hasTable = false, hasFn = false;
    doc.descendants((n) => {
      if (n.type.name === 'table') hasTable = true;
      if (n.type.name === 'footnote') { hasFn = true; assert.equal(n.attrs.note, '这是脚注内容。'); }
      return true;
    });
    assert.ok(hasTable, '表格未解析');
    assert.ok(hasFn, '脚注未解析');
    const out = serializeMarkdown(doc);
    assert.ok(out.includes('| 名称 | 数量 |'), '管道表序列化丢失: ' + out);
    assert.ok(out.includes('[^1]: 这是脚注内容。'), '脚注定义序列化丢失: ' + out);
    assert.ok(/正文含脚注\[\^1\]/.test(out), '脚注引用序列化丢失: ' + out);
    // 二次往返稳定（表格周边空行归一化后逐字节一致）
    const norm = (s) => s.replace(/\n{3,}/g, '\n\n');
    assert.equal(norm(serializeMarkdown(parseMarkdown(out))), norm(out));
  });
});

describe('文档内核：编辑器实例行为', () => {
  test('create → setContent → getContent 往返', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = markdownModule.create(container);
    markdownModule.activate(container, state);
    markdownModule.setContent(FIXTURE, state);
    const out = markdownModule.getContent(state);
    for (const marker of ['# 标题一', '**加粗**', '~~删除线~~', '```']) {
      assert.ok(out.includes(marker), `编辑器往返丢失: ${marker}`);
    }
    assert.ok(markdownModule.getCharCount(state) > 50);
    assert.ok(container.querySelector('.ProseMirror'), 'ProseMirror 未挂载');
    markdownModule.deactivate(container, state);
    container.remove();
  });

  test('工具栏 HTML 提供且按钮充足', () => {
    assert.ok(markdownModule.toolbarHTML.includes('markdown.toggleBold'));
    const panel = document.createElement('div');
    panel.innerHTML = markdownModule.toolbarHTML;
    const bound = panel.querySelectorAll('[data-command]').length;
    assert.ok(bound >= 10, '工具栏按钮不足');
  });
});
