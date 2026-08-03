// tests/contract/browser-w43.test.mjs —— 波次四十三「衍生面板并行化」契约（白屏病根治）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('原生子窗（panel-windows.js）', () => {
  test('并行进程骨架', () => {
    const src = readSrc('main/panel-windows.js');
    assert.ok(src.includes('BrowserWindow'), '子窗必须 BrowserWindow（独立合成层）');
    assert.ok(src.includes("preload: path.join(__dirname, '..', 'preload', 'bridge.js')"), '子窗必须同桥（数据 IPC 直取）');
    assert.ok(src.includes('mazz-res://app/panels/'), '面板页必须 mazz-res 同源');
    assert.ok(src.includes('panels = new Map()') && src.includes('exist.show()'), '单例聚焦必须有');
    assert.ok(/if \(!\/\^\(favmgr\|pwmgr\)\$\//.test(src) || src.includes("kind === 'favmgr'"), '面板种类白名单必须有');
  });
  test('回推双通道', () => {
    const src = readSrc('main/panel-windows.js');
    assert.ok(src.includes("bus.handle('panel:changed'") && src.includes("bus.handle('panel:action'"), 'changed/action 双通道必须有');
    assert.ok(src.includes('this.bus.send(w, channel, payload)'), '必须转主窗渲染层');
  });
  test('装配与白名单', () => {
    const main = readSrc('main/main.js');
    assert.ok(main.includes("require('./panel-windows')"), 'main.js 必须装配');
    const br = readSrc('preload/bridge.js');
    for (const c of ['panel:open', 'panel:close', 'panel:changed', 'panel:action']) assert.ok(br.includes(`'${c}'`), `缺 ${c}`);
  });
});

describe('面板页自立', () => {
  test('收藏管理页', () => {
    const src = readSrc('renderer/panels/favmgr.html');
    assert.ok(src.includes("browser.bookmarks") && src.includes("browser.folders"), '必须直取收藏双键');
    assert.ok(src.includes("panel:changed") && src.includes("panel:action"), '回推必须有');
    assert.ok(src.includes("type: 'openUrl'"), '点条目必须回主窗开标签');
    assert.ok(!src.includes('WebContentsView'), '面板页不得含视图件');
  });
  test('密码管理器页', () => {
    const src = readSrc('renderer/panels/pwmgr.html');
    assert.ok(src.includes("pw:list") && src.includes("pw:save") && src.includes("pw:delete"), '必须直取 pw 三通道');
    assert.ok(src.includes("type: 'fillPassword'"), '填充动作必须有');
  });
});

describe('主窗改道', () => {
  test('双面板命令走并行', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(/openBookmarkManager\(\) \{\s*if \(isElectron\(\)\) \{ window\.mazz\.invoke\('panel:open', \{ kind: 'favmgr' \}\)/.test(src), '收藏管理必须并行优先（modal 仅网页兜底）');
    assert.ok(/openPasswordManager\(\) \{\s*if \(isElectron\(\)\) \{ window\.mazz\.invoke\('panel:open', \{ kind: 'pwmgr' \}\)/.test(src), '密码管理器必须并行优先');
    assert.ok(src.includes("mazz.on('panel:changed'") && src.includes('loadStore().then'), '改完即刷必须有');
    assert.ok(src.includes("mazz.on('panel:action'") && src.includes('fillPassword(pl.id)'), '指定条目填充必须有');
  });
  test('fillPassword 指定条目', () => {
    const src = readSrc('renderer/modules/browser/index.js');
    assert.ok(src.includes('fillPassword(pwId = null)'), 'fillPassword 必须吃可选 id');
    assert.ok(src.includes('list.find(e => e.id === pwId)'), '指定条目查找必须有');
  });
});
