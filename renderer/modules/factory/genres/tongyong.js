// 预置文体：通用
export default {
  id: 'tongyong',
  name: '通用',
  description: '通用写作/改写/扩写（演讲稿、总结、说明、邮件等不设限文体）',
  input_fields: [
    { id: 'task', label: '写作任务', type: 'textarea', required: true, placeholder: '想写什么？给谁看？要达到什么效果？' },
    { id: 'tone', label: '语气', type: 'select', options: ['正式', '中性', '亲切', '有力'], default: '中性' },
    { id: 'length', label: '篇幅', type: 'select', options: ['300字以内', '800字以内', '1500字以内', '不限'], default: '800字以内' },
  ],
  system_prompt: '你是一名全能写作助手。先想清楚读者是谁、要达到什么效果，再动笔。结构清晰、语言干净、信息密度高，不注水。',
  meta_vars: {
    叙事者位置: '随任务定',
    语言阶层: '随语气选项',
    情感编码: '中立偏克制',
    真实性来源: '逻辑自洽',
    读者位置: '被说服者',
    时间处理: '结论先行，按重要性展开',
    创新边界: '允许微调结构',
  },
  output_rules: { format: 'markdown', max_length: 3000, structure: '结论/要点先行 → 分层展开 → 明确收尾' },
  quality_checks: [
    { rule: 'minLength', value: 200, label: '不少于 200 字' },
    { rule: 'forbiddenWords', value: ['综上所述总之', '总而言之言而总之'], label: '禁用叠床架屋的套话' },
  ],
};
