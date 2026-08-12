// 预置文体：公文
export default {
  id: 'gongwen',
  name: '公文',
  description: '格式规范的机关公文（通知/请示/报告/函），遵循 GB/T 9704 体例',
  blueprintFamily: 'meta',
  unitName: '节',
  snapshotType: 'expository',
  input_fields: [
    { id: 'title', label: '公文标题', type: 'text', required: true, placeholder: '关于……的……' },
    { id: 'recipient', label: '主送机关', type: 'text', required: true, placeholder: '各市、县（区）人民政府，……' },
    { id: 'body_keypoints', label: '正文要点', type: 'textarea', required: true, placeholder: '分条列出必须写入的事项、依据、要求…' },
    { id: 'doc_type', label: '文种', type: 'select', options: ['通知', '请示', '报告', '函', '通报', '决定'], default: '通知' },
    { id: 'issuer', label: '发文机关（落款）', type: 'text', required: true },
    { id: 'length', label: '篇幅', type: 'select', options: ['800字以内', '1500字以内', '3000字以内'], default: '1500字以内' },
  ],
  system_prompt: '你是一名资深机关文秘，深谙党政机关公文写作规范（GB/T 9704、党政机关公文处理工作条例）。语言庄重、准确、简明，结构严谨，不堆砌套话，不写散文腔。',
  meta_vars: {
    叙事者位置: '发文机关集体口吻（第一人称复数“我局/我市”，禁用“我认为”）',
    语言阶层: '极度正式',
    情感编码: '克制、零修辞',
    真实性来源: '政策依据与事实逻辑自洽',
    读者位置: '必须照办的执行者',
    时间处理: '现状—依据—事项—要求 线性推进',
    创新边界: '严守格式，标题/主送/正文/落款/日期一项不缺',
  },
  output_rules: { format: 'markdown', max_length: 3000, structure: '标题（关于+事由+文种）→ 主送机关 → 正文（缘由-事项-要求） → 落款机关+成文日期' },
  quality_checks: [
    { rule: 'startsWith', value: '# 关于', label: '标题必须以「关于」开头' },
    { rule: 'contains', value: '特此', label: '须有公文惯用结语（如“特此通知/此致”）' },
    { rule: 'maxParagraphs', value: 12, label: '正文不超过 12 个自然段' },
    { rule: 'forbiddenWords', value: ['我觉得', '个人认为', '吧', '哦', '嗯'], label: '禁用口语与主观措辞' },
  ],
};
