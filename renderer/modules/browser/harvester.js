// W62f：AI 网页对话采集纯内核。页面脚本只返回结构化文本与角色线索。

export const HARVEST_ADAPTERS = Object.freeze([
  { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], messageSelectors: ['main [data-message-author-role]', 'main [data-testid^="conversation-turn-"]'], contentSelectors: ['.markdown', '[data-message-author-role]', '[class*="prose"]'] },
  { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'], messageSelectors: ['main [data-role]', 'main [class*="message"]', '[class*="chat-message"]'], contentSelectors: ['[class*="markdown"]', '[class*="content"]'] },
  { id: 'kimi', name: 'Kimi', hosts: ['kimi.moonshot.cn', 'kimi.com'], messageSelectors: ['main [class*="chat-content-item"]', 'main [class*="message"]', '[class*="segment-content"]'], contentSelectors: ['[class*="markdown"]', '[class*="content"]'] },
  { id: 'doubao', name: '豆包', hosts: ['doubao.com', 'www.doubao.com'], messageSelectors: ['main [data-testid*="message"]', 'main [class*="message"]', '[class*="chat-item"]'], contentSelectors: ['[class*="message-content"]', '[class*="markdown"]', '[class*="content"]'] },
  { id: 'glm', name: '智谱清言', hosts: ['chatglm.cn', 'chat.z.ai'], messageSelectors: ['main [class*="conversation-item"]', 'main [class*="message"]', '[data-role]'], contentSelectors: ['[class*="markdown"]', '[class*="content"]'] },
  { id: 'claude', name: 'Claude', hosts: ['claude.ai'], messageSelectors: ['main [data-testid*="message"]', 'main [data-is-streaming]', 'main [class*="font-claude-message"]'], contentSelectors: ['[data-testid="user-message"]', '[class*="font-claude-message"]', '[class*="prose"]'] },
  { id: 'copilot', name: 'Microsoft Copilot', hosts: ['copilot.microsoft.com', 'www.bing.com'], messageSelectors: ['cib-message-group', '[data-content="user-message"]', '[data-content="ai-message"]', 'main [class*="message"]'], contentSelectors: ['cib-message', '[class*="content"]'] },
  { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com', 'bard.google.com'], messageSelectors: ['main user-query', 'main model-response', 'main [class*="conversation-container"]'], contentSelectors: ['message-content', '.markdown', '[class*="response-container"]'] },
  { id: 'poe', name: 'Poe', hosts: ['poe.com'], messageSelectors: ['main [class*="ChatMessage"]', 'main [data-testid*="message"]', 'main [class*="message"]'], contentSelectors: ['[class*="Message_text"]', '[class*="markdown"]', '[class*="content"]'] },
]);

const GENERIC_ADAPTER = Object.freeze({
  id: 'generic', name: '通用网页对话',
  messageSelectors: ['[data-message-author-role]', '[data-testid^="conversation-turn-"]', '[data-testid*="message"]', '[data-role]', 'main article', 'main [class*="message"]'],
  contentSelectors: ['.markdown', '[class*="message-content"]', '[class*="prose"]', '[class*="content"]'],
});

function hostOf(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase(); }
  catch { return ''; }
}
export function resolveHarvestAdapter(url) {
  const host = hostOf(url);
  return HARVEST_ADAPTERS.find(adapter => adapter.hosts.some(item => host === item || host.endsWith('.' + item))) || GENERIC_ADAPTER;
}

function explicitRole(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return '';
  if (/(?:^|[\s_-])(user|human|prompt|question|customer|访客|用户|提问)(?:$|[\s_-])/.test(text)) return 'user';
  if (/(?:^|[\s_-])(assistant|bot|model|answer|response|ai|机器人|助手|回答)(?:$|[\s_-])/.test(text)) return 'assistant';
  return '';
}

export function normalizeHarvestMessages(rows = []) {
  const output = [], seen = new Set();
  let previous = '';
  for (const raw of Array.isArray(rows) ? rows : []) {
    const text = String(raw?.text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const direct = explicitRole(raw?.role) || explicitRole(raw?.roleHint);
    const role = direct || (previous === 'user' ? 'assistant' : previous === 'assistant' ? 'user' : (output.length % 2 ? 'assistant' : 'user'));
    const uncertain = raw?.uncertain === true || !direct;
    const base = role === 'user' ? '用户' : 'AI';
    output.push({
      id: String(raw?.id || `M${String(output.length + 1).padStart(3, '0')}`),
      role, roleLabel: `${base}${uncertain ? '?' : ''}`, uncertain, text,
    });
    previous = role;
  }
  return output;
}

export function safeHarvestName(value, fallback = '未命名对话') {
  const text = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 72).replace(/[. ]+$/g, '') || fallback;
}

export function buildHarvestMarkdown(meta = {}, rows = []) {
  const messages = normalizeHarvestMessages(rows);
  if (!messages.length) throw new Error('没有可导出的对话消息');
  const topic = safeHarvestName(meta.topic || meta.title || '未命名对话');
  const lines = [
    `# AI 对话：${topic}`, '',
    `- 站点：${meta.site || '通用网页对话'}`,
    `- 来源：<${meta.url || ''}>`,
    `- 采集时间：${meta.capturedAt || new Date().toISOString()}`,
    `- 消息数量：${messages.length}`,
    `- 滚顶轮次：${Number(meta.scrollPasses) || 0}`,
    '', '<!-- mazz-ai-harvest-v1 -->', '', '---', '',
  ];
  messages.forEach((message, index) => lines.push(`## ${String(index + 1).padStart(3, '0')} · ${message.roleLabel}`, '', message.text, ''));
  return lines.join('\n').trimEnd() + '\n';
}

export function harvestScript(url, { maxPasses = 8, settleMs = 280 } = {}) {
  const adapter = resolveHarvestAdapter(url);
  const cfg = JSON.stringify({
    id: adapter.id, name: adapter.name,
    messageSelectors: adapter.messageSelectors,
    contentSelectors: adapter.contentSelectors,
    genericSelectors: GENERIC_ADAPTER.messageSelectors,
  });
  const passes = Math.max(1, Math.min(16, Number(maxPasses) || 8));
  const settle = Math.max(80, Math.min(1200, Number(settleMs) || 280));
  return `(async () => {
    const cfg = ${cfg};
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = value => String(value || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{4,}/g, '\\n\\n\\n').trim();
    const roots = () => {
      const out = [document], seen = new Set(out);
      for (let i = 0; i < out.length; i++) {
        const root = out[i];
        for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) {
          if (node.shadowRoot && !seen.has(node.shadowRoot)) { seen.add(node.shadowRoot); out.push(node.shadowRoot); }
        }
      }
      return out;
    };
    const deepQuery = selector => {
      const out = [], seen = new Set();
      for (const root of roots()) {
        try {
          for (const node of root.querySelectorAll(selector)) {
            if (!seen.has(node)) { seen.add(node); out.push(node); }
          }
        } catch {}
      }
      return out;
    };
    const nodeText = node => {
      if (!node) return '';
      let text = clean(node.innerText || node.textContent || '');
      if (node.shadowRoot) text = clean(text + '\\n' + (node.shadowRoot.innerText || node.shadowRoot.textContent || ''));
      return text;
    };
    const messageCount = () => {
      let best = 0;
      for (const selector of [...cfg.messageSelectors, ...cfg.genericSelectors]) {
        const count = deepQuery(selector).filter(node => {
          const n = nodeText(node).length;
          return n > 0 && n < 100000;
        }).length;
        best = Math.max(best, count);
      }
      return best;
    };
    const scrollTargets = () => {
      const all = [document.scrollingElement, ...deepQuery('main, [role="main"], [class*="scroll"], [class*="conversation"], [class*="chat"]')].filter(Boolean);
      return [...new Set(all)].filter(node => Number(node.scrollHeight) > Number(node.clientHeight) + 48);
    };
    let scrollPasses = 0, stable = 0;
    let lastSignal = clean(document.body?.innerText).length + messageCount() * 1000;
    for (let pass = 0; pass < ${passes}; pass++) {
      for (const target of scrollTargets()) {
        try { target.scrollTop = 0; target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch {}
      }
      try { window.scrollTo(0, 0); } catch {}
      scrollPasses++;
      await sleep(${settle});
      const signal = clean(document.body?.innerText).length + messageCount() * 1000;
      stable = signal <= lastSignal ? stable + 1 : 0;
      lastSignal = Math.max(lastSignal, signal);
      if (stable >= 2) break;
    }
    const messageNodes = selector => deepQuery(selector).filter(node => {
      const text = nodeText(node);
      if (!text || text.length > 100000) return false;
      try { return getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden'; } catch { return true; }
    });
    let chosen = [], chosenSelector = '';
    for (const selector of [...cfg.messageSelectors, ...cfg.genericSelectors]) {
      const rows = messageNodes(selector);
      const unique = rows.filter((node, index) => rows.findIndex(other => nodeText(other) === nodeText(node)) === index);
      if (unique.length > chosen.length) { chosen = unique; chosenSelector = selector; }
      if (cfg.id !== 'generic' && unique.length >= 2) break;
    }
    if (chosen.length < 2) {
      let best = [];
      for (const parent of deepQuery('main, [role="main"], body')) {
        const groups = new Map();
        for (const child of [...(parent.children || [])]) {
          const signature = child.tagName + '|' + [...child.classList].slice(0, 3).sort().join('.');
          const text = nodeText(child);
          if (text.length < 2 || text.length > 100000) continue;
          const group = groups.get(signature) || [];
          group.push(child); groups.set(signature, group);
        }
        for (const group of groups.values()) if (group.length >= 2 && group.length > best.length) best = group;
      }
      if (best.length > chosen.length) { chosen = best; chosenSelector = 'repeated-isomorphic-blocks'; }
    }
    const roleOf = (node, index, previous) => {
      const attrs = [];
      let cur = node;
      for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
        attrs.push(cur.getAttribute?.('data-message-author-role'), cur.getAttribute?.('data-role'), cur.getAttribute?.('data-content'), cur.getAttribute?.('aria-label'), cur.id, cur.className);
      }
      const hint = clean(attrs.filter(Boolean).join(' ')).toLowerCase();
      if (/(^|[\\s_-])(user|human|prompt|question|customer|访客|用户|提问)($|[\\s_-])/.test(hint)) return { role: 'user', uncertain: false, roleHint: hint };
      if (/(^|[\\s_-])(assistant|bot|model|answer|response|ai|机器人|助手|回答)($|[\\s_-])/.test(hint)) return { role: 'assistant', uncertain: false, roleHint: hint };
      const role = previous === 'user' ? 'assistant' : previous === 'assistant' ? 'user' : (index % 2 ? 'assistant' : 'user');
      return { role, uncertain: true, roleHint: hint };
    };
    const contentOf = node => {
      let best = '';
      for (const selector of cfg.contentSelectors) {
        try {
          for (const child of node.querySelectorAll(selector)) {
            const text = nodeText(child);
            if (text.length > best.length) best = text;
          }
        } catch {}
      }
      return best || nodeText(node);
    };
    const messages = [], seenText = new Set();
    let previous = '';
    for (const node of chosen) {
      const text = contentOf(node);
      if (!text || seenText.has(text)) continue;
      seenText.add(text);
      const role = roleOf(node, messages.length, previous);
      messages.push({ id: 'M' + String(messages.length + 1).padStart(3, '0'), text, ...role });
      previous = role.role;
    }
    return {
      adapterId: cfg.id, site: cfg.name, selector: chosenSelector,
      title: clean(document.title),
      topic: clean(document.querySelector('h1')?.innerText || document.title || '未命名对话').slice(0, 120),
      url: location.href, capturedAt: new Date().toISOString(), scrollPasses, messages,
    };
  })()`;
}
