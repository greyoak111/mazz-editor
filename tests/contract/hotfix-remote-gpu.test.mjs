// tests/contract/hotfix-remote-gpu.test.mjs —— Windows 远程/虚拟显卡无人值守防崩钉
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const src = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');

describe('远程图形安全模式', () => {
  test('错误框永久静默，崩溃不再等待人工点确定', () => {
    assert(src.includes("appendSwitch('noerrdialogs')"), '缺 noerrdialogs');
    assert(src.includes("appendSwitch('disable-breakpad')"), '缺 disable-breakpad');
    assert(src.includes("appendSwitch('disable-crash-reporter')"), '缺 disable-crash-reporter');
  });

  test('远程会话/虚拟显示驱动自动进安全模式且可显式改回硬件模式', () => {
    assert(src.includes("MAZZ_GPU_MODE === 'hardware'"), '缺硬件模式逃生口');
    assert(src.includes("/^(rdp|ica|pcoip)/i"), '缺远程会话探测');
    assert(src.includes('spacedesk|mirror driver|virtual display'), '缺虚拟显卡探测');
    for (const sw of ['disable-gpu', 'disable-gpu-compositing', 'disable-software-rasterizer', 'disable-direct-composition']) {
      assert(src.includes(`appendSwitch('${sw}')`), `缺 ${sw}`);
    }
  });

  test('安全模式不反向开启硬件视频解码', () => {
    assert(src.includes("if (!GRAPHICS_MODE.safe) app.commandLine.appendSwitch('enable-features'"), '硬解开关未受安全模式约束');
  });
});
