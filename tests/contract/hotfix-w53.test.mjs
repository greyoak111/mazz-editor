// tests/contract/hotfix-w53.test.mjs —— W53 契约（全原生独立子窗格：七面板+坞浮动+lean 退役）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const exists = (p) => fs.existsSync(path.resolve(p));

describe('七面板全原生子窗格', () => {
  test('面板页全存在+骨架三件套（themes/panel-shared/拖拽条）', () => {
    for (const f of ['settings', 'agreement', 'help', 'translate', 'plugins', 'recorder', 'dockfloat']) {
      assert.ok(exists(`renderer/panels/${f}.html`), `${f}.html 必须存在`);
      const html = readSrc(`renderer/panels/${f}.html`);
      assert.ok(html.includes('../styles/themes.css'), `${f} 必须链 themes.css（主题跟随）`);
      assert.ok(html.includes('panel-shared.css'), `${f} 必须链 panel-shared.css（滚动条军规）`);
      assert.ok(html.includes('p-drag'), `${f} 必须有拖拽条（无框移动手段）`);
      assert.ok(html.includes('theme:changed'), `${f} 必须听主题广播（主题变窗格变）`);
    }
    assert.ok(exists('renderer/panels/palette.html'), 'palette（W62c 四路 Quick Switcher）必须存在');
    const palette = readSrc('renderer/panels/palette.html');
    assert.ok(palette.includes('quickSwitcherQuery') && palette.includes('kind-file'), 'palette 必须收编文件路并与其他来源同框');
  });
  test('kind 白名单+尺寸标题表', () => {
    const pw = readSrc('main/panel-windows.js');
    for (const k of ['settings', 'agreement', 'help', 'translate', 'plugins', 'quickopen', 'recorder', 'dockfloat']) {
      assert.ok(pw.includes(k), `panel-windows 必须认识 ${k}`);
    }
  });
  test('桥应答全齐', () => {
    const sh = readSrc('renderer/shell/shell.js');
    for (const t of ['agreementQuery', 'settingsQuery', 'settingsSet', 'settingsAction', 'helpQuery', 'pluginsQuery', 'pluginsAction', 'recQuery', 'recStart', 'recStop', 'quickopenQuery', 'quickopenRun', 'paletteInitQuery', 'translateStashInit', 'dockFloatInit', 'dockToolsQuery', 'dockRun', 'dockFloatBack', 'factoryAction']) {
      assert.ok(sh.includes(t), `panel:action 桥必须有 ${t}`);
    }
  });
});

describe('调用点收编（浏览器前台零 DOM modal）', () => {
  test('七处入口全走 panel:open', () => {
    assert.ok(readSrc('renderer/shell/shell.js').includes("kind: 'settings'"), '设置收编');
    assert.ok(readSrc('renderer/shell/ribbon.js').includes("kind: 'agreement'"), '协议收编');
    assert.ok(readSrc('renderer/help/index.js').includes("kind: 'help'"), '帮助收编');
    assert.ok(readSrc('renderer/translate.js').includes("kind: 'translate'"), '翻译收编');
    assert.ok(readSrc('renderer/plugins/manager.js').includes("kind: 'plugins'"), '插件收编');
    assert.ok(readSrc('renderer/shell/shell.js').includes("kind: 'recorder'"), '内录收编');
    const shell = readSrc('renderer/shell/shell.js');
    assert.ok(shell.includes("R('file.quickOpen'") && shell.includes("kind: 'palette'"), '快速跳转收编到统一 palette');
  });
});

describe('坞浮动=纯原生独立子窗格', () => {
  test('联动三件套+工厂镜像接口', () => {
    const sd = readSrc('renderer/shell/side-dock.js');
    assert.ok(sd.includes("panel:open', { kind: 'dockfloat' }"), '浮动必须开 dockfloat');
    assert.ok(sd.includes('backFromFloat'), '回停靠联动必须有');
    assert.ok(sd.includes('this._toolsGroups = ['), 'GROUPS 出口必须有');
    const fp = readSrc('renderer/modules/factory/index.js');
    assert.ok(fp.includes('snapshot()') && fp.includes('pushSnapshot()') && fp.includes('pushTasks()'), '工厂镜像接口必须有');
    assert.ok(fp.includes('tasksSnapshot()'), '任务快照必须有');
    const pw = readSrc('main/panel-windows.js');
    assert.ok(pw.includes("kind === 'dockfloat'"), 'dockfloat closed 联动必须有');
  });
});

describe('lean 体系全体退役', () => {
  test('五处绝迹', () => {
    assert.ok(!readSrc('renderer/shell/shell.js').includes('openChildModal'), 'openChildModal 绝迹');
    assert.ok(!readSrc('renderer/shell/shell.js').includes('snapshot?.openModal'), 'openModal 支路绝迹');
    assert.ok(!readSrc('main/main.js').includes('handoff.lean = true'), 'main lean 注入绝迹');
    assert.ok(!readSrc('main/window-manager.js').includes('opts.lean'), 'createChild lean 绝迹');
    assert.ok(!readSrc('renderer/styles/base.css').includes('data-window-mode'), 'lean CSS 绝迹');
  });
});
