import fs from 'node:fs';
import { describe, test, assert } from '../harness.mjs';

const intake = fs.readFileSync('docs/plans/MAZZ_THREE_ENGINEERING_DOCTRINE_INTAKE_2026-08-18.md', 'utf8');
const w66 = fs.readFileSync('docs/plans/W66_REAL_AGENT_ADAPTER_ACTIVATION.md', 'utf8');
const w82 = fs.readFileSync('docs/plans/W82_ORGANIZATIONAL_COMPILER.md', 'utf8');

describe('三工程与 Doctrine 修正入库', () => {
  test('三份来源有完整路径与哈希，且设计不冒充实现', () => {
    for (const hash of [
      '0908423812CCC4DA07BDE35E4980569FA19C2869FB04EB2CA7EBFD24D3B89E80',
      '42436619BA340FC0F184610D2DAE7C64F1600BF4543D99DBAE2CEA4BAD1ABF4C',
      'EEB706F8845EC9E13223E8C28BEDE1EE4CE3D35B95F8DA73BD35E64B00934770'
    ]) assert.ok(intake.includes(hash));
    assert.match(intake, /RUNTIME NOT IMPLEMENTED/);
    assert.match(intake, /W66-R0a/);
    assert.match(intake, /W66-R0e/);
  });

  test('W66 保留完整原文并叠加 Compiled View', () => {
    assert.match(w66, /完整 Raw Source \+ Compiled View/);
    for (const layer of ['L0 Universal', 'L1 Host', 'L2 Domain', 'L3 Project', 'L4 Current', 'L5 Gate']) assert.ok(w66.includes(layer));
    for (const contract of ['Typed Handle', 'Result Envelope', 'Failure Signature', 'Patch CAS', 'Output Completeness']) assert.ok(w66.includes(contract));
    assert.match(w66, /outer success \+ inner exit nonzero/);
  });

  test('W82 分开 Seat、Executor、Harness、Child Seat 与委托权力', () => {
    for (const invariant of [
      'Seat != Executor', 'Agent != Harness', 'Executor != Harness', 'Harness != Tool',
      'Sub-Agent != Child Seat', 'Delegation != Authority Transfer', 'Qualification != Delegable Credential'
    ]) assert.ok(w82.includes(invariant), `${invariant} 必须冻结`);
    assert.match(w82, /Parent Seat 默认保留责任/);
    assert.match(w82, /W73a–h 当前完成态不含这项未来扩展/);
  });

  test('三工程保持正交并以真实对照样本验证', () => {
    for (const discipline of ['人的思维工程', '机器的智能工程', '组织工程']) assert.ok(w82.includes(discipline));
    assert.match(w82, /Raw Agent \/ Governed Agent/);
    assert.match(intake, /Self-correction != Institutional Learning/);
  });
});
