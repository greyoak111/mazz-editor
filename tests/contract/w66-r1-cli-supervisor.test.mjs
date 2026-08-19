import { createRequire } from 'node:module';
import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger } = require('../../main/resource-ledger.js');
const { CliSupervisor, safeEnvironment, resolveExecutable, classifyAuthentication } = require('../../main/agent-cli-supervisor.js');

describe('W66-R1 CLI Supervisor', () => {
  test('真实 Node 子进程 stdout/stderr/exit 进入统一 Result Envelope 并释放资源', async () => {
    const ledger = new ResourceLedger();
    const supervisor = new CliSupervisor({ resourceLedger: ledger, idFactory: () => 'proc-ok' });
    const run = await supervisor.capture({ command: process.execPath, args: ['-e', "process.stdout.write('out'); process.stderr.write('err')"], timeoutMs: 5000 });
    assert.equal(run.result.ok, true);
    assert.equal(run.result.stdout, 'out');
    assert.equal(run.result.stderr, 'err');
    assert.equal(run.outputReceipt.complete, true);
    assert.equal(supervisor.activeCount(), 0);
    assert.equal(ledger.snapshot().activeCount, 0);
  });

  test('非零退出、超时与输出上限不会被 outer success 掩盖', async () => {
    const nonzero = await new CliSupervisor().capture({ command: process.execPath, args: ['-e', 'process.exit(9)'], timeoutMs: 5000 });
    assert.equal(nonzero.result.ok, false);
    assert.equal(nonzero.result.error.code, 'INNER_EXIT_NONZERO');

    const timeout = await new CliSupervisor().capture({ command: process.execPath, args: ['-e', 'setTimeout(()=>{}, 5000)'], timeoutMs: 150 });
    assert.equal(timeout.result.error.code, 'CLI_TIMEOUT');

    const bounded = await new CliSupervisor({ maxOutputBytes: 1024 }).capture({ command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(4096)); setTimeout(()=>{},1000)"], timeoutMs: 3000 });
    assert.equal(bounded.result.error.code, 'CLI_OUTPUT_LIMIT');
    assert.equal(bounded.outputReceipt.truncated, true);
  });

  test('环境白名单不继承 secret，命令解析只接受真实可执行文件', () => {
    const env = safeEnvironment({}, { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OPENAI_API_KEY: 'canary' });
    assert.equal('OPENAI_API_KEY' in env, false);
    assert.ok(resolveExecutable([process.execPath]));
    assert.equal(resolveExecutable(['mazz-definitely-missing-cli']), '');
  });

  test('detect 返回真实 version，WindowsApps 内部路径可被明确拒绝', async () => {
    const supervisor = new CliSupervisor();
    const found = await supervisor.detect({ id: 'node-fixture', names: [], explicitPaths: [process.execPath], versionArgs: ['--version'] });
    assert.equal(found.available, true);
    assert.match(found.version, /^v\d+/);
    const rejected = await supervisor.detect({ id: 'node-rejected', names: [], explicitPaths: [process.execPath], rejectPatterns: [new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))] });
    assert.equal(rejected.available, false);
    assert.equal(rejected.reason, 'CLI_PATH_REJECTED');
  });

  test('spawn 同步 EPERM 被归一为不可用，不让 detect 抛穿主进程', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EPERM', syscall: 'spawn' });
    const supervisor = new CliSupervisor({ spawnImpl: () => { throw error; } });
    const row = await supervisor.detect({ id: 'blocked-cli', names: [], explicitPaths: [process.execPath] });
    assert.equal(row.available, false);
    assert.equal(row.reason, 'EPERM');
    assert.equal(supervisor.activeCount(), 0);
  });

  test('auth 只输出 authenticated/unauthenticated/unknown/error，不解析或回显凭据', () => {
    assert.equal(classifyAuthentication({ stdout: 'Logged in with subscription', exitCode: 0 }).status, 'authenticated');
    assert.equal(classifyAuthentication({ stderr: 'Authentication required; please run login', exitCode: 1 }).status, 'unauthenticated');
    assert.equal(classifyAuthentication({ stdout: 'doctor ok', exitCode: 0 }).status, 'unknown');
    assert.equal(classifyAuthentication({ stderr: 'network failed', exitCode: 2 }).status, 'error');
  });
});

describe('W66-R1 Golden Event Corpus', () => {
  test('三家 fixture 与 common failure/lifecycle 均有稳定 expected 事件', () => {
    const corpus = JSON.parse(fs.readFileSync('docs/engineering/evidence/W66_R1_GOLDEN_EVENT_CORPUS.v0.json', 'utf8'));
    assert.equal(corpus.schemaVersion, 'mazz.agent-cli-golden-event-corpus/v0');
    for (const id of ['kimi-code', 'claude-code', 'codex', 'common']) assert.ok(corpus.fixtures.some(row => row.adapterId === id), `${id} fixture 缺失`);
    assert.ok(corpus.fixtures.every(row => row.transport && row.input && row.expected?.type));
  });
});
