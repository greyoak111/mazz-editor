// renderer/modules/slide/pptx-import.js —— pptx → 大纲文本导入（# 标题 / - 要点 / --- 分页）
// 只依赖 jszip（项目既有依赖）；标题占位符优先，退化取首段；要点保留缩进层级
import JSZip from 'jszip';

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 提取一个 <a:p> 段落的纯文本与层级 */
function paraInfo(pXml) {
  const texts = [...pXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => unescapeXml(m[1]));
  const text = texts.join('').trim();
  if (!text) return null;
  const lvlM = /<a:pPr[^>]*\blvl="(\d+)"/.exec(pXml);
  return { text, lvl: lvlM ? Math.min(4, parseInt(lvlM[1], 10)) : 0 };
}

/** 单页图片提取：<p:pic> → 画布元素（data URL；超大图跳过防卡爆） */
async function slideImages(zip, xml, slidePath) {
  const relsPath = slidePath.replace(/\/([^/]+)$/, '/_rels$1') + '.rels';
  const relsXml = await zip.file(relsPath)?.async('text').catch(() => null) || '';
  const rmap = new Map();
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rmap.set(m[1], m[2]);
  const out = [];
  for (const pm of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const pic = pm[0];
    const embed = /r:embed="([^"]+)"/.exec(pic)?.[1];
    const target = embed && rmap.get(embed);
    if (!target) continue;
    const mediaPath = target.startsWith('../') ? 'ppt/' + target.slice(3)
      : target.startsWith('/') ? target.slice(1)
      : 'ppt/slides/' + target;
    const file = zip.file(mediaPath) || zip.file('ppt/' + target.replace(/^(\.\.\/)+/, ''));
    if (!file) continue;
    const EMU = 914400; // EMU/英寸；画布坐标系 10in × 5.625in
    const offM = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(pic);
    const extM = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(pic);
    const x = offM ? Math.max(0, (+offM[1]) / EMU / 10 * 100) : 18;
    const y = offM ? Math.max(0, (+offM[2]) / EMU / 5.625 * 100) : 22;
    const w = extM ? Math.min(100, (+extM[1]) / EMU / 10 * 100) : 60;
    const h = extM ? Math.min(100, (+extM[2]) / EMU / 5.625 * 100) : 60;
    const ext = (mediaPath.split('.').pop() || 'png').toLowerCase();
    const b64 = await file.async('base64');
    if (b64.length > 3_500_000) continue; // 超大图跳过（防模块卡爆）
    out.push({ type: 'image', src: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`, x, y, w, h });
  }
  return out;
}

/** 单页 slide XML → 大纲片段（文本 + 图片元素） */
async function slideToOutline(zip, xml, idx, slidePath) {
  const shapes = xml.split(/<p:sp[ >]/).slice(1);
  let title = '';
  const bullets = [];
  const loose = [];
  for (const sp of shapes) {
    const isTitle = /type="(?:title|ctrTitle)"/.test(sp);
    const paras = [...sp.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
      .map(m => paraInfo(m[0]))
      .filter(Boolean);
    if (!paras.length) continue;
    if (isTitle && !title) {
      title = paras[0].text;
      for (const p of paras.slice(1)) bullets.push(p);
    } else {
      for (const p of paras) loose.push(p);
    }
  }
  // 无标题占位符：首个文本段当标题
  if (!title && loose.length) title = loose.shift().text;
  const images = await slideImages(zip, xml, slidePath);
  if (!title && !loose.length && !images.length) return `# 第 ${idx + 1} 页`;
  const lines = [`# ${title || `第 ${idx + 1} 页`}`];
  for (const b of loose) lines.push(`${'  '.repeat(b.lvl)}- ${b.text}`);
  if (images.length) lines.push(`<!--canvas:${JSON.stringify(images)}-->`);
  return lines.join('\n');
}

/**
 * @param {ArrayBuffer|Uint8Array} buf pptx 二进制
 * @returns {Promise<string>} 大纲文本（可直接进 slide 模块）
 */
export async function pptxToOutline(buf) {
  const zip = await JSZip.loadAsync(buf);
  const presXml = await zip.file('ppt/presentation.xml')?.async('text');
  if (!presXml) throw new Error('不是合法的 pptx（缺少 presentation.xml）');
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text').catch(() => null) || '';
  const relMap = new Map();
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2]);
  const order = [];
  for (const m of presXml.matchAll(/<p:sldId\b[^>]*?r:id="([^"]+)"/g)) {
    const t = relMap.get(m[1]);
    if (t) order.push('ppt/' + t.replace(/^\/?/, '').replace(/^ppt\//, ''));
  }
  if (!order.length) {
    // 退化：按文件名顺序
    const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    names.sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
    order.push(...names);
  }
  const parts = [];
  for (let i = 0; i < order.length; i++) {
    const xml = await zip.file(order[i])?.async('text').catch(() => null);
    if (xml) parts.push(await slideToOutline(zip, xml, i, order[i]));
  }
  if (!parts.length) throw new Error('pptx 中未找到任何幻灯片');
  return parts.join('\n---\n') + '\n';
}
