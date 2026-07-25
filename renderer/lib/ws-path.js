// renderer/lib/ws-path.js —— 工作区相对路径解析
// 历史坑：'/themes'、'/录制' 这类写法在桌面端会落到文件系统根（Windows 即 C:\ 根目录，需管理员权限），
// 必须拼到工作区下。一律经此模块取绝对路径。
let cached = null;

/** 工作区根（带缓存；'/workspace' 为网页端虚拟根） */
export async function wsRoot() {
  if (cached) return cached;
  const ws = await window.mazz.invoke('workspace:get').catch(() => null);
  cached = (ws || '/workspace').replace(/\\/g, '/').replace(/\/+$/, '');
  return cached;
}

/** 工作区下的绝对路径：wsPath('/themes') → '<ws>/themes' */
export async function wsPath(sub = '') {
  const root = await wsRoot();
  return root + (sub.startsWith('/') ? sub : '/' + sub);
}

/** 工作区切换后调用（目前进程内不变，预留） */
export function invalidateWsCache() { cached = null; }
