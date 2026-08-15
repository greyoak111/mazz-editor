// tests/e2e/w71-packaged-smoke.mjs —— W71 app-unpacked 真启动与 Foundation IPC 探针
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
if (!fs.existsSync(executablePath)) throw new Error(`app-unpacked 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-ws-'));
fs.writeFileSync(path.join(workspace, 'packaged-smoke.md'), '# packaged smoke\n', 'utf8');

let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' }));
  const result = await win.evaluate(async () => {
    const term = await window.mazz.invoke('term:create', { id: 'w71-packaged-smoke', cols: 40, rows: 8 });
    if (term?.error) throw new Error(term.error);
    const during = await window.mazz.invoke('resources:snapshot');
    await window.mazz.invoke('term:kill', { id: term.id });
    const resources = await window.mazz.invoke('resources:snapshot');
    const adapters = await window.mazz.invoke('harness:adapters');
    const sessions = await window.mazz.invoke('harness:sessions');
    return {
      title: document.title,
      electron: window.mazz.versions.electron,
      resourceVersion: resources.version,
      activeResources: resources.activeCount,
      ptyObserved: during.byType.pty === 1,
      adapters: adapters.length,
      sessions: sessions.length,
    };
  });
  if (!result.title || result.resourceVersion !== 1 || !result.ptyObserved || result.activeResources !== 0 || result.sessions !== 0) {
    throw new Error(`packaged smoke 断言失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
