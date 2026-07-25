// renderer/modules/mindmap/formats-io.js —— 导图格式文件的导入执行与导出落盘（UI 粘合层）
import { toast } from '../../shell/shell.js';
import { exportOpml, exportFreemind, exportXmind, parseMindmapFile } from './formats.js';

async function saveTextFile(defaultName, content, filterName, ext) {
  if (window.mazz?.isElectron) {
    const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
    if (p) {
      await window.mazz.invoke('fs:writeFile', { path: p, content });
      toast('已导出 ' + ext.toUpperCase());
    }
  } else {
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    a.download = defaultName;
    a.click();
  }
}

async function saveBinaryFile(defaultName, bytes, filterName, ext) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const b64 = btoa(s);
  if (window.mazz?.isElectron) {
    const p = await window.mazz.invoke('dialog:saveFile', { defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
    if (p) {
      await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: b64 });
      toast('已导出 ' + ext.toUpperCase());
    }
  } else {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
  }
}

/** 挂到 ctl：三个格式导出方法（在 mindmap/index.js 初始化处调用一次） */
export function attachFormatExports(ctl) {
  ctl.exportOpmlFile = () => saveTextFile((ctl.title || '思维导图') + '.opml', exportOpml(ctl.doc, ctl.title), 'OPML 大纲', 'opml');
  ctl.exportFreemindFile = () => saveTextFile((ctl.title || '思维导图') + '.mm', exportFreemind(ctl.doc), 'FreeMind 导图', 'mm');
  ctl.exportXmindFile = async () => saveBinaryFile((ctl.title || '思维导图') + '.xmind', await exportXmind(ctl.doc, ctl.title), 'XMind 导图', 'xmind');
}

/** 从路径导入导图到当前 ctl（文件树双击与导入按钮共用） */
export async function importMindmapToCtl(path) {
  const ctl = window.__activeMindmapCtl;
  if (!ctl) { toast('先打开一个导图'); return false; }
  const name = path.split(/[\\/]/).pop();
  const ext = (name.split('.').pop() || '').toLowerCase();
  try {
    let data;
    if (ext === 'xmind') {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
      const bin = atob(b64);
      data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    } else {
      data = await window.mazz.invoke('fs:readFile', { path });
    }
    const doc = await parseMindmapFile(name, data);
    ctl.doc = { parentLinks: [], notes: [], refLines: [], ...doc };
    ctl.selected = null; ctl.selectedNote = null; ctl.selectedLine = null;
    ctl.render?.();
    ctl.fitView?.();
    toast(`已导入 ${name}（${doc.roots.length} 个根节点）`);
    return true;
  } catch (e) {
    toast('导入失败：' + e.message);
    return false;
  }
}
