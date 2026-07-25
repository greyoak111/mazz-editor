// tests/contract/share.test.mjs —— 发送到工作软件契约
// 覆盖：目标清单按语言切换 · 安装/运行探测（注入伪环境）· 剪贴板调用与幂等提示文案 · 活动文件解析
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const ShareService = (await import('../../main/share.js')).default;
const { buildTargets } = await import('../../main/share.js');
const { activeFilePath, resultMessage } = await import('../../renderer/lib/share.js');

function fakeDeps({ runningProcs = [], installedPaths = [], platform = 'win32' } = {}) {
  const calls = { ps: [], spawned: [] };
  return {
    calls,
    deps: {
      platform,
      env: {},
      exists: (p) => installedPaths.includes(p),
      spawnDetached: (exe) => { calls.spawned.push(exe); return true; },
      run: async (cmd, args) => {
        if (cmd === 'tasklist') {
          const proc = args[1].replace('IMAGENAME eq ', '');
          return { ok: true, out: runningProcs.includes(proc) ? `${proc}  1234 Console  1  50,000 K` : 'INFO: No tasks' };
        }
        if (cmd === 'powershell') { calls.ps.push(args[args.length - 1]); return { ok: true, out: '' }; }
        if (cmd === 'reg') return { ok: false, out: '' };
        return { ok: true, out: '' };
      },
    },
  };
}

describe('目标清单', () => {
  test('中文 → 微信/QQ/钉钉；国际 → Slack/Teams/Telegram', () => {
    assert.deepEqual(buildTargets('zh').map(t => t.name), ['微信', 'QQ', '钉钉']);
    assert.deepEqual(buildTargets('intl').map(t => t.name), ['Slack', 'Microsoft Teams', 'Telegram']);
  });
});

describe('安装/运行探测（注入伪环境）', () => {
  test('进程在跑 → installed+running；仅路径存在 → installed 不 running；都没有 → 未安装', async () => {
    const wechatExe = buildTargets('zh')[0].paths[0];
    const svc = new ShareService({ deps: fakeDeps({ runningProcs: ['WeChat.exe'] }).deps });
    const r1 = await svc.detect(buildTargets('zh')[0]);
    assert.equal(r1.running, true);
    assert.equal(r1.installed, true);

    const svc2 = new ShareService({ deps: fakeDeps({ installedPaths: [wechatExe.replace(/%[^%]+%/g, '')] }).deps });
    // expandEnv 后路径（env 为空 → %..% 剥成空）
    const t = buildTargets('zh')[0];
    const r2 = await svc2.detect(t);
    assert.equal(r2.installed, true);
    assert.equal(r2.running, false);

    const svc3 = new ShareService({ deps: fakeDeps({}).deps });
    const r3 = await svc3.detect(buildTargets('zh')[1]);
    assert.equal(r3.installed, false);
  });

  test('用户自选 exe 路径：默认路径没有时用自选的顶上（含拉起优先）', async () => {
    const customExe = 'D:\\Apps\\MyWechat\\WeChat.exe';
    const store = { _d: { 'share.customPaths': { wechat: customExe } }, get(k) { return this._d[k]; } };
    const f = fakeDeps({ installedPaths: [customExe, 'D:\\x.md'] });
    const svc = new ShareService({ store, deps: f.deps });
    const r = await svc.detect(buildTargets('zh')[0]);
    assert.equal(r.installed, true);
    assert.equal(r.customPath, customExe);
    // 发送 → 拉起走自选路径
    const r2 = await svc.sendFile({ target: 'wechat', path: 'D:\\x.md' });
    assert.equal(r2.ok, true);
    assert.equal(f.calls.spawned[0], customExe);
  });

  test('非 Windows → unsupported', async () => {
    const svc = new ShareService({ deps: fakeDeps({ platform: 'linux' }).deps });
    const r = await svc.detect(buildTargets('zh')[0]);
    assert.equal(r.unsupported, true);
  });
});

describe('发送流程', () => {
  test('未安装 → not-installed，不动剪贴板', async () => {
    const f = fakeDeps({});
    const svc = new ShareService({ deps: f.deps });
    const r = await svc.sendFile({ target: 'wechat', path: 'D:\\x.md' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-installed');
    assert.equal(f.calls.ps.length, 0);
  });

  test('已运行 → 复制文件到剪贴板，不启动进程', async () => {
    const wechatExe = buildTargets('zh')[0].paths[0].replace(/%[^%]+%/g, '');
    const f = fakeDeps({ runningProcs: ['WeChat.exe'], installedPaths: [wechatExe, 'D:\\x.md'] });
    const svc = new ShareService({ deps: f.deps });
    const r = await svc.sendFile({ target: 'wechat', path: 'D:\\x.md' });
    assert.equal(r.ok, true);
    assert.equal(r.running, true);
    assert.ok(f.calls.ps[0].includes('Set-Clipboard'));
    assert.ok(f.calls.ps[0].includes('D:\\x.md'));
    assert.equal(f.calls.spawned.length, 0);
  });

  test('已安装未运行 → 复制 + 拉起客户端', async () => {
    const wechatExe = buildTargets('zh')[0].paths[0].replace(/%[^%]+%/g, '');
    const f = fakeDeps({ installedPaths: [wechatExe, 'D:\\x.md'] });
    const svc = new ShareService({ deps: f.deps });
    const r = await svc.sendFile({ target: 'wechat', path: 'D:\\x.md' });
    assert.equal(r.ok, true);
    assert.equal(r.launched, true);
    assert.ok(f.calls.spawned.length > 0);
  });
});

describe('结果文案与活动文件', () => {
  test('resultMessage 三种成功态与未安装态', () => {
    assert.ok(resultMessage({ ok: true, running: true, name: '微信' }).includes('Ctrl+V'));
    assert.ok(resultMessage({ ok: true, running: false, launched: true, name: '微信' }).includes('登录'));
    assert.ok(resultMessage({ ok: false, reason: 'not-installed', name: '微信' }).includes('安装'));
  });
  test('activeFilePath：无标签/无路径 → null', () => {
    assert.equal(activeFilePath(null), null);
    assert.equal(activeFilePath({ tabs: { active: null } }), null);
    assert.equal(activeFilePath({ tabs: { active: { filePath: '/workspace/a.md' } } }), '/workspace/a.md');
  });
});
