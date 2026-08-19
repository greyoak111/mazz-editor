import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W87c 分屏预览无彩框合同', () => {
  test('主路径只画渐变，四边/outline/shadow 与主题色锚线全部退役', () => {
    const shell = read('renderer/shell/shell.js');
    const section = shell.slice(shell.indexOf('installSplitPreview()'), shell.indexOf('/** 外部文件拖入'));
    assert.match(section, /mazz-split-drag-overlay/);
    assert.match(section, /border:0;outline:0;box-shadow:none/);
    assert.match(section, /overlay\.style\.border = '0'/);
    assert.match(section, /overlay\.style\.outline = '0'/);
    assert.match(section, /overlay\.style\.boxShadow = 'none'/);
    assert.doesNotMatch(section, /borderSide|zc\.border|1\.5px solid/, '分屏主路径不得再生成任意方向的主题色锚线');
  });

  test('拖拽时临时关闭活动窗格内描边，结束后原活动提示规则仍保留', () => {
    for (const file of ['renderer/styles/base.css', 'renderer/base.css']) {
      const css = read(file);
      assert.match(css, /\.pane\.active\s*\{[^}]*box-shadow:[^}]*\}/);
      assert.match(css, /body\.tab-dragging \.pane\.active\s*\{\s*box-shadow:\s*none;\s*\}/);
    }
  });

  test('停用备选 splitpreview 也不得保留锚线回潮入口', () => {
    const panel = read('renderer/panels/splitpreview.html');
    assert.match(panel, /#pv\s*\{[^}]*border:\s*0;[^}]*outline:\s*0;[^}]*box-shadow:\s*none;/);
    assert.doesNotMatch(panel, /borderSide|zc\.border|1\.5px solid/);
  });

  test('非交互拖拽 Overlay 不进入焦点仲裁，杜绝 focus-visible 整圈描边', () => {
    const shell = read('renderer/shell/shell.js');
    const visual = read('renderer/core/visual-composition.js');
    assert.match(shell, /kind:\s*'split-drag'[\s\S]{0,100}focusPolicy:\s*'none'/);
    assert.match(visual, /focusPolicy:\s*options\.focusPolicy === 'none' \? 'none' : 'auto'/);
    assert.match(visual, /if \(top\.focusPolicy === 'none'\) return;/);
  });
});
