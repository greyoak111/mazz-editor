// tests/contract/hotfix-w60a.test.mjs —— W60a 引擎对齐波契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const eng = await import('../../renderer/modules/factory/engine.js');
const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('W60a 蓝图双通道与结构单元', () => {
  test('novel 19 键 / META 8 键按家族选表，第三方任一通过', () => {
    const novel = '故事标题 简介 核心价值 主角 配角 世界观 三幕 章节 文风 节奏';
    const meta = '任务目标 目标读者 核心材料 结构大纲 核心要点 论据数据 术语口径 质量校验';
    assert(eng.blueprintStructureOk(novel, 'novel'), 'novel 完整蓝图应通过');
    assert(!eng.blueprintStructureOk(meta, 'novel'), 'META 蓝图不可冒充 novel');
    assert(eng.blueprintStructureOk(meta, 'meta'), 'META 完整蓝图应通过');
    assert(!eng.blueprintStructureOk('任务目标 目标读者 核心材料', 'meta'), 'META 少于 4 键必须失败');
    assert(eng.blueprintStructureOk(meta, 'auto'), '第三方文体应允许 META 通道');
  });

  test('snapshotSchema 默认 narrative 零回归，expository 四账齐', () => {
    assert.deepEqual(eng.getSnapshotSchema({}), {
      unitName: '章', type: 'narrative', sections: ['人物状态', '伏笔台账', '时间线', '冲突线'],
    });
    assert.deepEqual(eng.getSnapshotSchema({ unitName: '节', snapshotType: 'expository' }), {
      unitName: '节', type: 'expository', sections: ['要点台账', '术语与数据一致性', '论据与引用台账', '结构完成度'],
    });
    assert(eng.canUseUnlimited({ snapshotType: 'narrative' }), '叙事类可无限连写');
    assert(!eng.canUseUnlimited({ snapshotType: 'expository' }), '说明类不可无限连写');
  });
});

describe('W60a TOKEN_DECLARATION 与兜底', () => {
  test('声明缺失自动补；声明优先于去重续写终止', () => {
    const filled = eng.ensureTokenDeclaration('正文甲乙');
    assert(filled.endsWith('[本次续写字数：4]'), '应按正文实长自动补声明：' + filled);
    assert.equal(eng.tokenDeclarationOf(filled), 4);
    assert.equal(eng.stripTokenDeclaration(filled), '正文甲乙');
    const done = eng.mergeDeclaredContinuation('已有正文\n[本次续写字数：4]', '不得拼入');
    assert(done.complete && done.text.includes('已有正文') && !done.text.includes('不得拼入'), '已有声明必须立即终止');
  });

  test('三败兜底同时覆盖 narrative / expository', () => {
    const story = eng.buildFallbackBlueprint({ label: '书', values: {} }, 2, { unitName: '章', snapshotType: 'narrative' });
    assert(story.includes('第1章') && story.includes('创作启动指令'), '叙事兜底不完整');
    const report = eng.buildFallbackBlueprint({ label: '实验报告', values: {} }, 3, { unitName: '节', snapshotType: 'expository' });
    for (const key of ['任务目标', '核心材料', '结构大纲', '论据数据', '术语口径', '质量校验', '第1节']) {
      assert(report.includes(key), '说明类兜底缺 ' + key);
    }
    assert(eng.blueprintStructureOk(report, 'meta'), '说明类兜底必须能通过 META 校验');
  });
});

describe('W60a 六层锚与快照', () => {
  test('六层顺序固定，窗口只取 N±3，纠偏只在末层', () => {
    const outlines = Array.from({ length: 12 }, (_, i) => `第${i + 1}章：事项${i + 1}`);
    const cp = eng.buildChapterPromptV2({
      constantAnchor: '恒定核心', outlines, stateSummary: '滚动快照', foreshadowLedger: '伏笔A（未回收）',
      outline: outlines[6], chapterNo: 7, total: 12, wordsPerChapter: 2000, title: '书',
      correctionDirective: '纠偏：视角回正', snapshotSchema: eng.getSnapshotSchema({}),
    });
    const labels = ['第一层：恒定锚', '第二层：窗口锚', '第三层：滚动快照', '第四层：伏笔台账', '第五层：本章任务与 TOKEN 声明', '第六层：纠偏指令'];
    let at = -1;
    for (const label of labels) { const next = cp.system.indexOf(label); assert(next > at, '六层次序错误：' + label); at = next; }
    assert(cp.system.includes('第4章') && cp.system.includes('第10章'), 'N±3 窗口边界缺失');
    assert(!cp.system.includes('第3章') && !cp.system.includes('第11章'), '窗口泄漏到 N±4');
    assert(cp.system.includes('[本次续写字数：N]'), 'TOKEN 声明协议未注入');
    const anchor = eng.buildConstantAnchor('核心'.repeat(400), '绝对禁止事项：保留视角规则。'.repeat(30));
    assert(anchor.length <= 800 && anchor.includes('核心') && anchor.includes('绝对禁止事项'), '恒定锚必须在 800 字内同时保住核心与指令');
  });

  test('expository 快照提示使用四账且伏笔/台账只增不减', () => {
    const sp = eng.buildStateSummaryPrompt('旧台账', '新正文', 2, eng.getSnapshotSchema({ unitName: '节', snapshotType: 'expository' }));
    for (const name of ['要点台账', '术语与数据一致性', '论据与引用台账', '结构完成度']) assert(sp.user.includes(name), '缺快照分区 ' + name);
    assert(sp.user.includes('只增不减') && sp.user.includes('回收标注'), '累计台账纪律未注入');
    const ledger = eng.extractLedgerFromSnapshot('## 要点台账\n- A\n\n## 论据与引用台账\n- 证据1\n\n## 结构完成度\n- 1/2', { type: 'expository' });
    assert(ledger.includes('证据1') && !ledger.includes('1/2'), '第四层应只提取对应台账，不重复整份快照');
  });

  test('index 运行链接入家族、Schema、兜底与声明收口', () => {
    const src = readSrc('renderer/modules/factory/index.js');
    for (const pin of ['blueprintFamily(', 'getSnapshotSchema(', 'canUseUnlimited(tpl)', 'buildFallbackBlueprint(', 'mergeDeclaredContinuation(', 'stripTokenDeclaration(']) {
      assert(src.includes(pin), 'index 缺运行链接线：' + pin);
    }
    assert.match(src, /task\.doneChapters\}\s+\$\{snapshotSchema\.unitName\}/, '连写收尾必须沿用本次运行的结构单元，不能引用游离变量');
    assert(src.includes('async function readOptionalFile') && src.includes("invoke('fs:stat'"), '可缺文件必须先 stat，不得用主进程异常做流程控制');
  });

  test('E2E 本地模拟口只在 test+显式开关下启用', () => {
    const src = readSrc('main/main.js');
    assert(src.includes("process.env.NODE_ENV === 'test' && process.env.MAZZ_E2E_FACTORY_MOCK === '1'"), 'mock 必须双闸隔离');
    assert(src.includes('factoryMockReply'), 'mock 响应器必须存在');
    assert(!readSrc('tests/e2e/scenes71.mjs').includes('sk-'), 'W60a E2E 禁止携带真 key');
    assert(src.indexOf("app.setPath('userData'") < src.indexOf('app.requestSingleInstanceLock()'), 'E2E userData 必须在单实例锁前生效');
  });
});
