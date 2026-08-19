import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const context = require('../../main/foundation/context-compiler.js');
const { ContextCompilerService } = require('../../main/context-compiler-service.js');
const { composeInstruction } = require('../../main/agent-adapter-common.js');

const NOW = '2026-08-19T08:00:00.000Z';
function source(id, overrides = {}) {
  return {
    sourceRef: `source:${id}`, kind: 'repository-file', title: id, topicRef: `topic:${id}`,
    status: 'CURRENT', authorityRef: 'authority:maintainer', effectiveAt: NOW, replacementRef: '', supersessionReason: '',
    version: '1', mtime: NOW, hash: `sha256:${id.padEnd(64, '0').slice(0, 64)}`,
    tokenEstimate: 100, relevance: 0.8, authorityLevel: 80, summary: id, excerpt: '', sensitivity: ['internal'], provenance: { fixture: true }, mandatory: false,
    ...overrides,
  };
}
function obligation(index, overrides = {}) {
  return {
    obligationId: `obligation:${String(index).padStart(2, '0')}`, title: `义务 ${index}`, status: 'REGISTERED',
    dependencyIds: [], gateRefs: [`gate:${index}`], evidenceRefs: [], authorityRef: '', reason: '', impact: '', replacementId: '',
    updatedAt: NOW, scopeRef: `wave:W${index}`,
    ...overrides,
  };
}
function compile(overrides = {}) {
  return context.compileContextPackage({
    taskId: 'task:w85', seatId: 'seat:developer', checkpointId: 'checkpoint:1', compilerVersion: 'test', policyVersion: 'test',
    budget: 1000, sources: [], obligations: [], constraints: ['Context != Plan'], recentDelta: [], unknowns: [],
    seatPolicy: { allowedSensitivity: ['internal'], deniedKinds: [], maxSourceTokens: 1000 }, compiledAt: NOW,
    ...overrides,
  });
}

describe('W85 Context Compiler 与 Supersession', () => {
  test('Context/Plan、Memory/State、Reasoning/Coverage 分离且包可确定性重建', () => {
    const one = compile({ sources: [source('spec')], obligations: [obligation(1)] });
    const two = compile({ sources: [source('spec')], obligations: [obligation(1)] });
    assert.equal(one.contextPackageId, two.contextPackageId);
    assert.equal(one.schema, 'mazz.context-package/v0');
    assert.deepEqual(one.constraints, ['Context != Plan']);
    assert.equal(one.coverageSnapshot.total, 1);
    assert.equal(one.provenance.conversationHistoryUsed, false);
    assert.equal(Object.hasOwn(one, 'plan'), false); assert.equal(Object.hasOwn(one, 'runtimeState'), false);
  });

  test('CURRENT 必须有 Authority；较新材料不会自动 CURRENT；SUPERSEDED 需完整替代链', () => {
    assert.throws(() => context.normalizeContextSource(source('no-auth', { authorityRef: '' })), /CURRENT 必须有 Authority/);
    assert.throws(() => context.normalizeContextSource({ ...source('new'), status: '' }), /status/);
    assert.throws(() => context.normalizeContextSource(source('old', { status: 'SUPERSEDED', replacementRef: '' })), /replacement/);
    const old = context.normalizeContextSource(source('old', { status: 'SUPERSEDED', replacementRef: 'source:new', supersessionReason: '正式目标替代旧策略' }));
    assert.equal(old.status, 'SUPERSEDED'); assert.equal(old.replacementRef, 'source:new'); assert.equal(old.authorityRef, 'authority:maintainer');
  });

  test('W75/W81/Shadow 只作为 INFERRED 候选，检索相关性与 Authority 永不混写', () => {
    for (const kind of ['retrieval-candidate', 'workspace-event', 'episode', 'shadow-relation']) {
      const row = context.normalizeContextSource(source(kind, { kind, status: 'CURRENT', authorityRef: 'authority:fake', relevance: 1, authorityLevel: 100 }));
      assert.equal(row.status, 'INFERRED'); assert.equal(row.authorityRef, '');
      const pkg = compile({ sources: [row] });
      assert.equal(pkg.authoritativeRefs.length, 0); assert.equal(pkg.relevantRefs[0].sourceRef, row.sourceRef); assert.equal(pkg.provenance.candidateAuthorityGranted, false);
    }
  });

  test('固定预算与 Seat 权限会显式排除，mandatory 溢出有标记', () => {
    const pkg = compile({
      budget: 100, sources: [source('mandatory', { tokenEstimate: 150, mandatory: true }), source('budget', { tokenEstimate: 80 }), source('secret-seat', { tokenEstimate: 10, sensitivity: ['sensitive'] })],
      seatPolicy: { allowedSensitivity: ['internal'], deniedKinds: [], maxSourceTokens: 100 },
    });
    assert.equal(pkg.overflow, true); assert.equal(pkg.used, 150);
    assert.ok(pkg.excludedRefs.some(row => row.ref === 'source:budget' && row.reason === 'BUDGET_EXCEEDED'));
    assert.ok(pkg.excludedRefs.some(row => row.ref === 'source:secret-seat' && row.reason.startsWith('SEAT_PERMISSION')));
  });

  test('相同 topic 的多个 CURRENT 冲突必须公开，不能静默选边', () => {
    const pkg = compile({ sources: [source('a', { topicRef: 'topic:strategy', hash: 'sha256:a' }), source('b', { topicRef: 'topic:strategy', hash: 'sha256:b' })] });
    assert.equal(pkg.knownConflicts.length, 1); assert.equal(pkg.knownConflicts[0].resolution, 'REQUIRES_AUTHORITY');
  });

  test('禁止 raw conversation、prompt、凭据或 secret 混入编译输入', () => {
    assert.throws(() => compile({ sources: [source('bad', { provenance: { chatHistory: 'dump' } })] }), /禁止敏感/);
    assert.throws(() => compile({ sources: [source('bad2', { provenance: { apiToken: 'token' } })] }), /禁止敏感/);
  });
});

describe('W85 Wave Graph / Coverage Accounting', () => {
  test('Hard Sample H：47 项义务在极小 context budget 下仍零静默丢失', () => {
    const obligations = Array.from({ length: 47 }, (_, index) => obligation(index + 1, index === 0 ? { status: 'EVIDENCED', evidenceRefs: ['test:w85'] } : {}));
    obligations[1] = obligation(2, { status: 'SUPERSEDED', replacementId: 'obligation:03', authorityRef: 'human:maintainer', reason: '拆分后替代' });
    obligations[2] = obligation(3, { status: 'READY' });
    obligations[3] = obligation(4, { status: 'SUPERSEDED', replacementId: 'obligation:05', authorityRef: 'human:maintainer', reason: '新 Gate 替代' });
    obligations[4] = obligation(5, { status: 'READY' });
    const pkg = compile({
      budget: 160,
      sources: [
        source('current-a', { topicRef: 'topic:strategy', tokenEstimate: 80, hash: 'sha256:a' }),
        source('current-b', { topicRef: 'topic:strategy', tokenEstimate: 80, hash: 'sha256:b' }),
        source('old', { status: 'SUPERSEDED', replacementRef: 'source:current-a', supersessionReason: '正式替代', tokenEstimate: 80 }),
        source('history', { status: 'HISTORICAL', authorityRef: '', tokenEstimate: 80 }),
        source('huge', { tokenEstimate: 500 }),
      ],
      obligations, recentDelta: ['file:one', 'file:two', 'file:three'],
      seatPolicy: { allowedSensitivity: ['internal'], deniedKinds: [], maxSourceTokens: 160 },
    });
    assert.equal(pkg.coverageSnapshot.total, 47); assert.equal(pkg.coverageSnapshot.obligations.length, 47); assert.equal(pkg.coverageSnapshot.silentlyDropped, 0);
    assert.ok(pkg.excludedRefs.some(row => row.ref === 'source:huge' && row.reason === 'SOURCE_TOKEN_LIMIT'));
    assert.equal(pkg.coverageSnapshot.counts.SUPERSEDED, 2); assert.equal(pkg.coverageSnapshot.counts.EVIDENCED, 1);
    assert.equal(pkg.recentDelta.length, 3); assert.equal(pkg.knownConflicts.length, 1);
  });

  test('EVIDENCED、WAIVED、SUPERSEDED 均有硬证据/权限前件', () => {
    assert.throws(() => context.normalizeObligation(obligation(1, { status: 'EVIDENCED' })), /必须引用证据/);
    assert.throws(() => context.normalizeObligation(obligation(1, { status: 'WAIVED', authorityRef: 'agent:auto', reason: 'skip', impact: 'risk' })), /human Authority/);
    assert.throws(() => context.normalizeObligation(obligation(1, { status: 'SUPERSEDED', replacementId: '' })), /replacement/);
    const evidenced = context.transitionObligation(obligation(1, { status: 'IN_PROGRESS' }), { status: 'EVIDENCED', evidenceRefs: ['test:contract'], updatedAt: NOW });
    assert.equal(evidenced.status, 'EVIDENCED');
    assert.throws(() => context.transitionObligation(evidenced, { status: 'READY', updatedAt: NOW }), /非法状态迁移/);
  });

  test('Coverage report 同时发现代码变更未记账和证据漂移', () => {
    const snapshot = context.createCoverageSnapshot([obligation(1, { status: 'EVIDENCED', evidenceRefs: ['artifact:old'] }), obligation(2, { status: 'BLOCKED' })]);
    const report = context.createCoverageReport(snapshot, { authorizedScopeRefs: ['wave:W1', 'wave:W2'], changedRefs: ['file:new.js'], evidenceRefs: ['artifact:new'] });
    assert.deepEqual(report.drift.changedWithoutCoverage, ['file:new.js']); assert.deepEqual(report.drift.evidencedWithoutKnownArtifact, ['obligation:01']); assert.deepEqual(report.blocked, ['obligation:02']);
  });
});

describe('W85 Repository Prototype / Harness Injection', () => {
  test('仓库文件必须在 workspace 内，Package 落盘可检查并接 W81 候选', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w85-'));
    try {
      fs.writeFileSync(path.join(root, 'spec.md'), '# current spec\n', 'utf8');
      const service = new ContextCompilerService({ rootProvider: () => root, now: () => new Date(NOW), eventService: { search: () => [{ episodeId: 'e1', label: 'VPS 配置', score: 1.5, reasons: ['term:vps'], eventRefs: ['event:1'], endedAt: NOW }] } });
      const result = service.compile({ taskId: 'task:repo', seatId: 'seat:developer', checkpointId: 'checkpoint:fresh', budget: 1000, fileSources: [{ path: 'spec.md', mandatory: true }], eventQuery: 'VPS', obligations: [obligation(1)], constraints: [], seatPolicy: { allowedSensitivity: ['internal'], deniedKinds: [], maxSourceTokens: 1000 } });
      assert.equal(fs.existsSync(result.packagePath), true); assert.equal(result.contextPackage.authoritativeRefs.length, 1); assert.equal(result.contextPackage.relevantRefs[0].status, 'INFERRED'); assert.equal(result.contextPackage.relevantRefs[0].authorityRef, '');
      assert.throws(() => service.sourceFromFile({ path: '../outside.md' }), /越出/);
      assert.equal(service.list().length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('Harness 指令同时携带完整 Doctrine 与审计 Context Package', () => {
    const pkg = compile();
    const text = composeInstruction({ instruction: 'do work', context: { contextPackage: pkg }, rulePackInjection: { rawSource: Buffer.from('RULES'), compiledView: { rules: ['x'] } } }, 'user turn');
    assert.match(text, /CANONICAL RAW SOURCE/); assert.match(text, /AUDITABLE CONTEXT PACKAGE/); assert.match(text, new RegExp(pkg.contextPackageId));
    const harness = fs.readFileSync(new URL('../../main/agent-harness.js', import.meta.url), 'utf8');
    const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
    const preload = fs.readFileSync(new URL('../../preload/bridge.js', import.meta.url), 'utf8');
    assert.match(harness, /contextProvider/); assert.match(harness, /contextPackageId/); assert.match(main, /compileForHarness/); assert.match(preload, /contextPackage:compile/);
  });
});
