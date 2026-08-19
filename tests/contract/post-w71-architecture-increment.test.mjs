// Post-W71 architecture increment contract: preserve W83-W86 boundaries without implying implementation.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = (name) => fs.readFileSync(path.resolve(name), 'utf8');
const index = read('docs/plans/README.md');
const w82 = read('docs/plans/W82_ORGANIZATIONAL_COMPILER.md');
const w83 = read('docs/plans/W83_DANMAKU_RUNTIME.md');
const w84 = read('docs/plans/W84_MAZ_PRODUCTION_ASSET_STANDARD.md');
const w85 = read('docs/plans/W85_CONTEXT_COMPILER_AND_COVERAGE.md');
const w86 = read('docs/plans/W86_CAPABILITY_PRODUCTION_RUNTIME.md');
const w71 = read('docs/engineering/W71_FINAL_CONVERGENCE_EXECUTION_SPEC.md');

const SOURCE_HASH = '79A1588A2971E134B6CEB1CFD02AC4D27AB4981968A0E46285DEA0EE3D039408';

describe('Post-W71 architecture increment intake', () => {
  test('new capsules are indexed, source-bound and explicitly not implementation', () => {
    for (const [wave, doc] of [['W83', w83], ['W84', w84], ['W85', w85], ['W86', w86]]) {
      assert.ok(index.includes(wave), `missing plan index: ${wave}`);
      assert.ok(doc.includes(SOURCE_HASH), `missing source hash: ${wave}`);
      assert.ok(doc.includes('NOT APPROVED FOR IMPLEMENTATION'), `missing stop status: ${wave}`);
    }
    assert.ok(index.includes('W83a–W83e 未施工'));
    assert.ok(index.includes('W84a–W84f 未施工'));
    assert.ok(index.includes('W85a–W85e 未施工'));
    assert.ok(index.includes('W86a–W86e 未施工'));
  });

  test('W82 requires evidence-backed transitions and separates seats from machines', () => {
    assert.ok(w82.includes('版本：v0.7'));
    assert.ok(w82.includes('W82a FOUNDATION + W82b SOFTWARE RELEASE SLICE LANDED / W82c–W82h NOT STARTED'));
    for (const layer of ['Verification', 'Review', 'Evaluation', 'Authority']) {
      assert.ok(w82.includes(layer), `missing transition layer: ${layer}`);
    }
    assert.ok(w82.includes('Seat != Machine'));
    assert.ok(w82.includes('完成不是 Executor 的一句声明'));
    assert.ok(w82.includes('W86 Physical Production'));
  });

  test('W83 is a media-clock runtime, not a player or public event database', () => {
    for (const primitive of ['Media Clock', 'Timeline Index', 'Scheduler', 'Lane Allocator', 'Collision / Density / Filter']) {
      assert.ok(w83.includes(primitive), `missing danmaku primitive: ${primitive}`);
    }
    assert.ok(w83.includes('wall clock 代替 media clock'));
    assert.ok(w83.includes('W69 负责公共 Danmaku Event'));
    assert.ok(w83.includes('Hard Validation Sample F'));
  });

  test('W84 acknowledges both legacy maz formats and keeps definitions out of runtime state', () => {
    assert.ok(w84.includes('zip { plugin.json, main.js, ... }'));
    assert.ok(w84.includes('zip { definition.json, prompt.txt, meta.json'));
    assert.ok(w84.includes('Definition != Runtime Instance'));
    assert.ok(w84.includes('导入 = 安装 = 启用 = 执行'));
    assert.ok(w84.includes('Hard Validation Sample G'));
    assert.ok(w84.includes('不得宣布 `.maz v1`'));
  });

  test('W85 keeps context, plan, memory, state and coverage distinct', () => {
    assert.ok(w85.includes('Context != Plan'));
    assert.ok(w85.includes('Memory != State'));
    assert.ok(w85.includes('Reasoning != Coverage'));
    assert.ok(w85.includes('Wave Graph = Prospective Memory'));
    assert.ok(w85.includes('EVIDENCED'));
    assert.ok(w85.includes('Hard Validation Sample H'));
    assert.ok(w85.includes('Universal Memory Daemon'));
  });

  test('W86 is simulation-first and the independent safety kernel has final refusal authority', () => {
    for (const layer of ['L5 Organizational Compiler', 'L4 Production Runtime', 'L3 Capability / Adapter Plane', 'L2 Deterministic Control', 'L1 Physical Process']) {
      assert.ok(w86.includes(layer), `missing production layer: ${layer}`);
    }
    assert.ok(w86.includes('Factory has no override authority'));
    assert.ok(w86.includes('Simulation only'));
    assert.ok(w86.includes('Hard Validation Sample I'));
    assert.ok(w86.includes('直接写 PLC/CNC/Robot/DCS'));
  });

  test('W71 freezes every new scope and does not confuse existing specimens with implementation', () => {
    assert.ok(w71.includes('不批准 W63–W86'));
    assert.ok(w71.includes('W72–W86 的硬边界'));
    assert.ok(w71.includes('Danmaku Runtime'));
    assert.ok(w71.includes('统一 `.maz` loader/migration'));
    assert.ok(w71.includes('工业协议/SDK/设备连接'));
    assert.ok(w71.includes('夹带 W63–W86 功能施工'));
  });
});
