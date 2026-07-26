// tests/e2e/probe-dmhy-play.mjs —— 实播取证：播放器网络资源面板→动漫花园首页奈叶行→边下边播→截图
// 截图1：实播中（含展开的播放器列表栏）；截图2：列表栏拖拽调宽后的列表状态
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-shot-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-shot-ws-'));
const OUT = '/mnt/agents/output';
const log = (...a) => console.log('[shot]', ...a);

fs.mkdirSync(WS + '/片', { recursive: true });
execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=3:size=640x360:rate=15" -c:v libvpx -b:v 500k "${WS}/片/垫片.webm"`, { stdio: 'pipe' });

let app, win;
async function main() {
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
    timeout: 120000,
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!(window.MazzCommands && window.MazzShell), null, { timeout: 15000 });
  await win.waitForTimeout(600);
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
  // 清开机遮罩
  for (let i = 0; i < 20; i++) {
    const st = await win.evaluate(() => ({
      masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length,
      agree: !!document.querySelector('#agree-accept'),
    }));
    if (st.agree) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
    if (st.masks === 0) break;
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
  }

  // 开垫片进播放器 → 开列表栏 → 切网络资源（首开自动 loadHome）
  await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/片/垫片.webm']);
  await win.waitForFunction(() => {
    const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
    return m && m.readyState >= 1;
  }, null, { timeout: 9000 });
  await win.evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'web')?.click(); });
  log('等 DMHY 首页行…');
  const homeOk = await win.waitForFunction(() => document.querySelectorAll('.mz-web-row').length >= 10, null, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!homeOk) throw new Error('首页 30s 未出行');
  const rows = await win.evaluate(() => [...document.querySelectorAll('.mz-web-row')].map((el, i) => ({ i, title: el.querySelector('.mz-wr-title')?.textContent || '' })));
  log('首页行数:', rows.length, '首行:', rows[0]?.title.slice(0, 50));

  // 找奈叶行；首页没有就搜（兜底，目的=实播奈叶）
  let target = rows.find(r => r.title.includes('魔法少女奈叶'));
  if (!target) {
    log('首页暂无奈叶，转搜索…');
    await win.evaluate(() => {
      const kw = document.querySelector('.mz-web-kw');
      kw.value = '魔法少女奈叶';
      kw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await win.waitForFunction(() => document.querySelectorAll('.mz-web-row').length >= 1 && !document.querySelector('.mz-web-rows.mz-dim'), null, { timeout: 30000 }).catch(() => {});
    const sr = await win.evaluate(() => [...document.querySelectorAll('.mz-web-row')].map((el, i) => ({ i, title: el.querySelector('.mz-wr-title')?.textContent || '' })));
    target = sr.find(r => r.title.includes('EXCEEDS')) || sr[0];
    log('搜索行数:', sr.length, '目标:', target?.title?.slice(0, 50));
  } else {
    log('命中首页奈叶行:', target.title.slice(0, 60), '行号:', target.i);
  }
  if (!target) throw new Error('无奈叶行可播');

  // 点行：取 magnet → tor:add → setSource 流（每 5s 采样诊断：magnet 阶段/watching/统计/src）
  const href = await win.evaluate(([i]) => {
    const rows = [...document.querySelectorAll('.mz-web-row')];
    const el = rows[i];
    el?.click();
    return el?.dataset?.href || null;
  }, [target.i]);
  log('已点行，等 magnet+元数据+首流（最长 180s）…');
  const t0 = Date.now();
  let played = false;
  while (Date.now() - t0 < 180000) {
    const st = await win.evaluate(() => {
      const m = document.querySelector('video.mz-media');
      return {
        src: (m?.src || '').slice(0, 60), rs: m?.readyState,
        watching: [...document.querySelectorAll('.mz-watch')].map(w => w.querySelector('.mz-watch-meta')?.textContent || ''),
        toast: [...document.querySelectorAll('.mazz-toast, .mz-toast')].map(t => t.textContent.slice(0, 70)),
      };
    });
    log(`采样 ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(st));
    if (/^http:\/\/127\.0\.0\.1/.test(st.src || '') && st.rs >= 1) { played = true; break; }
    await win.waitForTimeout(5000);
  }
  if (!played) {
    await win.screenshot({ path: OUT + '/播放器-实播动漫花园奈叶-失败现场.png' });
    const diag = await win.evaluate(() => ({
      src: document.querySelector('video.mz-media')?.src?.slice(0, 80),
      watch: [...document.querySelectorAll('.mz-watch')].map(w => w.textContent.slice(0, 60)),
      toast: document.querySelector('.mazz-toast')?.textContent || '',
    }));
    log('未等到流元数据，现场:', JSON.stringify(diag));
    throw new Error('流未就绪（热度/网络），已截失败现场');
  }
  log('流元数据就绪，等画面推进…');
  await win.evaluate(() => { const m = document.querySelector('video.mz-media'); m.muted = false; m.play().catch(() => {}); });
  const progressed = await win.waitForFunction(() => {
    const m = document.querySelector('video.mz-media');
    return m && m.currentTime > 0.4 && m.readyState >= 2;
  }, null, { timeout: 90000 }).then(() => true).catch(() => false);
  log('画面推进:', progressed);
  // 尽量停在一帧有内容的画面（边下边播 seek 会拉块，就用自然播放位置）
  await win.waitForTimeout(1500);
  const info = await win.evaluate(() => {
    const m = document.querySelector('video.mz-media');
    return { src: m.src.slice(0, 70), ct: +m.currentTime.toFixed(2), rs: m.readyState, vw: m.videoWidth, vh: m.videoHeight, paused: m.paused };
  });
  log('播放状态:', JSON.stringify(info));
  await win.screenshot({ path: OUT + '/播放器-实播动漫花园奈叶（含列表栏）.png' });
  log('截图1 落盘');

  // 列表状态：grip 拖宽到 ~400 + 网络资源首页行可见
  await evaluate_noop_guard();
  const sideLeft = await win.evaluate(() => Math.round(document.querySelector('.mz-side').getBoundingClientRect().left));
  await win.evaluate(([bx]) => {
    const grip = document.querySelector('.mz-side-grip');
    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: bx, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: bx - 70, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: bx - 140, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [sideLeft]);
  await win.waitForTimeout(500);
  const side2 = await win.evaluate(() => Math.round(document.querySelector('.mz-side').getBoundingClientRect().width));
  log('拖宽后侧栏:', side2);
  await win.screenshot({ path: OUT + '/播放器-列表栏状态（拖宽+网络资源）.png' });
  log('截图2 落盘');
}
async function evaluate_noop_guard() {}
main().catch(e => { console.error('[shot] 失败:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
    await new Promise(r => setTimeout(r, 600));
    try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
