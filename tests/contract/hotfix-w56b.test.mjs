// tests/contract/hotfix-w56b.test.mjs —— 救火契约（P0 三件套/宿主化/P1/P2/军规⑩-⑫）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('P0a this.forward 静态区病绝育', () => {
  test('register 静态区无 forward/win 调用', () => {
    const pw = readSrc('main/panel-windows.js');
    const reg = pw.split('static register')[1].split('static broadcastTheme')[0];
    assert.ok(!/this\.(forward|win)\b/.test(reg.replace(/\/\/[^\n]*/g, '')), '静态区 this.forward/this.win 必须绝迹（连环炸平反）');
    assert.ok(pw.includes('静态区只干静态的事'), '正解注释必须在');
  });
});

describe('P0b 幽灵三钩', () => {
  test('deactivate 必隐/activate 必显/dispose 收尸', () => {
    const bi = readSrc('renderer/modules/browser/index.js');
    assert.ok(bi.includes('deactivate(container)') && /deactivate\(container\) \{[\s\S]{0,400}bv:bounds', \{ tabId: t\.viewId, visible: false/.test(bi), '切走必须全场景隐');
    assert.ok(/activate\(container\) \{[\s\S]{0,400}__sync/.test(bi), '切回必须发令显');
    assert.ok(bi.includes('dispose(state)') && bi.includes("invoke('bv:destroy'"), 'dispose 必须 destroy 收尸');
    assert.ok(bi.includes('ctl.__sync = syncBounds'), '__sync 出口必须挂');
    const mr = readSrc('renderer/core/module-registry.js');
    assert.ok(mr.includes('inst.def.dispose?.(inst.state)'), 'module-registry detach 必须调 dispose 钩');
  });
});

describe('P0c 视图宿主化', () => {
  test('create 按调用窗挂宿主+宿主死亡收尸+恢复路线修正', () => {
    const bv = readSrc('main/browser-views.js');
    assert.ok(bv.includes('BrowserWindow.fromWebContents'), 'fromWebContents 判宿主必须有');
    assert.ok(bv.includes('host.contentView.addChildView(view)'), '挂载必须走宿主窗');
    assert.ok(bv.includes('destroyByHost(win)'), '宿主死亡收尸必须有');
    assert.ok(bv.includes('(rec.hostWin || this.wm.main).contentView.removeChildView'), '摘除必须走宿主窗');
    const wm = readSrc('main/window-manager.js');
    assert.ok(wm.includes('destroyByHost(win)'), 'children closed 必须收尸');
    const sd = readSrc('renderer/shell/side-dock.js');
    assert.ok(sd.includes("panel:open', { kind: 'dockfloat' }") && sd.includes('复活路线修正'), 'Electron 下 float 恢复必须走 dockfloat');
  });
});

describe('P1 emoji 零残留（军规⑪）', () => {
  test('dockfloat 静态 emoji 绝迹+工具页 svg 化链路', () => {
    const df = readSrc('renderer/panels/dockfloat.html');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}⇥⇩✨⚡]/u.test(df), 'dockfloat 静态 emoji 必须零残留');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('svgGroups'), '工具页 iconHtml 转换必须有');
  });
});

describe('P1b 拖拽计算挪罩页（W57 已路线修正为 DOM 回归+cloak）', () => {
  test('罩页自算资产保留+主线 DOM 回归', () => {
    const html = readSrc('renderer/panels/splitpreview.html');
    assert.ok(html.includes('zoneIn') && html.includes('zoneGradient'), '罩页自算资产保留（备选通道）');
    const sh = readSrc('renderer/shell/shell.js');
    assert.ok(sh.includes('dragCloak(true)') && sh.includes('overlay.style.background = zoneGradient'), '主线必须 DOM overlay+拖拽 cloak（路线修正实锤）');
  });
});

describe('B13 更多回老样式', () => {
  test('showMore 走 ctxmenu 子窗格', () => {
    const rb = readSrc('renderer/shell/ribbon.js');
    assert.ok(rb.includes("kind: 'ctxmenu'"), 'ctxmenu 承载必须有');
    assert.ok(rb.includes('menus._ctxItems'), 'stash 必须有');
  });
});

describe('P2b sync 系收编', () => {
  test('sync 面板+三入口收编+白名单直调', () => {
    const html = readSrc('renderer/panels/sync.html');
    for (const ch of ['sync:host', 'sync:stopHost', 'sync:join', 'sync:discover', 'sync:status', 'update:check', 'update:getConfig']) {
      assert.ok(html.includes(ch), `面板必须直调 ${ch}`);
    }
    const sy = readSrc('renderer/sync.js');
    assert.ok(sy.includes("panel:open', { kind: 'sync' }"), 'sync.js 必须收编子窗格');
    assert.ok(!sy.includes("modal('局域网同步 · 发起共享')") || sy.includes('isElectron'), 'DOM modal 必须只剩兜底');
  });
});

describe('军规⑩ 主进程日志警察', () => {
  test('human.watchMain+runN 收编', () => {
    const h = readSrc('tests/e2e/human.mjs');
    assert.ok(h.includes('watchMain') && h.includes('主进程异常'), '主进程警察必须在');
    for (const n of [42, 44, 45, 46, 47, 48, 49, 50, 51, 52]) {
      assert.ok(readSrc(`tests/e2e/run${n}.mjs`).includes('human.watchMain(app)'), `run${n} 必须挂警察`);
    }
  });
});
