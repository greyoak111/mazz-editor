import './_setup.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  AUTOMATION_LEVELS, ContinuousFeedService, SOURCE_SCHEMA,
  feedControlPaths, localItems, normalizeSource, parseSyndication,
} = require('../../main/continuous-feed-service.js');

function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w62e-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function source(root, overrides = {}) {
  return {
    schema: SOURCE_SCHEMA, projectId: 'project:w62e', projectPath: root,
    kind: 'search', label: '发布工程', query: 'Electron packaging', location: '',
    dimension: '发布工程', automation: 'approval', intervalMinutes: 60, enabled: true,
    factoryQueueAuthorized: false, ...overrides,
  };
}

class FakePipeline {
  constructor() { this.requests = []; }
  async scan(request) {
    this.requests.push(request);
    return { ok: true, code: 'PACKAGE_CREATED', package: { packageId: `pkg-${this.requests.length}`, clusters: [] } };
  }
}

describe('W62e 持续投喂来源协议', () => {
  test('三种来源与三档自动化冻结，禁止秘密字段和隐式 M2 授权', () => withProject(root => {
    assert.deepEqual(AUTOMATION_LEVELS, ['approval', 'ingest', 'queue']);
    assert.equal(normalizeSource(source(root)).kind, 'search');
    assert.throws(() => normalizeSource(source(root, { automation: 'queue' })), /显式授予/);
    assert.equal(normalizeSource(source(root, { automation: 'queue', factoryQueueAuthorized: true })).automation, 'queue');
    assert.throws(() => normalizeSource({ ...source(root), apiKey: 'leak' }), /未冻结字段|secret/);
    assert.throws(() => normalizeSource(source(root, { kind: 'magic' })), /非法来源类型/);
  }));

  test('本地来源必须位于项目内，且只产生元数据、不读取正文', () => withProject(root => {
    const file = path.join(root, 'input.md');
    fs.writeFileSync(file, 'THIS BODY MUST NOT ENTER THE FEED ITEM', 'utf8');
    const normalized = normalizeSource(source(root, { kind: 'local', query: '', location: file }));
    const items = localItems(normalized, '2026-08-19T10:00:00.000Z');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'input.md');
    assert.equal(JSON.stringify(items).includes('THIS BODY'), false);
    assert.throws(() => normalizeSource(source(root, { kind: 'local', query: '', location: path.dirname(root) })), /当前项目内/);
  }));

  test('RSS/Atom 归一保留稳定 ID、链接、时间和完整摘要', () => {
    const items = parseSyndication(`<?xml version="1.0"?><feed><entry><id>tag:test,1</id><title>版本 &amp; 发布</title><link href="/post/1"/><updated>2026-08-19T09:00:00Z</updated><summary><![CDATA[短摘要]]></summary></entry></feed>`, 'https://example.test/feed.xml', '2026-08-19T10:00:00.000Z');
    assert.equal(items.length, 1);
    assert.equal(items[0].itemId, 'tag:test,1');
    assert.equal(items[0].title, '版本 & 发布');
    assert.equal(items[0].url, 'https://example.test/post/1');
    assert.equal(items[0].publishedAt, '2026-08-19T09:00:00.000Z');
  });

  test('订阅摘要不受本地 2000 字符门限裁剪', () => {
    const marker = '尾部材料必须保留';
    const summary = `${'长摘要'.repeat(670_000)}${marker}`;
    const items = parseSyndication(`<feed><entry><id>tag:long,1</id><title>长材料</title><summary><![CDATA[${summary}]]></summary></entry></feed>`, 'https://example.test/feed.xml', '2026-08-19T10:00:00.000Z');
    assert.ok(items[0].summary.endsWith(marker));
  });
});

describe('W62e 调度、健康、维度路由与 Factory 边界', () => {
  test('搜索来源进入 W74b；M0/M1 不生成 Factory 请求', () => withProject(async root => {
    const pipeline = new FakePipeline();
    const service = new ContinuousFeedService({
      feedPipeline: pipeline,
      searxService: { search: async () => ({ ok: true, results: [{ title: '结果', url: 'https://example.test/a', content: '摘要' }] }) },
      now: () => '2026-08-19T10:00:00.000Z',
    });
    try {
      const registered = service.register(source(root));
      const result = await service.run({ projectPath: root, sourceId: registered.sourceId });
      assert.equal(pipeline.requests[0].dimension, '发布工程');
      assert.equal(pipeline.requests[0].mode, 'approval');
      assert.equal(result.queueReceipt, null);
      assert.equal(fs.existsSync(feedControlPaths(root).queue), false);
      assert.equal(service.list(root).states[registered.sourceId].ok, true);
    } finally { service.dispose('contract-end'); }
  }));

  test('M2 仅写可审计待启动请求，不直接调用 AI', () => withProject(async root => {
    const pipeline = new FakePipeline();
    const service = new ContinuousFeedService({
      feedPipeline: pipeline,
      searxService: { search: async () => ({ ok: true, results: [{ title: '结果', url: 'https://example.test/a', content: '' }] }) },
      now: () => '2026-08-19T10:00:00.000Z',
    });
    try {
      const registered = service.register(source(root, { automation: 'queue', factoryQueueAuthorized: true }));
      const result = await service.run({ projectPath: root, sourceId: registered.sourceId });
      assert.equal(result.queueReceipt.status, 'awaiting-factory-dispatch');
      assert.equal(result.queueReceipt.automaticAiInvocation, false);
      assert.match(fs.readFileSync(feedControlPaths(root).queue, 'utf8'), /human:source-factory-queue-authorization/);
      assert.deepEqual(service.health().scheduledSources, [registered.sourceId]);
    } finally {
      service.dispose('contract-end');
      assert.equal(service.health().scheduledSources.length, 0);
    }
  }));

  test('失败不伪装成无变化，并累计来源健康事实', () => withProject(async root => {
    const service = new ContinuousFeedService({
      feedPipeline: new FakePipeline(),
      searxService: { search: async () => ({ ok: false, error: 'endpoint unavailable', results: [] }) },
      now: () => '2026-08-19T10:00:00.000Z',
    });
    try {
      const registered = service.register(source(root));
      await assert.rejects(() => service.run({ projectPath: root, sourceId: registered.sourceId }), /endpoint unavailable/);
      const state = service.list(root).states[registered.sourceId];
      assert.equal(state.ok, false);
      assert.equal(state.consecutiveFailures, 1);
      assert.match(state.lastError, /unavailable/);
    } finally { service.dispose('contract-end'); }
  }));
});
