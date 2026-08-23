// renderer/modules/factory/agent.js —— W62a 指令台：命令闭集路由、澄清/确认闸、台账与多步 agent 环
import { chat } from './provider.js';

export const AGENT_LEDGER_KEY = 'mazz.agent.ledger';
export const AGENT_MAX_STEPS = 6;
export const AGENT_CONTROL_CARDS = Object.freeze([
  { id: 'agent.finish', title: '结束交办并汇报', group: '指令台', danger: false, argsSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } }, additionalProperties: false } },
  { id: 'agent.clarify', title: '请求用户二选一澄清', group: '指令台', danger: false, argsSchema: { type: 'object', required: ['question', 'options'], properties: { question: { type: 'string' }, options: { type: 'array' } }, additionalProperties: false } },
]);

const plainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const asText = v => String(v ?? '');

function stringifyToolResult(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, item) => {
    if (typeof item === 'function') return undefined;
    if (key === 'container' || key === 'state' || key === 'inst') return undefined;
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  });
}

export function normalizeLedger(raw) {
  const src = plainObject(raw) ? raw : {};
  return { version: 1, entries: Array.isArray(src.entries) ? [...src.entries] : [] };
}

export function appendLedger(ledger, entry) {
  const target = normalizeLedger(ledger);
  target.entries.push({ at: Date.now(), ...entry });
  return target;
}

export function recentFocus(ledger) {
  return [...normalizeLedger(ledger).entries].reverse().find(x => x.focus)?.focus || '';
}

/** 「再来一次」回放上次原始交办；「它」只解到最近工具对象，不凭空脑补。 */
export function resolveLedgerInput(raw, ledger) {
  const input = String(raw || '').trim();
  const entries = normalizeLedger(ledger).entries;
  if (/^(再来一次|再做一次|重复一次)[。！!\s]*$/.test(input)) {
    const previous = [...entries].reverse().find(x => x.type === 'user' && x.input);
    return { input: previous?.input || input, replay: !!previous };
  }
  const focus = recentFocus(ledger);
  return { input: focus && /它|这个|那个/.test(input) ? `${input}\n[台账指代：它=${focus}]` : input, replay: false };
}

export function frequentLedgerInputs(ledger, limit = 4) {
  const counts = new Map();
  for (const e of normalizeLedger(ledger).entries) {
    if (e.type !== 'user' || !e.input) continue;
    const key = String(e.input).trim();
    if (key.length > 40) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit).map(([input, count]) => ({ input, count }));
}

export function ledgerToMarkdown(ledger) {
  const lines = ['# Mazz 指令台台账', '', '> 本文件由指令台自动维护，供全文索引与追溯使用。', ''];
  for (const e of normalizeLedger(ledger).entries) {
    const time = new Date(e.at || Date.now()).toISOString();
    if (e.type === 'user') lines.push(`## ${time} · 交办`, '', e.input || '', '');
    else if (e.type === 'tool') lines.push(`### ${e.command || '命令'} · ${e.status || 'done'}`, '', `- 参数：\`${JSON.stringify(e.args || {}).replace(/`/g, '\\`')}\``, `- 结果：${asText(e.result)}`, ...(e.focus ? [`- 当前对象：${e.focus}`] : []), '');
    else if (e.type === 'finish') lines.push(`### 结果`, '', e.message || '', '');
  }
  return lines.join('\n').trim() + '\n';
}

export function parseAgentDecision(raw, cards) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error('AI 未返回 JSON 对象');
  let value;
  try { value = JSON.parse(match[0]); } catch (e) { throw new Error('AI JSON 无法解析：' + e.message); }
  if (!plainObject(value) || typeof value.command !== 'string' || !plainObject(value.args || {})) throw new Error('决策必须是 {command,args}');
  const allowed = new Set([...(cards || []).map(x => x.id), ...AGENT_CONTROL_CARDS.map(x => x.id)]);
  if (!allowed.has(value.command)) throw new Error(`命令不在闭集：${value.command}`);
  const args = value.args || {};
  const card = [...(cards || []), ...AGENT_CONTROL_CARDS].find(x => x.id === value.command);
  validateAgentArgs(args, card?.argsSchema || { type: 'object' });
  if (value.command === 'agent.finish' && !String(args.message || '').trim()) throw new Error('agent.finish 缺 message');
  if (value.command === 'agent.clarify') {
    if (!String(args.question || '').trim() || !Array.isArray(args.options) || args.options.length !== 2) throw new Error('agent.clarify 必须提供 question 与 A/B 两项');
    args.options = args.options.map((x, i) => plainObject(x)
      ? { label: asText(x.label ?? String.fromCharCode(65 + i)), value: asText(x.value ?? x.label) }
      : { label: asText(x), value: asText(x) });
  }
  return { command: value.command, args };
}

export function validateAgentArgs(args, schema = { type: 'object' }) {
  if (schema.type === 'object' && !plainObject(args)) throw new Error('args 必须是对象');
  for (const key of schema.required || []) if (!(key in args)) throw new Error(`args 缺少必填字段：${key}`);
  const properties = plainObject(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) if (!(key in properties)) throw new Error(`args 含未声明字段：${key}`);
  }
  for (const [key, rule] of Object.entries(properties)) {
    if (!(key in args) || !rule?.type) continue;
    const v = args[key];
    const ok = rule.type === 'array' ? Array.isArray(v)
      : rule.type === 'object' ? plainObject(v)
      : rule.type === 'integer' ? Number.isInteger(v)
      : typeof v === rule.type;
    if (!ok) throw new Error(`args.${key} 类型应为 ${rule.type}`);
  }
  return true;
}

function cardsPrompt(cards) {
  return [...(cards || []), ...AGENT_CONTROL_CARDS]
    .map(x => `${x.id}|${x.description || x.title}|分组=${x.group || '-'}|${x.danger ? '危险需确认' : '普通'}|args=${JSON.stringify(x.argsSchema || { type: 'object', additionalProperties: false })}`)
    .join('\n');
}

function ledgerPrompt(ledger) {
  return normalizeLedger(ledger).entries.map(e => {
    if (e.type === 'user') return `用户:${String(e.input || '')}`;
    if (e.type === 'tool') return `命令:${e.command} 参数=${JSON.stringify(e.args || {})} 结果=${String(e.result || '')}`;
    return `${e.type}:${String(e.message || '')}`;
  }).join('\n');
}

export async function decideAgentCommand({ input, cards, ledger, transcript = [], ask = chat }) {
  const system = `MAZZ_AGENT_ROUTER_V1\n你是 Mazz 指令台调度器，不是聊天机器人。每轮只可输出一个 JSON 对象：{"command":"闭集命令 id","args":{}}。\n规则：\n1. command 必须逐字来自工具卡或 agent.finish/agent.clarify；禁止解释、Markdown、虚构命令。\n2. 任务完成用 agent.finish；信息不足用 agent.clarify，options 必须恰好 A/B 两项。\n3. 多步任务每轮只提一个真实命令；代码会把执行结果喂回，再决定下一步。\n4. 删除、覆盖、投稿等危险命令照常提议，确认由代码闸处理，不得声称已经执行。\n\n工具闭集：\n${cardsPrompt(cards)}`;
  const history = transcript.map(x => `${x.command}(${JSON.stringify(x.args || {})}) => ${String(x.result || '')}`).join('\n');
  const user = `【原始交办】\n${input}\n\n【台账最近记录】\n${ledgerPrompt(ledger) || '无'}\n\n【本次已执行步骤】\n${history || '无'}\n\n只回一个 JSON。`;
  let raw = await ask({ role: 'agent', system, user, temperature: 0 });
  try { return parseAgentDecision(raw, cards); }
  catch (first) {
    raw = await ask({ role: 'agent', system, user: `${user}\n\n上次输出不合格：${first.message}\n上次原文：${String(raw || '')}\n请严格重发一个 JSON。`, temperature: 0 });
    return parseAgentDecision(raw, cards);
  }
}

export function summarizeToolResult(value) {
  if (value == null) return '命令已执行（无返回值）';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return asText(value);
  try {
    return stringifyToolResult(value) || '命令已执行';
  } catch { return '命令已执行（返回对象不可序列化）'; }
}

function focusOf(decision) {
  const a = decision.args || {};
  return asText(a.path || a.filePath || a.title || a.name || decision.command);
}

export class AgentRuntime {
  constructor({ registry, ledger, saveLedger, onEvent, decide = decideAgentCommand, maxSteps = AGENT_MAX_STEPS }) {
    this.registry = registry;
    this.ledger = normalizeLedger(ledger);
    this.saveLedger = saveLedger || (async () => {});
    this.onEvent = onEvent || (() => {});
    this.decide = decide;
    this.maxSteps = maxSteps;
    this.session = null;
    this.pending = null;
    this.completionPromise = null;
    this.resolveCompletion = null;
  }

  cards() { return this.registry.toolCards({ includeDisabled: true }); }
  emit(type, data = {}) { this.onEvent({ type, ...data }); }
  async record(entry) { this.ledger = appendLedger(this.ledger, entry); await this.saveLedger(this.ledger); }

  async submit(raw) {
    if (this.session || this.pending) throw new Error('上一项交办尚未结束');
    const literal = String(raw || '').trim();
    if (!literal) throw new Error('先写清楚要交办什么');
    if (/^(撤销|撤销上一步|undo)[。！!\s]*$/i.test(literal)) return this.undoLast();
    const resolved = resolveLedgerInput(literal, this.ledger);
    this.completionPromise = new Promise(resolve => { this.resolveCompletion = resolve; });
    await this.record({ type: 'user', input: resolved.input, original: literal, replay: resolved.replay });
    this.session = { input: resolved.input, transcript: [], steps: 0 };
    this.emit('start', { input: resolved.input, replay: resolved.replay });
    return this.advance();
  }

  async submitForDelegation(raw) {
    const immediate = await this.submit(raw);
    if (!this.session && !this.pending) return immediate;
    return this.completionPromise;
  }

  settleCompletion(result) {
    const resolve = this.resolveCompletion;
    this.resolveCompletion = null;
    this.completionPromise = null;
    resolve?.(result);
  }

  async advance() {
    const s = this.session;
    if (!s) return;
    if (s.steps >= this.maxSteps) return this.finish(`已到 ${this.maxSteps} 步安全上限，链式交办暂停，请检查后续。`, 'limit');
    this.emit('thinking', { step: s.steps + 1 });
    try {
      const decision = await this.decide({ input: s.input, cards: this.cards(), ledger: this.ledger, transcript: s.transcript });
      if (decision.command === 'agent.finish') return this.finish(decision.args.message, 'done');
      if (decision.command === 'agent.clarify') {
        this.pending = { type: 'clarify', decision };
        this.emit('clarify', decision.args);
        return;
      }
      const card = this.cards().find(x => x.id === decision.command);
      if (!card) throw new Error('命令已离开当前闭集：' + decision.command);
      if (card.danger) {
        this.pending = { type: 'confirm', decision, card };
        this.emit('confirm', { command: decision.command, title: card.title, args: decision.args });
        return;
      }
      return this.executeDecision(decision, card);
    } catch (e) {
      this.emit('error', { message: e.message || String(e) });
      this.session = null; this.pending = null;
      this.settleCompletion({ status: 'failed', message: e.message || String(e) });
      throw e;
    }
  }

  async executeDecision(decision, card = this.cards().find(x => x.id === decision.command)) {
    this.pending = null;
    const s = this.session;
    if (!s) return;
    this.emit('tool-start', { step: s.steps + 1, command: decision.command, title: card?.title || decision.command, args: decision.args });
    let raw;
    try {
      if (!this.registry.isEnabled(decision.command)) throw new Error('当前上下文不可执行该命令');
      raw = await this.registry.execute(decision.command, decision.args);
    }
    catch (e) {
      const result = `执行失败：${e.message || e}`;
      s.transcript.push({ ...decision, result }); s.steps++;
      await this.record({ type: 'tool', command: decision.command, args: decision.args, result, status: 'failed', focus: focusOf(decision) });
      this.emit('tool-result', { command: decision.command, result, ok: false });
      return this.advance();
    }
    const result = summarizeToolResult(raw);
    const undo = plainObject(raw?.undo) ? raw.undo : card?.undo;
    s.transcript.push({ ...decision, result }); s.steps++;
    await this.record({ type: 'tool', command: decision.command, args: decision.args, result, status: 'done', focus: focusOf(decision), undo });
    this.emit('tool-result', { command: decision.command, result, ok: true });
    return this.advance();
  }

  async answer(value) {
    if (this.pending?.type !== 'clarify' || !this.session) return;
    const question = this.pending.decision.args.question;
    this.session.transcript.push({ command: 'agent.clarify', args: { question }, result: `用户选择：${asText(value)}` });
    this.pending = null;
    this.emit('clarified', { value });
    return this.advance();
  }

  async approve() {
    if (this.pending?.type !== 'confirm') return;
    const { decision, card } = this.pending;
    this.emit('confirmed', { command: decision.command });
    return this.executeDecision(decision, card);
  }

  async cancel() {
    if (!this.pending) return;
    const command = this.pending.decision?.command || '';
    await this.record({ type: 'tool', command, args: this.pending.decision?.args || {}, result: '用户取消', status: 'cancelled', focus: command });
    this.emit('cancelled', { command });
    this.pending = null;
    return this.finish('已取消，未执行危险操作。', 'cancelled');
  }

  async undoLast() {
    const last = [...this.ledger.entries].reverse().find(x => x.type === 'tool' && x.status === 'done');
    const undo = last?.undo || (this.registry.has('edit.undo') ? { command: 'edit.undo', args: {} } : null);
    if (!undo || !this.registry.has(undo.command)) {
      this.emit('error', { message: '最近一步没有可用撤销钩' });
      throw new Error('最近一步没有可用撤销钩');
    }
    const result = summarizeToolResult(await this.registry.execute(undo.command, undo.args || {}));
    await this.record({ type: 'tool', command: undo.command, args: undo.args || {}, result: `撤销：${result}`, status: 'undo', focus: last?.focus || undo.command });
    this.emit('finish', { message: `已撤销：${last?.command || undo.command}`, status: 'undo' });
    return { status: 'undo' };
  }

  async finish(message, status = 'done') {
    const fullMessage = asText(message);
    await this.record({ type: 'finish', message: fullMessage, status });
    this.emit('finish', { message: fullMessage, status });
    this.session = null; this.pending = null;
    const result = { status, message: fullMessage };
    this.settleCompletion(result);
    return result;
  }
}
