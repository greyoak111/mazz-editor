// Factory 数量去门禁合同：数值只能是用户主动选择的规划参考。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import {
  buildChapterPromptV2,
  buildConstantAnchor,
  buildEmbedBlocks,
  buildFallbackBlueprint,
  buildMantra,
  buildMetaBlueprintPrompt,
  buildNovelBlueprintPrompt,
  buildStateSummaryPrompt,
  dedupMerge,
  ensureTokenDeclaration,
  normalizePluginQuantityGuidance,
  parseChapterOutlines,
  renderPluginPrompt,
  resolveFactoryLengthPlan,
  runQualityChecks,
  validateNativeContinuationDeclaration,
} from '../../renderer/modules/factory/engine.js';
import { NOVEL_PLUGINS } from '../../renderer/modules/factory/plugins.js';

const read = relative => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

describe('Factory 新项目不预填数量配额', () => {
  test('缺值是 custom/single/无字数，只有显式选预设才带建议值', () => {
    const blank = resolveFactoryLengthPlan();
    assert(blank.preset === 'custom' && blank.totalWords === 0 && blank.wordsPerUnit === 0, `新项目仍偷填字数：${JSON.stringify(blank)}`);
    assert(blank.maxMode === false && blank.maxChapters === 0, '无字数新项目不得默认连写');
    const short = resolveFactoryLengthPlan({ preset: 'short' });
    assert(short.totalWords === 10000 && short.wordsPerUnit === 2000 && !short.maxMode && short.maxChapters === 0, '兼容预设只能给参考值，不得暗开连写或换算终点');
    const continuous = resolveFactoryLengthPlan({ maxMode: true, totalWords: 10000, wordsPerUnit: 2000 });
    assert(continuous.maxMode && continuous.maxChapters === 0, '用户显式连写后仍不得按字数换算硬终点');
    const tiny = resolveFactoryLengthPlan({ preset: 'custom', totalWords: 1, wordsPerUnit: 1 });
    assert(tiny.totalWords === 1 && tiny.wordsPerUnit === 1, '数量建议仍被 1/100 隐式下限改写');
  });

  test('立项 UI 无字数 min/required、无末章补齐承诺、无新审校预算', () => {
    const panel = read('renderer/panels/factorycfg.html');
    assert(!/id="pj-(?:total|words)"[^>]*\bmin=/.test(panel), '篇幅输入仍用 min 拦截');
    assert(!/id="pj-(?:total|words)"[^>]*\brequired\b/.test(panel), '篇幅输入仍是必填');
    assert(!panel.includes('末${esc(unitName)}按剩余字数安排'), 'UI 仍承诺末单元按余数硬凑');
    assert(panel.includes('数值只用于预览内容单元规划'), '可选指导语义未显示');
    assert(!panel.includes('pj-review-budget') && !panel.includes('reviewBudgetCap:'), '新立项仍预填/提交审校 token 预算');
    assert(!panel.includes('maxTokens: 32') && !panel.includes('用四个字回答'), '连通测试仍制造产品态 token/字数上限');
    assert(panel.includes("preset: 'custom', totalWords: 0, wordsPerUnit: 0"), '独立立项窗仍以 short 作缺省值');
    assert(!/length-cards|length-card|data-preset|formatPresetTotal/.test(panel), '新立项仍展示短/中/长/无限档位卡');
    assert(!/word-chips|data-words|wordsPerUnitChips/.test(panel), '新立项仍展示硬编码单元字数快捷值');
    assert(panel.includes('id="pj-max"') && panel.includes('连写（关闭即单篇）'), '单篇/连写开关缺失');
    assert(panel.includes("'篇幅长短', '每章字数', '目标总字数'") && panel.includes('filter(isProjectContentField)'), '旧模板篇幅字段仍可能与两个参考输入竞争');
  });

  test('蓝图缺数量时不偷填十个单元，解析不截长行或第1000项', () => {
    const novel = buildNovelBlueprintPrompt({ 书名: '无定长作品' });
    const meta = buildMetaBlueprintPrompt({ name: '报告', snapshotType: 'expository', input_fields: [] }, {});
    assert(!novel.includes('恰好是') && !novel.includes('10章'), '小说蓝图仍偷填固定十章');
    assert(novel.includes('自行决定章节数量'), '小说蓝图没有把终点交给内容');
    assert(!meta.includes('列出 10 个') && meta.includes('不预设数量'), 'META 蓝图仍偷填固定十节');
    const longTail = '长纲要'.repeat(60);
    const outlines = Array.from({ length: 1001 }, (_, i) => `第${i + 1}章：${i ? '推进' : longTail}`).join('\n');
    const parsed = parseChapterOutlines(outlines);
    assert(parsed.length === 1001, `蓝图解析仍有数量上限：${parsed.length}`);
    assert(parsed[0].includes(longTail), '长纲要行仍被字符门限丢弃');
    assert(parseChapterOutlines('没有章节行', 10).length === 0, '解析失败仍用隐藏十章占位');
  });
});

describe('Factory 数量规则不再关闭内容闸', () => {
  const legacyTemplate = {
    name: '旧模板',
    description: '',
    system_prompt: '完成用户任务。',
    input_fields: [
      { id: 'task', label: '任务', required: true },
      { id: 'length', label: '旧篇幅', uiOwner: 'lengthPlan', default: '1500字片段' },
      { id: '每章字数', label: '每章字数', uiOwner: 'lengthPlan', default: '2000' },
    ],
    meta_vars: {},
    output_rules: { format: 'markdown', max_length: 3000, structure: '开头 → 结尾' },
    quality_checks: [
      { rule: 'minLength', value: 500, label: '不少于500字' },
      { rule: 'maxLength', value: 800, label: '不超过800字' },
      { rule: 'maxParagraphs', value: 2, label: '不超过2段' },
      { rule: 'notAllDialog', label: '对话比例门' },
    ],
  };

  test('旧 min/max/段数/对话比例仅兼容读取，不再失败', () => {
    const results = runQualityChecks(legacyTemplate, '“好。”');
    assert(results.length === 4 && results.every(row => row.pass), `旧数量规则仍形成机检门：${JSON.stringify(results)}`);
  });

  test('旧隐藏篇幅和 output max 不再进入执行 prompt', () => {
    const mantra = buildMantra(legacyTemplate, { task: '写完事件', length: '1500字片段', 每章字数: '2000' });
    const prompt = `${mantra.system}\n${mantra.user}\n${mantra.doc}`;
    for (const stale of ['1500字片段', '2000', '3000 字以内', '不少于500字', '不超过2段']) {
      assert(!prompt.includes(stale), `旧数量门仍注入 prompt：${stale}`);
    }
    assert(prompt.includes('不设字数、字符数、段数或对话比例门禁'), '新的非门禁语义缺失');
    const metaPrompt = buildMetaBlueprintPrompt({ ...legacyTemplate, snapshotType: 'expository' }, { task: '写完事件', length: '1500字片段', 每章字数: '2000' });
    assert(!metaPrompt.includes('1500字片段') && !metaPrompt.includes('每章字数：2000'), 'META 蓝图仍投喂旧隐藏篇幅');
    const fallback = buildFallbackBlueprint({ label: '旧任务', values: { task: '写完事件', length: '1500字片段', 每章字数: '2000' } }, 2, { ...legacyTemplate, snapshotType: 'expository' });
    assert(!fallback.includes('1500字片段') && !fallback.includes('；2000'), '兜底蓝图仍投喂旧隐藏篇幅');
  });

  test('内置文体不再定义数量门或隐藏篇幅预填', () => {
    const genreSources = ['xiaoshuo', 'gongwen', 'caiwu', 'jiaoan', 'tongyong']
      .map(name => read(`renderer/modules/factory/genres/${name}.js`)).join('\n');
    assert(!/max_length|minLength|maxLength|maxParagraphs|notAllDialog/.test(genreSources), '内置文体仍定义数量门');
    assert(!/id:\s*'(?:length|篇幅长短|每章字数)'/.test(genreSources), '内置文体仍保留与立项参考输入竞争的篇幅字段');
  });
});

describe('Factory 上下文不按业务字符数裁剪', () => {
  test('嵌入、恒定锚和滚动快照均保留尾部证据', () => {
    const body = '甲'.repeat(9000) + '尾部证据';
    assert(buildEmbedBlocks([{ name: 'long.md', text: body }]).includes('尾部证据'), '嵌入仍在 8000 字符被裁剪');
    assert(buildConstantAnchor(body, '执行规约尾部').includes('尾部证据'), '恒定锚仍被裁剪');
    assert(buildConstantAnchor(body, '执行规约尾部').includes('执行规约尾部'), '执行规约仍被分配字符配额');
    const snapshot = buildStateSummaryPrompt('', '开头证据' + '乙'.repeat(4000), 1).user;
    assert(snapshot.includes('开头证据'), '状态快照仍只投喂末 3000 字符');
  });

  test('续写去重不再只查 200 字符/超过 10 字符', () => {
    const overlap = '重叠'.repeat(300);
    assert(dedupMerge(`前文${overlap}`, `${overlap}续文`) === `前文${overlap}续文`, '长重叠去重失效');
    assert(dedupMerge('前文短', '短续文') === '前文短续文', '短重叠仍被 >10 门限忽略');
  });
});

describe('Factory 旧字符声明只清理，不作为提交门', () => {
  test('缺失或报错字符数不阻断 provider-safe 正文', () => {
    const missing = validateNativeContinuationDeclaration('正文甲乙', { safeToCommit: true });
    const mismatch = validateNativeContinuationDeclaration('正文甲乙\n[本次续写字数：1]', { safeToCommit: true });
    assert(missing.safeToCommit && mismatch.safeToCommit, '字符声明仍是提交门');
    assert(mismatch.text === '正文甲乙', '旧声明没有从正文清理');
    assert(!validateNativeContinuationDeclaration('正文甲乙', { safeToCommit: false }).safeToCommit, 'provider/transport 安全门被误删');
    assert(ensureTokenDeclaration('正文甲乙') === '正文甲乙', '兼容 helper 仍伪造字符声明');
  });

  test('新章节 prompt 明确不要字数声明', () => {
    const prompt = buildChapterPromptV2({ outline: '事件推进', chapterNo: 1, title: '作品' });
    assert(!prompt.system.includes('[本次续写字数') && !prompt.user.includes('TOKEN_DECLARATION'), '新 prompt 仍索要字符声明');
    assert(prompt.user.includes('不要附加字数或字符数声明'), '去声明指令不明确');
  });
});

describe('Factory 插件配额只保留定性意图', () => {
  test('注入前删除每N字/至少N处/超过N处，不改用户事实数字', () => {
    const raw = '每3000字至少出现一处感官细节。每章至少一处使用口语。禁止在5000字内连续出现超过3处完美因果链。事实：{证据}。';
    const normalized = normalizePluginQuantityGuidance(raw);
    assert(!/每3000字|至少一处|超过3处/.test(normalized), `插件配额未归一：${normalized}`);
    assert(normalized.includes('感官细节') && normalized.includes('口语') && normalized.includes('完美因果链'), '定性写作意图被误删');
    const rendered = renderPluginPrompt({ prompt: raw, fields: [{ id: '证据' }] }, { 证据: '2026年第3号证据' });
    assert(rendered.includes('2026年第3号证据'), '用户事实数字被配额归一改写');
  });

  test('内置 antiai 插件输出不再含硬配额', () => {
    const antiai = NOVEL_PLUGINS.find(plugin => plugin.id === 'antiai');
    const rendered = renderPluginPrompt(antiai, {}, {});
    assert(!/每\d+字|每章[^\n]{0,20}至少|至少[零一二两三四五六七八九十百\d]+[处次个]|超过\d+处/.test(rendered), '内置 antiai 仍带固定数量配额');
    assert(rendered.includes('感官细节') && rendered.includes('对话') && rendered.includes('生活碎片'), 'antiai 定性意图未保留');
  });

  test('市场分析插件不限定题材个数或每维度行数', () => {
    const trend = NOVEL_PLUGINS.find(plugin => plugin.id === 'trend');
    const rendered = renderPluginPrompt(trend, {}, {});
    assert(!/3\s*[-–—~～至到]\s*5\s*个题材|5\s*[-–—~～至到]\s*8\s*行/.test(rendered), '市场分析插件仍用本地数量配额截断输出');
    assert(rendered.includes('按材料完整展开') && rendered.includes('按内容需要完整展开'), '市场分析的完整展开语义缺失');
  });
});
