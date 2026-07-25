import { _electron as electron } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-gh-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-ghw-'));
fs.writeFileSync(path.join(WS, '甲档.md'), '# 甲');
const app = await electron.launch({ args: ['.'], env: { ...process.env, MAZZ_E2E_USER_DATA: UD, MAZZ_E2E_WORKSPACE: WS } });
const win = await app.firstWindow();
await win.waitForTimeout(3500);
for (let i = 0; i < 12; i++) { const a = await win.$('#agree-accept'); if (a) { await a.click().catch(()=>{}); } else break; await win.waitForTimeout(300); }
await win.evaluate(async ([p]) => { await window.MazzCommands.execute('file.openPath', { path: p }); }, [WS + '/甲档.md']);
await win.waitForTimeout(800);
console.log('tabs0:', await win.evaluate(() => window.MazzShell.paneTree.leaves().flatMap(l => l.tabs.tabs).map(t => t.filePath)));
// 监听 watcher 广播
await win.evaluate(() => {
  window.__events = [];
  const orig = window.mazz.on.bind(window.mazz);
  window.mazz.on('file:changed', (e) => window.__events.push(JSON.stringify(e)));
});
const del = await win.evaluate(async ([p]) => { try { return await window.mazz.invoke('fs:delete', { path: p }); } catch (e) { return { err: e.message }; } }, [WS + '/甲档.md']);
console.log('del:', JSON.stringify(del));
await win.waitForTimeout(3000);
console.log('文件还在吗:', fs.existsSync(WS + '/甲档.md') ? '在!' : '没了');
// 补一发 add 事件探 watcher 死活
await win.evaluate(async ([p]) => { await window.mazz.invoke('fs:writeFile', { path: p, content: 'x' }); }, [WS + '/探针.txt']);
await win.waitForTimeout(1500);
console.log('events:', await win.evaluate(() => window.__events.join(' | ') || 'NONE'));
console.log('tabs1:', await win.evaluate(() => window.MazzShell.paneTree.leaves().flatMap(l => l.tabs.tabs).map(t => t.filePath)));
await app.close();
