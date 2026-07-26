// tests/e2e/scenes17.mjs —— 波次二十八「真机四瑕疵」实证批
// 缩略图抬离 / 列表有界滚动 / 全屏播放设置 / 字幕钮明白话
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function scenes17({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  fs.mkdirSync(WS + '/瑕', { recursive: true });
  execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=8:size=640x360:rate=15" -c:v libvpx -b:v 500k "${WS}/瑕/长片.webm"`, { stdio: 'pipe' });
  // 造 40 集同目录片（列表溢出逼滚动条）
  for (let i = 1; i <= 40; i++) {
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=1:size=160x90:rate=8" -c:v libvpx -b:v 200k "${WS}/瑕/第${String(i).padStart(2, '0')}集.webm"`, { stdio: 'pipe' });
  }

  // ==================== 1：缩略图抬离进度条 ====================
  await scenario('播放器·缩略图·抬离进度条', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/瑕/长片.webm']);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: '播放器就绪' });
    // 悬停进度条区中段逼出缩略图（hoverThumb 挂 .mz-seek 的 pointermove——合成事件类型与目标都要对）
    // 真实鼠标悬停（合成 pointermove 骗开 thumb 后会被浏览器真实 hit-test 发 pointerleave 秒藏（isTrusted:true 实锤）——
    // 产品 hover 语义本来就没病，测试必须用 CDP 真实鼠标）
    const rect = await evaluate(() => {
      const track = [...document.querySelectorAll('.mz-seek-track')].find(e => e.getBoundingClientRect().width > 0);
      const r = track.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 2) };
    });
    await win.mouse.move(rect.x, rect.y);
    await wait(700);
    const r = await evaluate(() => {
      const thumb = document.querySelector('.mz-thumb');
      const seek = document.querySelector('.mz-seek-track');
      const media = document.querySelector('video.mz-media');
      const diag = {
        display: thumb?.style.display, dur: media?.duration,
        zoneW: Math.round(document.querySelector('.mz-seek')?.getBoundingClientRect().width || 0),
        seekRectW: Math.round(seek?.getBoundingClientRect().width || 0),
      };
      if (!thumb || thumb.getBoundingClientRect().width === 0) return { shown: false, diag };
      return {
        shown: true, diag,
        thumbBottom: Math.round(thumb.getBoundingClientRect().bottom),
        seekTop: Math.round(seek.getBoundingClientRect().top),
      };
    });
    human.log('缩略图:', JSON.stringify(r));
    await human.assert(r.shown, '悬停应出缩略图');
    await human.assert(r.thumbBottom <= r.seekTop - 8, `缩略图底边应离进度条上沿（thumbBottom=${r.thumbBottom} seekTop=${r.seekTop}——22px 压条实锤修复）`);
  });

  // ==================== 2：三源列表有界滚动 ====================
  await scenario('播放器·列表·有界滚动条', async () => {
    // 播放列表 40+1 集溢出
    await evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(700);
    const r = await evaluate(() => {
      const list = document.querySelector('.mz-list');
      const side = document.querySelector('.mz-side');
      const items = list.querySelectorAll('.mz-li').length;
      return {
        items,
        canScroll: list.scrollHeight > list.clientHeight + 10,
        bounded: list.getBoundingClientRect().bottom <= side.getBoundingClientRect().bottom + 2,
        itemsCount: list.scrollHeight,
      };
    });
    human.log('播放列表:', JSON.stringify(r));
    await human.assert(r.items >= 40, `应有 40+ 条目（实际 ${r.items}）`);
    await human.assert(r.canScroll, `列表应可滚动（scrollHeight 超界；实际 ${JSON.stringify(r)}）`);
    await human.assert(r.bounded, '列表必须收在侧栏内不撑爆');
    // 网络资源 rows 链同规（切页签初始化后断言有界 flex）
    await evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'web')?.click(); });
    await wait(600);
    const w = await evaluate(() => {
      const rows = document.querySelector('.mz-web-rows');
      const web = document.querySelector('.mz-web');
      return {
        webCol: getComputedStyle(web).flexDirection,
        rowsFlex: rows ? getComputedStyle(rows).flexGrow : null,
      };
    });
    human.log('网络资源链:', JSON.stringify(w));
    await human.assert(w.rowsFlex === '1' && w.webCol === 'column', `rows 必须 flex:1 有界（${JSON.stringify(w)}）`);
    // 切回播放列表防污染后续场景
    await evaluate(() => { [...document.querySelectorAll('.mz-src-tab')].find(t => t.dataset.src === 'playlist')?.click(); });
  });

  // ==================== 3：全屏播放设置可达 ====================
  await scenario('播放器·全屏·播放设置可达', async () => {
    await evaluate(() => {
      const stage = [...document.querySelectorAll('.mz-stage')].find(e => e.getBoundingClientRect().width > 0);
      stage?.requestFullscreen?.();
    });
    await wait(800);
    const fsOk = await evaluate(() => !!document.fullscreenElement);
    await human.assert(fsOk, '应进全屏');
    await evaluate(() => { [...document.querySelectorAll('[data-a=pset]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(700);
    const r = await evaluate(() => {
      const mask = [...document.querySelectorAll('.mazz-palette-mask')].find(e => e.getBoundingClientRect().width > 0);
      return {
        visible: !!mask,
        inFs: !!(document.fullscreenElement && document.fullscreenElement.contains(mask)),
        title: mask?.textContent?.slice(0, 20),
      };
    });
    human.log('全屏 modal:', JSON.stringify(r));
    await human.assert(r.visible && r.inFs, `播放设置全屏必须可见（挂 fullscreenElement——挂 body 隐身实锤；实际 ${JSON.stringify(r)}）`);
    await evaluate(async () => {
      document.querySelectorAll('.mazz-palette-mask').forEach(e => e.remove());
      await document.exitFullscreen?.().catch(() => {});
    });
    await wait(400);
  });

  // ==================== 4：字幕钮无字幕明白话 ====================
  await scenario('播放器·字幕钮·无字幕明白话', async () => {
    // 监听 toast 文本
    const t = await evaluate(async () => {
      window.__toasts = [];
      const orig = document.createElement.bind(document);
      // 直接点字幕钮（无同名字幕的片）
      [...document.querySelectorAll('[data-a=sub]')].find(b => b.getBoundingClientRect().width > 0)?.click();
      await new Promise(r => setTimeout(r, 1500));
      return { text: document.body.textContent };
    });
    const hit = t.text.includes('未探测到同名字幕');
    human.log('字幕钮反馈:', hit ? '明白话在' : t.text.slice(-80));
    await human.assert(hit, '无字幕点击必须 toast 明白话（静默闷死实锤）');
  });
}
