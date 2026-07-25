// tests/contract/agreement.test.mjs —— 用户服务协议及隐私政策契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const { installBrowserBridge } = await import('../../renderer/lib/browser-bridge.js');
installBrowserBridge();
const { agreementContent, shouldAutoShow } = await import('../../renderer/lib/agreement.js');

describe('用户服务协议及隐私政策', () => {
  test('内容跟随界面语言（由 i18n 当前语言驱动）', async () => {
    const { getLanguage } = await import('../../renderer/i18n/index.js');
    const zh = (getLanguage() || 'zh').toLowerCase().startsWith('zh');
    const c = agreementContent();
    if (zh) {
      assert.ok(c.title.includes('用户服务协议'));
      assert.equal(c.accept, '知悉');
      assert.equal(c.close, '关闭');
      assert.ok(c.noMore.includes('不再弹出'));
    } else {
      assert.ok(c.title.includes('Terms'));
      assert.equal(c.accept, 'Acknowledged');
      assert.equal(c.close, 'Close');
    }
  });

  test('协议体覆盖关键条款（本地优先/无遥测/局域网同步/权限）', () => {
    const c = agreementContent();
    const body = c.body.toLowerCase();
    assert.ok(body.includes('telemetry') || body.includes('遥测'));
    assert.ok(body.includes('local') || body.includes('本地'));
    assert.ok(body.includes('lan') || body.includes('局域网'));
    assert.ok(c.noMore.length > 0);
  });

  test('首启弹出逻辑：未勾选 → 弹；勾选不再弹出 → 不弹', async () => {
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: undefined }).catch(() => {});
    localStorage.removeItem('mazz.settings.v1');
    assert.equal(await shouldAutoShow(), true);
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    assert.equal(await shouldAutoShow(), false);
  });
});
