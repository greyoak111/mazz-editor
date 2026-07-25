// renderer/modules/search/replace.js —— 全局查找替换引擎（预览→逐项/全部写回）
// 范围：整个工作区 / 指定文件夹 / 仅当前文件；打开中的脏标签先提示
import { toast, modal } from '../../shell/shell.js';

/** 命中预览（逐文件逐行带上下文） */
export function collectHits(index, q, { regex, caseSensitive, scope = 'content', rangePaths = null }) {
  const re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  const out = []; // {path, name, hits:[{ln, text, newText}]}
  for (const e of index.mem.values()) {
    if (rangePaths && !rangePaths.some(p => e.path === p || e.path.startsWith(p + '/'))) continue;
    const lines = e.content.split('\n');
    const hits = [];
    if (scope !== 'content') {
      re.lastIndex = 0;
      if (re.test(e.name)) hits.push({ ln: 0, text: '（文件名匹配——替换仅作用于内容）' });
    }
    if (scope !== 'name') {
      lines.forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) hits.push({ ln: i + 1, text: line.slice(0, 240) });
      });
    }
    if (hits.length) out.push({ path: e.path, name: e.name, ext: e.ext, hits });
  }
  return out;
}

/** 执行替换（写回文件；返回 {files, count, skipped}） */
export async function applyReplace(index, groups, q, replacement, { regex, caseSensitive, shell }) {
  const re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  let files = 0, count = 0;
  const skipped = [];
  for (const g of groups) {
    // 打开中的脏标签：先提示跳过（防覆盖未保存内容）
    const openTab = shell?.tabs?.tabs?.find?.(t => t.filePath === g.path);
    if (openTab?.dirty) { skipped.push(g.name); continue; }
    const entry = index.mem.get(g.path);
    if (!entry) continue;
    const before = entry.content;
    let n = 0;
    const after = before.replace(re, () => { n++; return replacement; });
    if (n === 0) continue;
    try {
      await window.mazz.invoke('fs:writeFile', { path: g.path, content: after });
      entry.content = after;
      files++; count += n;
      // 打开中的干净标签：同步重载
      if (openTab) shell.reloadTabFromDisk?.(openTab).catch(() => {});
    } catch (e) { skipped.push(g.name + '（写入失败）'); }
  }
  return { files, count, skipped };
}

/** 预览弹窗（逐项可勾选排除） */
export function previewReplace(groups, { onConfirm }) {
  const total = groups.reduce((s, g) => s + g.hits.length, 0);
  const m = modal(`替换预览（${groups.length} 个文件 · ${total} 处命中）`);
  const excluded = new Set();
  m.body.innerHTML = `
    <div style="min-width:520px;max-width:720px;max-height:62vh;overflow:auto">
      <div style="font-size:12px;color:var(--fg-dim);margin-bottom:8px">勾选要排除的文件（不替换）；其余将全部写回</div>
      ${groups.map((g, gi) => `
        <div class="rp-file" style="margin-bottom:10px">
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px">
            <input type="checkbox" data-gi="${gi}"> ${g.name}
            <span style="font-weight:400;color:var(--fg-dim);font-size:11px">${g.hits.length} 处</span></label>
          <div style="padding-left:22px;font-size:11.5px;color:var(--fg-dim)">
            ${g.hits.slice(0, 4).map(h => `<div>${h.ln ? h.ln + ': ' : ''}${escapeHtml(h.text)}</div>`).join('')}
            ${g.hits.length > 4 ? `<div>…还有 ${g.hits.length - 4} 处</div>` : ''}
          </div>
        </div>`).join('')}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
        <button class="rb-btn" id="rp-cancel" style="flex-direction:row">取消</button>
        <button class="rb-btn" id="rp-go" style="flex-direction:row;background:var(--danger,#dc2626);color:#fff">确认全部替换</button>
      </div>
    </div>`;
  m.body.querySelectorAll('[data-gi]').forEach(cb => cb.addEventListener('change', () => {
    cb.checked ? excluded.add(+cb.dataset.gi) : excluded.delete(+cb.dataset.gi);
  }));
  m.body.querySelector('#rp-cancel').addEventListener('click', () => m.close());
  m.body.querySelector('#rp-go').addEventListener('click', () => {
    const keep = groups.filter((_, i) => !excluded.has(i));
    m.close();
    onConfirm(keep);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 逐个替换：一处一处过（替换此处/跳过/全部剩余/停止） */
export async function replaceSequential(index, groups, q, replacement, { regex, caseSensitive, shell, onDone }) {
  const re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  const queue = [];
  for (const g of groups) for (const h of g.hits) if (h.ln > 0) queue.push({ path: g.path, name: g.name, ln: h.ln });
  if (!queue.length) { toast('没有可替换的命中行'); return; }
  let i = 0, replaced = 0, stopped = false;
  const m = modal(`逐个替换（共 ${queue.length} 处）`);
  const render = async () => {
    if (stopped || i >= queue.length) { m.close(); onDone?.(replaced); return; }
    const cur = queue[i];
    const entry = index.mem.get(cur.path);
    const lines = (entry?.content || '').split('\n');
    const lineText = lines[cur.ln - 1] ?? '';
    m.body.innerHTML = `
      <div style="min-width:480px;max-width:640px">
        <div style="font-size:12px;color:var(--fg-dim)">第 ${i + 1} / ${queue.length} 处 · 已替换 ${replaced}</div>
        <div style="font-weight:600;margin:6px 0 2px">${cur.name} <span style="font-weight:400;color:var(--fg-dim)">第 ${cur.ln} 行</span></div>
        <div style="background:var(--bg-hover,#f5f5f5);border-radius:6px;padding:8px 10px;font-size:12.5px;font-family:monospace;white-space:pre-wrap;word-break:break-all">${escapeHtml(lineText)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button class="rb-btn" data-x="stop" style="flex-direction:row">停止</button>
          <button class="rb-btn" data-x="skip" style="flex-direction:row">跳过</button>
          <button class="rb-btn" data-x="rest" style="flex-direction:row;color:var(--danger)">剩余全部替换</button>
          <button class="rb-btn" data-x="one" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">替换此处</button>
        </div>
      </div>`;
    m.body.querySelector('[data-x=stop]').addEventListener('click', () => { stopped = true; m.close(); onDone?.(replaced); });
    m.body.querySelector('[data-x=skip]').addEventListener('click', async () => { i++; await render(); });
    m.body.querySelector('[data-x=rest]').addEventListener('click', async () => {
      // 剩余走批量引擎（含脏标签保护）
      const restGroups = [];
      const seen = new Map();
      for (let j = i; j < queue.length; j++) {
        const c = queue[j];
        if (!seen.has(c.path)) seen.set(c.path, { path: c.path, name: c.name, hits: [] });
        seen.get(c.path).hits.push({ ln: c.ln, text: '' });
      }
      for (const g of seen.values()) restGroups.push(g);
      const r = await applyReplace(index, restGroups, q, replacement, { regex, caseSensitive, shell });
      replaced += r.count;
      stopped = true; m.close(); onDone?.(replaced, r.skipped);
    });
    m.body.querySelector('[data-x=one]').addEventListener('click', async () => {
      const entry2 = index.mem.get(cur.path);
      if (entry2) {
        const openTab = shell?.tabs?.tabs?.find?.(t => t.filePath === cur.path);
        if (openTab?.dirty) { toast('该文件有未保存修改，已跳过'); i++; await render(); return; }
        const ls = entry2.content.split('\n');
        re.lastIndex = 0;
        const nl = ls[cur.ln - 1].replace(re, () => { replaced++; return replacement; });
        ls[cur.ln - 1] = nl;
        entry2.content = ls.join('\n');
        try {
          await window.mazz.invoke('fs:writeFile', { path: cur.path, content: entry2.content });
          if (openTab) shell.reloadTabFromDisk?.(openTab).catch(() => {});
        } catch (e) { toast('写入失败：' + e.message); }
      }
      i++; await render();
    });
  };
  await render();
}
