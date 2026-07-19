// tests/roundtrip/pptx.test.mjs —— 大纲 ×5 主题导出 pptx 校验
import { describe, test, assert } from '../harness.mjs';
import { parseOutline } from '../../renderer/modules/slide/outline.js';
import { SLIDE_THEMES } from '../../renderer/modules/slide/themes.js';
import { exportPptx } from '../../renderer/modules/slide/pptx.js';
import jszip from 'jszip';

const OUTLINE = `# 产品发布

## 亮点
- 性能提升 3 倍
- 全新界面
- 开放插件

::: notes 开场感谢各位…
---

# 路线图

## Q3
- 公测
## Q4
- 正式版
`;

describe('pptx 导出：大纲 ×5 主题', () => {
  test('每套主题产出合法 pptx（结构/主题色/页数/备注）', async () => {
    const slides = parseOutline(OUTLINE);
    assert.equal(slides.length, 2);
    for (const theme of SLIDE_THEMES) {
      const buf = await exportPptx(slides, theme);
      const zip = await jszip.loadAsync(buf);
      const names = Object.keys(zip.files);
      assert.ok(names.includes('ppt/presentation.xml'), `${theme.name}: 缺 presentation.xml`);
      const slideFiles = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      assert.equal(slideFiles.length, 2, `${theme.name}: 页数不符`);
      const notesFiles = names.filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
      assert.ok(notesFiles.length >= 1, `${theme.name}: 备注页缺失`);
      const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
      const accent = theme.accent.replace('#', '').toUpperCase();
      assert.ok(s1.toUpperCase().includes(accent), `${theme.name}: 强调色未注入`);
      assert.ok(s1.includes('产品发布'), `${theme.name}: 标题文本丢失`);
      assert.ok(s1.includes('性能提升 3 倍'), `${theme.name}: 要点文本丢失`);
    }
  });
});
