// 产品术语展示层：底层协议、历史文件名和内部档案保持不变，UI 出口统一转正式名。
const REPLACEMENTS = Object.freeze([
  [/Factory Desk\s*·?\s*活稿车间/g, '智能创作台'],
  [/Factory Desk/g, '智能创作台'],
  [/工厂桌面|活稿车间/g, '智能创作台'],
  [/车间执行台/g, '智能创作执行台'],
  [/车间全景/g, '创作流全景'],
  [/车间流|车间群|工厂群/g, '创作流'],
  [/群档/g, '创作流档案'],
  [/系列圣经/g, '作品设定集（系列）'],
  [/圣经/g, '设定集'],
  [/判例库/g, '先例库'],
  [/清单库/g, '规范库'],
  [/骨架/g, '总纲'],
  [/机检打回率/g, '自动校验退回率'],
  [/审理打回率/g, '交叉审校退回率'],
  [/打回率/g, '退回率'],
  [/开庭率/g, '仲裁率'],
  [/机检/g, '自动校验'],
  [/对点把控|对点/g, '节点验收'],
  [/背靠背双审|双审|审理/g, '交叉审校'],
  [/双环/g, '专业流程'],
  [/开庭/g, '争议仲裁'],
  [/质询/g, '复核'],
  [/打回/g, '退回修订'],
  [/落盘门/g, '入库闸'],
  [/落典/g, '入库定本'],
  [/入典/g, '写入定本'],
  [/红队/g, '反向核查'],
  [/健康看板/g, '运行看板'],
  [/预算帽/g, '预算上限'],
  [/轻仪式/g, '标准流程'],
  [/全仪式/g, '完整流程'],
  [/四闸全开/g, '入库四验通过'],
  [/停摆/g, '暂停'],
  [/工件/g, '产物'],
  [/裁决/g, '仲裁'],
  [/终审/g, '最终审定'],
  [/独角戏/g, '个人版'],
  [/二人转/g, '协作版'],
  [/六方/g, '专业版'],
  [/事业部/g, '旗舰版'],
  [/剧搭子/g, '陪看'],
  [/交办栏/g, '指令台'],
  [/见真章/g, '模型测评中心'],
  [/工厂任务/g, '创作项目'],
  [/工厂项目/g, '创作项目'],
  [/工厂/g, '智能创作'],
]);

export function productText(value) {
  let output = String(value ?? '');
  for (const [pattern, replacement] of REPLACEMENTS) output = output.replace(pattern, replacement);
  return output;
}

const FILE_LABELS = Object.freeze({
  '圣经.md': '设定集.md',
  '判例库.md': '先例库.md',
  '工厂群.md': '创作流.md',
});

export function productFileName(value) {
  const name = String(value || '');
  return FILE_LABELS[name] || productText(name);
}

export const PRODUCT_TERMS = Object.freeze({
  factory: '智能创作', desk: '智能创作台', flow: '创作流',
  codex: '设定集', precedents: '先例库', outline: '总纲',
  autoCheck: '自动校验', checkpoint: '节点验收', crossReview: '交叉审校',
  arbitration: '争议仲裁', opsBoard: '运行看板', commandDock: '指令台',
});
