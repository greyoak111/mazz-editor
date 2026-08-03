// tests/contract/slide-w40.test.mjs —— 波次四十「演示手机遥控」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('主进程伺服（slide-remote.js）', () => {
  test('单端口单页面+WS 指令道', () => {
    const src = readSrc('main/slide-remote.js');
    assert.ok(src.includes('http.createServer'), 'HTTP 伺服必须有');
    assert.ok(src.includes('REMOTE_HTML'), '遥控页必须内联伺服（单文件无依赖）');
    assert.ok(src.includes("'upgrade'") && src.includes('Sec-WebSocket-Accept'), 'WS 升级握手必须有');
    assert.ok(src.includes('wsEncodeText') && src.includes('wsDecode'), 'RFC6455 编解码必须有');
    assert.ok(src.includes('server.listen(0'), '端口必须自动分配（免冲突）');
    assert.ok(src.includes('lanIp()'), '局域网地址必须有');
  });
  test('指令白名单与心跳即在线', () => {
    const src = readSrc('main/slide-remote.js');
    assert.ok(src.includes("CMDS = new Set(['next', 'prev', 'black'])"), '指令白名单三枚必须有');
    assert.ok(src.includes("slideRemote:cmd"), '指令必须转渲主窗');
    assert.ok(src.includes('lastSeen') && src.includes('15000'), '心跳 15s 僵死即清必须有');
    assert.ok(src.includes("j?.type === 'hb'"), '应用层心跳记活必须有');
    assert.ok(src.includes('lastState'), '晚连手机补发最新态必须有');
  });
  test('扫码即连', () => {
    const src = readSrc('main/slide-remote.js');
    assert.ok(src.includes("require('qrcode')") && src.includes('toDataURL'), 'QR 码生成必须有');
    const pkg = JSON.parse(readSrc('package.json'));
    assert.ok(pkg.dependencies?.qrcode || pkg.devDependencies?.qrcode, 'qrcode 必须入 dependencies');
  });
});

describe('IPC 装配', () => {
  test('白名单四 invoke+两 event', () => {
    const src = readSrc('preload/bridge.js');
    for (const c of ['slideRemote:start', 'slideRemote:stop', 'slideRemote:state', 'slideRemote:status']) assert.ok(src.includes(`'${c}'`), `缺 invoke ${c}`);
    for (const c of ['slideRemote:cmd', 'slideRemote:client']) assert.ok(src.includes(`'${c}'`), `缺 event ${c}`);
  });
  test('main.js 装配', () => {
    const src = readSrc('main/main.js');
    assert.ok(src.includes("require('./slide-remote')"), 'SlideRemote 必须装配');
    assert.ok(src.includes('win: () => wm.main'), '主窗引用必须有（指令转渲唯一通路）');
  });
});

describe('渲染侧集成', () => {
  test('Presenter2 黑屏与状态推送', () => {
    const src = readSrc('renderer/modules/slide/present2.js');
    assert.ok(src.includes('black()'), '黑屏开关必须有');
    assert.ok(src.includes("e.key === 'b' || e.key === 'B'"), 'B 键黑屏必须有');
    assert.ok(src.includes('pushState()'), '状态推送必须有');
    assert.ok((src.match(/this\.pushState\(\);/g) || []).length >= 4, 'go/step/black/close 四处必须全挂推送');
    assert.ok(src.includes('presenting: this.ctl.slStatus'), '收映态必须含 presenting');
    assert.ok(src.includes('clockSec'), '计时秒必须入推送（手机本地走字）');
  });
  test('遥控面板与指令消费', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(src.includes('showRemotePanel'), '遥控面板必须有');
    assert.ok(src.includes("slide.remote"), 'slide.remote 命令必须有');
    assert.ok(src.includes("slideRemote:cmd"), '指令事件必须消费');
    assert.ok(src.includes('pr.step(1)') && src.includes('pr.step(-1)') && src.includes('pr.black()'), '三指令必须落 Presenter2 同口');
    assert.ok(src.includes('请先放映'), '未放映必须明白话待命（节流）');
    assert.ok(src.includes('data-command="slide.remote"'), 'ribbon 遥控钮必须有');
  });
});
