// renderer/modules/slide/pptx2.js —— mazzslide v2 → pptx 对象级导出（W42：Item→OOXML 对象逐个映射+reveal→Animation 单击序列）
// 映射表（设计 3.5）：text→TextBox（百分比转 inches）/image→Image/shape→Shape（六符映射）/table→Table/ink→PNG 渲染嵌入/timer·variable→静态文本/reveal→p:timing 后注入
// 帧属性随迁：disabled→slide.hidden、notes→addNotes；过渡 transition 不入（PowerPoint 切换是另一套 XML，红线不碰）
import { themeById } from './themes.js';

const SHAPE_MAP = { rect: 'rect', round: 'roundRect', diamond: 'diamond', ellipse: 'ellipse', para: 'parallelogram', cylinder: 'can' };
const hex = (c, fb = 'FFFFFF') => String(c || '').replace('#', '').replace(/rgba?\(.*\)/, '') || fb;

/** ink Item → PNG dataURL（离屏画布渲染笔迹；点集抽稀沿用 draw 纪律——相邻 <2px 合并） */
function inkToPng(it, boxW, boxH) {
  const strokes = it.ink?.strokes || [];
  if (!strokes.length) return null;
  const cv = document.createElement('canvas');
  cv.width = Math.max(64, Math.round(boxW * 96)); // 96dpi
  cv.height = Math.max(64, Math.round(boxH * 96));
  const ctx = cv.getContext('2d');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const st of strokes) {
    const pts = (st.points || []).filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 0.4);
    if (!pts.length) continue;
    ctx.strokeStyle = st.color || '#eee';
    ctx.lineWidth = (st.width || 2) * 2;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = p.x / 100 * cv.width, y = p.y / 100 * cv.height; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  return cv.toDataURL('image/png');
}

function fmtCountdown(s) { const m = Math.floor(s / 60), sec = s % 60; return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; }

/** v2 文档 → pptx ArrayBuffer（对象级；reveal 页后注入 timing） */
export async function exportPptxV2(doc, themeId) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const theme = themeById(themeId || doc.theme);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MAZZ', width: 10, height: 5.625 });
  pptx.layout = 'MAZZ';
  pptx.theme = { headFontFace: theme.font.split(',')[0].replace(/"/g, ''), bodyFontFace: theme.font.split(',')[0].replace(/"/g, '') };
  const px = (v) => v / 100 * 10, py = (v) => v / 100 * 5.625;
  const jobs = []; // 与已加页对齐：{ reveal: [{order, spid 待回填}] }

  for (const fr of (doc.layouts?.main?.frames || [])) {
    const sl = doc.slides[fr.slideId];
    if (!sl) continue;
    const slide = pptx.addSlide();
    if (fr.disabled) slide.hidden = true; // 禁用帧→PowerPoint 隐藏页
    slide.background = { color: hex(sl.bg || theme.bg, '1A1A1E') };
    const rev = [];
    for (const it of (sl.items || [])) {
      const box = { x: px(it.left), y: py(it.top), w: px(it.width), h: py(it.height) };
      const rot = it.rotate ? { rotate: it.rotate } : {};
      const st = it.style || {};
      let added = true;
      try {
        switch (it.type) {
          case 'text': {
            const opts = { ...box, ...rot, fontSize: st.size || 18, bold: !!st.bold, italic: !!st.italic, color: hex(st.color || theme.fg, 'EEEEEE'), align: st.align || 'left', valign: 'middle' };
            if (st.bg) opts.fill = { color: hex(st.bg, '222222') };
            if (it.list?.items?.length) slide.addText(it.list.items.map(li => ({ text: `${li.icon || '•'} ${li.text || ''}`, options: { breakLine: true } })), opts);
            else slide.addText((it.lines || []).map(l => l.text || '').join('\n'), opts);
            break;
          }
          case 'image': case 'media': {
            if (!it.src) { added = false; break; }
            if (String(it.src).startsWith('data:')) slide.addImage({ data: it.src, ...box, ...rot });
            else slide.addImage({ path: String(it.src).replace(/^file:\/\//, ''), ...box, ...rot });
            break;
          }
          case 'shape': {
            slide.addShape(SHAPE_MAP[it.shape] || 'rect', {
              ...box, ...rot,
              fill: { color: hex(st.bg, '4F46E5'), transparency: String(st.bg || '').startsWith('rgba') ? 50 : 0 },
              line: { color: hex(st.stroke || theme.accent, '4F46E5'), width: 1 },
            });
            break;
          }
          case 'table': {
            const rows = (it.table?.rows || []).map((r, ri) => (r.cells || []).map(c => ({
              text: c.text || '',
              options: { fill: { color: ri === 0 && it.table?.headers !== false ? '4F46E5' : '2A2A33', transparency: ri === 0 ? 30 : 0 }, color: hex(st.color || theme.fg, 'EEEEEE'), fontSize: 12 },
            })));
            if (rows.length) slide.addTable(rows, { ...box, border: { color: '666666', width: 0.5 } });
            else added = false;
            break;
          }
          case 'ink': {
            const dataUrl = inkToPng(it, box.w, box.h);
            if (dataUrl) slide.addImage({ data: dataUrl, ...box });
            else added = false;
            break;
          }
          case 'timer': {
            slide.addText(it.timer?.kind === 'clock' ? '00:00' : fmtCountdown(it.timer?.target || 300), { ...box, ...rot, fontSize: 28, bold: true, align: 'center', valign: 'middle', color: 'FFFFFF', fill: { color: '111118', transparency: 20 } });
            break;
          }
          case 'variable': {
            slide.addText(`{${it.variable?.key || 'page'}}`, { ...box, ...rot, fontSize: st.size || 18, color: hex(st.color || theme.fg, 'EEEEEE'), valign: 'middle' });
            break;
          }
          default: added = false;
        }
      } catch { added = false; }
      if (added) rev.push({ order: it.reveal?.order | 0, spid: null }); // 插入序=生成序，spid 后回填
    }
    jobs.push({ rev });
    if (sl.notes) slide.addNotes(sl.notes);
  }
  let buf = await pptx.write({ outputType: 'arraybuffer' });
  if (jobs.some(j => j.rev.some(r => r.order >= 1))) buf = await injectRevealAnimations(buf, jobs);
  return buf;
}

/** reveal→Animation 后注入：p:timing 单击出现序列（spid 按插入序回填 cNvPr id） */
async function injectRevealAnimations(buf, jobs) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);
  for (let i = 0; i < jobs.length; i++) {
    const orders = [...new Set(jobs[i].rev.filter(r => r.order >= 1).map(r => r.order))].sort((a, b) => a - b);
    if (!orders.length) continue;
    const path = `ppt/slides/slide${i + 1}.xml`;
    const xml = await zip.file(path)?.async('text').catch(() => null);
    if (!xml) continue;
    // cNvPr id 顺序：跳过组根（id=1）后按文档序=我们的插入序
    const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map(m => +m[1]);
    const shapeIdsInDoc = ids.slice(1); // 组根占位
    if (shapeIdsInDoc.length !== jobs[i].rev.length) continue; // 对不上就不注（降级安全——pptx 本体无损）
    jobs[i].rev.forEach((r, k) => { r.spid = shapeIdsInDoc[k]; });
    let nid = 3;
    const groups = orders.map(o => ({ order: o, spids: jobs[i].rev.filter(r => r.order === o).map(r => r.spid) }));
    const parXml = groups.map(g => `
      <p:par><p:cTn id="${nid++}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>
        <p:par><p:cTn id="${nid++}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
          <p:par><p:cTn id="${nid++}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
            ${g.spids.map(spid => `<p:set><p:cBhvr><p:cTn id="${nid++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`).join('')}
          </p:childTnLst></p:cTn></p:par>
        </p:childTnLst></p:cTn></p:par>
      </p:childTnLst></p:cTn></p:par>`).join('');
    const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${parXml}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
    zip.file(path, xml.replace('</p:sld>', timing + '</p:sld>'));
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
