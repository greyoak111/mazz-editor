// tests/contract/hotfix-remote-gpu.test.mjs —— Windows 远程/虚拟显卡无人值守防崩钉
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const src = fs.readFileSync(new URL('../../main/main.js', import.meta.url), 'utf8');

describe('远程图形安全与视频兼容模式', () => {
  test('错误框永久静默，崩溃不再等待人工点确定', () => {
    assert(src.includes("appendSwitch('noerrdialogs')"), '缺 noerrdialogs');
    assert(src.includes("appendSwitch('disable-breakpad')"), '缺 disable-breakpad');
    assert(src.includes("appendSwitch('disable-crash-reporter')"), '缺 disable-crash-reporter');
  });

  test('真正 RDP/显式 safe 仍进无 GPU 安全模式且可显式改回硬件模式', () => {
    assert(src.includes("MAZZ_GPU_MODE === 'hardware'"), '缺硬件模式逃生口');
    assert(src.includes("/^(rdp|ica|pcoip)/i"), '缺远程会话探测');
    for (const sw of ['disable-gpu', 'disable-gpu-compositing', 'disable-software-rasterizer', 'disable-direct-composition']) {
      assert(src.includes(`appendSwitch('${sw}')`), `缺 ${sw}`);
    }
  });

  test('虚拟显示驱动进兼容合成而非全 GPU safe，保留平台 HEVC 解码', () => {
    assert(src.includes('spacedesk|mirror driver|virtual display'), '缺虚拟显卡探测');
    assert(src.includes("mode: 'compatibility'"), '虚拟显示未分出 compatibility 模式');
    assert(src.includes("appendSwitch('disable-direct-composition-video-overlays')"), '缺 DirectComposition 视频叠加层禁用');
    assert(src.includes("timeout: 5000"), 'WMIC 仍可能因过短超时随机切换图形模式');
  });

  test('只有全 GPU safe 不开启硬件视频解码，compatibility 继续启用', () => {
    assert(src.includes("if (!GRAPHICS_MODE.safe) app.commandLine.appendSwitch('enable-features'"), '硬解开关未受安全模式约束');
    assert(src.includes("bus.handle('app:graphicsMode'"), '图形模式缺只读诊断回执');
  });
});
