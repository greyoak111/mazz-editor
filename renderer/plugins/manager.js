// renderer/plugins/manager.js —— 插件管理器 UI：安装/启用/禁用/删除/打开
import { modal, toast } from '../shell/shell.js';
import { listPluginFiles, inspectPlugin, setEnabled, installFromFile, loadAllPlugins, trustAndLoad, enableTrusted, revokeTrust } from './loader.js';
import { iconHtml } from '../lib/svg-icons.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function openPluginManager() {
  // W53：全原生独立子窗格（应用壳 lean 路线退役）
  if (window.mazz?.isElectron) {
    window.mazz.invoke('panel:open', { kind: 'plugins' }).catch(() => {});
    return;
  }
  const m = modal('插件管理（预览）');
  const render = async () => {
    const files = await listPluginFiles();
    const rows = [];
    for (const f of files) {
      try {
        const info = await inspectPlugin(f.path);
        rows.push({ ...info, path: f.path, error: null });
      } catch (e) {
        rows.push({ manifest: { id: f.name, name: f.name, version: '?' }, path: f.path, enabled: false, loaded: false, trustStatus: 'invalid', error: e.message });
      }
    }
    m.body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:12px;color:var(--fg-dim)">插件默认隔离；只运行已按内容哈希授权的版本</span>
        <button id="plg-install" class="rb-btn" style="flex-direction:row">${iconHtml('＋')}<span>安装插件</span></button>
      </div>
      <div style="max-height:50vh;overflow-y:auto">
        ${rows.length ? rows.map(r => `
          <div class="plg-item" data-id="${r.manifest.id}" style="display:flex;align-items:center;gap:10px;padding:9px 6px;border-bottom:1px solid var(--bd,#e0ded8)">
            <span style="font-size:20px">${iconHtml(r.error ? '⚠' : '🧩')}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${esc(r.manifest.name)} <small style="color:var(--fg-dim)">v${esc(r.manifest.version)}</small></div>
              <div style="font-size:11.5px;color:var(--fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.error || r.manifest.description || r.manifest.id)}</div>
              ${r.error ? '' : `<div style="font-size:10.5px;color:var(--fg-dim);margin-top:3px">${r.trustStatus === 'changed' ? '内容已变化 · 旧授权失效' : r.trustStatus === 'trusted' ? (r.enabled ? '已授权' : '已授权 · 已禁用') : '隔离中 · 未授权'} · SHA-256 ${esc(r.packageHash.slice(0, 12))}…</div>`}
            </div>
            ${r.error ? '' : `
              <button class="rb-btn plg-open" style="flex-direction:row" ${r.enabled && r.loaded ? '' : 'disabled'}>打开</button>
              ${r.trustStatus === 'trusted'
                ? `<button class="rb-btn plg-toggle" style="flex-direction:row">${r.enabled ? '禁用' : '启用'}</button>`
                : '<button class="rb-btn plg-trust" style="flex-direction:row">审查并授权</button>'}`}
            <button class="rb-btn plg-del" style="flex-direction:row">删除</button>
          </div>`).join('')
        : '<div style="text-align:center;color:var(--fg-dim);padding:30px 0">还没有安装插件——点「安装插件」选择 .maz 文件<br><small>交付包 samples/ 目录自带两个示例插件</small></div>'}
      </div>`;
    m.body.querySelector('#plg-install').addEventListener('click', async () => {
      if (!window.mazz?.isElectron) { toast('安装插件需要桌面版'); return; }
      const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'Mazz 插件', extensions: ['maz'] }] });
      if (!p) return;
      try {
        const { manifest } = await installFromFile(p);
        toast(`插件「${manifest.name}」已安装并隔离；审查并授权后才会运行`);
        render();
      } catch (e) { toast('安装失败：' + (e.message || e)); }
    });
    m.body.querySelectorAll('.plg-item').forEach(el => {
      const id = el.dataset.id;
      const row = rows.find(r => r.manifest.id === id);
      el.querySelector('.plg-open')?.addEventListener('click', () => {
        window.MazzHost?.openTab('plugin:' + id, { title: row.manifest.name, content: '' });
        m.close();
      });
      el.querySelector('.plg-toggle')?.addEventListener('click', async () => {
        if (row.enabled) await setEnabled(id, false);
        else await enableTrusted(row.path, row.packageHash);
        toast(row.enabled ? `插件「${row.manifest.name}」已禁用（已运行实例重启后卸载）` : `插件「${row.manifest.name}」已启用`);
        render();
      });
      el.querySelector('.plg-trust')?.addEventListener('click', async () => {
        const permissions = row.permissions?.length ? row.permissions.join('、') : '未声明';
        if (!window.confirm(`将授权并运行插件「${row.manifest.name}」v${row.manifest.version}\n\nSHA-256：${row.packageHash}\n声明权限：${permissions}\n\n当前插件系统尚未提供进程级沙箱。只授权你信任来源的内容。`)) return;
        try { await trustAndLoad(row.path, row.packageHash); toast(`插件「${row.manifest.name}」已授权并启用`); }
        catch (e) { toast('授权失败：' + e.message); }
        render();
      });
      el.querySelector('.plg-del')?.addEventListener('click', async () => {
        if (!window.confirm(`删除插件「${row.manifest.name}」并撤销其授权？`)) return;
        await revokeTrust(id);
        await window.mazz.invoke('fs:delete', { path: row.path }).catch(() => {});
        toast('插件已删除且授权已撤销（已运行实例重启后卸载）');
        render();
      });
    });
  };
  render();
}

export function registerPluginCommands(commands) {
  commands.register('plugin.manage', {
    title: '插件管理', icon: '🧩', group: '工具',
    run: () => openPluginManager(),
  });
  commands.register('plugin.reload', {
    title: '重载全部插件', icon: '↻', group: '工具',
    run: async () => {
      const results = await loadAllPlugins();
      const loaded = results.filter(r => r.status === 'loaded').length;
      const errors = results.filter(r => r.status === 'error');
      toast(errors.length ? `已加载 ${loaded} 个插件，${errors.length} 个出错：${errors[0].error}` : `已加载 ${loaded} 个插件`);
    },
  });
}
