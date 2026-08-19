// Strict increment II contract: secure production assets, expert capability, evidence-driven desktop, externalized truth.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = (name) => fs.readFileSync(path.resolve(name), 'utf8');
const index = read('docs/plans/README.md');
const w69 = read('docs/plans/W69_MAZZHUB_LOCAL_FIRST_CONTENT_NETWORK.md');
const w82 = read('docs/plans/W82_ORGANIZATIONAL_COMPILER.md');
const w84 = read('docs/plans/W84_MAZ_PRODUCTION_ASSET_STANDARD.md');
const w85 = read('docs/plans/W85_CONTEXT_COMPILER_AND_COVERAGE.md');
const w71 = read('docs/engineering/W71_FINAL_CONVERGENCE_EXECUTION_SPEC.md');

const SOURCE_HASH = '98EDCEBFE850836AD9ED96AC3D99F9C43BAD72BC6E5EFE22D547871CDCE450C0';

describe('Post-W71 strict architecture increment II', () => {
  test('the increment is source-bound and absorbed without inventing W87', () => {
    for (const doc of [w69, w82, w84, w85]) assert.ok(doc.includes(SOURCE_HASH));
    assert.ok(!index.includes('W87'));
    assert.ok(index.includes('v1.5 Design Capsule'));
    assert.ok(index.includes('W82a Foundation + W82b Software + W82c Research Slices LANDED；W82d–W82h 未施工'));
    assert.ok(index.includes('v0.2 Design Capsule'));
  });

  test('W84 separates integrity, signature, encryption, entitlement and runtime permission', () => {
    for (const term of ['Integrity', 'Signature', 'Encryption', 'Entitlement']) {
      assert.ok(w84.includes(term), `missing rights primitive: ${term}`);
    }
    assert.ok(w84.includes('License != Entitlement != Encryption'));
    assert.ok(w84.includes('Decrypt Right != Runtime Permission'));
    assert.ok(w84.includes('Public Envelope + Encrypted Payload'));
    assert.ok(w84.includes('Key Envelope'));
  });

  test('W84 makes sealed expert capability inspectable and keeps raw production history private', () => {
    assert.ok(w84.includes('Expert Capability Asset / Sealed Capability'));
    assert.ok(w84.includes('不可审计部分必须显式标识'));
    assert.ok(w84.includes('原始 W73 Production Ledger 不进包'));
    assert.ok(w84.includes('Hard Validation Sample J'));
    assert.ok(index.includes('W84a–W84f 未施工'));
  });

  test('W69 decouples ciphertext distribution from usage rights', () => {
    assert.ok(w69.includes('Distribution 与 Usage Rights 分离'));
    assert.ok(w69.includes('Content Distribution'));
    assert.ok(w69.includes('Cryptographic Access'));
    assert.ok(w69.includes('Runtime Permission'));
    assert.ok(w69.includes('W84a–f'));
  });

  test('W82 composes expert capabilities without standardizing style or swallowing human authority', () => {
    assert.ok(w82.includes('Expert Capability Composition'));
    assert.ok(w82.includes('标准化对象是能力的表达、调用、验证和组合方式'));
    assert.ok(w82.includes('Human Authority / Exception Executor'));
    assert.ok(w82.includes('Finding → Authority → Rule/Gate/Version'));
  });

  test('W85 prevents temporal version and authority misbinding with explicit supersession', () => {
    assert.ok(w85.includes('Temporal / Version / Authority Misbinding'));
    for (const state of ['CURRENT', 'SUPERSEDED', 'HISTORICAL', 'PROPOSED', 'REJECTED', 'INFERRED']) {
      assert.ok(w85.includes(state), `missing supersession state: ${state}`);
    }
    assert.ok(w85.includes('Externalized Organizational Truth'));
    assert.ok(w85.includes('模型负责理解、推理、创造、提议和解释'));
  });

  test('W71 treats platform capability and verification throughput as evidence-backed gates', () => {
    assert.ok(w71.includes('“80 分战略”不是 Electron 平台验收上限'));
    assert.ok(w71.includes('Vertical feature depth'));
    assert.ok(w71.includes('Desktop platform correctness'));
    assert.ok(w71.includes('Global Overlay Plane / Multi-Surface Z-order'));
    assert.ok(w71.includes('DOM z-index != Electron Native/WebContents Surface z-order'));
    assert.ok(w71.includes('Verification Throughput'));
    assert.ok(w71.includes('Source → Test → Packaged Runtime → Real Interaction Path → Screenshot/Visual Evidence → Acceptance'));
  });
});
