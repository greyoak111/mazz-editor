import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const ledger = require('../../main/foundation/workspace-events.js');
const { WorkspaceEventService } = require('../../main/workspace-event-service.js');

function event(overrides = {}) {
  return {
    idempotencyKey: overrides.idempotencyKey || 'fixture:1', workspaceId: 'workspace:test',
    occurredAt: overrides.occurredAt || '2026-08-19T01:00:00.000Z', recordedAt: overrides.recordedAt || '2026-08-19T01:00:01.000Z',
    actorType: 'human', sourceModule: 'editor', action: 'open', subjectRefs: [], objectRefs: ['file:D:/repo/package.json'], contextRefs: ['wave:W71'], outcome: 'success',
    provenance: { producer: 'test' }, privacyClass: 'operational', retentionClass: '1y', summary: 'Electron packaged runtime ABI 与许可排查',
    ...overrides,
  };
}
function fixtureService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w81-'));
  const values = new Map();
  const store = { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) };
  return { root, service: new WorkspaceEventService({ rootProvider: () => root, store }) };
}

describe('W81 Workspace Event Ledger', () => {
  test('严格拒绝正文、逐键、命令、环境与 secret 字段', () => {
    for (const forbidden of [{ body: 'x' }, { keystrokes: 'x' }, { commandText: 'rm' }, { environment: {} }, { apiKey: 'x' }]) {
      assert.throws(() => ledger.normalizeWorkspaceEvent({ ...event(), ...forbidden }), /禁止敏感|未冻结字段/);
    }
  });

  test('事件身份幂等且时钟异常显式标记', () => {
    const one = ledger.normalizeWorkspaceEvent(event());
    const two = ledger.normalizeWorkspaceEvent(event({ summary: '展示文案不参与幂等身份' }));
    assert.equal(one.eventId, two.eventId);
    assert.equal(ledger.normalizeWorkspaceEvent(event({ recordedAt: '2026-08-19T00:00:00Z' })).clockStatus, 'ANOMALOUS_RECORDED_BEFORE_OCCURRED');
  });

  test('追加记录具备 hash chain，篡改、重排均拒绝', () => {
    const first = ledger.createEventRecord(event(), { sequence: 1 });
    const second = ledger.createEventRecord(event({ idempotencyKey: 'fixture:2', action: 'save' }), { sequence: 2, previousHash: first.recordHash });
    assert.equal(ledger.verifyEventRecords([first, second]).length, 2);
    assert.throws(() => ledger.verifyEventRecords([second, first]), /hash chain/);
    assert.throws(() => ledger.verifyEventRecords([{ ...first, event: { ...first.event, summary: 'tampered' } }, second]), /hash chain/);
  });

  test('服务写入本地 NDJSON、收敛重复、暂停时不采集', () => {
    const { root, service } = fixtureService();
    try {
      const input = { ...event(), workspaceId: undefined, recordedAt: undefined };
      assert.equal(service.capture(input).recorded, true);
      assert.equal(service.capture(input).duplicate, true);
      service.setEnabled(false);
      assert.equal(service.capture({ ...input, idempotencyKey: 'fixture:2' }).reason, 'DISABLED');
      assert.equal(service.snapshot().count, 1);
      assert.equal(fs.existsSync(path.join(root, '.mazz', 'events', 'ledger.ndjson')), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('损坏账本保留原文并生成恢复报告', () => {
    const { root, service } = fixtureService();
    try {
      fs.mkdirSync(path.dirname(service.file()), { recursive: true });
      fs.writeFileSync(service.file(), '{bad-json}\n', 'utf8');
      assert.throws(() => service.snapshot(), /原账保留/);
      assert.equal(fs.readFileSync(service.file(), 'utf8'), '{bad-json}\n');
      assert.equal(fs.readdirSync(path.dirname(service.file())).some(name => name.startsWith('recovery-')), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('清空与保留策略均需人工 Authority，原账进入可恢复归档', () => {
    const { root, service } = fixtureService();
    try {
      service.capture({ ...event({ occurredAt: '2020-01-01T00:00:00Z', retentionClass: '30d' }), workspaceId: undefined, recordedAt: undefined });
      service.capture({ ...event({ idempotencyKey: 'keep', occurredAt: '2020-01-01T00:00:00Z', retentionClass: 'keep' }), workspaceId: undefined, recordedAt: undefined });
      assert.throws(() => service.applyRetention({ authorityRef: 'agent:auto', reason: 'compact' }), /human:\*/);
      const retention = service.applyRetention({ now: '2026-08-19T00:00:00Z', authorityRef: 'human:maintainer', reason: 'policy' });
      assert.equal(retention.expired, 1); assert.equal(retention.kept, 1); assert.equal(retention.recoverable, true);
      assert.equal(fs.existsSync(retention.archivedPath), true);
      assert.throws(() => service.clear({ authorityRef: 'agent:auto', reason: 'x' }), /human:\*/);
      assert.equal(service.clear({ authorityRef: 'human:maintainer', reason: 'explicit' }).recoverable, true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('Episode、模糊找回和概念生命史均给解释，不授予 Authority', () => {
    const rows = [
      event(),
      event({ idempotencyKey: '2', occurredAt: '2026-08-19T01:04:00Z', action: 'save', objectRefs: ['file:D:/repo/package.json'], summary: 'VPS SearXNG 配置' }),
      event({ idempotencyKey: '3', occurredAt: '2026-08-19T01:08:00Z', action: 'promote', objectRefs: ['file:D:/repo/package.json'], contextRefs: ['wave:W71', 'topic:release'] }),
    ];
    const episodes = ledger.buildEpisodes(rows);
    assert.equal(episodes[0].label, 'Windows packaged runtime 排查');
    assert.ok(episodes[0].reasons.includes('shared-reference'));
    assert.equal(ledger.searchOperationalHistory(rows, 'VPS 配置').length, 1);
    const lifecycle = ledger.aggregateConceptLifecycle(rows, 'file:D:/repo/package.json');
    assert.equal(lifecycle.stage, 'promoted-specification'); assert.equal(lifecycle.authorityGranted, false); assert.equal(lifecycle.inferred, true);
  });

  test('长摘要与超过二十个匹配 Episode 全量进入上下文检索', () => {
    const tail = '不可截断尾部';
    const longSummary = `${'运行史'.repeat(200)}${tail}`;
    assert.ok(ledger.normalizeWorkspaceEvent(event({ summary: longSummary })).summary.endsWith(tail));
    const rows = Array.from({ length: 25 }, (_, index) => event({
      idempotencyKey: `full:${index}`,
      occurredAt: new Date(Date.parse('2026-08-19T01:00:00Z') + index * 60 * 60 * 1000).toISOString(),
      objectRefs: [`file:D:/repo/${index}.md`], contextRefs: [`topic:全量-${index}`],
      summary: `全量上下文 第${index + 1}条`,
    }));
    assert.equal(ledger.searchOperationalHistory(rows, '全量上下文').length, rows.length);
  });

  test('正式 UI/IPC 与三个 pilot producer 接线且终端不转发命令正文', () => {
    const read = relative => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
    const preload = read('preload/bridge.js'), main = read('main/main.js'), sidebar = read('renderer/shell/sidebar-panels.js');
    const browser = read('renderer/modules/browser/index.js'), shell = read('renderer/shell/shell.js'), terminal = read('renderer/modules/code/terminal-view.js');
    for (const channel of ['events:capture', 'events:snapshot', 'events:applyRetention']) { assert.match(preload, new RegExp(channel)); assert.match(main, new RegExp(channel)); }
    assert.match(sidebar, /个人工作运行史/); assert.match(sidebar, /不记逐键、命令正文、剪贴板正文或凭据/); assert.match(sidebar, /执行保留策略/);
    assert.match(browser, /sourceModule: 'browser'/); assert.match(shell, /sourceModule: 'editor'/); assert.match(terminal, /sourceModule: 'terminal'/);
    assert.doesNotMatch(terminal, /captureWorkspaceEvent\([^)]*data/s);
  });
});
