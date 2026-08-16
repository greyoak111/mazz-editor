// tests/e2e/w71-factory-faults.mjs —— packaged Factory 慢响应/断网/半包 SSE/renderer crash 真注入
import { _electron as electron } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W71_FACTORY_FAULT_MATRIX.json');
if (!fs.existsSync(executablePath)) throw new Error(`packaged app 不存在：${executablePath}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-factory-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-factory-ws-'));
const state = { observed: new Set(), closed: new Set(), sockets: new Set() };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, message, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(message);
};
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const closeServer = server => new Promise(resolve => server.close(() => resolve()));

const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk.toString('utf8');
  let payload = {};
  try { payload = JSON.parse(body); } catch {}
  const scenario = String(payload.model || 'unknown');
  state.observed.add(scenario);
  response.on('close', () => state.closed.add(scenario));

  if (scenario === 'fault-slow-chat') return;
  if (scenario === 'fault-half-sse') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end('data: {"choices":[{"delta":{"content":"已收到半稿"}}]}\n\n');
    return;
  }
  if (scenario === 'fault-normal-sse') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.write('data: {"choices":[{"delta":{"content":"完整"}}]}\n\n');
    await sleep(20);
    response.end('data: {"choices":[{"delta":{"content":"响应"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    return;
  }
  if (scenario === 'fault-renderer-crash') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.write('data: {"choices":[{"delta":{"content":"崩溃前片段"}}]}\n\n');
    return;
  }
  response.writeHead(400, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { message: `unknown scenario: ${scenario}` } }));
});
server.on('connection', socket => {
  state.sockets.add(socket);
  socket.once('close', () => state.sockets.delete(socket));
});

let app;
let offlinePort;
let serverPort;
try {
  serverPort = await listen(server);
  const offlineProbe = http.createServer();
  offlinePort = await listen(offlineProbe);
  await closeServer(offlineProbe);

  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      MAZZ_E2E_FACTORY_CHAT_TIMEOUT_MS: '600',
      MAZZ_E2E_FACTORY_STREAM_TIMEOUT_MS: '5000',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    window.__w71FactoryChunks = [];
    window.__w71FactoryOff = window.mazz.on('factory:aiChunk', payload => window.__w71FactoryChunks.push(payload));
  });
  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const baseURL = `http://127.0.0.1:${serverPort}`;
  const invokeCaptured = (channel, payload) => win.evaluate(async ({ channel: innerChannel, payload: innerPayload }) => {
    try { return { fulfilled: true, value: await window.mazz.invoke(innerChannel, innerPayload) }; }
    catch (error) { return { fulfilled: false, error: error?.message || String(error) }; }
  }, { channel, payload });
  const waitForResourceBaseline = () => win.waitForFunction(
    activeCount => window.mazz.invoke('resources:snapshot').then(value => value.activeCount === activeCount),
    baseline.activeCount,
    { timeout: 10000 },
  );

  const slowStartedAt = Date.now();
  const slow = await invokeCaptured('factory:aiChat', {
    requestId: 'w71-fault-slow-chat', baseURL, apiKey: 'local-loopback-only', model: 'fault-slow-chat', user: 'timeout',
  });
  const slowElapsedMs = Date.now() - slowStartedAt;
  if (slow.fulfilled || !/超时/.test(slow.error || '')) throw new Error(`慢响应未诚实超时：${JSON.stringify(slow)}`);
  if (slowElapsedMs > 5000) throw new Error(`慢响应超时未受测试上限约束：${slowElapsedMs}ms`);
  await waitFor(() => state.closed.has('fault-slow-chat'), '慢响应超时后回环连接未关闭');
  await waitForResourceBaseline();

  const offline = await invokeCaptured('factory:aiChat', {
    requestId: 'w71-fault-offline-chat', baseURL: `http://127.0.0.1:${offlinePort}`,
    apiKey: 'local-loopback-only', model: 'fault-offline-chat', user: 'offline',
  });
  if (offline.fulfilled || !(offline.error || '').trim()) throw new Error(`断网未返回真实错误：${JSON.stringify(offline)}`);
  await waitForResourceBaseline();

  const halfRequestId = 'w71-fault-half-sse';
  const half = await invokeCaptured('factory:aiChatStream', {
    requestId: halfRequestId, baseURL, apiKey: 'local-loopback-only', model: 'fault-half-sse', user: 'half',
  });
  const halfChunks = await win.evaluate(requestId => window.__w71FactoryChunks.filter(item => item.requestId === requestId), halfRequestId);
  if (half.value?.ok !== false || !halfChunks.some(item => item.delta === '已收到半稿')
    || !halfChunks.some(item => /未收到完成标记/.test(item.error || '')) || halfChunks.some(item => item.done)) {
    throw new Error(`半包 SSE 被误判：${JSON.stringify({ half, halfChunks })}`);
  }
  await waitForResourceBaseline();

  const normalRequestId = 'w71-fault-normal-sse';
  const normal = await invokeCaptured('factory:aiChatStream', {
    requestId: normalRequestId, baseURL, apiKey: 'local-loopback-only', model: 'fault-normal-sse', user: 'normal',
  });
  const normalChunks = await win.evaluate(requestId => window.__w71FactoryChunks.filter(item => item.requestId === requestId), normalRequestId);
  const normalText = normalChunks.map(item => item.delta || '').join('');
  if (normal.value?.ok !== true || normalText !== '完整响应' || !normalChunks.some(item => item.done)
    || normalChunks.some(item => item.error)) {
    throw new Error(`正常 SSE 回归失败：${JSON.stringify({ normal, normalChunks })}`);
  }
  await waitForResourceBaseline();

  const crashRequestId = 'w71-fault-renderer-crash';
  const crashInvocation = win.evaluate(({ requestId, endpoint }) => window.mazz.invoke('factory:aiChatStream', {
    requestId, baseURL: endpoint, apiKey: 'local-loopback-only', model: 'fault-renderer-crash', user: 'crash',
  }), { requestId: crashRequestId, endpoint: baseURL });
  await waitFor(() => state.observed.has('fault-renderer-crash'), 'renderer crash 流未抵达回环服务器');
  const beforeCrash = await waitFor(
    () => app.evaluate(() => globalThis.__MAZZ_E2E_FACTORY_AI_REQUESTS__?.snapshot())
      .then(records => records?.length === 1 ? records : null),
    'renderer crash 前 Factory 请求未进入主进程注册表',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await crashInvocation.catch(() => null);
  const afterCrash = await waitFor(
    () => app.evaluate(() => globalThis.__MAZZ_E2E_FACTORY_AI_REQUESTS__?.snapshot())
      .then(records => records?.length === 0 ? records : null),
    'renderer crash 后 Factory owner 未收尸',
  );
  await waitFor(() => state.closed.has('fault-renderer-crash'), 'renderer crash 后网络流未关闭');
  const rendererRecovered = await waitFor(
    () => app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      return target && !target.isDestroyed() && !target.webContents.isCrashed()
        && !target.webContents.isLoading() ? true : false;
    }),
    'renderer crash 后主窗未恢复',
    15000,
  );
  const recoveredResources = await app.evaluate(() => globalThis.__MAZZ_E2E_RESOURCE_LEDGER__?.snapshot());
  if (recoveredResources.activeCount !== baseline.activeCount) {
    throw new Error(`renderer crash 恢复后资源未回基线：${recoveredResources.activeCount}/${baseline.activeCount}`);
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    executablePath,
    network: { transport: 'real-loopback-http', host: '127.0.0.1', thirdPartyProviderUsed: false },
    baselineResources: baseline.activeCount,
    slowResponse: {
      requestObserved: state.observed.has('fault-slow-chat'), fulfilled: slow.fulfilled,
      errorClass: /超时/.test(slow.error || '') ? 'timeout' : 'unexpected', elapsedMs: slowElapsedMs,
    },
    offline: { fulfilled: offline.fulfilled, errorObserved: !!(offline.error || '').trim() },
    halfSse: {
      requestObserved: state.observed.has('fault-half-sse'), partialDeltaObserved: halfChunks.some(item => !!item.delta),
      errorObserved: halfChunks.some(item => !!item.error), doneObserved: halfChunks.some(item => !!item.done),
      invokeOk: half.value?.ok ?? null,
    },
    normalSse: { text: normalText, doneObserved: normalChunks.some(item => !!item.done), invokeOk: normal.value?.ok ?? null },
    rendererCrash: {
      requestObserved: state.observed.has('fault-renderer-crash'), registryBefore: beforeCrash.length,
      registryAfter: afterCrash.length, socketClosed: state.closed.has('fault-renderer-crash'), rendererRecovered,
      activeResourcesAfterRecovery: recoveredResources.activeCount,
    },
    finalFactoryRegistry: await app.evaluate(() => globalThis.__MAZZ_E2E_FACTORY_AI_REQUESTS__?.snapshot() || []),
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  for (const socket of state.sockets) socket.destroy();
  try { await closeServer(server); } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
