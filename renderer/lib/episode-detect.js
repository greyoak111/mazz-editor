// renderer/lib/episode-detect.js —— 番剧/剧集识别公共 util（弹幕匹配·自动连播·书库漫画三处共用的「文件名→剧集」解析）
// 支持：S01E02 / s1e2 / [02] / E02·EP02·Ep02 / 第02集·第2集·第02话·第2话 / 1x02 / 尾部「- 02」「 02」

const PATTERNS = [
  /[sS](\d{1,2})[eE](\d{1,4})/,            // S01E02
  /(?<!\d)(\d{1,2})x(\d{1,3})/,             // 1x02（左侧紧邻数字即弃——1920x1080 分辨率误抓实锤）
  /[\s\-_\.][eE][pP]?0*(\d{1,4})(?![\d\w])/,
  /第\s*0*(\d{1,4})\s*[集话回]/,
  /[\[\(\【\[]0*(\d{1,4})[\]\)\】\]]/,      // [02]（02）
  /[\s\-_\.]0*(\d{1,4})(?=\.[a-zA-Z0-9]{2,4}$)/, // 尾部 - 02 / _02 / .02
];

/** 文件名 → { season, episode, series } 或 null（series=清洗后的候选番名） */
export function parseEpisode(filename) {
  const base = String(filename || '').replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  for (const re of PATTERNS) {
    const m = re.exec(base);
    if (!m) continue;
    const hasSeason = m.length >= 3 && m[2] !== undefined;
    const season = hasSeason ? parseInt(m[1], 10) : 1;
    const epStr = hasSeason ? m[2] : m[1];
    const episode = parseInt(epStr, 10);
    if (!isFinite(episode) || episode <= 0 || episode > 500) continue;
    // 集号必须接近文件名尾（其后只允许压制/技术标签）——[01][1920x1080][x264][2582CC95] 的 01 不是集是序号段无妨，
    // 但 [潮骚][2582CC95] 这种纯尾号是 CRC 哈希（小圆实锤）——哈希/分辨率/位率长串一律不算集
    const tail = base.slice(m.index + m[0].length);
    if (!/^[\s_\-\.\[\]\)\}】\]0-9a-zA-Z&%+()（）\[\]{【】\s]*$/.test(tail)) continue;
    if (/^(?:0*[1-9]\d{5,}|0*(?:48|72|108|216)0p?)$/i.test(epStr.replace(/\s/g, ''))) continue;
    // 番名清洗：去压制组标/字幕组标/分辨率/编码/来源标记
    const series = base
      .replace(/[\[\(\【\[][^\]\)\】\]]*(压制|字幕|字幕组|发布|论坛|组|GB|BIG5|简体|繁体|CHT|CHS|1080|720|480|2160|4K|HDR|BD|BDRIP|WEB|TV|HDTV|x264|x265|h264|h265|HEVC|AVC|AAC|FLAC|MP4|MKV|MOV)[^\]\)\】\]]*[\]\)\】\]]/gi, ' ')
      .replace(/[\[\(\【\[]\d{3,4}p[^\]\)\】\]]*[\]\)\】\]]/g, ' ')
      .replace(re, ' ')
      .replace(/[\s_\-\.]+/g, ' ')
      .trim();
    return { season, episode, series: series || base };
  }
  return null;
}

/**
 * 同目录剧集序列中找下一集路径
 * @param currentPath 当前文件路径
 * @param dirEntries  目录条目（fs:listDir 返回 [{name, path, isDir}]）
 * @param mediaExts   媒体扩展名集合（Set of lowercase ext）
 */
export function nextEpisodePath(currentPath, dirEntries, mediaExts) {
  const cur = parseEpisode(currentPath.split('/').pop());
  if (!cur) return null;
  const curNorm = currentPath.replace(/\\/g, '/');
  const cands = [];
  for (const e of dirEntries || []) {
    if (e.isDir) continue;
    const ext = e.name.split('.').pop().toLowerCase();
    if (!mediaExts.has(ext)) continue;
    const p = (e.path || '').replace(/\\/g, '/');
    if (p === curNorm) continue;
    const ep = parseEpisode(e.name);
    if (!ep) continue;
    // 同番判定：番名一致（互相包含兜底压制组差异）且（同季或季+1）
    const sameSeries = ep.series === cur.series || ep.series.includes(cur.series) || cur.series.includes(ep.series);
    if (!sameSeries) continue;
    if (ep.season === cur.season && ep.episode === cur.episode + 1) cands.push({ p, pri: 0 });
    else if (ep.season === cur.season + 1 && ep.episode === 1) cands.push({ p, pri: 1 });
  }
  cands.sort((a, b) => a.pri - b.pri || a.p.localeCompare(b.p, 'zh-CN'));
  return cands[0]?.p || null;
}
