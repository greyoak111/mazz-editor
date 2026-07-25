// renderer/lib/extern-convert.js —— 外部打开的格式转换与回传
// 自创格式（mazzsheet/mazzslide/mazzdraw）必须先转成目标软件能读的原生格式（xlsx/pptx/png）再拉起；
// 外部保存后，自动把临时文件转回本软件格式写回工作区原文件（仍为本软件编辑的格式）
import { toast } from '../shell/shell.js';

const CONVERT_EXTS = new Set(['mazzsheet', 'mazzslide', 'mazzdraw']);
const pending = new Map(); // tempPath -> { origPath, ext, name }

export function extOf(p) { return (p || '').split('.').pop().toLowerCase(); }
export function needsConvert(ext) { return CONVERT_EXTS.has(ext); }

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
  let outExt, b64;

  if (ext === 'mazzsheet') {
    const { exportXlsx } = await import('../modules/sheet/io.js');
    const ctl = window.__activeSheetCtl;
    if (!ctl?.wb) throw new Error('表格未就绪');
    const buf = await exportXlsx(ctl.wb, {});
    b64 = await toB64(new Uint8Array(buf));
    outExt = 'xlsx';
  } else if (ext === 'mazzslide') {
    const { parseOutline } = await import('../modules/slide/outline.js');
    const { exportPptx } = await import('../modules/slide/pptx.js');
    const { SLIDE_THEMES } = await import('../modules/slide/themes.js');
    const ctl = window.__activeSlideCtl;
    const content = inst?.def?.getContent ? inst.def.getContent(inst.state) : (ctl?.outlineEl?.value || '');
    const theme = ctl?.theme || SLIDE_THEMES[0];
    const buf = await exportPptx(parseOutline(content), theme);
    b64 = await toB64(new Uint8Array(buf));
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
    await window.mazz.invoke('fs:writeFileBase64', { path: tempPath, base64: b64 });
  }
  pending.set(tempPath, { origPath: tab.filePath, ext, name });
  return { launchPath: tempPath, converted: true, outExt };
}

/** 外部保存回传：临时文件 → 本软件格式写回原文件（返回是否处理了该路径） */
export async function handleExternalSave(tempPath) {
  const rec = pending.get(tempPath);
  if (!rec) return false;
  try {
    const bytes = await readB64(tempPath);
    if (rec.ext === 'mazzsheet') {
      const { importXlsx } = await import('../modules/sheet/io.js');
      const ctl = window.__activeSheetCtl;
      if (!ctl?.wb) throw new Error('表格未就绪');
      await importXlsx(ctl.wb, bytes.buffer);
      // 模型已更新 → 序列化写回 mazzsheet
      const json = JSON.stringify(ctl.wb.sheet.serialize(), null, 1);
      await window.mazz.invoke('fs:writeFile', { path: rec.origPath, content: json });
    } else if (rec.ext === 'mazzslide') {
      const { pptxToOutline } = await import('../modules/slide/pptx-import.js');
      const outline = await pptxToOutline(bytes.buffer);
      await window.mazz.invoke('fs:writeFile', { path: rec.origPath, content: outline });
      // 若标签开着 → 同步进编辑器
      const ctl = window.__activeSlideCtl;
      if (ctl) { ctl.outlineEl.value = outline; ctl.sync(); }
    } else {
      // mazzdraw 是矢量帧文档：外部位图修改无法逆回向量——把外部版本存为工作区副本供对照
      const bakPath = rec.origPath.replace(/\.mazzdraw$/i, '') + '（外部编辑）.png';
      await window.mazz.invoke('fs:writeFileBase64', { path: bakPath, base64: await toB64(bytes) }); // 大文件不能 spread（爆栈）
      toast(`「${rec.name}」外部版本已存为 PNG 副本（矢量帧无法自动逆回）`);
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
