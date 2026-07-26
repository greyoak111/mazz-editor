// tests/e2e/probe-rec2.mjs —— 探针：全局内录 0KB 修复实证（真人UI路径：对话框选源→录制→落盘）
// 四路：A 直录(原速单源) / B 画布(3倍速) / D 直录+最小化遮挡回归 / C 自录虚拟源
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
await win.waitForTimeout(2800);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

let pass = 0, fail = 0;
const report = (name, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(detail)}`);
  ok ? pass++ : fail++;
};

const sources = await win.evaluate(async () => await window.mazz.invoke('rec:sources'));
const screenSrc = sources.find(s => s.id.startsWith('screen:')) || sources.find(s => s.id.startsWith('window:'));
console.log('可用源:', sources.map(s => s.id).join(', ') || '(无)');
report('前置：存在屏幕/窗口采集源', !!screenSrc, { picked: screenSrc?.id });

/** 真人路径录一轮：命令开框→选源→调速→开始→(可最小化)→再执行命令停→轮询产物 */
async function recordOnce({ srcId, speed, minimize }) {
  await win.evaluate(() => window.MazzCommands.execute('rec.screen'));
  await win.waitForTimeout(1200); // 枚举源+缩略图渲染
  const prep = await win.evaluate(({ srcId, speed }) => {
    const cards = [...document.querySelectorAll('.rec-src')];
    if (!cards.length) return { err: '对话框未开或无源卡片' };
    const target = cards.find(c => c.dataset.id === srcId);
    if (!target) return { err: '目标源不在卡片列: ' + srcId };
    // 确定性单选：对话框默认必选 cards[0](mazz:self)——目标是它就不动，否则点掉默认再点目标。
    // （绝不读 borderColor 猜选中态：var() 内联序列化在 Chrome 下回 ''，曾把 A/B/D 骗成双源平铺）
    if (target !== cards[0]) { cards[0].click(); target.click(); }
    const sp = document.querySelector('#rec-speed'); if (sp) sp.value = String(speed);
    const sub = document.querySelector('#rec-sub'); if (sub && sub.checked) sub.click(); // 关字幕轨（免语音服务依赖）
    document.querySelector('#rec-go')?.click();
    return { ok: true };
  }, { srcId, speed });
  if (prep.err) return { err: prep.err };
  // 启动判定改轮询：前轮收尾（duration修复+落盘）与本轮枚举挤占主进程，单次 600ms 判定是竞态
  let has = false;
  for (let i = 0; i < 10 && !has; i++) {
    await win.waitForTimeout(400);
    has = await win.evaluate(() => !!window.MazzShell?._screenRec);
  }
  if (!has) return { err: '录制未启动（_screenRec 空）' };

  await win.waitForTimeout(2600); // 越过 2.5s 字节看门狗
  const bytesEarly = await win.evaluate(() => window.MazzShell?._screenRec?.bytes ?? -1);

  let bytesMin = null;
  if (minimize) {
    const bw = await app.browserWindow(win);
    await bw.evaluate((b) => b.minimize()).catch(() => {});
    await win.waitForTimeout(2500); // 最小化持续录制（0KB 事故复现场景）
    bytesMin = await win.evaluate(() => window.MazzShell?._screenRec?.bytes ?? -1);
    await bw.evaluate((b) => { b.restore(); b.focus(); }).catch(() => {});
    await win.waitForTimeout(400);
  }

  // 停止：真人路径=再次执行命令（shell 内 fire-and-forget，落盘异步）
  const bytesFinal = await win.evaluate(() => window.MazzShell?._screenRec?.bytes ?? -1);
  await win.evaluate(() => window.MazzCommands.execute('rec.screen'));
  // 轮询产物落盘（duration 修复+base64 写盘是异步收尾）
  let size = 0, newest = null;
  for (let i = 0; i < 16; i++) {
    await win.waitForTimeout(500);
    const st = await win.evaluate(async () => {
      const ws = await window.mazz.invoke('workspace:get');
      const dir = await window.mazz.invoke('fs:listDir', { path: ws + '/录制' }).catch(() => []);
      const names = dir.map(f => f.name || f).filter(n => n.endsWith('.webm'));
      if (!names.length) return null;
      const name = names[names.length - 1];
      const s = await window.mazz.invoke('fs:stat', { path: ws + '/录制/' + name }).catch(() => null);
      return { name, size: s?.size || 0 };
    });
    if (st && st.size > 0) { size = st.size; newest = st.name; break; }
  }
  return { bytesEarly, ...(minimize ? { bytesWhileMinimized: bytesMin } : {}), bytesFinal, size, newest };
}

if (screenSrc) {
  const a = await recordOnce({ srcId: screenSrc.id, speed: 1 });
  report('A 直录路径（原速单源）字节与落盘', !!(a.bytesFinal > 0 && a.size > 5000), a);

  const b = await recordOnce({ srcId: screenSrc.id, speed: 3 });
  report('B 画布路径（3倍速合成）字节与落盘', !!(b.bytesFinal > 0 && b.size > 5000), b);

  const d = await recordOnce({ srcId: screenSrc.id, speed: 1, minimize: true });
  report('D 直录+最小化遮挡全程有数据', !!(d.bytesFinal > 0 && d.size > 5000 && d.bytesWhileMinimized > d.bytesEarly), d);
}

const c = await recordOnce({ srcId: 'mazz:self', speed: 1 });
report('C 自录虚拟源字节与落盘', !!(c.bytesFinal > 0 && c.size > 5000), c);

console.log(`\n结果: ${pass} 过 ${fail} 挂`);
await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
