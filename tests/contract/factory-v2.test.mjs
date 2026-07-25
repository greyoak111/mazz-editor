// tests/contract/factory-v2.test.mjs —— 智能创作 v2（原版可取之处移植）契约
// 覆盖：插件渲染/嵌入块/蓝图 prompt/结构校验/大纲解析/四层章节引导/去重合并/状态扫描
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

// —— 内存版 mazz 桥（工作区 + 文件系统 + settings） ——
const WS = '/mock-ws';
const fsStore = new Map();
const settingsStore = new Map();
window.mazz = {
  invoke: async (channel, payload = {}) => {
    if (channel === 'workspace:get') return WS;
    if (channel === 'fs:readFile') {
      if (!fsStore.has(payload.path)) throw new Error('ENOENT');
      return fsStore.get(payload.path);
    }
    if (channel === 'fs:writeFile') { fsStore.set(payload.path, payload.content); return true; }
    if (channel === 'fs:mkdir') return true;
    if (channel === 'fs:delete') { fsStore.delete(payload.path); return true; }
    if (channel === 'fs:listDir') {
      const prefix = payload.path + '/';
      const seen = new Map();
      for (const p of fsStore.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const seg = rest.split('/');
        if (seg.length === 1) seen.set(p, { name: seg[0], isDir: false, path: p });
        else {
          const dp = prefix + seg[0];
          if (!seen.has(dp)) seen.set(dp, { name: seg[0], isDir: true, path: dp });
        }
      }
      return [...seen.values()];
    }
    if (channel === 'settings:get') return settingsStore.get(payload.key) ?? null;
    if (channel === 'settings:set') { settingsStore.set(payload.key, payload.value); return true; }
    return null;
  },
};

const eng = await import('../../renderer/modules/factory/engine.js');
const { NOVEL_PLUGINS } = await import('../../renderer/modules/factory/plugins.js');
const { assembleStylePackage } = await import('../../renderer/modules/factory/style-studio.js');

describe('创作插件库（原版移植）', () => {
  test('10 个插件齐全且结构完整', () => {
    assert(NOVEL_PLUGINS.length === 10, '应为 10 个插件，实际 ' + NOVEL_PLUGINS.length);
    for (const p of NOVEL_PLUGINS) {
      assert(p.id && p.name && p.prompt.length > 100, p.name + ' 结构不完整');
    }
    const ids = NOVEL_PLUGINS.map(p => p.id);
    for (const need of ['antiai', 'characters', 'world', 'plot', 'outline', 'trend']) {
      assert(ids.includes(need), '缺插件 ' + need);
    }
  });

  test('renderPluginPrompt：字段值替换 + 未填占位符兜底', () => {
    const antiai = NOVEL_PLUGINS.find(p => p.id === 'antiai');
    const out = eng.renderPluginPrompt(antiai, { 反AI检测档位: '狠辣级（深度混入）' }, {});
    assert(out.includes('狠辣级'), '档位未替换进 prompt');
    assert(!/\{\w+\}/.test(out), '占位符残留：' + out.match(/\{\w+\}/)?.[0]);
  });

  test('renderPluginPrompt：任务值兜底 + 未知占位符 [未指定]', () => {
    const fake = { id: 'x', name: 'X', fields: [{ id: '甲' }], prompt: '甲={甲} 乙={乙} 丙={丙}' };
    const out = eng.renderPluginPrompt(fake, {}, { 乙: '任务值' });
    assert(out.includes('甲=[未指定]'), '未填字段应兜底');
    assert(out.includes('乙=任务值'), '任务值应兜底替换');
    assert(out.includes('丙=[未指定]'), '未知占位符应 [未指定]');
  });
});

describe('嵌入资料块（最高优先级）', () => {
  test('含优先级声明与文件清单，超长截断', () => {
    const s = eng.buildEmbedBlocks([{ name: '大纲.md', text: '甲'.repeat(9000) }]);
    assert(s.includes('最高优先级'), '缺优先级声明');
    assert(s.includes('大纲.md'), '缺文件名');
    assert(s.length < 9200, '未截断');
  });
  test('空嵌入返回空串', () => assert(eng.buildEmbedBlocks([]) === '', '应为空串'));
});

describe('全书蓝图 prompt 与校验', () => {
  const values = { 书名: '测试之书', 价值取向: '何为人性', 作品类型: '科幻', 篇幅长短: '中篇（1-5万字）', 每章字数: '3000' };
  test('buildNovelBlueprintPrompt 含核心信息/文风/插件/9部分要求', () => {
    const p = eng.buildNovelBlueprintPrompt(values, {
      stylePackage: '风格包内容', pluginBlocks: ['插件规则A'],
      embedBlocks: '嵌入块内容', chapters: 12,
    });
    assert(p.includes('测试之书') && p.includes('何为人性') && p.includes('科幻'), '缺核心信息');
    assert(p.includes('风格包内容') && p.includes('插件规则A') && p.includes('嵌入块内容'), '缺增强块');
    assert(p.includes('恰好是12章'), '缺章节约束');
    assert(p.includes('创作启动指令'), '缺启动指令要求');
  });
  test('max 模式章节约束不同', () => {
    const p = eng.buildNovelBlueprintPrompt(values, { maxMode: true });
    assert(p.includes('完整叙述至自然结尾'), 'max 模式约束错误');
    assert(!p.includes('恰好是'), 'max 模式不应有固定章数');
  });
  test('blueprintStructureOk 正反例', () => {
    const good = '# 蓝图\n故事标题 简介 核心价值 主角 配角 世界观 三幕 章节 文风 节奏';
    assert(eng.blueprintStructureOk(good), '完整蓝图应通过');
    assert(!eng.blueprintStructureOk('随便两句话'), '碎片不应通过');
    assert(!eng.blueprintStructureOk(''), '空不应通过');
  });
  test('parseChapterOutlines 解析与退化', () => {
    const bp = '前言\n## 章节大纲\n第一章：降临\n第2章：异动\n- 第3章：真相\n其他内容';
    const out = eng.parseChapterOutlines(bp);
    assert(out.length === 3, '应解析 3 章，实际 ' + out.length);
    assert(out[0].includes('降临'), '首章内容错误');
    const fb = eng.parseChapterOutlines('没有任何大纲', 5);
    assert(fb.length === 5, '退化应给 5 章占位');
    // 散文句防误匹配（原版场景式蓝图真实案例：'第一人称有限视角让读者…'）
    const prose = '### 视角\n第一人称有限视角让读者能亲历全过程，是最合适的\n一些别的分析';
    const out2 = eng.parseChapterOutlines(prose, 4);
    assert(out2.length === 4 && out2[0] === '第1章', '散文行不应误判为大纲：' + out2[0]);
  });
  test('蓝图核心/启动指令切分', () => {
    const longCore = '设定A' + '世界观细节。'.repeat(60); // 超过 200 字才不触发全文退化
    const bp = `# 蓝图\n${longCore}\n\n## 创作启动指令\n规则B\n规则C`;
    assert(eng.extractBlueprintCore(bp).includes('设定A'), '核心提取失败');
    assert(!eng.extractBlueprintCore(bp).includes('规则B'), '核心不应含指令');
    const d = eng.extractWritingDirective(bp);
    assert(d.includes('规则B') && d.includes('规则C'), '指令提取失败');
    // 核心过短（<200字）退化为全文——防止 AI 只输出指令时核心丢失
    const short = '设定很短\n## 创作启动指令\n规则B';
    assert(eng.extractBlueprintCore(short).includes('规则B'), '短核心应退化全文');
  });
  test('stripMdFence 去围栏', () => {
    assert(eng.stripMdFence('```markdown\n# 甲\n```') === '# 甲', 'markdown 围栏未去');
    assert(eng.stripMdFence('```\n# 乙\n```') === '# 乙', '通用围栏未去');
    assert(eng.stripMdFence('# 丙') === '# 丙', '无围栏应原样');
  });
});

describe('四层章节引导与去重合并', () => {
  test('buildChapterPromptV2 四层结构齐全', () => {
    const cp = eng.buildChapterPromptV2({
      blueprintCore: '核心设定X', writingDirective: '启动指令Y', stateSummary: '快照Z',
      outline: '第3章：对决', chapterNo: 3, total: 10, wordsPerChapter: 2500, title: '书',
    });
    assert(cp.system.includes('第一层') && cp.system.includes('第四层'), '缺层结构');
    assert(cp.system.includes('核心设定X') && cp.system.includes('启动指令Y') && cp.system.includes('快照Z'), '缺内容注入');
    assert(cp.system.includes('第3章：对决') && cp.system.includes('2500'), '缺本章任务');
    assert(cp.user.includes('第 3 章'), 'user 应指明章号');
  });
  test('dedupMerge 重叠合并', () => {
    const tail = '雨点敲在窗玻璃上，像是在数着剩下'; // 20字重叠（>10 才检测，防误并）
    assert(eng.dedupMerge('开头甲' + tail, tail + '结尾乙') === '开头甲' + tail + '结尾乙', '重叠合并失败');
    assert(eng.dedupMerge('ABC', 'xyz') === 'ABCxyz', '无重叠应直接拼接');
    assert(eng.dedupMerge('', 'abc') === 'abc', '空前缀');
    assert(eng.dedupMerge('abc', '') === 'abc', '空续写');
  });
});

describe('文风包组装', () => {
  test('手填 + 素材（本地带原文片段 / 在线仅分析）', () => {
    const styles = [
      { id: 'a', type: 'local', label: '📄 范文.txt', note: '重点学对话', analysis: '分析A', text: '原文内容'.repeat(500) },
      { id: 'b', type: 'online', label: '🌐 余华', analysis: '分析B' },
    ];
    const pkg = assembleStylePackage({ traditional: '鲁迅', styleIds: ['a', 'b'], styles });
    assert(pkg.includes('鲁迅'), '缺手填参照');
    assert(pkg.includes('范文.txt') && pkg.includes('重点学对话') && pkg.includes('分析A'), '缺本地素材');
    assert(pkg.includes('原文片段'), '本地素材缺原文片段');
    assert(pkg.includes('余华') && pkg.includes('分析B'), '缺在线素材');
  });
  test('空素材兜底文案', () => {
    assert(assembleStylePackage({}).includes('未提供'), '空应兜底');
  });
});

describe('.maz 文体包导入导出（与原版互通）', () => {
  test('导出→导入往返：字段/提示词/校验项全保留', async () => {
    const { exportMaz, importMaz } = await import('../../renderer/modules/factory/maz.js');
    const tpl = {
      id: 'custom_周报', name: '周报', description: '团队周报',
      input_fields: [
        { id: 'f_本周进展', label: '本周进展', type: 'textarea', required: true },
        { id: 'f_风险', label: '风险', type: 'text', required: false },
        { id: 'f_风格', label: '风格', type: 'select', options: ['简洁', '详尽'], default: '简洁' },
      ],
      system_prompt: '你是周报写作专家。',
      meta_vars: {}, output_rules: { format: 'markdown', max_length: 1500 },
      quality_checks: [{ rule: 'minLength', value: 300, label: '不少于300字' }],
    };
    const bytes = await exportMaz(tpl);
    assert(bytes.length > 200, '导出包过小');
    const back = await importMaz(bytes);
    assert(back.name === '周报' && back.description === '团队周报', '名称/描述丢失');
    assert(back.input_fields.length === 3, '字段数不符');
    assert(back.input_fields[2].type === 'select' && back.input_fields[2].options[0] === '简洁', 'select 字段失真');
    assert(back.system_prompt.includes('周报写作专家'), '提示词丢失');
    assert(back.quality_checks.length === 1, '校验项丢失');
    // 原版 style_ref/template_selector 类型降级为 textarea，不崩
    const legacy = {
      ...tpl, name: '旧版文体',
      input_fields: [{ id: '文风学习对象', label: '文风学习对象', type: 'style_ref', required: false }],
    };
    const back2 = await importMaz(await exportMaz(legacy));
    assert(back2.input_fields[0].type === 'textarea', '原版私有类型应降级 textarea，实际 ' + back2.input_fields[0].type);
  });

  test('坏包报错不含糊', async () => {
    const { importMaz } = await import('../../renderer/modules/factory/maz.js');
    let msg = '';
    try { await importMaz(new Uint8Array([1, 2, 3])); } catch (e) { msg = e.message; }
    assert(msg.length > 0, '坏 zip 应报错');
  });
});

describe('任务状态持久化与扫描', () => {
  test('writeTaskState / scanResumableTasks 往返', async () => {
    const ws = await window.mazz.invoke('workspace:get');
    const dir = `${ws}/创作产出/测试任务A`;
    await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
    await eng.writeTaskState(dir, { title: '测试任务A', status: 'paused', currentChapter: 3, values: {} });
    const list = await eng.scanResumableTasks();
    const hit = list.find(r => r.title === '测试任务A');
    assert(hit, '扫描不到写入的状态');
    assert(hit.currentChapter === 3 && hit.outDir === dir, '状态字段不全');
    // done 状态不应列出
    await eng.writeTaskState(dir, { title: '测试任务A', status: 'done', currentChapter: 5 });
    const list2 = await eng.scanResumableTasks();
    assert(!list2.find(r => r.title === '测试任务A'), 'done 不应再列出');
  });
});
