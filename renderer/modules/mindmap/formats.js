// renderer/modules/mindmap/formats.js —— 导图格式互通：OPML / FreeMind(.mm) / XMind(.xmind)
// 映射层级与文本（颜色/便笺/自定义线为非标扩展，不随格式走）
import JSZip from 'jszip';
import { createNode } from './model.js';

const newDoc = () => ({ v: 3, mode: 'lr', scheme: 0, roots: [], notes: [], refLines: [], parentLinks: [] }); // v:3 必带：parseDoc 凭它认 JSON 文档，缺了回退成大纲=打开为空（用户实锤）

// ==================== 工具 ====================
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

function clonePlain(node) {
  return { id: node.id, text: node.text, children: (node.children || []).map(clonePlain) };
}

function fillTree(outline, target) {
  target.text = outline.text ?? '';
  target.children = (outline.children || []).map(ch => fillTree(ch, createNode('')));
  return target;
}

// ==================== OPML ====================
export function exportOpml(doc, title = '思维导图') {
  const node = (n) => `<outline text="${esc(n.text)}">${(n.children || []).map(node).join('')}</outline>`;
  const body = (doc.roots || []).map(node).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>${esc(title)}</title></head><body>${body}</body></opml>`;
}

export function parseOpml(xmlText) {
  const dom = new DOMParser().parseFromString(String(xmlText), 'text/xml');
  if (dom.querySelector('parsererror')) throw new Error('OPML 解析失败（XML 不合法）');
  const walk = (el) => {
    const n = createNode(el.getAttribute('text') || el.getAttribute('title') || '');
    n.children = [...el.children].filter(c => c.tagName === 'outline').map(walk);
    return n;
  };
  const roots = [...dom.querySelectorAll('body > outline')].map(walk);
  if (!roots.length) throw new Error('OPML 中没有 outline 节点');
  return { ...newDoc(), roots };
}

// ==================== FreeMind / Freeplane (.mm) ====================
export function exportFreemind(doc) {
  const node = (n) => `<node TEXT="${esc(n.text)}">${(n.children || []).map(node).join('')}</node>`;
  const [first, ...rest] = doc.roots || [];
  if (!first) return '<map version="1.0.1"><node TEXT="思维导图"/></map>';
  // FreeMind 单根模型：多根包一层虚拟根
  if (!rest.length) return `<map version="1.0.1">${node(first)}</map>`;
  const virtual = { text: first.text || '思维导图', children: doc.roots.map(clonePlain) };
  return `<map version="1.0.1">${node(virtual)}</map>`;
}

export function parseFreemind(xmlText) {
  const dom = new DOMParser().parseFromString(String(xmlText), 'text/xml');
  if (dom.querySelector('parsererror')) throw new Error('FreeMind 解析失败（XML 不合法）');
  const rootEl = dom.querySelector('map > node');
  if (!rootEl) throw new Error('FreeMind 中没有 node 节点');
  const walk = (el) => {
    const n = createNode(unesc(el.getAttribute('TEXT') || ''));
    n.children = [...el.children].filter(c => c.tagName === 'node').map(walk);
    return n;
  };
  const root = walk(rootEl);
  // 虚拟根（文本与首子相同或只有一个子节点）时拆包
  const roots = root.children.length === 1 && root.text ? [root] : (root.text ? [root] : root.children);
  return { ...newDoc(), roots: roots.length ? roots : [root] };
}

// ==================== XMind (.xmind = zip, content.json) ====================
export async function exportXmind(doc, title = '思维导图') {
  const zip = new JSZip();
  const topic = (n, i) => ({
    id: n.id || `t${i}`,
    class: 'topic',
    title: n.text || '',
    ...(n.children?.length ? { children: { attached: n.children.map(topic) } } : {}),
  });
  const roots = (doc.roots || []).map(topic);
  zip.file('content.json', JSON.stringify(roots.length ? roots : [{ id: 'root', class: 'topic', title }], null, 1));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'Mazz Editor' } }, null, 1));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }, null, 1));
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function parseXmind(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const cf = zip.file('content.json');
  if (!cf) throw new Error('XMind 包内缺少 content.json');
  const data = JSON.parse(await cf.async('string'));
  const sheet = Array.isArray(data) ? data[0] : data;
  if (!sheet) throw new Error('XMind content.json 为空');
  const walk = (t) => {
    const n = createNode(t.title || '');
    n.children = (t.children?.attached || []).map(walk);
    return n;
  };
  // XMind 单 sheet 单根；多 sheet 只取首个，根无标题时用其 children
  const root = walk(sheet);
  const roots = root.text ? [root] : (root.children.length ? root.children : [root]);
  return { ...newDoc(), roots };
}

/** 按扩展名分发解析 */
export async function parseMindmapFile(name, data) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'opml') return parseOpml(typeof data === 'string' ? data : new TextDecoder().decode(data));
  if (ext === 'mm') return parseFreemind(typeof data === 'string' ? data : new TextDecoder().decode(data));
  if (ext === 'xmind') return await parseXmind(data);
  throw new Error('不支持的导图格式 .' + ext);
}
