// renderer/modules/markdown/markdown-it-strike.js —— ~~删除线~~ markdown-it 内联规则（极简实现）
export default function strikePlugin(md) {
  md.inline.ruler.before('emphasis', 'strikethrough', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x7E /* ~ */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x7E) return false;
    if (silent) return false;
    const max = state.posMax;
    let pos = start + 2;
    let found = false;
    while (pos < max) {
      if (state.src.charCodeAt(pos) === 0x7E && state.src.charCodeAt(pos + 1) === 0x7E) {
        if (pos > start + 2) { found = true; break; }
      }
      pos++;
    }
    if (!found) return false;
    state.pos = start + 2;
    state.posMax = pos;
    let token = state.push('s_open', 's', 1);
    token.markup = '~~';
    token = state.push('s_close', 's', -1);
    token.markup = '~~';
    state.pos = pos + 2;
    state.posMax = max;
    return true;
  });
}
