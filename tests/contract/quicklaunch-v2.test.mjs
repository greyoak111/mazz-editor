// tests/contract/quicklaunch-v2.test.mjs —— 分享走开始菜单 / 绘画软件类别 / Ribbon 换行契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const ShareService = (await import('../../main/share.js')).default;
const { matchCandidates } = await import('../../main/startmenu.js');

describe('分享目标：开始菜单寻路', () => {
  function fakeDeps({ runningProcs = [], installedPaths = [] } = {}) {
    const calls = { ps: [], spawned: [] };
    return {
      calls,
      deps: {
        platform: 'win32', env: {},
        exists: (p) => installedPaths.includes(p),
        spawnDetached: (exe) => { calls.spawned.push(exe); return true; },
        run: async (cmd, args) => {
          if (cmd === 'tasklist') {
            const proc = args[1].replace('IMAGENAME eq ', '');
            return { ok: true, out: runningProcs.includes(proc) ? proc : '' };
          }
          if (cmd === 'powershell') { calls.ps.push(args[args.length - 1]); return { ok: true, out: '' }; }
          if (cmd === 'reg') return { ok: false, out: '' };
          return { ok: true, out: '' };
        },
      },
    };
  }

  test('固定路径没有 → 开始菜单命中（微信 .lnk）也算已安装，拉起走菜单路径', async () => {
    const f = fakeDeps({ installedPaths: ['D:\\Apps\\Tencent\\WeChat.exe', 'D:\\x.md'] });
    const startMenuApps = {
      quickLaunch: async () => ({ apps: [{ category: 'wechat', name: '微信', exe: 'D:\\Apps\\Tencent\\WeChat.exe', icon: '💬' }] }),
    };
    const svc = new ShareService({ startMenuApps, deps: f.deps });
    const r = await svc.detect((await import('../../main/share.js')).buildTargets('zh')[0]);
    assert.equal(r.installed, true);
    assert.equal(r.menuPath, 'D:\\Apps\\Tencent\\WeChat.exe');
    const r2 = await svc.sendFile({ target: 'wechat', path: 'D:\\x.md' });
    assert.equal(r2.ok, true);
    assert.equal(f.calls.spawned[0], 'D:\\Apps\\Tencent\\WeChat.exe');
  });

  test('自选路径仍最高优先（盖过开始菜单）', async () => {
    const f = fakeDeps({ installedPaths: ['C:\\custom\\wc.exe', 'D:\\Apps\\Tencent\\WeChat.exe', 'D:\\x.md'] });
    const startMenuApps = { quickLaunch: async () => ({ apps: [{ category: 'wechat', name: '微信', exe: 'D:\\Apps\\Tencent\\WeChat.exe' }] }) };
    const store = { get: (k) => k === 'share.customPaths' ? { wechat: 'C:\\custom\\wc.exe' } : null };
    const svc = new ShareService({ store, startMenuApps, deps: f.deps });
    const r = await svc.sendFile({ target: 'wechat', path: 'D:\\x.md' });
    assert.equal(r.ok, true);
    assert.equal(f.calls.spawned[0], 'C:\\custom\\wc.exe');
  });

  test('绘画软件类别：PS/CSP/SAI/Krita 命中', () => {
    const fake = (n) => ({ file: n, lnk: `C:\\m\\${n}.lnk` });
    const hits = matchCandidates([
      fake('Photoshop 2025'), fake('CLIP STUDIO PAINT'), fake('PaintTool SAI'),
      fake('Krita (x64)'), fake('微信'),
    ]);
    const names = hits.filter(h => h.category === 'draw').map(h => h.name);
    assert.ok(names.includes('Photoshop'));
    assert.ok(names.includes('Clip Studio Paint'));
    assert.ok(names.includes('PaintTool SAI'));
    assert.ok(names.includes('Krita'));
  });
});

describe('Ribbon 高度换行', () => {
  test('面板 >96px 进入 wrap，≤96px 退出', async () => {
    const { Ribbon } = await import('../../renderer/shell/ribbon.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const rb = new Ribbon(host);
    // jsdom 无布局：直接改 clientHeight 定义模拟
    Object.defineProperty(rb.panelEl, 'clientHeight', { get: () => 130, configurable: true });
    rb.updateWrap();
    assert.equal(rb.panelEl.classList.contains('wrap'), true);
    Object.defineProperty(rb.panelEl, 'clientHeight', { get: () => 70, configurable: true });
    rb.updateWrap();
    assert.equal(rb.panelEl.classList.contains('wrap'), false);
  });
});
