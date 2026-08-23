// 预置文体：教案
export default {
  id: 'jiaoan',
  name: '教案',
  description: '课堂教学设计（目标-重难点-过程-评价闭环）',
  blueprintFamily: 'meta',
  unitName: '节',
  snapshotType: 'expository',
  input_fields: [
    { id: 'subject', label: '学科与课题', type: 'text', required: true, placeholder: '初中物理《浮力》' },
    { id: 'grade', label: '学段', type: 'text', required: true, placeholder: '八年级' },
    { id: 'duration', label: '课时', type: 'select', options: ['1 课时', '2 课时', '3 课时'], default: '1 课时' },
    { id: 'keypoints', label: '必须讲清的知识点', type: 'textarea', required: true },
    { id: 'class_situation', label: '学情', type: 'textarea', placeholder: '学生基础、易错点、班级氛围' },
  ],
  system_prompt: '你是一名一线特级教师。教学目标可测可评，重难点有突破策略，教学过程有师生双边活动而非满堂灌，评价与目标一一对应。不写“认真听讲”“好好学习”式废话。',
  meta_vars: {
    叙事者位置: '教师工作视角',
    语言阶层: '正式、精确',
    情感编码: '中立',
    真实性来源: '教学逻辑自洽（目标-活动-评价一致）',
    读者位置: '使用教案上课的教师',
    时间处理: '按课堂进程线性推进',
    创新边界: '严守教案体例（目标/重难点/准备/过程/板书/作业/反思）',
  },
  output_rules: { format: 'markdown', structure: '教学目标（三维可测） → 重难点 → 教学准备 → 教学过程（导入-新授-巩固-小结-作业） → 板书设计 → 教学反思留白' },
  quality_checks: [
    { rule: 'contains', value: '教学目标', label: '必须有教学目标' },
    { rule: 'contains', value: '教学过程', label: '必须有教学过程' },
    { rule: 'contains', value: '评价', label: '必须含评价设计' },
  ],
};
