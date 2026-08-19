// W67：真实 Electron 资源/工作集观测与 20x Native Surface 回收探针。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w67-user-'));
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w67-ws-'));
const OUT = path.join(ROOT, 'docs', 'engineering', 'evidence', 'W67_MEMORY_RUNTIME.json');
let app;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mib = value => Math.round(Number(value || 0) / 1024 / 1024 * 10) / 10;
const recoveryRatio = (baseline, peak, after) => {
  const allocated = Math.max(0, peak - baseline);
  return allocated < 1024 * 1024 ? 1 : Math.max(0, Math.min(1, (peak - after) / allocated));
};

try {
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 120000 });
  await page.waitForFunction(() => !!(window.MazzShell && window.mazz), null, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('panel:close', { kind: 'agreement' });
  });
  await wait(1000);

  const baselineResources = await page.evaluate(() => window.mazz.invoke('resources:snapshot'));
  await page.evaluate(() => window.mazz.invoke('memory:resetBaseline'));
  const baseline = await page.evaluate(() => window.mazz.invoke('memory:capture'));

  for (let index = 0; index < 20; index += 1) {
    await page.evaluate(index => window.mazz.invoke('bv:create', {
      tabId: `w67-view-${index}`, partition: 'persist:mazz-browser', url: 'about:blank',
    }), index);
  }
  await page.waitForFunction(expected => window.mazz.invoke('resources:snapshot')
    .then(value => value.byType['web-contents-view'] === expected), 20, { timeout: 30000 });
  await wait(1500);
  const viewPeak = await page.evaluate(() => window.mazz.invoke('memory:capture'));
  for (let index = 0; index < 20; index += 1) {
    await page.evaluate(index => window.mazz.invoke('bv:destroy', { tabId: `w67-view-${index}` }), index);
  }
  await page.waitForFunction(expected => window.mazz.invoke('resources:snapshot')
    .then(value => value.activeCount === expected), baselineResources.activeCount, { timeout: 30000 });
  await wait(6000);
  const viewAfter = await page.evaluate(() => window.mazz.invoke('memory:capture'));

  for (let index = 0; index < 20; index += 1) {
    await page.evaluate(index => window.mazz.invoke('panel:open', {
      kind: 'fpreview', opts: { instanceId: `w67-panel-${index}`, title: `W67 ${index}` },
    }), index);
  }
  await page.waitForFunction(expected => window.mazz.invoke('resources:snapshot')
    .then(value => value.byType['panel-window'] === expected), 20, { timeout: 60000 });
  await wait(2000);
  const panelPeak = await page.evaluate(() => window.mazz.invoke('memory:capture'));
  await page.evaluate(() => window.mazz.invoke('panel:close', { kind: 'fpreview' }));
  await page.waitForFunction(expected => window.mazz.invoke('resources:snapshot')
    .then(value => value.activeCount === expected), baselineResources.activeCount, { timeout: 60000 });
  await wait(8000);
  const panelAfter = await page.evaluate(() => window.mazz.invoke('memory:capture'));
  const finalResources = await page.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const summary = await page.evaluate(() => window.mazz.invoke('memory:summary', { includeHistory: true }));

  const viewRecovery = recoveryRatio(baseline.totalWorkingSetBytes, viewPeak.totalWorkingSetBytes, viewAfter.totalWorkingSetBytes);
  const panelRecovery = recoveryRatio(viewAfter.totalWorkingSetBytes, panelPeak.totalWorkingSetBytes, panelAfter.totalWorkingSetBytes);
  const result = {
    schema: 'mazz.w67-memory-runtime/v0', generatedAt: new Date().toISOString(),
    platform: process.platform, electron: await page.evaluate(() => window.mazz.versions.electron),
    lifecycle: {
      browserViews: 20, nativePanels: 20,
      baselineActiveResources: baselineResources.activeCount,
      finalActiveResources: finalResources.activeCount,
      resourceConverged: finalResources.activeCount <= baselineResources.activeCount
        && !(finalResources.byType['web-contents-view'] || 0)
        && !(finalResources.byType['panel-window'] || 0),
    },
    workingSetMiB: {
      baseline: mib(baseline.totalWorkingSetBytes),
      browserPeak: mib(viewPeak.totalWorkingSetBytes), browserAfter: mib(viewAfter.totalWorkingSetBytes),
      panelPeak: mib(panelPeak.totalWorkingSetBytes), panelAfter: mib(panelAfter.totalWorkingSetBytes),
    },
    recovery: { browserViews: viewRecovery, nativePanels: panelRecovery, threshold: 0.9 },
    eventLoopMaxLagMs: Math.max(...summary.history.map(row => row.eventLoopLagMs || 0)),
    pressureStates: [...new Set(summary.history.map(row => row.state))],
    samples: summary.history.length,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (!result.lifecycle.resourceConverged) throw new Error('ResourceLedger 未回基线');
  if (viewRecovery < 0.9) throw new Error(`20 WebContentsView 工作集回落率不足：${(viewRecovery * 100).toFixed(1)}%`);
  if (panelRecovery < 0.9) throw new Error(`20 PanelWindow 工作集回落率不足：${(panelRecovery * 100).toFixed(1)}%`);
  console.log(JSON.stringify(result, null, 2));
  console.log('W67 memory runtime: PASS');
} finally {
  if (app) await app.close().catch(() => {});
  await wait(500);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch {}
  try { fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch {}
}
