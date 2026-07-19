// renderer/modules/slide/outline.js —— 大纲解析/序列化
// 语法：# 页标题 / ## 小节 / - 要点 / ::: notes 备注 / --- 分页 / <!--canvas:{...}--> 画布元素
export function parseOutline(text) {
  const slides = [];
  let cur = null;
  let notesMode = false;
  const lines = String(text || '').split(/\r?\n/);
  const ensure = () => {
    if (!cur) { cur = { title: '', sections: [], notes: '', elements: [] }; }
    return cur;
  };
  const ensureSection = () => {
    const s = ensure();
    if (!s.sections.length) s.sections.push({ heading: '', bullets: [] });
    return s.sections[s.sections.length - 1];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^---+\s*$/.test(line)) {
      if (cur) slides.push(cur);
      cur = null; notesMode = false;
      continue;
    }
    const canvasM = /^<!--canvas:(.*)-->$/.exec(line.trim());
    if (canvasM) {
      try { ensure().elements = JSON.parse(canvasM[1]); } catch {}
      continue;
    }
    const bgM = /^<!--bg:(#[0-9a-fA-F]{3,8})-->$/.exec(line.trim());
    if (bgM) { ensure().bg = bgM[1]; continue; }
    const notesM = /^:::\s*notes?\s*(.*)$/i.exec(line);
    if (notesM) {
      notesMode = true;
      if (notesM[1].trim()) ensure().notes += (ensure().notes ? '\n' : '') + notesM[1].trim();
      continue;
    }
    if (notesMode) {
      ensure().notes += (ensure().notes ? '\n' : '') + line;
      continue;
    }
    if (/^#\s+/.test(line)) {
      const s = ensure();
      s.title = line.replace(/^#\s+/, '');
      continue;
    }
    if (/^##\s+/.test(line)) {
      ensure().sections.push({ heading: line.replace(/^##\s+/, ''), bullets: [] });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      ensureSection().bullets.push(line.replace(/^\s*[-*]\s+/, ''));
      continue;
    }
    if (line.trim() === '') continue;
    // 普通行 → 当前小节要点
    ensureSection().bullets.push(line.trim());
  }
  if (cur) slides.push(cur);
  return slides.length ? slides : [{ title: '', sections: [{ heading: '', bullets: [] }], notes: '', elements: [] }];
}

export function serializeOutline(slides) {
  return (slides || []).map(s => {
    const parts = [];
    if (s.title) parts.push('# ' + s.title);
    for (const sec of s.sections || []) {
      if (sec.heading) parts.push('## ' + sec.heading);
      for (const b of sec.bullets || []) parts.push('- ' + b);
    }
    if (s.notes) parts.push('::: notes\n' + s.notes);
    if (s.elements?.length) parts.push('<!--canvas:' + JSON.stringify(s.elements) + '-->');
    if (s.bg) parts.push('<!--bg:' + s.bg + '-->');
    return parts.join('\n');
  }).join('\n---\n');
}

/** Markdown 文档 → 大纲（桥接 #3：md 含 ##/--- 导出后台编译 pptx） */
export function markdownToOutline(mdText) {
  const lines = String(mdText || '').split(/\r?\n/);
  const out = [];
  let firstSlide = true;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^---+\s*$/.test(line)) { out.push('---'); continue; }
    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    if (h1) {
      if (!firstSlide) out.push('---');
      out.push('# ' + h1[1]);
      firstSlide = false;
      continue;
    }
    if (h2) {
      // 二级标题开新页（其下的 - 要点归入）
      out.push('---');
      out.push('# ' + h2[1]);
      continue;
    }
    if (h3) { out.push('## ' + h3[1]); continue; }
    if (/^\s*[-*+]\s+/.test(line)) { out.push(line.replace(/^\s*[-*+]\s+/, '- ')); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { out.push(line.replace(/^\s*\d+[.)]\s+/, '- ')); continue; }
    if (/^>\s?/.test(line)) { out.push('- ' + line.replace(/^>\s?/, '')); continue; }
    if (line.trim() === '') continue;
    if (/^```|^~~~/.test(line)) continue; // 跳过代码块围栏（代码行作要点）
    out.push('- ' + line.trim());
  }
  return out.join('\n');
}
