// W87g —— Paper/Ink 全页文字与 SVG 控件辨识度合同。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const themes = read('renderer/styles/themes.css');
const base = read('renderer/styles/base.css');
const convergence = read('renderer/styles/convergence.css');
const panels = read('renderer/panels/panel-shared.css');
const icons = read('renderer/lib/svg-icons.js');
const slide = read('renderer/modules/slide/index.js');
const runner = read('tests/e2e/w87g-theme-legibility.mjs');

const luminance = hex => {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

describe('W87g Theme Legibility', () => {
  test('Paper/Ink 次级文字在常用最差底色保持 4.5:1，Ink 强调按钮不再浅底白字', () => {
    assert.ok(contrast('#66645e', '#e3e1da') >= 4.5, 'Paper fg-dim 对 bg-active 不得低于 4.5:1');
    assert.ok(contrast('#9da3af', '#312e5f') >= 4.5, 'Ink fg-dim 对 accent-soft 不得低于 4.5:1');
    assert.ok(contrast('#111827', '#a5b4fc') >= 4.5, 'Ink accent-fg 对 accent 不得低于 4.5:1');
    assert.match(themes, /\[data-theme="paper"\][\s\S]*--fg-dim:\s*#66645e/);
    assert.match(themes, /\[data-theme="ink"\][\s\S]*--fg-dim:\s*#9da3af[\s\S]*--accent-fg:\s*#111827/);
  });

  test('老模块主题别名回接统一令牌，禁止 Ink 回落到白卡与 Paper 紫', () => {
    for (const alias of ['--acc: var(--accent)', '--bd: var(--border)', '--card: var(--bg-elev)', '--mut: var(--fg-dim)']) {
      assert.ok(themes.includes(alias), `缺少主题别名：${alias}`);
    }
    assert.match(base, /\.draw-tool-strip \{[^}]*background:\s*var\(--card/);
    assert.match(base, /\.ribbon-help-btn \{[^}]*color:\s*var\(--acc/);
  });

  test('占位、禁用与播放器暗舞台都有显式可读前景，不靠低透明度裁掉信息', () => {
    assert.match(base, /::placeholder \{ color:\s*var\(--fg-dim\); opacity:\s*1; \}/);
    assert.match(panels, /::placeholder \{ color:\s*var\(--fg-dim\); opacity:\s*1; \}/);
    assert.match(base, /\.rb-btn:disabled \{ opacity:\s*\.58/);
    assert.match(convergence, /\[aria-disabled="true"\][^{]*\{ opacity:\s*\.58/);
    assert.match(base, /\.mz-empty \.mz-empty-btn \{[^}]*background:\s*#1f2937[^}]*color:\s*#f8fafc/);
  });

  test('主壳与 Panel 的 SVG 控件统一 currentColor 和 2px 轮廓', () => {
    assert.match(icons, /stroke="currentColor" stroke-width="2"/);
    assert.match(convergence, /button svg, \[role="button"\] svg \{ stroke-width:\s*2; \}/);
    assert.match(panels, /button svg, \[role="button"\] svg \{ stroke-width:\s*2; \}/);
    assert.match(runner, /style\.stroke !== 'none'[\s\S]*style\.fill !== 'none'/, 'E2E 必须审计 SVG 实际 stroke/fill，不能只看 color');
  });

  test('Slide 领域主题不再劫持应用 data-theme；全页 E2E 覆盖双主题、面板和 QuickNote', () => {
    assert.match(slide, /data-slide-theme="\$\{t\.id\}"/);
    assert.doesNotMatch(slide, /data-command="slide\.theme" data-theme=/);
    assert.match(slide, /theme:\s*btn\.dataset\.slideTheme/);
    assert.match(runner, /const THEMES = \['paper', 'ink'\]/);
    assert.match(runner, /const PANEL_KINDS = \[[\s\S]*'archive'/);
    assert.match(runner, /'welcome'[\s\S]*'browser'/);
    assert.match(runner, /'quicknote'/);
    assert.match(runner, /threshold = kind === 'icon'/);
    assert.match(runner, /element\.matches\('input,textarea,select'\)/, 'E2E 必须覆盖表单当前值文字');
    assert.match(runner, /\['::before', '::after'\]/, 'E2E 必须覆盖伪元素 UI 文字');
  });
});
