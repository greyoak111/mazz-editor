// tests/contract/icon-config.test.mjs —— 图标配置契约（防 Electron 默认图标）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';

describe('图标配置（防 Electron 默认图标）', () => {
  test('main.js 注册 AppUserModelId；build.win 用 .ico；NSIS 安装包图标配齐', () => {
    const main = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');
    assert.ok(main.includes("setAppUserModelId('com.mazz.editor')"), '缺 AppUserModelId——任务栏/开始菜单会显示 Electron 默认图标');
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.ok(pkg.build.win.icon.endsWith('.ico'), 'Windows 图标应为 .ico');
    assert.ok(pkg.build.nsis.installerIcon?.endsWith('.ico'), 'NSIS 安装器图标');
    assert.ok(pkg.build.nsis.uninstallerIcon?.endsWith('.ico'), 'NSIS 卸载器图标');
    assert.ok(pkg.build.appId === 'com.mazz.editor');
  });

  test('app.ico 文件存在且为合法 ICO 格式', () => {
    const buf = fs.readFileSync(new URL('../../resources/icons/app.ico', import.meta.url));
    assert.equal(buf.readUInt16LE(2), 1, 'ICO 魔数(type=1)');
    assert.ok(buf.readUInt16LE(4) >= 4, '应含多尺寸');
  });
});
