import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { CliSupervisor } = require('../../main/agent-cli-supervisor.js');
const { ExternalToolService } = require('../../main/external-tool-service.js');
const { ResourceLedger } = require('../../main/resource-ledger.js');
const {
  ADAPTER_ID,
  OPERATION,
  createBlenderHeadlessAdapter,
} = require('../../main/external-tools/blender-headless-adapter.js');

const fixture = path.resolve('tests/fixtures/w79-blender-fixture.mjs');
const scriptPath = path.resolve('resources/tools/blender/mazz_render_frame.py');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w79-'));
  fs.mkdirSync(path.join(root, 'inputs'), { recursive: true });
  const ledger = new ResourceLedger({ historyLimit: 500 });
  const supervisor = new CliSupervisor({
    resourceLedger: ledger,
    resourceType: 'external-tool-process',
    handleOwnerTool: 'external-tool-supervisor',
    forceKillTreeOnTerminate: true,
  });
  const adapter = createBlenderHeadlessAdapter({
    supervisor,
    executablePath: process.execPath,
    commandPrefix: [fixture],
    scriptPath,
    allowedRootsProvider: () => [root],
  });
  return { root, ledger, supervisor, adapter };
}

function request(root, runId, output = `outputs/${runId}.png`) {
  return {
    runId,
    operation: OPERATION,
    workdir: root,
    inputs: [{
      role: 'scene', id: `asset:scene:${runId}`, path: `inputs/${runId}.blend`,
      type: 'application/x-blender', version: `sha256:${runId}`,
    }],
    outputs: [{ role: 'frame', path: output, type: 'image/png' }],
    provenance: { requestedBy: `factory-run:${runId}`, capabilityId: 'render.frame' },
  };
}

function scene(root, runId, behavior = 'SUCCESS') {
  fs.writeFileSync(path.join(root, 'inputs', `${runId}.blend`), behavior);
}

describe('W79 Blender Headless Adapter', () => {
  test('probe 记录真实 executable/version/许可与独立分发边界', async () => {
    const { root, ledger, adapter } = setup();
    try {
      const result = await adapter.probe();
      assert.equal(result.available, true);
      assert.equal(result.adapterId, ADAPTER_ID);
      assert.match(result.version, /Blender 4\.3\.0/);
      assert.equal(result.provenance.license, 'GPL-3.0-or-later');
      assert.equal(result.provenance.bundledWithMazz, false);
      assert.equal(ledger.snapshot().activeCount, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('固定 operation 以资产输入生成验真 PNG 与 SHA-256 身份', async () => {
    const { root, ledger, adapter } = setup();
    try {
      scene(root, 'success');
      const result = await adapter.run(request(root, 'success'));
      assert.equal(result.status, 'succeeded');
      assert.equal(result.exit.code, 0);
      assert.equal(result.outputs.length, 1);
      assert.match(result.outputs[0].id, /^asset:sha256:[0-9a-f]{64}$/);
      assert.equal(result.outputs[0].version, result.outputs[0].id.replace('asset:', ''));
      assert.equal(fs.existsSync(path.join(root, result.outputs[0].path)), true);
      assert.equal(ledger.snapshot().activeCount, 0);
      assert.ok(ledger.snapshot({ includeReleased: true }).released.some(row => row.type === 'external-tool-process'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('拒绝任意 operation、绝对/越界路径、已有输出与错误资产类型，且零 spawn', async () => {
    const { root, ledger, adapter, supervisor } = setup();
    try {
      scene(root, 'guard');
      const base = request(root, 'guard');
      await assert.rejects(() => adapter.run({ ...base, operation: 'shell.exec' }), /operation 不允许/);
      await assert.rejects(() => adapter.run({ ...base, workdir: path.dirname(root) }), /不在允许的工作区根目录/);
      await assert.rejects(() => adapter.run({ ...base, inputs: [{ ...base.inputs[0], path: '../outside.blend' }] }), /越出 workdir/);
      await assert.rejects(() => adapter.run({ ...base, outputs: [{ ...base.outputs[0], path: path.resolve(root, 'x.png') }] }), /必须相对 workdir/);
      await assert.rejects(() => adapter.run({ ...base, inputs: [{ ...base.inputs[0], type: 'text/x-python' }] }), /只接受一个/);
      fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'outputs', 'guard.png'), 'existing');
      await assert.rejects(() => adapter.run(base), /拒绝覆盖已有输出/);
      assert.equal(supervisor.activeCount(), 0);
      assert.equal(ledger.snapshot().activeCount, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('失败保留 partial 证据；取消幂等并收口整棵进程树', async () => {
    const { root, ledger, supervisor, adapter } = setup();
    try {
      scene(root, 'failure', 'PARTIAL_FAIL');
      const failed = await adapter.run(request(root, 'failure'));
      assert.equal(failed.status, 'failed');
      assert.equal(failed.exit.code, 9);
      assert.match(failed.stderr, /FIXTURE_RENDER_FAILED/);
      assert.match(failed.provenance.partialOutputPath, /\.partial-failure$/);
      assert.equal(fs.existsSync(path.join(root, failed.provenance.partialOutputPath)), true);

      scene(root, 'cancel', 'SLEEP');
      const running = adapter.run(request(root, 'cancel'));
      for (let i = 0; i < 200; i += 1) {
        const renderProcess = ledger.snapshot().active.some(row => row.owner === `${ADAPTER_ID}:cancel`);
        if (renderProcess) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(supervisor.activeCount(), 1);
      assert.equal((await adapter.cancel('cancel')).status, 'accepted');
      const cancelled = await running;
      assert.equal(cancelled.status, 'cancelled');
      assert.equal((await adapter.cancel('cancel')).status, 'already-terminal');
      assert.equal((await adapter.cancel('missing')).status, 'not-found');
      assert.equal((await adapter.dispose('test-end')).activeRuns, 0);
      assert.equal(ledger.snapshot().activeCount, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('20 轮成功运行后无活动进程、句柄或 ResourceLedger 累积', async () => {
    const { root, ledger, supervisor, adapter } = setup();
    try {
      for (let i = 0; i < 20; i += 1) {
        const runId = `soak-${i}`;
        scene(root, runId);
        assert.equal((await adapter.run(request(root, runId))).status, 'succeeded');
        assert.equal(supervisor.activeCount(), 0);
      }
      assert.equal((await adapter.dispose('soak-end')).activeRuns, 0);
      assert.equal(ledger.snapshot().activeCount, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('服务只暴露 adapterId + 冻结 request，不接受 command/shell/env', async () => {
    const { root, adapter } = setup();
    const handlers = new Map();
    const service = new ExternalToolService({ bus: { handle: (name, fn) => handlers.set(name, fn) }, adapters: [adapter] });
    try {
      assert.deepEqual([...handlers.keys()].sort(), [
        'externalTool:cancel', 'externalTool:dispose', 'externalTool:list', 'externalTool:probe', 'externalTool:run',
      ]);
      assert.equal(service.list()[0].id, ADAPTER_ID);
      scene(root, 'service');
      const unsafe = { ...request(root, 'service'), command: 'blender --anything' };
      await assert.rejects(() => handlers.get('externalTool:run')({ adapterId: ADAPTER_ID, request: unsafe }), /未冻结字段/);
      assert.throws(() => service.adapter('missing'), /不存在/);
    } finally {
      await service.disposeAll('test-end');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('main/preload/package 接线且 packaged Python 脚本必须解包', () => {
    const main = fs.readFileSync('main/main.js', 'utf8');
    const preload = fs.readFileSync('preload/bridge.js', 'utf8');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.match(main, /new ExternalToolService\(\{/);
    assert.match(main, /resourceType: 'external-tool-process'/);
    assert.match(main, /forceKillTreeOnTerminate: true/);
    assert.match(main, /app\.asar\.unpacked[^\n]+resources[^\n]+tools[^\n]+blender/);
    for (const channel of ['list', 'probe', 'run', 'cancel', 'dispose']) assert.ok(preload.includes(`externalTool:${channel}`));
    assert.ok(pkg.build.asarUnpack.includes('resources/tools/blender/**'));
  });
});
