import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const kernel = require('../../main/foundation/civilization-model.js');
const NOW = '2026-08-19T10:00:00.000Z';

function state(id, property, value) {
  return { stateId: `state:${id}`, subjectRef: `subject:${id}`, property, value, classification: 'CANON', evidenceRefs: [`evidence:${id}`], authorityRef: 'human:world-owner', sourceRef: `asset:${id}`, updatedAt: NOW };
}
function rule(id, input, op, compareValue, output, property, outputValue, explanation) {
  return { ruleId: `rule:${id}`, inputStateRef: `state:${input}`, op, compareValue, outputSubjectRef: `subject:${output}`, outputProperty: property, outputValue, evidenceRefs: [`evidence:rule-${id}`], explanation };
}
function model(overrides = {}) {
  return {
    modelId: 'world:harbor', title: '港城压力链',
    states: [state('port', 'port-capacity', 100), state('transport', 'transport-cost', 20), state('food', 'food-price', 30), state('migration', 'migration-pressure', 5), state('politics', 'political-tension', 10)],
    constraints: [{ constraintId: 'constraint:capacity', stateRef: 'state:port', op: 'gte', value: 0, reason: '容量不能为负', evidenceRefs: ['evidence:capacity'] }],
    rules: [
      rule('port-transport', 'port', 'lt', 50, 'transport', 'transport-cost', 80, 'Port scarcity raises transport cost.'),
      rule('transport-food', 'transport', 'gt', 70, 'food', 'food-price', 90, 'Transport cost raises food price and household cost.'),
      rule('food-migration', 'food', 'gt', 80, 'migration', 'migration-pressure', 75, 'Food price causes migration and displacement cost.'),
      rule('migration-politics', 'migration', 'gt', 60, 'politics', 'political-tension', 85, 'Migration creates structural conflict and political tension.'),
    ],
    unknowns: [], provenance: { source: 'fixture' }, ...overrides,
  };
}
function change(overrides = {}) { return { changeId: 'change:blockade', targetStateRef: 'state:port', value: 40, classification: 'SIMULATION', evidenceRefs: ['evidence:blockade'], authorityRef: '', occurredAt: NOW, ...overrides }; }

describe('W80 Civilization Model Kernel', () => {
  test('State/Constraint/Change/Evidence/Unknown 严格表示，CANON 不能自封', () => {
    const normalized = kernel.normalizeModel(model()); assert.equal(normalized.states.length, 5); assert.equal(normalized.constraints.length, 1); assert.equal(normalized.rules.length, 4);
    assert.throws(() => kernel.normalizeState({ ...state('bad', 'x', 1), authorityRef: '' }), /human Authority/);
    assert.throws(() => kernel.normalizeModel({ ...model(), states: [...model().states, state('port', 'duplicate', 1)] }), /ID 重复/);
    assert.throws(() => kernel.normalizeChange(change({ classification: 'CANON' })), /human Authority/);
  });

  test('一个参数变化确定性推出四层 Derived Effect 与 Event Pool，不修改 Model', () => {
    const before = JSON.stringify(model()); const result = kernel.simulateCivilization(model(), change());
    assert.equal(result.status, 'COMPLETE'); assert.equal(result.effects.length, 5); assert.deepEqual(result.effects.map(effect => effect.depth), [0, 1, 2, 3, 4]);
    assert.equal(result.eventPool.length, 4); assert.equal(result.effects[0].state.classification, 'SIMULATION'); assert.ok(result.effects.slice(1).every(effect => effect.state.classification === 'DERIVED'));
    assert.equal(result.modelMutated, false); assert.equal(JSON.stringify(model()), before);
  });

  test('缺材料是结构化 UNKNOWN，不用推理补齐，也不抛穿运行时', () => {
    const missingTarget = kernel.simulateCivilization(model(), change({ targetStateRef: 'state:missing' }));
    assert.equal(missingTarget.status, 'UNKNOWN'); assert.deepEqual(missingTarget.unknowns, ['MISSING_CHANGE_TARGET:state:missing']); assert.equal(missingTarget.effects.length, 0);
    const missingRule = kernel.simulateCivilization({ ...model(), rules: [rule('missing', 'absent', 'truthy', true, 'food', 'food-price', 1, 'missing evidence input')] }, change());
    assert.match(missingRule.unknowns[0], /MISSING_RULE_INPUT/); assert.equal(missingRule.status, 'PARTIAL_WITH_UNKNOWNS');
  });

  test('最大推导深度硬限 5，规则是声明式白名单而非代码执行', () => {
    assert.throws(() => kernel.simulateCivilization(model(), change(), { maxDepth: 6 }), /maxDepth/);
    assert.throws(() => kernel.normalizeRule({ ...model().rules[0], op: 'eval' }), /op 非法/);
    assert.throws(() => kernel.normalizeModel({ ...model(), apiKey: 'secret' }), /未冻结字段|禁止 secret/);
  });
});

describe('W80 Narrative Filter / 多账本对账', () => {
  test('Narrative Filter 只筛结构冲突、人物代价、不可逆/关系/主题，不改写世界事实', () => {
    const simulation = kernel.simulateCivilization(model(), change()); const filtered = kernel.narrativeFilter(simulation, { themeTerms: ['migration', 'political'], limit: 10 });
    assert.equal(filtered.factMutationAllowed, false); assert.equal(filtered.modelHashBefore, simulation.modelHashBefore); assert.equal(filtered.sourceEffectCount, simulation.effects.length);
    assert.match(filtered.events[0].reasons.join(' '), /structural-conflict|character-cost|theme-match/);
    assert.ok(filtered.events.every(event => event.classification === 'DERIVED'));
  });

  test('Model / Runtime / Rendering 三账可对账；缺 Evidence 保持 UNKNOWN_OR_DIVERGED', () => {
    const simulation = kernel.simulateCivilization(model(), change()); const narrative = kernel.narrativeFilter(simulation, { themeTerms: [] });
    const allEvidence = [...new Set(simulation.effects.flatMap(effect => effect.state.evidenceRefs))];
    const good = kernel.reconcileLedgers({ model: model(), simulation, narrative, evidenceRefs: allEvidence });
    assert.equal(good.status, 'RECONCILED'); assert.equal(good.modelRuntimeRenderingSeparated, true);
    const bad = kernel.reconcileLedgers({ model: model(), simulation, narrative, evidenceRefs: [] });
    assert.equal(bad.status, 'UNKNOWN_OR_DIVERGED'); assert.ok(bad.issues.includes('MISSING_EVIDENCE')); assert.ok(bad.missingEvidence.length > 0);
  });

  test('CANON/DERIVED/ADAPTATION/SIMULATION/NON_CANON 始终显式，不发生 Narrative 自动升格', () => {
    for (const classification of ['DERIVED', 'ADAPTATION', 'SIMULATION', 'NON_CANON']) assert.equal(kernel.normalizeState({ ...state(classification, 'x', 1), classification, authorityRef: '', evidenceRefs: [] }).classification, classification);
    const simulation = kernel.simulateCivilization(model(), change()); const narrative = kernel.narrativeFilter(simulation, {});
    assert.equal(narrative.events.some(event => event.classification === 'CANON'), false);
  });

  test('主进程只开放 simulate/filter/reconcile，不建设 Civilization 数据库或渲染器', () => {
    const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8'); const preload = fs.readFileSync(new URL('../../preload/bridge.js', import.meta.url), 'utf8');
    for (const channel of ['civilization:simulate', 'civilization:filter', 'civilization:reconcile']) { assert.match(main, new RegExp(channel)); assert.match(preload, new RegExp(channel)); }
    const service = fs.readFileSync(new URL('../../main/civilization-model-service.js', import.meta.url), 'utf8'); assert.doesNotMatch(service, /writeFile|database|render/i);
  });
});
