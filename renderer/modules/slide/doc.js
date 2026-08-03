// renderer/modules/slide/doc.js —— mazzslide v2 文档模型（FreeShow 同款骨架：物料×编排分离+百分比对象模型）
// 物料层 slides{}（id 键控，不 ordered）+ 编排层 layouts{main:{frames[]}}（放映序列+帧动作）
// Item 坐标全存 0–100 百分比（分辨率无关：渲染按输出分辨率换算——FreeShow percentageStylePos 同款思路）
// 桥接：Item.source 字段预留（后续桥接大摊子统一推进，本波占位不联动——用户拍板维持现状）
import { parseOutline } from './outline.js';

// ==================== 设计分辨率锚（百分比↔像素换算基准；16:9 逻辑像素） ====================
export const DESIGN = { w: 1920, h: 1080 };
/** 百分比→像素（outW/outH 输出分辨率） */
export function pctToPx(p, axis, outW = DESIGN.w, outH = DESIGN.h) {
  return (axis === 'x' || axis === 'w' ? outW : outH) * (Number(p) / 100);
}
/** 像素→百分比（axis: x/w 走宽，y/h 走高） */
export function pxToPct(v, axis, outW = DESIGN.w, outH = DESIGN.h) {
  return (v / (axis === 'x' || axis === 'w' ? outW : outH)) * 100;
}

let seq = 1;
const nid = (p) => p + (seq++) + '-' + Date.now().toString(36);

// ==================== Item 工厂（六类型+百分比+载荷） ====================
export function createItem(type, props = {}) {
  const it = {
    id: nid('it'), type,
    left: props.left ?? 10, top: props.top ?? 10, width: props.width ?? 80, height: props.height ?? 80,
    rotate: props.rotate ?? 0,
    style: props.style || null,          // { font?, size?, bold?, italic?, color?, bg?, align?, radius?, stroke? }
    bindings: props.bindings || ['main'], // → outputs 绑定（默认主输出）
    reveal: props.reveal || null,         // { mode:'click'|'line', order } 逐点揭示（W39）
    source: null,                         // ★桥接预留字段（BridgeRef——后续统一推进，本波占位不联动）
  };
  switch (type) {
    case 'text':
      it.lines = props.lines || [{ text: props.text || '', style: null }];
      if (props.list) it.list = props.list; // { items:[{text,icon?}] }
      break;
    case 'image':
    case 'media':
      it.src = props.src || null;
      it.fit = props.fit || 'contain';
      break;
    case 'shape':
      it.shape = props.shape || 'rect'; // w31 六符 + arrow/line
      break;
    case 'table':
      it.table = props.table || { rows: [{ cells: [{ text: '' }] }] };
      break;
    case 'ink':
      it.ink = props.ink || { strokes: [] }; // { strokes:[{color,width,points:[{x,y}]}] }
      break;
    case 'timer':
      it.timer = props.timer || { kind: 'countdown', target: 300 };
      break;
    case 'variable':
      it.variable = props.variable || { key: 'page', format: '{n}/{total}' };
      break;
    default:
      it.type = 'text';
      it.lines = [{ text: props.text || '', style: null }];
  }
  return it;
}

// ==================== Slide/Frame/Doc 工厂 ====================
export function createSlide(id, props = {}) {
  return {
    id: id || nid('s'),
    group: props.group || null,
    color: props.color || null,
    notes: props.notes || '',
    bg: props.bg || null,
    items: props.items || [],
  };
}
export function createFrame(slideId, props = {}) {
  return {
    slideId,
    disabled: !!props.disabled,
    transition: props.transition || 'fade',   // fade|slide|zoom|none（W39 放映引擎消费）
    nextAfter: props.nextAfter || 0,          // 到时自动下一帧（秒）
    actions: props.actions || null,           // { clearMedia?, stopTimer?, trigger? }
  };
}
export function createSlideDoc(name = '未命名演示', theme = 'night') {
  return {
    v: 2, name, theme,
    design: { ...DESIGN },
    slides: {},
    layouts: { main: { name: '主放映', frames: [] } },
    outputs: { main: { type: 'window', screen: null, background: 'theme', speakerNotes: false } },
    meta: { createdAt: Date.now(), modifiedAt: null },
  };
}

/** 页→主编排追加一帧 */
export function addSlideToDoc(doc, slide, { frame = true } = {}) {
  doc.slides[slide.id] = slide;
  if (frame) doc.layouts.main.frames.push(createFrame(slide.id));
  doc.meta.modifiedAt = Date.now();
  return slide;
}

/** 物料克隆（W38 页库复制）：深拷贝+页/Item 全换新 id（防跨页 id 撞车） */
export function cloneSlide(src) {
  const cp = JSON.parse(JSON.stringify(src));
  cp.id = nid('s');
  for (const it of (cp.items || [])) it.id = nid('it');
  return cp;
}

// ==================== 序列化/解析（v2 全量 + v1 大纲 lazy 迁移） ====================
export function serializeDoc(doc) {
  return JSON.stringify(doc, null, 1);
}
export function parseDoc(text) {
  const s = String(text || '');
  try {
    const obj = JSON.parse(s);
    if (obj && obj.v === 2 && obj.slides && !Array.isArray(obj.slides)) return obj;
    // v2 中间态防御（slides 数组形态）
    if (obj && obj.v === 2 && Array.isArray(obj.slides)) {
      const doc = createSlideDoc(obj.name || '未命名演示', obj.theme || 'night');
      for (const sl of obj.slides) addSlideToDoc(doc, createSlide(sl.id, sl));
      return doc;
    }
  } catch {}
  // v1 大纲 lazy 迁移（打开即转 v2——迁移纪律同款 w30：数据修正不记撤销）
  return migrateFromOutline(s);
}

/** v2 文档 → v1 大纲文本（外部打开 pptx 导出兼容链复用；按编排帧序） */
export function doc2ToOutline(doc) {
  if (!doc?.layouts?.main?.frames?.length) return '';
  const pages = [];
  for (const fr of doc.layouts.main.frames) {
    const sl = doc.slides[fr.slideId];
    if (!sl) continue;
    const parts = [];
    const titleItem = sl.items?.find(i => i.type === 'text' && i.lines?.length && (i.style?.bold || (i.style?.size || 0) >= 36));
    const title = titleItem?.lines?.[0]?.text || sl.items?.find(i => i.type === 'text')?.lines?.[0]?.text || '';
    if (title) parts.push('# ' + title.split('\n')[0]);
    for (const it of (sl.items || [])) {
      if (it === titleItem) continue;
      if (it.type === 'text' && it.list?.items?.length) {
        for (const li of it.list.items) parts.push('- ' + (li.text || ''));
      } else if (it.type === 'text' && it.lines?.length) {
        for (const l of it.lines) if (l.text && l.text !== title) parts.push('- ' + l.text);
      } else if (it.type === 'shape' && it.shape) {
        parts.push(`<!--canvas:${JSON.stringify([{ type: 'shape', shape: it.shape, left: it.left, top: it.top, width: it.width, height: it.height }])}-->`);
      }
    }
    if (sl.notes) parts.push('::: notes\n' + sl.notes);
    if (sl.bg) parts.push('<!--bg:' + sl.bg + '-->');
    pages.push(parts.join('\n'));
  }
  return pages.join('\n---\n');
}

/** v1 大纲 → v2 文档（每页=slide（标题 Item+内容 Item），每 slide 一帧；bg/notes/canvas 元素随迁） */
export function migrateFromOutline(outlineText) {
  const pages = parseOutline(outlineText);
  const doc = createSlideDoc('未命名演示', 'night');
  for (const p of (Array.isArray(pages) ? pages : [pages])) {
    const items = [];
    if (p.title) {
      items.push(createItem('text', {
        text: p.title, left: 10, top: 30, width: 80, height: 16,
        style: { size: 44, bold: true, align: 'center' },
      }));
    }
    const bullets = [];
    for (const sec of (p.sections || [])) {
      if (sec.heading) bullets.push({ text: sec.heading, style: 'heading' });
      for (const b of (sec.bullets || [])) bullets.push({ text: b });
    }
    if (bullets.length) {
      items.push(createItem('text', {
        left: 12, top: p.title ? 50 : 20, width: 76, height: p.title ? 42 : 68,
        list: { items: bullets.map(b => ({ text: b.text, icon: b.style === 'heading' ? '§' : '•' })) },
        style: { size: 24 },
      }));
    }
    // v1 canvas 元素（<!--canvas:...-->）按百分比近似迁移（形状占位）
    for (const el of (p.elements || [])) {
      if (el && typeof el === 'object') items.push(createItem(el.type || 'shape', { ...el, left: el.left ?? el.x ?? 10, top: el.top ?? el.y ?? 10 }));
    }
    const sl = createSlide(null, { notes: p.notes || '', bg: p.bg || null, items });
    addSlideToDoc(doc, sl);
  }
  if (!doc.layouts.main.frames.length) addSlideToDoc(doc, createSlide(null, { items: [createItem('text', { text: doc.name, style: { size: 40, align: 'center' }, left: 10, top: 40, width: 80, height: 20 })] }));
  return doc;
}
