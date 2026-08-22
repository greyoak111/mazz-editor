// W92 — opt-in live-provider gate.
//
// This test copies only the user's encrypted Factory provider settings into an isolated profile,
// invokes the configured Factory provider through the product adapter, and
// records only non-sensitive metadata.  It never prints the key, prompt, reply,
// endpoint, or the copied settings payload.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectW92Artifacts } from './w92-evidence-artifacts.mjs';

const root = path.resolve('.');
const packagedExecutable = process.env.MAZZ_E2E_EXECUTABLE
  ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE)
  : '';
const runtime = packagedExecutable ? 'packaged' : 'source';
const sourceProfile = path.resolve(process.env.MAZZ_E2E_LIVE_PROFILE
  || path.join(process.env.APPDATA || '', 'Mazz Editor'));
const settingsFile = path.join(sourceProfile, 'mazz-settings.json');
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence',
  `W92_FACTORY_LIVE_PROVIDER_${runtime.toUpperCase()}.json`);
const fatal = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let app = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertHealthyFileWatcher(snapshot, phase) {
  const watchers = (snapshot?.active || []).filter(entry => entry?.type === 'file-watcher');
  assert(watchers.length === 1, `${phase} file-watcher 数量错误：${watchers.length}`);
  const watcher = watchers[0];
  assert(watcher.state === 'watching', `${phase} file-watcher 未处于 watching：${watcher.state || 'missing'}`);
  return {
    count: watchers.length,
    state: watcher.state,
    rootsCount: Number(watcher.meta?.roots || 0),
    reason: String(watcher.meta?.reason || ''),
  };
}

function stableResourceView(snapshot) {
  const byType = Object.fromEntries(Object.entries(snapshot?.byType || {}).sort(([left], [right]) => left.localeCompare(right)));
  const active = (Array.isArray(snapshot?.active) ? snapshot.active : [])
    .map(entry => ({ key: String(entry?.key || ''), type: String(entry?.type || '') }))
    .sort((left, right) => `${left.type}:${left.key}`.localeCompare(`${right.type}:${right.key}`));
  return { activeCount: Number(snapshot?.activeCount), byType, active };
}

function staysWithinResourceBoundary(snapshot, baseline) {
  const current = stableResourceView(snapshot);
  const initial = stableResourceView(baseline);
  if (!Number.isFinite(current.activeCount) || current.activeCount > initial.activeCount) return false;
  if (current.active.length !== current.activeCount || initial.active.length !== initial.activeCount) return false;
  if (![...current.active, ...initial.active].every(entry => entry.key && entry.type)) return false;
  if (!Object.entries(current.byType).every(([type, count]) => count <= (initial.byType[type] || 0))) return false;
  const baselineIdentities = new Set(initial.active.map(entry => `${entry.type}\u0000${entry.key}`));
  return current.active.every(entry => baselineIdentities.has(`${entry.type}\u0000${entry.key}`));
}

async function waitForStableResourceSnapshot(win, {
  baseline = null, label = 'Live provider 资源', timeout = 30000, interval = 250, consecutive = 3,
} = {}) {
  const deadline = Date.now() + timeout;
  let stableCount = 0;
  let stableSignature = '';
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
    const currentTypes = snapshot?.byType || {};
    const signature = JSON.stringify(stableResourceView(snapshot));
    const factoryIdle = (currentTypes['factory-ai-request'] || 0) === 0
      && (currentTypes['factory-run-owner'] || 0) === 0;
    const boundaryPassed = !baseline || staysWithinResourceBoundary(snapshot, baseline);
    if (factoryIdle && boundaryPassed) {
      stableCount = signature === stableSignature ? stableCount + 1 : 1;
      stableSignature = signature;
    } else {
      stableCount = 0;
      stableSignature = '';
    }
    if (stableCount >= consecutive) return snapshot;
    await sleep(interval);
  }
  throw new Error(`${label}未连续 ${consecutive} 次稳定${baseline ? '收敛于身份基线内' : '形成基线'}：${JSON.stringify({
    baselineActiveCount: baseline?.activeCount,
    activeCount: snapshot?.activeCount,
    byType: snapshot?.byType || {},
  })}`);
}

if (process.env.MAZZ_E2E_ALLOW_LIVE_PROVIDER !== '1') {
  throw new Error('Live provider gate is opt-in; set MAZZ_E2E_ALLOW_LIVE_PROVIDER=1');
}
if (!fs.existsSync(settingsFile)) throw new Error('Mazz settings profile is unavailable');
if (packagedExecutable && !fs.existsSync(packagedExecutable)) {
  throw new Error(`Packaged executable is unavailable: ${packagedExecutable}`);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w92-live-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w92-live-ws-'));

try {

const copyIfPresent = name => {
  const source = path.join(sourceProfile, name);
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    fs.copyFileSync(source, path.join(userData, name));
  }
};

// Never clone the user's workspace, recent files, media state, or other private
// product settings into an E2E profile.  The encrypted Factory values remain
// encrypted at rest and are decrypted only by the product under the same
// Windows user.  Local State supplies Electron's platform encryption metadata.
const sourceSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const factorySecrets = Object.fromEntries(Object.entries(sourceSettings.secrets || {})
  .filter(([key]) => key === 'factory.apiKey' || key === 'factory.providerKey' || key === 'factory.keys'));
const isolatedSettings = {
  workspace,
  workspaces: [{ path: workspace, name: 'W92 Live E2E' }],
  closeBehavior: 'quit',
  'agreement.noMore': true,
  'factory.provider': sourceSettings['factory.provider'],
  'factory.providers': sourceSettings['factory.providers'],
  'factory.routing': sourceSettings['factory.routing'],
  secrets: factorySecrets,
};
fs.writeFileSync(settingsFile.replace(sourceProfile, userData), `${JSON.stringify(isolatedSettings, null, 2)}\n`, 'utf8');
copyIfPresent('Local State');

const isFatalLine = line => /(?:uncaught|unhandled|typeerror|referenceerror|syntaxerror|fatal error|\[file-watcher\].*(?:degraded|fatal))/i.test(line);
const watchProcess = processHandle => {
  for (const [stream, name] of [[processHandle?.stdout, 'stdout'], [processHandle?.stderr, 'stderr']]) {
    stream?.on?.('data', bytes => {
      const line = String(bytes || '');
      if (isFatalLine(line)) fatal.push(`[main ${name}] ${line.slice(0, 500)}`);
    });
  }
};

  const launch = packagedExecutable
    ? { executablePath: packagedExecutable }
    : { args: [root] };
  app = await electron.launch({
    ...launch,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  watchProcess(app.process?.());
  const win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => fatal.push(`[renderer pageerror] ${error.message}`));
  win.on('console', message => {
    if (message.type() === 'error' && isFatalLine(message.text())) {
      fatal.push(`[renderer console] ${message.text().slice(0, 500)}`);
    }
  });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => (
    document.documentElement.dataset.appReady === '1'
    && !!window.mazz
    && !!window.MazzShell
  ), null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
  });
  const baseline = await waitForStableResourceSnapshot(win, { label: 'Live provider 启动资源' });
  const initialWatcherHealth = assertHealthyFileWatcher(baseline, '连通测试启动');
  const startedAt = Date.now();
  const provider = await win.evaluate(async () => {
    const api = await import('./modules/factory/provider.js');
    const cfg = await api.getProviderConfig();
    if (!api.providerReady(cfg)) throw new Error('本地保存的 Factory provider / Key 未就绪');
    const completion = await api.chatDetailed({
      cfg,
      system: '你是连接检测助手。',
      user: '只回复“连接正常”，不要补充其他内容。',
      temperature: 0,
      // Reasoning-capable models may consume an internal budget before they
      // emit final content.  A tiny 24-token cap tests truncation, not provider
      // connectivity, so the live ping owns a bounded but realistic allowance.
      maxTokens: 4096,
    });
    if (completion?.safeToCommit !== true) {
      throw new Error(`真实 Provider 连通请求没有安全终态（finish_reason=${completion?.finishReason || 'missing'}）`);
    }
    const text = String(completion.text || '').trim();
    if (!text) throw new Error('真实 Provider 返回空内容');
    return {
      providerId: String(cfg.providerId || cfg.id || 'configured'),
      model: String(cfg.model || ''),
      responseChars: text.length,
    };
  });
  const finalResources = await waitForStableResourceSnapshot(win, { baseline, label: 'Live provider 连通测试资源' });
  const finalWatcherHealth = assertHealthyFileWatcher(finalResources, '连通测试结束');
  await app.close();
  app = null;
  await sleep(500);
  if (fatal.length) throw new Error(`Live provider gate observed fatal runtime output: ${fatal.join(' | ')}`);

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime,
    provider: {
      providerId: provider.providerId,
      model: provider.model,
      responseChars: provider.responseChars,
      credentialSource: 'isolated-encrypted-factory-profile',
      secretDisclosed: false,
    },
    elapsedMs: Date.now() - startedAt,
    resources: {
      baseline: { activeCount: baseline.activeCount, byType: baseline.byType },
      final: { activeCount: finalResources.activeCount, byType: finalResources.byType },
      retiredCount: baseline.activeCount - finalResources.activeCount,
      stableNoGrowth: true,
      resourceBoundaryPassed: true,
      watcherHealth: { initial: initialWatcherHealth, final: finalWatcherHealth },
    },
    runtimeErrors: [],
    artifacts: collectW92Artifacts({ root, executablePath: packagedExecutable }),
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`W92 live provider ${runtime}: PASS (${provider.providerId}/${provider.model}, ${provider.responseChars} chars)`);
} finally {
  try { await app?.close(); } catch {}
  await sleep(500);
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
