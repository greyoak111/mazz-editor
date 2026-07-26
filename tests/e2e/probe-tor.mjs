// tests/e2e/probe-tor.mjs —— 探针：P2P 边下边播全链实证（daemon/magnet/流代理/三源面板/dmhy 适配器）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
await seedFixtures(WS, WS);

const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
  timeout: 120000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2600);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  break;
}
let pass = 0, fail = 0;
const rep = (name, ok, detail) => { console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(detail).slice(0, 220)}`); ok ? pass++ : fail++; };

// 1. magnet 添加与元数据
const added = await win.evaluate(async () => {
  try {
    const r = await window.mazz.invoke('tor:add', {
      magnet: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337',
    });
    return { infoHash: r.infoHash, name: r.name, files: r.files?.length, first: r.files?.[0]?.path?.slice(0, 40) };
  } catch (e) { return { err: String(e.message || e).slice(0, 160) }; }
});
rep('tor:add 元数据', !!(added.infoHash && added.files >= 1), added);
const IH = added.infoHash;

// 2. 流端点与 mazz-res://tor/ 代理 range 取流
if (IH) {
  const s = await win.evaluate(async ([ih]) => {
    const url = await window.mazz.invoke('tor:streamUrl', { infoHash: ih });
    if (!url) return { err: 'streamUrl null' };
    const proxy = 'mazz-res://tor/' + url.replace('http://', '');
    try {
      const r = await fetch(proxy, { headers: { Range: 'bytes=0-1023' } });
      const buf = await r.arrayBuffer();
      return { status: r.status, len: buf.byteLength, proxy: proxy.slice(0, 70) };
    } catch (e) { return { err: String(e.message || e).slice(0, 120) }; }
  }, [IH]);
  rep('mazz-res://tor/ 代理 range 取流', !!(s.status === 206 || s.len > 0), s);

  // 3. 状态统计（进度/peers）
  await win.waitForTimeout(4000);
  const st = await win.evaluate(async ([ih]) => await window.mazz.invoke('tor:stats', { infoHash: ih }), [IH]);
  rep('tor:stats 进度与 peers', !!(st && st.progress >= 0 && st.numPeers >= 0), st && { progress: st.progress, peers: st.numPeers, downSpeed: st.downSpeed });
}

// 4. dmhy 适配器真实搜索（结构实证）
const srch = await win.evaluate(async () => {
  try {
    const r = await window.mazz.invoke('sites:search', { site: 'dmhy', kw: '葬送的芙莉莲' });
    return { count: r.rows?.length, first: r.rows?.[0] };
  } catch (e) { return { err: String(e.message || e).slice(0, 160) };
  }
});
rep('sites:search 动漫花园结构', !!(srch.count >= 1 && srch.first?.title && srch.first?.href), { count: srch.count, first: srch.first, err: srch.err });

// 5. 详情页懒取 magnet（取首行）
if (srch.count >= 1) {
  const mg = await win.evaluate(async ([site, href]) => {
    try {
      const r = await window.mazz.invoke('sites:magnet', { site, href });
      return { ok: r.magnet?.startsWith('magnet:'), title: (r.title || '').slice(0, 40) };
    } catch (e) { return { err: String(e.message || e).slice(0, 120) }; }
  }, ['dmhy', srch.first.href]);
  rep('sites:magnet 详情页懒取', !!mg.ok, mg);
}

// 6. 三源面板结构（页操作全在 node 层——evaluate 里没有 win（嵌套调用必炸实锤））
await win.evaluate(() => window.MazzCommands?.execute('file.newMarkdown'));
await win.waitForTimeout(800);
const ws6 = await win.evaluate(async () => await window.mazz.invoke('workspace:get'));
const { execSync: exec6 } = await import('node:child_process');
exec6('ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x180:rate=15 -c:v libvpx "' + ws6 + '/三源探针.webm"', { stdio: 'pipe' });
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [ws6 + '/三源探针.webm']);
await win.waitForTimeout(1600);
await win.evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
await win.waitForTimeout(500);
const panel = await win.evaluate(() => ({
  tabs: [...document.querySelectorAll('.mz-src-tab')].map(t => t.dataset.src),
  hasMedia: !!document.querySelector('.mz-medialib'), hasWeb: !!document.querySelector('.mz-web'),
}));
rep('三源面板结构', !!(panel.tabs?.length === 3 && panel.hasMedia && panel.hasWeb), panel);

// 7. 切媒体库模式与网络资源模式
if (panel.tabs?.length === 3) {
  const modes = await win.evaluate(async () => {
    const out = {};
    const tabs = [...document.querySelectorAll('.mz-src-tab')];
    tabs.find(t => t.dataset.src === 'medialib')?.click();
    await new Promise(r => setTimeout(r, 700));
    out.ml = { bar: !!document.querySelector('.mz-ml-bar'), list: !!document.querySelector('.mz-ml-list') || document.querySelector('.mz-medialib')?.textContent.includes('空的') };
    tabs.find(t => t.dataset.src === 'web')?.click();
    await new Promise(r => setTimeout(r, 700));
    out.web = { site: !!document.querySelector('.mz-web-site'), kw: !!document.querySelector('.mz-web-kw'), magnet: !!document.querySelector('.mz-web-magnet'), hint: document.querySelector('.mz-web-rows')?.textContent?.slice(0, 20) };
    return out;
  });
  rep('媒体库模式渲染', !!modes.ml?.bar, modes.ml);
  rep('网络资源模式渲染', !!(modes.web?.site && modes.web?.kw && modes.web?.magnet), modes.web);
}

console.log(`\n结果: ${pass} 过 ${fail} 挂`);
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
