import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  createTypedHandle, assertTypedContinuation, normalizeResultEnvelope, assertResultAcceptable,
  failureSignature, RetryBudget, capturePatchBase, assertPatchBase,
  createOutputReceipt, assertOutputComplete,
} = require('../../main/agent-execution-contracts.js');

describe('W66-R0d Typed Handle / Result Envelope', () => {
  test('错误句柄与 continuation 在本地拒绝，调用计数保持零', () => {
    let calls = 0;
    const handle = createTypedHandle({ kind: 'ProcessSessionHandle', id: 'proc-1', ownerTool: 'cli-supervisor' });
    assert.throws(() => {
      assertTypedContinuation(handle, { kind: 'ExecCellHandle', continuation: 'wait' });
      calls++;
    }, error => error.code === 'HANDLE_KIND_MISMATCH');
    assert.equal(calls, 0);
  });

  test('outer success + inner nonzero 归一为 ERROR；截断与空输出不能冒充完成', () => {
    const failed = normalizeResultEnvelope({ outerStatus: 'success', exitCode: 7, stdout: 'partial' });
    assert.equal(failed.ok, false);
    assert.equal(failed.tag, 'ERROR');
    assert.equal(failed.error.code, 'INNER_EXIT_NONZERO');
    assert.throws(() => assertResultAcceptable(failed), error => error.code === 'INNER_EXIT_NONZERO');

    const truncated = normalizeResultEnvelope({ exitCode: 0, stdout: 'cut', complete: false, truncated: true });
    assert.equal(truncated.tag, 'TRUNCATED');
    assert.equal(truncated.complete, false);
    const empty = normalizeResultEnvelope({ exitCode: 0 });
    assert.equal(empty.tag, 'EMPTY');
    assert.throws(() => assertResultAcceptable(empty), error => error.code === 'OUTPUT_EMPTY');
  });
});

describe('W66-R0d Retry / Patch CAS / Output Receipt', () => {
  test('相同 Failure Signature 且前件未变时禁止原样重试', () => {
    const signature = failureSignature({ tool: 'codex', args: { model: 'x' }, error: { code: 'EPERM' }, relevantState: { path: 'a' } });
    const budget = new RetryBudget({ maxAttempts: 2 });
    assert.equal(budget.authorize({ signature }).remainingBudget, 1);
    assert.throws(() => budget.authorize({ signature }), error => error.code === 'UNCHANGED_RETRY_FORBIDDEN');
    assert.equal(budget.authorize({ signature, changedPrecondition: true }).remainingBudget, 0);
    assert.throws(() => budget.authorize({ signature: `${signature}a`, changedPrecondition: true }), error => error.code === 'RETRY_BUDGET_EXHAUSTED');
  });

  test('文件在 read→patch 间变化时返回 STALE_PATCH', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-r0d-'));
    const target = path.join(root, 'sample.txt');
    try {
      fs.writeFileSync(target, 'before');
      const base = capturePatchBase(target);
      assert.equal(assertPatchBase(base), true);
      fs.writeFileSync(target, 'after');
      assert.throws(() => assertPatchBase(base), error => error.code === 'STALE_PATCH');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('只有有界且未截断的 Output Receipt 可以关闭 Gate', () => {
    const partial = createOutputReceipt({ complete: false, truncated: true, cursor: 'next' });
    assert.throws(() => assertOutputComplete(partial), error => error.code === 'OUTPUT_INCOMPLETE');
    const unbounded = createOutputReceipt({ complete: true });
    assert.throws(() => assertOutputComplete(unbounded), error => error.code === 'OUTPUT_RECEIPT_UNBOUNDED');
    const full = createOutputReceipt({ complete: true, bytes: Buffer.from('all') });
    assert.equal(assertOutputComplete(full), true);
  });
});
