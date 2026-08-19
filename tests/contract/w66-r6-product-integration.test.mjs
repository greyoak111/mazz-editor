import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const { ResourceLedger } = require('../../main/resource-ledger.js');
const { CliSupervisor } = require('../../main/agent-cli-supervisor.js');
const { KimiCodeAdapter } = require('../../main/adapters/kimi-code-adapter.js');
const { ClaudeCodeAdapter } = require('../../main/adapters/claude-code-adapter.js');
const { CodexAdapter } = require('../../main/adapters/codex-adapter.js');

const input = () => ({ workspace: process.cwd(), instruction: 'fixture', permissionProfileRef: 'restricted', rulePackInjection: { rawSource: Buffer.from('FULL RULE PACK'), compiledView: { rawSource: { injection: 'REQUIRED_FULL_BYTES' } } } });

describe('W66-R6 Product Integration / lifecycle soak', () => {
  test('三家各 20 轮真实 child create/send/dispose 后进程与资源账归零', async () => {
    const ledger = new ResourceLedger();
    const supervisor = new CliSupervisor({ resourceLedger: ledger });
    const adapters = [
      new KimiCodeAdapter({ supervisor, executablePath: process.execPath, launchArgs: ['tests/fixtures/fake-acp-agent.cjs'] }),
      new ClaudeCodeAdapter({ supervisor, executablePath: process.execPath, commandPrefix: ['tests/fixtures/fake-jsonl-agent.cjs', 'claude-fixture'] }),
      new CodexAdapter({ supervisor, executablePath: process.execPath, commandPrefix: ['tests/fixtures/fake-jsonl-agent.cjs', 'codex-fixture'] }),
    ];
    for (const adapter of adapters) {
      await adapter.detect();
      for (let cycle = 0; cycle < 20; cycle += 1) {
        const handle = await adapter.createSession(input());
        await adapter.events(handle, () => {});
        await adapter.send(handle, `cycle-${cycle}`);
        await adapter.dispose(handle);
      }
    }
    assert.equal(supervisor.activeCount(), 0);
    assert.equal(ledger.snapshot().activeCount, 0);
  });

  test('主进程正式登记三家，UI 暴露健康/规则包/模型选择且发布物包含 Doctrine assets', () => {
    const main = fs.readFileSync('main/main.js', 'utf8');
    const ui = fs.readFileSync('renderer/modules/factory/index.js', 'utf8');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    for (const name of ['KimiCodeAdapter', 'ClaudeCodeAdapter', 'CodexAdapter']) assert.ok(main.includes(`new ${name}`));
    for (const channel of ['harness:health', 'harness:activationStatus', 'harness:chooseRulePack']) assert.ok(ui.includes(channel));
    assert.ok(ui.includes('fc-harness-adapter'));
    assert.ok(ui.includes('fc-harness-model'));
    assert.ok(pkg.build.files.includes('docs/engineering/doctrine/'));
  });
});
