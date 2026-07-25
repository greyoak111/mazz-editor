import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-sn-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-snw-'));
fs.copyFileSync('tests/e2e/media/sample_4s.mp4', WS + '/样片.mp4');
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
win.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 150)));
win.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 150)); });
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/样片.mp4']);
await win.waitForTimeout(4000);
const btn = await win.evaluate(() => { const els = [...document.querySelectorAll('[data-a=snap]')]; return els.length + '/' + (els.find(e => e.offsetParent) ? 'visible' : 'hidden'); });
console.log('snap btns:', btn);
await win.evaluate(() => { const els = [...document.querySelectorAll('[data-a=snap]')]; (els.find(e => e.offsetParent) || els[0])?.click(); });
await win.waitForTimeout(2000);
console.log('dir:', await win.evaluate(async () => {
  const ws = await window.mazz.invoke('workspace:get');
  return await window.mazz.invoke('fs:listDir', { path: ws + '/录制/截图' }).catch(e => 'ERR:' + e.message);
}));
await app.close();
