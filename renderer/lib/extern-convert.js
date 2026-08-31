// renderer/lib/extern-convert.js —— 外部打开的格式转换与回传
// 自创格式（mazzsheet/mazzslide/mazzdraw）必须先转成目标软件能读的原生格式（xlsx/pptx/png）再拉起；
// 外部保存后，只在可无损反解时写回原文件；对无完整反向解析器的格式以副本收口，不静默毁掉原生数据。
import { toast } from '../shell/shell.js';

const CONVERT_EXTS = new Set(['mazzsheet', 'mazzslide', 'mazzdraw']);
const pending = new Map(); // tempPath -> { origPath, ext, name, outExt, inst }

export function extOf(p) { return (p || '').split('.').pop().toLowerCase(); }
export function needsConvert(ext) { return CONVERT_EXTS.has(ext); }
export function drawSidecarExtension(outExt) { return outExt === 'ora' ? 'ora' : 'png'; }
export function slideExternalSidecarPaths(origPath) {
  const base = String(origPath || '').replace(/\.mazzslide$/i, '');
  return {
    pptx: `${base}（PowerPoint回传）.pptx`,
    imported: `${base}（PowerPoint导入）.mazzslide`,
  };
}

async function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
async function readB64(path) {
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** 把工作区文件转换为外部可读格式，返回 { launchPath, converted } */
export async function prepareForExternalOpen(tab, inst, targetApp) {
  const ext = extOf(tab.filePath);
  if (!needsConvert(ext)) return { launchPath: tab.filePath, converted: false };
  const ws = await window.mazz.invoke('workspace:get');
  const dir = `${ws}/.mazz/temp`;
  await window.mazz.invoke('fs:mkdir', { path: dir });
  const name = (tab.title || '未命名').replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '-');
  let outExt, b64, slideThemeId = null, slideWasV2 = false;

  if (ext === 'mazzsheet') {
    // 复用模块既有 exportAs 契约，避免另一个表格标签处于 active 时导出错 Workbook。
    const exported = await inst?.def?.exportAs?.('.xlsx', inst.state);
    if (exported?.base64) b64 = exported.base64;
    else {
      const { exportXlsx } = await import('../modules/sheet/io.js');
      const ctl = window.__activeSheetCtl;
      if (!ctl?.wb) throw new Error('表格未就绪');
      const buf = await exportXlsx(ctl.wb, {});
      b64 = await toB64(new Uint8Array(buf));
    }
    outExt = 'xlsx';
  } else if (ext === 'mazzslide') {
    // S2 修复（二次打开外部 PowerPoint 报「格式转换失败」）：步骤化诊断——内容源/解析/导出/写盘分段抱因，
    // 外部打开复用演示模块 exportAs 单一契约；V2 由模块直接走对象级导出，不再先降级成 V1 大纲。
    const ctl = window.__activeSlideCtl;
    let content = inst?.def?.getContent ? inst.def.getContent(inst.state) : null;
    if (typeof content !== 'string') content = content == null ? '' : JSON.stringify(content);
    try {
      const parsed = JSON.parse(content || '{}');
      slideThemeId = parsed?.theme || null;
      slideWasV2 = parsed?.v === 2;
    } catch {}
    const exported = await inst?.def?.exportAs?.('.pptx', inst.state);
    if (exported?.base64) {
      b64 = exported.base64;
    } else {
      // 兼容未登记模块实例的旧调用方；新链路一律不走这里。
      if (!ctl) throw new Error('演示未就绪');
      let buf;
      if (ctl.isV2 && ctl.doc2) {
        slideWasV2 = true;
        const frames = ctl.doc2.layouts?.main?.frames || [];
        const hasContent = frames.some(frame => {
          const slide = ctl.doc2.slides?.[frame.slideId];
          return slide && ((slide.items || []).length || String(slide.notes || '').trim() || slide.bg);
        });
        if (!hasContent) throw new Error('演示内容为空（编辑器里没有可导出的幻灯内容）');
        try {
          const { exportPptxV2 } = await import('../modules/slide/pptx2.js');
          buf = await exportPptxV2(ctl.doc2, ctl.themeId || ctl.doc2.theme);
        } catch (e) { throw new Error('pptx 导出失败：' + (e.message || e)); }
        slideThemeId = ctl.doc2.theme || ctl.themeId || null;
      } else {
        let slides;
        try {
          const { parseOutline } = await import('../modules/slide/outline.js');
          slides = parseOutline(ctl.outlineEl?.value || '');
        } catch (e) { throw new Error('大纲解析失败：' + (e.message || e)); }
        const hasContent = slides.some(s => (s.title || '').trim() || (s.notes || '').trim() || (s.elements || []).length || (s.sections || []).some(sec => (sec.heading || '').trim() || (sec.bullets || []).length));
        if (!hasContent) throw new Error('大纲内容为空（编辑器里没有可导出的幻灯内容）');
        try {
          const { exportPptx } = await import('../modules/slide/pptx.js');
          buf = await exportPptx(slides, ctl.theme);
        } catch (e) { throw new Error('pptx 导出失败：' + (e.message || e)); }
      }
      b64 = await toB64(new Uint8Array(buf));
    }
    outExt = 'pptx';
  } else {
    // mazzdraw：支持 OpenRaster 的绘画软件 → ORA 工程文件（图层可编辑）；
    // Photoshop/Affinity 等不支持 ORA 的 → PNG（否则报「不是所指类型的文档」）
    const ctl = window.__activeDrawCtl;
    const ORA_OK = /Krita|CLIP STUDIO|SAI|MediBang|GIMP|Aseprite|FireAlpaca|MyPaint/i;
    if (targetApp?.category === 'draw' && ORA_OK.test(targetApp?.name || '')) {
      const { exportOra } = await import('../modules/draw/ora.js');
      const frame = ctl?.doc?.frames?.[ctl.doc.current];
      if (!frame) throw new Error('画板未就绪');
      const buf = await exportOra(frame);
      let s = '';
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
      b64 = btoa(s);
      outExt = 'ora';
    } else {
      const dataUrl = ctl?.frameToDataUrl?.();
      if (!dataUrl) throw new Error('画板未就绪');
      b64 = dataUrl.split(',')[1];
      outExt = 'png';
    }
  }

  // 固定名会被外部程序（PowerPoint/PS 等）占用锁定导致二次打开写不进去——每次会话用唯一名
  let tempPath = `${dir}/${name}.${outExt}`;
  try {
    await window.mazz.invoke('fs:writeFileBase64', { path: tempPath, base64: b64 });
  } catch (e) {
    tempPath = `${dir}/${name}-${Date.now().toString(36)}.${outExt}`;
    try {
      await window.mazz.invoke('fs:writeFileBase64', { path: tempPath, base64: b64 });
    } catch (e2) {
      // S2 修复：唯一名也写不进（临时目录权限/占用）——明白话带路径，不再裸「格式转换失败」
      throw new Error(`临时文件写入失败（可能被 ${outExt === 'pptx' ? 'PowerPoint' : '外部程序'}占用或目录无权限）：${dir}`);
    }
  }
  pending.set(tempPath, { origPath: tab.filePath, ext, name, outExt, inst, ...(ext === 'mazzslide' ? { slideThemeId, slideWasV2 } : {}) });
  return { launchPath: tempPath, converted: true, outExt };
}

/** 外部保存回传：可无损格式写回原档；有损格式保存副本（返回是否处理了该路径） */
export async function handleExternalSave(tempPath) {
  const rec = pending.get(tempPath);
  if (!rec) return false;
  try {
    const bytes = await readB64(tempPath);
    if (rec.ext === 'mazzsheet') {
      const { importXlsx } = await import('../modules/sheet/io.js');
      const imported = await importXlsx(null, bytes.buffer);
      // mazzsheet 的真实格式是带 mark 的完整 Workbook，不能把单张 Sheet
      // 冒充工作簿写回，也不能忽略 importXlsx 返回的新 owner。
      const json = JSON.stringify({ mark: 'mazz-sheet-v1', ...imported.serialize() }, null, 1);
      await window.mazz.invoke('fs:writeFile', { path: rec.origPath, content: json });
      if (rec.inst?.def?.setContent) {
        await rec.inst.def.setContent(json, rec.inst.state);
      } else {
        // 兼容转换会话登记前已存在的旧调用方；新调用统一走模块契约。
        const ctl = window.__activeSheetCtl;
        if (ctl) {
          ctl.wb = imported;
          ctl.rebuildGrid?.();
          ctl.renderTabs?.();
        }
      }
    } else if (rec.ext === 'mazzslide') {
      const { pptxToOutline } = await import('../modules/slide/pptx-import.js');
      const outline = await pptxToOutline(bytes.buffer);
      const { migrateFromOutline, serializeDoc } = await import('../modules/slide/doc.js');
      const doc = migrateFromOutline(outline);
      doc.name = rec.name || doc.name;
      if (rec.slideThemeId) doc.theme = rec.slideThemeId;
      const content = serializeDoc(doc);
      if (rec.slideWasV2) {
        // 当前 PPTX 反向解析器只能恢复文本/图片，无法保真 shape、reveal、notes、
        // transition 与物料×编排关系。因此 V2 严禁覆盖原档：保留外部 PPTX，并单独
        // 产出可打开的 V2 导入副本，由用户对照合并。
        const sidecars = slideExternalSidecarPaths(rec.origPath);
        await window.mazz.invoke('fs:writeFileBase64', { path: sidecars.pptx, base64: await toB64(bytes) });
        await window.mazz.invoke('fs:writeFile', { path: sidecars.imported, content });
        toast(`「${rec.name}」原 V2 演示未覆盖；已保存 PowerPoint 回传件和可对照的导入副本`);
        return true;
      }
      await window.mazz.invoke('fs:writeFile', { path: rec.origPath, content });
      // 旧大纲档本来不含 V2 对象语义，可经 setContent 单一入口升级回编辑面。
      if (rec.inst?.def?.setContent) await rec.inst.def.setContent(content, rec.inst.state);
      else window.__activeSlideCtl?.enterV2?.(doc);
    } else {
      // mazzdraw 是矢量帧文档：外部位图修改无法逆回向量——把外部版本存为工作区副本供对照
      const sidecarExt = drawSidecarExtension(rec.outExt);
      const bakPath = rec.origPath.replace(/\.mazzdraw$/i, '') + `（外部编辑）.${sidecarExt}`;
      await window.mazz.invoke('fs:writeFileBase64', { path: bakPath, base64: await toB64(bytes) }); // 大文件不能 spread（爆栈）
      toast(`「${rec.name}」外部版本已存为 ${sidecarExt.toUpperCase()} 副本（矢量帧无法自动逆回）`);
      return true;
    }
    toast(`「${rec.name}」已把外部修改转回本软件格式`);
  } catch (e) {
    toast(`回传「${rec.name}」失败：${e.message}`);
  }
  return true;
}

export function isPendingConvert(p) { return pending.has(p); }
export function clearConvert(p) { pending.delete(p); }

// E2E/排障测试口：bundle 加载即挂（源码依赖图（shell→registry→slide/pptx 含 bare pptxgenjs）在页面内裸 import 源码必炸——
// 触达产品链只能走打包产物形态）
if (typeof window !== 'undefined') window.__externConvert = { prepareForExternalOpen, handleExternalSave, isPendingConvert, clearConvert, pptxToOutline: (buf) => import('../modules/slide/pptx-import.js').then(m => m.pptxToOutline(buf)) };
