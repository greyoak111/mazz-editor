// renderer/sync.js —— 局域网同步 UI + 更新检查命令
import { modal, toast } from './shell/shell.js';

/** 发起共享（主机模式）：桌面走 TLS+WS 双通道；手机/平板走内置 WS 主机（原生 TCP 插件） */
async function openHostDialog() {
  if (!window.mazz?.isElectron) {
    // 移动端当主机：安卓⇄安卓 / 苹果⇄苹果 / 安卓⇄苹果 / 手机⇄电脑 全通
    if (window.Capacitor?.isNativePlatform?.()) return openMobileHostDialog();
    toast('浏览器预览无法当主机，请用「局域网同步：加入」连电脑');
    return;
  }
  try {
    const { port, wsPort, pairCode, fingerprint, deviceId } = await window.mazz.invoke('sync:host', {});
    const m = modal('局域网同步 · 发起共享');
    m.body.innerHTML = `
      <div style="line-height:2;font-size:13.5px">
        <div>本机标识：<b>${deviceId}</b></div>
        <div>证书指纹：<code style="background:var(--bg-hover,#f0efe9);padding:2px 8px;border-radius:5px">${fingerprint}</code></div>
        <div style="margin:14px 0 4px;color:#83817a;font-size:12.5px">在另一台设备上「加入同步」，输入下面信息：</div>
        <div style="font-size:15px">桌面端端口：<b>${port}</b></div>
        ${wsPort ? `<div style="font-size:15px">手机/平板端口：<b>${wsPort}</b>（移动端 App 填这个）</div>` : ''}
        <div style="font-size:12px;color:#a3a19a">IP 均填本机局域网地址</div>
        <div style="font-size:15px">配对码：<b style="font-size:26px;letter-spacing:6px;color:var(--acc,#4f46e5)">${pairCode}</b></div>
        <div style="font-size:12px;color:#a3a19a;margin-top:12px">同步范围：整个工作区（.mazz 临时区除外）· TLS 加密通道 · 冲突时双方文件都保留</div>
        <div class="sync-host-status" style="margin-top:14px;font-size:12.5px;color:#83817a">等待对端接入…（此窗口可关闭，共享保持）</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="sync-stop" class="rb-btn" style="flex-direction:row">停止共享</button></div>
      </div>`;
    m.body.querySelector('#sync-stop').addEventListener('click', async () => {
      await window.mazz.invoke('sync:stopHost');
      toast('已停止共享');
      m.close();
    });
    // 轮询状态
    const timer = setInterval(async () => {
      if (!document.body.contains(m.el)) { clearInterval(timer); return; }
      const st = await window.mazz.invoke('sync:status').catch(() => null);
      // 实时进度条 + 已完成/需完成计数（波次三）
      const progEl = m.body.querySelector('.sync-prog');
      if (progEl) {
        const p = st?.progress;
        if (p?.phase === 'transfer' && p.want) {
          const pct = Math.min(100, Math.round(p.received / p.want * 100));
          progEl.style.display = '';
          progEl.querySelector('.sync-prog-fill').style.width = pct + '%';
          progEl.querySelector('.sync-prog-text').textContent = `同步中 ${p.received}/${p.want}（发出 ${p.sent}）`;
        } else progEl.style.display = 'none';
      }
      if (st?.lastResult && m.body.querySelector('.sync-host-status')) {
        const r = st.lastResult;
        m.body.querySelector('.sync-host-status').innerHTML = r.error
          ? `⚠ ${r.error}`
          : `✅ 上次同步：发出 ${r.sent ?? 0} · 接收 ${r.received ?? 0}${r.conflicts?.length ? ` · 冲突 ${r.conflicts.length}（已保留副本）` : ''}`;
      }
    }, 2000);
  } catch (e) { toast('发起失败：' + (e.message || e)); }
}

/** 移动端发起共享：内置 WS 主机，展示 IP/端口/配对码 */
async function openMobileHostDialog() {
  let host;
  try {
    const { startMobileHost } = await import('./lib/ws-host.js');
    const m = modal('局域网同步 · 本机发起共享');
    const statusHtml = (r) => r.error
      ? `⚠ ${r.error}`
      : `✅ 上次同步：发出 ${r.sent ?? 0} · 接收 ${r.received ?? 0}${r.conflicts?.length ? ` · 冲突 ${r.conflicts.length}（已保留副本）` : ''}`;
    host = await startMobileHost({
      onResult: (r) => {
        const el = m.body.querySelector('.sync-host-status');
        if (el) el.innerHTML = statusHtml(r);
        if (window.MazzNotes?.invalidate) window.MazzNotes.invalidate();
      },
    });
    m.body.innerHTML = `
      <div style="line-height:2;font-size:13.5px">
        <div>本机标识：<b>${host.deviceId || 'mazz-mobile'}</b></div>
        <div style="margin:14px 0 4px;color:#83817a;font-size:12.5px">在另一台设备上「加入同步」，输入下面信息：</div>
        <div style="font-size:15px">本机 IP：<b>${host.addresses.length ? host.addresses.join(' / ') : '（设置→WLAN 里查看）'}</b></div>
        <div style="font-size:15px">端口：<b>${host.port}</b></div>
        <div style="font-size:15px">配对码：<b style="font-size:26px;letter-spacing:6px;color:var(--acc,#4f46e5)">${host.pairCode}</b></div>
        <div style="font-size:12px;color:#a3a19a;margin-top:12px">加密通道：配对码派生 AES-GCM-256 会话密钥 · 冲突时双方文件都保留<br>对端可以是：手机 / 平板 / 电脑（桌面版加入时端口填 ${host.port}）</div>
        <div class="sync-host-status" style="margin-top:14px;font-size:12.5px;color:#83817a">等待对端接入…（此窗口可关闭，共享保持）</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="sync-stop" class="rb-btn" style="flex-direction:row">停止共享</button></div>
      </div>`;
    m.body.querySelector('#sync-stop').addEventListener('click', async () => {
      await host.stop();
      host = null;
      toast('已停止共享');
      m.close();
    });
    // 弹窗被关闭不自动停（与桌面端语义一致：共享保持）
  } catch (e) {
    toast('发起失败：' + (e.message || e));
    try { await host?.stop(); } catch {}
  }
}

/** 加入同步（客户端模式）：桌面走 TLS 通道；移动端/浏览器走 WebSocket 加密通道 */
async function doJoin({ host, port, pairCode }) {
  if (window.mazz?.isElectron) return window.mazz.invoke('sync:join', { host, port, pairCode });
  const { joinSync } = await import('./lib/sync-web.js');
  return joinSync({ host, port, pairCode });
}

async function openJoinDialog() {
  const m = modal('局域网同步 · 加入');
  // mDNS 发现列表
  let discovered = [];
  try { discovered = await window.mazz.invoke('sync:discover'); } catch {}
  m.body.innerHTML = `
    <div style="min-width:400px">
      ${discovered.length ? `<div style="font-size:12px;color:#83817a;margin-bottom:6px">局域网内发现：</div>` +
        discovered.map(d => `<div class="sync-peer" data-host="${d.host}" data-port="${d.port}" style="padding:6px 8px;border:1px solid var(--bd,#e0ded8);border-radius:7px;margin-bottom:6px;cursor:pointer;font-size:12.5px">📡 ${d.name} <small style="color:#83817a">${d.host}:${d.port}</small></div>`).join('')
      : '<div style="font-size:12px;color:#a3a19a;margin-bottom:8px">（mDNS 未发现设备——可手动输入主机信息；也可让对端先「发起共享」）</div>'}
      <div class="set-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <label style="width:52px">主机</label>
        <input id="sj-host" class="rb-input" style="flex:1" placeholder="192.168.1.100" spellcheck="false">
        <input id="sj-port" class="rb-input" style="width:80px" placeholder="47820" spellcheck="false">
      </div>
      <div class="set-row" style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <label style="width:52px">配对码</label>
        <input id="sj-code" class="rb-input" style="width:140px" placeholder="6 位数字" maxlength="6" spellcheck="false">
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="sj-go" class="rb-btn" style="flex-direction:row">开始同步</button>
      </div>
      <div class="sj-status" style="margin-top:10px;font-size:12.5px;color:#83817a"></div>
    </div>`;
  m.body.querySelectorAll('.sync-peer').forEach(el => el.addEventListener('click', () => {
    m.body.querySelector('#sj-host').value = el.dataset.host;
    m.body.querySelector('#sj-port').value = el.dataset.port;
  }));
  m.body.querySelector('#sj-go').addEventListener('click', async () => {
    const host = m.body.querySelector('#sj-host').value.trim();
    const port = parseInt(m.body.querySelector('#sj-port').value, 10) || 47820;
    const pairCode = m.body.querySelector('#sj-code').value.trim();
    const status = m.body.querySelector('.sj-status');
    if (!host || !pairCode) { status.textContent = '请填写主机与配对码'; return; }
    status.textContent = '正在连接并同步…';
    try {
      const r = await doJoin({ host, port, pairCode });
      status.innerHTML = `✅ 同步完成：发出 ${r.sent} 个文件 · 接收 ${r.received} 个文件${r.conflicts?.length ? ` · ⚠ ${r.conflicts.length} 个冲突（双方版本均已保留，冲突副本以 .conflict- 结尾）` : ''}${r.skipped ? ` · 跳过 ${r.skipped}` : ''}`;
      toast('同步完成');
    } catch (e) {
      status.textContent = '⚠ 同步失败：' + (e.message || e);
    }
  });
}

/** 一键再次同步（上次对端） */
async function syncAgain() {
  const st = await window.mazz.invoke('sync:status').catch(() => null);
  if (!st?.lastPeer) { toast('还没有同步记录——先「加入同步」'); return; }
  toast('正在与 ' + st.lastPeer.host + ' 同步…');
  try {
    // 需要配对码——拉 join 对话框并预填
    openJoinDialog();
  } catch (e) { toast(e.message); }
}

export function registerSyncCommands(commands) {
  commands.register('sync.host', {
    title: '局域网同步：发起共享', icon: '📡', group: '同步',
    run: () => openHostDialog(),
  });
  commands.register('sync.join', {
    title: '局域网同步：加入', icon: '🔗', group: '同步',
    run: () => openJoinDialog(),
  });
  commands.register('sync.again', {
    title: '局域网同步：再次同步', icon: '↻', group: '同步',
    run: () => syncAgain(),
  });
  commands.register('update.check', {
    title: '检查更新', icon: '⬆', group: '工具',
    run: async () => {
      const r = await window.mazz.invoke('update:check').catch(() => null);
      if (!r) { toast('检查更新失败'); return; }
      const m = modal('检查更新');
      m.body.innerHTML = `
        <div style="line-height:2;font-size:13.5px">
          <div>当前版本：<b>${r.current}</b></div>
          ${r.latest ? `<div>最新版本：<b>${r.latest}</b></div>` : ''}
          <div style="margin:8px 0;color:${r.hasUpdate ? 'var(--acc,#4f46e5)' : '#16a34a'};font-weight:600">${r.message}</div>
          ${r.notes ? `<div style="font-size:12.5px;color:#83817a;white-space:pre-wrap;max-height:200px;overflow-y:auto;border:1px solid var(--bd,#e0ded8);border-radius:8px;padding:10px">${r.notes}</div>` : ''}
          <div style="margin-top:12px;font-size:12px;color:#a3a19a">更新源：${(r.ok ? '已配置' : '未配置（可在下方设置）')}</div>
          <div class="set-row" style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <input id="upd-url" class="rb-input" style="flex:1" placeholder="更新清单地址（version.json URL）" spellcheck="false">
            <button id="upd-save" class="rb-btn" style="flex-direction:row">保存</button>
          </div>
        </div>`;
      window.mazz.invoke('update:getConfig').then(cfg => {
        if (cfg?.url) m.body.querySelector('#upd-url').value = cfg.url;
      });
      m.body.querySelector('#upd-save').addEventListener('click', async () => {
        await window.mazz.invoke('update:setConfig', { url: m.body.querySelector('#upd-url').value });
        toast('更新源已保存');
      });
    },
  });
}
