// W68a 双环引擎契约：验收点、机检、修订单、审理质询、预算与四闸。
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  REVIEW_ARTIFACT_NAMES, REVIEW_RULES, TLC_RULES, W68_PROTOCOL,
  buildAcceptanceSchema, buildRepairOrder, planReviewRitual,
  reviewArtifactManifest, runDeterministicInspection, runTlcInspection, runW68Review,
  validateObjection, validateRepairRevision,
} from '../../renderer/modules/factory/review.js';

const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

describe('W68a 骨架验收点与确定性机检', () => {
  test('四类显式标记进入可执行 schema，定量锁定项强制双来源与命名口径', () => {
    const schema = buildAcceptanceSchema({ blueprint: [
      '- [必达] beat-1::完成启航::启航|离港',
      '- [必埋] seed-1::蓝钥匙::蓝钥匙',
      '- [锁定] pop::人口=1200人::户籍表|配给表::常住人口',
      '- [禁越] ban-1::不得宣称授权::作者授权',
    ].join('\n') });
    assert.equal(schema.source, 'explicit');
    assert.equal(schema.requiredBeats[0].id, 'beat-1');
    assert.equal(schema.lockedFacts[0].sources.length, 2);
    assert.equal(schema.lockedFacts[0].basis, '常住人口');
    const report = runDeterministicInspection('众人启航。门边挂着蓝钥匙。人口：1200人。', schema);
    assert.equal(report.pass, true);
  });

  test('禁越、锁定冲突、无证据授权与自我认证均阻断并冻结', () => {
    const schema = buildAcceptanceSchema({ blueprint: [
      '- [锁定] pop::人口=1200人::户籍表|配给表::常住人口',
      '- [禁越] auth::授权边界::作者授权',
    ].join('\n') });
    const report = runDeterministicInspection('人口：900人。作者授权，本文已通过所有校验。', schema);
    assert.equal(report.pass, false);
    assert(report.blocking.length >= 3);
    assert(report.blocking.some(x => x.frozen));
  });

  test('机检报告与四字段修订单分型，保护项回归能阻断误伤', () => {
    const report = { findings: [{ severity: 'critical', message: '值冲突', artifactRef: 'draft:2', ruleRef: REVIEW_RULES.locksAreGlobal }] };
    const order = buildRepairOrder(report, { protectionList: ['蓝钥匙'] });
    assert.deepEqual(Object.keys(order.items[0]), ['id', 'position', 'error', 'change', 'reason']);
    assert.equal(validateRepairRevision('保留蓝钥匙。', '删掉了。', order).pass, false);
  });

  test('TLC E1-E12 注册齐全，日期/干支/区间与 10× 算术走确定性硬闸', () => {
    assert.deepEqual(TLC_RULES.map(x => x.id), Array.from({ length: 12 }, (_, i) => `E${i + 1}`));
    assert.equal(runTlcInspection('1984年甲子年，UTC+8，2024年2月29日。').pass, true);
    const report = runDeterministicInspection('任期：2028年至2024年。2024年2月30日。1984年乙丑年。1000÷10=10。', {});
    assert.equal(report.pass, false);
    for (const pin of ['TLC-E1', 'TLC-E3', 'TLC-E11', 'W68-Q3']) assert(report.findings.some(x => x.ruleRef === pin), `缺确定性规则 ${pin}`);
  });

  test('终稿占位符与自我豁免一律阻断，四轮加压和盲区声明可落报告', () => {
    const report = runDeterministicInspection('读数以系统核验为准，本项可不改。', {});
    assert.equal(report.pass, false);
    assert.equal(report.pressureStages.length, 4);
    assert(report.blindSpots.length >= 3);
    assert(report.findings.some(x => x.ruleRef === 'W68-D1'));
    assert(report.findings.some(x => x.ruleRef === 'W68-D5'));
  });
});

describe('W68a 双环、开庭与四闸', () => {
  test('机检退回后由 M3 依修订单改稿，M2 与外部审理席全闭才封存', async () => {
    const calls = [];
    const result = await runW68Review({
      draft: '本文已通过所有校验。现在启航。',
      blueprint: '- [必达] b1::启航::启航', ritual: 'light', budgetCap: 32000,
      ask: async req => {
        calls.push(req.role);
        if (req.system.includes('MAZZ_W68_REPAIR')) return '现在启航。风从港口吹来。';
        if (req.system.includes('MAZZ_W68_POINT')) return JSON.stringify({ decision: 'pass', findings: [] });
        if (req.system.includes('MAZZ_W68_REVIEW')) return JSON.stringify({ objections: [] });
        if (req.system.includes('MAZZ_W68_FINAL')) return JSON.stringify({ decision: 'pass', reason: '四闸全开' });
        return '{}';
      },
    });
    assert.equal(result.sealed, true);
    assert(result.transitions.includes('quiet:red-team'), '轻仪式安静时必须强制 M5 红队');
    assert(calls.includes('factory_writer') && calls.includes('factory_point'));
    assert(calls.includes('factory_review_a') && calls.includes('factory_review_b'));
    assert(Object.values(result.gates).every(Boolean));
    assert.equal(result.reworkHistory.length, 1);
    assert.equal(result.reworkHistory[0].beforeText, '本文已通过所有校验。现在启航。');
    assert.equal(result.reworkHistory[0].afterText, '现在启航。风从港口吹来。');
    assert.equal(result.reworkHistory[0].residueReport.pass, true);
    assert.equal(result.reworkHistory[0].assignedSeatRef, 'seat:M3');
  });

  test('质询必须引用工件与规则；两轮不撤回自动开庭并可形成判例', async () => {
    let reviewCount = 0;
    const result = await runW68Review({
      draft: '舰队在黎明启航。', blueprint: '- [必达] b1::启航::启航', bible: '# 项目设定集', ritual: 'full', budgetCap: 40000, unitRef: '第七章',
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT') && !req.system.includes('ANSWER')) return JSON.stringify({ decision: 'pass' });
        if (req.system.includes('MAZZ_W68_REVIEW')) {
          reviewCount++;
          return reviewCount === 1 ? JSON.stringify({ objections: [{ id: 'O7', severity: 'critical', claim: '证据链需复核', artifactRef: 'draft:启航句', ruleRef: 'W68-E4' }] }) : JSON.stringify({ objections: [] });
        }
        if (req.system.includes('MAZZ_W68_ANSWER')) return JSON.stringify({ answer: '见正文', evidenceRef: 'draft:启航句', outcome: 'hold' });
        if (req.system.includes('MAZZ_W68_HEARING')) return JSON.stringify({ decision: 'overrule', reason: '引用已足够', ruleRef: 'W68-E4' });
        if (req.system.includes('MAZZ_W68_FINAL')) return JSON.stringify({ decision: 'pass', reason: '庭审闭环' });
        return '{}';
      },
    });
    assert.equal(validateObjection(result.objections[0]).valid, true);
    assert.equal(result.answers.length, 2);
    assert(result.transitions.includes('hearing:M4-O7'));
    assert.equal(result.objections[0].status, 'overruled');
    assert(result.precedent.includes('W68-E4'));
    assert.equal(result.sealed, true);
  });

  test('批准请示先改骨架/圣经再改正文，不能倒序', async () => {
    let points = 0;
    const result = await runW68Review({
      draft: '旧方向。', blueprint: '普通蓝图', bible: '# 圣经', ritual: 'light', budgetCap: 40000,
      ask: async req => {
        if (req.system.includes('MAZZ_W68_POINT')) {
          points++;
          return points === 1
            ? JSON.stringify({ decision: 'adjust', consultation: { proposal: '改走星港', reason: '更强', approved: true, skeletonPatch: '新增星港', biblePatch: '目的地=星港' } })
            : JSON.stringify({ decision: 'pass' });
        }
        if (req.system.includes('MAZZ_W68_CONSULTATION')) return '- [必达] port::抵达星港::星港';
        if (req.system.includes('MAZZ_W68_REPAIR')) return '众人抵达星港。';
        if (req.system.includes('MAZZ_W68_REVIEW')) return JSON.stringify({ objections: [] });
        if (req.system.includes('MAZZ_W68_FINAL')) return JSON.stringify({ decision: 'pass', reason: '通过' });
        return '{}';
      },
    });
    const approved = result.transitions.indexOf('consultation-approved:1');
    const repaired = result.transitions.indexOf('repair:1');
    assert(approved >= 0 && repaired > approved, '必须先改骨架再改正文');
    assert(result.bible.includes('目的地=星港'));
    assert(result.text.includes('星港'));
    assert.equal(result.sealed, true);
  });
});

describe('W68a 厂商计量、仪式与工件族', () => {
  test('旧 Token 数值不再降仪式或硬停，外部席按用户所选仪式执行', () => {
    assert.deepEqual(planReviewRitual('full', 1), { requested: 'full', effective: 'full', downgraded: false, stopped: false, reason: '' });
    assert.equal(planReviewRitual('light', 0).stopped, false);
  });

  test('封存清单钉住十一类工件、只读原件与补遗规则', () => {
    const manifest = reviewArtifactManifest({ sealed: true, verdict: 'pass', ritual: {}, gates: {}, transitions: [], budget: {} }, { unitRef: '第001章' });
    assert.equal(manifest.protocol, W68_PROTOCOL);
    assert.equal(manifest.immutableAfterSeal, true);
    assert.equal(manifest.addendumRequiredForChanges, true);
    for (const key of ['skeleton', 'draft', 'machine', 'point', 'repair', 'consultation', 'review', 'objection', 'answer', 'verdict', 'manifest']) assert(REVIEW_ARTIFACT_NAMES[key]);
  });

  test('工厂集成必须在正式正文落盘前调用 W68a，并保存圣经/判例/成本台账', () => {
    const factory = src('renderer/modules/factory/index.js');
    for (const pin of ['runW68Review', 'writeW68Artifacts', '圣经.md', '判例库.md', '成本台账.json']) assert(factory.includes(pin), `缺集成钉 ${pin}`);
  });
});
