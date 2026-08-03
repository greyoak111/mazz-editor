// tests/contract/hotfix-w54.test.mjs —— W54 契约（内录预览/坞拖拽三态/风格同盘/图标/收藏当前页/增强区全桥）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
import glob from 'node:fs';

describe('内录预览（B9）', () => {
  test('全面板 CSP img-src 放行 dataURL', () => {
    for (const f of glob.readdirSync(path.resolve('renderer/panels')).filter(x => x.endsWith('.html'))) {
      const html = readSrc(`renderer/panels/${f}`);
      assert.ok(html.includes("img-src 'self' data: blob:"), `${f} CSP 必须放行 dataURL（破图病根）`);
    }
  });
  test('选源卡定时刷新（轻量实况）', () => {
    const html = readSrc('renderer/panels/recorder.html');
    assert.ok(html.includes('setInterval') && html.includes('2500'), '定时刷新必须有');
    assert.ok(html.includes('!recording'), '录制中必须停刷');
  });
});

describe('坞拖拽手势三态（B10）', () => {
  test('主进程三句柄+热区吸附', () => {
    const pw = readSrc('main/panel-windows.js');
    for (const h of ['panel:dragStart', 'panel:move', 'panel:dragEnd']) assert.ok(pw.includes(h), `必须有 ${h}`);
    assert.ok(pw.includes('dock:snapHint'), '吸附提示必须有');
    assert.ok(pw.includes('容错补建') || pw.includes('补建会话'), 'move 容错补建必须有（拖出场景子窗刚开）');
  });
  test('①停靠态拽出跟手（老浮动路径退役）', () => {
    const sd = readSrc('renderer/shell/side-dock.js');
    assert.ok(sd.includes("panel:move', { kind: 'dockfloat'"), 'bar 拽出必须跟手 dockfloat');
    assert.ok(sd.includes('floated = true') && sd.includes('this.toggleFloat()'), '超阈值即浮必须有');
  });
  test('②dockfloat 自绘拖拽（跨屏自由）', () => {
    const html = readSrc('renderer/panels/dockfloat.html');
    assert.ok(!html.includes('-webkit-app-region:drag'), 'app-region 拖拽必须退役（transparent 跨屏病绕开）');
    assert.ok(html.includes('setPointerCapture') && html.includes('panel:dragStart'), '自绘拖拽必须有');
  });
  test('③拽回热区自动停靠', () => {
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes("kind === 'dockfloat'") && pw.includes("'docked'"), '拽回自动停靠必须有');
  });
  test('风格同盘（除圆角形态外组件同值）', () => {
    const html = readSrc('renderer/panels/dockfloat.html');
    assert.ok(html.includes('color-mix(in srgb, var(--accent) 45%, var(--border))'), '拖放区必须原版值');
    assert.ok(html.includes('letter-spacing:1px'), '工具组标题必须 accent 原版风');
    assert.ok(html.includes('padding:10px 10px 8px'), '打开方式卡必须原版 padding');
  });
});

describe('图标（B5）', () => {
  test('⌫ 补映射+⇩ 过 iconHtml', () => {
    assert.ok(readSrc('renderer/lib/svg-icons.js').includes("'⌫':"), 'MAP 必须有 ⌫');
    assert.ok(readSrc('renderer/shell/side-dock.js').includes("iconHtml('⇩')"), '⇩ 必须过 iconHtml');
  });
});

describe('收藏当前页收编（B3）', () => {
  test('bookmark kind 注册+桥+收编', () => {
    assert.ok(readSrc('main/panel-windows.js').includes('bookmark'), 'kind 注册必须有');
    const bi = readSrc('renderer/modules/browser/index.js');
    assert.ok(bi.includes('bookmarkQuery') && bi.includes('bookmarkSave'), '收藏桥必须有');
    assert.ok(bi.includes("panel:open', { kind: 'bookmark' }"), 'bookmarkCurrent 必须收编子窗格');
  });
});

describe('坞浮动增强区全桥（B8）', () => {
  test('chips 切换+配置+检索桥', () => {
    const sh = readSrc('renderer/shell/shell.js');
    for (const a of ['togglePlugin', 'toggleStyle', 'plugcfg', 'styleup', 'embedadd', 'embeddel', 'websearch']) {
      assert.ok(sh.includes(a), `factoryAction 必须有 ${a}`);
    }
    const df = readSrc('renderer/panels/dockfloat.html');
    assert.ok(df.includes('data-xa="togglePlugin"') && df.includes('fc-q'), '增强区必须可交互');
    assert.ok(!df.includes('配置请在主窗坞'), '「回主窗配置」妥协文案必须退役');
  });
});
