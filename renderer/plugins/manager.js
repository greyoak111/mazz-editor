// renderer/plugins/manager.js —— 插件管理器 UI：安装/启用/禁用/删除/打开
import { modal, toast } from '../shell/shell.js';
import { listPluginFiles, readMaz, isEnabled, setEnabled, installFromFile, loadAllPlugins, loadPlugin } from './loader.js';

export function openPluginManager() {
  const m = modal('插件管理');
  const render = async () => {
    const files = await listPluginFiles();
    const rows = [];
    for (const f of files) {
      try {
        const { manifest } = await readMaz(f.path);
        rows.push({ manifest, path: f.path, enabled: await isEnabled(manifest.id), error: null });
      } catch (e) {
        rows.push({ manifest: { id: f.name, name: f.name, version: '?' }, path: f.path, enabled: false, error: e.message });
      }
    }
    m.body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:12px;color:#83817a">.maz 插件 = zip 包（plugin.json + main.js）· 放置于工作区 plugins/ 自动加载</span>
        <button id="plg-install" class="rb-btn" style="flex-direction:row">＋ 安装插件</button>
      </div>
      <div style="max-height:50vh;overflow-y:auto">
        ${rows.length ? rows.map(r => `
          <div class="plg-item" data-id="${r.manifest.id}" style="display:flex;align-items:center;gap:10px;padding:9px 6px;border-bottom:1px solid var(--bd,#e0ded8)">
            <span style="font-size:20px">${r.error ? '⚠️' : '🧩'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${r.manifest.name} <small style="color:#83817a">v${r.manifest.version}</small></div>
              <div style="font-size:11.5px;color:#83817a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.error || r.manifest.description || r.manifest.id}</div>
            </div>
            ${r.error ? '' : `
              <button class="rb-btn plg-open" style="flex-direction:row" ${r.enabled ? '' : 'disabled'}>打开</button>
              <button class="rb-btn plg-toggle" style="flex-direction:row">${r.enabled ? '禁用' : '启用'}</button>`}
            <button class="rb-btn plg-del" style="flex-direction:row">删除</button>
          </div>`).join('')
        : '<div style="text-align:center;color:#83817a;padding:30px 0">还没有安装插件——点「安装插件」选择 .maz 文件<br><small>交付包 samples/ 目录自带两个示例插件</small></div>'}
      </div>`;
    m.body.querySelector('#plg-install').addEventListener('click', async () => {
      if (!window.mazz?.isElectron) { toast('安装插件需要桌面版'); return; }
      const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'Mazz 插件', extensions: ['maz'] }] });
      if (!p) return;
      try {
        const { manifest } = await installFromFile(p);
        toast(`插件「${manifest.name}」已安装并加载`);
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
        await setEnabled(id, !row.enabled);
        toast(row.enabled ? `插件「${row.manifest.name}」已禁用（重载后生效）` : `插件「${row.manifest.name}」已启用`);
        if (!row.enabled) {
          // 启用：立即加载
          try {
            const { manifest, code } = await readMaz(row.path);
            await loadPlugin(code, manifest);
          } catch (e) { toast('加载失败：' + e.message); }
        }
        render();
      });
      el.querySelector('.plg-del')?.addEventListener('click', async () => {
        await window.mazz.invoke('fs:delete', { path: row.path }).catch(() => {});
        await setEnabled(id, false);
        toast('插件已删除（已加载的实例重启后卸载）');
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
