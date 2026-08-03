// tests/e2e/scenes31.mjs —— 波次四十「演示手机遥控」实证批
// 伺服起手（面板/QR/URL/HTTP 页）/ 假手机 WS 全双工（连上补态/cmd 翻帧/黑屏/在线数/心跳/白名单）/ 收映态推送 / 停伺服
// 假手机在 runner 进程（Node ws 包——与真手机同网络路径，不经渲染层 CSP）
import WebSocket from 'ws';

export async function scenes31({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const key = (k) => evaluate((k2) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k2, bubbles: true })), k);
  const phone = { ws: null, states: [], open: false };

  // ==================== 0：起 v2 三帧档 ====================
  await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
  await human.until(() => window.__activeSlideCtl?.isV2 === true, { timeout: 9000, msg: 'v2 就绪' });
  await evaluate(async () => {
    const ctl = window.__activeSlideCtl;
    const m = await import('./modules/slide/doc.js');
    const doc = ctl.doc2;
    const s2 = m.createSlide(null, { items: [m.createItem('text', { text: '第二帧', left: 10, top: 40, width: 60, height: 14 })] });
    doc.slides[s2.id] = s2;
    doc.layouts.main.frames.push(m.createFrame(s2.id));
    ctl.renderV2All();
  });
  await wait(300);

  // ==================== 1：伺服起手（面板/QR/URL/HTTP 页） ====================
  let remoteUrl = null;
  await scenario('演示遥控·伺服起手扫码面', async () => {
    await evaluate(() => window.MazzCommands?.execute('slide.remote'));
    await wait(600);
    const r = await evaluate(() => {
      const card = document.querySelector('.sl-remote-card');
      return { card: !!card, qr: card?.querySelector('.qr')?.src?.startsWith('data:image/png'), url: card?.querySelector('.url')?.textContent };
    });
    const res = await fetch(r.url); // Node 侧 HTTP（与手机浏览器同路径）
    const html = await res.text();
    const again = await evaluate(() => window.mazz.invoke('slideRemote:start').then(x => x.already === true));
    human.log('起手:', JSON.stringify({ ...r, httpLen: html.length }));
    remoteUrl = r.url;
    await human.assert(r.card, '遥控面板必须开');
    await human.assert(r.qr, 'QR 码必须出（扫码即连）');
    await human.assert(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/$/.test(r.url), `URL 必须是局域网址（${r.url}）`);
    await human.assert(html.length > 400 && html.includes('下一帧') && html.includes('黑屏'), '遥控页必须 HTTP 伺服且三键齐');
    await human.assert(again, '重复启动必须幂等（单端口）');
  });

  // ==================== 2：假手机全双工 ====================
  await scenario('演示遥控·假手机全双工', async () => {
    // 连 WS（心跳+补态）
    await new Promise((res, rej) => {
      phone.ws = new WebSocket(remoteUrl.replace('http://', 'ws://') + 'ws');
      phone.ws.on('open', () => { phone.open = true; res(); });
      phone.ws.on('message', (d) => { try { phone.states.push(JSON.parse(d.toString())); } catch {} });
      phone.ws.on('error', rej);
      setTimeout(() => rej(new Error('WS 连接超时')), 5000);
    });
    phone.ws.send(JSON.stringify({ type: 'hb' }));
    await wait(400);
    const r0 = await evaluate(() => window.mazz.invoke('slideRemote:status'));
    const cnt0 = await evaluate(() => document.querySelector('.sl-remote-card .n')?.textContent);
    human.log('连线:', JSON.stringify({ clients: r0.clients, cnt: cnt0, states: phone.states.length }));
    await human.assert(r0.clients >= 1, `在线必须数到（${r0.clients}——心跳即在线）`);
    await human.assert(cnt0 === String(r0.clients), `面板在线数必须同步（${cnt0}）`);
    // 未在放映发指令不得崩（明白话待命节流）
    phone.ws.send(JSON.stringify({ type: 'cmd', cmd: 'next' }));
    await wait(300);
    const noCrash = await evaluate(() => !window.__activeSlideCtl._presenter && window.__activeSlideCtl.slStatus !== 'present');
    await human.assert(noCrash, '未放映指令必须待命不崩');
    // 起放映：推态必须达手机
    await evaluate(() => window.MazzCommands?.execute('slide.present'));
    await wait(500);
    const last1 = phone.states.filter(s => s.type === 'state').pop();
    human.log('推态:', JSON.stringify(last1));
    await human.assert(last1?.presenting === true, '放映态必须推达手机');
    await human.assert(last1.pos === 1 && last1.total === 2, `进度必须对（${last1?.pos}/${last1?.total}）`);
    await human.assert(typeof last1.clockSec === 'number' && typeof last1.title === 'string' && last1.title.length > 0, `计时与帧名必须入态（${last1.title}）`);
    // 手机 cmd next → 翻帧且回推
    phone.ws.send(JSON.stringify({ type: 'cmd', cmd: 'next' }));
    await wait(600);
    const r2 = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter?.fi }));
    const last2 = phone.states.filter(s => s.type === 'state').pop();
    await human.assert(r2.fi === 1 && last2?.pos === 2, `手机翻帧必须生效且回推（fi=${r2.fi},pos=${last2?.pos}）`);
    // 手机 cmd prev → 回帧
    phone.ws.send(JSON.stringify({ type: 'cmd', cmd: 'prev' }));
    await wait(600);
    const r3 = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter?.fi }));
    await human.assert(r3.fi === 0, `手机回帧必须生效（fi=${r3.fi}）`);
    // 手机 cmd black → 黑屏开/关且回推
    phone.ws.send(JSON.stringify({ type: 'cmd', cmd: 'black' }));
    await wait(400);
    const rb = await evaluate(() => !!document.querySelector('.sl-pv2-black'));
    const lb = phone.states.filter(s => s.type === 'state').pop();
    await human.assert(rb && lb?.black === true, `黑屏必须开且回推（${JSON.stringify({ rb, black: lb?.black })}）`);
    phone.ws.send(JSON.stringify({ type: 'cmd', cmd: 'black' }));
    await wait(400);
    const rb2 = await evaluate(() => !!document.querySelector('.sl-pv2-black'));
    const lb2 = phone.states.filter(s => s.type === 'state').pop();
    await human.assert(!rb2 && lb2?.black === false, '黑屏必须关且回推');
    // 白名单：野指令必须丢
    phone.ws.send(JSON.stringify({ type: 'cmd', cmd: 'rm -rf' }));
    phone.ws.send(JSON.stringify({ type: 'evil' }));
    await wait(300);
    const rw = await evaluate(() => ({ fi: window.__activeSlideCtl._presenter?.fi, overlay: !!document.querySelector('.sl-present') }));
    await human.assert(rw.fi === 0 && rw.overlay, '野指令必须被白名单丢掉');
  });

  // ==================== 3：收映态推送 ====================
  await scenario('演示遥控·收映态推送', async () => {
    await key('Escape');
    await wait(400);
    const last = phone.states.filter(s => s.type === 'state').pop();
    const r = await evaluate(() => window.__activeSlideCtl.slStatus);
    human.log('收映:', JSON.stringify({ presenting: last?.presenting, status: r }));
    await human.assert(last?.presenting === false && r === 'normal', '收映必须推「未在放映」');
    phone.ws?.close();
  });

  // ==================== 4：停伺服 ====================
  await scenario('演示遥控·停伺服清场', async () => {
    await evaluate(() => document.querySelector('.sl-remote-card .stop')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await wait(500);
    const r = await evaluate(() => window.mazz.invoke('slideRemote:status'));
    let dead = false;
    try { await fetch(remoteUrl); } catch { dead = true; }
    const card = await evaluate(() => !!document.querySelector('.sl-remote-card'));
    human.log('停服:', JSON.stringify({ running: r.running, card, dead }));
    await human.assert(r.running === false && !card, '伺服必须停且面板清');
    await human.assert(dead, 'HTTP 必须随停即死');
  });
}
