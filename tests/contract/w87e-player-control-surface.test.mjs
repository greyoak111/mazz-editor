// W87e —— Player Control Surface：容器响应式、同节点 More、分屏几何与生命周期合同。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = p => fs.readFileSync(path.resolve(p), 'utf8');
const player = readSrc('renderer/modules/viewer/player.js');
const surface = readSrc('renderer/modules/viewer/player-controls.js');
const companion = readSrc('renderer/modules/viewer/companion.js');
const icons = readSrc('renderer/lib/svg-icons.js');
const selectMenu = readSrc('renderer/lib/select-menu.js');
const menuService = readSrc('renderer/core/menu-service.js');
const css = readSrc('renderer/styles/base.css');

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function controlSurfaceFixture() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="mz-stage">
      <div class="mz-controls">
        <div class="mz-bar">
          <button data-a="tool" data-player-min="never" data-player-group="tools" data-player-label="工具">工具</button>
          <button data-a="fullscreen" data-player-min="never" data-player-group="picture" data-player-label="全屏">全屏</button>
          <button data-a="video-only" data-player-min="never" data-player-group="picture" data-player-label="仅视频" data-player-video-only="1">仅视频</button>
          <button data-a="more-controls" aria-expanded="false"><span class="mz-more-dot"></span>更多</button>
        </div>
      </div>
      <section class="mz-control-center" hidden>
        <header><span class="mz-control-density"></span><button data-a="more-close">关闭</button></header>
        <div class="mz-control-center-body"></div>
      </section>
    </div>`;
  document.body.appendChild(root);
  for (const button of root.querySelectorAll('button')) {
    button.getClientRects = () => button.closest('[hidden]') ? [] : [{ width: 1, height: 1 }];
  }
  const controls = root.querySelector('.mz-controls');
  controls.getBoundingClientRect = () => ({ width: 320, height: 48, left: 0, right: 320, top: 0, bottom: 48, x: 0, y: 0 });
  return { root, stage: root.querySelector('.mz-stage'), controls };
}

function responsiveControlFixture(width) {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="mz-stage">
      <div class="mz-controls">
        <div class="mz-bar">
          <button data-a="prev" data-player-min="440" data-player-group="transport">上一个</button>
          <button data-a="play">播放</button>
          <span class="mz-time">00:00 / --:--</span><span class="mz-bar-spacer"></span>
          <button data-a="mute" data-player-min="280" data-player-group="sound">静音</button>
          <span data-a="speed" data-player-min="600" data-player-group="sound">倍速</span>
          <button data-a="pip" data-player-min="960" data-player-group="picture">画中画</button>
          <button data-a="snap" data-player-min="never" data-player-group="tools">截图</button>
          <button data-a="more-controls" aria-expanded="false"><span class="mz-more-dot"></span>更多</button>
          <button data-a="fullscreen" data-player-min="280" data-player-group="picture">全屏</button>
        </div>
      </div>
      <section class="mz-control-center" hidden>
        <header><span class="mz-control-density"></span><button data-a="more-close">关闭</button></header>
        <div class="mz-control-center-body"></div>
      </section>
    </div>`;
  document.body.appendChild(root);
  const controls = root.querySelector('.mz-controls');
  controls.getBoundingClientRect = () => ({ width, height: 48, left: 0, right: width, top: 0, bottom: 48, x: 0, y: 0 });
  return { root, stage: root.querySelector('.mz-stage'), controls };
}

describe('W87e Player Control Surface', () => {
  test('W71 L/M/S/XS 按控件容器宽度落地，不再按窗口或 max-content 猜布局', () => {
    assert.match(surface, /width >= 960[\s\S]*width >= 600[\s\S]*width >= 440/);
    assert.match(surface, /controls\.getBoundingClientRect\(\)\.width/);
    assert.match(css, /container:\s*player-controls\s*\/\s*inline-size/);
    assert.match(css, /\.mz-bar \{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
    assert.doesNotMatch(css, /\.mz-bar \{[^}]*min-width:\s*max-content/);
  });

  test('同一真实控件节点在 inline 与 More 间重排，不复制 handler 或状态', () => {
    assert.match(surface, /const items = inlineSequence\.filter/);
    assert.match(surface, /bar\.insertBefore\(item/);
    assert.match(surface, /grid\.insertBefore\(item/);
    assert.match(surface, /classList\.contains\('mz-overflow-item'\)/);
    assert.match(surface, /item\.parentElement !== bar \|\| item\.nextElementSibling/);
    assert.match(surface, /item\.parentElement !== grid \|\| item\.nextElementSibling/);
    assert.doesNotMatch(surface, /cloneNode|dispatchEvent\(new MouseEvent|\.click\(\)/);
    assert.match(player, /data-player-min="never"[\s\S]*data-a="more-controls"/);
  });

  test('核心控制常驻；次要能力带优先级、分组与可读标签', () => {
    for (const action of ['prev', 'next', 'mute', 'pip', 'loop', 'snap', 'progmem', 'sub', 'companion', 'danmaku', 'pset', 'list', 'zoom-reset', 'lock', 'borderless', 'fullscreen']) {
      assert.match(player, new RegExp(`data-a="${action}"[^>]*data-player-min=`), `${action} 必须声明响应优先级`);
    }
    assert.match(player, /class="mz-btn mz-play"/);
    assert.match(player, /class="mz-btn mz-more"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
    assert.match(player, /class="mz-control-center" role="dialog"[^>]*aria-modal="false"/);
  });

  test('底栏命中框和时间基线固定，宽窄态保持两端稳定且不靠字形撑尺寸', () => {
    assert.match(player, /class="mz-bar" role="toolbar" aria-label="播放控制"/);
    assert.match(css, /\.mz-bar \{[^}]*align-items:\s*center[^}]*flex-wrap:\s*nowrap[^}]*min-height:\s*42px/);
    assert.match(css, /\.mz-bar > \.mz-btn \{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*padding:\s*0/);
    assert.match(css, /\.mz-bar > \.mz-btn\.mz-play \{[^}]*width:\s*38px[^}]*height:\s*34px[^}]*padding:\s*0/);
    assert.match(css, /\.mz-time \{[^}]*min-width:\s*10\.5ch[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*white-space:\s*nowrap/);
    assert.match(css, /\.mz-bar-spacer \{[^}]*flex:\s*1 1 24px[^}]*min-width:\s*8px/);
    assert.match(css, /@container player-controls \(max-width: 599px\)[\s\S]*\.mz-time-total \{ display:\s*none; \}[\s\S]*\.mz-bar > \.mz-btn \{ width:\s*30px/);
    assert.match(css, /@container player-controls \(max-width: 439px\)[\s\S]*\.mz-bar \{ gap:\s*2px; padding-inline:\s*3px; \}/);
  });

  test('1024/720/520/320 四档真实控件节点按阈值稳定退入 More', async () => {
    const { mountPlayerControlSurface } = await import('../../renderer/modules/viewer/player-controls.js');
    const cases = [
      [1024, 'l', ['prev', 'mute', 'speed', 'pip', 'fullscreen'], ['snap']],
      [720, 'm', ['prev', 'mute', 'speed', 'fullscreen'], ['pip', 'snap']],
      [520, 's', ['prev', 'mute', 'fullscreen'], ['speed', 'pip', 'snap']],
      [320, 'xs', ['mute', 'fullscreen'], ['prev', 'speed', 'pip', 'snap']],
    ];
    for (const [width, density, inline, overflow] of cases) {
      const fixture = responsiveControlFixture(width);
      const api = mountPlayerControlSurface({ ...fixture, isVideo: true });
      try {
        await nextFrame();
        const snapshot = api.snapshot();
        assert.equal(snapshot.density, density, `${width}px 密度错误`);
        assert.deepEqual(snapshot.inline, inline, `${width}px inline 顺序错误`);
        assert.deepEqual(snapshot.overflow, overflow, `${width}px overflow 顺序错误`);
        assert.equal(new Set([...snapshot.inline, ...snapshot.overflow]).size, 6, `${width}px 控件不得复制或丢失`);
      } finally {
        api.destroy();
        fixture.root.remove();
      }
    }
  });

  test('浮动播放控制用固定图标列/文字列，SVG 与文本 glyph 同高同基线', () => {
    assert.match(css, /\.mz-control-center \.mz-overflow-item\.mz-btn \{[^}]*height:\s*36px[^}]*display:\s*grid[^}]*grid-template-columns:\s*20px minmax\(0, 1fr\)[^}]*align-items:\s*center/);
    assert.match(css, /\.mz-control-center \.mz-overflow-item\.mz-btn > \.mz-ico,[\s\S]*> \.mz-control-glyph \{[^}]*grid-column:\s*1[^}]*grid-row:\s*1[^}]*align-self:\s*center[^}]*justify-self:\s*center/);
    assert.match(css, /\.mz-control-center \.mz-overflow-item\.mz-btn::after \{[^}]*grid-column:\s*2[^}]*grid-row:\s*1[^}]*align-self:\s*center[^}]*line-height:\s*1\.2[^}]*text-align:\s*left/);
    assert.match(player, /data-a="danmaku"[^>]*>[\s\S]*?<span class="mz-control-glyph" aria-hidden="true">弹<\/span><\/button>/);
    assert.match(player, /data-a="zoom-reset"[^>]*>[\s\S]*?<span class="mz-control-glyph" aria-hidden="true">1:1<\/span><\/button>/);
    assert.doesNotMatch(player, /data-a="(?:danmaku|zoom-reset)"[^>]*>\s*(?:弹|1:1)\s*<\/button>/);
  });

  test('空播放器动作严格居中且无卡片边框，陪看发送只使用可访问 SVG', () => {
    assert.match(css, /\.mz-empty \{[^}]*display:\s*grid[^}]*place-items:\s*center/);
    assert.match(css, /\.mz-empty-in \{[^}]*background:\s*none[^}]*border:\s*0[^}]*box-shadow:\s*none/);
    assert.match(css, /\.mz-empty \.mz-empty-btn \{[^}]*border:\s*0[^}]*background:\s*transparent/);
    assert.match(css, /\.mz-empty \.mz-empty-btn:focus-visible \{[^}]*outline:\s*2px solid var\(--accent\)/);
    assert.match(player, /class="mz-empty-btn" type="button" aria-label="导入视频或音频"/);
    assert.doesNotMatch(player, /mz-empty-in'\)\.style|mz-empty-btn'\)\.style/);

    assert.match(icons, /'↵':\s*S\('/, '发送键必须映射为 currentColor SVG');
    assert.match(companion, /class="mz-companion-send"[^>]*data-c="send"[^>]*aria-label="发送消息（Enter）"[^>]*aria-keyshortcuts="Enter"[^>]*>\$\{iconHtml\('↵'\)\}<\/button>/);
    assert.doesNotMatch(companion, /data-c="send"[^>]*>\s*说\s*<\/button>/);
    assert.match(companion, /event\.key !== 'Enter' \|\| event\.isComposing[\s\S]*event\.preventDefault\(\)[\s\S]*send\(\)/);
    assert.match(css, /\.mz-companion-compose \.mz-companion-send \{[^}]*width:34px[^}]*height:34px[^}]*display:inline-flex[^}]*align-items:center[^}]*justify-content:center/);
    assert.match(css, /\.mz-companion-compose \.mz-companion-send:focus-visible \{[^}]*outline:2px solid var\(--accent\)/);
  });

  test('Pane divider 与模块侧栏共享 ResizeObserver 几何真源', () => {
    assert.match(surface, /new ResizeObserver\(refresh\)/);
    assert.match(surface, /resizeObserver\?\.observe\(stage\)/);
    assert.match(surface, /onRelayoutSide\?\.\(\)/);
    assert.match(player, /SIDE_MIN = 150, SIDE_MAX = 520, CONTROL_MIN = 240/);
    assert.match(player, /mountPlayerControlSurface\(\{ root, stage, controls, isVideo, onRelayoutSide: applySide \}\)/);
  });

  test('More 控制中心被约束在 stage，窄级转 bottom sheet，不做跨 Surface host-wide overlay', () => {
    assert.match(css, /\.mz-control-center \{[^}]*position:\s*absolute[^}]*z-index:\s*14[^}]*width:\s*min\(360px/);
    assert.match(css, /\.mz-stage\.side-open:not\(\.side-overlay\) \.mz-control-center/);
    assert.match(css, /data-control-density="xs"/);
    assert.doesNotMatch(surface, /MazzVisualComposition|visual:overlayBegin|document\.body\.appendChild/);
  });

  test('打开态阻止自动淡出，Escape/外点/动作关闭且焦点可回 More', () => {
    assert.match(player, /controlSurface\.isOpen\(\) \|\| chromeHasFocus\(\)/);
    assert.match(surface, /document\.addEventListener\('pointerdown', onOutside, true\)/);
    assert.match(surface, /document\.addEventListener\('keydown', onKey, true\)/);
    assert.match(surface, /focusWhenVisible\(\(\) => moreButton\)/);
    assert.match(surface, /focusMoreNow:[\s\S]*moreButton\.focus\(\{ preventScroll: true \}\)/);
    assert.match(player, /data-a=pset[^\n]*addEventListener\('click', async \(\) => \{[\s\S]*controlSurface\?\.focusMoreNow\(\);[\s\S]*await import\('\.\.\/\.\.\/shell\/shell\.js'\)/,
      '播放设置必须在首个 await 前交出稳定 previousFocus，modal 关闭不能回到 hidden pset');
  });

  test('销毁完整退役 RO/MO/全局监听和 stage 状态，允许幂等', () => {
    assert.match(player, /controlSurface\.destroy\(\)/);
    assert.match(surface, /if \(destroyed\) return;[\s\S]*resizeObserver\?\.disconnect\(\)[\s\S]*mutationObserver\.disconnect\(\)/);
    assert.match(surface, /removeEventListener\('pointerdown', onOutside, true\)/);
    assert.match(surface, /removeEventListener\('keydown', onKey, true\)/);
    assert.match(surface, /delete stage\.dataset\.controlDensity/);
  });

  test('音频态 video-only 控件以 hidden 为事实且作者样式不得把它复活', async () => {
    assert.match(surface, /item\.dataset\.playerVideoOnly === '1' && !isVideo[\s\S]*item\.hidden = true/);
    assert.match(surface, /width >= Number\(min\) && !item\.hidden/);
    assert.match(css, /\.mz-control-center \[hidden\] \{ display:\s*none !important; \}/);

    const { mountPlayerControlSurface } = await import('../../renderer/modules/viewer/player-controls.js');
    const fixture = controlSurfaceFixture();
    const api = mountPlayerControlSurface({ ...fixture, isVideo: false });
    try {
      await nextFrame();
      const videoOnly = fixture.root.querySelector('[data-a=video-only]');
      assert.equal(videoOnly.hidden, true, '音频播放器必须在布局前永久标记 video-only 控件');
      assert.equal(videoOnly.closest('.mz-control-center') != null, true, '隐藏控件只能进入受 [hidden] 防复活保护的控制中心');
      assert.equal(api.snapshot().overflow.includes('video-only'), false, 'hidden 控件不得进入可用 overflow 快照');
    } finally {
      api.destroy();
      fixture.root.remove();
    }
  });

  test('侧栏保存 preferred 宽度、按当前窗格算 effective 宽度，极窄时切 overlay', () => {
    assert.match(player, /ctl\.sidePreferredW = 260; ctl\.sideW = 260/);
    assert.match(player, /ctl\.sideW = overlay[\s\S]*Math\.min\(ctl\.sidePreferredW/);
    assert.match(player, /stage\.classList\.toggle\('side-overlay', ctl\.sideOpen && overlay\)/);
    assert.match(player, /player\.listSide[\s\S]*width: ctl\.sidePreferredW/);
    assert.match(player, /if \(v\.width >= SIDE_MIN && v\.width <= SIDE_MAX\) ctl\.sidePreferredW = v\.width/);
    assert.match(css, /\.mz-stage\.side-open:not\(\.side-overlay\) \.mz-media/);
    assert.match(css, /\.mz-stage\.side-open:not\(\.side-overlay\) \.mz-topbar/);
    assert.match(css, /\.mz-stage\.side-overlay \.mz-side \{[^}]*max-width:\s*72%/);
  });

  test('selectProxy 命令带唯一 source，刷新和销毁都反注册；Player 处理迟到 import', () => {
    assert.match(selectMenu, /const source = 'selmenu-' \+ \(\+\+seq\)/);
    assert.match(selectMenu, /commands\.register\(cmdId, \{[\s\S]*source, agent: false/);
    assert.ok((selectMenu.match(/commands\.unregisterBySource\(source\)/g) || []).length >= 2, 'wire 刷新与 destroy 必须都清同源命令');
    assert.match(selectMenu, /destroy\(\) \{[\s\S]*if \(destroyed\) return;[\s\S]*commands\.unregisterBySource\(source\)/);
    assert.match(player, /let speedProxy = null;[\s\S]*if \(destroyed\) return;[\s\S]*speedProxy = selectProxy/);
    assert.match(player, /if \(destroyed\) \{ speedProxy\?\.destroy\(\); speedProxy = null; return; \}/);
    assert.match(player, /destroy\(\) \{[\s\S]*speedProxy\?\.destroy\(\);[\s\S]*speedProxy = null/);
    assert.match(menuService, /const remaining = items\.filter[\s\S]*if \(remaining\.length\) this\.contributions\.set\(id, remaining\);[\s\S]*else this\.contributions\.delete\(id\)/,
      '同源移除后空 menuId 必须删除，不能留下无限增长的注册表墓碑');
  });

  test('More 内动作与 Escape 关闭后都把焦点送回稳定入口', async () => {
    const { mountPlayerControlSurface } = await import('../../renderer/modules/viewer/player-controls.js');
    // Node 24 自带的 CustomEvent 不属于 jsdom realm；运行时页面里二者本来同 realm，
    // 契约夹具临时对齐，避免把测试环境类型差异误判成产品错误。
    const originalCustomEvent = globalThis.CustomEvent;
    globalThis.CustomEvent = window.CustomEvent;
    const fixture = controlSurfaceFixture();
    const api = mountPlayerControlSurface({ ...fixture, isVideo: true });
    try {
      await nextFrame();
      const more = fixture.root.querySelector('[data-a=more-controls]');
      const panel = fixture.root.querySelector('.mz-control-center');
      const action = fixture.root.querySelector('[data-a=tool]');

      more.click();
      await nextFrame();
      action.focus();
      action.click();
      await Promise.resolve();
      await nextFrame();
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(panel.hidden, true);
      assert.equal(document.activeElement, more, '动作把 dialog 隐藏后焦点不得滞留在 hidden 子树');

      more.click();
      await nextFrame();
      const fullscreen = fixture.root.querySelector('[data-a=fullscreen]');
      fullscreen.focus();
      fullscreen.click();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(panel.hidden, true);
      assert.equal(document.activeElement, more, 'PiP/全屏只切呈现模式，不得被误判为独立焦点 owner');

      more.click();
      await nextFrame();
      action.focus();
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(panel.hidden, true);
      assert.equal(document.activeElement, more, 'Escape 关闭必须回到 More 入口');
    } finally {
      api.destroy();
      fixture.root.remove();
      globalThis.CustomEvent = originalCustomEvent;
    }
  });

  test('无边框可由焦点唤回；锁定态退出其余 Tab/指针序列并只提升解锁键', () => {
    assert.match(css, /\.mz-player\.borderless \.mz-stage:focus-within \.mz-controls/);
    assert.match(css, /\.mz-player\.borderless\.mz-controls-open \.mz-controls/);
    assert.match(player, /const chromeHasFocus = \(\) => chromeEls\.some\(element => element\.matches\(':focus-within'\)\)/);
    assert.match(player, /for \(const element of chromeEls\) \{[\s\S]*element\.addEventListener\('focusin', showChrome\)/);
    assert.match(css, /\.mz-controls\.fade:focus-within, \.mz-topbar\.fade:focus-within/);
    assert.match(player, /stage\.querySelectorAll\('button, input, select, \[role=slider\], \[tabindex\]'\)/);
    assert.match(player, /if \(element === lockBtn\) continue/);
    assert.match(player, /if \('disabled' in element\) element\.disabled = true;[\s\S]*element\.setAttribute\('tabindex', '-1'\)/);
    assert.match(player, /lockBtn\.dataset\.playerMin = v \? '0' : 'never'/);
    assert.match(player, /lockBtn\?\.addEventListener\('click', \(\) => setLock\(!locked\)\)/);
    assert.doesNotMatch(player, /lockBtn\?\.addEventListener\('click',[\s\S]{0,80}stopPropagation/,
      '锁定动作必须冒泡给 Control Surface，才能收起面板与清 aria-expanded');
    assert.match(css, /\.mz-player\.mz-locked \.mz-bar > :not\(\[data-a=lock\]\)/);
    assert.match(player, /if \(locked\) \{[\s\S]*e\.key === 'Escape'[\s\S]*setLock\(false\)[\s\S]*return/);
    assert.match(player, /const onKey = \(e\) => \{[\s\S]*if \(locked\) \{[\s\S]*setLock\(false\)[\s\S]*return;[\s\S]*e\.target\.closest\('button, input, textarea, select, \[role=slider\], \[contenteditable\]'\)/,
      '锁定态 Esc 门必须早于 button/slider 的本地键盘让位，否则焦点在锁键时无法解锁');
  });

  test('seek 是可键盘操作的 ARIA slider，所有可切换按钮同步 aria-pressed', () => {
    assert.match(player, /class="mz-seek-track" role="slider" tabindex="0" aria-label="播放进度"/);
    assert.match(player, /track\.setAttribute\('aria-valuemax', String\(Math\.round\(duration\)\)\)/);
    assert.match(player, /track\.setAttribute\('aria-valuenow', String\(Math\.round\(current\)\)\)/);
    assert.match(player, /track\.setAttribute\('aria-valuetext', `\$\{fmtTime\(current\)\} \/ \$\{duration \? fmtTime\(duration\) : '--:--'\}`\)/);
    assert.match(player, /ArrowLeft: -5[\s\S]*PageDown: -30[\s\S]*PageUp: 30/);
    assert.match(player, /event\.key === 'Home'[\s\S]*event\.key === 'End'/);
    assert.match(player, /e\.target\.closest\('button, input, textarea, select, \[role=slider\], \[contenteditable\]'\)/,
      'document capture 快捷键必须让位给按钮与 ARIA slider 的本地键盘协议');
    assert.match(surface, /const EXTERNAL_FOCUS_ACTIONS = new Set\(\['pset', 'companion'\]\)/);
    for (const action of ['mute', 'loop', 'progmem', 'sub', 'danmaku', 'lock', 'borderless']) {
      assert.match(player, new RegExp(`data-a="${action}"[^>]*aria-pressed="`), `${action} 必须声明 toggle 初态`);
    }
    for (const expression of [
      /progBtn\.setAttribute\('aria-pressed'/,
      /subBtn\.setAttribute\('aria-pressed'/,
      /data-a=danmaku[^\n]*setAttribute\('aria-pressed'/,
      /lockBtn\.setAttribute\('aria-pressed'/,
      /muteBtn\.setAttribute\('aria-pressed'/,
      /loopBtn\.setAttribute\('aria-pressed'/,
      /borderlessBtn\.setAttribute\('aria-pressed'/,
    ]) assert.match(player, expression);
  });
});
