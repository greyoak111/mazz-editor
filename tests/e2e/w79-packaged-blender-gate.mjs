// W79：packaged Blender 条件探测 + 固定 fixture 成功/失败/取消/20 轮收敛
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.resolve(process.env.MAZZ_E2E_EXECUTABLE
  || path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe'));
const evidencePath = path.join(root, 'docs', 'engineering', 'evidence', 'W79_PACKAGED_BLENDER_GATE_2026-08-19.json');
const fixtureNode = process.execPath;
const fixture = path.join(root, 'tests', 'fixtures', 'w79-blender-fixture.mjs');
const unpackedScript = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'resources', 'tools', 'blender', 'mazz_render_frame.py');
const adapterId = 'blender.headless.v0';
const operation = 'scene.render.frame/v0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const required of [executablePath, fixtureNode, fixture, unpackedScript]) {
  if (!fs.existsSync(required)) throw new Error(`W79 packaged 前件不存在：${required}`);
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
    throw new Error(`拒绝清理非 W79 临时目录：${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
};

async function launchPhase(name, extraEnv, run) {
  const userPrefix = `mazz-w79-${name}-user-`;
  const workspacePrefix = `mazz-w79-${name}-ws-`;
  const userData = safeTemp(userPrefix);
  const workspace = safeTemp(workspacePrefix);
  fs.writeFileSync(path.join(userData, 'mazz-settings.json'), `${JSON.stringify({
    workspace,
    closeBehavior: 'quit',
    'agreement.noMore': true,
  }, null, 2)}\n`, 'utf8');
  const mainErrors = [];
  const rendererErrors = [];
  let app;
  try {
    console.log(`[w79] ${name}: launch`);
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
    await win.waitForFunction(() => window.mazz.invoke('resources:snapshot').then(snapshot =>
      (snapshot.byType['agent-cli-process'] || 0) === 0
      && (snapshot.byType['external-tool-process'] || 0) === 0), null, { timeout: 30000 });
    await sleep(200);
    console.log(`[w79] ${name}: ready`);
    const value = await run({ win, workspace });
    console.log(`[w79] ${name}: gate complete`);
    if (mainErrors.length || rendererErrors.length) throw new Error(`${name} 进程错误：${JSON.stringify({ mainErrors, rendererErrors })}`);
    return { ...value, mainErrors, rendererErrors };
  } finally {
    console.log(`[w79] ${name}: closing`);
    try { await app?.close(); } catch {}
    console.log(`[w79] ${name}: closed`);
    cleanupTemp(userData, userPrefix);
    cleanupTemp(workspace, workspacePrefix);
  }
}

const realUnavailable = await launchPhase('real', {}, async ({ win, workspace }) => {
  const inputs = path.join(workspace, 'inputs');
  fs.mkdirSync(inputs, { recursive: true });
  fs.writeFileSync(path.join(inputs, 'real.blend'), 'REAL_TOOL_UNAVAILABLE_PROBE');
  const invoke = (channel, payload) => win.evaluate(([name, value]) => window.mazz.invoke(name, value), [channel, payload]);
  const list = await invoke('externalTool:list');
  const baseline = await invoke('resources:snapshot');
  const probe = await invoke('externalTool:probe', { adapterId });
  const afterProbe = await invoke('resources:snapshot');
  if (list.length !== 1 || list[0].id !== adapterId || probe.available || probe.reason !== 'BLENDER_NOT_INSTALLED') {
    throw new Error(`本机 Blender 条件探测不符：${JSON.stringify({ list, probe })}`);
  }
  const result = await invoke('externalTool:run', {
    adapterId,
    request: {
      runId: 'real-unavailable', operation, workdir: workspace,
      inputs: [{ role: 'scene', id: 'asset:scene:real', path: 'inputs/real.blend', type: 'application/x-blender', version: 'sha256:real' }],
      outputs: [{ role: 'frame', path: 'outputs/real.png', type: 'image/png' }],
      provenance: { requestedBy: 'w79-packaged-real', capabilityId: 'render.frame' },
    },
  });
  const final = await invoke('resources:snapshot');
  if (result.status !== 'failed' || result.exit.reason !== 'BLENDER_NOT_INSTALLED'
    || fs.existsSync(path.join(workspace, 'outputs'))
    || (baseline.byType['external-tool-process'] || 0) !== 0
    || (afterProbe.byType['external-tool-process'] || 0) !== 0
    || (final.byType['external-tool-process'] || 0) !== 0) {
    throw new Error(`本机未安装降级不闭合：${JSON.stringify({ baseline, afterProbe, result, final })}`);
  }
  return {
    list, probe, result,
    resources: {
      externalBaseline: baseline.byType['external-tool-process'] || 0,
      externalFinal: final.byType['external-tool-process'] || 0,
      hostBaselineTotal: baseline.activeCount,
      hostFinalTotal: final.activeCount,
    },
  };
});

const fixturePhase = await launchPhase('fixture', {
  MAZZ_E2E_BLENDER_NODE: fixtureNode,
  MAZZ_E2E_BLENDER_FIXTURE: fixture,
}, async ({ win, workspace }) => {
  const inputs = path.join(workspace, 'inputs');
  fs.mkdirSync(inputs, { recursive: true });
  for (let i = 0; i < 20; i += 1) fs.writeFileSync(path.join(inputs, `cycle-${i}.blend`), 'SUCCESS');
  fs.writeFileSync(path.join(inputs, 'failure.blend'), 'PARTIAL_FAIL');
  fs.writeFileSync(path.join(inputs, 'cancel.blend'), 'SLEEP');
  const invoke = (channel, payload) => win.evaluate(([name, value]) => window.mazz.invoke(name, value), [channel, payload]);
  const makeRequest = (runId, output = `outputs/${runId}.png`) => ({
    runId, operation, workdir: workspace,
    inputs: [{ role: 'scene', id: `asset:scene:${runId}`, path: `inputs/${runId}.blend`, type: 'application/x-blender', version: `sha256:${runId}` }],
    outputs: [{ role: 'frame', path: output, type: 'image/png' }],
    provenance: { requestedBy: `w79-packaged:${runId}`, capabilityId: 'render.frame' },
  });

  const probe = await invoke('externalTool:probe', { adapterId });
  if (!probe.available || !/Blender 4\.3\.0/.test(probe.version)) throw new Error(`fixture probe 失败：${JSON.stringify(probe)}`);
  const baseline = await invoke('resources:snapshot');
  const cycles = [];
  for (let i = 0; i < 20; i += 1) {
    const runId = `cycle-${i}`;
    const result = await invoke('externalTool:run', { adapterId, request: makeRequest(runId) });
    const snapshot = await invoke('resources:snapshot');
    if (result.status !== 'succeeded' || result.outputs.length !== 1
      || (snapshot.byType['external-tool-process'] || 0) !== 0) {
      throw new Error(`fixture 第 ${i + 1} 轮未收敛：${JSON.stringify({ result, baseline, snapshot })}`);
    }
    cycles.push({ runId, status: result.status, assetId: result.outputs[0].id });
  }

  const failed = await invoke('externalTool:run', { adapterId, request: makeRequest('failure') });
  if (failed.status !== 'failed' || failed.exit.code !== 9 || !/\.partial-failure$/.test(failed.provenance.partialOutputPath)) {
    throw new Error(`fixture 失败链不闭合：${JSON.stringify(failed)}`);
  }

  const cancellation = await win.evaluate(async ([id, request]) => {
    const running = window.mazz.invoke('externalTool:run', { adapterId: id, request })
      .then(value => ({ fulfilled: true, value }))
      .catch(error => ({ fulfilled: false, error: error?.message || String(error) }));
    let first = null;
    for (let i = 0; i < 100; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
      first = await window.mazz.invoke('externalTool:cancel', { adapterId: id, runId: request.runId });
      if (first.status === 'accepted' || first.status === 'already-terminal') break;
    }
    const terminal = await running;
    const repeated = await window.mazz.invoke('externalTool:cancel', { adapterId: id, runId: request.runId });
    return { first, terminal, repeated };
  }, [adapterId, makeRequest('cancel')]);
  if (cancellation.first?.status !== 'accepted' || !cancellation.terminal.fulfilled
    || cancellation.terminal.value.status !== 'cancelled' || cancellation.repeated.status !== 'already-terminal') {
    throw new Error(`fixture 取消链不闭合：${JSON.stringify(cancellation)}`);
  }
  await invoke('externalTool:dispose', { adapterId, reason: 'packaged-gate-complete' });
  await sleep(100);
  const final = await invoke('resources:snapshot');
  if ((final.byType['external-tool-process'] || 0) !== 0) {
    throw new Error(`fixture 最终资源未归零：${JSON.stringify({ baseline, final })}`);
  }
  return {
    probe,
    cycles: cycles.length,
    firstOutput: cycles[0],
    failure: { status: failed.status, exitCode: failed.exit.code, partialOutputPath: failed.provenance.partialOutputPath },
    cancellation: {
      first: cancellation.first.status,
      terminal: cancellation.terminal.value.status,
      repeated: cancellation.repeated.status,
    },
    resources: {
      externalBaseline: baseline.byType['external-tool-process'] || 0,
      externalFinal: final.byType['external-tool-process'] || 0,
      hostBaselineTotal: baseline.activeCount,
      hostFinalTotal: final.activeCount,
    },
  };
});

const evidence = {
  schemaVersion: 'mazz.w79-packaged-blender-gate/v0',
  generatedAt: new Date().toISOString(),
  artifacts: {
    executable: artifact(executablePath),
    appAsar: artifact(path.join(path.dirname(executablePath), 'resources', 'app.asar')),
    adapterScript: artifact(unpackedScript),
  },
  hostToolActivation: {
    status: 'ACTIVATION_BLOCKED_TOOL_NOT_INSTALLED',
    probe: realUnavailable.probe,
    structuredFailure: realUnavailable.result,
    resources: realUnavailable.resources,
  },
  packagedFixtureGate: fixturePhase,
  gates: {
    protocolAndRuntime: 'PASS',
    packagedSuccessFailureCancel: 'PASS',
    packagedTwentyCycleCleanup: 'PASS',
    realBlenderActivation: 'BLOCKED_TOOL_NOT_INSTALLED',
  },
};
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
