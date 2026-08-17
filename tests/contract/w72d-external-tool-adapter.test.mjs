import { createRequire } from 'node:module';
import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  EXTERNAL_TOOL_ADAPTER_PROTOCOL,
  EXTERNAL_TOOL_CANCEL_RESULT_SCHEMA,
  EXTERNAL_TOOL_DISPOSE_RESULT_SCHEMA,
  EXTERNAL_TOOL_PROBE_SCHEMA,
  EXTERNAL_TOOL_RUN_REQUEST_SCHEMA,
  EXTERNAL_TOOL_RUN_RESULT_SCHEMA,
  defineExternalToolAdapter,
  normalizeExternalToolCancelResult,
  normalizeExternalToolDisposeResult,
  normalizeExternalToolProbe,
  normalizeExternalToolRunRequest,
  normalizeExternalToolRunResult,
} = require('../../main/foundation/external-tool-adapter.js');

const provenance = { kind: 'external', project: 'specimen-tool', version: '1.2.3', license: 'external-terms' };

function request() {
  return {
    runId: 'run-001',
    operation: 'scene.render.frame',
    workdir: 'D:/workspace/.mazz/runs/run-001',
    inputs: [
      { role: 'scene', id: 'asset:scene:001', path: 'inputs/scene.project', type: 'model/scene', version: 'sha256:aaa' },
      { role: 'task', id: 'asset:task:001', path: 'inputs/task.json', type: 'application/json', version: 'sha256:bbb' },
    ],
    outputs: [{ role: 'frame', path: 'outputs/frame.png', type: 'image/png' }],
    provenance: { requestedBy: 'factory-run:001', capabilityId: 'render.frame' },
  };
}

describe('W72d External Tool Adapter protocol', () => {
  test('Adapter 只冻结 probe/run/cancel/dispose，不吞并 Harness 或 Capability Registry', () => {
    const adapter = defineExternalToolAdapter({
      id: 'specimen.adapter',
      toolId: 'specimen.tool',
      displayName: 'Specimen Tool',
      provenance,
      async probe() {}, async run() {}, async cancel() {}, async dispose() {},
    });
    assert.equal(adapter.protocol, EXTERNAL_TOOL_ADAPTER_PROTOCOL);
    assert.equal(Object.isFrozen(adapter), true);
    assert.deepEqual(Object.keys(adapter).sort(), [
      'cancel', 'displayName', 'dispose', 'id', 'probe', 'protocol', 'provenance', 'run', 'toolId',
    ]);
    assert.equal('createSession' in adapter, false);
    assert.equal('send' in adapter, false);
    assert.equal('capabilities' in adapter, false);
    assert.throws(() => defineExternalToolAdapter({ id: 'bad', toolId: 'bad', provenance, execute() {} }), /未冻结字段/);
  });

  test('probe 可证明版本与 executable；不可用时必须解释原因', () => {
    const available = normalizeExternalToolProbe({
      adapterId: 'specimen.adapter', available: true,
      executablePath: 'C:/Tools/specimen.exe', version: '1.2.3', reason: '', provenance,
    });
    assert.equal(available.schema, EXTERNAL_TOOL_PROBE_SCHEMA);
    assert.equal(available.version, '1.2.3');
    assert.equal(Object.isFrozen(available.provenance), true);
    const unavailable = normalizeExternalToolProbe({
      adapterId: 'specimen.adapter', available: false, reason: 'not installed', provenance,
    });
    assert.equal(unavailable.available, false);
    assert.throws(() => normalizeExternalToolProbe({ adapterId: 'x', available: true, provenance }), /executablePath/);
    assert.throws(() => normalizeExternalToolProbe({ adapterId: 'x', available: false, provenance }), /reason/);
  });

  test('run request 强制显式 workdir 与资产输入输出，不接受 raw shell/env/command', () => {
    const normalized = normalizeExternalToolRunRequest(request());
    assert.equal(normalized.schema, EXTERNAL_TOOL_RUN_REQUEST_SCHEMA);
    assert.equal(normalized.inputs[0].id, 'asset:scene:001');
    assert.equal(normalized.outputs[0].path, 'outputs/frame.png');
    assert.equal(Object.isFrozen(normalized.inputs[0]), true);
    assert.throws(() => normalizeExternalToolRunRequest({ ...request(), workdir: '' }), /workdir/);
    assert.throws(() => normalizeExternalToolRunRequest({ ...request(), command: 'tool --do-anything' }), /未冻结字段/);
    assert.throws(() => normalizeExternalToolRunRequest({ ...request(), env: { TOKEN: 'secret' } }), /未冻结字段/);
    assert.throws(() => normalizeExternalToolRunRequest({ ...request(), inputs: [{ role: 'scene', path: 'x' }] }), /id/);
  });

  test('terminal result 同时记录 stdout/stderr/exit/duration/产物/provenance', () => {
    const result = normalizeExternalToolRunResult({
      runId: 'run-001', status: 'succeeded', stdout: 'rendered\n', stderr: '',
      exit: { code: 0, signal: '', reason: '' }, durationMs: 1250,
      outputs: [{ role: 'frame', id: 'asset:image:frame-001', path: 'outputs/frame.png', type: 'image/png', version: 'sha256:ccc' }],
      provenance: { adapterId: 'specimen.adapter', toolVersion: '1.2.3', requestRunId: 'run-001' },
    });
    assert.equal(result.schema, EXTERNAL_TOOL_RUN_RESULT_SCHEMA);
    assert.equal(result.exit.code, 0);
    assert.equal(result.durationMs, 1250);
    assert.equal(result.outputs[0].id, 'asset:image:frame-001');
    assert.equal(Object.isFrozen(result.outputs[0]), true);
  });

  test('status 与 exit 必须一致，取消结果保留幂等终态', () => {
    const base = {
      runId: 'run-001', stdout: '', stderr: '', durationMs: 1, outputs: [], provenance,
    };
    assert.throws(() => normalizeExternalToolRunResult({ ...base, status: 'succeeded', exit: { code: 2 } }), /exit.code=0/);
    assert.throws(() => normalizeExternalToolRunResult({ ...base, status: 'failed', exit: { code: 0 } }), /failed/);
    assert.throws(() => normalizeExternalToolRunResult({ ...base, status: 'cancelled', exit: { code: null } }), /exit.reason/);
    const first = normalizeExternalToolCancelResult({ runId: 'run-001', status: 'accepted', reason: 'user' });
    const again = normalizeExternalToolCancelResult({ runId: 'run-001', status: 'already-terminal', reason: 'cancelled' });
    assert.equal(first.schema, EXTERNAL_TOOL_CANCEL_RESULT_SCHEMA);
    assert.equal(again.status, 'already-terminal');
  });

  test('dispose 契约只接受 activeRuns=0 的完成态', () => {
    const disposed = normalizeExternalToolDisposeResult({
      adapterId: 'specimen.adapter', status: 'disposed', activeRuns: 0, reason: 'app-quit',
    });
    assert.equal(disposed.schema, EXTERNAL_TOOL_DISPOSE_RESULT_SCHEMA);
    assert.equal(disposed.activeRuns, 0);
    assert.throws(() => normalizeExternalToolDisposeResult({
      adapterId: 'specimen.adapter', status: 'disposed', activeRuns: 1,
    }), /activeRuns 必须为 0/);
  });

  test('纯协议没有进程、文件、网络或产品工具副作用', async () => {
    let disposed = false;
    const adapter = defineExternalToolAdapter({
      id: 'specimen.adapter', toolId: 'specimen.tool', provenance,
      probe: async () => normalizeExternalToolProbe({
        adapterId: 'specimen.adapter', available: false, reason: 'contract specimen only', provenance,
      }),
      run: async value => normalizeExternalToolRunRequest(value),
      cancel: async runId => normalizeExternalToolCancelResult({ runId, status: 'not-found', reason: 'no runtime' }),
      dispose: async () => {
        disposed = true;
        return normalizeExternalToolDisposeResult({ adapterId: 'specimen.adapter', status: 'disposed', activeRuns: 0 });
      },
    });
    assert.equal((await adapter.probe()).available, false);
    assert.equal((await adapter.run(request())).runId, 'run-001');
    assert.equal((await adapter.cancel('missing')).status, 'not-found');
    assert.equal((await adapter.dispose()).status, 'disposed');
    assert.equal(disposed, true);
    const source = fs.readFileSync(new URL('../../main/foundation/external-tool-adapter.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /child_process|spawn\s*\(|execFile|node-pty|electron|fetch\s*\(|https?\.request/);
    assert.doesNotMatch(source, /agent-harness|capability-registry|factory|blender/i);
  });
});
