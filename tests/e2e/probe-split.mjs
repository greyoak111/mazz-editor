// tests/e2e/probe-split.mjs —— 探针：分屏预览 33% 神秘框全链复现（出现/换区/落点/残留扫描）
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
await win.waitForTimeout(2600);
for (let i = 0; i < 10; i++) {
  const acc = await win.evaluate(() => !!document.querySelector('#agree-accept'));
  if (acc) { await win.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
  const masks = await win.evaluate(() => [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0).length);
  if (!masks) break;
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
}

// 开两个签
await win.evaluate(() => { window.MazzCommands?.execute('file.newMarkdown'); });
await win.waitForTimeout(900);
await win.evaluate(() => { window.MazzCommands?.execute('file.newMarkdown'); });
await win.waitForTimeout(900);

const fire = (type, x, y, dt) => win.evaluate(([type, x, y, dt]) => {
  const d = new DataTransfer();
  if (dt) d.setData('mazz/tab', dt);
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: d });
  document.dispatchEvent(ev);
  return ev.defaultPrevented;
}, [type, x, y, dt]);

const paneRect = () => win.evaluate(() => {
  const p = [...document.querySelectorAll('.pane')].find(e => e.getBoundingClientRect().width > 0);
  const r = p.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const overlayState = () => win.evaluate(() => {
  const els = [...document.body.children].filter(el => {
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' && cs.pointerEvents === 'none' && el.getBoundingClientRect().width > 0 && !el.id && !el.className;
  }).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), bg: cs.backgroundImage.slice(0, 60), borderL: cs.borderLeftWidth, borderR: cs.borderRightWidth, z: cs.zIndex };
  });
  return els;
});

const pr = await paneRect();
console.log('窗格:', JSON.stringify(pr));

// 1. 拖到右三区
await fire('dragstart', pr.left + 100, pr.top + 6, 'tabX');
await fire('dragover', pr.left + pr.width * 0.85, pr.top + pr.height * 0.5, 'tabX');
await win.waitForTimeout(250);
let ov = await overlayState();
console.log('右三区预览框:', JSON.stringify(ov));
const expectW = Math.round(pr.width / 3);
console.log('判定: 框宽', ov[0]?.width, 'vs 窗格1/3', expectW, '| 左缘应在 2/3 处', Math.round(pr.left + pr.width * 2 / 3), 'vs', ov[0]?.left);

// 2. 换到中区 → 应消
await fire('dragover', pr.left + pr.width * 0.5, pr.top + pr.height * 0.5, 'tabX');
await win.waitForTimeout(250);
ov = await overlayState();
console.log('中区后框数（应0）:', ov.length);

// 3. 再到下三区 → 应现（占下 1/3 横条）
await fire('dragover', pr.left + pr.width * 0.5, pr.top + pr.height * 0.85, 'tabX');
await win.waitForTimeout(250);
ov = await overlayState();
console.log('下三区预览框:', JSON.stringify(ov));

// 4. drop 落点分屏 → 框必须消失 + 窗格变 2 + 无残留
await fire('drop', pr.left + pr.width * 0.5, pr.top + pr.height * 0.85, 'tabX');
await win.waitForTimeout(500);
ov = await overlayState();
const panes = await win.evaluate(() => [...document.querySelectorAll('.pane')].filter(e => e.getBoundingClientRect().width > 0).length);
console.log('drop后: 框数(应0)=', ov.length, '| 窗格数(应2)=', panes);
const residual = await win.evaluate(() => {
  // 残留扫描：任何 fixed/absolute 定位、宽或高恰为窗格 1/3 的无主元素
  return [...document.querySelectorAll('body *')].filter(el => {
    const cs = getComputedStyle(el);
    if (!['fixed', 'absolute'].includes(cs.position)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    return cs.zIndex >= 40 && !el.closest('.tabbar, .titlebar, .statusbar, .mazz-menu, .mazz-palette-mask');
  }).map(el => ({ tag: el.tagName, cls: el.className?.toString?.().slice(0, 40), z: getComputedStyle(el).zIndex, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
});
console.log('高层残留元素:', JSON.stringify(residual));

// 5. 再拖 → dragend 不落点 → 框消无分屏
await fire('dragstart', pr.left + 100, pr.top + 6, 'tabY');
await fire('dragover', pr.left + pr.width * 0.1, pr.top + pr.height * 0.5, 'tabY');
await win.waitForTimeout(250);
ov = await overlayState();
console.log('左三区预览框(应现):', ov.length);
await fire('dragend', pr.left + pr.width * 0.5, pr.top + pr.height * 0.5, 'tabY');
await win.waitForTimeout(300);
ov = await overlayState();
const panes2 = await win.evaluate(() => [...document.querySelectorAll('.pane')].filter(e => e.getBoundingClientRect().width > 0).length);
console.log('dragend后: 框数(应0)=', ov.length, '| 窗格数(应仍2)=', panes2);

// 6. 复现致命粘连：拖签中途源元素被重渲染销毁（dragend 永失）
await fire('dragstart', pr.left + 100, pr.top + 6, 'tabZ');
await fire('dragover', pr.left + pr.width * 0.85, pr.top + pr.height * 0.3, 'tabZ');
await win.waitForTimeout(250);
ov = await overlayState();
console.log('粘连复现前框数(应1):', ov.length);
// 模拟标题更新触发 renderTabs：源 tab 元素被整个替换（真实路径：页面加载/通知改标题）
await win.evaluate(() => {
  const tabs = document.querySelector('.br-tabs, .tabbar, [class*=tabs]');
  if (tabs) tabs.innerHTML = tabs.innerHTML; // 强制重建子元素（等价 renderTabs 毁灭源元素）
  document.querySelectorAll('.tab').forEach(t => t.replaceWith(t.cloneNode(true)));
});
await win.waitForTimeout(400);
ov = await overlayState();
const shieldOn = await win.evaluate(() => document.body.classList.contains('tab-dragging'));
console.log('源毁灭后400ms: 框数(粘连实锤)=', ov.length, '| 盾牌残留=', shieldOn);
await win.waitForTimeout(1700); // 看门狗 1500ms 起跳
ov = await overlayState();
const shieldOff = await win.evaluate(() => document.body.classList.contains('tab-dragging'));
console.log('看门狗后: 框数(应0)=', ov.length, '| 盾牌(应false)=', shieldOff);
// 7. pointerup 兜底单测：再造粘连 → pointerup → 应即清
await fire('dragstart', pr.left + 100, pr.top + 6, 'tabW');
await fire('dragover', pr.left + pr.width * 0.85, pr.top + pr.height * 0.3, 'tabW');
await win.waitForTimeout(250);
await win.evaluate(() => { document.querySelectorAll('.tab').forEach(t => t.replaceWith(t.cloneNode(true))); });
await fire('pointerup', pr.left + pr.width * 0.5, pr.top + pr.height * 0.5, null);
await win.waitForTimeout(200);
ov = await overlayState();
const shieldUp = await win.evaluate(() => document.body.classList.contains('tab-dragging'));
console.log('pointerup兜底后: 框数(应0)=', ov.length, '| 盾牌(应false)=', shieldUp);

await app.close().catch(() => {});
fs.rmSync(USER_DATA, { recursive: true, force: true });
