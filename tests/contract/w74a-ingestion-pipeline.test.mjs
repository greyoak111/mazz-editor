import './_setup.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assert } from '../harness.mjs';

const require = createRequire(import.meta.url);
const {
  INGESTION_CATALOG_SCHEMA,
  INGESTION_CONFLICT_SCHEMA,
  INGESTION_MANIFEST_SCHEMA,
  INGESTION_REQUEST_SCHEMA,
  IngestionPipeline,
  chunkMaterialText,
  materialPaths,
  normalizeIngestionRequest,
  registerMaterialSync,
} = require('../../main/ingestion-pipeline.js');
const { isAssetEnvelope } = require('../../main/foundation/asset-envelope.js');
const { FactoryPanel } = await import('../../renderer/modules/factory/index.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function request(projectPath, overrides = {}) {
  return {
    schema: INGESTION_REQUEST_SCHEMA,
    assetId: 'asset:material:stable-a',
    projectId: 'project:w74a',
    projectPath,
    title: '设定集.md',
    mediaType: 'text/plain; charset=utf-8',
    layer: 'source-fact',
    text: '# 设定集\n\n第一条事实。\n第二条事实。',
    sourceRef: { kind: 'local-file', path: 'D:/sources/设定集.md', title: '设定集.md' },
    provenance: { kind: 'user-approved-import', source: 'factory.embed', protocol: 'W74a' },
    importedAt: '2026-08-17T10:00:00.000Z',
    ...overrides,
  };
}

function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w74a-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

describe('W74a Ingestion Request 与确定性切片', () => {
  test('schema/层级/secret/未知字段严格；missing 不伪装已有正文', () => withProject(root => {
    const normalized = normalizeIngestionRequest(request(root));
    assert.equal(normalized.schema, INGESTION_REQUEST_SCHEMA);
    assert.equal(normalized.layer, 'source-fact');
    assert.match(normalized.version, /^sha256-[a-f0-9]{16}$/);
    assert.throws(() => normalizeIngestionRequest(request(root, { layer: 'truth-ish' })), /非法材料层级/);
    assert.throws(() => normalizeIngestionRequest(request(root, { rogue: true })), /未冻结字段/);
    assert.throws(() => normalizeIngestionRequest(request(root, { provenance: { apiKey: 'leak' } })), /禁止 secret/);
    assert.throws(() => normalizeIngestionRequest(request(root, { layer: 'missing' })), /不得伪装/);
    assert.equal(normalizeIngestionRequest(request(root, { layer: 'missing', text: '' })).text, '');
  }));

  test('切片按 offset 可无损拼回正文，不把 Chunk 冒充资产结构', () => {
    const text = `${'甲'.repeat(1300)}\n\n${'乙'.repeat(1700)}\n尾声`;
    const chunks = chunkMaterialText(text, 'a'.repeat(64));
    assert.ok(chunks.length >= 2);
    assert.equal(chunks.map(row => row.text).join(''), text);
    assert.equal(chunks[0].startOffset, 0);
    assert.equal(chunks.at(-1).endOffset, text.length);
    assert.ok(chunks.every((row, index) => row.index === index && row.schema === 'mazz.ingestion-chunk/v0'));
  });
});

describe('W74a 项目材料区、目录与冲突', () => {
  test('真实磁盘登记生成 content/chunks/manifest/W72 Envelope/catalog，包络和目录不含正文', () => withProject(root => {
    const result = registerMaterialSync(request(root));
    assert.equal(result.ok, true);
    assert.equal(result.code, 'REGISTERED');
    assert.equal(result.manifest.schema, INGESTION_MANIFEST_SCHEMA);
    assert.equal(result.catalog.schema, INGESTION_CATALOG_SCHEMA);
    assert.equal(result.catalog.entryCount, 1);
    assert.equal(fs.readFileSync(result.paths.content, 'utf8'), request(root).text);
    const envelope = JSON.parse(fs.readFileSync(result.paths.envelope, 'utf8'));
    assert.equal(isAssetEnvelope(envelope), true);
    assert.equal(envelope.id, request(root).assetId);
    assert.equal('text' in envelope, false);
    const catalogText = fs.readFileSync(result.paths.catalog, 'utf8');
    assert.doesNotMatch(catalogText, /第一条事实/);
    const chunks = fs.readFileSync(result.paths.chunks, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(chunks.map(row => row.text).join(''), request(root).text);
  }));

  test('同一登记幂等并可由 manifests 重建损坏目录；孤儿 staging 会收口', () => withProject(root => {
    const first = registerMaterialSync(request(root));
    fs.writeFileSync(first.paths.catalog, '{broken', 'utf8');
    const paths = materialPaths(root, request(root).assetId);
    fs.mkdirSync(path.join(paths.root, '.staging-orphan'), { recursive: true });
    fs.writeFileSync(path.join(paths.root, '.staging-orphan', 'partial.txt'), 'partial');
    const second = registerMaterialSync(request(root, { importedAt: '2026-08-17T11:00:00.000Z' }));
    assert.equal(second.code, 'ALREADY_REGISTERED');
    assert.equal(second.recoveredStaging, 1);
    assert.equal(second.catalog.entryCount, 1);
    assert.equal(fs.existsSync(path.join(paths.root, '.staging-orphan')), false);
  }));

  test('同 ID 异内容只写冲突证据，不覆盖当前正文或目录 current', () => withProject(root => {
    const first = registerMaterialSync(request(root));
    const conflict = registerMaterialSync(request(root, { text: '# 被篡改的候选', importedAt: '2026-08-17T12:00:00.000Z' }));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'INGESTION_CONFLICT');
    assert.equal(conflict.conflict.schema, INGESTION_CONFLICT_SCHEMA);
    assert.equal(conflict.conflict.automaticOverwrite, false);
    assert.equal(fs.readFileSync(first.paths.content, 'utf8'), request(root).text);
    assert.equal(JSON.parse(fs.readFileSync(conflict.conflictPath, 'utf8')).decisionRequired, true);
    assert.equal(JSON.parse(fs.readFileSync(first.paths.catalog, 'utf8')).entries[0].contentHash, first.manifest.contentHash);
  }));

  test('同项目并发串行，最终无活动队列且目录只有一个身份', () => withProject(async root => {
    const pipeline = new IngestionPipeline();
    const [a, b, c] = await Promise.all([
      pipeline.register(request(root)),
      pipeline.register(request(root, { importedAt: '2026-08-17T10:00:01.000Z' })),
      pipeline.register(request(root, { importedAt: '2026-08-17T10:00:02.000Z' })),
    ]);
    assert.deepEqual([a.code, b.code, c.code], ['REGISTERED', 'ALREADY_REGISTERED', 'ALREADY_REGISTERED']);
    assert.equal(a.catalog.entryCount, 1);
    assert.equal(pipeline.healthSnapshot().activeProjects, 0);
  }));
});

describe('W74a 产品接线与边界', () => {
  test('真实 FactoryPanel 方法重读完整源文件、持久化 materialRefs，并保持二次调用幂等', async () => {
    const calls = [];
    window.mazz = {
      isElectron: true,
      invoke: async (channel, payload = {}) => {
        calls.push({ channel, payload });
        if (channel === 'fs:readFile') return '完整源文件正文，而不是界面中的截断摘要。';
        if (channel === 'ingestion:registerText') return {
          ok: true,
          code: 'REGISTERED',
          manifest: { version: 'sha256-1234567890abcdef' },
          paths: { envelope: 'D:/project/.mazz/materials/assets/a/asset-envelope.json', manifest: 'D:/project/.mazz/materials/assets/a/manifest.json', catalog: 'D:/project/.mazz/materials/catalog.json' },
        };
        throw new Error(`unexpected ${channel}`);
      },
    };
    const panel = Object.create(FactoryPanel.prototype);
    panel.persistCount = 0;
    panel.persistTasks = () => { panel.persistCount += 1; };
    const target = {
      id: 'task-w74a', folder: 'D:/project', embeds: [{
        assetId: 'asset:factory-material:stable', name: '资料.md', text: '摘要', sourcePath: 'D:/source/资料.md',
        sourceKind: 'local-file', provenanceSource: 'factory.embed', layer: 'source-fact', importedAt: '2026-08-17T10:00:00.000Z',
      }],
    };
    const first = await panel.ensureW74aMaterials(target);
    const second = await panel.ensureW74aMaterials(target);
    const registerCalls = calls.filter(row => row.channel === 'ingestion:registerText');
    assert.equal(registerCalls.length, 1);
    assert.equal(registerCalls[0].payload.text, '完整源文件正文，而不是界面中的截断摘要。');
    assert.equal(registerCalls[0].payload.layer, 'source-fact');
    assert.equal(first[0].role, 'input-material');
    assert.deepEqual(second, first);
    assert.equal(target.materialRefs[0].id, 'asset:factory-material:stable');
    assert.equal(target.materialCatalogPath, 'D:/project/.mazz/materials/catalog.json');
    assert.equal(panel.persistCount, 2);
  });

  test('沿用 Factory 嵌入资料入口，开 Run 前登记并把 Envelope 作为输入引用', () => {
    const factory = fs.readFileSync(path.join(repoRoot, 'renderer/modules/factory/index.js'), 'utf8');
    const main = fs.readFileSync(path.join(repoRoot, 'main/main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(repoRoot, 'preload/bridge.js'), 'utf8');
    assert.match(factory, /async ensureW74aMaterials\(task\)/);
    assert.match(factory, /await this\.ensureW74aMaterials\(task\);\s*\n\s*await this\.ensureProductionRun/);
    assert.match(factory, /inputArtifactRefs: Array\.isArray\(task\.materialRefs\)/);
    assert.match(factory, /kind: 'asset-envelope'.*role: 'input-material'/s);
    assert.match(main, /ingestion:registerText/);
    assert.match(preload, /ingestion:registerText/);
    assert.doesNotMatch(factory, /autoPromotion|publishMaterial|UniversalAsset|GraphBus/);
  });
});
