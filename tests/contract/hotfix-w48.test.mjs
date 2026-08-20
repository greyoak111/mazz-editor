// tests/contract/hotfix-w48.test.mjs —— 真机三小改契约（侧栏限位/全屏字幕反馈/密码自动填充+修改识别）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('侧栏限位', () => {
  test('W58f/W58h 边界保留 + window/Pane 双路重钳', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    const surface = readSrc('renderer/modules/viewer/player-controls.js');
    assert.ok(src.includes('sideMaxNow'), '动态限位必须有');
    assert.ok(src.includes('SIDE_MIN = 150, SIDE_MAX = 520, CONTROL_MIN = 240'), '侧栏 150/520 与响应式核心位 240 边界必须同源');
    assert.ok(src.includes('stage.clientWidth - CONTROL_MIN') && src.includes('Math.floor(stage.clientWidth * 0.3)'), '窗格宽和 30% 渲染封顶必须进同一 sideMaxNow');
    assert.ok(src.includes("window.addEventListener('resize', applySide)"), '缩窗重钳必须有');
    assert.ok(src.includes('onRelayoutSide: applySide'), 'Control Surface 必须把 Pane 尺寸变化回供侧栏重钳');
    assert.ok(surface.includes('resizeObserver?.observe(stage)') && surface.includes('onRelayoutSide?.()'), 'Pane divider 不发 window.resize，必须由 stage ResizeObserver 补齐');
    assert.ok(src.includes('ctl.sidePreferredW = v.width'), '记忆恢复必须写用户 preferred 宽度，不能被当前窄窗永久改小');
    assert.ok(src.includes('Math.min(ctl.sidePreferredW, sideMaxNow())'), '渲染 effective 宽度仍必须按当前窗格动态重钳');
    assert.ok(src.includes('width: ctl.sidePreferredW'), '持久化必须保存 preferred 而非当前 effective 宽度');
  });
});

describe('全屏字幕反馈', () => {
  test('W87i toast 普通态进中央 Seat；全屏态回落到被提升的 Overlay Plane', () => {
    const src = readSrc('renderer/shell/shell.js');
    const visual = readSrc('renderer/core/visual-composition.js');
    assert.ok(src.includes('const fullscreenHost = document.fullscreenElement'), 'toast 必须识别当前全屏宿主');
    assert.ok(src.includes('fullscreenHost || document.body'), '全屏/沉浸态必须回落到可见宿主');
    assert.ok(src.includes("document.querySelector('#status-toast-slot')"), '普通态必须进入状态栏中央 Seat');
    assert.ok(visual.includes('const parent = document.fullscreenElement || document.body'), '统一 Overlay Plane 必须随 Fullscreen top layer 迁移');
    assert.ok(visual.includes("document.addEventListener('fullscreenchange', () => this.rehomePlane())"), '全屏往返必须主动重挂 Overlay Plane');
  });
});

describe('密码自动填充与修改识别', () => {
  test('自动填充（有库存静默填）', () => {
    const src = readSrc('main/browser-views.js');
    assert.ok(src.includes('autofillPw'), '自动填充必须有');
    assert.ok(src.includes('pwMatch'), '站点匹配必须有');
    assert.ok(src.includes('!pw || pw.value'), '空字段才填（用户已输入不动）必须有');
    assert.ok(src.includes('this.autofillPw(wc)'), '装载后触发必须有');
    const main = readSrc('main/main.js');
    assert.ok(main.includes('pwList: () =>') && main.includes('pwDecrypt(e.password)'), '主进程必须注入解密清单（渲染永不触密钥红线）');
  });
  test('修改识别→询问更新', () => {
    const src = readSrc('main/browser-views.js');
    assert.ok(src.includes('exist.password === j.p) return'), '一致静默必须有（不再问）');
    assert.ok(src.includes("this.emit(tabId, 'pw-changed'"), '不一致必须 pw-changed');
    const br = readSrc('renderer/modules/browser/index.js');
    assert.ok(br.includes("type === 'pw-changed'"), '渲染层询问必须有');
    assert.ok(br.includes('更新保存的密码') && br.includes('pw:save'), '询问更新落库必须有');
    assert.ok(br.includes('pwOffered|chg|'), '每会话只问一趟必须有');
  });
});
