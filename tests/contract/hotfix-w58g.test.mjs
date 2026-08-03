// tests/contract/hotfix-w58g.test.mjs —— W58g 契约（子窗滚动条真统一：标准属性压钉拔除）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('子窗滚动条真统一（第三波斩根）', () => {
  test('scrollbar-width: thin 声明绝迹（webkit 一族解封）', () => {
    const ps = readSrc('renderer/panels/panel-shared.css');
    assert.ok(!ps.includes('scrollbar-width: thin;'), 'thin 声明必须拔除（现代 Chromium 标准属性压死 webkit 伪元素=两波不统一的真根）');
    assert.ok(!ps.includes('scrollbar-color'), 'scrollbar-color 同族压钉不得存在');
    // webkit 一族必须在（W58e 镜像）：换色=--bg-active 主题变量+hover accent；透明化=2px 透明边+background-clip
    assert.ok(ps.includes('*::-webkit-scrollbar { width: 10px; height: 10px; }'), 'webkit 10px 轨必须在');
    assert.ok(ps.includes('background: var(--bg-active); border-radius: 5px; border: 2px solid transparent; background-clip: content-box;'), '主题换色+透明化浮丸必须在');
    assert.ok(ps.includes('*::-webkit-scrollbar-thumb:hover { background: var(--accent);'), 'hover accent 美化必须在');
  });
  test('面板内联无第二压钉', () => {
    const files = fs.readdirSync(path.resolve('renderer/panels')).filter(f => f.endsWith('.html'));
    for (const f of files) {
      const s = readSrc('renderer/panels/' + f);
      assert.ok(!s.includes('scrollbar-width') && !s.includes('scrollbar-color'), f + ' 不得有内联标准属性压钉');
    }
  });
  test('主窗一族无标准属性（镜像源同引擎路径）', () => {
    const base = readSrc('renderer/styles/base.css');
    assert.ok(!base.includes('scrollbar-width') && !base.includes('scrollbar-color'), '主窗 base.css 同标准——皆 webkit 一族');
  });
});
