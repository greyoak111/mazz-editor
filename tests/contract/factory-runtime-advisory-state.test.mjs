// Factory runtime state contract: quantities are advisory; safety stays provider/protocol-owned.
import './_setup.mjs';
import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';
import {
  factoryTaskState,
  makeRecoveredFactoryTask,
  normalizeFactoryAdvisoryTargets,
  normalizeFactoryMode,
  shouldContinueFactoryUnits,
} from '../../renderer/modules/factory/task-registry.js';

const read = relative => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

describe('Factory 新项目状态默认不指定篇幅且不连写', () => {
  test('缺失模式是 single，缺失数值不会生成建议或预算', () => {
    assert.equal(normalizeFactoryMode(), 'single');
    const state = factoryTaskState({ id: 'fresh', label: '新项目' }, { status: 'paused' });
    assert.equal(state.mode, 'single');
    assert.equal(state.maxChapters, 0);
    assert.equal(state.totalWords, undefined);
    assert.equal(state.wordsPerUnit, undefined);
    assert.equal(state.reviewBudgetCap, undefined);
    assert.equal(state.advisoryTargets, undefined);
  });

  test('旧字段兼容落盘，但只镜像到 advisoryTargets', () => {
    const state = factoryTaskState({
      id: 'legacy', label: '旧项目', mode: 'max', maxChapters: 5,
      totalWords: 10000, wordsPerUnit: 2000, lengthPreset: 'short', reviewBudgetCap: 32000,
    });
    assert.equal(state.totalWords, 10000);
    assert.equal(state.wordsPerUnit, 2000);
    assert.equal(state.reviewBudgetCap, 32000);
    assert.deepEqual(state.advisoryTargets, {
      totalWords: 10000, wordsPerUnit: 2000, plannedUnits: 5,
      lengthPreset: 'short', reviewBudgetTokens: 32000,
    });
    assert.deepEqual(normalizeFactoryAdvisoryTargets({}, {}), undefined);
  });

  test('恢复缺失 mode 不再凭空变连写，旧 unlimited 声明仍可恢复', () => {
    assert.equal(makeRecoveredFactoryTask({ id: 'one', status: 'paused', maxChapters: 0 }).mode, 'single');
    assert.equal(makeRecoveredFactoryTask({ id: 'many', status: 'paused', maxChapters: 3 }).mode, 'max');
    assert.equal(makeRecoveredFactoryTask({ id: 'open', status: 'paused', lengthPreset: 'unlimited' }).mode, 'max');
  });
});

describe('Factory 连写循环没有无限哨兵', () => {
  test('有限计划只决定单元数，无限计划由 stop hook 有界终止', () => {
    assert.equal(shouldContinueFactoryUnits({ unitNo: 2, maxChapters: 2 }), true);
    assert.equal(shouldContinueFactoryUnits({ unitNo: 3, maxChapters: 2 }), false);
    let probes = 0;
    const shouldStop = () => ++probes > 4;
    let units = 0;
    for (let i = 1; shouldContinueFactoryUnits({ unlimited: true, unitNo: i, shouldStop }); i++) units++;
    assert.equal(units, 4);
    assert.equal(probes, 5);
  });
});

describe('Factory UI/runtime 不再按字数或 Token 改写流程', () => {
  const index = read('renderer/modules/factory/index.js');
  const desk = read('renderer/modules/factory/desk.js');
  const shell = read('renderer/shell/shell.js');
  const maz = read('renderer/modules/factory/maz.js');

  test('新项目 snapshot 不发布固定档位，单篇与空数值是唯一默认', () => {
    assert(index.includes("this.lengthPlan = unspecifiedLengthPlan()"));
    assert(index.includes('lengthPresets: []') && index.includes('wordsPerUnitChips: []'));
    assert(index.includes('class="fc-maxmode"> 连写模式'));
    assert(!index.includes('class="fc-maxmode" checked'));
    assert(!shell.includes("resolveFactoryLengthPlan({ preset: 'short' })"));
    assert(!shell.includes('|| 32000'));
    for (const stale of ['fc-review-budget', 'fc-length-cards', 'fc-length-chips', 'data-length', 'data-words', 'setReviewBudget', 'setLengthPreset']) {
      assert(!index.includes(stale), `index 仍暴露旧项目控件：${stale}`);
      assert(!shell.includes(stale), `shell 仍转发旧项目动作：${stale}`);
    }
  });

  test('运行时无产品 maxTokens、字符门、固定预算或无限哨兵', () => {
    for (const source of [index, desk, shell]) {
      assert.equal(/\bmaxTokens\s*:/.test(source), false);
      assert.equal(source.includes('999999'), false);
      assert.equal(source.includes('32000'), false);
    }
    for (const stale of [
      'validateNativeContinuationDeclaration', '本次续写字数',
      'length >= 100', 'length >= 10', 'length < 10', 'slice(-800)',
      'evaluateBudgetCap', 'makeBudgetCard',
    ]) assert.equal(index.includes(stale), false, `index 仍含旧门禁：${stale}`);
    assert(index.includes('providerCompletionReady(completion)'));
    assert(index.includes('stripTokenDeclaration(completion.text)'));
    assert(index.includes('shouldContinueFactoryUnits({'));
    assert(index.includes('tpl = runtimeTemplate(tpl)'));
    assert(!index.includes('max_length: 3000'));
    assert(!index.includes('minLength:500'));
    assert(!maz.includes('max_length: 3000'));
  });

  test('参考字数不换算执行单元，连写以蓝图大纲自然收口', () => {
    assert.equal(index.includes('Math.ceil'), false);
    assert(index.includes('const wordDerivedPlan ='));
    assert(index.includes('const explicitPlannedUnits = wordDerivedPlan ? 0 : legacyMaxChapters'));
    assert(index.includes('const plannedUnits = explicitPlannedUnits || outlines.length'));
    assert(index.includes('maxChapters: 0'));
    assert(!index.includes('章节大纲必须恰好'));
  });

  test('旧预算卡只能展示，不能降级或停产', () => {
    assert(!desk.includes('budget:degrade'));
    assert(!desk.includes('budget:stop'));
    assert(!desk.includes('reviewBudgetDecision'));
    assert(!desk.includes('evaluateBudgetCap'));
    assert(!desk.includes('设置月度配额'));
    assert(!desk.includes('quotaTokens: costs.monthlyQuotaTokens'));
    assert(!desk.includes("kind: 'estimate', taskRef"));
    assert(desk.includes('Provider usage 尚未回供'));
  });
});
