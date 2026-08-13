// W62d：文档 → 导图的无损层级提炼契约。
// AI 只返回块 ID 与层级，正文始终由本地真相源回填，结构上杜绝增删改写。

const MAX_BLOCKS = 240;

function semanticLine(raw) {
  return String(raw || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+(?:\[(?: |x|X)\]\s*)?/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

export function captureDistillBlocks(text, { maxBlocks = MAX_BLOCKS } = {}) {
  const blocks = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const value = semanticLine(raw);
    if (!value || /^[-*_]{3,}$/.test(value)) continue;
    blocks.push({ id: `B${String(blocks.length + 1).padStart(3, '0')}`, text: value });
    if (blocks.length > maxBlocks) throw new Error(`一次最多提炼 ${maxBlocks} 个非空文本块，请缩小选区`);
  }
  if (!blocks.length) throw new Error('没有可提炼的文本');
  return blocks;
}

function jsonPayload(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error('返回值不是 JSON 数组');
}

export function validateDistillPlan(raw, blocks) {
  const value = typeof raw === 'string' ? jsonPayload(raw) : raw;
  const rows = Array.isArray(value) ? value : value?.items;
  if (!Array.isArray(rows)) throw new Error('提炼结果缺少 items 数组');
  if (rows.length !== blocks.length) throw new Error(`块数不守恒：应为 ${blocks.length}，实际 ${rows.length}`);
  const allowed = new Set(blocks.map(b => b.id));
  const seen = new Set();
  const plan = rows.map((row, index) => {
    const id = String(row?.id || '');
    const depth = Number(row?.depth);
    if (!allowed.has(id)) throw new Error(`出现陌生块：${id || '（空）'}`);
    if (seen.has(id)) throw new Error(`块被重复使用：${id}`);
    if (!Number.isInteger(depth) || depth < 1 || depth > 6) throw new Error(`${id} 的 depth 必须是 1–6 整数`);
    if (index === 0 && depth !== 1) throw new Error('第一块必须从一级开始');
    if (index > 0 && depth > Number(rows[index - 1]?.depth) + 1) throw new Error(`${id} 的层级发生跳级`);
    seen.add(id);
    return { id, depth };
  });
  const missing = blocks.find(b => !seen.has(b.id));
  if (missing) throw new Error(`遗漏块：${missing.id}`);
  return plan;
}

export function distillPrompt(blocks) {
  return {
    system: [
      'MAZZ_MAP_DISTILL_V1',
      '你是文档层级整理器，只能重排输入块并指定标题层级，禁止新增、删除、合并、拆分或改写任何块。',
      '只输出 JSON 数组，每项严格为 {"id":"B001","depth":1}。',
      '每个输入 id 必须且只能出现一次；depth 为 1–6；第一项 depth=1；相邻项不得向下跳过一级。',
    ].join('\n'),
    user: JSON.stringify({ blocks }, null, 2),
  };
}

export async function distillWithRetry(text, ask) {
  if (typeof ask !== 'function') throw new Error('缺少 AI 调用器');
  const blocks = captureDistillBlocks(text);
  const prompt = distillPrompt(blocks);
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = attempt === 1 ? prompt.user : `${prompt.user}\n\n上次输出不合格：${lastError.message}\n请从头严格重发 JSON 数组。`;
    const raw = await ask({ system: prompt.system, user, temperature: 0, maxTokens: Math.min(5000, 300 + blocks.length * 22) });
    try { return { blocks, plan: validateDistillPlan(raw, blocks), attempts: attempt }; }
    catch (error) { lastError = error; }
  }
  throw new Error(`AI 两次都未通过无损契约：${lastError?.message || '未知错误'}`);
}

export function planToPreview(plan, blocks) {
  const byId = new Map(blocks.map(b => [b.id, b.text]));
  return plan.map(row => `${'#'.repeat(row.depth)} ${byId.get(row.id)}`).join('\n');
}

export function previewToPlan(preview, blocks) {
  const queues = new Map();
  for (const block of blocks) {
    const q = queues.get(block.text) || [];
    q.push(block.id);
    queues.set(block.text, q);
  }
  const rows = [];
  for (const raw of String(preview || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(raw);
    if (!match) throw new Error('每行必须以 1–6 个 # 和一个空格开头');
    const q = queues.get(match[2]);
    if (!q?.length) throw new Error(`正文被增加、删除或改写：${match[2].slice(0, 32)}`);
    rows.push({ id: q.shift(), depth: match[1].length });
  }
  return validateDistillPlan(rows, blocks);
}

export function planToRoots(plan, blocks, sourceRef = null, idSeed = Date.now().toString(36)) {
  const byId = new Map(blocks.map(b => [b.id, b.text]));
  const roots = [], stack = [];
  for (const [index, row] of plan.entries()) {
    const node = {
      id: `ai-${idSeed}-${index + 1}`,
      text: byId.get(row.id), children: [], collapsed: false,
      ...(sourceRef ? { sourceRef: { ...sourceRef } } : {}),
    };
    while (stack.length && stack[stack.length - 1].depth >= row.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ depth: row.depth, node });
  }
  return roots;
}

