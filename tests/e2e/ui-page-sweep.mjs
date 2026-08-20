// Mazz 全页面 UI 自动巡检：双主题、逐页截图、机器可读问题总账。
//
// 运行：
//   node tests/e2e/ui-page-sweep.mjs
//   MAZZ_UI_SWEEP_EXECUTABLE="release/win-unpacked/Mazz Editor.exe" node tests/e2e/ui-page-sweep.mjs
//
// 截图写入 tests/e2e/shots/ui-page-sweep/<source|packaged>/（已被 .gitignore 忽略），
// 稳定摘要写入 docs/engineering/evidence/UI_PAGE_SWEEP_<SOURCE|PACKAGED>.json。
// 该脚本只通过 Electron/Playwright 操作应用，不依赖 Computer Use。

import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const EXECUTABLE = String(process.env.MAZZ_UI_SWEEP_EXECUTABLE || process.env.MAZZ_E2E_EXECUTABLE || '').trim();
const MODE = EXECUTABLE ? 'packaged' : 'source';
const THEMES = String(process.env.MAZZ_UI_SWEEP_THEMES || 'paper,ink').split(',').map(value => value.trim()).filter(Boolean);
const WIDTH = Number(process.env.MAZZ_UI_SWEEP_WIDTH || 1440);
const HEIGHT = Number(process.env.MAZZ_UI_SWEEP_HEIGHT || 900);
const SCENE_TIMEOUT = Number(process.env.MAZZ_UI_SWEEP_SCENE_TIMEOUT || 20000);
const SHOT_ROOT = path.join(ROOT, 'tests', 'e2e', 'shots', 'ui-page-sweep', MODE);
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'engineering', 'evidence');
const REPORT_PATH = path.join(EVIDENCE_ROOT, `UI_PAGE_SWEEP_${MODE.toUpperCase()}.json`);
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-ui-sweep-${MODE}-user-`));
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), `mazz-ui-sweep-${MODE}-ws-`));

const MODULES = [
  { id: 'welcome', title: '欢迎页', content: '', wait: 250 },
  { id: 'markdown', title: '文档', content: '# UI 自动巡检\n\n用于检查字体、SVG、溢出与主题辨识度。' },
  { id: 'text', title: '纯文本', content: 'Mazz UI page sweep\nPaper / Ink' },
  { id: 'sheet', title: '表格', content: '', wait: 350 },
  { id: 'slide', title: '演示', content: '', wait: 500 },
  { id: 'code', title: '代码', content: 'const uiSweep = true;\nconsole.log(uiSweep);', wait: 850 },
  { id: 'math', title: '计算', content: '' },
  { id: 'notes', title: '笔记', content: '', wait: 400 },
  { id: 'search', title: '搜索', content: '' },
  { id: 'mindmap', title: '导图', content: '', wait: 550 },
  { id: 'draw', title: '画板', content: '', wait: 650 },
  { id: 'library', title: '书库', content: '', wait: 600 },
  { id: 'viewer', title: '播放器', content: '', wait: 550 },
  { id: 'factorydesk', title: '智能创作台', content: JSON.stringify({ mark: 'mazz-factorydesk-v1', view: 'workshop' }), wait: 750 },
  { id: 'organization', title: '组织编译台', content: '', wait: 650 },
  { id: 'browser', title: '隐私浏览器', content: '', wait: 1000, nativeSurface: true },
];

const PANELS = [
  'favmgr', 'pwmgr', 'palette', 'shortcuts', 'annotate', 'settings', 'agreement', 'help',
  'translate', 'plugins', 'recorder', 'dockfloat', 'bookmark', 'ctxmenu', 'splitpreview', 'sync',
  'notif', 'factorycfg', 'newfile', 'picklist', 'fpreview', 'fedit', 'harvest', 'archive',
];
const SIDEBAR_TABS = [
  ['files', '文档'], ['outline', '大纲'], ['marks', '书签'], ['tags', '标签'],
  ['backlinks', '反链'], ['contexts', '上下文'], ['history', '工作史'], ['cognition', '认知'],
];
const RIBBON_PAGES = [['file', '文件'], ['factory', '智能创作'], ['view', '视图']];
const SIDE_DOCK_TABS = [['factory', '智能创作'], ['openwith', '打开方式'], ['tools', '工具']];

const report = {
  protocol: 'mazz.ui-page-sweep/v1',
  generatedAt: new Date().toISOString(),
  runtimeMode: MODE,
  executable: EXECUTABLE ? path.resolve(EXECUTABLE) : null,
  viewport: { width: WIDTH, height: HEIGHT },
  themes: THEMES,
  requested: {
    modules: MODULES.map(item => item.id),
    sidebarTabs: SIDEBAR_TABS.map(item => item[0]),
    ribbonPages: RIBBON_PAGES.map(item => item[0]),
    sideDockTabs: SIDE_DOCK_TABS.map(item => item[0]),
    panels: PANELS,
    quicknote: true,
  },
  screenshotsRoot: path.relative(ROOT, SHOT_ROOT).replaceAll('\\', '/'),
  scenes: [],
  runtimeErrors: [],
  summary: {},
  ok: false,
  verdict: 'INCOMPLETE',
};

let app = null;
let currentScope = 'boot';
let sequence = 0;
const observedPages = new WeakSet();

function slug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function observePage(page) {
  if (!page || observedPages.has(page)) return;
  observedPages.add(page);
  page.on('pageerror', error => report.runtimeErrors.push({ scope: currentScope, type: 'pageerror', url: page.url(), message: error.message }));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ERR_ABORTED|favicon|ResizeObserver loop|net::ERR_FILE_NOT_FOUND/i.test(text)) return;
    report.runtimeErrors.push({ scope: currentScope, type: 'console.error', url: page.url(), message: text });
  });
}

function timeout(promise, label, ms = SCENE_TIMEOUT) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function settle(page, delay = 180) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready?.catch?.(() => {});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }).catch(() => {});
  await page.addStyleTag({ content: `
    *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
    html{scroll-behavior:auto!important}
  ` }).catch(() => {});
  await page.waitForTimeout(delay);
}

async function dismissAgreement(main) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const agreement = app.windows().find(page => page.url().includes('/panels/agreement.html'));
    if (!agreement) break;
    observePage(agreement);
    await agreement.waitForLoadState('domcontentloaded').catch(() => {});
    await agreement.locator('#nomore').check().catch(() => {});
    await agreement.locator('#accept').click().catch(() => {});
    await main.waitForTimeout(120);
  }
  await main.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
  ]));
}

async function setTheme(main, theme) {
  await main.evaluate(id => window.MazzShell.setTheme(id), theme);
  await main.waitForFunction(id => document.documentElement.dataset.theme === id, theme, { timeout: 5000 });
  await settle(main, 160);
}

async function audit(page, expectedTheme) {
  return page.evaluate(expected => {
    // 只审 Mazz 自有 mazz-res 文档。Browser 的第三方 WebContentsView 只做原生帧留证，
    // 绝不把网页自己的 emoji / SVG 计入产品门禁。
    const ownDocument = location.protocol === 'mazz-res:' && location.hostname === 'app';
    const controlSelector = 'button,a,[role="button"],[role="menuitem"],[role="tab"],[data-act],[data-a],.mazz-menu-item';
    const dataControlSelector = '[data-act],[data-a]';
    const rawGlyph = /(?:\p{Extended_Pictographic}|[\u00AB\u00BB\u00D7\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2700-\u27BF\uFF0B\uFF0D])/u;
    const rawGlyphGlobal = /(?:\p{Extended_Pictographic}|[\u00AB\u00BB\u00D7\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2700-\u27BF\uFF0B\uFF0D])/gu;
    const rawGlyphAtStart = new RegExp(`^(?:${rawGlyph.source})`, 'u');
    const rawGlyphAtEnd = new RegExp(`(?:${rawGlyph.source})$`, 'u');
    const textIconAllowlist = new Set(['B', 'I', 'U', 'fx', '{}', 'x²']);
    const finiteToken = /(?:^|[\s:=([])(?:NaN|Infinity)(?:$|[\s:;,)\]])/;
    const rendered = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .01
        && rect.width > .5 && rect.height > .5
        && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
    };
    const visible = element => rendered(element) && !element.closest('[aria-hidden="true"]');
    const describe = element => {
      const id = element.id ? `#${element.id}` : '';
      const cls = typeof element.className === 'string' && element.className.trim()
        ? '.' + element.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      return `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 180);
    };
    const textOf = element => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const issues = [];
    const warnings = [];
    const add = (target, code, element, detail = {}) => target.push({ code, selector: element ? describe(element) : '', ...detail });
    const root = document.documentElement;
    const body = document.body;

    if (!ownDocument) {
      return {
        skipped: 'third-party-document', theme: root.dataset.theme || '', title: document.title, url: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        counts: { visibleElements: 0, buttons: 0, svg: 0, images: 0, controls: 0, controlSvg: 0, rawControlGlyphs: 0 },
        issues: [], warnings: [],
      };
    }

    if (root.scrollWidth > root.clientWidth + 2 || body.scrollWidth > body.clientWidth + 2) {
      add(issues, 'DOCUMENT_HORIZONTAL_OVERFLOW', root, {
        root: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth },
        body: { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth },
      });
    }
    if (root.dataset.theme !== expected) add(issues, 'THEME_MISMATCH', root, { expected, actual: root.dataset.theme || '' });

    const all = [...body.querySelectorAll('*')];
    for (const element of all) {
      if (!visible(element) || element.matches('script,style,noscript')) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = textOf(element);
      const directText = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();

      if (directText && finiteToken.test(directText)) add(issues, 'NON_FINITE_VISIBLE_TEXT', element, { text: directText.slice(0, 120) });

      const overflowX = style.overflowX;
      const clips = overflowX === 'hidden' || overflowX === 'clip';
      if (directText && element.clientWidth > 3 && element.scrollWidth > element.clientWidth + 2 && clips && style.textOverflow !== 'ellipsis') {
        add(issues, 'CLIPPED_TEXT', element, {
          text: directText.slice(0, 120), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        });
      }

      const interactiveOrLeafText = element.matches('button,a,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"]')
        || (directText && ![...element.children].some(child => textOf(child)));
      // Ribbon 是正式的横向滚动 Surface；其未滚入视口的后续按钮不是“页面泄漏”。
      // 这里只报告逃出窗口且不受合法横向 scroller 管束的元素。
      let scrollParent = element.parentElement;
      let inMeasuredHorizontalScroller = false;
      while (scrollParent && scrollParent !== body) {
        const scrollStyle = getComputedStyle(scrollParent);
        if ((scrollStyle.overflowX === 'auto' || scrollStyle.overflowX === 'scroll')
          && scrollParent.scrollWidth > scrollParent.clientWidth + 2) {
          inMeasuredHorizontalScroller = true;
          break;
        }
        scrollParent = scrollParent.parentElement;
      }
      const inHorizontalScroller = inMeasuredHorizontalScroller || !!element.closest('.ribbon-panel,[data-ui-sweep-horizontal-scroll]');
      if (interactiveOrLeafText && !inHorizontalScroller && (rect.right > innerWidth + 2 || rect.left < -2)) {
        add(warnings, 'ELEMENT_OUTSIDE_VIEWPORT', element, {
          text: text.slice(0, 80), rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }, viewportWidth: innerWidth,
        });
      }
    }

    for (const image of [...document.images].filter(visible)) {
      if (image.complete && image.naturalWidth === 0 && image.getAttribute('src')) {
        add(issues, 'BROKEN_IMAGE', image, { src: image.currentSrc || image.getAttribute('src') });
      }
    }

    for (const control of [...body.querySelectorAll(controlSelector)].filter(rendered)) {
      const semantic = control.matches('button,[role="button"],[role="menuitem"],[role="tab"]');
      if (semantic) {
        const label = control.getAttribute('aria-label') || control.getAttribute('title') || textOf(control);
        if (!String(label || '').trim()) add(issues, 'CONTROL_ACCESSIBLE_NAME_MISSING', control);
      }
      const nested = control.querySelector('button,[role="button"],[role="menuitem"],[role="tab"]');
      if (nested) add(issues, 'NESTED_INTERACTIVE_CONTROL', control, { nested: describe(nested) });
    }

    // 控件 raw glyph 门禁：只读取真正渲染的文本节点，不读取 title/aria-label。
    // 图标专用宿主必须严格零 raw glyph；普通语义 label 只拦截纯符号、
    // 开头的 icon token、末尾的 affordance，正文关系箭头/乘号/倍率不报。
    const controlGlyphHits = [];
    const controlSet = new Set([...body.querySelectorAll(controlSelector)].filter(rendered));
    const dataControls = [...body.querySelectorAll(dataControlSelector)].filter(rendered);
    const scanTextNode = (control, node) => {
      const owner = node.parentElement;
      if (!owner || !rendered(owner)) return;
      const text = String(node.nodeValue || '').replace(/[\uFE0E\uFE0F]/g, '').replace(/\s+/g, ' ').trim();
      if (!text || textIconAllowlist.has(text) || !rawGlyph.test(text)) return;
      const glyphs = [...new Set(text.match(rawGlyphGlobal) || [])];
      if (!glyphs.length) return;
      const strictIconOwner = owner.closest('i,.ico,.icon,[data-svg-icon],svg');
      const withoutGlyphs = text.replace(rawGlyphGlobal, '').trim();
      const glyphOnly = !withoutGlyphs;
      const startsWithGlyph = rawGlyphAtStart.test(text);
      const endsWithGlyph = rawGlyphAtEnd.test(text);
      const numericRateOrSize = /^\d+(?:\.\d+)?\s*×(?:\s*\d+(?:\.\d+)?(?:\s*(?:px|p|k|倍))?)?$/iu.test(text);
      if (!strictIconOwner && numericRateOrSize) return;
      if (!strictIconOwner && !glyphOnly && !startsWithGlyph && !endsWithGlyph) return;
      const hit = { control, owner, text, glyphs };
      controlGlyphHits.push(hit);
      add(issues, 'RAW_CONTROL_GLYPH', control, {
        text: text.slice(0, 120), glyphs, glyphNode: describe(owner),
      });
    };
    for (const control of controlSet) {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) scanTextNode(control, node);
    }
    // data-act/data-a 不一定有原生 button role；只递归它们的 icon i/span，避免把普通数据标签当控件。
    for (const control of dataControls) {
      const semanticOwner = control.closest(controlSelector);
      if (controlSet.has(control) || (semanticOwner && controlSet.has(semanticOwner))) continue;
      const iconNodes = [
        ...(control.matches('i,span') ? [control] : []),
        ...control.querySelectorAll('i,span'),
      ];
      for (const iconNode of iconNodes) {
        if (!rendered(iconNode)) continue;
        const walker = document.createTreeWalker(iconNode, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) scanTextNode(control, node);
      }
    }

    const graphicSelector = 'path,use,circle,rect,line,polyline,polygon,ellipse,text';
    const descendants = (roots, child) => roots.split(',').map(selector => `${selector.trim()} ${child}`).join(',');
    const controlSvgs = [...body.querySelectorAll(`${descendants(controlSelector, 'svg')},${descendants(dataControlSelector, 'svg')}`)].filter(rendered);
    const hasCurrentColor = svg => [svg, ...svg.querySelectorAll('*')].some(node =>
      ['stroke', 'fill', 'color'].some(name => String(node.getAttribute?.(name) || '').trim().toLowerCase() === 'currentcolor')
      || /(?:^|;)\s*(?:stroke|fill|color)\s*:\s*currentcolor\b/i.test(String(node.getAttribute?.('style') || '')));
    for (const svg of [...body.querySelectorAll('svg')].filter(rendered)) {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || !svg.querySelector(graphicSelector)) {
        add(issues, 'EMPTY_OR_ZERO_SVG', svg, { width: rect.width, height: rect.height });
      }
    }
    for (const svg of controlSvgs) {
      if (!hasCurrentColor(svg)) add(issues, 'CONTROL_SVG_NOT_CURRENTCOLOR', svg, { html: svg.outerHTML.slice(0, 240) });
    }
    for (const host of [...body.querySelectorAll(`${descendants(controlSelector, '[data-svg-icon]')},${descendants(dataControlSelector, '[data-svg-icon]')}`)].filter(rendered)) {
      if (!host.querySelector('svg')) add(issues, 'CONTROL_ICON_SVG_MISSING', host, { icon: host.getAttribute('data-svg-icon') || '' });
    }

    const unique = items => [...new Map(items.map(item => [`${item.code}|${item.selector}|${item.text || ''}|${item.src || ''}`, item])).values()];
    return {
      theme: root.dataset.theme || '',
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      counts: {
        visibleElements: all.filter(visible).length,
        buttons: all.filter(element => visible(element) && element.matches('button,[role="button"]')).length,
        svg: [...body.querySelectorAll('svg')].filter(rendered).length,
        images: [...document.images].filter(visible).length,
        controls: controlSet.size + dataControls.filter(element => !controlSet.has(element)).length,
        controlSvg: controlSvgs.length,
        rawControlGlyphs: controlGlyphHits.length,
      },
      issues: unique(issues),
      warnings: unique(warnings).slice(0, 200),
    };
  }, expectedTheme);
}

async function capture(page, { theme, kind, id, label, nativeSurface = false }) {
  const number = String(++sequence).padStart(3, '0');
  const base = `${number}-${slug(theme)}-${slug(kind)}-${slug(id)}`;
  const screenshotPath = path.join(SHOT_ROOT, `${base}.png`);
  const state = await audit(page, theme);
  await page.screenshot({ path: screenshotPath, omitBackground: false });
  const scene = {
    order: sequence, scope: `${kind}/${id}`, label, theme, status: state.issues.length ? 'FAIL' : 'PASS',
    screenshot: relative(screenshotPath), audit: state, nativeSurfaceScreenshots: [], nativeSurfaceAudits: [], error: null,
  };
  if (nativeSurface) {
    try {
      const packet = await page.evaluate(() => window.mazz.invoke('bv:captureVisibleHost', {}));
      for (let index = 0; index < (packet?.frames || []).length; index += 1) {
        const frame = packet.frames[index];
        if (!frame?.png) continue;
        const bytes = Buffer.from(frame.png, 'base64');
        if (bytes.length < 64 || bytes.subarray(1, 4).toString('ascii') !== 'PNG') continue;
        const nativePath = path.join(SHOT_ROOT, `${base}-native-${String(index + 1).padStart(2, '0')}.png`);
        fs.writeFileSync(nativePath, bytes);
        scene.nativeSurfaceScreenshots.push({ screenshot: relative(nativePath), tabId: frame.tabId, bounds: frame.bounds });
        const homeAudit = await page.evaluate(async tabId => window.mazz.invoke('bv:js', { tabId, code: `(() => {
          const parse = value => {
            const match = String(value || '').match(/rgba?\\((\\d+(?:\\.\\d+)?)[, ]+(\\d+(?:\\.\\d+)?)[, ]+(\\d+(?:\\.\\d+)?)(?:\\s*[,/]\\s*(\\d*(?:\\.\\d+)?))?\\)/i);
            return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined || match[4] === '' ? 1 : Number(match[4])] : null;
          };
          const composite = (front, back) => [front[0] * front[3] + back[0] * (1 - front[3]), front[1] * front[3] + back[1] * (1 - front[3]), front[2] * front[3] + back[2] * (1 - front[3]), 1];
          const luminance = color => { const c = color.slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
          const ratio = (a, b) => { const al = luminance(a), bl = luminance(b); return (Math.max(al, bl) + .05) / (Math.min(al, bl) + .05); };
          const background = element => { const layers = []; let node = element; while (node instanceof Element) { const color = parse(getComputedStyle(node).backgroundColor); if (color && color[3] > .001) layers.push(color); node = node.parentElement; } let out = [255,255,255,1]; for (let i = layers.length - 1; i >= 0; i -= 1) out = composite(layers[i], out); return out; };
          const placeholders = [...document.querySelectorAll('input[placeholder],textarea[placeholder]')].map(element => { const bg = background(element); const fg = parse(getComputedStyle(element, '::placeholder').color); const painted = fg ? composite(fg, bg) : null; return { id: element.id || '', text: element.getAttribute('placeholder') || '', ratio: painted ? Number(ratio(painted, bg).toFixed(2)) : 0 }; });
          const invalidControlSvg = [...document.querySelectorAll('button svg,[role="button"] svg')].filter(svg => !/currentColor/i.test(svg.outerHTML)).length;
          return { firstPartyHome: !!document.getElementById('q'), href: location.href, placeholders, invalidControlSvg };
        })()` }), frame.tabId);
        scene.nativeSurfaceAudits.push({ tabId: frame.tabId, ...homeAudit });
        if (!homeAudit?.firstPartyHome) state.issues.push({ code: 'NATIVE_HOME_MARKER_MISSING', selector: '#q', text: String(homeAudit?.href || '') });
        for (const item of homeAudit?.placeholders || []) {
          if (item.ratio < 4.5) state.issues.push({ code: 'NATIVE_HOME_PLACEHOLDER_CONTRAST', selector: `#${item.id}`, text: `${item.text} (${item.ratio}:1)` });
        }
        if (homeAudit?.invalidControlSvg) state.issues.push({ code: 'NATIVE_HOME_SVG_NOT_CURRENTCOLOR', selector: 'button svg,[role="button"] svg', text: String(homeAudit.invalidControlSvg) });
      }
      if (!scene.nativeSurfaceScreenshots.length) {
        state.issues.push({ code: 'NATIVE_SURFACE_CAPTURE_EMPTY', selector: '', text: '' });
        scene.status = 'FAIL';
      }
      if (state.issues.length) scene.status = 'FAIL';
    } catch (error) {
      state.issues.push({ code: 'NATIVE_SURFACE_CAPTURE_FAILED', selector: '', text: error.message });
      scene.status = 'FAIL';
    }
  }
  report.scenes.push(scene);
  process.stdout.write(`[ui-sweep] ${scene.status.padEnd(4)} ${theme} ${kind}/${id} -> ${relative(screenshotPath)}\n`);
  return scene;
}

async function recordFailure({ theme, kind, id, label }, error) {
  const scene = {
    order: ++sequence, scope: `${kind}/${id}`, label, theme, status: 'ERROR', screenshot: null,
    nativeSurfaceScreenshots: [], nativeSurfaceAudits: [], audit: { issues: [], warnings: [] }, error: String(error?.stack || error?.message || error),
  };
  report.scenes.push(scene);
  process.stderr.write(`[ui-sweep] ERROR ${theme} ${kind}/${id}: ${error.message}\n`);
}

async function closeActiveTab(main) {
  await main.evaluate(async () => {
    const tab = window.MazzShell?.tabs?.active;
    if (!tab) return;
    tab.dirty = false;
    await window.MazzShell.closeTabFlow(tab.id);
  }).catch(() => {});
  await main.waitForTimeout(100);
}

async function resetChrome(main) {
  await main.evaluate(() => {
    const dock = window.MazzShell?.sideDock;
    if (dock) {
      dock.state.float = null;
      dock.hide();
    }
    window.MazzShell?.sidebarPanels?.showTab?.('files');
  }).catch(() => {});
  await main.waitForTimeout(100);
}

async function openModule(main, item) {
  if (item.id === 'welcome') {
    await closeActiveTab(main);
    await main.evaluate(() => { window.MazzShell.hideWelcome(); window.MazzShell.showWelcome(); });
    return;
  }
  const tabId = await main.evaluate(({ id, title, content }) => window.MazzHost.openTab(id, { title, content }).tab.id, item);
  await main.waitForFunction(({ id, tabId }) => {
    const tab = window.MazzShell?.tabs?.active;
    const instance = window.MazzModules?.instances?.get(tabId);
    return tab?.id === tabId && tab?.moduleId === id && !!instance && instance.container?.offsetParent !== null;
  }, { id: item.id, tabId }, { timeout: 15000 });
}

async function waitPanel(kind, instanceId) {
  const marker = `/panels/${kind}.html`;
  const until = Date.now() + SCENE_TIMEOUT;
  while (Date.now() < until) {
    const candidate = app.windows().find(page => page.url().includes(marker));
    if (candidate) {
      observePage(candidate);
      await candidate.waitForLoadState('domcontentloaded').catch(() => {});
      return candidate;
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`panel did not open: ${kind}/${instanceId}`);
}

async function closePanel(main, kind, instanceId, panel) {
  const closed = panel?.waitForEvent('close', { timeout: 5000 }).then(() => true).catch(() => false);
  await main.evaluate(({ kind, instanceId }) => window.mazz.invoke('panel:close', { kind, instanceId }), { kind, instanceId }).catch(() => {});
  if (closed && !await closed) await panel?.close().catch(() => {});
  // dockfloat 的正式生命周期会“关闭即回停靠”；逐页巡检必须主动复位，避免污染下一场。
  await resetChrome(main);
}

function buildHtml() {
  const rows = report.scenes.map(scene => {
    const issueCount = scene.audit?.issues?.length || 0;
    const warningCount = scene.audit?.warnings?.length || 0;
    const screenshot = scene.screenshot ? path.basename(scene.screenshot) : '';
    const thumb = screenshot ? `<a href="${screenshot}"><img loading="lazy" src="${screenshot}" alt="${scene.scope}"></a>` : '<div class="missing">capture failed</div>';
    return `<article class="${scene.status.toLowerCase()}"><h2>${scene.order}. ${scene.theme} · ${scene.scope}</h2>${thumb}<p>${scene.status} · issues ${issueCount} · warnings ${warningCount}</p></article>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Mazz UI page sweep</title><style>
  :root{color-scheme:dark}body{margin:20px;background:#101216;color:#e8ebf1;font:14px system-ui}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}article{border:1px solid #303644;border-radius:10px;padding:10px;background:#181b22}article.fail,article.error{border-color:#b84a56}h1,h2{margin:0 0 10px}h2{font-size:15px}img{display:block;width:100%;height:auto;background:#fff}.missing{height:180px;display:grid;place-items:center;background:#2a1c20}p{margin:8px 0 0;color:#aeb6c7}</style><h1>Mazz UI page sweep · ${MODE}</h1><p>${report.generatedAt} · ${THEMES.join(' / ')}</p><main class="grid">${rows}</main>`;
}

async function main() {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  fs.rmSync(SHOT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SHOT_ROOT, { recursive: true });
  await seedFixtures(WORKSPACE, WORKSPACE);

  const launch = {
    ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : { args: [ROOT] }),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_E2E_DISABLE_GPU: process.env.MAZZ_E2E_DISABLE_GPU || '1',
    },
    timeout: 120000,
  };
  app = await electron.launch(launch);
  app.on('window', observePage);
  const processHandle = app.process?.();
  for (const [streamName, stream] of [['stdout', processHandle?.stdout], ['stderr', processHandle?.stderr]]) {
    stream?.on?.('data', bytes => {
      const text = String(bytes);
      if (/\b(?:uncaught|unhandled|TypeError|ReferenceError)\b/i.test(text)) report.runtimeErrors.push({ scope: currentScope, type: `main.${streamName}`, message: text.trim() });
    });
  }

  const mainWindow = await app.firstWindow({ timeout: 120000 });
  observePage(mainWindow);
  await mainWindow.waitForFunction(() => document.documentElement.dataset.appReady === '1' && !!window.MazzShell && !!window.MazzHost, null, { timeout: 30000 });
  await dismissAgreement(mainWindow);
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find(candidate => !candidate.__panelKind && !candidate.getParentWindow());
    if (!win) throw new Error('main BrowserWindow missing');
    win.setSize(size.width, size.height);
    win.center();
    win.show();
    win.focus();
  }, { width: WIDTH, height: HEIGHT });
  await settle(mainWindow, 250);

  for (const theme of THEMES) {
    await setTheme(mainWindow, theme);
    for (const item of MODULES) {
      currentScope = `${theme}/module/${item.id}`;
      try {
        await resetChrome(mainWindow);
        await timeout(openModule(mainWindow, item), `open ${currentScope}`);
        await settle(mainWindow, item.wait || 250);
        await capture(mainWindow, { theme, kind: 'module', id: item.id, label: item.title, nativeSurface: item.nativeSurface });
      } catch (error) {
        await recordFailure({ theme, kind: 'module', id: item.id, label: item.title }, error);
      } finally {
        if (item.id !== 'welcome') await closeActiveTab(mainWindow);
      }
    }

    await resetChrome(mainWindow);
    await mainWindow.evaluate(() => window.MazzHost.openTab('markdown', { title: 'Chrome Host', content: '# Chrome Host\n\n## Sidebar page sweep\n\n正文 #界面' }));
    await settle(mainWindow, 300);

    for (const [id, label] of SIDEBAR_TABS) {
      currentScope = `${theme}/sidebar/${id}`;
      try {
        await mainWindow.evaluate(value => window.MazzShell.sidebarPanels.showTab(value), id);
        await settle(mainWindow, ['history', 'cognition', 'contexts'].includes(id) ? 400 : 220);
        await capture(mainWindow, { theme, kind: 'sidebar', id, label });
      } catch (error) {
        await recordFailure({ theme, kind: 'sidebar', id, label }, error);
      }
    }
    await mainWindow.evaluate(() => window.MazzShell.sidebarPanels.showTab('files'));

    for (const [id, label] of RIBBON_PAGES) {
      currentScope = `${theme}/ribbon/${id}`;
      try {
        await mainWindow.evaluate(value => window.MazzShell.ribbon.showPage(value), id);
        await settle(mainWindow, 180);
        await capture(mainWindow, { theme, kind: 'ribbon', id, label });
      } catch (error) {
        await recordFailure({ theme, kind: 'ribbon', id, label }, error);
      }
    }

    for (const [id, label] of SIDE_DOCK_TABS) {
      currentScope = `${theme}/side-dock/${id}`;
      try {
        await mainWindow.waitForFunction(() => !!window.MazzShell?.sideDock?.factoryPanel, null, { timeout: 15000 });
        await mainWindow.evaluate(value => {
          const dock = window.MazzShell.sideDock;
          dock.state.float = null;
          dock.show();
          dock.showTab(value);
        }, id);
        await settle(mainWindow, 320);
        await capture(mainWindow, { theme, kind: 'side-dock', id, label });
      } catch (error) {
        await recordFailure({ theme, kind: 'side-dock', id, label }, error);
      }
    }
    await resetChrome(mainWindow);

    for (const kind of PANELS) {
      currentScope = `${theme}/panel/${kind}`;
      const instanceId = `ui-sweep-${theme}-${kind}`;
      let panel = null;
      try {
        const opened = await mainWindow.evaluate(({ kind, instanceId }) => window.mazz.invoke('panel:open', {
          kind, opts: { instanceId, title: `UI sweep ${kind}`, x: 48, y: 96 },
        }), { kind, instanceId });
        if (opened?.error) throw new Error(opened.error);
        panel = await timeout(waitPanel(kind, instanceId), `open ${currentScope}`);
        if (kind !== 'splitpreview') await panel.waitForFunction(() => document.documentElement.dataset.panelRuntime === 'v1', null, { timeout: 10000 }).catch(() => {});
        await panel.waitForFunction(id => document.documentElement.dataset.theme === id, theme, { timeout: 2500 }).catch(() => {});
        await settle(panel, 220);
        await capture(panel, { theme, kind: 'panel', id: kind, label: kind });
      } catch (error) {
        await recordFailure({ theme, kind: 'panel', id: kind, label: kind }, error);
      } finally {
        await closePanel(mainWindow, kind, instanceId, panel);
      }
    }
    await closeActiveTab(mainWindow);

    currentScope = `${theme}/window/quicknote`;
    let quicknote = null;
    try {
      await app.evaluate(async ({ BrowserWindow }, options) => {
        const win = new BrowserWindow({
          width: 440, height: 300, show: false, frame: false, backgroundColor: options.background,
          webPreferences: { preload: options.preload, contextIsolation: true, sandbox: false, nodeIntegration: false },
        });
        globalThis.__uiSweepQuicknote = win;
        await win.loadURL('mazz-res://app/quicknote.html');
        win.show();
        win.webContents.send('mazz:event', { channel: 'theme:changed', payload: { id: options.theme } });
      }, {
        theme,
        background: theme === 'paper' ? '#f7f6f3' : '#16181d',
        preload: path.join(ROOT, 'preload', 'quicknote-preload.js'),
      });
      quicknote = app.windows().find(page => page.url().includes('/quicknote.html'));
      if (!quicknote) throw new Error('quicknote did not open');
      observePage(quicknote);
      await quicknote.waitForFunction(id => document.documentElement.dataset.theme === id, theme, { timeout: 5000 });
      await settle(quicknote, 220);
      await capture(quicknote, { theme, kind: 'window', id: 'quicknote', label: '快速笔记' });
    } catch (error) {
      await recordFailure({ theme, kind: 'window', id: 'quicknote', label: '快速笔记' }, error);
    } finally {
      await app.evaluate(() => { globalThis.__uiSweepQuicknote?.destroy(); globalThis.__uiSweepQuicknote = null; }).catch(() => {});
    }
  }
}

async function finalize() {
  const issueCount = report.scenes.reduce((sum, scene) => sum + (scene.audit?.issues?.length || 0), 0);
  const warningCount = report.scenes.reduce((sum, scene) => sum + (scene.audit?.warnings?.length || 0), 0);
  const errors = report.scenes.filter(scene => scene.status === 'ERROR').length;
  const expected = THEMES.length * (
    MODULES.length + SIDEBAR_TABS.length + RIBBON_PAGES.length + SIDE_DOCK_TABS.length + PANELS.length + 1
  );
  report.summary = {
    expectedScenes: expected,
    capturedScenes: report.scenes.filter(scene => !!scene.screenshot).length,
    passScenes: report.scenes.filter(scene => scene.status === 'PASS').length,
    failScenes: report.scenes.filter(scene => scene.status === 'FAIL').length,
    errorScenes: errors,
    issueCount,
    warningCount,
    runtimeErrorCount: report.runtimeErrors.length,
  };
  report.ok = report.scenes.length === expected && errors === 0 && issueCount === 0 && report.runtimeErrors.length === 0;
  report.verdict = report.ok ? 'PASS' : 'FAIL';
  fs.mkdirSync(SHOT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(SHOT_ROOT, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(SHOT_ROOT, 'index.html'), buildHtml());
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ protocol: report.protocol, mode: MODE, verdict: report.verdict, ...report.summary, report: relative(REPORT_PATH), gallery: relative(path.join(SHOT_ROOT, 'index.html')) }, null, 2));
}

try {
  await main();
} catch (error) {
  report.runtimeErrors.push({ scope: currentScope, type: 'runner', message: String(error?.stack || error) });
  process.stderr.write(`[ui-sweep] runner failed: ${error.stack || error}\n`);
} finally {
  try { await app?.close(); } catch {}
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  try { fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  await finalize();
}

if (!report.ok) process.exitCode = 1;
