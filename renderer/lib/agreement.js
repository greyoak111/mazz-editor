// renderer/lib/agreement.js —— 用户服务协议及隐私政策（首启弹出 + Ribbon 常驻入口）
// 展示形态：帮助式窗格；底部「关闭」「知悉」双按钮 + 左侧「后续不再弹出」选框
// 语言：跟随界面语言——中文全中文，非中文全英文
import { getLanguage } from '../i18n/index.js';

const ZH = {
  title: '用户服务协议及隐私政策',
  close: '关闭',
  accept: '知悉',
  noMore: '后续不再弹出',
  body: `## 用户服务协议

**1. 软件性质**　Mazz Editor（下称"本软件"）是一款本地优先的一体化编辑器。本软件按"现状"提供，开发者不对因使用本软件产生的直接或间接损失承担责任。请自行做好重要数据的备份。

**2. 许可与使用**　本软件以 MIT 许可证发布。你可以自由使用、复制、修改和分发，但须保留原作者版权与许可声明。

**3. 你的内容**　你的文档、笔记、书库等全部数据**仅保存在你自己的设备上**，开发者不持有、不访问、不传输你的内容。你对自己的内容及其合法性负全部责任。

**4. 禁止用途**　不得利用本软件从事任何违反当地法律法规的活动。

## 隐私政策

**5. 本地优先**　本软件没有账号体系、没有云同步服务、**不收集任何个人数据、不内置任何统计或遥测**。

**6. 局域网同步**　同步流量只在你的局域网设备之间传输（电脑⇄电脑为 TLS 加密；移动端通道为配对码派生密钥的 AES-GCM 加密），不经过任何第三方服务器。

**7. 联网行为（均由你触发）**，按运营主体分清三类：
　- **开发者提供**：默认网页搜索服务——由开发者部署并维护的 SearXNG 实例，已按**不记录查询日志、不做用户追踪**的原则配置；
　- **第三方公共服务**（非开发者运营，受其各自政策约束）：翻译（MyMemory/LibreTranslate）、OCR 模型下载（tessdata CDN）；
　- **你自行配置**：改用自己的 SearXNG 实例（数据政策由你的实例决定）、检查更新的清单地址（你自行填写）。
除上述情形外，本软件不主动联网。

**8. 权限说明（移动端）**：文件存储（保存你的工作区）、本地网络访问（局域网同步）。除此之外不索取任何权限。

**9. 第三方组件**　本软件集成的开源组件按其各自许可证使用。默认搜索实例基于开源元搜索软件 SearXNG，由开发者按第 7 条所述原则运营；你若改为自部署实例，其运营与数据政策由你（或你的实例管理员）自行负责。

**10. 政策更新**　本协议与隐私政策如有更新，将随新版本在本窗口展示。

*最后更新：2026-07 · 生效日期：自你使用本软件之日起*`,
};

const EN = {
  title: 'Terms of Service & Privacy Policy',
  close: 'Close',
  accept: 'Acknowledged',
  noMore: "Don't show again",
  body: `## Terms of Service

**1. Nature of the Software**　Mazz Editor (the "Software") is a local-first all-in-one editor provided **"as is"**. The developer is not liable for any direct or indirect damages arising from its use. Please back up important data yourself.

**2. License**　The Software is released under the MIT License. You may freely use, copy, modify and distribute it, provided the original copyright and license notice are preserved.

**3. Your Content**　All of your documents, notes and library data are stored **only on your own device**. The developer does not hold, access or transmit your content. You bear full responsibility for your content and its legality.

**4. Prohibited Use**　Do not use the Software for any activity that violates applicable laws or regulations.

## Privacy Policy

**5. Local First**　No accounts, no cloud sync service, **no personal data collection, no analytics, no telemetry**.

**6. LAN Sync**　Sync traffic travels only between your devices on your local network (TLS for desktop-to-desktop; AES-GCM with a pairing-code-derived key for mobile channels). It never passes through any third-party server.

**7. Network Activity (always triggered by you)** — grouped by who operates the service:
　- **Provided by the developer**: the default web search service — a SearXNG instance deployed and maintained by the developer, configured to **keep no query logs and do no user tracking**;
　- **Third-party public services** (not operated by the developer, governed by their own policies): translation (MyMemory/LibreTranslate) and OCR model downloads (tessdata CDN);
　- **Configured by you**: your own SearXNG instance (whose data policy is then yours to define) and the update-manifest URL (which you fill in yourself).
The Software never connects to the network on its own initiative beyond these.

**8. Mobile Permissions**: file storage (for your workspace) and local network access (for LAN sync). Nothing else is requested.

**9. Third-Party Components**　Bundled open-source components are used under their respective licenses. The default search instance is based on the open-source metasearch software SearXNG and is operated by the developer under the principles in Section 7; if you switch to a self-hosted instance, its operation and data policy are your own responsibility (or your instance administrator's).

**10. Updates**　Any changes to these terms will be presented in this window with a new release.

*Last updated: July 2026 · Effective from your first use of the Software*`,
};

const KEY = 'agreement.noMore';

export function agreementContent() {
  const zh = (getLanguage() || 'zh').toLowerCase().startsWith('zh');
  return zh ? ZH : EN;
}

/** 首启是否应弹出（未勾选"不再弹出"时） */
export async function shouldAutoShow() {
  const v = await window.mazz?.invoke('settings:get', { key: KEY }).catch(() => null);
  return v !== true;
}

/** 展示协议窗格（force=false 时遵循"不再弹出"设置仅供首启判断调用方使用） */
export async function showAgreement() {
  // Electron 必须走原生子窗：主窗 DOM modal 会被 WebContentsView 的独立合成层压住，首启时不可操作。
  if (window.mazz?.isElectron) {
    try {
      const result = await window.mazz.invoke('panel:open', { kind: 'agreement' });
      if (!result?.error) return result;
    } catch {}
  }
  const c = agreementContent();
  const { modal } = await import('../shell/shell.js');
  const m = modal(c.title);
  m.body.innerHTML = `
    <div class="agree-body" style="max-width:640px;max-height:56vh;overflow-y:auto;font-size:13px;line-height:1.85;padding-right:6px"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#83817a;cursor:pointer;flex:1">
        <input type="checkbox" id="agree-nomore"> ${c.noMore}
      </label>
      <button id="agree-close" class="rb-btn" style="flex-direction:row;padding:6px 18px">${c.close}</button>
      <button id="agree-accept" class="rb-btn" style="flex-direction:row;padding:6px 18px;background:var(--acc,#4f46e5);color:#fff">${c.accept}</button>
    </div>`;
  // 轻量 Markdown 渲染（## 标题 / **加粗** / 段落）
  const html = c.body
    .split(/\n{2,}/)
    .map(p => {
      if (p.startsWith('## ')) return `<h3 style="margin:14px 0 6px">${p.slice(3)}</h3>`;
      return `<p style="margin:6px 0">${p.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  m.body.querySelector('.agree-body').innerHTML = html;

  const noMore = () => m.body.querySelector('#agree-nomore').checked;
  const done = async (persist) => {
    if (persist && noMore()) await window.mazz?.invoke('settings:set', { key: KEY, value: true }).catch(() => {});
    m.close();
  };
  m.body.querySelector('#agree-close').addEventListener('click', () => done(true));
  m.body.querySelector('#agree-accept').addEventListener('click', () => done(true));
}

/** 首启调用：未勾选"不再弹出"则自动展示 */
export async function maybeAutoShowAgreement() {
  if (await shouldAutoShow()) await showAgreement();
}
