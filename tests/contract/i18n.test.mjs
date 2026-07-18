// tests/contract/i18n.test.mjs —— 多语言：字典完整性 / t() / 切换 / RTL / 插值
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const i18n = await import('../../renderer/i18n/index.js');
const { LANGS, DICTS } = await import('../../renderer/i18n/langs.js');
const { t, tv, setLanguage, getLanguage, isRTL } = i18n;

describe('多语言：语言表与字典完整性', () => {
  test('8 种语言齐备且阿语为 RTL', () => {
    assert.equal(LANGS.length, 8);
    const ids = LANGS.map(l => l.id);
    for (const id of ['zh-CN', 'en', 'ar', 'fr', 'ru', 'es', 'ja', 'ko']) {
      assert.ok(ids.includes(id), '缺语言: ' + id);
    }
    assert.equal(LANGS.find(l => l.id === 'ar').dir, 'rtl');
    for (const l of LANGS.filter(x => x.id !== 'ar')) assert.equal(l.dir, 'ltr', l.id + ' 应为 ltr');
  });

  test('7 份非中文字典 key 集合与英文基准对齐', () => {
    const baseKeys = Object.keys(DICTS.en).sort();
    assert.ok(baseKeys.length >= 120, `英文基准词条应 ≥120（实际 ${baseKeys.length}）`);
    for (const lang of ['ar', 'fr', 'ru', 'es', 'ja', 'ko']) {
      const keys = Object.keys(DICTS[lang]).sort();
      assert.deepEqual(keys, baseKeys, `${lang} 字典 key 集合与英文不一致`);
    }
  });

  test('所有译文非空且不含占位痕迹', () => {
    for (const [lang, dict] of Object.entries(DICTS)) {
      for (const [k, v] of Object.entries(dict)) {
        assert.ok(typeof v === 'string' && v.trim().length > 0, `${lang} 译文为空: ${k}`);
        assert.ok(!/TODO|FIXME|待翻译/.test(v), `${lang} 含占位: ${k}`);
      }
    }
    // 拉丁/阿拉伯系语言译文不得混入中日韩表意文字（ja/ko 自身合法排除；「语言 (Language)」为刻意双语）
    for (const lang of ['en', 'ar', 'fr', 'ru', 'es']) {
      for (const [k, v] of Object.entries(DICTS[lang])) {
        if (k === '语言 (Language)') continue;
        assert.ok(!/[一-鿿]/.test(v), `${lang} 译文夹中文: ${k} => ${v}`);
      }
    }
  });

  test('核心词条抽查（各语言确实翻了而非照抄）', () => {
    assert.equal(DICTS.en['新建文档'], 'New Document');
    assert.notEqual(DICTS.ar['新建文档'], '新建文档');
    assert.notEqual(DICTS.ja['新建文档'], '新建文档');
    assert.notEqual(DICTS.ko['新建文档'], '新建文档');
    assert.ok(DICTS.fr['保存'].length > 0);
    assert.ok(DICTS.ru['保存'].length > 0);
    assert.ok(DICTS.es['保存'].length > 0);
    // 同一词条在不同语言应不同（防复制粘贴）
    assert.notEqual(DICTS.fr['全局搜索'], DICTS.es['全局搜索']);
    assert.notEqual(DICTS.ja['全局搜索'], DICTS.ko['全局搜索']);
  });
});

describe('多语言：t() 与切换', () => {
  test('中文环境原样返回', async () => {
    await setLanguage('zh-CN');
    assert.equal(t('新建文档'), '新建文档');
  });

  test('英文环境命中映射，未命中回落中文', async () => {
    await setLanguage('en');
    assert.equal(t('新建文档'), 'New Document');
    assert.equal(t('一条生僻字符串xyz'), '一条生僻字符串xyz', '未命中应回落原文');
  });

  test('阿语环境切换 + RTL 状态与 DOM 属性', async () => {
    await setLanguage('ar');
    assert.equal(getLanguage(), 'ar');
    assert.ok(isRTL());
    assert.equal(document.documentElement.dir, 'rtl');
    assert.equal(document.documentElement.lang, 'ar');
    await setLanguage('en');
    assert.ok(!isRTL());
    assert.equal(document.documentElement.dir, 'ltr');
    await setLanguage('zh-CN');
  });

  test('tv() 变量插值', async () => {
    await setLanguage('zh-CN');
    assert.equal(tv('共 {n} 个文件', { n: 5 }), '共 5 个文件');
    await setLanguage('en');
    assert.equal(tv('共 {n} 个文件', { n: 5 }), '共 5 个文件', '未命中词条插值也应工作');
    await setLanguage('zh-CN');
  });

  test('非法语言 id 安全忽略（保持当前语言）', async () => {
    await setLanguage('en');
    await setLanguage('xx-NOPE');
    assert.equal(getLanguage(), 'en', '非法 id 不应改变当前语言');
    await setLanguage('zh-CN');
  });

  test('语言切换触发监听', async () => {
    let fired = null;
    const off = i18n.onLanguageChange((l) => { fired = l; });
    await setLanguage('ja');
    assert.equal(fired, 'ja');
    off();
    await setLanguage('zh-CN');
  });

  test('任意语言可切回中文（zh-CN 无字典亦合法）', async () => {
    for (const lang of ['en', 'ar', 'fr', 'ru', 'es', 'ja', 'ko']) {
      await setLanguage(lang);
      assert.equal(getLanguage(), lang);
      await setLanguage('zh-CN');
      assert.equal(getLanguage(), 'zh-CN', `从 ${lang} 应能切回中文`);
      assert.equal(t('新建文档'), '新建文档');
    }
  });
});
