// W59c 代码格式补齐：全族新建卡、四档语言菜单、模板骨件与路由单源
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {
  LANGUAGE_CATALOG, LANGUAGE_BY_EXT, CODE_NEW_FILE_TYPES, CODE_FILE_DEFAULTS,
} from '../../renderer/modules/code/language-catalog.js';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('W59c RUNNERS 全族目录', () => {
  test('四档数量严格为 A29 / B8 / C1 / D7', () => {
    const count = (tier) => LANGUAGE_CATALOG.filter(x => x.tier === tier).length;
    assert.deepEqual({ run: count('run'), compile: count('compile'), preview: count('preview'), none: count('none') },
      { run: 29, compile: 8, preview: 1, none: 7 });
    assert.equal(new Set(LANGUAGE_CATALOG.map(x => x.id)).size, 45, '语言 id 不得重复');
    assert.equal(new Set(CODE_NEW_FILE_TYPES.map(x => x.ext)).size, 45, '主扩展名不得重复');
  });

  test('底层 RUNNERS 与目录逐项对齐，编译档已补 Fortran/Pascal/Objective-C', () => {
    const src = read('renderer/modules/code/index.js');
    for (const row of LANGUAGE_CATALOG) assert.ok(src.includes(`${JSON.stringify(row.id).replaceAll('"', "'")}:`) || src.includes(`${row.id}:`), 'RUNNERS 缺语言: ' + row.id);
    for (const id of ['fortran', 'pascal', 'objective-c']) assert.ok(src.includes(id), '编译档缺 ' + id);
    assert.ok(src.includes('LANGUAGE_TIERS.flatMap'), '语言菜单必须按四档生成');
    assert.ok(src.includes('code.lang.header.${tier.id}'), '四档标题行必须进入选择菜单');
    assert.ok(src.includes("type: 'heading'"), '四档标题必须是不可误点的语义标题');
  });
});

describe('W59c 新建文件骨件与路由', () => {
  test('代表语言骨件含 shebang/main/class，创建即有可编辑起点', () => {
    const sample = (ext) => CODE_FILE_DEFAULTS[ext]();
    assert.match(sample('py'), /^#!\/usr\/bin\/env python3/m);
    assert.match(sample('sh'), /^#!\/usr\/bin\/env sh/m);
    assert.match(sample('go'), /func main\(\)/);
    assert.match(sample('rs'), /fn main\(\)/);
    assert.match(sample('rb'), /def main/);
    assert.match(sample('java'), /public class Main/);
    assert.match(sample('cs'), /class Program/);
    assert.match(sample('f90'), /program main/i);
  });

  test('shell 与 code 共用目录映射，新建子窗显示四档吸顶组', () => {
    const shell = read('renderer/shell/shell.js');
    assert.ok(shell.includes('CODE_NEW_FILE_TYPES') && shell.includes('CODE_FILE_DEFAULTS'), '新建文件必须消费目录单源');
    assert.ok(shell.includes('ALL_CODE_EXTENSIONS') && shell.includes('LANGUAGE_BY_EXT'), '打开/识别必须消费同一扩展名表');
    for (const ext of ['rs', 'go', 'rb', 'f90', 'pas', 'm']) assert.ok(LANGUAGE_BY_EXT[ext], '扩展名缺路由: ' + ext);
    const panel = read('renderer/panels/newfile.html');
    assert.ok(panel.includes("g.startsWith('代码 ·')"), '代码档位必须在子窗形成分组卡');
    assert.ok(panel.includes('code-tier'), '长目录档标题必须吸顶可辨');
  });

  test('W59c 真界面实证脚本与双截图在位', () => {
    assert.ok(fs.existsSync(path.resolve('tests/e2e/run73.mjs')), 'run73 必须在');
    const scenes = read('tests/e2e/scenes73.mjs');
    assert.ok(scenes.includes('w59c-newfile-catalog.png'), '新建全族截图必须在实证链');
    assert.ok(scenes.includes('w59c-language-tiers.png'), '四档语言菜单截图必须在实证链');
  });
});
