// renderer/modules/notes/library.js —— 笔记库服务：工作区 .md 扫描 + [[双链]] 正/反向索引 + MazzNotes 全局钩子

let cache = null; // { entries, byName, backlinks, scannedAt }

/** 从 Markdown 文本提取 [[双链]] 目标列表 */
export function extractWikiLinks(md) {
  const links = [];
  const re = /\[\[([^\[\]|]+?)(?:\|[^\[\]]+?)?\]\]/g;
  let m;
  while ((m = re.exec(md || '')) !== null) {
    const t = m[1].trim();
    if (t) links.push(t);
  }
  return links;
}

/** 递归列出工作区全部 .md 文件 */
export async function listMarkdownFiles() {
  const ws = await window.mazz.invoke('workspace:get');
  const out = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries = [];
    try { entries = (await window.mazz.invoke('fs:listDir', { path: dir })) || []; } catch { return; }
    for (const e of entries) {
      if (e.isDir) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') await walk(e.path, depth + 1);
      } else if (/\.md$/i.test(e.name)) {
        out.push({ path: e.path, name: e.name.replace(/\.md$/i, ''), dir });
      }
    }
  }
  await walk(ws, 0);
  return out;
}

/** 全量扫描（带缓存；force 强制重建） */
export async function scanLibrary({ force } = {}) {
  if (cache && !force) return cache;
  const files = await listMarkdownFiles();
  const byName = new Map();
  const entries = [];
  for (const f of files) {
    let content = '';
    try { content = (await window.mazz.invoke('fs:readFile', { path: f.path })) || ''; } catch {}
    const entry = { ...f, content, links: extractWikiLinks(content) };
    entries.push(entry);
    byName.set(f.name.toLowerCase(), entry);
  }
  // 反向链接：target（小写） -> [来源笔记]
  const backlinks = new Map();
  for (const e of entries) {
    for (const l of e.links) {
      const k = l.toLowerCase();
      if (!backlinks.has(k)) backlinks.set(k, []);
      backlinks.get(k).push({ path: e.path, name: e.name });
    }
  }
  cache = { entries, byName, backlinks, scannedAt: Date.now() };
  return cache;
}

/** 按名称解析笔记（大小写不敏感，不含 .md） */
export async function resolveNote(target) {
  const lib = await scanLibrary();
  return lib.byName.get(String(target || '').trim().toLowerCase()) || null;
}

/** 反向链接：哪些笔记 [[链接]] 到 targetName */
export async function getBacklinks(targetName) {
  const lib = await scanLibrary();
  return lib.backlinks.get(String(targetName || '').trim().toLowerCase()) || [];
}

/** 使缓存失效（内容变更后调用） */
export function invalidate() { cache = null; }

/** 安装全局钩子：markdown 编辑器里的 wikilink 点击 → 打开/创建笔记 */
export function installGlobalHook() {
  window.MazzNotes = {
    async openWikiLink(target) {
      if (!target) return;
      try {
        const hit = await resolveNote(target);
        if (hit) {
          window.MazzCommands.execute('file.openPath', { path: hit.path });
          return;
        }
        // 不存在 → 在工作区根目录创建 target.md（文件名清洗）
        const ws = await window.mazz.invoke('workspace:get');
        const safe = String(target).replace(/[\\/:*?"<>|]/g, '-').trim() || '未命名笔记';
        const path = ws + '/' + safe + '.md';
        const st = await window.mazz.invoke('fs:stat', { path }).catch(() => null);
        const exists = !!st?.exists;
        if (!exists) {
          await window.mazz.invoke('fs:writeFile', { path, content: '# ' + target + '\n\n' });
        }
        invalidate();
        window.MazzCommands.execute('file.openPath', { path });
      } catch (e) {
        console.warn('[notes] openWikiLink 失败', e);
      }
    },
    invalidate,
    scanLibrary,
  };
}
