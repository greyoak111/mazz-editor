// W87i —— Ribbon 容器级降级、状态栏中央提示、构成 hover、颜色初值与 Windows dev 日志编码。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const read = rel => fs.readFileSync(path.resolve(rel), 'utf8');

describe('W87i Ribbon / Status / Encoding', () => {
  test('Ribbon 按自身容器 full -> compact -> icon 降级，中文禁止竖排与压缩换行', () => {
    const ribbon = read('renderer/shell/ribbon.js');
    const css = read('renderer/styles/convergence.css');
    assert.match(ribbon, /new ResizeObserver\(\(\) => this\.updateLayout\(\)\)/);
    assert.match(ribbon, /const levels = this\._wrapMode \? \['full'\] : \['full', 'compact', 'icon'\]/);
    assert.match(ribbon, /scrollWidth <= this\.panelEl\.clientWidth \+ 1/);
    assert.match(ribbon, /dataset\.ribbonDensity = selected/);
    assert.match(css, /data-ribbon-density="compact"/);
    assert.match(css, /data-ribbon-density="icon"/);
    assert.match(css, /writing-mode:\s*horizontal-tb\s*!important/);
    assert.match(css, /word-break:\s*keep-all/);
    assert.match(css, /\.ribbon-panel \.rb-group, \.ribbon-panel \.rb-btn \{ flex: 0 0 auto/);
  });

  test('文字色和突出显示具有确定且不同的初始色块', () => {
    const picker = read('renderer/shell/pickers.js');
    const markdown = read('renderer/modules/markdown/index.js');
    assert.match(picker, /initialValue = '#000000'/);
    assert.match(picker, /this\.set\(initialValue\)/);
    assert.match(markdown, /label: '文字色',[\s\S]{0,80}initialValue: '#000000'/);
    assert.match(markdown, /label: '突出显示',[\s\S]{0,80}initialValue: '#ff0000'/);
  });

  test('toast 使用窗口几何中央状态栏 Seat，W52 左下与 W57 跳顶 workaround 退役', () => {
    const status = read('renderer/shell/statusbar.js');
    const shell = read('renderer/shell/shell.js');
    const css = read('renderer/styles/base.css');
    const e2e = read('tests/e2e/scenes43.mjs');
    assert.match(status, /class="statusbar-center" id="status-toast-slot"/);
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)\s+minmax\(0, auto\)\s+minmax\(0, 1fr\)/);
    assert.match(css, /\.statusbar-center\s*\{[\s\S]*max-width:\s*min\(50vw, 720px\)/);
    assert.match(shell, /const host = !fullscreenHost && statusSlot && !shellHidden \? statusSlot/);
    assert.doesNotMatch(shell, /shellHidden\s*=\s*[^;]*focus-mode/,
      'focus mode keeps the status bar visible and must not eject toast into a floating layer');
    assert.doesNotMatch(shell, /mazz-toast-top|vr\.bottom > window\.innerHeight - 120/);
    assert.doesNotMatch(css, /\.mazz-toast-top|\.mazz-toast \{[\s\S]{0,180}left:\s*12px/);
    assert.match(e2e, /Math\.abs\(\(r\.rect\.left \+ r\.rect\.width \/ 2\) - r\.viewport \/ 2\) <= 2/);
    assert.match(e2e, /r\.rect\.left >= r\.left\.right && r\.rect\.right <= r\.right\.left/);
  });

  test('构成及自定义构成欢迎卡 hover 时 SVG 切到配对前景色', () => {
    const themes = read('renderer/styles/themes.css');
    assert.match(themes, /\[data-theme="construct"\] \.w-card:hover \.mz-ico\s*,\s*\[data-theme="custom"\] \.w-card:hover \.mz-ico \{ color: var\(--accent-fg\); \}/);
  });

  test('npm run dev 在同一 Windows cmd 会话切 UTF-8，再启动 build / Electron', () => {
    const pkg = JSON.parse(read('package.json'));
    const dev = read('scripts/dev.js');
    assert.equal(pkg.scripts.dev, 'node scripts/dev.js');
    assert.match(dev, /steps = \['chcp 65001>nul'\]/);
    assert.match(dev, /steps\.join\(' && '\)/);
    assert.match(dev, /require\.resolve\('electron\/cli\.js'\)/);
    assert.doesNotMatch(read('scripts/build.js'), /chcp\.com|65001/,
      '孤立 build 子进程不得伪装成 Console 编码 owner');
    assert.doesNotMatch(read('main/main.js'), /chcp\.com|65001/, '编码治理不得侵入产品主进程');
    if (process.platform === 'win32') {
      const output = execFileSync(process.execPath, ['scripts/dev.js', '--encoding-probe'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      });
      assert.match(output, /\[mazz-dev-encoding-probe\] 中文日志可读/);
      assert.match(output, /65001/);
    }
  });
});
