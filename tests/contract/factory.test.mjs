// tests/contract/factory.test.mjs —— 焚诀工坊契约
// 覆盖：文体清单/焚诀组装/质量校验/CSV 解析/模板自定义
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const eng = await import('../../renderer/modules/factory/engine.js');

describe('焚诀引擎', () => {
  test('预置 5 套文体（公文/财务/小说/教案/通用）', async () => {
    const genres = await eng.listGenres();
    const names = genres.map(g => g.name);
    for (const n of ['公文', '财务报告', '小说', '教案', '通用']) assert.ok(names.includes(n), '缺 ' + n);
    // 每个模板结构完整
    for (const g of genres) {
      assert.ok(g.system_prompt && g.input_fields.length, g.name + ' 结构不完整');
      assert.ok(g.quality_checks.length, g.name + ' 缺校验项');
    }
  });

  test('母版组装：要素/契约/元变量/蓝图/校验/启动指令齐全', async () => {
    const [g] = await eng.listGenres();
    const m = eng.buildMantra(g, { title: '关于防汛的通知', recipient: '各区', body_keypoints: '1.排查', doc_type: '通知', issuer: '市局', length: '800字以内' }, '补充素材在此');
    assert.ok(m.system.includes(g.system_prompt.slice(0, 10)), 'system 含角色');
    assert.ok(m.user.includes('关于开展') === false, 'user 不含标题外的多余内容');
    assert.ok(m.user.includes('关于防汛的通知'), 'user 含标题');
    assert.ok(m.user.includes('补充素材在此'), 'user 含竹筒倒豆子素材');
    assert.ok(m.doc.startsWith('# 公文 创作模板母版'), 'doc 以创作模板母版标题开头');
    assert.ok(m.doc.includes('创作启动指令'), 'doc 含启动指令');
    assert.ok(m.doc.includes('元变量') || m.doc.includes('叙事者位置'), 'doc 含元变量');
    assert.ok(!m.doc.includes('```'), 'doc 不含嵌套代码块（元焚诀规范）');
  });

  test('质量校验：全规则类型', async () => {
    const [g] = await eng.listGenres(); // 公文
    const good = '# 关于防汛工作的通知\n\n各区：\n\n请排查隐患。特此通知。\n\n市局\n2026-07-21';
    const bad = '# 防汛安排\n\n嗯我觉得大家看看吧。哦对了顺便弄一下。';
    const r1 = eng.runQualityChecks(g, good);
    assert.ok(r1.every(x => x.pass), '合格公文应全过：' + JSON.stringify(r1.filter(x => !x.pass)));
    const r2 = eng.runQualityChecks(g, bad);
    assert.ok(r2.some(x => !x.pass), '问题公文应有未过项');
    const startsCheck = r2.find(x => x.label.includes('关于'));
    assert.ok(!startsCheck.pass, '标题不以关于开头应被拦');
  });

  test('CSV 解析：表头映射 label/id，引号转义', async () => {
    const [g] = await eng.listGenres();
    const rows = eng.parseCsvTasks('公文标题,主送机关,正文要点,文种,发文机关（落款）,篇幅\n"关于A,含逗号的通知",区局,"1.一行\n2.二行",通知,市局,800字以内\n关于B的请示,市局,要点,请示,省厅,1500字以内', g);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, '关于A,含逗号的通知');
    assert.ok(rows[0].body_keypoints.includes('一行'));
    assert.equal(rows[1].doc_type, '请示');
  });

  test('自定义文体保存结构合法', async () => {
    const tpl = {
      id: 'custom_护理记录', name: '护理记录', description: 'test',
      input_fields: [{ id: 'f_患者', label: '患者', type: 'text', required: true }],
      system_prompt: '你是护士', meta_vars: {}, output_rules: { format: 'markdown', max_length: 1000 },
      quality_checks: [{ rule: 'minLength', value: 100, label: '不少于 100 字' }],
    };
    const m = eng.buildMantra(tpl, { f_患者: '张三' }, '');
    assert.ok(m.doc.includes('# 护理记录 创作模板母版'));
    const checks = eng.runQualityChecks(tpl, '短');
    assert.equal(checks[0].pass, false);
  });
});
