// tests/e2e/scenes16.mjs —— 波次二十七c「HEVC 官方组件指引」实证批
// 播放设置解码自检（矩阵+平台指引）/ 降级卡指引 / win32 指引链接 DOM
import fs from 'node:fs';

export async function scenes16({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  fs.mkdirSync(WS + '/指', { recursive: true });
  fs.writeFileSync(WS + '/指/假HEVC.mkv', Buffer.from('not a real matroska file at all'.repeat(100)));

  // ==================== 1：播放设置·解码能力自检 ====================
  await scenario('播放器·解码自检·矩阵与平台指引', async () => {
    const { execSync } = await import('node:child_process');
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=2:size=320x240:rate=15" -c:v libvpx -b:v 400k "${WS}/指/开面板.webm"`, { stdio: 'pipe' });
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/指/开面板.webm']);
    await human.until(() => {
      const m = [...document.querySelectorAll('video.mz-media')].find(e => e.getBoundingClientRect().width > 0);
      return m && m.readyState >= 1;
    }, { timeout: 9000, msg: '播放器就绪' });
    await evaluate(() => { [...document.querySelectorAll('[data-a=pset]')].find(b => b.getBoundingClientRect().width > 0)?.click(); });
    await wait(900); // 探测异步渲染
    const r = await evaluate(() => {
      const box = document.querySelector('.ps-codec');
      const rows = box ? [...box.children].filter(e => e.tagName === 'DIV' && !e.className.includes('hevc-guide')).map(e => e.textContent.trim()) : [];
      const guide = box?.querySelector('.ps-hevc-guide');
      return { rows, guideText: guide?.textContent || '', hasGuide: !!guide };
    });
    human.log('自检:', JSON.stringify({ rows: r.rows.length, guide: r.guideText.slice(0, 60) }));
    await human.assert(r.rows.length >= 6, `自检矩阵应出 6 行读数（实际 ${r.rows.length}）`);
    await human.assert(r.rows.some(t => t.includes('H.264')) && r.rows.some(t => t.includes('HEVC')), '矩阵应含 H264 与 HEVC 行');
    // 沙箱 linux：HEVC ✗ → 指引应出 VAAPI 文案（win32 链接走契约层）
    await human.assert(r.hasGuide && /VAAPI|vaapi/.test(r.guideText), `HEVC 缺失应嵌平台指引（实际 ${r.guideText.slice(0, 60)}）`);
    // win32 指引链接 DOM（手工渲染验证：链接文本/URL/点击通道接线）
    const w = await evaluate(async () => {
      const { renderHevcGuide } = await import('./lib/codec-guide.js').catch(() => ({}));
      if (!renderHevcGuide) return { err: 'no-module' };
      const host = document.createElement('div');
      renderHevcGuide(host, 'win32');
      const links = [...host.querySelectorAll('.codec-link')].map(a => ({ name: a.textContent, url: (a.dataset.url || '').slice(0, 60) }));
      return { links, text: host.textContent.slice(0, 400) };
    });
    human.log('win32 指引:', JSON.stringify(w));
    await human.assert(w.links?.length === 2 && w.links.every(l => l.url.includes('delivery.mp.microsoft.com')), `win32 应出双官方链接（${JSON.stringify(w.links)}）`);
    await human.assert(/Add-AppxPackage|appxbundle|微软商店/.test(w.text), '指引应含安装与兜底说明');
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask').forEach(e => e.remove()); });
  });

  // ==================== 2：降级卡 HEVC 指引 ====================
  await scenario('查看器·降级卡·HEVC指引', async () => {
    await evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/指/假HEVC.mkv']);
    await wait(2200);
    const r = await evaluate(() => ({
      vf: !!document.querySelector('.viewer-fallback'),
      guide: document.querySelector('.vf-hevc-guide')?.textContent || '',
    }));
    human.log('降级卡:', JSON.stringify({ vf: r.vf, guide: r.guide.slice(0, 50) }));
    await human.assert(r.vf, '假片应出降级卡');
    await human.assert(r.guide && /VAAPI|HEVC|原生支持|官方/.test(r.guide), `降级卡应嵌 HEVC 指引（实际 ${r.guide.slice(0, 60)}）`);
  });
}
