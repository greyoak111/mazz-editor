// W66 第二阶段：packaged 三 Adapter 生命周期、真实健康探测与 Codex 激活
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
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W66_PACKAGED_ACTIVATION_2026-08-19.json');
const fixtureNode = process.execPath;
const kimiFixture = path.join(root, 'tests', 'fixtures', 'fake-acp-agent.cjs');
const streamFixture = path.join(root, 'tests', 'fixtures', 'fake-jsonl-agent.cjs');
const artifact = target => ({
  path: target,
  byteLength: fs.statSync(target).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
});

for (const required of [executablePath, rulePackPath, fixtureNode, kimiFixture, streamFixture]) {
  if (!fs.existsSync(required)) throw new Error(`W66 packaged 前件不存在：${required}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeTemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const cleanupTemp = (target, prefix) => {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`拒绝清理非 W66 临时目录：${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
};
const writeSettings = (userData, workspace) => {
  fs.writeFileSync(path.join(userData, 'mazz-settings.json'), `${JSON.stringify({
    workspace,
    closeBehavior: 'quit',
    'agreement.noMore': true,
    agentRulePackPath: rulePackPath,
  }, null, 2)}\n`, 'utf8');
};

async function launchPhase(name, extraEnv, run) {
  const userPrefix = `mazz-w66-${name}-user-`;
  const workspacePrefix = `mazz-w66-${name}-ws-`;
  const userData = safeTemp(userPrefix);
  const workspace = safeTemp(workspacePrefix);
  writeSettings(userData, workspace);
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
        ...extraEnv,
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
    const value = await run({ app, win, workspace });
    if (mainErrors.length || rendererErrors.length) throw new Error(`${name} 进程错误：${JSON.stringify({ mainErrors, rendererErrors })}`);
    return { ...value, mainErrors, rendererErrors };
  } finally {
    try { await app?.close(); } catch {}
    cleanupTemp(userData, userPrefix);
    cleanupTemp(workspace, workspacePrefix);
  }
}

const fixturePhase = await launchPhase('fixture', {
  MAZZ_E2E_AGENT_NODE: fixtureNode,
  MAZZ_E2E_AGENT_KIMI_FIXTURE: kimiFixture,
  MAZZ_E2E_AGENT_STREAM_FIXTURE: streamFixture,
}, async ({ win, workspace }) => win.evaluate(async ({ workspace: phaseWorkspace }) => {
  const activation = await window.mazz.invoke('harness:activationStatus');
  const health = await window.mazz.invoke('harness:health');
  if (!activation.ready || health.length !== 3 || health.some(row => row.status !== 'ready')) {
    throw new Error(`fixture 激活前件失败：${JSON.stringify({ activation, health })}`);
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  const baseline = await window.mazz.invoke('resources:snapshot');
  const waitForBaseline = async (message) => {
    const until = Date.now() + 10000;
    let snapshot;
    do {
      snapshot = await window.mazz.invoke('resources:snapshot');
      if (snapshot.activeCount === baseline.activeCount) return snapshot;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < until);
    throw new Error(`${message}：${JSON.stringify({ baseline, snapshot })}`);
  };
  const cycles = {};
  for (const adapterId of ['kimi-code', 'claude-code', 'codex']) {
    cycles[adapterId] = 0;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const session = await window.mazz.invoke('harness:createSession', {
        adapterId, workspace: phaseWorkspace, instruction: 'packaged fixture lifecycle', permissionProfileRef: 'restricted',
      });
      const turn = await window.mazz.invoke('harness:send', { sessionId: session.id, input: `cycle-${cycle}` });
      if (!turn?.accepted) throw new Error(`${adapterId} fixture 第 ${cycle + 1} 轮未接受`);
      await window.mazz.invoke('harness:dispose', { sessionId: session.id, reason: 'packaged-fixture-cycle' });
      await waitForBaseline(`${adapterId} fixture 第 ${cycle + 1} 轮资源未归零`);
      cycles[adapterId] += 1;
    }
  }

  const runRef = 'w66-packaged-fixture-handoff';
  await window.mazz.invoke('harness:createRun', { runRef, taskRef: 'w66-packaged', workspace: phaseWorkspace });
  let current = await window.mazz.invoke('harness:startRun', { runId: runRef, adapterId: 'kimi-code', permissionProfileRef: 'restricted' });
  await window.mazz.invoke('harness:send', { sessionId: current.session.id, input: 'kimi' });
  for (const adapterId of ['claude-code', 'codex', 'kimi-code']) {
    current = await window.mazz.invoke('harness:switchRun', {
      runId: runRef, toAdapterId: adapterId, permissionProfileRef: 'restricted',
      snapshot: { unresolved: [`continue with ${adapterId}`], artifactRefs: ['artifact:fixture'] },
    });
    await window.mazz.invoke('harness:send', { sessionId: current.session.id, input: adapterId });
  }
  const beforeStop = (await window.mazz.invoke('harness:runs')).find(row => row.id === runRef);
  await window.mazz.invoke('harness:stopRun', { runId: runRef, reason: 'fixture-complete' });
  const finalResources = await window.mazz.invoke('resources:snapshot');
  const sessions = await window.mazz.invoke('harness:sessions');
  if (beforeStop.attemptNo !== 4 || new Set(beforeStop.attempts.map(row => row.sessionId)).size !== 4
    || beforeStop.handoffs.length !== 3 || sessions.length !== 0 || finalResources.activeCount !== baseline.activeCount) {
    throw new Error(`fixture Handoff/收尸失败：${JSON.stringify({ beforeStop, sessions, finalResources })}`);
  }
  return {
    activationReady: activation.ready,
    health: health.map(row => ({ adapterId: row.adapterId, status: row.status })),
    cycles,
    handoff: { runRef, attempts: beforeStop.attemptNo, uniqueSessions: 4, handoffs: beforeStop.handoffs.length },
    baselineResources: baseline.activeCount,
    finalResources: finalResources.activeCount,
  };
}, { workspace }));

const realPhase = await launchPhase('real', {}, async ({ win, workspace }) => {
  const healthCycles = [];
  await win.evaluate(() => window.mazz.invoke('harness:health'));
  await sleep(250);
  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const waitForBaseline = async (message, expectedActiveSessions = 0) => {
    const until = Date.now() + 10000;
    let snapshot;
    const expectedActiveCount = baseline.activeCount + expectedActiveSessions;
    do {
      snapshot = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
      if (snapshot.activeCount === expectedActiveCount && (snapshot.byType['agent-session'] || 0) === expectedActiveSessions) return snapshot;
      await sleep(50);
    } while (Date.now() < until);
    throw new Error(`${message}：${JSON.stringify({ expectedActiveCount, expectedActiveSessions, baseline, snapshot })}`);
  };
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const health = await win.evaluate(() => window.mazz.invoke('harness:health'));
    await waitForBaseline(`真实健康探测第 ${cycle + 1} 轮资源未归零`);
    healthCycles.push(health.map(row => ({ adapterId: row.adapterId, status: row.status, version: row.detection?.version || '', auth: row.probe?.result?.auth?.status || 'unknown' })));
  }
  const latestHealth = healthCycles.at(-1);
  const codex = latestHealth.find(row => row.adapterId === 'codex');
  const claude = latestHealth.find(row => row.adapterId === 'claude-code');
  const kimi = latestHealth.find(row => row.adapterId === 'kimi-code');
  if (codex?.status !== 'ready' || claude?.status !== 'authentication-required' || kimi?.status !== 'degraded') {
    throw new Error(`真实三家健康态不符：${JSON.stringify(latestHealth)}`);
  }

  const runRef = 'w66-packaged-real-codex';
  await win.evaluate(() => {
    window.__w66PackagedEvents = [];
    window.__w66PackagedEventsOff = window.mazz.on('harness:event', event => window.__w66PackagedEvents.push(event));
  });
  await win.evaluate(({ runRef: id, workspace: ws }) => window.mazz.invoke('harness:createRun', { runRef: id, taskRef: 'w66-real-packaged', workspace: ws }), { runRef, workspace });
  const started = await win.evaluate(id => window.mazz.invoke('harness:startRun', {
    runId: id, adapterId: 'codex', permissionProfileRef: 'restricted',
    instruction: '只执行本次验收回合，不修改任何文件。',
  }), runRef);
  const sent = await win.evaluate(async sessionId => {
    try {
      return { fulfilled: true, value: await window.mazz.invoke('harness:send', {
        sessionId,
        input: '只回复精确字符串 W66_PACKAGED_CODEX_OK，不要附加其他内容。',
      }) };
    } catch (error) { return { fulfilled: false, error: error?.message || String(error) }; }
  }, started.session.id);
  const turnEvents = await win.evaluate(() => window.__w66PackagedEvents || []);
  if (!sent.fulfilled) throw new Error(`packaged Codex send 失败：${JSON.stringify({ sent, turnEvents })}`);
  const turn = sent.value;
  if (!turn?.accepted || !turn?.result?.ok || !turn?.outputReceipt?.complete
    || !String(turn.result.stdout || '').includes('W66_PACKAGED_CODEX_OK')) {
    throw new Error(`packaged Codex 真实回合失败：${JSON.stringify(turn)}`);
  }

  const claudeSession = await win.evaluate(ws => window.mazz.invoke('harness:createSession', {
    adapterId: 'claude-code', workspace: ws, instruction: '认证失败收尸探针', permissionProfileRef: 'restricted',
  }), workspace);
  const claudeFailure = await win.evaluate(async sessionId => {
    try { return { fulfilled: true, value: await window.mazz.invoke('harness:send', { sessionId, input: 'AUTH_PROBE_ONLY' }) }; }
    catch (error) { return { fulfilled: false, error: error?.message || String(error) }; }
  }, claudeSession.id);
  if (claudeFailure.fulfilled) throw new Error(`未登录 Claude 被误判成功：${JSON.stringify(claudeFailure)}`);
  await win.evaluate(sessionId => window.mazz.invoke('harness:dispose', { sessionId, reason: 'unauthenticated-failure-probe' }), claudeSession.id);
  await waitForBaseline('Claude 未认证失败后资源未归零', 1);

  const cancelSession = await win.evaluate(ws => window.mazz.invoke('harness:createSession', {
    adapterId: 'codex', workspace: ws, instruction: '取消探针，不修改文件。', permissionProfileRef: 'restricted',
  }), workspace);
  await win.evaluate(sessionId => {
    window.__w66CancelTurn = window.mazz.invoke('harness:send', {
      sessionId,
      input: '开始分析本规则包，但在收到取消前不要修改任何文件。',
    }).then(value => ({ fulfilled: true, value })).catch(error => ({ fulfilled: false, error: error?.message || String(error) }));
  }, cancelSession.id);
  await win.waitForFunction(() => window.mazz.invoke('resources:snapshot').then(value => (value.byType['agent-cli-process'] || 0) >= 1), null, { timeout: 10000 });
  const interrupted = await win.evaluate(sessionId => window.mazz.invoke('harness:interrupt', { sessionId }), cancelSession.id);
  const cancelTurn = await win.evaluate(() => window.__w66CancelTurn);
  if (interrupted.state !== 'cancelled' || cancelTurn.fulfilled) {
    throw new Error(`packaged Codex 取消语义失败：${JSON.stringify({ interrupted, cancelTurn })}`);
  }
  await win.evaluate(sessionId => window.mazz.invoke('harness:dispose', { sessionId, reason: 'cancel-probe-complete' }), cancelSession.id);
  await waitForBaseline('Codex 取消后资源未归零', 1);

  let recoveryError = '';
  try {
    await win.evaluate(id => window.mazz.invoke('harness:switchRun', {
      runId: id, toAdapterId: 'missing-real-adapter', permissionProfileRef: 'restricted',
      snapshot: { unresolved: ['target adapter unavailable'], checkpointRef: 'checkpoint:packaged-real' },
    }), runRef);
  } catch (error) { recoveryError = error?.message || String(error); }
  const recoveryRun = (await win.evaluate(() => window.mazz.invoke('harness:runs'))).find(row => row.id === runRef);
  if (!recoveryError || recoveryRun.status !== 'recovery-required' || recoveryRun.handoffs.length !== 1 || recoveryRun.currentSessionId) {
    throw new Error(`真实来源 Handoff 失败恢复未闭：${JSON.stringify({ recoveryError, recoveryRun })}`);
  }
  await win.evaluate(id => window.mazz.invoke('harness:stopRun', { runId: id, reason: 'packaged-real-complete' }), runRef);
  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const sessions = await win.evaluate(() => window.mazz.invoke('harness:sessions'));
  if (sessions.length !== 0 || finalResources.activeCount !== baseline.activeCount) {
    throw new Error(`真实 packaged 收尸失败：${JSON.stringify({ sessions, baseline, finalResources })}`);
  }
  return {
    healthProbeCycles: healthCycles.length,
    latestHealth,
    codexTurn: {
      accepted: turn.accepted,
      complete: turn.outputReceipt.complete,
      outputHash: turn.outputReceipt.hash,
      outputByteLength: turn.outputReceipt.byteLength,
      expectedMessageObserved: String(turn.result.stdout || '').includes('W66_PACKAGED_CODEX_OK'),
    },
    claudeUnauthenticatedFailure: { errorObserved: !claudeFailure.fulfilled },
    codexCancel: { state: interrupted.state, sendRejected: !cancelTurn.fulfilled },
    handoffRecovery: { status: recoveryRun.status, handoffs: recoveryRun.handoffs.length, errorObserved: !!recoveryError },
    baselineResources: baseline.activeCount,
    finalResources: finalResources.activeCount,
  };
});

const evidence = {
  schemaVersion: 'mazz.w66-packaged-activation/v1',
  generatedAt: new Date().toISOString(),
  executablePath,
  rulePackPath,
  artifacts: {
    executable: artifact(executablePath),
    appAsar: artifact(path.join(path.dirname(executablePath), 'resources', 'app.asar')),
  },
  fixturePhase,
  realPhase,
  gates: {
    packagedFixtureLifecycle: 'PASS',
    packagedCodexRealTurn: 'PASS',
    kimiRealLogin: 'BLOCKED_USER_AUTH',
    claudeRealLogin: 'BLOCKED_USER_AUTH',
    realCrossVendorHandoff: 'BLOCKED_TARGET_AUTH',
  },
};
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
