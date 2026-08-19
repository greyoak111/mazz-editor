import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const spec = fs.readFileSync('docs/plans/W66_REAL_AGENT_ADAPTER_ACTIVATION.md', 'utf8');

describe('W66 real Adapter activation plan', () => {
  test('三种执行器是独立 Adapter，不退化成 Kimi 专项', () => {
    for (const name of ['Kimi Code', 'Claude Code', 'Codex']) assert.ok(spec.includes(name), `${name} 必须入正式三选一范围`);
    assert.match(spec, /已登记 Kimi Code、Claude Code、Codex 三个真实 Adapter/);
    assert.match(spec, /只有 Codex 通过真实认证与真实模型回合/);
    assert.match(spec, /不得用 fixture、Provider 路由或 Terminal/);
  });

  test('装载 Agent 前必须完整刻入交付区军规，缺失时零 spawn', () => {
    assert.ok(spec.includes('C:\\Users\\Administrator\\Downloads\\交付区\\Mazz Editor 开发军规.md'));
    assert.match(spec, /Project Rule Pack/);
    assert.match(spec, /RULE_PACK_REQUIRED/);
    assert.match(spec, /child process 创建数必须为 0/);
    assert.match(spec, /不得自行跳过、摘要替代或只传文件路径/);
    assert.match(spec, /同一份军规全文和同一 SHA-256/);
  });

  test('W66-R0 是所有真实 Adapter 与 UI 的共同前置', () => {
    for (let wave = 0; wave <= 6; wave += 1) assert.ok(spec.includes(`W66-R${wave}`), `W66-R${wave} 不得漏排`);
    assert.match(spec, /W66-R0\s+AgentRulePack \+ Doctrine Compiler \+ Adapter Contract v2/);
    assert.match(spec, /任何真实 Adapter 施工和 UI 激活的共同前置/);
  });

  test('热切保持 Run 身份并以 Attempt 和 Handoff 连接，禁止事务中途换模', () => {
    assert.match(spec, /Production Run \/ Task（身份不变）/);
    assert.match(spec, /Attempt N/);
    assert.match(spec, /handoff-snapshot-written/);
    assert.match(spec, /不做 mid-token、mid-tool 或 mid-write 换模/);
  });
});
