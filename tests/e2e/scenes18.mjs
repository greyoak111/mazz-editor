// tests/e2e/scenes18.mjs —— 波次二十九「浏览器白屏+mkv容错」实证批
// 遮挡隐身恢复规程（cloak→恢复→hidden=false+振荡触发）/ mkv 坏块容错明白话
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function scenes18({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);

  // ==================== 1：遮挡隐身恢复规程（白屏根治） ====================
  await scenario('浏览器·遮挡隐身·恢复振荡规程', async () => {
    // 开一个浏览器标签（scenes9 同款探法：__activeBrowserCtl 全局钩子）
    await evaluate(async () => {
      window.MazzShell?.openTab?.('browser', { title: '浏览器', content: '' });
    });
    await human.until(() => !!window.__activeBrowserCtl, { timeout: 9000, msg: '浏览器打开' });
    await wait(1200);
    const vid = await evaluate(() => window.__activeBrowserCtl?.activeId);
    human.log('视图:', vid);
    await human.assert(!!vid, '浏览器视图应在');
    const st0 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    human.log('初始:', JSON.stringify({ hidden: st0?.hidden, w: st0?.bounds?.width }));
    await human.assert(st0 && st0.hidden === false && st0.bounds?.width > 2, '初始应可见');
    // 触发遮挡（DOM 摆可见遮罩=ribbon 窗格同款 .mazz-palette-mask）
    await evaluate(() => {
      const mask = document.createElement('div');
      mask.className = 'mazz-palette-mask';
      mask.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.3)';
      document.body.appendChild(mask);
    });
    await wait(400);
    const st1 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    human.log('遮挡中:', JSON.stringify({ hidden: st1?.hidden }));
    await human.assert(st1?.hidden === true, `遮挡中视图必须隐身（原生表面压 DOM；实际 hidden=${st1?.hidden}）`);
    // 撤遮罩 → 恢复规程（hidden=false + reviveGen≥1 + bounds 复原）
    await evaluate(() => { document.querySelectorAll('.mazz-palette-mask').forEach(e => e.remove()); });
    await wait(500);
    const st2 = await evaluate(async ([v]) => await window.mazz.invoke('bv:state', { tabId: v }), [vid]);
    human.log('恢复:', JSON.stringify({ hidden: st2?.hidden, gen: st2?.reviveGen, w: st2?.bounds?.width }));
    await human.assert(st2?.hidden === false, '撤罩后必须恢复可见');
    await human.assert(st2?.reviveGen >= 1 && st2.reviveGen > (st0.reviveGen || 0), `隐→显必须触发振荡规程（gen ${st0.reviveGen}→${st2.reviveGen}——Windows D3D 丢 surface 白屏实锤根治）`);
    await human.assert(st2?.bounds?.width > 2, '恢复后矩形必须复原');
    // 等振荡双帧走完再断言无渲染异常（由异常警察兜底）
    await wait(400);
  });

  // ==================== 2：mkv 坏块容错（明白话不炸栈） ====================
  await scenario('播放器·mkv坏块·容错降级', async () => {
    // 先造合法四轨 mkv，再从中部覆写 0x00 垃圾段造「坏 Cluster」变体
    fs.mkdirSync(WS + '/坏', { recursive: true });
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=3:size=320x240:rate=15" -f lavfi -i "sine=frequency=440:duration=3" -f lavfi -i "sine=frequency=880:duration=3" -map 0:v -map 1:a -map 2:a -c:v libvpx -b:v 400k -c:a:0 flac -c:a:1 flac "${WS}/坏/底子.mkv"`, { stdio: 'pipe' });
    const buf = fs.readFileSync(WS + '/坏/底子.mkv');
    const damaged = Buffer.from(buf);
    damaged.fill(0, Math.floor(buf.length * 0.55), Math.floor(buf.length * 0.55) + 4096); // 中段 4KB 全 0（非法 varint 触发区）
    fs.writeFileSync(WS + '/坏/坏块番.mkv', damaged);
    // 轨枚举应还在（头段未坏）
    const tr = await evaluate(async ([p]) => await window.mazz.invoke('mkv:tracks', { path: p }), [WS + '/坏/坏块番.mkv']);
    human.log('轨表:', JSON.stringify((tr?.tracks || []).map(t => t.trackNumber + ':' + t.codecId)));
    await human.assert((tr?.tracks || []).some(t => t.type === 2), '头段未坏轨表应在');
    // 抽轨：坏块区段必须容错——要么抽出（跳过坏 Cluster），要么受控明白话（不许带原始栈消息穿透）
    const bad = tr.tracks.find(t => t.type === 2 && t.trackNumber !== 1) || tr.tracks.find(t => t.type === 2);
    const r = await evaluate(async ([p, tn]) => {
      try {
        const res = await window.mazz.invoke('mkv:extractTrack', { path: p, trackNumber: tn });
        return { ok: true, ext: res.ext, cached: res.cached };
      } catch (e) { return { err: String(e.message || e) }; }
    }, [WS + '/坏/坏块番.mkv', bad.trackNumber]);
    human.log('坏块抽轨:', JSON.stringify(r));
    if (r.ok) {
      await human.assert(r.ext === 'flac', `坏块容错应抽出（跳过坏 Cluster——${JSON.stringify(r)}）`);
    } else {
      await human.assert(r.err.includes('损坏') || r.err.includes('解析面') || r.err.includes('不可抽'),
        `失败也必须受控明白话（不许「非法 varint」原始栈穿透——实际：${r.err.slice(0, 80)}）`);
      await human.assert(!r.err.includes('readVint'), '不得穿透原始栈帧');
    }
  });
}
