// W74b：W65 四站 -> Feed 变化/聚类/热度 -> 人工裁决 -> W74a -> Factory 材料篮真机实证。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Human } from './human.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-user-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-e2e-ws-'));
const results = [];
let app = null;

async function scenario(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`■ ${name} ✓`); }
  catch (error) { results.push([name, 'FAIL', error.message]); console.error(`■ ${name} ✗\n${error.stack || error.message}`); }
}

try {
  console.log('[run88] 启动 Electron');
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WS,
      MAZZ_E2E_W74B_FEED_FIXTURE: '1',
      MAZZ_E2E_DISABLE_GPU: '1',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const proc = app.process?.();
  proc?.stdout?.on?.('data', bytes => process.stdout.write('[electron] ' + String(bytes)));
  proc?.stderr?.on?.('data', bytes => process.stderr.write('[electron:err] ' + String(bytes)));
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForFunction(() => document.readyState !== 'loading');
  const human = new Human(win, { tag: 'w74b' });
  human.watchMain(app);
  await human.until(() => !!(window.MazzCommands && window.MazzShell), { timeout: 15000, msg: '壳初始化' });
  await human.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }).catch(() => {}),
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }).catch(() => {}),
  ]));
  await win.waitForTimeout(700);
  for (let index = 0; index < 20; index += 1) {
    const state = await human.evaluate(() => ({
      agree: !!document.querySelector('#agree-accept'),
      masks: [...document.querySelectorAll('.mazz-palette-mask')].filter(node => node.getBoundingClientRect().width > 0).length,
    }));
    if (state.agree) {
      await human.evaluate(() => { const box = document.querySelector('#agree-nomore'); if (box) box.checked = true; document.querySelector('#agree-accept')?.click(); });
      await win.waitForTimeout(120);
      continue;
    }
    if (!state.masks) break;
    await win.keyboard.press('Escape');
    await win.waitForTimeout(120);
  }

  let configPanel = null;

  await scenario('W74b 正式入口扫描、跨源热度与磁盘真值', async () => {
    await human.evaluate(() => window.MazzCommands.execute('factory.toggleDock'));
    await human.until(() => {
      const root = document.querySelector('.factory-root');
      return root && root.getBoundingClientRect().width > 0;
    }, { timeout: 12000, msg: '智能创作面板显示' });
    await win.locator('.factory-root:visible [data-a=project]').click();
    const started = Date.now();
    while (!configPanel && Date.now() - started < 12000) {
      configPanel = app.windows().find(page => /panels\/factorycfg\.html/.test(page.url()));
      if (!configPanel) await win.waitForTimeout(100);
    }
    if (!configPanel) throw new Error('正式新项目立项窗口未打开');
    configPanel.on('pageerror', error => human.errors.push('[factorycfg pageerror] ' + error.message));
    configPanel.on('console', message => { if (message.type() === 'error') human.errors.push('[factorycfg console.error] ' + message.text()); });
    await configPanel.waitForSelector('#pj-feed-query', { state: 'attached', timeout: 12000 });
    await configPanel.locator('details.advanced > summary').click();
    await configPanel.locator('#pj-feed-query').fill('发布工程跨源样本');
    await configPanel.locator('#pj-feed-dimension').fill('发布工程动态');
    await configPanel.locator('[data-pa=feedScan]').click();
    await configPanel.waitForFunction(() => document.querySelector('.feed-list')?.textContent.includes('4 个独立来源'), null, { timeout: 15000 });
    const ui = await configPanel.locator('.advanced-body').innerText();
    await human.assert(/1 组变化/.test(ui) && /1 组跨源热点/.test(ui) && /热度 100/.test(ui), `四站同 hash 应聚成一组可解释热点（${ui.replace(/\s+/g, ' ').slice(0, 180)}）`);
    const emoji = await configPanel.locator('.feed-list').evaluate(node => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(node.textContent));
    await human.assert(!emoji, 'W74b 新增结果区不得出现裸 emoji');

    const feedRoot = path.join(WS, '.mazz', 'feed');
    const packageFiles = fs.readdirSync(path.join(feedRoot, 'packages')).filter(name => name.endsWith('.json'));
    const reportFiles = fs.readdirSync(path.join(feedRoot, 'reports')).filter(name => name.endsWith('.md'));
    await human.assert(packageFiles.length === 1 && reportFiles.length === 1, '扫描必须同时落一个不可变包清单和一个可读报告');
    const packageValue = JSON.parse(fs.readFileSync(path.join(feedRoot, 'packages', packageFiles[0]), 'utf8'));
    await human.assert(packageValue.clusters.length === 1 && packageValue.clusters[0].heat.sourceCount === 4, '磁盘投喂包必须保留四个独立来源与一组聚类');
    await human.assert(packageValue.route.automaticFactoryStart === false, '投喂包必须明确禁止自动启动 Factory');
    await configPanel.locator('main').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await configPanel.screenshot({ path: path.join(ROOT, 'docs/engineering/evidence/W74B_FEED_REVIEW.png') });
  });

  await scenario('人工核准进入 W74a 与智能创作项目材料', async () => {
    await configPanel.locator('[data-pa=feedApprove]').click();
    await configPanel.waitForFunction(() => document.querySelector('.advanced-body')?.textContent.includes('已核准为派生材料'), null, { timeout: 15000 });
    const panelText = await configPanel.locator('.advanced-body').innerText();
    await human.assert(panelText.includes('素材订阅：发布工程动态'), '核准包应进入智能创作项目材料');
    const materialCatalog = JSON.parse(fs.readFileSync(path.join(WS, '.mazz', 'materials', 'catalog.json'), 'utf8'));
    await human.assert(materialCatalog.entryCount === 1 && materialCatalog.entries[0].layer === 'derived', 'W74a 只登记一个 derived Material');
    const decisions = fs.readdirSync(path.join(WS, '.mazz', 'feed', 'decisions')).filter(name => name.endsWith('.json'));
    const decision = JSON.parse(fs.readFileSync(path.join(WS, '.mazz', 'feed', 'decisions', decisions[0]), 'utf8'));
    await human.assert(decision.action === 'approve' && decision.materialRef?.role === 'input-material', '不可变裁决必须带可消费的 Material Reference');
    const running = await human.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('mazz.factory.tasks') || '[]').filter(task => task.status === 'running').length; }
      catch { return -1; }
    });
    await human.assert(running === 0, '核准投喂不得越权创建或启动 Factory 任务');
    await configPanel.locator('main').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await configPanel.screenshot({ path: path.join(ROOT, 'docs/engineering/evidence/W74B_FEED_APPROVED_MATERIAL.png') });
  });

  await scenario('相同证据复扫不制造空包', async () => {
    await configPanel.locator('[data-pa=feedScan]').click();
    await configPanel.waitForFunction(() => document.querySelector('.advanced-body')?.textContent.includes('没有检测到新增或内容变化'), null, { timeout: 15000 });
    const packages = fs.readdirSync(path.join(WS, '.mazz', 'feed', 'packages')).filter(name => name.endsWith('.json'));
    await human.assert(packages.length === 1, '无变化复扫后投喂包数量必须仍为一');
  });

  await scenario('异常警察·W74b 全程零主进程/渲染异常', async () => {
    await human.finish({ allow: ['ERR_ABORTED', 'net::ERR_FILE_NOT_FOUND', 'favicon'] });
  });

  const passed = results.filter(row => row[1] === 'PASS').length;
  console.log(`W74b 实证批：${passed}/${results.length} 通过`);
  if (passed !== results.length) process.exitCode = 1;
} catch (error) {
  console.error('[run88] 启动或总装失败：', error.stack || error.message);
  process.exitCode = 2;
} finally {
  if (app) await app.close().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 500));
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch {}
  try { fs.rmSync(WS, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch {}
}

process.exit(process.exitCode || 0);
