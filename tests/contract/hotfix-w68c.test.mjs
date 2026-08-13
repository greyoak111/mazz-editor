// W68c 指令闸+终审卡契约：四族、澄清、锁定 diff、终审、预算帽、求助三时刻与七指标。
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  FACTORY_COMMAND_FAMILIES, FACTORY_HEALTH_METRICS, HUMAN_HELP_MOMENTS,
  buildLineDiff, buildLockedBibleProposal, classifyFactoryInstruction, computeFactoryHealth,
  detectHumanHelpMoments, evaluateBudgetCap, makeBudgetCard, makeClarificationCard,
  makeDiffConfirmationCard, makeFinalReviewCard,
} from '../../renderer/modules/factory/command-gate.js';
import { appendFactoryArchiveText, normalizeFactoryEvent, parseFactoryArchive } from '../../renderer/modules/factory/workshop.js';

const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

describe('W68c 聊天皮、状态机芯', () => {
  test('自然语言确定性映射生产/立法/质检/闲聊四族', () => {
    assert.deepEqual(FACTORY_COMMAND_FAMILIES, ['production', 'legislation', 'quality', 'chat']);
    assert.equal(classifyFactoryInstruction('写明天的第三章').family, 'production');
    assert.equal(classifyFactoryInstruction('以后护航编队按东海系命名').family, 'legislation');
    assert.equal(classifyFactoryInstruction('这段咋样').family, 'quality');
    assert.equal(classifyFactoryInstruction('你好，辛苦了').family, 'chat');
  });

  test('无动作词与多族冲突都必须二选一，强制选择后才放行', () => {
    const vague = classifyFactoryInstruction('第三章');
    assert.equal(vague.ambiguous, true);
    assert.deepEqual(vague.options, ['production', 'quality']);
    assert.equal(makeClarificationCard('第三章', vague.options).options.length, 2);
    assert.equal(classifyFactoryInstruction('第三章', { forcedFamily: 'quality' }).family, 'quality');
  });

  test('闲聊分支在 Desk 明示零动作，只有生产族会转交执行器', () => {
    const desk = src('renderer/modules/factory/desk.js');
    assert(desk.includes('闲聊收讫 · 零动作'));
    assert(desk.includes('未调用模型、未触发生产、未改动文件'));
    assert(desk.includes("if (decision.family === 'production') await forwardProduction(text)"));
  });
});

describe('W68c 锁定 diff 与可恢复卡', () => {
  test('立法只生成改前/改后 diff，不在纯内核里偷写圣经', () => {
    const before = '# 圣经\n\n## 锁定事实\n\n- 舰名＝海岳\n';
    const proposal = buildLockedBibleProposal(before, '以后护航编队按东海系命名', { at: '2026-08-13T12:00:00.000Z' });
    assert.equal(before.includes('东海系'), false);
    assert(proposal.after.includes('东海系命名'));
    const diff = buildLineDiff(proposal.before, proposal.after);
    assert(diff.includes('+++ b/圣经.md') && diff.includes('+ - 以后护航编队按东海系命名'));
    assert.equal(makeDiffConfirmationCard({ before: proposal.before, after: proposal.after }).kind, 'diff-confirm');
  });

  test('确认卡元数据随工厂群 Markdown 往返，关闭重开仍能处理', () => {
    const card = makeDiffConfirmationCard({ targetPath: 'D:/Output/圣经.md', before: '# 圣经\n', after: '# 圣经\n\n- 新规\n', instruction: '记入新规' });
    const event = normalizeFactoryEvent({ id: 'lock-1', type: 'help', title: '锁定变更', content: card.diff, stage: 'lock-pending', family: 'legislation', card });
    const rows = parseFactoryArchive(appendFactoryArchiveText('', event));
    assert.equal(rows[0].card.kind, 'diff-confirm');
    assert.equal(rows[0].card.targetPath, 'D:/Output/圣经.md');
    assert.equal(rows[0].family, 'legislation');
  });
});

describe('W68c 终审、求助与预算帽', () => {
  test('待终审卡钉死全文/双审/机检三件与三钮', () => {
    const card = makeFinalReviewCard({ unitNo: 3, unitName: '章', targetPath: '第003章.md', targetPrefix: '# 第三章\n\n', draftPath: '02-扩写稿.md', reviewPath: '07-审理表.md', machinePath: '03-机检报告.md', eventDay: true });
    assert.deepEqual(card.actions, ['seal', 'return', 'hold']);
    assert.equal(card.eventDay, true);
    const factory = src('renderer/modules/factory/index.js');
    for (const pin of ['## 全文', '## 双审意见', '## 机检报告', 'appendW68FinalReview']) assert(factory.includes(pin), `终审三件缺 ${pin}`);
    const desk = src('renderer/modules/factory/desk.js');
    for (const pin of ['final:seal', 'final:return', 'final:hold', '终审状态.json']) assert(desk.includes(pin), `终审动作缺 ${pin}`);
  });

  test('主动 @human 仅由三轮不收敛/开庭互矛盾/红队盲区三时刻生成', () => {
    assert.deepEqual(Object.values(HUMAN_HELP_MOMENTS), ['三轮不收敛', '开庭互矛盾', '红队系统性盲区']);
    const moments = detectHumanHelpMoments({
      machineHistory: [{}, {}, {}], repairs: [{}, {}, {}], machine: { pass: false }, reviews: [{}],
      objections: [{ status: 'open', hearing: { decision: 'sustain' } }], gates: { machine: false, point: false },
    });
    assert.deepEqual(moments.map(x => x.id), ['nonconvergent', 'hearingConflict']);
    assert.deepEqual(detectHumanHelpMoments({ reviews: [{}], objections: [], gates: { machine: false, point: true } }).map(x => x.id), ['redBlindspot']);
  });

  test('预算帽正常/降级/硬停三态，超帽只给降级或停摆', () => {
    assert.equal(evaluateBudgetCap({ capTokens: 32000, usedTokens: 1000, requestedRitual: 'full' }).status, 'ok');
    const degrade = evaluateBudgetCap({ capTokens: 12000, usedTokens: 1000, requestedRitual: 'full' });
    assert.equal(degrade.status, 'degrade');
    assert.deepEqual(makeBudgetCard({ capTokens: 12000, usedTokens: 1000, requestedRitual: 'full' }).actions, ['degrade', 'stop']);
    assert.equal(evaluateBudgetCap({ capTokens: 7999, usedTokens: 0 }).status, 'stop');
    const factory = src('renderer/modules/factory/index.js');
    assert(factory.includes("window.addEventListener('mazz:factory-task-updated'"), 'Desk 决定必须回写生产面板内存态');
    assert(factory.includes("patch.status === 'paused' && this.runningTasks.has(taskId)"), '停摆决定必须触发在飞生产终止');
  });
});

describe('W68c 健康看板', () => {
  test('七指标名称/目标固定，并从群档事件自动记账', () => {
    assert.deepEqual(FACTORY_HEALTH_METRICS.map(x => x.label), ['机检打回率', '审理打回率', '开庭率', '修订一次通过率', '质询有效率', '撤回引据率', '人类介入频次']);
    const at = '2026-08-13T10:00:00.000Z';
    const events = [
      normalizeFactoryEvent({ id: 'm1', type: 'review', stage: 'machine', content: '未通过：阻断', unitNo: 1, createdAt: at }),
      normalizeFactoryEvent({ id: 'r1', type: 'review', stage: 'repair', content: '修订', unitNo: 1, createdAt: at }),
      normalizeFactoryEvent({ id: 'o1', type: 'review', stage: 'objection', tone: 'disagreement', content: '有效质询', unitNo: 1, createdAt: at }),
      normalizeFactoryEvent({ id: 'a1', type: 'review', stage: 'answer', tone: 'evidence', content: '根据证据撤回 withdraw', unitNo: 1, createdAt: at }),
      normalizeFactoryEvent({ id: 'h1', type: 'verdict', stage: 'hearing', content: '裁决', unitNo: 1, createdAt: at }),
      normalizeFactoryEvent({ id: 'f1', type: 'verdict', stage: 'final-human', content: '入库', unitNo: 1, createdAt: at }),
    ];
    const health = computeFactoryHealth(events, { now: Date.parse('2026-08-13T12:00:00.000Z') });
    assert.equal(health.length, 7);
    assert.equal(health.find(x => x.id === 'machineReturnRate').value, 100);
    assert.equal(health.find(x => x.id === 'humanInterventionCount').display, '1 次');
    assert(src('renderer/modules/factory/desk.js').includes('fd-health-grid'));
  });
});
