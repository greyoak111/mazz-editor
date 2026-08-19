import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { AgentDoctrineRuntime } = require('../../main/agent-doctrine-runtime.js');

describe('W66-R6 packaged Rule Pack Activation Gate', () => {
  test('未配置、初次编译、漂移阻断、人工重接受形成不可变 Attempt 链', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-doctrine-runtime-'));
    const source = path.join(root, 'rules.md');
    let configured = '';
    let head = 'abcdef123456';
    const runtime = new AgentDoctrineRuntime({ doctrineRoot: path.join(root, 'compiled'), doctrineAssetsRoot: path.resolve('docs/engineering/doctrine'), sourcePathProvider: () => configured, headProvider: () => head, clock: () => new Date('2026-08-19T08:00:00Z') });
    try {
      assert.equal(runtime.status().reason, 'RULE_PACK_REQUIRED');
      fs.writeFileSync(source, '军规全文 v1\n'); configured = source;
      const first = runtime.prepare();
      assert.ok(first.attemptId.startsWith('runtime-'));
      assert.equal(runtime.status().ready, true);
      head = '123456abcdef';
      assert.equal(runtime.status().reason, 'DOCTRINE_CONTEXT_RECOMPILE_REQUIRED');
      const contextAttempt = runtime.prepare();
      assert.notEqual(contextAttempt.attemptId, first.attemptId);
      assert.equal(runtime.status().ready, true);
      fs.writeFileSync(source, '军规全文 v2\n');
      assert.equal(runtime.status().reason, 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE');
      assert.throws(() => runtime.provide(), error => error.code === 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE');
      const second = runtime.prepare({ acceptDrift: true });
      assert.notEqual(second.attemptId, contextAttempt.attemptId);
      assert.equal(runtime.status().ready, true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
