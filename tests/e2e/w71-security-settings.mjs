// tests/e2e/w71-security-settings.mjs —— SearXNG 安全配置 UI 与 safeStorage 落盘探针
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
if (!fs.existsSync(executablePath)) throw new Error(`app-unpacked 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-security-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-security-ws-'));
const screenshot = path.join(root, 'release', 'w71-searx-security-settings.png');
let app;
try {
  app = await electron.launch({
    executablePath,
    env: { ...process.env, MAZZ_E2E_USER_DATA: userData, MAZZ_E2E_WORKSPACE: workspace, MAZZ_GPU_MODE: 'safe', NODE_ENV: 'test' },
    timeout: 120000,
  });
  const main = await app.firstWindow({ timeout: 120000 });
  await main.waitForLoadState('domcontentloaded');
  await main.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }));
  await main.evaluate(() => window.mazz.invoke('panel:open', { kind: 'settings' }));

  let settings = null;
  const until = Date.now() + 15000;
  while (Date.now() < until && !settings) {
    for (const candidate of app.windows()) {
      if (await candidate.locator('#s-searx-pin').count().catch(() => 0)) { settings = candidate; break; }
    }
    if (!settings) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!settings) throw new Error('设置子窗未出现 TLS 指纹控件');
  const ui = await settings.evaluate(() => {
    const pin = document.querySelector('#s-searx-pin');
    const pass = document.querySelector('#s-searx-pass');
    const rect = pin?.getBoundingClientRect();
    return {
      pinPlaceholder: pin?.getAttribute('placeholder') || '',
      passwordType: pass?.getAttribute('type') || '',
      pinVisible: !!rect && rect.width > 100 && rect.height > 20,
    };
  });
  if (!ui.pinVisible || !ui.pinPlaceholder.includes('SHA-256') || ui.passwordType !== 'password') {
    throw new Error(`SearXNG 安全配置 UI 断言失败：${JSON.stringify(ui)}`);
  }
  await settings.locator('#s-searx-pin').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: screenshot });

  await main.evaluate(() => window.mazz.invoke('searx:setConfig', {
    url: 'https://127.0.0.1:1', user: 'w71-user', pass: 'w71-plain-secret', tlsPin: '',
  }));
  const masked = await main.evaluate(() => window.mazz.invoke('searx:getMaskedConfig'));
  if (!masked?.hasPass) throw new Error('safeStorage 写入后未报告凭据已设置');
  await app.close();
  app = null;

  const settingsFile = path.join(userData, 'mazz-settings.json');
  const raw = fs.readFileSync(settingsFile, 'utf8');
  const stored = JSON.parse(raw).searx || {};
  if (raw.includes('w71-plain-secret') || Object.hasOwn(stored, 'pass') || !stored.passEnc?.data) {
    throw new Error('SearXNG 凭据没有以密文形态落盘');
  }
  console.log(JSON.stringify({ ok: true, screenshot, encrypted: !!stored.passEnc?.enc, ui }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
