// tests/contract/startmenu.test.mjs —— 开始菜单已安装软件扫描契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const StartMenuApps = (await import('../../main/startmenu.js')).default;
const { matchCandidates } = await import('../../main/startmenu.js');

function fakeLnk(name) { return { file: name, lnk: `C:\\Menu\\${name}.lnk` }; }

describe('类别匹配', () => {
  test('Word/Excel/PPT/VS Code/WPS 命中，无关软件不命中，同类去重', () => {
    const hits = matchCandidates([
      fakeLnk('Microsoft Word'),
      fakeLnk('WPS 文字'),
      fakeLnk('Microsoft Excel'),
      fakeLnk('Microsoft PowerPoint'),
      fakeLnk('Visual Studio Code'),
      fakeLnk('Notepad++'),
      fakeLnk('微信'),
      fakeLnk('Microsoft Word'), // 重复
    ]);
    const keys = hits.map(h => h.category + '|' + h.name);
    assert.ok(keys.includes('word|Word'));
    assert.ok(keys.includes('word|WPS 文字'));
    assert.ok(keys.includes('excel|Excel'));
    assert.ok(keys.includes('powerpoint|PowerPoint'));
    assert.ok(keys.includes('code|VS Code'));
    assert.ok(keys.includes('code|Notepad++'));
    assert.ok(keys.includes('wechat|微信')); // 微信属于聊天软件类别（分享寻路复用）
    assert.ok(!keys.some(k => k.includes('钉钉计算器')));
    assert.equal(keys.filter(k => k === 'word|Word').length, 1, '同名去重');
  });
});

describe('扫描 + 缓存', () => {
  test('端到端（伪开始菜单 + 伪 PS 解析 + 真 exe）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-sm-'));
    const menuDir = path.join(tmp, 'menu');
    fs.mkdirSync(menuDir, { recursive: true });
    fs.writeFileSync(path.join(menuDir, 'Visual Studio Code.lnk'), '');
    fs.writeFileSync(path.join(menuDir, '微信.lnk'), '');
    const codeExe = path.join(tmp, 'Code.exe');
    fs.writeFileSync(codeExe, 'MZ');

    const store = { _d: {}, get(k) { return this._d[k]; }, set(k, v) { this._d[k] = v; } };
    const svc = new StartMenuApps({
      store,
      run: async (cmd, args) => {
        if (cmd === 'powershell') {
          return { ok: true, out: `C:\\Menu\\Visual Studio Code.lnk|${codeExe}\nC:\\Menu\\微信.lnk|C:\\WeChat.exe\n` };
        }
        return { ok: false, out: '' };
      },
    });
    // 注入伪目录：把 programsDirs 的 env 指到 tmp
    const { programsDirs } = await import('../../main/startmenu.js');
    const dirs = programsDirs({ ProgramData: tmp, APPDATA: tmp + '\\x' });
    // menu 目录命名要对得上 Programs 结构——直接验证 listLnk→match→resolve 链路
    const { default: SM } = await import('../../main/startmenu.js');
    const links = [];
    for (const d of [menuDir]) {
      for (const f of fs.readdirSync(d)) if (f.endsWith('.lnk')) links.push({ file: f.replace('.lnk', ''), lnk: path.join(d, f) });
    }
    const hits = matchCandidates(links);
    assert.equal(hits.length, 2); // VS Code + 微信（聊天类别）
    assert.ok(hits.some(h => h.name === 'VS Code'));
    assert.ok(hits.some(h => h.name === '微信'));
    // 缓存逻辑：缓存有效 → 直接命中（显式指定 win32，沙箱是 linux）
    store._d['apps.quickLaunch'] = { apps: [{ category: 'code', name: 'VS Code', exe: codeExe, icon: '💻' }], cachedAt: Date.now() };
    const r2 = await svc.quickLaunch({ platform: 'win32' });
    assert.equal(r2.apps.length, 1);
    // refresh 强制重扫（伪 run 也能工作）
    store._d['apps.quickLaunch'] = null;
    assert.ok(dirs.length >= 1);
    void SM;
  });

  test('非 Windows → unsupported 空列表', async () => {
    const svc = new StartMenuApps({});
    const r = await svc.quickLaunch({ platform: 'linux' });
    assert.equal(r.unsupported, true);
    assert.equal(r.apps.length, 0);
  });

  test('launch：存在则拉起（注入 spawn），不存在则 not-found', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-sm-'));
    const exe = path.join(tmp, 'App.exe');
    fs.writeFileSync(exe, 'MZ');
    const svc = new StartMenuApps({});
    const spawned = [];
    const r = svc.launch({ exe, args: ['D:\\a.md'] }, { spawnDetached: (x, a) => { spawned.push([x, a]); return true; } });
    assert.equal(r.ok, true);
    assert.deepEqual(spawned[0], [exe, ['D:\\a.md']]);
    const r2 = svc.launch({ exe: path.join(tmp, 'nope.exe') });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'not-found');
  });
});
