// W90 catalog thumbnails: real Source Electron gate.
// This deliberately crosses every production boundary that the contract test
// cannot cover: sites:catalog -> mazz-res protocol -> Chromium image decoder ->
// the visible player catalog row.  It requires the live Mikan catalogue.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedFixtures } from './fixtures.mjs';

const ROOT = path.resolve('.');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w90-catalog-user-'));
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w90-catalog-ws-'));
const WORKSPACE_ALT = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w90-catalog-ws2-'));
const rendererErrors = [];
let app;

const assert = (value, message) => { if (!value) throw new Error(message); };

async function closeAgreement(page) {
  const agreement = app.windows().find(candidate => candidate.url().includes('/panels/agreement.html'));
  if (agreement) {
    await agreement.waitForLoadState('domcontentloaded');
    await agreement.locator('#nomore').check().catch(() => {});
    await agreement.locator('#accept').click().catch(() => {});
  }
  await page.evaluate(() => Promise.all([
    window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }),
    window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }),
  ]));
}

try {
  await seedFixtures(WORKSPACE, WORKSPACE_ALT);
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: USER_DATA,
      MAZZ_E2E_WORKSPACE: WORKSPACE,
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => rendererErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!(window.MazzCommands && window.MazzShell), null, { timeout: 20000 });
  await closeAgreement(page);

  const catalog = await page.evaluate(() => window.mazz.invoke('sites:catalog', { site: 'mikan' }));
  assert(catalog.items?.length > 0, 'live sites:catalog returned no Mikan items');
  const first = catalog.items.find(item => /^https:\/\/(?:www\.)?mikan(?:ime\.tv|ani\.me)\//i.test(item.imageUrl || ''));
  assert(first?.imageUrl, `live sites:catalog returned no usable imageUrl; first=${JSON.stringify(catalog.items?.[0])}`);

  const protocolProbe = await page.evaluate(async imageUrl => {
    const url = `mazz-res://catalog/${encodeURIComponent(imageUrl)}`;
    try {
      const response = await fetch(url);
      const bytes = await response.arrayBuffer();
      return { url, status: response.status, type: response.headers.get('content-type'), bytes: bytes.byteLength };
    } catch (error) {
      return { url, error: String(error?.message || error) };
    }
  }, first.imageUrl);
  assert(protocolProbe.status === 200 && /^image\//i.test(protocolProbe.type || '') && protocolProbe.bytes > 0,
    `mazz-res catalog proxy did not return an image: ${JSON.stringify(protocolProbe)}`);

  await page.evaluate(file => window.MazzCommands.execute('file.openPath', { path: file }), path.join(WORKSPACE, '测试音.wav'));
  await page.waitForFunction(() => [...document.querySelectorAll('.mz-player')].some(node => node.getBoundingClientRect().width > 0), null, { timeout: 15000 });
  const listButton = page.locator('.mz-player:visible [data-a="list"]').last();
  await listButton.waitFor({ state: 'visible', timeout: 15000 });
  await listButton.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.mz-src-tab[data-src="web"]')]
    .some(node => node.getBoundingClientRect().width > 0), null, { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('.mz-src-tab[data-src="web"]')]
    .find(node => node.getBoundingClientRect().width > 0)?.click());
  await page.waitForFunction(() => document.querySelectorAll('.mz-catalog-cover img').length > 0, null, { timeout: 40000 });

  const uiProbe = await page.evaluate(async () => {
    const image = [...document.querySelectorAll('.mz-catalog-cover img')]
      .find(node => node.getBoundingClientRect().width > 0);
    if (!image) return { error: 'no visible catalogue image element' };
    let decodeError = '';
    try { await image.decode(); } catch (error) { decodeError = String(error?.message || error); }
    const cover = image.closest('.mz-catalog-cover');
    const fallback = cover?.querySelector('.mz-catalog-fallback');
    return {
      src: image.getAttribute('src'),
      currentSrc: image.currentSrc,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      hasImage: !!cover?.classList.contains('has-image'),
      fallbackVisibility: fallback ? getComputedStyle(fallback).visibility : 'missing',
      decodeError,
    };
  });
  assert(uiProbe.complete && uiProbe.naturalWidth > 0 && uiProbe.naturalHeight > 0,
    `Chromium did not decode the live Mikan thumbnail: ${JSON.stringify(uiProbe)}`);
  assert(uiProbe.hasImage && uiProbe.fallbackVisibility === 'hidden',
    `catalogue UI did not replace its glyph fallback: ${JSON.stringify(uiProbe)}`);
  assert(rendererErrors.length === 0, `renderer errors: ${rendererErrors.join(' | ')}`);

  console.log(`W90 CATALOG THUMBNAILS SOURCE PASS: ${first.title} ${uiProbe.naturalWidth}x${uiProbe.naturalHeight}`);
} catch (error) {
  console.error(`W90 CATALOG THUMBNAILS SOURCE FAIL: ${error.stack || error}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  for (const target of [USER_DATA, WORKSPACE, WORKSPACE_ALT]) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); } catch {}
  }
}
