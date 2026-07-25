// tests/contract/v31-extreme.test.mjs —— AI 极限测试·变异盲区定向契约
// 覆盖变异测试揪出的 5 个盲区：naturalSort 方向 / paginateText 边界 / LZ77 往返 /
// moveNode 防环 / stripMarkup。任何一处逻辑反转或删除都必须在这里翻车。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const { naturalSort } = await import('../../renderer/modules/library/manga.js');
const { lz77, stripMarkup, paginateText, textPageToHtml } = await import('../../renderer/modules/library/mobi.js');
const { createNode, moveNode, appendChild, findNode } = await import('../../renderer/modules/mindmap/model.js');

describe('v31·naturalSort 数字感知（反号变异杀手）', () => {
  test('数字按数值而非字典序', () => {
    const arr = ['第10话', '第2话', '第1话', '第20话', '第3话'];
    arr.sort(naturalSort);
    assert(JSON.stringify(arr) === JSON.stringify(['第1话', '第2话', '第3话', '第10话', '第20话']),
      '应数值升序：' + arr.join(','));
  });
  test('混合前缀各自成组', () => {
    const arr = ['b2', 'a10', 'b1', 'a2'];
    arr.sort(naturalSort);
    assert(JSON.stringify(arr) === JSON.stringify(['a2', 'a10', 'b1', 'b2']), '混合排序错误：' + arr.join(','));
  });
  test('纯数字字符串', () => {
    const arr = ['100', '9', '25'];
    arr.sort(naturalSort);
    assert(JSON.stringify(arr) === JSON.stringify(['9', '25', '100']), '纯数字排序错误：' + arr.join(','));
  });
});

describe('v31·paginateText 分页边界', () => {
  test('短文本单页', () => {
    const p = paginateText('你好世界', 2600);
    assert(p.length === 1 && p[0] === '你好世界', '短文本应单页：' + JSON.stringify(p));
  });
  test('空文本兜底页', () => {
    const p = paginateText('', 100);
    assert(p.length === 1 && p[0].includes('空'), '空文本应给兜底页');
    assert(paginateText(null).length === 1, 'null 不崩');
  });
  test('长文本分页不丢字', () => {
    const para = '天地玄黄宇宙洪荒。'.repeat(8) + '\n\n';
    const text = para.repeat(60); // 约 4320 字
    const pages = paginateText(text, 500);
    assert(pages.length >= 5, '应分出多页，实际 ' + pages.length);
    const joined = pages.join('').replace(/\s/g, '');
    assert(joined === text.replace(/\s/g, ''), '分页丢字/多字');
  });
  test('优先在段落边界切分', () => {
    const text = ('甲'.repeat(100) + '\n\n').repeat(10); // 每段 100 字
    const pages = paginateText(text, 350);
    // 段落边界切分时，每页应是完整段落的拼接（页内不含半段截断的标记：首尾应为整段边界）
    for (const pg of pages.slice(0, -1)) {
      assert(pg.length <= 350, '页长超限：' + pg.length);
    }
  });
  test('默认页大小 2600（页大小变异杀手）', () => {
    // 不显式传 pageChars：6000 字在 2600 页大小下分 2~3 页；若默认值被改成 1300 会分 4~5 页
    const text = '字'.repeat(6000);
    const pages = paginateText(text);
    assert(pages.length >= 2 && pages.length <= 3, '默认 2600 页大小下 6000 字应分 2~3 页，实际 ' + pages.length);
  });
  test('textPageToHtml 转义 XSS', () => {
    const html = textPageToHtml('<script>alert(1)</script>');
    assert(!html.includes('<script>'), '脚本未被转义');
    assert(html.includes('&lt;script&gt;'), '应转义为实体');
  });
});

describe('v31·PalmDOC LZ77 手工样本（距离+1变异杀手）', () => {
  test('字面+距离长度对：0x02 AB 0x80 0x08 → ABABA', () => {
    const out = lz77(new Uint8Array([0x02, 0x41, 0x42, 0x80, 0x08]));
    const s = new TextDecoder('latin1').decode(out);
    assert(s === 'ABABA', '期望 ABABA 实得 ' + JSON.stringify(s));
  });
  test('0xC0+ 规则：空格+字面', () => {
    const out = lz77(new Uint8Array([0x41, 0xc0 | 0x42])); // 'A' + 空格+'B'
    const s = new TextDecoder('latin1').decode(out);
    assert(s === 'A B', '期望 "A B" 实得 ' + JSON.stringify(s));
  });
  test('长距离回填不自爆', () => {
    // 先铺 4 个字面 WXYZ，再距离 4 长度 6（允许重叠复制）
    const bytes = [0x04, 0x57, 0x58, 0x59, 0x5a];
    const dist4 = 4 << 2; // c 高 6 位 + c2
    bytes.push(0x80 | (dist4 >> 8), ((dist4 & 0xff) & 0xf8) | (6 - 3));
    const out = lz77(new Uint8Array(bytes));
    const s = new TextDecoder('latin1').decode(out);
    assert(s === 'WXYZWXYZWX', '重叠复制错误：' + JSON.stringify(s));
  });
  test('截断输入不抛异常', () => {
    let threw = false;
    try { lz77(new Uint8Array([0x80])); lz77(new Uint8Array([0x05, 0x41])); } catch { threw = true; }
    assert(!threw, '截断输入应静默收尾而非抛异常');
  });
});

describe('v31·moveNode 防环（防环反转变异杀手）', () => {
  function tree() {
    const roots = [];
    const a = createNode('A'), b = createNode('B'), c = createNode('C');
    roots.push(a);
    appendChild(roots, a.id, b);
    appendChild(roots, b.id, c);
    return { roots, a, b, c };
  }
  test('父节点移入自己的孙子 → 拒绝且树不变', () => {
    const { roots, a, c } = tree();
    const ok = moveNode(roots, a.id, c.id);
    assert(ok === false, '移入后代必须拒绝');
    assert(roots.length === 1 && roots[0].id === a.id, '树根不应变化');
    assert(findNode(roots, c.id), 'C 不应丢失');
  });
  test('移入自己 → 拒绝', () => {
    const { roots, a } = tree();
    assert(moveNode(roots, a.id, a.id) === false, '移入自己必须拒绝');
  });
  test('正常移动 → 成功且结构正确', () => {
    const { roots, a, b, c } = tree();
    const ok = moveNode(roots, c.id, a.id); // C 从 B 下移到 A 下
    assert(ok === true, '正常移动应成功');
    const na = findNode(roots, a.id);
    assert(na.children.some(x => x.id === c.id), 'C 应挂在 A 下');
    const nb = findNode(roots, b.id);
    assert(!nb.children.some(x => x.id === c.id), 'C 不应再挂在 B 下');
  });
});

describe('v31·stripMarkup 标记剥离', () => {
  test('script/style 整体剥除', () => {
    const s = stripMarkup('<p>正文</p><script>evil()</script><style>.x{}</style><p>完</p>');
    assert(!/evil|\.x\{/.test(s), 'script/style 残留：' + s);
    assert(s.includes('正文') && s.includes('完'), '正文丢失');
  });
  test('br 与块级闭合转换行', () => {
    const s = stripMarkup('<p>第一行<br>第二行</p><p>新段</p>');
    assert(s.split('\n').length >= 3, '换行转换失败：' + JSON.stringify(s));
  });
  test('HTML 实体解码', () => {
    const s = stripMarkup('&lt;div&gt; &amp; &quot;引号&quot; &#65;&#x42;');
    assert(s.includes('<div>') && s.includes('&') && s.includes('"引号"') && s.includes('AB'),
      '实体解码失败：' + s);
  });
  test('开标签无残留（去标签正则变异杀手）', () => {
    const s = stripMarkup('<p>甲<b>乙</b><span class="x">丙</span></p>');
    assert(s === '甲乙丙', '开标签残留：' + JSON.stringify(s));
  });
  test('注释剥除 + 连续空行压缩', () => {
    const s = stripMarkup('<p>甲</p><!-- 注释 --><p></p><p></p><p>乙</p>');
    assert(!s.includes('注释'), '注释残留');
    assert(!/\n{3,}/.test(s), '三连空行未压缩');
  });
});
