// W87i —— Pane 页签稳定锚定 + 工具坞拖出连续性 + 浮动指令台追平
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const src = file => fs.readFileSync(path.resolve(file), 'utf8');

describe('W87i Pane 页签稳定右靠', () => {
  test('单窗格/多窗格共用与 close button 无关的右锚', () => {
    const css = src('renderer/styles/base.css');
    assert.ok(css.includes('.pane .tabbar::before') && css.includes('margin-left: auto'), '右锚必须是 tabbar 稳定结构，不得依赖窗格关闭钮是否显示');
    assert.ok(css.includes('.pane-close { margin-left: 0;'), '关闭钮不得再以 auto margin 导致页签随分屏左右跳');
    assert.ok(css.includes('overflow-anchor: none') && css.includes('scroll-behavior: auto'), 'Chromium DOM scroll anchoring 不得与 Tabs 状态机争夺 scrollLeft');
  });

  test('全量 render 显式保存右缘/视觉锚，并以活动页签可见收敛', () => {
    const tabs = src('renderer/shell/tabs.js');
    for (const token of [
      '_scrollPinnedRight', '_scrollSnapshot()', '_restoreScroll(scrollSnapshot)',
      'renderedActiveId', 'anchorId', 'anchorLeft', '_ensureActiveVisible()',
      'this._setScroll(this._maxScroll(), true)', 'generation !== this._renderGeneration',
    ]) assert.ok(tabs.includes(token), `溢出页签稳定状态机缺 ${token}`);
    assert.ok(tabs.indexOf('const scrollSnapshot = this._scrollSnapshot()') < tabs.indexOf("this.el.querySelectorAll('.tab').forEach"), 'scroll 状态必须在删节点前采样');
    assert.ok(tabs.indexOf('this._restoreScroll(scrollSnapshot)') > tabs.lastIndexOf('this.el.appendChild(el)'), 'scroll 状态只能在新页签全部挂载后恢复');
  });
});

describe('W87i 停靠坞拖出位置连续', () => {
  test('renderer 传原工具坞抓手坐标并显式开始 drag session', () => {
    const dock = src('renderer/shell/side-dock.js');
    for (const token of ['grabX', 'grabY', 'anchor:', "panel:dragStart', { kind: 'dockfloat'", "opts ? { kind: 'dockfloat', opts }"]) {
      assert.ok(dock.includes(token), `拖出连续链缺 ${token}`);
    }
  });

  test('Panel owner 创建阶段消费 x/y，不先居中再猜 offset', () => {
    const panels = src('main/panel-windows.js');
    assert.ok(panels.includes("kind === 'dockfloat'") && panels.includes('const dockAnchor ='), 'dockfloat 必须有专用初始锚点');
    assert.ok(panels.includes('...dockAnchor') && panels.includes("kind === 'dockfloat' ? (opts.w || 400)"), '锚点与原工具坞尺寸必须进 BrowserWindow options');
  });

  test('浮窗跨窗命中穿透，并由 up/cancel/blur/close 四路收回', () => {
    const dock = src('renderer/shell/side-dock.js');
    const panel = src('renderer/panels/dockfloat.html');
    const owner = src('main/panel-windows.js');
    assert.ok(owner.includes('setIgnoreMouseEvents(!!enabled') && owner.includes('{ forward: true }'), '浮窗出现后必须命中穿透，把 move/up 留给源窗');
    assert.ok(owner.includes("bus.handle('panel:dragCancel'") && owner.includes("win.on('close'"), 'cancel/close 必须撤销 click-through');
    for (const event of ["'pointercancel'", "'blur'"]) assert.ok(dock.includes(event), `停靠源拖拽缺 ${event} 兜底`);
    assert.ok(panel.includes("'panel:dragCancel'") && panel.includes("'pointercancel'") && panel.includes("'blur'"), '浮窗自身再拖拽也必须有取消收尾');
  });

  test('主窗拖出与浮窗二次拖拽拥有不同 origin，只有前者 click-through', () => {
    const dock = src('renderer/shell/side-dock.js');
    const panel = src('renderer/panels/dockfloat.html');
    const owner = src('main/panel-windows.js');
    assert.ok(dock.includes("origin: 'host'") && panel.includes("origin: 'float'"), '两个手势源必须显式标明 host/float');
    assert.ok(owner.includes("dragOrigin === 'host'") && owner.includes("setDockDragPassthrough(win, true)"), 'click-through 必须只由 host origin 开启');
    assert.ok(owner.includes('win.__panelDragOrigin = null') && owner.includes('dragWin.__panelDragOrigin = null'), 'up/cancel/close 必须清除 origin 诊断态');
    assert.ok(owner.includes("app.on('before-quit'") && owner.includes("kind === 'dockfloat' && !this._appQuitting"), '应用退出不得把 persisted-float 误判成用户关窗并改回停靠');
  });
});

describe('W87i 浮动坞功能追平与窄宽指令台', () => {
  test('快照包含指令台纯数据，执行仍返回主窗 owner', () => {
    const factory = src('renderer/modules/factory/index.js');
    const panel = src('renderer/panels/dockfloat.html');
    const shell = src('renderer/shell/shell.js');
    assert.ok(factory.includes('commandDesk:') && factory.includes('adapters:') && factory.includes('cards:'), '浮动坞快照缺指令台数据');
    assert.ok(panel.includes('class="df-command"') && panel.includes("act: 'agentSubmit'") && panel.includes("act: 'harnessRefresh'"), '浮动坞缺可操作指令台');
    assert.ok(panel.includes("act('dockFloatInit')") && panel.includes('requestToolsSnapshot({ reset: true })'), '工具清单必须与首发快照并行预取');
    assert.ok(shell.includes("pl.act === 'agentSubmit'") && shell.includes('fp.submitAgent()'), '执行不得在子窗复制第二个 AgentRuntime');
  });

  test('停靠坞指令台使用 container 宽度收敛，不误用整窗 media query', () => {
    const css = src('renderer/styles/base.css');
    assert.ok(css.includes('container-type: inline-size') && css.includes('@container (max-width: 460px)'), '指令台必须按坞本身宽度响应');
    assert.ok(css.includes('grid-template-columns: minmax(0, 1fr) minmax(0, .8fr) auto auto'), '执行器/模型列必须可缩小');
  });

  test('快照重绘保存草稿、selection、focus 与 adapter/model 本地选择', () => {
    const panel = src('renderer/panels/dockfloat.html');
    for (const token of ['commandLocal', 'captureCommandLocal()', 'restoreCommandLocal(localView)', 'selectionStart', 'setSelectionRange', "active.focus({ preventScroll: true })"]) {
      assert.ok(panel.includes(token), `快照本地编辑态协议缺 ${token}`);
    }
    assert.ok(panel.includes("$('#df-adapter')?.addEventListener('change'") && panel.includes("$('#df-model')?.addEventListener('input'"), 'adapter/model 当前选择必须脱离 owner 快照保活');
  });

  test('工具清单等待 owner ready，空数组不作为终态并由构建完成主动补推', () => {
    const dock = src('renderer/shell/side-dock.js');
    const panel = src('renderer/panels/dockfloat.html');
    const shell = src('renderer/shell/shell.js');
    assert.ok(dock.includes('whenToolsReady') && dock.includes('pushToolsSnapshot()') && dock.includes('this._toolsReady = true'), 'SideDock 必须拥有 readiness 与构建完成主动推');
    assert.ok(shell.includes('await this.sideDock?.whenToolsReady?.(5000)') && shell.includes("if (!groups.some(([, items]) => items?.length)) return"), 'bridge 不得推空清单冒充终态');
    assert.ok(panel.includes('requestToolsSnapshot') && panel.includes('toolsRequestAttempt < 20') && panel.includes('toolsData = null'), '浮窗必须把空响应判为未就绪并有界重试');
  });
});
