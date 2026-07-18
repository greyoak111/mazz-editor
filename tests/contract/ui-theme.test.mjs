// tests/contract/ui-theme.test.mjs —— 侧栏控制 / Ribbon 控制 / 图片取色 / 帮助增补
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const store = new Map();
window.mazz = {
  invoke: async (channel, payload) => {
    if (channel === 'settings:get') return store.get(payload.key);
    if (channel === 'settings:set') { store.set(payload.key, payload.value); return true; }
    return null;
  },
};

const { SidebarCtl } = await import('../../renderer/shell/sidebar-ctl.js');
const tc = await import('../../renderer/theme-custom.js');
const { HELP_SECTIONS } = await import('../../renderer/help/content.js');

function mkSidebar() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="sidebar"><div class="sidebar-head"><span>工作区</span><span class="acts"></span></div><div class="filetree"></div></div>`;
  document.body.appendChild(wrap);
  return wrap.querySelector('.sidebar');
}

/** 构造 RGBA 像素数组 */
function pixels(spec) {
  // spec: [[r,g,b,count], ...]
  const out = [];
  for (const [r, g, b, n] of spec) {
    for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  }
  return Uint8ClampedArray.from(out);
}

describe('工作区侧栏控制', () => {
  test('折叠/展开 + 轨道条', async () => {
    const sb = mkSidebar();
    const ctl = new SidebarCtl(sb);
    await ctl.init();
    assert.ok(sb.querySelector('[data-a=collapse]'), '应有折叠按钮');
    ctl.setCollapsed(true);
    assert.ok(sb.classList.contains('collapsed'));
    assert.equal(ctl.rail.style.display, 'flex', '折叠后应显示展开轨道');
    ctl.setCollapsed(false);
    assert.ok(!sb.classList.contains('collapsed'));
    assert.equal(store.get('ui.sidebar').collapsed, false, '状态应持久化');
  });

  test('钉住/浮出切换', async () => {
    const sb = mkSidebar();
    const ctl = new SidebarCtl(sb);
    await ctl.init();
    assert.ok(!sb.classList.contains('floating'), '默认钉住（非浮层）');
    ctl.togglePin();
    assert.ok(sb.classList.contains('floating'), '取消钉住应浮层');
    assert.equal(store.get('ui.sidebar').pinned, false);
    ctl.togglePin();
    assert.ok(!sb.classList.contains('floating'));
  });

  test('拖拽调宽范围约束（最小 180 最大 480）', async () => {
    const sb = mkSidebar();
    const ctl = new SidebarCtl(sb);
    await ctl.init();
    ctl.setWidth(100);
    assert.equal(ctl.state.width, 180, '最小宽度 180');
    ctl.setWidth(999);
    assert.equal(ctl.state.width, 480, '最大宽度 480');
    ctl.setWidth(300);
    assert.equal(sb.style.width, '300px');
    assert.equal(store.get('ui.sidebar').width, 300);
  });

  test('状态恢复', async () => {
    store.set('ui.sidebar', { width: 320, pinned: false, collapsed: false });
    const sb = mkSidebar();
    const ctl = new SidebarCtl(sb);
    await ctl.init();
    assert.equal(ctl.state.width, 320);
    assert.ok(sb.classList.contains('floating'));
  });
});

describe('图片取色自定义主题', () => {
  test('rgbToHsl / hslToHex 往返', () => {
    const { h, s, l } = tc.rgbToHsl(200, 33, 27);
    assert.ok(h >= 0 && h < 5, '红色相应在 0° 附近');
    const hex = tc.hslToHex(h, s, l);
    assert.equal(hex, '#c8211b');
    assert.equal(tc.hslToHex(0, 0, 1), '#ffffff');
    assert.equal(tc.hslToHex(0, 0, 0), '#000000');
  });

  test('鲜明图片：提取成功且评估达标', () => {
    const px = pixels([
      [200, 33, 27, 400],   // 构成红 40%
      [26, 26, 26, 200],    // 黑 20%
      [240, 230, 210, 300], // 纸米 30%
      [217, 164, 65, 100],  // 赭黄 10%
    ]);
    const { palette, stats } = tc.extractPalette(px);
    assert.ok(palette.length >= 3, '应提取 ≥3 色');
    const assess = tc.assessColors(stats);
    assert.ok(assess.ok, '鲜明图应达标: ' + assess.fails.join(','));
    const vars = tc.assignRoles(palette);
    assert.ok(/^#[0-9a-f]{6}$/i.test(vars.accent), '主色应为 hex');
    assert.ok(vars.bg !== vars.fg, '底色与正文必须区分');
    // 主色应偏暖（红/橙系优先）
    const accHsl = tc.rgbToHsl(...vars.accent.slice(1).match(/../g).map(x => parseInt(x, 16)));
    assert.ok(accHsl.h <= 70 || accHsl.h >= 330, '构成主义主色应取暖色');
  });

  test('灰度图片：评估拒绝并给出原因', () => {
    const px = pixels([
      [40, 40, 40, 400],
      [120, 120, 120, 300],
      [220, 220, 220, 300],
    ]);
    const { stats } = tc.extractPalette(px);
    const assess = tc.assessColors(stats);
    assert.ok(!assess.ok, '灰图应被拒绝');
    assert.ok(assess.fails.length >= 1, '应给出拒绝原因');
  });

  test('近单色图片：颜色数不足被拒', () => {
    const px = pixels([[200, 33, 27, 900], [201, 34, 28, 100]]);
    const { stats } = tc.extractPalette(px);
    const assess = tc.assessColors(stats);
    assert.ok(!assess.ok, '近单色应被拒绝');
  });

  test('injectCustomTheme 注入变量表', () => {
    const vars = { bg: '#eeeeee', bgElev: '#ffffff', bgHover: '#dddddd', bgActive: '#cccccc', fg: '#111111', fgDim: '#555555', border: '#111111', accent: '#c8211b', accentSoft: '#f3d8c2', accentFg: '#ffffff', danger: '#c8211b', warn: '#d9a441', ok: '#3d6b35', docBg: '#ffffff', acc: '#c8211b', bd: '#111111', bd2: '#cccccc', card: '#ffffff', mut: '#555555', faint: '#999999', sh: 'rgba(0,0,0,.18)' };
    tc.injectCustomTheme(vars);
    const el = document.getElementById('custom-image-theme');
    assert.ok(el, '应注入 style 标签');
    assert.ok(el.textContent.includes('[data-theme="custom"]'));
    assert.ok(el.textContent.includes('--accent: #c8211b'));
    el.remove();
  });
});

describe('帮助文档增补', () => {
  test('界面与主题定制专章存在且覆盖新功能', () => {
    const sec = HELP_SECTIONS.find(s => s.id === 'uitheme');
    assert.ok(sec, '应有 uitheme 章节');
    for (const kw of ['钉住', '浮出', '折叠', '拖拽调宽', '构成', '从图片生成主题', '色彩更鲜明']) {
      assert.ok(sec.body.includes(kw), `专章应提及: ${kw}`);
    }
  });
  test('快速上手与分屏章已同步侧栏/Ribbon 操作', () => {
    const qs = HELP_SECTIONS.find(s => s.id === 'quickstart');
    const win = HELP_SECTIONS.find(s => s.id === 'windows');
    assert.ok(qs.body.includes('折叠'), '快速上手应提及侧栏折叠');
    assert.ok(win.body.includes('钉住') || win.body.includes('浮出'), '分屏章应提及浮出');
  });
});
