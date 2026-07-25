// renderer/lib/custom-apps.js —— 自定义应用（手动寻路 + 面板内自定义命名）
// 外部打开与发送共用的用户自添应用库：settings 键 customApps
// 条目：{id, name, exe, category: word|excel|powerpoint|code|draw|chat}
import { modal, toast } from '../shell/shell.js';
import { iconHtml } from './svg-icons.js';

const KEY = 'customApps';

export const CATEGORY_META = {
  word: { label: '文档类', icon: '📄' },
  excel: { label: '表格类', icon: '📊' },
  powerpoint: { label: '演示类', icon: '📽' },
  code: { label: '代码类', icon: '💻' },
  draw: { label: '绘画类', icon: '🎨' },
  chat: { label: '发送目标（通讯/协作）', icon: '💬' },
};

export async function listCustomApps(category = null) {
  const all = (await window.mazz.invoke('settings:get', { key: KEY }).catch(() => [])) || [];
  return category ? all.filter(a => a.category === category) : all;
}

async function saveAll(list) {
  await window.mazz.invoke('settings:set', { key: KEY, value: list });
}

/** 类别 → 主题自适应 SVG 图标（外部打开/发送按钮统一走这里，风格一致化） */
export function appIconHtml(app) {
  const ico = CATEGORY_META[app.category]?.icon || '🚀';
  return iconHtml(app.custom ? '🚀' : ico);
}

/** 添加/编辑自定义应用弹窗（名称可自定义 + 手动寻路 exe） */
export function editCustomAppDialog({ category, existing = null, onSaved }) {
  const isEdit = !!existing;
  const m = modal(isEdit ? '编辑自定义应用' : '手动添加应用');
  const catOpts = Object.entries(CATEGORY_META).map(([k, v]) =>
    `<option value="${k}" ${k === (existing?.category || category) ? 'selected' : ''}>${v.label}</option>`).join('');
  m.body.innerHTML = `
    <div style="min-width:420px">
      <div class="set-row"><label>显示名称</label>
        <input id="ca-name" class="rb-input" style="width:62%" value="${(existing?.name || '').replace(/"/g, '&quot;')}" placeholder="面板里显示的名字（可自定义）"></div>
      <div class="set-row"><label>程序路径</label>
        <input id="ca-exe" class="rb-input" style="width:50%" value="${(existing?.exe || '').replace(/"/g, '&quot;')}" placeholder="手动寻路 exe" spellcheck="false">
        <button id="ca-browse" class="rb-btn" style="flex-direction:row">浏览…</button></div>
      <div class="set-row"><label>类别</label><select id="ca-cat" class="rb-select">${catOpts}</select></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px">
        <span>${isEdit ? '<button id="ca-del" class="rb-btn" style="flex-direction:row;color:var(--danger)">删除</button>' : ''}</span>
        <button id="ca-save" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存</button>
      </div>
    </div>`;
  m.body.querySelector('#ca-browse').addEventListener('click', async () => {
    const p = await window.mazz.invoke('dialog:openFile', {
      filters: [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd', 'lnk'] }, { name: '所有文件', extensions: ['*'] }],
    }).catch(() => null);
    if (p) {
      m.body.querySelector('#ca-exe').value = p;
      // 未填名称时按文件名预填（用户可改）
      const nameEl = m.body.querySelector('#ca-name');
      if (!nameEl.value.trim()) nameEl.value = p.split(/[\\/]/).pop().replace(/\.(exe|bat|cmd|lnk)$/i, '');
    }
  });
  m.body.querySelector('#ca-save').addEventListener('click', async () => {
    const name = m.body.querySelector('#ca-name').value.trim();
    const exe = m.body.querySelector('#ca-exe').value.trim();
    const cat = m.body.querySelector('#ca-cat').value;
    if (!name) { toast('先起个名字'); return; }
    if (!exe) { toast('先选程序路径'); return; }
    const list = await listCustomApps();
    if (isEdit) {
      const i = list.findIndex(a => a.id === existing.id);
      if (i >= 0) list[i] = { ...list[i], name, exe, category: cat };
    } else {
      list.push({ id: 'ca' + Date.now().toString(36), name, exe, category: cat, custom: true });
    }
    await saveAll(list);
    toast(isEdit ? '已保存修改' : `已添加「${name}」`);
    m.close();
    onSaved?.();
  });
  m.body.querySelector('#ca-del')?.addEventListener('click', async () => {
    const list = await listCustomApps();
    await saveAll(list.filter(a => a.id !== existing.id));
    toast('已删除');
    m.close();
    onSaved?.();
  });
}
