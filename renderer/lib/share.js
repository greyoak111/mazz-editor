// renderer/lib/share.js —— 发送当前文件到工作软件
// 桌面：剪贴板文件对象 + 唤起客户端（微信/QQ/钉钉；非中文界面换 Slack/Teams/Telegram）
// 移动端：系统分享面板（自动拉起，微信/QQ/钉钉直接可选）
// 诚实边界：桌面端无公开"直发"接口——复制+唤起后，用户到聊天窗口 Ctrl+V 发送
import { modal, toast } from '../shell/shell.js';
import { iconHtml } from './svg-icons.js';

/** 当前操作标签的文件路径（无已保存文件 → null） */
export function activeFilePath(shell) {
  const tab = shell?.tabs?.active;
  return tab?.filePath || null;
}

/** 结果文案（抽出便于测试） */
export function resultMessage(r) {
  if (!r.ok) {
    return {
      'not-installed': `未检测到「${r.name}」客户端——请先安装`,
      'unsupported': '当前平台暂不支持发送',
      'file-missing': '文件不存在（可能已被移动或删除）',
      'unknown-target': '未知目标',
    }[r.reason] || `发送失败：${r.reason}`;
  }
  if (r.running) return `已复制文件——到「${r.name}」聊天窗口 Ctrl+V 发送`;
  if (r.launched) return `已复制文件并启动「${r.name}」——登录后到聊天窗口 Ctrl+V 发送`;
  return `已复制文件，但「${r.name}」未能自动启动——请手动打开后 Ctrl+V 发送`;
}

/** 移动端：系统分享面板 */
async function shareMobile(filePath) {
  const Share = window.Capacitor?.Plugins?.Share;
  if (!Share) { toast('分享插件未就绪'); return; }
  try {
    // 工作区相对路径 → 绝对 URI（Directory.Data）
    const FS = window.Capacitor.Plugins.Filesystem;
    const rel = filePath.replace(/^\//, '');
    const { uri } = await FS.getUri({ path: rel, directory: 'DATA' });
    await Share.share({
      title: filePath.split('/').pop(),
      files: [uri],
      dialogTitle: '发送到…',
    });
  } catch (e) {
    if (!/cancel/i.test(e.message || '')) toast('分享失败：' + (e.message || e));
  }
}

/** 桌面：目标选择弹窗 → 复制 + 唤起 */
async function shareDesktop(filePath) {
  const { getLanguage } = await import('../i18n/index.js');
  const zh = (getLanguage() || 'zh').toLowerCase().startsWith('zh');
  let targets = [];
  try {
    targets = await window.mazz.invoke('share:targets', { locale: zh ? 'zh' : 'intl' });
  } catch (e) { toast('目标检测失败：' + e.message); return; }
  const name = filePath.split(/[\\/]/).pop();

  const m = modal('发送到工作软件');
  const toneChip = (tone, text) => `<span style="display:inline-flex;align-items:center;border-radius:999px;padding:1px 6px;background:var(--${tone});color:var(--${tone}-fg);font-size:11.5px;font-weight:600">${text}</span>`;
  const chip = (t) => t.running
    ? toneChip('ok', '运行中')
    : t.installed
      ? toneChip('warn', t.hasCustomPath ? '自选路径' : '未运行')
      : '<span style="color:var(--fg-dim);font-size:11.5px">未安装</span>';
  const { listCustomApps, editCustomAppDialog, appIconHtml } = await import('./custom-apps.js');
  const renderRows = async () => {
    // 自定义发送目标（手动寻路 + 自定义命名，chat 类别）
    const customs = await listCustomApps('chat');
    const customRows = customs.map(a => `
      <div class="share-target share-custom" data-exe="${a.exe.replace(/"/g, '&quot;')}" data-name="${a.name.replace(/"/g, '&quot;')}" data-cid="${a.id}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border:1px dashed var(--accent,#4f46e5);border-radius:8px;margin-bottom:8px;cursor:pointer;font-size:13.5px">
        <span style="flex:1;display:inline-flex;align-items:center;gap:6px">${appIconHtml(a)} ${a.name}</span>${toneChip('ok', '自定义')}
        <button class="rb-btn share-edit" data-cid="${a.id}" title="编辑/删除" style="flex-direction:row;padding:3px 9px;font-size:11.5px">${iconHtml('✎')}</button>
      </div>`).join('');
    const addRow = `
      <div class="share-add" style="text-align:center;padding:8px;margin-bottom:8px">
        <button class="rb-btn" id="share-add-custom" style="flex-direction:row;display:inline-flex">${iconHtml('✚')} 手动添加目标…</button>
      </div>`;
    m.body.querySelector('.share-rows').innerHTML = (targets.map(t => `
      <div class="share-target" data-id="${t.id}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--bd,#e0ded8);border-radius:8px;margin-bottom:8px;cursor:pointer;font-size:13.5px">
        <span style="flex:1">${t.name}</span>${chip(t)}
        <button class="rb-btn share-browse" data-id="${t.id}" title="手动选择 ${t.name} 的 exe 路径" style="flex-direction:row;padding:3px 9px;font-size:11.5px">选exe…</button>
      </div>`).join('') || '<div style="font-size:12.5px;color:var(--fg-dim)">未检测到可用客户端（浏览器预览无桌面客户端可唤起；移动端请用系统分享）</div>') + customRows + addRow;
    m.body.querySelector('#share-add-custom')?.addEventListener('click', (e) => {
      e.stopPropagation();
      editCustomAppDialog({ category: 'chat', onSaved: () => renderRows() });
    });
    m.body.querySelectorAll('.share-edit').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const a = (await listCustomApps('chat')).find(x => x.id === el.dataset.cid);
      if (a) editCustomAppDialog({ category: 'chat', existing: a, onSaved: () => renderRows() });
    }));
    m.body.querySelectorAll('.share-custom').forEach(el => el.addEventListener('click', async (e) => {
      if (e.target.closest('.share-edit')) return;
      const status = m.body.querySelector('.share-status');
      status.textContent = '正在处理…';
      try {
        const r = await window.mazz.invoke('share:sendToExe', { exe: el.dataset.exe, name: el.dataset.name, path: filePath });
        const msg = resultMessage(r);
        status.textContent = msg;
        if (r.ok) { toast(msg); setTimeout(() => m.close(), 900); }
      } catch (err) { status.textContent = '发送失败：' + (err.message || err); }
    }));
    m.body.querySelectorAll('.share-target').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('.share-browse')) return;
      doSend(el.dataset.id);
    }));
    m.body.querySelectorAll('.share-browse').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      const p = await window.mazz.invoke('dialog:openFile', {
        filters: [{ name: '可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }],
      }).catch(() => null);
      if (!p) return;
      const cur = (await window.mazz.invoke('settings:get', { key: 'share.customPaths' }).catch(() => null)) || {};
      cur[id] = p;
      await window.mazz.invoke('settings:set', { key: 'share.customPaths', value: cur });
      targets = await window.mazz.invoke('share:targets', { locale: zh ? 'zh' : 'intl' }).catch(() => targets);
      await renderRows();
      toast('已记住路径：' + p.split(/[\\/]/).pop());
    }));
  };
  const doSend = async (id) => {
    const status = m.body.querySelector('.share-status');
    status.textContent = '正在处理…';
    try {
      const r = await window.mazz.invoke('share:sendFile', { target: id, path: filePath });
      const msg = resultMessage(r);
      status.textContent = msg;
      if (r.ok) { toast(msg); setTimeout(() => m.close(), 900); }
    } catch (e) {
      status.textContent = '发送失败：' + (e.message || e);
    }
  };
  m.body.innerHTML = `
    <div style="min-width:400px">
      <div style="font-size:12.5px;color:var(--fg-dim);margin-bottom:10px">发送「${name}」：文件会复制到剪贴板并唤起客户端，到聊天窗口 <b>Ctrl+V</b> 即发送</div>
      <div class="share-rows"></div>
      <div class="share-status" style="font-size:12.5px;color:var(--fg);margin-top:6px"></div>
    </div>`;
  await renderRows();
  m.body.querySelectorAll('.share-target').forEach(el => el.addEventListener('click', async () => {
    const id = el.dataset.id;
    const status = m.body.querySelector('.share-status');
    status.textContent = '正在处理…';
    try {
      const r = await window.mazz.invoke('share:sendFile', { target: id, path: filePath });
      const msg = resultMessage(r);
      status.textContent = msg;
      if (r.ok) { toast(msg); setTimeout(() => m.close(), 900); }
    } catch (e) {
      status.textContent = '发送失败：' + (e.message || e);
    }
  }));
}

/** 入口：发送当前活动标签的文件 */
export async function shareActiveFile(shell) {
  const fp = activeFilePath(shell);
  if (!fp) {
    toast('当前标签没有已保存的文件——请先保存（Ctrl+S）再发送');
    return;
  }
  if (window.Capacitor?.isNativePlatform?.()) return shareMobile(fp);
  return shareDesktop(fp);
}
