// 预置文体：财务报告
export default {
  id: 'caiwu',
  name: '财务报告',
  description: '数据驱动的财务/经营分析报告（同比环比、异常解释、行动建议）',
  blueprintFamily: 'meta',
  unitName: '节',
  snapshotType: 'expository',
  input_fields: [
    { id: 'title', label: '报告标题', type: 'text', required: true },
    { id: 'period', label: '报告期间', type: 'text', required: true, placeholder: '2026 年第二季度' },
    { id: 'data_notes', label: '关键数据与事实', type: 'textarea', required: true, placeholder: '营收/成本/毛利率/现金流等关键数字，越具体越好' },
    { id: 'audience', label: '呈报对象', type: 'select', options: ['董事会', '管理层', '投资人', '税务机关', '内部全员'], default: '管理层' },
    { id: 'focus', label: '分析重点', type: 'textarea', placeholder: '例如：毛利率下滑原因、费用异常、回款风险' },
  ],
  system_prompt: '你是一名资深财务分析师。每一个观点都有数据支撑，同比/环比口径清晰，异常波动必须解释原因，结论必须落到可执行的建议。不写空话套话，不做无依据的乐观预测。',
  meta_vars: {
    叙事者位置: '第三人称客观陈述',
    语言阶层: '正式、专业（术语准确但不晦涩）',
    情感编码: '中立、冷静',
    真实性来源: '数据权威（每一个判断有数字出处）',
    读者位置: '需要据此决策的管理者',
    时间处理: '本期表现 → 同比/环比 → 原因 → 风险 → 建议',
    创新边界: '允许微调结构，但数据解读逻辑不可跳跃',
  },
  output_rules: { format: 'markdown', structure: '总体结论先行 → 关键指标解读 → 异常与原因 → 风险提示 → 行动建议' },
  quality_checks: [
    { rule: 'containsNumber', label: '必须包含具体数字（金额/百分比）' },
    { rule: 'contains', value: '建议', label: '必须有行动建议部分' },
    { rule: 'forbiddenWords', value: ['大概', '可能吧', '感觉', '差不多'], label: '禁用含糊措辞' },
  ],
};
