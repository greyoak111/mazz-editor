// renderer/modules/mindmap/mm-tplpack.js —— 模板包生态 deals：.mmtpl 导出/导入/库（JSZip 复用 .maz 方案）
// .mmtpl = zip{ meta.json{name,desc,scheme,tpl,createdAt}, doc.json(serializeDoc), preview.png(可选) }
// 库：工作区 mmtpl-packs/ 目录（放包即出现在选单，删包即下榜）
import JSZip from 'jszip';
import { mmRegister } from './mm-modules.js';
import { toast, inputModal } from '../../shell/shell.js';
import { serializeDoc, parseDoc } from './model.js';

const PACK_DIR = 'mmtpl-packs';

async function packDir() {
  const ws = await window.mazz.invoke('workspace:get');
  const dir = `${ws}/${PACK_DIR}`;
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  return dir;
}

function tplSnapshot(ctl) {
  const t = ctl.template || {};
  return { levels: t.levels || null, font: t.font || null, radius: t.radius ?? null, rootBg: t.rootBg ?? null, connColor: t.connColor || null, noteBg: t.noteBg || null, scheme: ctl.doc?.scheme ?? 0 };
}

/** 导出当前文档+样式为 .mmtpl（入工作区库） */
export async function exportPack(ctl, { name, desc } = {}) {
  const dir = await packDir();
  const zip = new JSZip();
  const meta = { name: name || (ctl.tabTitle || '未命名包'), desc: desc || '', version: 1, createdAt: new Date().toISOString(), tpl: tplSnapshot(ctl) };
  zip.file('meta.json', JSON.stringify(meta, null, 1));
  zip.file('doc.json', serializeDoc(ctl.doc));
  try {
    const png = await ctl.renderToDataUrl?.({ scale: 0.5 });
    if (png) zip.file('preview.png', png.split(',')[1], { base64: true });
  } catch {}
  const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  let s = '';
  for (let i = 0; i < blob.length; i += 8192) s += String.fromCharCode(...blob.subarray(i, i + 8192));
  const safe = (meta.name || 'mmtpl').replace(/[\\/:*?"<>|]/g, '-');
  const p = `${dir}/${safe}.mmtpl`;
  await window.mazz.invoke('fs:writeFileBase64', { path: p, base64: btoa(s) });
  return { path: p, meta };
}

/** 导入 .mmtpl → {meta, doc}（doc 已是 parseDoc 形态） */
export async function importPack(path) {
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(u8);
  const meta = JSON.parse(await zip.file('meta.json').async('string'));
  const docText = await zip.file('doc.json').async('string');
  return { meta, doc: parseDoc(docText) };
}

/** 库列表（工作区 mmtpl-packs/*.mmtpl） */
export async function listPacks() {
  const dir = await packDir();
  const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
  return entries.filter(e => !e.isDir && /\.mmtpl$/i.test(e.name)).map(e => ({ name: e.name.replace(/\.mmtpl$/i, ''), path: e.path, mtime: e.mtime }));
}

/** 应用包：文档入图 + 样式模板挂为当前（样式由模板机制消费） */
export function applyPack(ctl, { meta, doc }) {
  ctl.doc = doc;
  if (meta?.tpl) {
    const t = meta.tpl;
    ctl.template = { ...(ctl.template || {}), ...(t.levels ? { levels: t.levels } : {}), font: t.font ?? ctl.template.font, radius: t.radius ?? ctl.template.radius, rootBg: t.rootBg ?? ctl.template.rootBg, connColor: t.connColor ?? ctl.template.connColor, noteBg: t.noteBg ?? ctl.template.noteBg };
    if (t.scheme != null) ctl.doc.scheme = t.scheme;
  }
  ctl.mutate(() => {});
}

mmRegister('tplpack', {
  init(ctl) {
    // 实例服务口（E2E/deals 直调——页面裸 import 本模块源码会撞 bare jszip 且是新模块实例）
    ctl.tplpack = {
      exportPack: (opts) => exportPack(ctl, opts),
      importPack: (path) => importPack(path),
      listPacks: () => listPacks(),
      applyPack: (pack) => applyPack(ctl, pack),
    };
  },
  commands: {
    exportTplPack: class {
      async execute(ctl) {
        const name = await inputModal('模板包名称', ctl.tabTitle || '我的模板包');
        if (name == null) return false;
        const r = await exportPack(ctl, { name });
        toast(`模板包已入库：${r.meta.name}（mmtpl-packs/）`);
        return r;
      }
    },
    importTplPack: class {
      async execute(ctl, path) {
        const pack = await importPack(path);
        applyPack(ctl, pack);
        toast(`已应用模板包：${pack.meta.name}`);
        return pack;
      }
    }
  }
});
