// renderer/core/clipboard.js —— 多格式剪贴板：文本/HTML/图片/文件；「复制为 Markdown」「复制为纯文本」
export const clipboard = {
  async write({ text, html, imagePath }) {
    if (window.mazz?.isElectron) return window.mazz.invoke('clipboard:write', { text, html, imagePath });
    // 浏览器回退
    if (html && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({
        'text/plain': new Blob([text || ''], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      });
      return navigator.clipboard.write([item]);
    }
    return navigator.clipboard.writeText(text || '');
  },
  async read() {
    if (window.mazz?.isElectron) return window.mazz.invoke('clipboard:read');
    const text = await navigator.clipboard.readText().catch(() => '');
    return { text, html: '', hasImage: false, formats: ['text/plain'] };
  },
  async writeText(t) { return this.write({ text: t }); },
};
