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
  const output = [];
  let previous = '';
  for (const raw of Array.isArray(rows) ? rows : []) {
    const text = String(raw?.text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    if (!text) continue;
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

export function harvestScript(url, { settleMs = 280, stablePasses = 3 } = {}) {
  const adapter = resolveHarvestAdapter(url);
  const cfg = JSON.stringify({
    id: adapter.id, name: adapter.name,
    messageSelectors: adapter.messageSelectors,
    contentSelectors: adapter.contentSelectors,
    genericSelectors: GENERIC_ADAPTER.messageSelectors,
  });
  const settle = Math.max(80, Math.min(1200, Number(settleMs) || 280));
  const stableNeeded = Math.max(2, Math.min(6, Number(stablePasses) || 3));
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
    const visible = node => {
      try { return getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden'; }
      catch { return true; }
    };
    const messageNodes = selector => deepQuery(selector).filter(node => nodeText(node) && visible(node));
    const scrollTargets = () => {
      const all = [document.scrollingElement, ...deepQuery('main, [role="main"], [class*="scroll"], [class*="conversation"], [class*="chat"]')].filter(Boolean);
      return [...new Set(all)].filter(node => Number(node.scrollHeight) > Number(node.clientHeight) + 48);
    };
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
    const stableKeyOf = node => {
      let cur = node;
      for (let depth = 0; cur && depth < 8; depth++) {
        for (const name of ['data-message-id', 'data-turn-id', 'data-id', 'data-testid', 'id']) {
          const value = clean(name === 'id' ? cur.id : cur.getAttribute?.(name));
          if (!value || /^(?:app|root|main|content|conversation|chat)$/i.test(value)) continue;
          if (name !== 'data-testid' || /(?:message|turn|conversation|chat).*(?:\d|[a-f0-9]{8})|(?:\d|[a-f0-9]{8}).*(?:message|turn|conversation|chat)/i.test(value)) {
            return name + ':' + value;
          }
        }
        const parent = cur.parentElement;
        cur = parent || cur.getRootNode?.().host || null;
      }
      return '';
    };
    const contentOf = node => {
      const candidates = [], seen = new Set();
      for (const selector of cfg.contentSelectors) {
        try {
          for (const child of node.querySelectorAll(selector)) {
            if (!seen.has(child) && visible(child) && nodeText(child)) { seen.add(child); candidates.push(child); }
          }
        } catch {}
      }
      const maximal = candidates.filter(child => !candidates.some(other => other !== child && other.contains?.(child)));
      const order = new Map(candidates.map((child, index) => [child, index]));
      maximal.sort((left, right) => {
        try {
          const relation = left.compareDocumentPosition(right);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        } catch {}
        return order.get(left) - order.get(right);
      });
      return clean(maximal.map(nodeText).join('\\n\\n')) || nodeText(node);
    };
    const candidateSnapshot = () => {
      const selectors = [...new Set([...cfg.messageSelectors, ...cfg.genericSelectors])];
      const encountered = [], origins = new Map();
      for (const selector of selectors) {
        for (const node of messageNodes(selector)) {
          if (!origins.has(node)) { origins.set(node, new Set()); encountered.push(node); }
          origins.get(node).add(selector);
        }
      }
      if (encountered.length < 2) {
        let best = [];
        for (const parent of deepQuery('main, [role="main"], body')) {
          const groups = new Map();
          for (const child of [...(parent.children || [])]) {
            const signature = child.tagName + '|' + [...child.classList].slice(0, 3).sort().join('.');
            if (nodeText(child).length < 2 || !visible(child)) continue;
            const group = groups.get(signature) || [];
            group.push(child); groups.set(signature, group);
          }
          for (const group of groups.values()) if (group.length >= 2 && group.length > best.length) best = group;
        }
        for (const node of best) {
          if (!origins.has(node)) { origins.set(node, new Set()); encountered.push(node); }
          origins.get(node).add('repeated-isomorphic-blocks');
        }
      }
      const chosen = encountered.filter(node => {
        const own = contentOf(node);
        const nested = encountered.filter(other => other !== node && node.contains?.(other)).map(contentOf).filter(Boolean);
        if (new Set(nested).size >= 2) return false;
        return !nested.some(text => text === own);
      });
      const order = new Map(encountered.map((node, index) => [node, index]));
      chosen.sort((left, right) => {
        if (left === right) return 0;
        try {
          const relation = left.compareDocumentPosition(right);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        } catch {}
        return order.get(left) - order.get(right);
      });
      const rows = [];
      let previous = '';
      for (const node of chosen) {
        const text = contentOf(node);
        if (!text) continue;
        const role = roleOf(node, rows.length, previous);
        rows.push({ text, key: stableKeyOf(node), ...role });
        previous = role.role;
      }
      return { rows, selectors: [...new Set(chosen.flatMap(node => [...(origins.get(node) || [])]))] };
    };
    const rowSignature = row => row.key ? 'key:' + row.key : 'text:' + row.text;
    const containsSequence = (whole, part) => {
      if (!part.length) return 0;
      const w = whole.map(rowSignature), p = part.map(rowSignature);
      outer: for (let start = 0; start <= w.length - p.length; start++) {
        for (let i = 0; i < p.length; i++) if (w[start + i] !== p[i]) continue outer;
        return start + 1;
      }
      return 0;
    };
    const overlap = (left, right) => {
      const a = left.map(rowSignature), b = right.map(rowSignature);
      for (let size = Math.min(a.length, b.length); size > 0; size--) {
        let same = true;
        for (let i = 0; i < size; i++) if (a[a.length - size + i] !== b[i]) { same = false; break; }
        if (same) return size;
      }
      return 0;
    };
    const mergeRows = (current, incoming, preferPrepend = false) => {
      if (!current.length) return incoming.slice();
      if (!incoming.length || containsSequence(current, incoming)) return current;
      if (containsSequence(incoming, current)) return incoming.slice();
      const appendOverlap = overlap(current, incoming);
      if (appendOverlap) return [...current, ...incoming.slice(appendOverlap)];
      const prependOverlap = overlap(incoming, current);
      if (prependOverlap) return [...incoming, ...current.slice(prependOverlap)];
      return preferPrepend ? [...incoming, ...current] : [...current, ...incoming];
    };
    const positionState = () => {
      const targets = scrollTargets();
      const values = targets.map(target => [Math.round(Number(target.scrollTop) || 0), Number(target.scrollHeight) || 0, Number(target.clientHeight) || 0].join(':'));
      values.push(['window', Math.round(Number(window.scrollY) || 0), Number(document.documentElement?.scrollHeight) || 0].join(':'));
      return { key: values.join('|'), atStart: targets.every(target => Math.abs(Number(target.scrollTop) || 0) <= 1) && Math.abs(Number(window.scrollY) || 0) <= 1 };
    };
    let snapshot = candidateSnapshot();
    let collected = snapshot.rows, selectorsUsed = new Set(snapshot.selectors);
    let scrollPasses = 0, stable = 0;
    let lastPosition = positionState().key;
    while (stable < ${stableNeeded}) {
      const before = collected.length;
      for (const target of scrollTargets()) {
        try { target.scrollTop = 0; target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch {}
      }
      try { window.scrollTo(0, 0); } catch {}
      scrollPasses++;
      await sleep(${settle});
      snapshot = candidateSnapshot();
      snapshot.selectors.forEach(selector => selectorsUsed.add(selector));
      collected = mergeRows(collected, snapshot.rows, true);
      const position = positionState();
      stable = collected.length === before && position.atStart && position.key === lastPosition ? stable + 1 : 0;
      lastPosition = position.key;
    }
    const messages = collected.map((row, index) => {
      const { key, ...message } = row;
      return { ...message, id: 'M' + String(index + 1).padStart(3, '0') };
    });
    return {
      adapterId: cfg.id, site: cfg.name, selector: [...selectorsUsed].join(' | '),
      title: clean(document.title),
      topic: clean(document.querySelector('h1')?.innerText || document.title || '未命名对话'),
      url: location.href, capturedAt: new Date().toISOString(), scrollPasses, messages,
    };
  })()`;
}
