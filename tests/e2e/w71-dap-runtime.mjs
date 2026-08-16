// tests/e2e/w71-dap-runtime.mjs —— packaged debugpy DAP 真握手/断点/20 轮生命周期
import { _electron as electron } from 'playwright';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const debugpySite = path.resolve(process.env.MAZZ_E2E_DEBUGPY_SITE || '');
const debugpyWheel = process.env.MAZZ_E2E_DEBUGPY_WHEEL
  ? path.resolve(process.env.MAZZ_E2E_DEBUGPY_WHEEL) : '';
const pythonPath = process.env.MAZZ_E2E_PYTHON || 'python';
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_DAP_RUNTIME.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);
if (!process.env.MAZZ_E2E_DEBUGPY_SITE || !fs.existsSync(debugpySite)) {
  throw new Error('必须通过 MAZZ_E2E_DEBUGPY_SITE 指向隔离安装的固定 debugpy');
}

const probe = spawnSync(pythonPath, ['-c', 'import debugpy,sys; print(debugpy.__version__); print(sys.version.split()[0])'], {
  encoding: 'utf8', env: { ...process.env, PYTHONPATH: debugpySite }, windowsHide: true,
});
if (probe.status !== 0) throw new Error(`debugpy 探测失败：${probe.stderr || probe.stdout}`);
const [debugpyVersion, pythonVersion] = probe.stdout.trim().split(/\r?\n/);
const wheelSha256 = debugpyWheel && fs.existsSync(debugpyWheel)
  ? crypto.createHash('sha256').update(fs.readFileSync(debugpyWheel)).digest('hex').toUpperCase()
  : '';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-dap-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-dap-ws-'));
const programPath = path.join(workspace, 'w71-dap-runtime.py');
const programResultPath = path.join(workspace, 'w71-dap-result.txt');
fs.writeFileSync(programPath, [
  'def add(a, b):',
  '    s = a + b',
  '    return s',
  'from pathlib import Path',
  'result = add(2, 3)',
  `Path(${JSON.stringify(programResultPath)}).write_text(str(result), encoding="utf-8")`,
  'print("W71_DAP_RESULT", result, flush=True)',
].join('\n') + '\n', 'utf8');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForDebugInactive = async (win, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const status = await win.evaluate(() => window.mazz.invoke('debug:status'));
    if (!status.active) return;
    await sleep(50);
  }
  throw new Error('等待 DAP 会话终止超时');
};
const waitForResourceCount = async (win, expected, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const snapshot = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
    if (snapshot.activeCount === expected) return snapshot;
    await sleep(50);
  }
  throw new Error(`等待资源回到 ${expected} 超时`);
};
let app;
try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      PYTHONPATH: debugpySite,
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
    window.__w71DapEvents = [];
    window.__w71DapOff = window.mazz.on('debug:event', event => {
      window.__w71DapEvents.push({ ...event, observedAt: Date.now() });
    });
  });

  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot', { includeReleased: true }));
  const startedAt = Date.now();
  const started = await win.evaluate(({ programPath, pythonPath }) => window.mazz.invoke('debug:start', {
    type: 'python', program: programPath, cwd: programPath.replace(/[\\/][^\\/]+$/, ''),
    pythonPath, stopOnEntry: false,
  }), { programPath, pythonPath });
  const startMs = Date.now() - startedAt;
  if (!started.ok) throw new Error(`真实 debugpy 启动失败：${JSON.stringify(started)}`);
  const during = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  if (during.byType['debug-process'] !== 1) throw new Error(`DAP 未进入资源账：${JSON.stringify(during.byType)}`);

  const breakpoints = await win.evaluate(({ programPath }) => window.mazz.invoke('debug:request', {
    command: 'setBreakpoints', args: { source: { path: programPath }, breakpoints: [{ line: 2 }] },
  }), { programPath });
  if (breakpoints.error || !breakpoints.body?.breakpoints?.[0]?.verified) {
    throw new Error(`真实断点未验证：${JSON.stringify(breakpoints)}`);
  }
  const configured = await win.evaluate(() => window.mazz.invoke('debug:request', { command: 'configurationDone', args: {} }));
  if (configured.error) throw new Error(`configurationDone 失败：${configured.error}`);
  await win.waitForFunction(() => window.__w71DapEvents.some(item => item.channel === 'dapEvent'
    && item.event === 'stopped'), null, { timeout: 20000 });
  const stopped = await win.evaluate(() => window.__w71DapEvents.find(item => item.channel === 'dapEvent'
    && item.event === 'stopped'));
  const threadId = stopped.body.threadId;
  const stack = await win.evaluate(threadId => window.mazz.invoke('debug:request', {
    command: 'stackTrace', args: { threadId, startFrame: 0, levels: 10 },
  }), threadId);
  const top = stack.body?.stackFrames?.[0];
  if (!top || top.line !== 2) throw new Error(`断点调用栈异常：${JSON.stringify(stack)}`);
  const scopes = await win.evaluate(frameId => window.mazz.invoke('debug:request', {
    command: 'scopes', args: { frameId },
  }), top.id);
  const localsScope = scopes.body?.scopes?.find(item => /local/i.test(item.name));
  if (!localsScope) throw new Error(`没有 Locals scope：${JSON.stringify(scopes)}`);
  const variables = await win.evaluate(reference => window.mazz.invoke('debug:request', {
    command: 'variables', args: { variablesReference: reference },
  }), localsScope.variablesReference);
  const locals = Object.fromEntries((variables.body?.variables || []).map(item => [item.name, item.value]));
  if (locals.a !== '2' || locals.b !== '3') throw new Error(`断点变量异常：${JSON.stringify(locals)}`);

  const continued = await win.evaluate(threadId => window.mazz.invoke('debug:request', {
    command: 'continue', args: { threadId },
  }), threadId);
  if (continued.error) throw new Error(`继续执行失败：${continued.error}`);
  const resultUntil = Date.now() + 20000;
  while (Date.now() < resultUntil && !fs.existsSync(programResultPath)) await sleep(50);
  if (!fs.existsSync(programResultPath) || fs.readFileSync(programResultPath, 'utf8') !== '5') {
    const events = await win.evaluate(() => window.__w71DapEvents);
    throw new Error(`继续执行后没有真实结果文件：${JSON.stringify(events.slice(-12))}`);
  }
  await waitForDebugInactive(win);

  const cycleDurationsMs = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const cycleStartedAt = Date.now();
    const result = await win.evaluate(({ programPath, pythonPath }) => window.mazz.invoke('debug:start', {
      type: 'python', program: programPath, cwd: programPath.replace(/[\\/][^\\/]+$/, ''),
      pythonPath, stopOnEntry: false,
    }), { programPath, pythonPath });
    if (!result.ok) throw new Error(`DAP 第 ${cycle + 1} 轮启动失败：${JSON.stringify(result)}`);
    const emptyBreakpoints = await win.evaluate(({ programPath }) => window.mazz.invoke('debug:request', {
      command: 'setBreakpoints', args: { source: { path: programPath }, breakpoints: [] },
    }), { programPath });
    if (emptyBreakpoints.error) throw new Error(`DAP 第 ${cycle + 1} 轮清断点失败：${emptyBreakpoints.error}`);
    const done = await win.evaluate(() => window.mazz.invoke('debug:request', { command: 'configurationDone', args: {} }));
    if (done.error) throw new Error(`DAP 第 ${cycle + 1} 轮 configurationDone 失败：${done.error}`);
    await waitForDebugInactive(win);
    cycleDurationsMs.push(Date.now() - cycleStartedAt);
  }
  await waitForResourceCount(win, baseline.activeCount);
  await sleep(500);
  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot', { includeReleased: true }));
  const eventSummary = await win.evaluate(() => {
    const counts = {};
    for (const item of window.__w71DapEvents) {
      const key = item.channel === 'dapEvent' ? item.event : item.channel;
      counts[key] = (counts[key] || 0) + 1;
    }
    window.__w71DapOff?.();
    return counts;
  });
  const releasedDebug = finalResources.released.filter(item => item.type === 'debug-process');
  if (finalResources.activeCount !== baseline.activeCount || releasedDebug.length < 21) {
    throw new Error(`DAP 资源未收敛：${JSON.stringify({ baseline: baseline.activeCount, final: finalResources.activeCount, byType: finalResources.byType, active: finalResources.active, released: releasedDebug.length })}`);
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    adapter: {
      name: 'debugpy', version: debugpyVersion, pythonVersion, pythonPath,
      site: debugpySite, wheel: debugpyWheel || null, wheelSha256: wheelSha256 || null,
    },
    fullSession: {
      startMs, breakpointVerified: true, stoppedLine: top.line,
      stackFrames: stack.body.stackFrames.length, locals: { a: locals.a, b: locals.b, s: locals.s },
      programResult: fs.readFileSync(programResultPath, 'utf8'),
      outputEventObserved: !!eventSummary.output,
    },
    lifecycle: {
      cycles: cycleDurationsMs.length,
      minMs: Math.min(...cycleDurationsMs), maxMs: Math.max(...cycleDurationsMs),
      averageMs: Math.round(cycleDurationsMs.reduce((sum, value) => sum + value, 0) / cycleDurationsMs.length),
      releasedDebugProcesses: releasedDebug.length,
      baselineResources: baseline.activeCount,
      finalResources: finalResources.activeCount,
    },
    events: eventSummary,
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
