// tests/e2e/run8.mjs —— 波次十九书库尾巴实证批 runner（scenes8 专用迭代器）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
import { scenes8 } from './scenes8.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
fs.writeFileSync(WS + '/测试文档.md', '# 项目计划\n\n## 第一章 概念\n\n正文内容熵增定律。\n');

const results = [];
const SCENE_TIMEOUT = 45000;
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`场景熔断(${SCENE_TIMEOUT / 1000}s)`)), SCENE_TIMEOUT))]);
    results.push([name, 'PASS']);
    console.log(`■ ${name} ✅ (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push([name, 'FAIL', e.message]);
    console.error(`■ ${name} ❌\n${e.message}`);
  }
}

let app, win, human, ownPid = null;
async function main() {
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MAZZ_E2E_USER_DATA: USER_DATA, MAZZ_E2E_WORKSPACE: WS, NODE_ENV: 'test' },
    timeout: 120000,
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  ownPid = app.process()?.pid ?? null;
  human = new Human(win);
  await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
  await win.waitForTimeout(600);
  // Windows 双杀预防：关闭行为改直接退出（否则 cleanup 时 app.close() 弹「托盘/退出/取消」询问框卡死）
  await human.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}));
  for (let i = 0; i < 20; i++) {
    const state = await human.evaluate(() => {
      const masks = [...document.querySelectorAll('.mazz-palette-mask')].filter(m => m.getBoundingClientRect().width > 0);
      const acc = document.querySelector('#agree-accept');
      return { masks: masks.length, agree: !!acc };
    });
    if (state.agree) { await human.click('#agree-accept').catch(() => {}); await win.waitForTimeout(300); continue; }
    if (state.masks === 0) break;
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }

  await scenes8({ win, human, WS, WS2, scenario });
  await scenario('异常警察·全程零渲染异常', async () => { await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] }); });

  const fails = results.filter(r => r[1] === 'FAIL');
  console.log('\n═══════════');
  console.log(`第四轮回归批：${results.length - fails.length}/${results.length} 过`);
  if (fails.length) { console.log('失败：' + fails.map(f => f[0]).join('、')); process.exitCode = 1; }
}
async function cleanup() {
  try { if (app) await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
  if (ownPid) { try { process.kill(ownPid, 'SIGTERM'); } catch {} }
  await new Promise(r => setTimeout(r, 800)); // Windows：句柄释放有延迟，等一拍再删
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {} // EPERM 容忍：清不干净也不许崩 runner
}
main().catch(e => { console.error('崩溃：', e); process.exitCode = 2; }).finally(cleanup);
