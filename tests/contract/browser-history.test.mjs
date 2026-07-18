// tests/contract/browser-history.test.mjs —— 浏览器历史/收藏：内部 URL 过滤、存量清洗、实时刷新、重命名输入框
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

// ---- mock preload 桥（内存设置仓 + 密码库） ----
const store = new Map();
const pwStore = [];
window.mazz = {
  invoke: async (channel, payload) => {
    if (channel === 'settings:get') return store.get(payload.key);
    if (channel === 'settings:set') { store.set(payload.key, payload.value); return true; }
    if (channel === 'pw:available') return true;
    if (channel === 'pw:list') return pwStore.map(e => ({ ...e }));
    if (channel === 'pw:save') {
      const e = payload.entry;
      const item = { id: e.id || 'pw' + Date.now().toString(36), site: e.site, username: e.username, password: e.password, note: e.note, updatedAt: Date.now() };
      const i = pwStore.findIndex(x => x.id === item.id);
      if (i >= 0) pwStore[i] = item; else pwStore.push(item);
      return item.id;
    }
    if (channel === 'pw:delete') { const i = pwStore.findIndex(x => x.id === payload.id); if (i >= 0) pwStore.splice(i, 1); return true; }
    if (channel === 'clipboard:write') { store.set('__clip', payload.text); return true; }
    return null;
  },
};

const { default: browserModule } = await import('../../renderer/modules/browser/index.js');
const { instances, HOME } = browserModule._forTests;

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const navEvent = (name, url) => { const ev = new window.Event(name); ev.url = url; return ev; };

async function freshBrowser() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  browserModule.create(container);
  await tick();
  const ctl = instances.get(container);
  assert.ok(ctl, '应能拿到控制器');
  return { container, ctl };
}

describe('浏览器：历史/收藏内部 URL 治理', () => {
  test('loadStore 清洗存量顽固条目（about:blank/data:/mazz:）', async () => {
    store.set('browser.history', [
      { url: 'about:blank', title: '', at: 1 },
      { url: 'data:text/html,<h1>home</h1>', title: '主页', at: 2 },
      { url: 'mazz://home', title: '主页', at: 3 },
      { url: 'https://a.com/', title: 'A 站', at: 4 },
    ]);
    store.set('browser.bookmarks', [
      { url: 'about:blank', title: '空白', folder: 'default' },
      { url: 'https://b.com/page#x', title: 'B 站', folder: 'default' },
    ]);
    const { container, ctl } = await freshBrowser();
    assert.equal(ctl.history.length, 1, '历史应只剩真实网址');
    assert.equal(ctl.history[0].url, 'https://a.com/');
    assert.equal(ctl.bookmarks.length, 1, '收藏应只剩真实网址');
    assert.equal(ctl.bookmarks[0].url, 'https://b.com/page#x');
    assert.equal(store.get('browser.history').length, 1, '清洗结果应写回存储');
    container.remove();
  });

  test('did-navigate 内部 URL 不覆盖逻辑 URL、不进历史', async () => {
    const { container, ctl } = await freshBrowser();
    const tab = ctl.activeTab();
    assert.equal(tab.url, HOME, '初始标签应为主页');
    tab.view.dispatchEvent(navEvent('did-navigate', 'about:blank'));
    tab.view.dispatchEvent(navEvent('did-navigate', 'data:text/html,<h1>x</h1>'));
    assert.equal(tab.url, HOME, '内部 URL 不得覆盖标签 URL');
    assert.ok(!ctl.history.some(h => h.url === 'about:blank'), 'about:blank 不得进历史');
    tab.view.dispatchEvent(navEvent('did-navigate', 'https://c.com/path/'));
    assert.equal(tab.url, 'https://c.com/path/', '真实网址应覆盖标签 URL');
    assert.ok(ctl.history.some(h => h.url === 'https://c.com/path/'), '真实网址应进历史');
    container.remove();
  });

  test('主页标签删除历史后实时重渲染主页', async () => {
    const { container, ctl } = await freshBrowser();
    const tab = ctl.activeTab();
    assert.equal(tab.url, HOME, '当前标签应在主页');
    ctl.history = [{ url: 'https://d.com/', title: 'D 站', at: Date.now() }];
    const before = tab.view.srcdoc || '';
    await ctl.handleHomeAction('del-his', 'https://d.com'); // 故意不带尾斜杠
    await tick();
    assert.equal(ctl.history.length, 0, '归一化匹配应删掉该条历史');
    const after = tab.view.srcdoc || '';
    assert.notEqual(after, before, '主页应已重渲染');
    assert.ok(!after.includes('D 站'), '重渲染后的主页不应再出现已删条目');
    container.remove();
  });

  test('重命名经自研输入框完成（不依赖 window.prompt）', async () => {
    const { container, ctl } = await freshBrowser();
    ctl.history = [{ url: 'https://e.com/', title: 'E 站', at: Date.now() }];
    const p = ctl.handleHomeAction('rename-his', 'https://e.com/');
    await tick(10);
    const mask = document.querySelector('.mazz-palette-mask');
    assert.ok(mask, '应弹出自研输入框');
    const input = mask.querySelector('#im-input');
    assert.ok(input, '输入框应存在');
    assert.equal(input.value, 'E 站', '应预填当前名称');
    input.value = '我的 E 站';
    mask.querySelector('#im-ok').click();
    await p;
    assert.equal(ctl.history[0].name, '我的 E 站', '名称应已更新');
    assert.equal(store.get('browser.history')[0].name, '我的 E 站', '应写回存储');
    assert.ok(!document.querySelector('.mazz-palette-mask'), '输入框应已关闭');
    container.remove();
  });

  test('输入框 Escape/点遮罩取消不挂起', async () => {
    const { container, ctl } = await freshBrowser();
    ctl.history = [{ url: 'https://f.com/', title: 'F 站', at: Date.now() }];
    const p = ctl.handleHomeAction('rename-his', 'https://f.com/');
    await tick(10);
    const mask = document.querySelector('.mazz-palette-mask');
    mask.querySelector('#im-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await p; // 不 resolve 就会挂起超时
    assert.equal(ctl.history[0].name, undefined, '取消不应改名');
    container.remove();
  });

  test('删除历史后：被动重定向不写回，显式访问才解除屏蔽', async () => {
    const { container, ctl } = await freshBrowser();
    const tab = ctl.activeTab();
    // 删掉知乎条目 → 进入屏蔽集（页面级身份 origin+pathname）
    ctl.history = [{ url: 'https://www.zhihu.com/signin?next=%2F', title: '知乎', at: Date.now() }];
    await ctl.handleHomeAction('del-his', 'https://www.zhihu.com/signin?next=%2F');
    assert.equal(ctl.history.length, 0);
    assert.ok(ctl.historyBlock.has('https://www.zhihu.com/signin'), '应按页面级身份进屏蔽集');
    // 模拟：知乎标签后台自动重定向（被动导航 e.url ≠ tab.url）
    tab.url = 'https://www.zhihu.com/';
    tab.view.dispatchEvent(navEvent('did-navigate', 'https://www.zhihu.com/signin?next=%2F'));
    assert.ok(!ctl.history.some(h => h.url.includes('zhihu')), '被动重定向不得写回历史');
    // 模拟：同一登录页但 query 不同的重定向变体（登录跳转页参数每次变）
    tab.url = 'https://www.zhihu.com/';
    tab.view.dispatchEvent(navEvent('did-navigate', 'https://www.zhihu.com/signin?next=%2Fother&utm=x'));
    assert.ok(!ctl.history.some(h => h.url.includes('zhihu')), 'query 变体同样不得写回');
    // 模拟：显式访问（e.url === tab.url，navigate 先行设置）
    tab.url = 'https://www.zhihu.com/signin?next=%2F';
    tab.view.dispatchEvent(navEvent('did-navigate', 'https://www.zhihu.com/signin?next=%2F'));
    assert.ok(ctl.history.some(h => h.url.includes('zhihu')), '显式访问应进历史');
    assert.ok(!ctl.historyBlock.has('https://www.zhihu.com/signin'), '屏蔽应已解除');
    container.remove();
  });
});

describe('浏览器：主页主题与自定义主页', () => {
  test('主题三模式产出对应 CSS（dark 变量 / 媒体查询）', async () => {
    const { container, ctl } = await freshBrowser();
    const tab = ctl.activeTab();
    const render = async (theme) => {
      await ctl.handleHomeAction('theme', theme);
      await tick();
      return tab.view.srcdoc || '';
    };
    let html = await render('dark');
    assert.ok(html.includes('--bg:#1b1b1a'), 'dark 应输出暗色变量');
    assert.ok(!html.includes('prefers-color-scheme'), 'dark 不应包媒体查询');
    html = await render('light');
    assert.ok(html.includes('--bg:#f7f6f3'), 'light 应输出亮色变量');
    assert.ok(!html.includes('prefers-color-scheme'), 'light 不应包媒体查询');
    html = await render('system');
    assert.ok(html.includes('prefers-color-scheme:dark'), 'system 应包暗色媒体查询');
    assert.equal(store.get('browser.homeTheme'), 'system', '主题应持久化');
    container.remove();
  });

  test('主题按钮与设置面板出现在主页 DOM', async () => {
    const { container, ctl } = await freshBrowser();
    const tab = ctl.activeTab();
    const html = tab.view.srcdoc || '';
    for (const act of ['theme', 'gear', 'set-home', 'reset-home', 'pw']) {
      assert.ok(html.includes(`data-act="${act === 'theme' ? 'theme' : act}"`), `主页应含 ${act} 操作`);
    }
    container.remove();
  });

  test('自定义主页：设置后逻辑 URL 保持 HOME 且不进历史', async () => {
    const { container, ctl } = await freshBrowser();
    const tab = ctl.activeTab();
    await ctl.handleHomeAction('set-home', 'https://start.me/p/abc');
    assert.equal(ctl.customHome, 'https://start.me/p/abc');
    assert.equal(store.get('browser.customHome'), 'https://start.me/p/abc');
    // 模拟自定义主页落地导航
    tab.view.dispatchEvent(navEvent('did-navigate', 'https://start.me/p/abc'));
    assert.equal(tab.url, HOME, '自定义主页落地后逻辑 URL 仍为 HOME');
    assert.ok(!ctl.history.some(h => h.url.includes('start.me')), '自定义主页不进历史');
    // 从自定义主页跳到真实网站：正常覆盖 + 进历史
    tab.view.dispatchEvent(navEvent('did-navigate', 'https://real-site.com/x'));
    assert.equal(tab.url, 'https://real-site.com/x');
    assert.ok(ctl.history.some(h => h.url === 'https://real-site.com/x'));
    // 恢复内置
    await ctl.handleHomeAction('reset-home');
    assert.equal(ctl.customHome, '');
    container.remove();
  });

  test('set-home 无协议自动补 https://', async () => {
    const { container, ctl } = await freshBrowser();
    await ctl.handleHomeAction('set-home', 'example.com');
    assert.equal(ctl.customHome, 'https://example.com');
    container.remove();
  });
});

describe('浏览器：密码管理器', () => {
  test('添加/列表/编辑/删除全流程', async () => {
    const { container, ctl } = await freshBrowser();
    pwStore.length = 0;
    await ctl.openPasswordManager();
    let mask = document.querySelector('.mazz-palette-mask');
    assert.ok(mask, '管理器应打开');
    assert.ok(mask.innerHTML.includes('系统级加密'), '应显示加密状态');
    // 添加
    mask.querySelector('#pw-add').click();
    mask.querySelector('#pwf-site').value = 'zhihu.com';
    mask.querySelector('#pwf-user').value = 'mazz@x.com';
    mask.querySelector('#pwf-pass').value = 's3cret';
    mask.querySelector('#pwf-save').click();
    await tick();
    assert.equal(pwStore.length, 1, '应保存一条');
    assert.equal(pwStore[0].site, 'zhihu.com');
    // 列表渲染 + 掩码
    mask = document.querySelector('.mazz-palette-mask');
    const item = mask.querySelector('.pw-item');
    assert.ok(item, '条目应渲染');
    assert.equal(item.querySelector('.pw-secret').textContent, '••••••', '密码默认掩码');
    // 显示明文
    item.querySelector('[data-a=show]').click();
    assert.equal(item.querySelector('.pw-secret').textContent, 's3cret', '👁 应显示明文');
    // 复制
    item.querySelector('[data-a=copy]').click();
    await tick(10);
    assert.equal(store.get('__clip'), 's3cret', '应复制到剪贴板');
    // 编辑：改用户名
    item.querySelector('[data-a=edit]').click();
    mask.querySelector('#pwf-user').value = 'new@x.com';
    mask.querySelector('#pwf-save').click();
    await tick();
    assert.equal(pwStore.length, 1, '编辑不应新增条目');
    assert.equal(pwStore[0].username, 'new@x.com');
    // 删除
    document.querySelector('.mazz-palette-mask .pw-item [data-a=del]').click();
    await tick();
    assert.equal(pwStore.length, 0, '应已删除');
    container.remove();
  });

  test('填充：站点匹配与无匹配提示（jsdom 无 webview 走 toast 分支）', async () => {
    const { container, ctl } = await freshBrowser();
    pwStore.length = 0;
    pwStore.push({ id: 'p1', site: 'zhihu.com', username: 'u', password: 'p' });
    // 非 Electron 环境 → 提示不可用（验证守卫不抛错）
    await ctl.fillPassword();
    container.remove();
  });
});
