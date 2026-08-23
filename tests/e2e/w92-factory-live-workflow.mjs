// W92 — opt-in, end-to-end Factory run through the user's encrypted provider.
//
// Unlike the deterministic loopback workflow, this gate proves that the saved
// credential can cross the real project window, durable receipt, Factory
// orchestration, professional review flow, artifact commit, and Desk restore.
// It never logs the key, prompt, response body, endpoint, or copied settings,
// and it never imports the user's real workspace into the isolated profile.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectW92Artifacts } from './w92-evidence-artifacts.mjs';

const root = path.resolve('.');
const executablePath = process.env.MAZZ_E2E_EXECUTABLE ? path.resolve(process.env.MAZZ_E2E_EXECUTABLE) : '';
const coordinate = executablePath ? 'PACKAGED' : 'SOURCE';
const sourceProfile = path.resolve(process.env.MAZZ_E2E_LIVE_PROFILE || path.join(process.env.APPDATA || '', 'Mazz Editor'));
const evidenceDir = path.join(root, 'docs', 'engineering', 'evidence');
const evidencePath = path.join(evidenceDir, `W92_FACTORY_LIVE_WORKFLOW_${coordinate}.json`);
const screenshotPath = path.join(evidenceDir, `W92_FACTORY_LIVE_WORKFLOW_${coordinate}.png`);
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let app = null;
let win = null;
const LIVE_PROJECT_TITLE = 'W92真实链路验收';
const LIVE_BODY = '清晨的风沿着河岸缓慢移动，旧桥下的水面映着灰蓝天色。远处列车穿过树林，站台广播随后响起。街角面包店刚刚开门，玻璃窗里亮起温暖灯光。一个背着帆布包的人停在路口，看完手中的地图，又沿着石板路向北走去。树梢落下几滴昨夜的雨水，城市在钟声里逐渐醒来。';
const LIVE_BODY_CHARS = LIVE_BODY.length;
const LIVE_REVIEW_ANCHOR = '固定验收点如下：\n[必达] live-fixed-body::固定验收正文::清晨的风沿着河岸缓慢移动|城市在钟声里逐渐醒来';
const LIVE_PROJECT_COORDINATES = Object.freeze({
  maxMode: false,
  dualLoop: false,
  autoPreview: false,
  reviewRitual: 'light',
  totalWords: LIVE_BODY_CHARS,
  wordsPerUnit: LIVE_BODY_CHARS,
  maxChapters: 0,
});
const REQUIRED_PROFESSIONAL_ARTIFACTS = Object.freeze([
  '01-骨架与验收点.md',
  '02-扩写稿.md',
  '02b-润色记录.md',
  '03-机检报告.md',
  '04-对点报告.md',
  '05-修订单.md',
  '06-请示单.md',
  '07-审理表.md',
  '08-质询单.md',
  '09-答辩书.md',
  '10-裁决书.md',
  '工件清单.json',
]);
const liveGenre = {
  id: 'w92_live_flow',
  name: '真实链路验收',
  description: '仅用于验证已保存 Provider 的完整创作事务',
  blueprintFamily: 'meta',
  unitName: '节',
  snapshotType: 'expository',
  input_fields: [
    { id: 'title', label: '项目名称', type: 'text', required: true },
    { id: 'task', label: '验收任务', type: 'textarea', required: true },
    // The embedded newline makes the marker an independent project-mantra
    // acceptance row.  It
    // gives the semantic seat the same explicit acceptance owner as the
    // deterministic/template gate instead of asking it to infer one from the
    // short project title.
    { id: 'review_anchor', label: '专业流程验收点', type: 'textarea', required: false },
  ],
  system_prompt: `你正在执行连接验收。正文必须逐字复制以下参考文本，不得添加标题、解释、引号、空行或字数声明：${LIVE_BODY}`,
  output_rules: { format: 'markdown', structure: `固定正文：${LIVE_BODY}` },
  quality_checks: [{ rule: 'contains', value: LIVE_BODY, label: '必须包含完整固定验收正文' }],
};

if (process.env.MAZZ_E2E_ALLOW_LIVE_PROVIDER !== '1') {
  throw new Error('Live Factory workflow is opt-in; set MAZZ_E2E_ALLOW_LIVE_PROVIDER=1');
}
if (!fs.existsSync(path.join(sourceProfile, 'mazz-settings.json'))) {
  throw new Error('Mazz settings profile is unavailable');
}
if (executablePath && !fs.existsSync(executablePath)) throw new Error(`Packaged executable is unavailable: ${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w92-live-flow-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w92-live-flow-ws-'));

try {

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

async function waitFor(predicate, message, timeout = 180000, interval = 200) {
  const until = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < until) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(interval);
  }
  throw new Error(`${message}${lastError ? `（末次：${lastError.message}）` : ''}`);
}

async function readProjectControls(panel) {
  return panel.evaluate(() => {
    const numberValue = selector => Number(document.querySelector(selector)?.value);
    const domTotal = numberValue('#pj-total');
    const domWords = numberValue('#pj-words');
    const snapshot = typeof projectSnapshot === 'object' && projectSnapshot ? projectSnapshot : {};
    const plan = snapshot.lengthPlan || {};
    return {
      dom: {
        maxMode: document.querySelector('#pj-max')?.checked === true,
        dualLoop: document.querySelector('#pj-dual')?.checked === true,
        autoPreview: document.querySelector('#pj-autopreview')?.checked === true,
        reviewRitual: String(document.querySelector('#pj-review-ritual')?.value || ''),
        totalWords: domTotal,
        wordsPerUnit: domWords,
        maxChapters: Number(snapshot.maxChapters),
      },
      authoritative: {
        maxMode: snapshot.maxMode === true,
        dualLoop: snapshot.dualLoop === true,
        autoPreview: snapshot.autoPreview === true,
        reviewRitual: String(snapshot.reviewRitual || ''),
        totalWords: Number(plan.totalWords),
        wordsPerUnit: Number(plan.wordsPerUnit),
        maxChapters: Number(snapshot.maxChapters),
      },
    };
  });
}

function matchesProjectCoordinates(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

async function waitForStableProjectControls(panel, expected, {
  label = '立项控件', timeout = 15000, interval = 250, consecutive = 3,
} = {}) {
  const deadline = Date.now() + timeout;
  let stable = 0;
  let last = null;
  while (Date.now() < deadline) {
    last = await readProjectControls(panel);
    const exact = matchesProjectCoordinates(last.dom, expected)
      && matchesProjectCoordinates(last.authoritative, expected);
    stable = exact ? stable + 1 : 0;
    if (stable >= consecutive) return last;
    await sleep(interval);
  }
  throw new Error(`${label}未连续 ${consecutive} 次保持 DOM/权威快照一致：${JSON.stringify(last)}`);
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
  baseline = null, label = 'Live workflow 资源', timeout = 30000, interval = 250, consecutive = 3,
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

function copyIfPresent(name) {
  const source = path.join(sourceProfile, name);
  if (fs.existsSync(source) && fs.statSync(source).isFile()) fs.copyFileSync(source, path.join(userData, name));
}
const sourceSettingsPath = path.join(sourceProfile, 'mazz-settings.json');
const sourceSettings = JSON.parse(fs.readFileSync(sourceSettingsPath, 'utf8'));
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
fs.writeFileSync(path.join(userData, 'mazz-settings.json'), `${JSON.stringify(isolatedSettings, null, 2)}\n`, 'utf8');
copyIfPresent('Local State');

const genreDir = path.join(workspace, 'factory-genres');
fs.mkdirSync(genreDir, { recursive: true });
fs.writeFileSync(path.join(genreDir, 'live-flow.json'), `${JSON.stringify(liveGenre, null, 2)}\n`, 'utf8');

function stateAt(folder) {
  const file = folder ? path.join(folder, '任务状态.json') : '';
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function filesUnder(folder) {
  const result = [];
  if (!folder || !fs.existsSync(folder)) return result;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else result.push(target);
    }
  };
  walk(folder);
  return result;
}

async function panelWindow() {
  return await waitFor(() => Promise.resolve(app.windows().find(page => /panels[\\/]factorycfg\.html/i.test(page.url())) || null), '真实立项窗未打开', 30000);
}

  const launch = executablePath ? { executablePath } : { args: [root] };
  app = await electron.launch({
    ...launch,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_E2E_DISABLE_GPU: '1',
      MAZZ_GPU_MODE: 'safe',
    },
    timeout: 120000,
  });
  for (const [stream, label] of [[app.process()?.stdout, 'stdout'], [app.process()?.stderr, 'stderr']]) {
    stream?.on?.('data', bytes => {
      const line = String(bytes || '');
      if (/uncaught|unhandled|TypeError|ReferenceError|SyntaxError|fatal error|\[file-watcher\].*(?:degraded|fatal)/i.test(line)) errors.push(`[main ${label}] ${line.slice(0, 500)}`);
    });
  }
  win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => errors.push(`[renderer pageerror] ${error.message}`));
  win.on('console', message => {
    if (message.type() === 'error' && /TypeError|ReferenceError|SyntaxError|uncaught|unhandled/i.test(message.text())) errors.push(`[renderer console] ${message.text().slice(0, 500)}`);
  });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => (
    document.documentElement.dataset.appReady === '1'
    && !!window.mazz
    && !!window.MazzShell
    && !!window.MazzCommands
  ), null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
  });
  for (let index = 0; index < 20; index++) {
    const blocker = await win.evaluate(() => ({
      agreement: !!document.querySelector('#agree-accept')?.offsetParent,
      mask: [...document.querySelectorAll('.mazz-palette-mask')].some(node => node.offsetParent),
    }));
    if (blocker.agreement) await win.click('#agree-accept').catch(() => {});
    else if (blocker.mask) await win.keyboard.press('Escape');
    else break;
    await win.waitForTimeout(100);
  }
  const initialResources = await waitForStableResourceSnapshot(win, { label: 'Live Factory workflow 启动资源' });
  const initialWatcherHealth = assertHealthyFileWatcher(initialResources, '真实链路启动');

  const provider = await win.evaluate(async () => {
    const api = await import('./modules/factory/provider.js');
    const cfg = await api.getProviderConfig();
    if (!api.providerReady(cfg)) throw new Error('本机已保存的 Factory Provider / Key 未就绪');
    return { providerId: String(cfg.providerId || cfg.id || 'configured'), model: String(cfg.model || '') };
  });
  // Register through the product API as well as the fixture file. This proves
  // the active workspace owner and refreshes a FactoryPanel that may have been
  // constructed before the custom-genre directory was observed.
  await win.evaluate(async genre => {
    const engine = await import('./modules/factory/engine.js');
    await engine.saveCustomGenre(genre);
    const panel = await window.MazzShell.whenFactoryPanelReady(15000);
    await panel.reload();
  }, liveGenre);

  const startedAt = Date.now();
  await win.evaluate(() => window.mazz.invoke('panel:open', { kind: 'factorycfg' }));
  const panel = await panelWindow();
  panel.on('pageerror', error => errors.push(`[factorycfg pageerror] ${error.message}`));
  await panel.waitForSelector('#panel-head', { timeout: 30000 });
  if (!(await panel.locator('#pj-form').count())) await panel.locator('[data-t="project"]').first().click();
  await panel.waitForSelector('#pj-form', { timeout: 30000 });
  await panel.waitForFunction(() => [...document.querySelectorAll('#pj-genre option')].some(option => option.value === 'w92_live_flow'), null, { timeout: 30000 });
  await panel.selectOption('#pj-genre', 'w92_live_flow');
  await panel.waitForSelector('[data-p-field="title"]', { timeout: 15000 });
  await panel.waitForSelector('[data-p-field="task"]', { timeout: 15000 });
  // The required acceptance point and the fixed artifact are intentionally the
  // same value.  That lets the real semantic/review seats converge without a
  // contradictory instruction such as "must accurately present this long test
  // sentence" while the artifact is required to contain a shorter phrase.
  await panel.fill('[data-p-field="title"]', LIVE_PROJECT_TITLE);
  await panel.fill('[data-p-field="task"]', LIVE_BODY);
  await panel.fill('[data-p-field="review_anchor"]', LIVE_REVIEW_ANCHOR);
  await panel.fill('#pj-total', String(LIVE_BODY_CHARS));
  await panel.locator('#pj-total').press('Tab');
  await panel.fill('#pj-words', String(LIVE_BODY_CHARS));
  await panel.locator('#pj-words').press('Tab');
  await waitForStableProjectControls(panel, {
    totalWords: LIVE_BODY_CHARS, wordsPerUnit: LIVE_BODY_CHARS, maxChapters: 0,
  }, { label: '单篇字数规格' });

  const advanced = panel.locator('details.advanced');
  if (!(await advanced.evaluate(element => element.open === true))) await advanced.locator('summary').click();
  await panel.waitForSelector('#pj-max', { state: 'visible', timeout: 15000 });
  for (const selector of ['#pj-max', '#pj-dual', '#pj-autopreview']) {
    await panel.uncheck(selector);
    // Playwright's uncheck emits change when it toggles. Dispatching one more
    // real event also covers a setting that was already false, so the main
    // Factory owner receives every intended coordinate before submission.
    await panel.locator(selector).dispatchEvent('change');
  }
  await panel.selectOption('#pj-review-ritual', 'light');
  const submittedProjectControls = await waitForStableProjectControls(panel, LIVE_PROJECT_COORDINATES, {
    label: '单篇立项完整坐标', consecutive: 4,
  });
  assert(
    matchesProjectCoordinates(submittedProjectControls.dom, LIVE_PROJECT_COORDINATES)
      && matchesProjectCoordinates(submittedProjectControls.authoritative, LIVE_PROJECT_COORDINATES),
    `提交前单篇坐标未同时写入 DOM 与权威快照：${JSON.stringify(submittedProjectControls)}`,
  );
  await win.evaluate(() => {
    const factory = window.MazzShell?.sideDock?.factoryPanel;
    if (!factory || typeof factory.runSingleTask !== 'function' || typeof factory.runMaxTask !== 'function') {
      throw new Error('智能创作执行器未就绪，无法建立模式分流诊断');
    }
    if (window.__w92LiveModeDispatchDiagnostic) return;
    const diagnostic = window.__w92LiveModeDispatchDiagnostic = { singleCalls: 0, maxCalls: 0 };
    const runSingleTask = factory.runSingleTask.bind(factory);
    const runMaxTask = factory.runMaxTask.bind(factory);
    factory.runSingleTask = (...args) => {
      diagnostic.singleCalls += 1;
      return runSingleTask(...args);
    };
    factory.runMaxTask = (...args) => {
      diagnostic.maxCalls += 1;
      return runMaxTask(...args);
    };
  });
  await panel.click('#pj-generate');

  const task = await waitFor(async () => {
    const rows = await win.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('mazz.factory.tasks') || '[]'); } catch { return []; }
    });
    return rows.find(row => row.genreId === 'w92_live_flow' && row.folder && row.receiptAt) || null;
  }, '真实 Provider 项目没有建立业务收据', 30000);
  const relativeTaskFolder = path.relative(workspace, task.folder);
  assert(relativeTaskFolder && !path.isAbsolute(relativeTaskFolder) && !relativeTaskFolder.startsWith(`..${path.sep}`) && relativeTaskFolder !== '..', '真实 Provider 项目越过隔离 workspace');
  assert(task.label === LIVE_PROJECT_TITLE && !path.basename(task.folder).includes(LIVE_BODY.slice(0, 12)), '真实 Provider 正文被错误用作项目名或目录名');
  const receiptCoordinates = {
    mode: String(task.mode || ''),
    maxMode: task.mode === 'max',
    dualLoop: task.dualLoop === true,
    autoPreview: task.autoPreview === true,
    reviewRitual: String(task.reviewRitual || ''),
    totalWords: Number(task.totalWords),
    wordsPerUnit: Number(task.wordsPerUnit),
    maxChapters: Number(task.maxChapters),
  };
  assert(receiptCoordinates.mode === 'single' && matchesProjectCoordinates(receiptCoordinates, LIVE_PROJECT_COORDINATES), `持久收据偏离单篇立项坐标：${JSON.stringify(receiptCoordinates)}`);
  await win.evaluate(taskId => {
    const fp = window.MazzShell?.sideDock?.factoryPanel;
    if (!fp || window.__w92LiveAbortDiagnostic) return;
    const diagnostic = window.__w92LiveAbortDiagnostic = {
      taskId,
      attachedAt: Date.now(),
      abortCalls: [],
      stopAllCalls: [],
      disposeCalls: [],
      signalAbort: null,
      snapshots: [],
    };
    const originalAbortTask = fp.abortTask.bind(fp);
    fp.abortTask = (id, reason) => {
      diagnostic.abortCalls.push({ id, reason: String(reason || ''), at: Date.now() });
      return originalAbortTask(id, reason);
    };
    const originalStopAll = fp.requestStopAll.bind(fp);
    fp.requestStopAll = reason => {
      diagnostic.stopAllCalls.push({ reason: String(reason || ''), at: Date.now() });
      return originalStopAll(reason);
    };
    const originalDispose = fp.dispose.bind(fp);
    fp.dispose = () => {
      diagnostic.disposeCalls.push({ at: Date.now() });
      return originalDispose();
    };
    const attachSignal = () => {
      const signal = fp.taskControllers?.get(taskId)?.signal;
      if (!signal || signal.__w92DiagnosticAttached) return;
      signal.__w92DiagnosticAttached = true;
      signal.addEventListener('abort', () => {
        diagnostic.signalAbort = {
          reason: String(signal.reason?.message || signal.reason || ''),
          at: Date.now(),
        };
      }, { once: true });
    };
    attachSignal();
    diagnostic.timer = setInterval(() => {
      attachSignal();
      diagnostic.snapshots.push({
        at: Date.now(),
        disposed: !!fp.disposed,
        stopRequested: !!fp.stopRequested,
        running: fp.runningTasks?.has(taskId) || false,
        queued: fp.backgroundQueuedIds?.has(taskId) || false,
        controller: fp.taskControllers?.has(taskId) || false,
      });
      if (diagnostic.snapshots.length > 40) diagnostic.snapshots.shift();
    }, 250);
  }, task.id);
  await waitFor(() => Promise.resolve(!app.windows().some(page => /factorycfg\.html/i.test(page.url()))), '业务收据成功后立项窗未关闭', 15000);

  const terminal = await waitFor(() => {
    const state = stateAt(task.folder);
    return state && ['done', 'done-warn', 'stopped', 'failed', 'blocked'].includes(state.status) ? state : null;
  }, '真实 Provider 项目没有落到终态', 300000, 500);
  const artifacts = filesUnder(task.folder);
  const names = artifacts.map(file => path.basename(file));
  const terminalCoordinates = {
    mode: String(terminal.mode || ''),
    maxMode: terminal.mode === 'max',
    dualLoop: terminal.dualLoop === true,
    autoPreview: terminal.autoPreview === true,
    totalWords: Number(terminal.totalWords),
    wordsPerUnit: Number(terminal.wordsPerUnit),
    maxChapters: Number(terminal.maxChapters),
    reviewRitual: String(terminal.reviewRitual || ''),
  };
  assert(matchesProjectCoordinates(terminalCoordinates, LIVE_PROJECT_COORDINATES), `磁盘终态偏离单篇立项坐标：${JSON.stringify(terminalCoordinates)}`);
  const checkpointFile = artifacts.find(file => /\.checkpoint$/i.test(file));
  const runtimeAbortDiagnostic = await win.evaluate(() => {
    const value = window.__w92LiveAbortDiagnostic;
    if (!value) return null;
    clearInterval(value.timer);
    return {
      taskId: value.taskId,
      attachedAt: value.attachedAt,
      abortCalls: value.abortCalls,
      stopAllCalls: value.stopAllCalls,
      disposeCalls: value.disposeCalls,
      signalAbort: value.signalAbort,
      snapshots: value.snapshots,
    };
  });
  const runtimeSummary = await win.evaluate(taskId => {
    const fp = window.MazzShell?.sideDock?.factoryPanel;
    const row = fp?.tasks?.find?.(item => item.id === taskId);
    return {
      task: row ? {
        id: row.id, mode: row.mode, maxChapters: row.maxChapters,
        totalWords: row.totalWords, wordsPerUnit: row.wordsPerUnit,
        status: row.status, genreId: row.genreId, reviewProtocol: row.reviewProtocol,
        reviewRitual: row.reviewRitual,
        autoPreview: row.autoPreview, reviewState: row.reviewState,
      } : null,
      logs: [...document.querySelectorAll('.fc-log-line')].slice(-8).map(node => node.textContent || ''),
    };
  }, task.id);
  const stoppedDiagnostics = {
    status: terminal.status,
    checkpointName: checkpointFile ? path.basename(checkpointFile) : '',
    checkpointChars: checkpointFile ? fs.readFileSync(checkpointFile, 'utf8').trim().length : 0,
    finishReason: terminal.unsafeCompletion?.finishReason || null,
    completionKind: terminal.unsafeCompletion?.completionKind || '',
    runtimeAbortDiagnostic,
    runtimeSummary,
    artifactNames: names.slice(0, 40),
  };
  assert(['done', 'done-warn'].includes(terminal.status), `真实 Provider 全链未完成：${JSON.stringify(stoppedDiagnostics)}`);
  const finalFile = artifacts.find(file => /^第0*1节-.*\.md$/i.test(path.basename(file)));
  assert(finalFile, '真实 Provider 全链缺正式正文');
  const body = fs.readFileSync(finalFile, 'utf8').trim();
  assert(body === LIVE_BODY, `真实 Provider 正文未通过固定验收（仅记录长度=${body.length}）`);
  assert(names.includes('任务状态.json'), '真实 Provider 缺少磁盘任务状态');
  const presentProfessionalArtifacts = REQUIRED_PROFESSIONAL_ARTIFACTS.filter(name => names.includes(name));
  assert(presentProfessionalArtifacts.length === REQUIRED_PROFESSIONAL_ARTIFACTS.length, `真实 Provider 专业流程工件不完整：${JSON.stringify({ required: REQUIRED_PROFESSIONAL_ARTIFACTS, present: presentProfessionalArtifacts })}`);
  // Single mode persists both its deterministic project mantra and its
  // one-unit index under legacy-compatible filenames.  Their presence is not
  // evidence that the Provider/max blueprint phase ran: the index must be the
  // exact local single-unit line derived from the durable task receipt.
  const projectMantraArtifactPresent = names.includes('创作蓝图.md');
  const singleUnitOutlineArtifactPresent = names.includes('章节大纲.md');
  assert(projectMantraArtifactPresent === true, '单篇 live 坐标缺少本地项目母版');
  assert(singleUnitOutlineArtifactPresent === true, '单篇 live 坐标缺少本地单元索引');
  const singleUnitOutline = fs.readFileSync(path.join(task.folder, '章节大纲.md'), 'utf8').trim();
  assert(singleUnitOutline === `第1节：${task.label}`, '单篇 live 坐标的本地单元索引不得冒充 Provider 连写大纲');
  assert(!names.some(name => /\.checkpoint$/i.test(name)), '真实 Provider 完成后仍遗留 checkpoint');
  assert(runtimeSummary.task?.mode === 'single' && Number(runtimeSummary.task?.maxChapters) === 0, '终态任务仍携带固定内容单元终点');
  assert(Number(runtimeSummary.task?.totalWords) === LIVE_BODY_CHARS && Number(runtimeSummary.task?.wordsPerUnit) === LIVE_BODY_CHARS, '终态任务偏离 121/121 字数规格');
  const professionalGateStatus = {
    machine: terminal.reviewState?.gates?.machine === true,
    point: terminal.reviewState?.gates?.point === true,
    review: terminal.reviewState?.gates?.review === true,
    objection: terminal.reviewState?.gates?.objection === true,
    sealed: terminal.reviewState?.sealed === true,
  };
  assert(Object.values(professionalGateStatus).every(Boolean), `真实 Provider 专业门未全部打开/封存：${JSON.stringify(professionalGateStatus)}`);
  const modeDispatchDiagnostic = await win.evaluate(() => ({
    singleCalls: Number(window.__w92LiveModeDispatchDiagnostic?.singleCalls || 0),
    maxCalls: Number(window.__w92LiveModeDispatchDiagnostic?.maxCalls || 0),
  }));
  assert(modeDispatchDiagnostic.singleCalls === 1 && modeDispatchDiagnostic.maxCalls === 0, `真实 Provider 执行器偏离单篇分流：${JSON.stringify(modeDispatchDiagnostic)}`);
  const providerMaxBlueprintExpected = receiptCoordinates.mode === 'max';
  assert(providerMaxBlueprintExpected === false, '单篇坐标不得进入 Provider 连写蓝图阶段');

  await win.evaluate(item => window.MazzCommands.execute('factory.openDesk', { taskId: item.id, folder: item.folder, title: `${item.label} · 智能创作台` }), task);
  await win.waitForSelector('.factory-desk', { timeout: 30000 });
  await win.waitForFunction(label => document.querySelector('.factory-desk .fd-task-select')?.textContent.includes(label), task.label, { timeout: 30000 });
  const desk = await win.evaluate(() => ({
    title: document.querySelector('.factory-desk .fd-brand b')?.textContent || '',
    flow: document.querySelector('.factory-desk [data-flow-chain]')?.textContent || '',
    task: document.querySelector('.factory-desk .fd-task-select')?.textContent || '',
  }));
  assert(desk.title === '智能创作台' && /自动校验.*节点验收.*交叉审校.*复核与仲裁.*人工最终审定/.test(desk.flow), '真实 Provider 创作台未显示正式流程');
  assert(desk.task.includes(task.label), '真实 Provider 项目未进入智能创作台');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await win.screenshot({ path: screenshotPath });

  const finalResources = await waitForStableResourceSnapshot(win, { baseline: initialResources, label: 'Live Factory workflow 资源' });
  const finalWatcherHealth = assertHealthyFileWatcher(finalResources, '真实链路结束');
  await app.close();
  app = null;
  win = null;
  await sleep(500);
  assert(errors.length === 0, `真实 Provider 运行异常：${errors.join(' | ')}`);

  const evidenceArtifacts = collectW92Artifacts({ root, executablePath, screenshotPath });
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    coordinate,
    provider: { providerId: provider.providerId, model: provider.model, credentialSource: 'isolated-encrypted-factory-profile', secretDisclosed: false },
    task: {
      taskId: task.id,
      ...receiptCoordinates,
      terminalCoordinates,
      terminalStatus: terminal.status,
      folderName: path.basename(task.folder),
      artifactCount: artifacts.length,
      finalChars: body.length,
    },
    workflow: {
      businessReceipt: true,
      nativeCompletionEvidence: true,
      professionalArtifactsComplete: true,
      requiredProfessionalArtifacts: [...REQUIRED_PROFESSIONAL_ARTIFACTS],
      presentProfessionalArtifacts,
      professionalGates: professionalGateStatus,
      providerMaxBlueprintExpected: false,
      providerMaxBlueprintInvoked: false,
      singleRunnerInvocations: modeDispatchDiagnostic.singleCalls,
      projectMantraArtifactPresent: true,
      singleUnitOutlineArtifactPresent: true,
      singleUnitOutlineMatchesReceipt: true,
      deskVisible: true,
      isolatedWorkspace: true,
      watcherHealth: { initial: initialWatcherHealth, final: finalWatcherHealth },
      runtimeErrors: [],
    },
    elapsedMs: Date.now() - startedAt,
    resources: {
      baseline: { activeCount: initialResources.activeCount, byType: initialResources.byType },
      final: { activeCount: finalResources.activeCount, byType: finalResources.byType },
      retiredCount: initialResources.activeCount - finalResources.activeCount,
      stableNoGrowth: true,
      resourceBoundaryPassed: true,
    },
    screenshot: path.relative(root, screenshotPath).replace(/\\/g, '/'),
    artifacts: evidenceArtifacts,
    bundleSha256: evidenceArtifacts.sourceBundle?.sha256 || null,
    executableSha256: evidenceArtifacts.executable?.sha256 || null,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`W92 live Factory workflow ${coordinate}: PASS (${provider.providerId}/${provider.model}, ${artifacts.length} artifacts)`);
} finally {
  try { await app?.close(); } catch {}
  await sleep(500);
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
