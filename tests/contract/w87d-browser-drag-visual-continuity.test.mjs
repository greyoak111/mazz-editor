import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const splitSection = () => {
  const shell = read('renderer/shell/shell.js');
  return shell.slice(shell.indexOf('installSplitPreview()'), shell.indexOf('/** 外部文件拖入'));
};

describe('W87d Browser 拖拽视觉连续性合同', () => {
  test('每个可见 Browser Surface 都先 capture、解码、入视觉平面并完成双帧预绘', () => {
    const section = splitSection();
    assert.match(section, /visibleBrowserSurfaces/);
    assert.match(section, /invoke\('bv:captureVisibleHost'/);
    assert.match(section, /await Promise\.all\(decodes\)/);
    const decode = section.indexOf('await Promise.all(decodes)');
    const append = section.indexOf('appendChild(node)', decode);
    const paint = section.indexOf('await nextPaint()', append);
    assert.ok(decode > 0 && append > decode && paint > append, 'decode → append → 双帧 paint 顺序不得颠倒');
  });

  test('capture/paint 完成之前只记 pending zone，禁止 overlay token 或 cloak 抢跑', () => {
    const section = splitSection();
    assert.match(section, /if \(!proxyReady && window\.mazz\?\.isElectron\)/);
    assert.match(section, /proxyPhase === 'capturing'[^}]*pendingPreview/s);
    const activation = section.slice(section.indexOf('buildProxy(session).then'), section.indexOf('}).catch(error', section.indexOf('buildProxy(session).then')));
    assert.match(activation, /proxy = result\.node;[\s\S]*ensureOverlay\(\);[\s\S]*await overlayHandle\?\.ready[\s\S]*dragCloak\(true\);[\s\S]*proxyReady = true/);
  });

  test('非活动外壳标签必须在 capture 相先激活，不能漏掉落位后要显示的 Browser Surface', () => {
    const section = splitSection();
    const tabs = read('renderer/shell/tabs.js');
    assert.match(tabs, /el\.dataset\.tabId = t\.id/);
    const dragstart = section.slice(section.indexOf("document.addEventListener('dragstart'"), section.indexOf("document.addEventListener('dragover'"));
    assert.match(dragstart, /dataset\?\.tabId[\s\S]*sourceLeaf\.tabs\.activate\(sourceId\)/);
    assert.ok(dragstart.indexOf('sourceLeaf.tabs.activate(sourceId)') < dragstart.indexOf('buildProxy(session)'),
      '源标签激活必须早于 host Surface capture');
    const build = section.slice(section.indexOf('const buildProxy'), section.indexOf('const waitSurfacesVisible'));
    assert.ok(build.indexOf('await nextPaint()') < build.indexOf("invoke('bv:captureVisibleHost'"),
      '激活后须等待布局/同 sender bounds 写回，再枚举 host Surface');
  });

  test('任一 capture 失败时 fail visible：不 cloak、不挂 token、不能提交无预览 drop', () => {
    const section = splitSection();
    const failure = section.slice(section.indexOf('}).catch(error =>'), section.indexOf("document.addEventListener('dragover'"));
    assert.match(failure, /保持原 Surface/);
    assert.match(failure, /proxyPhase = 'degraded-visible'/);
    assert.doesNotMatch(failure, /dragCloak\(true\)|ensureOverlay\(\)/);
    assert.match(section, /proxyPhase !== 'active'\) \{ cleanup\(\); return; \}/);
  });

  test('恢复顺序保留代理，直到同一 WCV 在新 bounds 明确 visible', () => {
    const section = splitSection();
    const cleanup = section.slice(section.indexOf('const cleanup ='), section.indexOf('const armDog'));
    const release = cleanup.indexOf('releaseOverlay()');
    const uncloak = cleanup.indexOf('dragCloak(false)');
    const wait = cleanup.indexOf('waitSurfacesVisible');
    const remove = cleanup.indexOf('retiredProxy?.remove()');
    assert.ok(release >= 0 && uncloak > release && wait > uncloak && remove > wait, 'release → uncloak → visible gate → remove 顺序不得颠倒');
    assert.match(section, /state && !state\.hidden && !state\.occluded/);
    assert.doesNotMatch(section.slice(section.indexOf('const waitSurfacesVisible'), section.indexOf('const ensureOverlay')), /timeout|return false/, '不得以固定超时绕过可见性 Gate');
    assert.ok(cleanup.indexOf('await waitSurfacesVisible(retiredViewIds)') < cleanup.indexOf('retiredProxy?.remove()'));
    assert.match(cleanup, /restore-failed/);
  });

  test('代理只携带瞬时本地像素且不可交互，旧原生 splitpreview 不回主线', () => {
    const section = splitSection();
    const css = read('renderer/styles/base.css');
    assert.match(section, /mazz-split-surface-proxy/);
    assert.match(css, /\.mazz-split-surface-proxy\s*\{[^}]*pointer-events:\s*none/);
    assert.match(css, /\.mazz-split-surface-frame\s*\{[^}]*pointer-events:\s*none[^}]*border:\s*0/);
    assert.doesNotMatch(section, /panel:open[\s\S]{0,80}splitpreview|kind:\s*'splitpreview'/);
  });

  test('代理必须穿透 hit-test，统一 Overlay 通用规则不得把它改回 auto', () => {
    const section = splitSection();
    const base = read('renderer/styles/base.css');
    const convergence = read('renderer/styles/convergence.css');
    assert.match(section, /node\.style\.pointerEvents = 'none'/);
    assert.match(base, /#mazz-overlay-plane > \.mazz-split-surface-proxy[\s\S]*pointer-events:\s*none/);
    assert.match(convergence, /#mazz-overlay-plane > \.mazz-split-surface-proxy\s*\{\s*pointer-events:\s*none/);
  });

  test('分区渐变几何必须立即落位，禁止 transition all 从页面原点扫出色带', () => {
    const section = splitSection();
    assert.match(section, /transition:opacity \.08s ease/);
    assert.doesNotMatch(section, /transition:all \.08s ease/);
    assert.match(section, /overlay\.style\.opacity = '1'/);
  });

  test('捕获集合与 host-wide occlusion 使用同一主进程真源并在遮挡前原子校验', () => {
    const views = read('main/browser-views.js');
    const visual = read('main/visual-composition.js');
    const client = read('renderer/core/visual-composition.js');
    const bridge = read('preload/bridge.js');
    for (const source of [views, bridge]) assert.match(source, /bv:captureVisibleHost/);
    assert.match(views, /hostCoverage[\s\S]*validateHostCoverage[\s\S]*captureVisibleHost/);
    assert.match(visual, /split-drag[\s\S]*validateHostCoverage/);
    assert.match(client, /coveredViews[\s\S]*visual:overlayBegin/);
    const validation = views.slice(views.indexOf('validateHostCoverage'), views.indexOf('async captureVisibleHost'));
    assert.match(validation, /webContentsId === supplied\[index\]\.webContentsId/);
    assert.doesNotMatch(validation, /sameBounds\(item\.bounds, supplied\[index\]\.bounds\)/,
      '遮挡门禁钉身份集合；旧 bounds 只允许在 capture 前后钉稳，不能在双帧预绘后制造 1px 假拒绝');
    const activation = splitSection().slice(splitSection().indexOf('buildProxy(session).then'), splitSection().indexOf('}).catch(error', splitSection().indexOf('buildProxy(session).then')));
    assert.ok(activation.indexOf('await relayoutProxy(proxy)') < activation.indexOf('ensureOverlay()'),
      '代理须先贴合当前 DOM 几何，再申请 host-wide occlusion');
  });
});
