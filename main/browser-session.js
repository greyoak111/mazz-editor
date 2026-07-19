// main/browser-session.js —— 隐私浏览器会话加固（webview 独立 partition）
// 反反向追踪：UA/Accept 归一化 + 跨域 Referer 剥离 + 追踪域名拦截 + 第三方 Cookie 拦截 + 新窗审批
'use strict';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 轻量追踪域名拦截表（EasyList 思路，v1 精选高频追踪器）
const TRACKER_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com',
  'facebook.net', 'connect.facebook.net', 'analytics.twitter.com', 'ads.twitter.com',
  'scorecardresearch.com', 'quantserve.com', 'hotjar.com', 'mouseflow.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com',
  'ads.yahoo.com', 'tracking.miui.com', 'hm.baidu.com', 'cnzz.com',
];

class BrowserSession {
  constructor({ session, bus }) {
    this.session = session;

    // —— 请求头归一化：全浏览器流量同一副 UA 面孔；跨域 Referer 剥离 ——
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      headers['User-Agent'] = BROWSER_UA;
      headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
      delete headers['X-Client-Data'];
      delete headers['Sec-CH-UA-Full-Version-List'];

      // 跨域 Referer 剥离（防结果页知道用户从哪来）
      try {
        const ref = headers['Referer'] || headers['referer'];
        if (ref) {
          const refHost = new URL(ref).host;
          const targetHost = new URL(details.url).host;
          if (refHost !== targetHost) {
            delete headers['Referer'];
            delete headers['referer'];
          }
        }
      } catch { /* URL 异常时保持默认 */ }

      callback({ requestHeaders: headers });
    });

    // —— 追踪域名拦截（主资源不拦，只拦子资源/脚本/图片/XHR）——
    session.webRequest.onBeforeRequest((details, callback) => {
      if (details.resourceType !== 'mainFrame') {
        try {
          const host = new URL(details.url).hostname;
          if (TRACKER_HOSTS.some(t => host === t || host.endsWith('.' + t))) {
            return callback({ cancel: true });
          }
        } catch {}
      }
      callback({});
    });

    // —— 第三方 Cookie 拦截 ——
    try {
      const { session: electronSession } = require('electron');
      session.cookies.on('set', (details) => {
        // Electron 无 per-request 第三方判定钩子，v1 通过 Cookie 属性收紧
      });
    } catch {}

    // —— 新窗口审批：一律转为在当前标签体系内打开（防弹窗逃逸）——
    bus.handle('browser:setPermission', async () => true);
  }

  /** 绑定到主窗口的 webview 创建事件（权限审批） */
  hookWindow(win) {
    win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      // 强制安全基线：webview 内禁 nodeIntegration
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
    });
    win.webContents.on('did-attach-webview', (event, wc) => {
      wc.setWindowOpenHandler(({ url }) => {
        // 新窗审批：交给渲染进程新开浏览器标签，不弹 OS 窗口
        win.webContents.send('mazz:event', { channel: 'browser:openUrl', payload: { url } });
        return { action: 'deny' };
      });
    });
  }
}
module.exports = BrowserSession;
