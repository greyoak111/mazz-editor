// renderer/lib/codec-guide.js —— 解码能力探测与 HEVC 官方组件指引（播放器设置自检/明白话共用）
// 链接来源：微软官方商店组件分发 CDN（delivery.mp.microsoft.com，发布者 8wekyb3d8bbwe=Microsoft 官方），
// 包实锤：Microsoft.HEVCVideoExtension appxbundle v5.0（包1=x64+ARM64 11.1MB，包2=x64+x86+ARM64 8.3MB）。
// 注意：签名 URL 有时效（约 200 天 Cache-Control）——文案必须带商店检索兜底。

/** 微软官方 HEVC 视频扩展下载（AppxBundle，双击即装或 Add-AppxPackage） */
export const HEVC_LINKS = [
  { name: '官方包①（x64 + ARM64）', url: 'http://tlu.dl.delivery.mp.microsoft.com/filestreamingservice/files/2f81eeca-a31e-451b-b2f9-31244f9cb1a2?P1=1785075478&P2=404&P3=2&P4=CWUYWLwC4YD2%2bv%2b3eQDO3BAxnUhUCwqyzy1pvBThW4h8k3Z9K%2fgUjvDToRZ%2fcax3SiFXJcdNHO60AGFvKIyBog%3d%3d' },
  { name: '官方包②（x64 + x86 + ARM64）', url: 'http://tlu.dl.delivery.mp.microsoft.com/filestreamingservice/files/e941ebae-f256-40c6-9fcc-4ce1e584f1ac?P1=1785075418&P2=404&P3=2&P4=IOffmmj1cGc0l4XJSmncs%2f06iUFSeJWlDLgRsx%2b%2b5KOJikybyBWO1Chun%2bkxz47Wv%2bZ7p26sRMsCsV35sToVng%3d%3d' },
];

const PROBES = [
  ['H.264（AVC）', 'video/mp4; codecs="avc1.640028"'],
  ['HEVC（H.265）', 'video/mp4; codecs="hev1.1.6.L93.B0"'],
  ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
  ['AC-3', 'audio/mp4; codecs="ac-3"'],
  ['VP9', 'video/webm; codecs="vp9"'],
  ['AV1', 'video/mp4; codecs="av01.0.04M.08"'],
];

/** 解码矩阵实测（canPlayType 三态：probably/maybe/''） */
export function probeCodecs() {
  const v = document.createElement('video');
  return PROBES.map(([name, s]) => ({ name, ok: !!v.canPlayType(s), verdict: v.canPlayType(s) || '不支持' }));
}

/** HEVC 缺失时的平台指引行（win32 给官方包链接；mac 原生；linux VAAPI） */
export function hevcGuideLines(platform) {
  if (platform === 'win32') {
    return [
      '未检测到 HEVC 解码组件——安装微软官方「HEVC 视频扩展」（免费）后重启本应用即可：',
      ...HEVC_LINKS.map(l => `HEVC_LINK:${l.name}|${l.url}`),
      '下载后为 .appxbundle 双击即装（或 PowerShell：Add-AppxPackage 文件名）；',
      '链接有时效，若失效：微软商店搜「HEVC Video Extensions」或官方包名 Microsoft.HEVCVideoExtension。',
    ];
  }
  if (platform === 'darwin') return ['macOS 原生支持 HEVC（VideoToolbox 硬解）——本机应直接可播，若失败请反馈。'];
  return ['Linux 需 VAAPI+GPU 硬解 HEVC：安装 vaapi 驱动（如 intel-media-driver / mesa-va-drivers）——本应用已默认开启 VaapiVideoDecoder，驱动到位即可用。'];
}

/** 渲染指引为 DOM（HEVC_LINK: 行转可点链接，点击走 shell:openExternal） */
export function renderHevcGuide(container, platform) {
  const lines = hevcGuideLines(platform);
  container.innerHTML = lines.map(l => {
    if (l.startsWith('HEVC_LINK:')) {
      const [name, url] = l.slice(10).split('|');
      return `<div>· <a href="#" class="codec-link" data-url="${url}" style="color:var(--accent);text-decoration:underline">${name}</a></div>`;
    }
    return `<div>${l}</div>`;
  }).join('');
  container.querySelectorAll('.codec-link').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    window.mazz?.invoke('shell:openExternal', { url: a.dataset.url }).catch(() => {});
  }));
}

/** 平台串（渲染进程判定） */
export function currentPlatform() {
  return window.mazz?.platform || navigator.userAgentData?.platform?.toLowerCase().replace(/^(win32|windows).*/, 'win32') || 'linux';
}
