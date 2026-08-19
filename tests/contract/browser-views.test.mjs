// tests/contract/browser-views.test.mjs —— 波次二十「浏览器根治」架构契约（WebContentsView 迁移）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('浏览器根治·主进程视图注册表', () => {
  test('BrowserViews 全套通道与新窗审批', () => {
    const src = readSrc('main/browser-views.js');
    for (const ch of ["'bv:create'", "'bv:destroy'", "'bv:bounds'", "'bv:focus'", "'bv:nav'", "'bv:js'", "'bv:zoom'", "'bv:find'", "'bv:navHistory'", "'bv:state'", "'bv:captureVisibleHost'"]) {
      assert.ok(src.includes(ch), `缺通道 ${ch}`);
    }
    assert.ok(src.includes('WebContentsView'), '必须主进程持有 WebContentsView');
    assert.ok(src.includes('addChildView') && src.includes('removeChildView'), '必须挂/摘主窗视图树');
    assert.ok(src.includes('setWindowOpenHandler') && src.includes("action: 'deny'"), '新窗审批必须 deny 转标签');
    assert.ok(src.includes('setVisible'), '遮挡隐身必须有 setVisible');
    // 会话安全基线（webview 时代 will-attach 钳制的平移）
    for (const k of ['nodeIntegration: false', 'contextIsolation: true', 'sandbox: true', 'webSecurity: true']) {
      assert.ok(src.includes(k), `webPreferences 缺 ${k}`);
    }
    // 事件转发全覆盖（渲染层唯一感知通道）
    for (const ev of ['did-navigate', 'did-fail-load', 'render-process-gone', 'unresponsive', 'console-message', 'context-menu', 'open-url', 'enter-html-full-screen']) {
      assert.ok(src.includes(ev), `事件转发缺 ${ev}`);
    }
  });
  test('装配与桥白名单', () => {
    assert.ok(readSrc('main/main.js').includes("require('./browser-views')"), '主进程必须装配 BrowserViews');
    const bridge = readSrc('preload/bridge.js');
    for (const ch of ["'bv:create'", "'bv:destroy'", "'bv:bounds'", "'bv:nav'", "'bv:js'", "'bv:captureVisibleHost'", "'bv:event'"]) {
      assert.ok(bridge.includes(ch), `桥白名单缺 ${ch}`);
    }
    // 主进程 handler 覆盖桥通道（双白名单同步绝育——主进程缺 handler=channel not allowed）
    const main = fs.readdirSync(path.resolve('main')).filter(f => f.endsWith('.js')).map(f => readSrc('main/' + f)).join('\n');
    for (const ch of ['bv:create', 'bv:destroy', 'bv:bounds', 'bv:focus', 'bv:nav', 'bv:js', 'bv:zoom', 'bv:find', 'bv:navHistory', 'bv:state', 'bv:captureVisibleHost']) {
      assert.ok(main.includes(`'${ch}'`), `主进程缺 handler: ${ch}`);
    }
  });
});

describe('浏览器根治·渲染层双路径', () => {
  test('Electron 视图路径与预览 iframe 路径分家', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(src.includes('br-view-host'), '必须有宿主占位');
    assert.ok(src.includes("window.mazz.on('bv:event'"), '必须有视图事件路由器');
    assert.ok(src.includes('handleBvEvent'), '必须有统一事件处理');
    assert.ok(src.includes('bindIframeView'), '预览 iframe 路径必须独立');
    assert.ok(!src.includes("document.createElement('webview')"), '不得再创建 webview 标签');
    // 摆位与遮挡隐身
    assert.ok(src.includes('syncBounds'), '必须有摆位引擎');
    assert.ok(!src.includes('_cloaked') && src.includes('_dragCloak'), 'Browser 只消费 W87d 代理先行临时闸，弹层不得再由 Browser 私管');
    const shell = readSrc('renderer/shell/shell.js');
    const views = readSrc('main/browser-views.js');
    const split = shell.slice(shell.indexOf('installSplitPreview()'), shell.indexOf('/** 外部文件拖入'));
    assert.ok(split.includes("invoke('bv:captureVisibleHost'") && split.includes('await overlayHandle?.ready'));
    assert.ok(split.indexOf('dragCloak(true)') > split.indexOf('await overlayHandle?.ready'));
    assert.ok(views.includes('validateHostCoverage') && views.includes('webContentsId'));
    const visual = readSrc('renderer/core/visual-composition.js');
    assert.ok(visual.includes('visual:overlayBegin') && visual.includes('visual:overlayEnd'), '弹层遮挡必须走统一视觉协议');
    assert.ok(!src.includes("mazz.on('bv:frame'"), '帧管线必须已退（离屏弯路清算实锤）');
    assert.ok(!src.includes('br-osr'), '离屏 canvas 必须已退');
    // 导航纪律：错误页写进失败文档（回退天然落前页，无跳链累赘）+ 减重看门狗
    assert.ok(src.includes('renderLoadError'), '错误页渲染必须有');
    assert.ok(src.includes('_navDog'), '减重看门狗必须有');
    // HTML5 全屏铺满主窗
    assert.ok(src.includes('enter-html-full-screen') && src.includes('window.innerWidth'), '全屏摆位必须有');
    // 测试口
    assert.ok(src.includes('ctl.execJs'), 'E2E 探查口必须有');
  });

  test('隐→显恢复振荡（右键/弹层后白屏根治）', () => {
    const src = readSrc('main/browser-views.js');
    assert.ok(src.includes('rec.hidden'), '隐身状态必须跟踪');
    assert.ok(src.includes('reviving'), '隐→显转换必须识别');
    assert.ok(src.includes('_reviveGen'), '振荡必须带代际闸（期间又隐身只认最新一趟）');
    assert.ok(/width: Math\.max\(1, R\.width - 1\)/.test(src), '±1px 宽度振荡必须有（同值 setBounds 被 Chromium 跳过实锤）');
    assert.ok(/height: Math\.max\(1, R\.height - 1\)/.test(src), '高度二帧振荡必须有');
    assert.ok(src.includes('hidden: !!rec.hidden') && src.includes('reviveGen'), 'bv:state 必须暴露恢复规程（E2E 探针）');
  });

  test('mkv 容错（坏块降级不炸通道）', () => {
    const src = readSrc('main/mkv-demux.js');
    assert.ok(/catch \{ cur\.pos = cEnd; break; \}/.test(src), 'Cluster 内坏块必须弃块续扫（非法 varint 炸通道实锤）');
    const main = readSrc('main/main.js');
    assert.ok(main.includes('EBML 结构损坏或超出解析面'), '通道错误必须明白话化');
  });
});
