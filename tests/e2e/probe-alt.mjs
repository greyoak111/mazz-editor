import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-alt-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-altws-'));
const app = await electron.launch({ args: [ROOT], env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' }, timeout: 120000 });
const win = await app.firstWindow();
await win.waitForFunction(() => !!(window.MazzCommands && window.mazz), null, { timeout: 15000 });
await win.waitForTimeout(500);
await win.evaluate(() => window.MazzCommands?.execute('file.newMindmap'));
await win.waitForFunction(() => !!window.__activeMindmapCtl, null, { timeout: 9000 });
await win.waitForTimeout(600);
await win.evaluate(() => {
  const ctl = window.__activeMindmapCtl;
  ctl.doc.roots = [{ id: 'root', text: '根', collapsed: false, children: [{ id: 'A', text: '甲', collapsed: false, children: [] }] }];
  ctl.render();
  const g = document.querySelector('.mm-node[data-id="A"]');
  const rect = document.querySelector('.mm-canvas-wrap').getBoundingClientRect();
  g.dispatchEvent(new MouseEvent('dblclick', { clientX: rect.left + 100, clientY: rect.top + 60, bubbles: true }));
});
await win.waitForTimeout(400);
const r = await win.evaluate(() => {
  const editor = document.querySelector('.mm-editor');
  editor.focus();
  editor.value = '第一行';
  const before = { focus: document.activeElement === editor, val: editor.value };
  // 合成 Alt+Enter keydown 直接发（绕过 playwright modifiers 语法嫌疑）
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
  const mid = { val: editor.value };
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: false, bubbles: true, cancelable: true }));
  return { before, mid, editing: window.__activeMindmapCtl.editing, text: window.__activeMindmapCtl.doc.roots[0].children[0].text };
});
console.log(JSON.stringify(r));
await app.close().catch(() => {});
