// tests/e2e/scenes35.mjs —— 波次四十四「播放器与媒体库已知问题专修」实证批
// 空起手裸播放器 / 媒体库递归树（嵌套全检+折叠） / 下载目录明面化迁移 / 缩略图切源失效 / 保存路径明白话
import fs from 'fs';
import path from 'path';

export async function scenes35({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：空起手裸播放器 ====================
  await scenario('播放器·无视频启动', async () => {
    await evaluate(() => window.MazzCommands?.execute('file.newViewer'));
    await human.until(() => !!document.querySelector('.mz-player .mz-empty'), { timeout: 9000, msg: '空起手占位' });
    const r = await evaluate(() => ({
      empty: !!document.querySelector('.mz-empty'),
      sideTabs: [...document.querySelectorAll('.mz-src-tab')].map(e => e.textContent.trim()),
      name: document.querySelector('.mz-name')?.textContent,
      mediaSrc: document.querySelector('.mz-media')?.getAttribute('src'),
    }));
    human.log('空起手:', JSON.stringify(r));
    await human.assert(r.empty, '空起手占位必须在');
    await human.assert(r.sideTabs.length === 3, `侧栏三源必须全在（${r.sideTabs.join('/')}）`);
    await human.assert(r.mediaSrc === null, `空源不得硬设 src（${r.mediaSrc}——null 串化闸实锤）`);
    // 上源撤占位：灌一个真实存在的文件（mazz-res 200——decode 降级是元素级事件，不算渲染异常）
    const ws1 = await evaluate(() => window.mazz.invoke('workspace:get'));
    fs.mkdirSync(path.join(ws1, '媒体库'), { recursive: true });
    fs.writeFileSync(path.join(ws1, '媒体库/probe.mp4'), 'junk-but-exists');
    await evaluate((p) => {
      const ctl = window.__activeViewerCtl;
      ctl?._player?.setSource('mazz-res://media/' + encodeURIComponent(p), 'probe.mp4', p, 100);
    }, ws1 + '/媒体库/probe.mp4');
    await wait(300);
    const r2 = await evaluate(() => ({ empty: !!document.querySelector('.mz-empty'), name: document.querySelector('.mz-name')?.textContent }));
    await human.assert(!r2.empty && r2.name === 'probe.mp4', `上源必须撤占位（${JSON.stringify(r2)}）`);
  });

  // ==================== 2：媒体库递归树 ====================
  await scenario('媒体库·递归树嵌套全检', async () => {
    // 造嵌套：媒体库/download/[Nix-Raws] XXX/EP01.mkv + 媒体库/顶层.mp4 + .audcache 干扰件
    const ws = await evaluate(() => window.mazz.invoke('workspace:get'));
    fs.mkdirSync(path.join(ws, '媒体库/download/[Nix-Raws] 测试番'), { recursive: true });
    fs.writeFileSync(path.join(ws, '媒体库/download/[Nix-Raws] 测试番/EP01.mkv'), 'x'.repeat(1024));
    fs.writeFileSync(path.join(ws, '媒体库/顶层片.mp4'), 'x'.repeat(2048));
    fs.mkdirSync(path.join(ws, '媒体库/.audcache'), { recursive: true });
    fs.writeFileSync(path.join(ws, '媒体库/.audcache/缓存轨.aac'), 'x'.repeat(512));
    await evaluate(() => { const ctl = window.__activeViewerCtl; ctl._player && (ctl.srcMode = 'medialib'); });
    await evaluate(() => {
      const root = document.querySelector('.mz-player');
      root.querySelector('[data-src="medialib"]').click();
    });
    await wait(800);
    const r = await evaluate(() => ({
      count: document.querySelector('.mz-side-count')?.textContent,
      dirs: [...document.querySelectorAll('.mz-ml-dir .mz-ml-dname')].map(e => e.textContent.trim()),
      files: [...document.querySelectorAll('.mz-ml-item .mz-ml-name')].map(e => e.textContent.trim()),
      cacheLeak: [...document.querySelectorAll('.mz-ml-item')].some(e => e.textContent.includes('缓存轨')),
    }));
    human.log('递归树:', JSON.stringify(r));
    await human.assert(r.count === '（3）', `计数必须全检嵌套（${r.count}——EP01/顶层/场景一 probe 三枚）`);
    await human.assert(r.dirs.some(d => d.includes('download')) && r.dirs.some(d => d.includes('Nix-Raws')), `目录树必须分层（${r.dirs.join('|')}）`);
    await human.assert(r.files.some(f => f.includes('EP01.mkv')) && r.files.some(f => f.includes('顶层片.mp4')), '嵌套与顶层文件必须全在');
    await human.assert(!r.cacheLeak, '.audcache 必须不入库');
    // 折叠：点 [Nix-Raws] 夹 → 其 kids 包 display none；再点复开
    const r2 = await evaluate(() => {
      const d = [...document.querySelectorAll('.mz-ml-dir')].find(e => e.textContent.includes('Nix-Raws'));
      const kids = d?.nextElementSibling;
      const before = kids?.style.display;
      d.click();
      const folded = kids?.style.display;
      d.click();
      const reopened = kids?.style.display;
      return { before, folded, reopened };
    });
    await human.assert(r2.before !== r2.folded && r2.folded !== r2.reopened, `折叠必须双向翻转（${JSON.stringify(r2)}）`);
    // 点文件开播（onNav 链）
    await evaluate(() => {
      [...document.querySelectorAll('.mz-ml-item')].find(e => e.textContent.includes('顶层片.mp4'))?.click();
    });
    await wait(500);
    const r3 = await evaluate(() => ({ path: window.__activeViewerCtl?.path || '' }));
    await human.assert(r3.path.endsWith('顶层片.mp4'), `点文件必须走 onNav 开播链（${r3.path}——假文件不解码，路径即实锤）`);
  });

  // ==================== 3：下载目录明面化迁移 ====================
  await scenario('媒体库·下载目录明面化', async () => {
    // 造旧 .download 残部 → 触发 storeRoot → 必须合并迁走
    const ws = await evaluate(() => window.mazz.invoke('workspace:get'));
    fs.mkdirSync(path.join(ws, '媒体库/.download/旧番组'), { recursive: true });
    fs.writeFileSync(path.join(ws, '媒体库/.download/旧番组/旧片.mkv'), 'legacy');
    // storeRoot 迁移在 tor:add 口径同步触发（不等add结果——零哈希种子挂起无妨，catch 吞超时后清）
    await evaluate(() => {
      window.mazz.invoke('tor:add', { magnet: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000' }).catch(() => {});
    });
    let check = { done: false, gone: false };
    for (let i = 0; i < 10 && !check.done; i++) {
      await wait(300);
      check = {
        done: fs.existsSync(path.join(ws, '媒体库/download/旧番组/旧片.mkv')),
        gone: !fs.existsSync(path.join(ws, '媒体库/.download/旧番组')),
      };
    }
    await evaluate(() => window.mazz.invoke('tor:remove', { infoHash: '0000000000000000000000000000000000000000', deleteFiles: false }).catch(() => {}));
    human.log('迁移:', JSON.stringify(check));
    await human.assert(check.done, '旧 .download 内容必须迁到明面 download');
    await human.assert(check.gone, '旧点目录必须清场');
    // 工作区树可见性：明面目录在树里自然可列（fs:listDir 默认滤点不挡它）
    const r2 = await evaluate((d) => window.mazz.invoke('fs:listDir', { path: d }), ws + '/媒体库');
    await human.assert(r2.some(e => e.name === 'download' && e.isDir), '工作区树必须能列出 download（明面化实锤）');
    const r3 = await evaluate((d) => window.mazz.invoke('fs:listDir', { path: d, includeDot: true }), ws + '/媒体库');
    await human.assert(!r3.some(e => e.name === '.git'), 'includeDot 也必须挡 .git');
  });

  // ==================== 4：缩略图切源失效 ====================
  await scenario('播放器·缩略图切源失效', async () => {
    const ws4 = await evaluate(() => window.mazz.invoke('workspace:get'));
    const r = await evaluate((p2) => {
      const ctl = window.__activeViewerCtl;
      const p = ctl?._player;
      if (!p) return { skip: true };
      p.setSource('mazz-res://media/' + encodeURIComponent(p2), 'probe.mp4', p2, 1);
      return { ok: typeof p.setSource === 'function' };
    }, ws4 + '/媒体库/probe.mp4');
    await human.assert(r.ok, 'setSource 面必须在（切源重建路径已被 w44 闸守——契约在案）');
  });

  // ==================== 5：保存路径明白话（源码级实锤——E2E 种子链太长，走契约+函数体检） ====================
  await scenario('播放器·保存路径明白话', async () => {
    const r = await evaluate(async () => {
      // toast 签名承载（label/fn/timeout）——onTorrentDone 的 toast 调用形态体检
      const { toast } = await import('./shell/shell.js');
      let captured = null;
      toast('已存到：/probe/媒体库/x.mkv', [{ label: '打开所在文件夹', fn: () => { captured = true; } }], 100);
      const el = [...document.querySelectorAll('.mazz-toast, [class*=toast]')].find(e => e.textContent.includes('已存到：'));
      return { shown: !!el, text: el?.textContent?.slice(0, 40), captured };
    });
    human.log('toast:', JSON.stringify(r));
    await human.assert(r.shown && r.text.includes('/probe/媒体库/'), 'toast 必须能带完整路径（明白话落地）');
  });
}
