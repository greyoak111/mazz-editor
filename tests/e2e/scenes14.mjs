// tests/e2e/scenes14.mjs —— 波次二十六「播放器列表栏工作区栏同款」实证批
// 展开压缩/收起铺满/折叠符号 / grip 拖拽调宽+持久化 / 状态记忆重开自动开栏
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function scenes14({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const openVideo = async (rel) => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/' + rel]);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: rel + ' 播放器就绪' });
  };
  const sideState = () => evaluate(() => {
    const stage = document.querySelector('.mz-stage');
    const media = document.querySelector('video.mz-media');
    const side = document.querySelector('.mz-side');
    return {
      open: stage.classList.contains('side-open'),
      stageW: Math.round(stage.getBoundingClientRect().width),
      mediaW: Math.round(media.getBoundingClientRect().width),
      sideW: Math.round(side.getBoundingClientRect().width),
      sideVisible: side.getBoundingClientRect().width > 0,
      controlsRight: Math.round(document.querySelector('.mz-controls').getBoundingClientRect().right),
      sideLeft: Math.round(side.getBoundingClientRect().left),
    };
  });

  fs.mkdirSync(WS + '/栏', { recursive: true });
  execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=4:size=640x360:rate=15" -c:v libvpx -b:v 500k "${WS}/栏/栏测番.webm"`, { stdio: 'pipe' });
  execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=4:size=640x360:rate=15" -c:v libvpx -b:v 500k "${WS}/栏/栏测番二.webm"`, { stdio: 'pipe' });

  // ==================== 1：展开压缩/收起铺满/折叠符号 ====================
  await scenario('播放器·列表栏·展开压缩收起铺满', async () => {
    await openVideo('栏/栏测番.webm');
    const s0 = await sideState();
    await human.assert(!s0.open && !s0.sideVisible && s0.mediaW === s0.stageW, `初始应铺满（${JSON.stringify(s0)}）`);
    // 展开：点列表钮 → 视频区压缩 260，侧栏可见，控制条右缘让开
    await evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(400); // width .15s 过渡
    const s1 = await sideState();
    human.log('展开:', JSON.stringify(s1));
    await human.assert(s1.open && s1.sideVisible, `展开后侧栏应可见（${JSON.stringify(s1)}）`);
    await human.assert(Math.abs(s1.mediaW - (s1.stageW - s1.sideW)) <= 2, `视频区应压缩=舞台-侧栏（mediaW=${s1.mediaW} 应=${s1.stageW - s1.sideW}）`);
    await human.assert(s1.controlsRight <= s1.sideLeft + 2, `控制条右缘应让开侧栏（${s1.controlsRight} vs ${s1.sideLeft}）`);
    // 折叠符号：svg 在位 + 叉号退役
    const sym = await evaluate(() => {
      const b = document.querySelector('.mz-side-x');
      return { hasSvg: !!b.querySelector('svg'), text: b.textContent.trim(), title: b.title };
    });
    human.log('折叠钮:', JSON.stringify(sym));
    await human.assert(sym.hasSvg && !sym.text.includes('✕'), `折叠符号应 SVG 在位且叉号退役（${JSON.stringify(sym)}）`);
    // 收起：点折叠钮 → 视频区铺满
    await evaluate(() => { document.querySelector('.mz-side-x').click(); });
    await wait(400);
    const s2 = await sideState();
    human.log('收起:', JSON.stringify(s2));
    await human.assert(!s2.open && !s2.sideVisible && s2.mediaW === s2.stageW, `收起应铺满（${JSON.stringify(s2)}）`);
  });

  // ==================== 2：grip 拖拽调宽 + 持久化 ====================
  await scenario('播放器·列表栏·自由拉伸', async () => {
    await evaluate(() => { [...document.querySelectorAll('[data-a=list]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(400);
    const before = await sideState();
    // grip 往左拖 90px = 变宽 90（合成 MouseEvent：grip 常驻不销毁，无 dragend 永失风险）
    const after = await evaluate(async ([bx]) => {
      const grip = document.querySelector('.mz-side-grip');
      grip.dispatchEvent(new MouseEvent('mousedown', { clientX: bx, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: bx - 45, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: bx - 90, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      const stage = document.querySelector('.mz-stage');
      const media = document.querySelector('video.mz-media');
      const side = document.querySelector('.mz-side');
      return {
        sideW: Math.round(side.getBoundingClientRect().width),
        mediaW: Math.round(media.getBoundingClientRect().width),
        stageW: Math.round(stage.getBoundingClientRect().width),
      };
    }, [Math.round((await sideState()).sideLeft)]);
    human.log('拖拽前:', before.sideW, '拖拽后:', JSON.stringify(after));
    await human.assert(after.sideW === before.sideW + 90, `左拖90应变宽90（${before.sideW}→${after.sideW}）`);
    await human.assert(Math.abs(after.mediaW - (after.stageW - after.sideW)) <= 2, `视频区应同步再压缩（${JSON.stringify(after)}）`);
    // 持久化
    const saved = await evaluate(async () => await window.mazz.invoke('settings:get', { key: 'player.listSide' }));
    human.log('持久化:', JSON.stringify(saved));
    await human.assert(saved && saved.width === after.sideW && saved.open === true, `宽度与开合应落 settings（${JSON.stringify(saved)}）`);
  });

  // ==================== 3：状态记忆（重开片自动开栏+宽度保持） ====================
  await scenario('播放器·列表栏·状态记忆', async () => {
    await openVideo('栏/栏测番二.webm');
    await wait(600); // settings 读取+applySide
    const s = await sideState();
    human.log('重开:', JSON.stringify(s));
    await human.assert(s.open && s.sideVisible, `重开应自动开栏（${JSON.stringify(s)}）`);
    await human.assert(Math.abs(s.mediaW - (s.stageW - s.sideW)) <= 2, `记忆宽度应同步压缩（${JSON.stringify(s)}）`);
    // 收场：收起还原，免得污染后续批
    await evaluate(() => { document.querySelector('.mz-side-x').click(); });
  });
}
