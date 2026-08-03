// tests/contract/hotfix-w48.test.mjs —— 真机三小改契约（侧栏限位/全屏字幕反馈/密码自动填充+修改识别）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('侧栏限位', () => {
  test('窗宽钳制+resize 重钳', () => {
    const src = readSrc('renderer/modules/viewer/player.js');
    assert.ok(src.includes('sideMaxNow'), '动态限位必须有');
    assert.ok(src.includes('stage.clientWidth - 560'), '视频区+底栏 560px 保留必须有（全屏钮区不被挤掉——真机点名）');
    assert.ok(src.includes("window.addEventListener('resize', applySide)"), '缩窗重钳必须有');
    assert.ok(src.includes('Math.min(v.width, sideMaxNow())'), '记忆恢复也必须过钳');
  });
});

describe('全屏字幕反馈', () => {
  test('toast 全屏挂接', () => {
    const src = readSrc('renderer/shell/shell.js');
    assert.ok(src.includes('(document.fullscreenElement || document.body).appendChild(el)'), 'toast 必须挂 fullscreenElement（与 modal 同款修法——全屏按字幕有反馈实锤）');
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
