import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w82h-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w82h-ws-'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W82H_ORGANIZATION_RUNTIME.json');
let app;

try {
  app = await electron.launch({
    args: [root], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'test', MAZZ_E2E_USER_DATA: userData, MAZZ_E2E_WORKSPACE: workspace, MAZZ_GPU_MODE: 'safe' },
  });
  const page = await app.firstWindow({ timeout: 120000 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  await page.waitForFunction(() => !!window.MazzShell && !!window.MazzCommands, null, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' });
    await window.MazzCommands.execute('factory.openOrganization');
  });
  await page.waitForSelector('.org-root [data-a=preview]', { timeout: 30000 });
  await page.locator('[data-f=goal]').fill('制作一个可审计的九十秒动画本地主清单');
  await page.locator('[data-f=template]').selectOption('animation-short');
  await page.locator('[data-f=executor]').selectOption('tool:visual-backup');
  await page.locator('[data-f=budget]').fill('900');
  await page.locator('[data-a=preview]').click();
  await page.waitForFunction(() => document.querySelectorAll('.org-grid article').length === 7);
  const preview = await page.evaluate(() => ({
    title: document.querySelector('.org-preview h3')?.textContent || '',
    seats: document.querySelectorAll('.org-grid article').length,
    gates: [...document.querySelectorAll('.org-columns>div:nth-child(2) .org-row')].map(row => row.textContent),
    boundary: document.querySelector('.org-preview')?.textContent || '',
  }));
  await page.locator('[data-a=save]').click();
  await page.waitForFunction(() => window.mazz.invoke('organization:list').then(rows => rows.length === 1));
  const library = await page.evaluate(() => window.mazz.invoke('organization:list'));
  const resources = await page.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const evidence = {
    schema: 'mazz.w82h-runtime-evidence/v0', ok: true, preview, library,
    pageErrors: errors, resources: { activeCount: resources.activeCount, byType: resources.byType },
    boundaries: { executionStarted: false, publicationAuthorized: false, workflowRuntimeOwnedBy: 'W73' },
  };
  if (!preview.title || preview.seats !== 7 || preview.gates.length !== 4) throw new Error(`组织预览不完整: ${JSON.stringify(preview)}`);
  if (!preview.boundary.includes('运行真相归 W73') || !preview.boundary.includes('未启动执行')) throw new Error('组织预览没有明示运行边界');
  if (library[0]?.status !== 'ACTIVE' || errors.length) throw new Error(`本地库或 renderer 异常: ${JSON.stringify(evidence)}`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, seats: preview.seats, gates: preview.gates.length, library: library.length, pageErrors: errors.length }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
