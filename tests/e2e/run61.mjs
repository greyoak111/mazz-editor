// tests/e2e/scenes61.mjs —— W58c 实证批 runner（scenes61 专用迭代器）
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Human } from './human.mjs';
import { seedFixtures } from './fixtures.mjs';
import { scenes61 } from './scenes61.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws2-'));
await seedFixtures(WS, WS2);
fs.writeFileSync(WS + '/测试文档.md', '# W58c 实证\n\n正文。\n');

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
  human.watchMain(app); // 军规⑩ 主进程日志警察
  await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
  await win.waitForTimeout(600);
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

  await scenes61({ app, win, human, WS, WS2, scenario });
  await scenario('异常警察·全程零渲染异常', async () => { await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon', 'findDocumentLinks', 'findDocumentSymbols', 'getFoldingRanges'] }); });

  const passed = results.filter(r => r[1] === 'PASS').length;
  console.log('═══════════');
  console.log(`W58g实证批：${passed}/${results.length} 过`);
  const fails = results.filter(r => r[1] !== 'PASS');
  if (fails.length) { console.log('失败：' + fails.map(f => f[0]).join('、')); process.exitCode = 1; }
  await app.close().catch(() => {});
  process.exit(process.exitCode || 0);
}
main().catch(e => { console.error('RUNNER_FATAL', e); process.exit(2); });
