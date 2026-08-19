// W66 第三阶段：packaged 三真实 Adapter 完成/失败/取消、正反 Handoff 与资源收尸
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const rulePackPath = path.resolve(process.env.MAZZ_W66_RULE_PACK
  || 'C:/Users/Administrator/Downloads/交付区/Mazz Editor 开发军规.md');
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W66_REAL_THREE_ADAPTER_ACTIVATION_2026-08-19.json');
const adapters = ['kimi-code', 'claude-code', 'codex'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const required of [executablePath, rulePackPath]) {
  if (!fs.existsSync(required)) throw new Error(`W66 第三阶段前件不存在：${required}`);
}

const artifact = target => ({
  path: target,
  byteLength: fs.statSync(target).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
});
const safeTemp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const cleanupTemp = (target, prefix) => {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`拒绝清理非 W66 临时目录：${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
};
const errorCode = error => String(error?.code || error?.message || error || 'UNKNOWN').split(':')[0].slice(0, 120);

const userPrefix = 'mazz-w66-real-three-user-';
const workspacePrefix = 'mazz-w66-real-three-ws-';
const userData = safeTemp(userPrefix);
const workspace = safeTemp(workspacePrefix);
fs.writeFileSync(path.join(userData, 'mazz-settings.json'), `${JSON.stringify({
  workspace,
  closeBehavior: 'quit',
  'agreement.noMore': true,
  agentRulePackPath: rulePackPath,
}, null, 2)}\n`, 'utf8');

const mainErrors = [];
const rendererErrors = [];
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
    },
    timeout: 120000,
  });
  app.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/uncaught|TypeError|ReferenceError|UnhandledPromiseRejection|FATAL/i.test(text)) mainErrors.push(text.trim());
  });
  const win = await app.firstWindow({ timeout: 120000 });
  win.on('pageerror', error => rendererErrors.push(error.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(() => {
    window.__w66Stage3Events = [];
    window.__w66Stage3EventsOff = window.mazz.on('harness:event', event => window.__w66Stage3Events.push(event));
  });

  const invoke = (channel, payload) => win.evaluate(
    ([name, value]) => window.mazz.invoke(name, value),
    [channel, payload],
  );
  const safely = async (channel, payload) => {
    try { return { fulfilled: true, value: await invoke(channel, payload) }; }
    catch (error) { return { fulfilled: false, error: errorCode(error) }; }
  };
  const eventsFor = sessionId => win.evaluate(
    id => (window.__w66Stage3Events || []).filter(event => event.sessionId === id),
    sessionId,
  );

  await invoke('harness:health');
  await sleep(250);
  const baseline = await invoke('resources:snapshot');
  const waitForBaseline = async (label, activeSessions = 0, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    const expected = baseline.activeCount + activeSessions;
    let snapshot;
    do {
      snapshot = await invoke('resources:snapshot');
      if (snapshot.activeCount === expected && (snapshot.byType['agent-session'] || 0) === activeSessions) return snapshot;
      await sleep(100);
    } while (Date.now() < deadline);
    throw new Error(`${label}：${JSON.stringify({ baseline, expected, snapshot })}`);
  };

  const health = await invoke('harness:health');
  await waitForBaseline('真实健康探测后资源未归零');
  const healthSummary = health.map(row => ({
    adapterId: row.adapterId,
    status: row.status,
    version: String(row.detection?.version || ''),
    auth: String(row.probe?.result?.auth?.status || 'unknown'),
  }));
  const notReady = healthSummary.filter(row => row.status !== 'ready');
  if (healthSummary.length !== 3 || notReady.length) {
    throw new Error(`W66_REAL_AUTH_REQUIRED:${JSON.stringify(notReady)}`);
  }

  const sendMarker = async (session, marker) => {
    const sent = await safely('harness:send', {
      sessionId: session.id,
      input: `只回复精确字符串 ${marker}，不要附加其他内容，不调用工具，不修改文件。`,
    });
    const events = await eventsFor(session.id);
    const eventText = events
      .filter(event => event.type === 'message')
      .map(event => String(event.payload?.text || ''))
      .join('');
    const stdout = String(sent.value?.result?.stdout || '');
    const markerObserved = eventText.includes(marker) || stdout.includes(marker);
    if (!sent.fulfilled || !sent.value?.accepted || !markerObserved) {
      throw new Error(`${session.adapterId} 真实回合失败：${JSON.stringify({ sent, markerObserved, eventTypes: events.map(event => event.type) })}`);
    }
    return {
      adapterId: session.adapterId,
      sessionId: session.id,
      markerObserved,
      eventCount: events.length,
      outputHash: sent.value?.outputReceipt?.hash || '',
      outputByteLength: Number(sent.value?.outputReceipt?.byteLength || 0),
    };
  };

  const runSequence = async (runRef, sequence) => {
    await invoke('harness:createRun', { runRef, taskRef: 'w66-real-three-adapter', workspace });
    let current = await invoke('harness:startRun', {
      runId: runRef,
      adapterId: sequence[0],
      permissionProfileRef: 'restricted',
      instruction: '执行 W66 第三阶段只读激活验收；不得修改任何文件。',
    });
    const turns = [await sendMarker(current.session, `W66_${sequence[0].replace('-', '_').toUpperCase()}_OK_1`)];
    for (let index = 1; index < sequence.length; index += 1) {
      const adapterId = sequence[index];
      current = await invoke('harness:switchRun', {
        runId: runRef,
        toAdapterId: adapterId,
        permissionProfileRef: 'restricted',
        instruction: '接续 W66 第三阶段只读激活验收；不得修改任何文件。',
        snapshot: {
          unresolved: [`continue activation with ${adapterId}`],
          checkpointRef: `checkpoint:${runRef}:${index}`,
          artifactRefs: [`evidence:${runRef}`],
        },
      });
      turns.push(await sendMarker(current.session, `W66_${adapterId.replace('-', '_').toUpperCase()}_OK_${index + 1}`));
    }
    const run = (await invoke('harness:runs')).find(row => row.id === runRef);
    if (run?.attemptNo !== sequence.length
      || new Set(run.attempts.map(row => row.sessionId)).size !== sequence.length
      || run.handoffs.length !== sequence.length - 1) {
      throw new Error(`真实 Handoff 账本不闭：${JSON.stringify(run)}`);
    }
    await invoke('harness:stopRun', { runId: runRef, reason: 'real-sequence-complete' });
    await waitForBaseline(`${runRef} 停止后资源未归零`);
    return {
      runRef,
      sequence,
      attempts: run.attemptNo,
      uniqueSessions: new Set(run.attempts.map(row => row.sessionId)).size,
      handoffs: run.handoffs.length,
      turns,
    };
  };

  const forward = await runSequence('w66-real-forward', ['kimi-code', 'claude-code', 'codex']);
  const reverse = await runSequence('w66-real-reverse', ['codex', 'claude-code', 'kimi-code']);

  const failureResults = [];
  for (const adapterId of adapters) {
    if (adapterId === 'kimi-code') {
      const failed = await safely('harness:createSession', {
        adapterId,
        workspace,
        instruction: '无效 resume 失败收尸探针',
        context: { vendorSessionId: 'mazz-w66-intentionally-missing-session' },
        permissionProfileRef: 'restricted',
      });
      if (failed.fulfilled) {
        await invoke('harness:dispose', { sessionId: failed.value.id, reason: 'unexpected-resume-success' });
        throw new Error('Kimi 无效 resume 未产生预期失败');
      }
      failureResults.push({ adapterId, failureObserved: true, failureCode: failed.error });
    } else {
      const session = await invoke('harness:createSession', {
        adapterId,
        workspace,
        instruction: '无效模型失败收尸探针；不得修改文件。',
        modelTarget: { requestedModel: 'mazz-w66-intentionally-invalid-model' },
        permissionProfileRef: 'restricted',
      });
      const failed = await safely('harness:send', { sessionId: session.id, input: 'FAILURE_PROBE_ONLY' });
      if (failed.fulfilled) {
        await invoke('harness:dispose', { sessionId: session.id, reason: 'unexpected-invalid-model-success' });
        throw new Error(`${adapterId} 无效模型未产生预期失败`);
      }
      await invoke('harness:dispose', { sessionId: session.id, reason: 'expected-failure-complete' });
      failureResults.push({ adapterId, failureObserved: true, failureCode: failed.error });
    }
    await waitForBaseline(`${adapterId} 失败链资源未归零`);
  }

  const cancelResults = [];
  for (const adapterId of adapters) {
    const session = await invoke('harness:createSession', {
      adapterId,
      workspace,
      instruction: '取消探针；只读，不得修改文件。',
      permissionProfileRef: 'restricted',
    });
    await win.evaluate(({ sessionId }) => {
      window.__w66Stage3CancelTurn = window.mazz.invoke('harness:send', {
        sessionId,
        input: '开始进行长篇只读分析，在完成前等待取消；不要修改文件。',
      }).then(value => ({ fulfilled: true, value })).catch(error => ({ fulfilled: false, error: String(error?.code || error?.message || error) }));
    }, { sessionId: session.id });
    await win.waitForFunction(
      id => (window.__w66Stage3Events || []).some(event => event.sessionId === id && event.type === 'state' && event.payload?.state === 'running'),
      session.id,
      { timeout: 10000 },
    );
    const interrupted = await invoke('harness:interrupt', { sessionId: session.id });
    const turn = await win.evaluate(() => window.__w66Stage3CancelTurn);
    if (interrupted.state !== 'cancelled' || turn.fulfilled) {
      throw new Error(`${adapterId} 真实取消语义失败：${JSON.stringify({ interrupted, turn })}`);
    }
    await invoke('harness:dispose', { sessionId: session.id, reason: 'real-cancel-complete' });
    await waitForBaseline(`${adapterId} 取消链资源未归零`);
    cancelResults.push({ adapterId, state: interrupted.state, sendRejected: !turn.fulfilled });
  }

  const finalResources = await invoke('resources:snapshot');
  const sessions = await invoke('harness:sessions');
  if (sessions.length || finalResources.activeCount !== baseline.activeCount || mainErrors.length || rendererErrors.length) {
    throw new Error(`W66 第三阶段收尸/错误账不闭：${JSON.stringify({ sessions, baseline, finalResources, mainErrors, rendererErrors })}`);
  }

  const evidence = {
    schemaVersion: 'mazz.w66-real-three-adapter-activation/v1',
    generatedAt: new Date().toISOString(),
    executablePath,
    rulePackPath,
    artifacts: {
      executable: artifact(executablePath),
      appAsar: artifact(path.join(path.dirname(executablePath), 'resources', 'app.asar')),
    },
    health: healthSummary,
    handoff: { forward, reverse },
    failures: failureResults,
    cancellations: cancelResults,
    resources: { baseline: baseline.activeCount, final: finalResources.activeCount },
    processErrors: { main: mainErrors, renderer: rendererErrors },
    gates: {
      kimiRealActivation: 'PASS',
      claudeRealActivation: 'PASS',
      codexRealActivation: 'PASS',
      realForwardAndReverseHandoff: 'PASS',
      realFailureAndCancel: 'PASS',
      packagedResourceCleanup: 'PASS',
    },
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try { await app?.close(); } catch {}
  cleanupTemp(userData, userPrefix);
  cleanupTemp(workspace, workspacePrefix);
}
