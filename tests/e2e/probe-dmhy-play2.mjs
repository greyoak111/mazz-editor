// tests/e2e/probe-dmhy-play2.mjs —— 实播取证v2：奈叶双版本热度攻坚 + 界面实况截图（含列表栏）
// 截A：播放器+展开列表栏+DMHY首页（奈叶行）+下载管理实况
// 截B：列表栏拖宽后的列表状态特写
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-shot2-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-shot2-ws-'));
const OUT = '/mnt/agents/output';
const log = (...a) => console.log('[shot2]', ...a);
const TRS = ['udp://tracker.opentrackr.org:1337/announce', 'udp://explodie.org:6969/announce', 'udp://tracker.coppersurfer.tk:6969/announce', 'udp://tracker.empire-js.us:1337/announce', 'udp://tracker.leechers-paradise.org:6969/announce'];
const NANOHA_TRAD = 'magnet:?xt=urn:btih:e9cd7be9b4e17e5e525e886d72df7175435a0397&dn=' + encodeURIComponent('[ExileSub][魔法少女奈叶EXCEEDS Gun Blaze Vengeance][04][繁体][1080P]') + TRS.map(t => '&tr=' + encodeURIComponent(t)).join('');
const NANOHA_SIMP = 'magnet:?xt=urn:btih:268edfd7ecd02346eb7082bb4e03e7b2bd2d4801&dn=' + encodeURIComponent('[ExileSub][魔法少女奈叶EXCEEDS Gun Blaze Vengeance][04][简体][1080P]') + TRS.map(t => '&tr=' + encodeURIComponent(t)).join('');

fs.mkdirSync(WS + '/片', { recursive: true });
execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=3:size=640x360:rate=15" -c:v libvpx -b:v 500k "${WS}/片/垫片.webm"`, { stdio: 'pipe' });

let app, win;
async function main() {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
  win = await app.firstWindow();
  win.on('console', m => { const t = m.text(); if (/error|Error|失败|种子|magnet/i.test(t)) log('PAGE:', t.slice(0, 130)); });
  win.on('pageerror', e => log('PAGEERR:', String(e).slice(0, 160)));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!(window.MazzCommands && window.MazzShell), null, { timeout: 15000 });
  await win.waitForTimeout(600);
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
  for (let i = 0; i < 20; i++) {
    const st = await win.evaluate(() => ({
      masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length,
      agree: !!document.querySelector('#agree-accept'),
    }));
    if (st.agree) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
    if (st.masks === 0) break;
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
  }
  // 开垫片进播放器 → 列表栏展开 → 网络资源页（自动载首页）
  await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/片/垫片.webm']);
  await win.waitForFunction(() => {
    const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
    return m && m.readyState >= 1;
  }, null, { timeout: 9000 });
  await win.evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'web')?.click(); });
  await win.waitForFunction(() => document.querySelectorAll('.mz-web-row').length >= 10, null, { timeout: 30000 });
  const rows = await win.evaluate(() => [...document.querySelectorAll('.mz-web-row')].map((el, i) => ({ i, title: el.querySelector('.mz-wr-title')?.textContent || '' })));
  const nanohaRows = rows.filter(r => r.title.includes('魔法少女奈叶'));
  log('首页行数:', rows.length, '奈叶行:', JSON.stringify(nanohaRows.map(r => r.i + ':' + r.title.slice(0, 46))));

  // —— 奈叶双版本热度攻坚（繁简交错重试×3 轮，swarm 抖动实测命中率抽样：简体 3/4、繁体 0/4）——
  let used = null;
  outer: for (let round = 1; round <= 3 && !used; round++) {
    for (const [label, magnet] of [['简体', NANOHA_SIMP], ['繁体', NANOHA_TRAD]]) {
      log(`第${round}轮 试${label}奈叶…`);
      const r = await win.evaluate(async ([m, timeout]) => {
        try {
          const race = await Promise.race([
            window.mazz.invoke('tor:add', { magnet: m }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
          ]);
          return { ok: true, infoHash: race.infoHash, name: race.name, files: (race.files || []).map(f => f.path) };
        } catch (e) { return { err: String(e.message || e).slice(0, 80) }; }
      }, [magnet, 70000]);
      log(`第${round}轮 ${label}:`, JSON.stringify(r));
      if (r.ok) { used = { label, magnet, ...r }; break outer; }
    }
  }
  // 有热度：走用户真实路径——点简体奈叶行（playRow→sites:magnet 裸 magnet→enrichMagnet 注入→幂等秒回→setSource）
  if (used) {
    const clickIdx = await win.evaluate(() => {
      const rowsEls = [...document.querySelectorAll('.mz-web-row')];
      const pick = rowsEls.find(el => (el.querySelector('.mz-wr-title')?.textContent || '').includes('简体'))
        || rowsEls.find(el => (el.querySelector('.mz-wr-title')?.textContent || '').includes('魔法少女奈叶'));
      if (!pick) return -1;
      pick.scrollIntoView({ block: 'center' });
      pick.click();
      return [...document.querySelectorAll('.mz-web-row')].indexOf(pick);
    });
    log('点击行号:', clickIdx, '(', used.label, '版已 add，行播放走 enrich+幂等）');
    log('等流挂上与下载推进…');
    for (let i = 0; i < 8; i++) {
      const st = await win.evaluate(() => ({
        src: (document.querySelector('video.mz-media')?.src || '').slice(0, 50),
        watch: document.querySelectorAll('.mz-watch').length,
        busy: !!document.querySelector('.mz-web-row[data-busy]'),
      }));
      log('流采样:', JSON.stringify(st));
      if (/^http:\/\/127\.0\.0\.1/.test(st.src)) break;
      await win.waitForTimeout(4000);
    }
    for (let i = 0; i < 10; i++) {
      await win.waitForTimeout(4000);
      const st = await win.evaluate(async () => {
        const l = (await window.mazz.invoke('tor:list'))?.[0];
        return l ? { peers: l.numPeers, down: l.downSpeed, prog: l.progress } : null;
      });
      log('实况:', JSON.stringify(st));
      if (st && (st.prog > 0.01 || st.down > 200000)) break;
    }
  }
  const mediaState = await win.evaluate(() => {
    const m = document.querySelector('video.mz-media');
    return {
      src: (m?.src || '').slice(0, 66), rs: m?.readyState, ct: +(m?.currentTime || 0).toFixed(2), err: m?.error?.code || 0,
      diag: window.__errDiag || null, ov: !!document.querySelector('.mz-stream-err'),
      vf: !!document.querySelector('.viewer-fallback'), side: !!document.querySelector('.mz-side'),
    };
  });
  log('媒体态:', JSON.stringify(mediaState));
  await win.waitForTimeout(1200);
  await win.screenshot({ path: OUT + '/播放器-实播动漫花园奈叶（含列表栏）.png' });
  log('截图A 落盘');

  // 列表状态特写：grip 拖宽 ~140（播放器若已毁则跳过）
  const sideLeft = await win.evaluate(() => document.querySelector('.mz-side') ? Math.round(document.querySelector('.mz-side').getBoundingClientRect().left) : null);
  if (sideLeft == null) { log('播放器 DOM 已毁，跳过截图B'); return; }
  await win.evaluate(([bx]) => {
    const grip = document.querySelector('.mz-side-grip');
    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: bx, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: bx - 70, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: bx - 140, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [sideLeft]);
  await win.waitForTimeout(600);
  await win.screenshot({ path: OUT + '/播放器-列表栏状态（拖宽+网络资源）.png' });
  log('截图B 落盘');
}
main().catch(e => { console.error('[shot2] 失败:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
