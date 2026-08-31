// main/main.js —— Mazz Editor 主进程总装配
// 单实例 · mazz:// 协议 · 文件关联参数转发 · 白名单 IPC · 托盘 · 全局快捷键 · 崩溃恢复 · 打印双路径
'use strict';
const {
  app, Menu, dialog, clipboard, nativeTheme, Notification, protocol, net,
  shell, powerSaveBlocker, powerMonitor, session, safeStorage, BrowserWindow, desktopCapturer,
} = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream'); // mazz-res media/ 分支：range 流式响应（GB 级不整读）
const path = require('path');
const { execFileSync } = require('child_process');
const {
  CATALOG_IMAGE_MAX_BYTES,
  canonicalCatalogImageUrl,
  resolvedCatalogImageRedirect,
} = require('./catalog-image-policy');
const { audioArtworkPathFromResourceUrl, serveAudioArtwork } = require('./audio-artwork');

// 应用级服务各自拥有独立 before-quit 收尸钩；显式容量覆盖当前正式服务数，避免 Node 默认 10 个把合法治理误报为泄漏。
app.setMaxListeners(32);

// E2E 用户目录必须在单实例锁之前切换；Chromium 的锁文件按当时 userData 定位。
// 放在 requestSingleInstanceLock 之后会先碰正常用户目录，在受限 Windows 环境直接拒绝访问。
if (process.env.MAZZ_E2E_USER_DATA) app.setPath('userData', process.env.MAZZ_E2E_USER_DATA);

// Windows 无人值守：Chromium/子进程即使异常也只退进程、记日志，不弹系统级「确定/取消」阻塞框。
// --noerrdialogs 是 Chromium 官方开关；禁用 Breakpad/Crashpad 可避免崩溃处理器再拉起交互 UI。
app.commandLine.appendSwitch('noerrdialogs');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('enable-precise-memory-info');

function detectGraphicsMode() {
  if (process.env.MAZZ_GPU_MODE === 'hardware') return { mode: 'hardware', safe: false, reason: '用户强制硬件模式' };
  if (process.env.MAZZ_GPU_MODE === 'compatibility') return { mode: 'compatibility', safe: false, reason: '用户强制远程兼容模式' };
  if (process.env.MAZZ_GPU_MODE === 'safe' || process.env.MAZZ_E2E_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
    return { mode: 'safe', safe: true, reason: '显式安全图形模式' };
  }
  if (process.platform !== 'win32') return { mode: 'hardware', safe: false, reason: '' };
  if (/^(rdp|ica|pcoip)/i.test(process.env.SESSIONNAME || '')) return { mode: 'safe', safe: true, reason: `远程会话 ${process.env.SESSIONNAME}` };
  try {
    // spacedesk/虚拟显示镜像驱动需要禁用 DirectComposition 独立叠加层，不能把整个 GPU/平台视频解码器一起杀掉：
    // 否则 H.265 会出现时间轴正常推进、videoWidth/decoded frames 永远为 0 的假播放黑屏。
    // WMIC 冷启动在当前 Windows 10 真机约 2.8s；旧 1.5s 超时会让同一机器随机在 hardware/safe 间抖动。
    const adapters = execFileSync('wmic.exe', ['path', 'win32_videocontroller', 'get', 'name'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const hit = String(adapters).match(/spacedesk|mirror driver|virtual display|remote display|indirect display|parsec|dummy display/i);
    if (hit) return { mode: 'compatibility', safe: false, reason: `检测到虚拟显示驱动 ${hit[0]}` };
  } catch {}
  return { mode: 'hardware', safe: false, reason: '' };
}

const GRAPHICS_MODE = detectGraphicsMode();
if (GRAPHICS_MODE.safe) {
  // app.disableHardwareAcceleration 之外再钉三道命令行闸：不让 Chromium 用 SwiftShader 另起 GPU 子进程兜底。
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-direct-composition');
} else if (GRAPHICS_MODE.mode === 'compatibility') {
  // 保留 GPU 进程与 Platform HEVC decoder，只禁止远程捕获/虚拟显示最容易出错的 DirectComposition 独立平面。
  // 视频回到 Chromium 主合成面，spacedesk/录屏可见，且不再触发 video overlay 黑帧/异常窗。
  app.commandLine.appendSwitch('disable-direct-composition');
  app.commandLine.appendSwitch('disable-direct-composition-video-overlays');
}

// Windows 任务栏/开始菜单图标与分组归属（不设会回落成 Electron 默认图标）
app.setAppUserModelId('com.mazz.editor');

// 站点级进程隔离：webview 同站点多标签页会被 Chromium 合并进同一 site instance（同渲染进程），
// 关掉其中一个 webview 就把共享进程拖垮——另一个同站标签页「页面还在显示但点击/滚动全死」
// （B站/知乎跳新标签页再关闭返回的稳定僵死总根）。site-per-process 强制每站点独立进程，关一不拖一。
app.commandLine.appendSwitch('site-per-process');

// 全局内录反节流（录半小时产出 0KB 的总根）：录制别的窗口时本窗被最小化/遮挡，Chromium 会把
// 后台渲染页的 BeginFrame 与定时器掐掉——画布合成路径断帧 → MediaRecorder 全程零数据 → 0KB 文件。
// 业界录屏/自动化标准配置（Playwright/Puppeteer 默认即携带同款开关）：
app.commandLine.appendSwitch('disable-background-timer-throttling'); // 后台定时器不掐（合成抽帧 setInterval 全速）
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); // Windows 原生窗口遮挡检测不降级
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // 渲染进程不因后台降优先级
app.commandLine.appendSwitch('disable-background-media-suspend'); // 后台静音 <video> 不被省电暂停（合成路径视频源防断流）
// 平台硬解显式开（扒 NipaPlay 老版所得"硬解 HEVC"全部秘密：它裸 HTML5 video 零解码代码，
// 吃的就是 Chromium 平台解码器默认红利——H264/AAC 由 Electron 官方 Chrome-branding ffmpeg 软解（Linux 沙箱试播实证），
// HEVC 走 OS 平台解码器：Win 需系统 HEVC 组件（PlatformHEVCDecoderSupport M107+），mac 走 VideoToolbox，Linux 需 VAAPI——显式开幂等保险）
if (!GRAPHICS_MODE.safe) app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,VaapiVideoDecoder');

// mazz-res:// 资源协议：wasm worker 唯一活路——jassub 等 ES module worker 在 blob:/file:// 源下全被
// Chromium 掐死（module worker 源策略实锤），标准+安全+CORS 特权自定义协议是 Electron 里的正道
protocol.registerSchemesAsPrivileged([
  { scheme: 'mazz-res', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// W58 预览档根治：mazz-res handler 模块级引渡——隐私浏览器独立会话（persist:mazz-browser）默认不继承默认会话的
// protocol.handle，视图会话里 mazz-res=未知协议 → load 静默流产死守 about:blank（data: URL 对照组实证管道本身无恙）
let mazzResHandler = null;
let torrentDaemon = null;

const Store = require('./store');
const IpcBus = require('./ipc-bus');
const LibraryImportService = require('./library-import-service');
const LibraryAcquisitionService = require('./library-acquisition-service');
const LibraryTorrentBookTransport = require('./library-torrent-book-transport');
const LibraryBrowserAcquisitionBridge = require('./library-browser-acquisition-bridge');
const {
  createNodeResolver: createLibraryAcquisitionResolver,
  createNodeHttpsRequester: createLibraryAcquisitionRequester,
} = require('./library-http-acquisition');
const { createSingleInstanceOwnerCapability } = require('./library-acquisition-store');
const {
  registerLibraryAcquisitionIpc,
  initializeCurrentLibraryAcquisition,
} = require('./library-acquisition-ipc');
const { LibraryResourceSurfaceService } = require('./library-resource-surface-service');
const { registerLibraryResourceSurfaceIpc } = require('./library-resource-surface-ipc');
const { LibraryWorkspaceConvergenceService } = require('./library-workspace-convergence');
const { registerLibraryWorkspaceConvergenceIpc, workspaceToken: libraryWorkspaceToken } = require('./library-workspace-convergence-ipc');
const { CapabilityExecutionService } = require('./capability-execution-service');
const capabilityContract = require('./capability-execution-contract');
const { createCapabilityExecutionOwnerCapability } = require('./capability-execution-store');
const {
  registerCapabilityExecutionIpc,
  initializeCurrentCapabilityExecution,
} = require('./capability-execution-ipc');
const { createFixtureCapabilityAdapter } = require('./capabilities/fixture-capability-adapter');
const { createCalcPythonAdapter } = require('./capabilities/calc-python-adapter');
const { createChartSvgAdapter } = require('./capabilities/chart-svg-adapter');
const { createBlenderExternalCapabilityAdapter } = require('./capabilities/blender-external-adapter');
const { CanvasDocumentService } = require('./canvas-document-service');
const { registerCanvasDocumentIpc } = require('./canvas-document-ipc');
const WindowManager = require('./window-manager');
const TrayService = require('./tray-service');
const GlobalShortcuts = require('./global-shortcuts');
const CrashRecovery = require('./crash-recovery');
const { publishIdempotently } = require('./handoff-transaction');
const FileWatcher = require('./file-watcher');
const SearxService = require('./searx');
const TranslateService = require('./translate');
const LanSync = require('./lansync');

// —— 密码加解密（模块级：pw:list 句柄与 BrowserViews 自动填充注入共用——
// 曾在函数作用域内，注入 BrowserViews 的闭包跨域引用 ReferenceError 静默全灭（真机探针实锤）——
const __pwEncrypt = (text) => {
  const { safeStorage } = require('electron');
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, data: safeStorage.encryptString(String(text ?? '')).toString('base64') };
  }
  return { enc: false, data: Buffer.from(String(text ?? ''), 'utf8').toString('base64') };
};
const __pwDecrypt = (payload) => {
  const { safeStorage } = require('electron');
  try {
    if (payload?.enc) return safeStorage.decryptString(Buffer.from(payload.data, 'base64'));
    return Buffer.from(payload?.data || '', 'base64').toString('utf8');
  } catch { return ''; }
};
const PanelWindows = require('./panel-windows');
const BrowserViews = require('./browser-views'); // 模块级：theme:broadcast 等跨函数句柄要摸到静态注册表（作用域病实锤绝育）
const VisualCompositionRuntime = require('./visual-composition');
const ShareService = require('./share');
const Importer = require('./importer');
const StartMenuApps = require('./startmenu');
const Updater = require('./updater');
const BrowserSession = require('./browser-session');
const TerminalService = require('./terminal');
const { ResourceLedger } = require('./resource-ledger');
const { MemoryGovernor } = require('./memory-governor');
const { AUDCACHE_POLICY, pruneDerivedCache } = require('./derived-cache-budget');
const { AgentHarnessService } = require('./agent-harness');
const { CliSupervisor } = require('./agent-cli-supervisor');
const { AgentDoctrineRuntime } = require('./agent-doctrine-runtime');
const { ExternalToolService } = require('./external-tool-service');
const { createBlenderHeadlessAdapter } = require('./external-tools/blender-headless-adapter');
const { KimiCodeAdapter } = require('./adapters/kimi-code-adapter');
const { ClaudeCodeAdapter } = require('./adapters/claude-code-adapter');
const { CodexAdapter } = require('./adapters/codex-adapter');
const { FactoryAiRequestRegistry } = require('./factory-ai-requests');
const { FactoryRunOwnerRegistry } = require('./factory-run-owners');
const { IngestionPipeline } = require('./ingestion-pipeline');
const { FeedPipeline, normalizeW65FeedRequest } = require('./feed-pipeline');
const { ContinuousFeedService } = require('./continuous-feed-service');
const { PromotionLedger } = require('./promotion-ledger');
const {
  FactorySseDecoder,
  classifyFactoryCompletion,
  extractText: extractFactoryContentText,
  factoryProviderGenerationOptions,
  joinFactoryAiEndpoint,
  normalizeFactoryModelsResponse,
} = require('./factory-sse');
const { AddressableEvidenceService } = require('./addressable-evidence-service');
const { ContextRelationService } = require('./context-relation-service');
const { WorkspaceEventService } = require('./workspace-event-service');
const { RelationRetrievalService } = require('./relation-retrieval-service');
const { BranchEffectiveStateService } = require('./branch-effective-state-service');
const { WorldRuntimeService } = require('./world-runtime-service');
const { WorldHubPublicationService } = require('./world-hub-publication-service');
const { PublicationSigningService } = require('./publication-signing-service');
const { LocalPublicationBridgeService } = require('./local-publication-bridge-service');
const { ContextCompilerService } = require('./context-compiler-service');
const { CognitionService } = require('./cognition-service');
const { CivilizationModelService } = require('./civilization-model-service');
const { AccompanyService } = require('./accompany-service');
const { OrganizationalWorkspaceService } = require('./organizational-workspace-service');
const { MazAssetService } = require('./maz-asset-service');
const { PhysicalSimulationService } = require('./physical-simulation-service');

const PROTOCOL = 'mazz';

// ---------- 单实例：第二实例的命令行文件参数转发给主实例开新标签 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); return; }

const store = new Store(path.join(app.getPath('userData'), 'mazz-settings.json'), {
  recentFiles: [],
  workspace: process.env.MAZZ_E2E_WORKSPACE || path.join(app.getPath('documents'), 'MazzWorkspace'),
  closeBehavior: 'ask', // ask | quit | tray
  themeSource: 'system',
  spellcheckEnabled: true,
  spellcheckLanguages: ['en-US', 'zh-CN'],
  quickNoteTarget: 'daily', // daily | inbox
});

// One synchronous main-process turn is the serialization boundary shared by
// every BrowserWindow renderer. Values originate from the JSON store, so exact
// JSON equality is the appropriate compare token (Library envelopes also carry
// monotonic revisions). Multi-entry CAS is all-or-nothing and flushes once.
function settingsCasEqual(left, right) {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function settingsCasEntries(payload = {}) {
  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : [{ key: payload.key, expected: payload.expected, value: payload.value }];
  const seen = new Set();
  return entries.map(entry => {
    const key = String(entry?.key || '');
    if (!key || seen.has(key)) throw new TypeError('settings:compareAndSet requires unique non-empty keys');
    seen.add(key);
    return { key, expected: entry.expected, value: entry.value };
  });
}

const bus = new IpcBus();
let crashRecovery = null;
const libraryImportService = new LibraryImportService();
const resourceLedger = new ResourceLedger();
const capabilityExecutionOwner = createCapabilityExecutionOwnerCapability();
const capabilityExecutionService = new CapabilityExecutionService({
  resourceLedger,
  ownerCapability: capabilityExecutionOwner,
});
capabilityExecutionService.register(createCalcPythonAdapter({ resourceLedger }));
capabilityExecutionService.register(createChartSvgAdapter());
const canvasDocumentService = new CanvasDocumentService({ rootProvider: () => store.get('workspace'), resourceLedger });
let capabilityExecutionStartupReady = false;
let capabilityExecutionStartupError = null;
if (process.env.NODE_ENV === 'test' && process.env.MAZZ_E2E_CAPABILITY_FIXTURE === '1') {
  capabilityExecutionService.register(createFixtureCapabilityAdapter());
}
const libraryTorrentTransport = new LibraryTorrentBookTransport({ resourceLedger });
const libraryAcquisitionOwner = createSingleInstanceOwnerCapability();
let libraryBrowserAcquisition = null;
let libraryAcquisitionStartupReady = false;
let libraryAcquisitionStartupError = null;
let libraryAcquisitionStartupSettled = false;
const libraryAcquisitionService = new LibraryAcquisitionService({
  promoter: libraryImportService,
  resolver: createLibraryAcquisitionResolver(),
  requester: createLibraryAcquisitionRequester(),
  resourceLedger,
  torrentTransport: libraryTorrentTransport,
  singleInstanceOwnerCapability: libraryAcquisitionOwner,
  // This is only a wake-up hint. Renderer consumers always re-list the
  // durable Inbox; no artifact path is accepted from the event payload.
  onInboxReady: event => wm.broadcastShells('library:acquisitionInboxReady', event),
});
const libraryResourceSurface = new LibraryResourceSurfaceService({
  acquisitionService: libraryAcquisitionService,
  settings: store,
  resolver: createLibraryAcquisitionResolver(),
  requester: createLibraryAcquisitionRequester(),
  productToken: 'Mazz-Editor/0.2.0',
  torrentTransport: libraryTorrentTransport,
  onChanged: event => wm.broadcastShells('library:resourceChanged', event),
});
const libraryWorkspaceConvergence = new LibraryWorkspaceConvergenceService();
const factoryAiRequests = new FactoryAiRequestRegistry({ resourceLedger });
const factoryRunOwners = new FactoryRunOwnerRegistry({ resourceLedger });
const ingestionPipeline = new IngestionPipeline();
const feedPipeline = new FeedPipeline({ ingestionPipeline });
let continuousFeed = null;
const promotionLedger = new PromotionLedger();
const addressableEvidence = new AddressableEvidenceService({
  rootProvider: () => store.get('workspace'),
  identityStore: { get: key => store.get(key, {}), set: (key, value) => store.set(key, value) },
});
const contextRelations = new ContextRelationService({
  rootProvider: () => store.get('workspace'), store, evidenceService: addressableEvidence,
});
const workspaceEvents = new WorkspaceEventService({ rootProvider: () => store.get('workspace'), store });
// W94E domain producers share the one Workspace Event Ledger.  The services
// are constructed earlier for their startup registration, so attach the
// already-created ledger here before any IPC or recovery path can run.
capabilityExecutionService.eventService = workspaceEvents;
canvasDocumentService.eventService = workspaceEvents;
libraryAcquisitionService.eventService = workspaceEvents;
libraryResourceSurface.eventService = workspaceEvents;
const relationRetrieval = new RelationRetrievalService({
  rootProvider: () => store.get('workspace'), eventService: workspaceEvents, contextService: contextRelations,
});
const branchEffectiveState = new BranchEffectiveStateService({ rootProvider: () => store.get('workspace') });
const worldRuntime = new WorldRuntimeService({ rootProvider: () => store.get('workspace'), branchService: branchEffectiveState, eventService: workspaceEvents });
const publicationSigning = new PublicationSigningService({
  rootProvider: () => store.get('workspace'),
  protect: bytes => {
    if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error('系统安全存储不可用，拒绝创建 Publication 签名身份'), { code: 'PUBLICATION_KEY_PROTECTION_UNAVAILABLE' });
    return safeStorage.encryptString(Buffer.from(bytes).toString('base64'));
  },
  unprotect: bytes => {
    if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error('系统安全存储不可用，拒绝解封 Publication 签名身份'), { code: 'PUBLICATION_KEY_PROTECTION_UNAVAILABLE' });
    return Buffer.from(safeStorage.decryptString(Buffer.from(bytes)), 'base64');
  },
});
const worldHubPublication = new WorldHubPublicationService({
  rootProvider: () => store.get('workspace'), eventService: workspaceEvents,
  signatureVerifier: publicationSigning, allowDigestReference: false,
});
const localPublicationBridge = new LocalPublicationBridgeService({
  rootProvider: () => store.get('workspace'), capabilityService: capabilityExecutionService,
  signingService: publicationSigning, hubService: worldHubPublication,
});
const contextCompiler = new ContextCompilerService({ rootProvider: () => store.get('workspace'), eventService: workspaceEvents });
const cognitionService = new CognitionService({ rootProvider: () => store.get('workspace'), evidenceService: addressableEvidence, eventService: workspaceEvents });
const civilizationModel = new CivilizationModelService({ eventService: workspaceEvents, rootProvider: () => store.get('workspace') });
const accompanyService = new AccompanyService({ rootProvider: () => store.get('workspace') });
const organizationalWorkspace = new OrganizationalWorkspaceService({ bus, rootProvider: () => store.get('workspace') });
new MazAssetService({ bus });
new PhysicalSimulationService({ bus });
if (process.env.NODE_ENV === 'test') {
  globalThis.__MAZZ_E2E_FACTORY_AI_REQUESTS__ = factoryAiRequests;
  globalThis.__MAZZ_E2E_FACTORY_RUN_OWNERS__ = factoryRunOwners;
  globalThis.__MAZZ_E2E_INGESTION_PIPELINE__ = ingestionPipeline;
  globalThis.__MAZZ_E2E_FEED_PIPELINE__ = feedPipeline;
  globalThis.__MAZZ_E2E_PROMOTION_LEDGER__ = promotionLedger;
  globalThis.__MAZZ_E2E_RESOURCE_LEDGER__ = resourceLedger;
  globalThis.__MAZZ_E2E_LIBRARY_RESOURCE_SURFACE__ = libraryResourceSurface;
  globalThis.__MAZZ_E2E_WORLD_RUNTIME__ = worldRuntime;
  globalThis.__MAZZ_E2E_WORLD_HUB_PUBLICATION__ = worldHubPublication;
  globalThis.__MAZZ_E2E_PUBLICATION_SIGNING__ = publicationSigning;
  globalThis.__MAZZ_E2E_LOCAL_PUBLICATION_BRIDGE__ = localPublicationBridge;
  globalThis.__MAZZ_E2E_LIBRARY_TORRENT_TRANSPORT__ = libraryTorrentTransport;
  globalThis.__MAZZ_E2E_LIBRARY_CONVERGENCE__ = libraryWorkspaceConvergence;
  globalThis.__MAZZ_E2E_CAPABILITY_EXECUTION__ = capabilityExecutionService;
  globalThis.__MAZZ_E2E_RELATION_RETRIEVAL__ = relationRetrieval;
  globalThis.__MAZZ_E2E_BRANCH_EFFECTIVE_STATE__ = branchEffectiveState;
  globalThis.__MAZZ_E2E_SEED_ARTIFACT__ = async ({ workspacePath, bytesBase64, kind, mediaType, contentSchema } = {}) => {
    const store = capabilityExecutionService._store(workspacePath);
    const artifactStore = capabilityExecutionService._artifactStore(store);
    const bytes = Buffer.from(String(bytesBase64 || ''), 'base64');
    const publication = await artifactStore.publishBytes(bytes);
    const existing = store.snapshot().artifacts.find(row => row.contentHash === publication.contentHash);
    if (existing) return existing;
    const at = new Date().toISOString();
    const proposal = capabilityContract.normalizeProposal({
      schema: capabilityContract.EXECUTION_PROPOSAL_SCHEMA,
      workspaceIdentity: store.workspaceIdentity,
      taskId: `task:artifact-import:${publication.contentHash}`, seatId: 'seat:human-maintainer',
      capabilityId: 'mazz.artifact.import', capabilityVersion: '1.0.0', adapterId: 'mazz.artifact.import',
      inputs: [], parameters: { kind: String(kind || 'source-artifact'), contentSchema: String(contentSchema || 'mazz.source/v1') },
      expectedOutputs: [String(contentSchema || 'mazz.source/v1')], constraints: {}, authorityRef: 'human:w94d-fixture',
      determinism: 'external', state: 'completed', revision: 1, createdAt: at, updatedAt: at,
      activeLeaseId: '', receiptIds: [], artifactIds: [], failureCode: '',
    }, { durable: true });
    const leaseId = `lease-seed-${crypto.randomUUID()}`;
    const receiptId = `receipt-seed-${crypto.randomUUID()}`;
    const artifact = capabilityContract.normalizeArtifact({
      schema: capabilityContract.ARTIFACT_SCHEMA,
      artifactId: `artifact-${publication.contentHash}`,
      workspaceIdentity: store.workspaceIdentity,
      kind: String(kind || 'source-artifact'), mediaType: String(mediaType || 'application/octet-stream'),
      contentSchema: String(contentSchema || 'mazz.source/v1'), contentHash: publication.contentHash,
      definitionHash: '', storageRef: publication.storageRef, createdByReceiptId: receiptId,
      sourceArtifacts: [], rightsRef: '', mutableHead: false, revision: 1, createdAt: at,
    }, { durable: true });
    const lease = capabilityContract.normalizeLease({
      schema: capabilityContract.EXECUTION_LEASE_SCHEMA, leaseId, workspaceIdentity: store.workspaceIdentity,
      proposalId: proposal.proposalId, ownerKind: 'main-process', ownerId: `process:${process.pid}`,
      state: 'released', acquiredAt: at, heartbeatAt: at, cancelRequestedAt: '', releasedAt: at,
      releaseReason: 'SOURCE_ARTIFACT_IMPORTED', revision: 1,
    }, { durable: true });
    const receipt = capabilityContract.normalizeReceipt({
      schema: capabilityContract.EXECUTION_RECEIPT_SCHEMA, receiptId, proposalId: proposal.proposalId,
      leaseId, workspaceIdentity: store.workspaceIdentity,
      capability: { id: 'mazz.artifact.import', version: '1.0.0', adapterId: 'mazz.artifact.import' },
      state: 'completed', inputFacts: [], outputFacts: [artifact.artifactId],
      environment: { runtime: 'main', mode: 'source-artifact-import' }, determinism: 'external', seed: null,
      startedAt: at, finishedAt: at, diagnostics: { code: 'SOURCE_ARTIFACT_IMPORTED', summaryRef: 'diagnostic:w94d-seed' },
      resourceFinal: {}, provenance: { authorityRef: 'human:w94d-fixture' }, revision: 1,
    }, { durable: true });
    const completedProposal = capabilityContract.normalizeProposal({
      ...proposal, receiptIds: [receipt.receiptId], artifactIds: [artifact.artifactId], updatedAt: at, revision: 2,
    }, { durable: true });
    store.transact({ apply: state => {
      state.proposals.push(completedProposal);
      state.leases.push(lease);
      state.receipts.push(receipt);
      state.artifacts.push(artifact);
      return state;
    } });
    return artifact;
  };
  globalThis.__MAZZ_E2E_SEED_CURRENT_ARTIFACT__ = async () => globalThis.__MAZZ_E2E_SEED_ARTIFACT__({
    workspacePath: process.env.MAZZ_E2E_WORKSPACE,
    bytesBase64: fs.readFileSync(path.join(process.env.MAZZ_E2E_WORKSPACE, 'w94d-seed-input.bin')).toString('base64'),
    kind: 'blender-scene', mediaType: 'application/x-blender', contentSchema: 'mazz.blender-scene/v1',
  });
  globalThis.__MAZZ_E2E_CANVAS_DOCUMENT__ = canvasDocumentService;
}
const factoryRuntimeOwners = new WeakSet();
const wm = new WindowManager({ store, iconPath: path.join(__dirname, '..', 'resources', 'icons', 'app.png'), resourceLedger });
const visualComposition = new VisualCompositionRuntime({ bus, wm });
wm.setVisualComposition(visualComposition);
if (process.env.NODE_ENV === 'test') globalThis.__MAZZ_E2E_VISUAL_COMPOSITION__ = visualComposition;
const memoryGovernor = new MemoryGovernor({
  resourceLedger,
  appMetrics: () => app.getAppMetrics(),
  onPressure: snapshot => wm.broadcast('memory:pressure', { state: snapshot.state, violations: snapshot.violations }),
});
bus.handle('memory:summary', async ({ includeHistory = false } = {}) => memoryGovernor.summary({ includeHistory }));
bus.handle('memory:capture', async () => memoryGovernor.sample());
bus.handle('memory:resetBaseline', async () => memoryGovernor.resetBaseline());
const tray = new TrayService({
  windowManager: wm, store,
  onCommand: (id, payload) => wm.broadcast('command:invoke', { id, payload }),
});
const globalShortcuts = new GlobalShortcuts({ windowManager: wm, store });

let pendingOpenFiles = []; // 主实例未就绪前收到的文件参数
let pendingImports = [];   // 主实例未就绪前收到的 --import 导入参数
let pendingProtocolUrls = [];
let mainRendererReady = false;

// —— 跨进程路径统一为正斜杠：渲染层一律按 '/' 运算（Node fs 在 Windows 正反斜杠通吃）——
const toSlash = (p) => (typeof p === 'string' ? p.replace(/\\/g, '/') : p);
const toSlashDeep = (v) => Array.isArray(v) ? v.map(toSlashDeep)
  : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toSlashDeep(x)])) : toSlash(v));

// 文件监听器实例（whenReady 时创建；删除/改名前需先解锁，否则 Windows 下目录被 ReadDirectoryChangesW 句柄锁死）
let watcher = null;
let torrentSites = null;
/** 删除/移动前解锁监视句柄（Windows 下被监视的目录无法改名/删除） */
async function unlockWatch(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length || !watcher?.watcher) return;
  try { await watcher.watcher.unwatch(list); } catch {}
}

// 开始菜单已装软件扫描（模块级：registerChannels 与 ShareService 共用）
const startMenuApps = new StartMenuApps({ store });

function extractOpenFiles(argv) {
  const args = (argv || []).slice(1);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--import') { i++; continue; } // --import 的载荷是导入任务，不是打开目标
    if (a.startsWith('-') || a.startsWith(PROTOCOL + '://')) continue;
    try { if (fs.existsSync(a) && fs.statSync(a).isFile()) out.push(path.resolve(a)); } catch {}
  }
  return out;
}

function extractProtocolUrls(argv) {
  return (argv || [])
    .map(value => String(value || '').trim())
    .filter(value => value.toLowerCase().startsWith(PROTOCOL + '://'));
}

app.on('second-instance', (_e, argv) => {
  const files = extractOpenFiles(argv);
  const imports = Importer.extractImportPaths(argv);
  const protocolUrls = extractProtocolUrls(argv);
  // A second launch can arrive while app.whenReady() is awaiting acquisition
  // recovery. It may enqueue user intent, but it is not a second authority to
  // create the first shell before startup reaches READY or durable HOLD.
  if (!libraryAcquisitionStartupSettled) {
    pendingOpenFiles.push(...files);
    pendingImports.push(...imports);
    for (const url of protocolUrls) {
      if (!pendingProtocolUrls.includes(url)) pendingProtocolUrls.push(url);
    }
    return;
  }
  if (wm.main) { wm.main.show(); wm.main.focus(); }
  else wm.createMain();
  files.forEach(f => wm.broadcast('file:open', { path: f }));
  if (imports.length) wm.broadcast('file:import', { paths: imports });
  protocolUrls.forEach(handleProtocol);
});

// ---------- mazz:// 自定义协议（笔记互链跳转 / 浏览器模块唤回主窗）----------
app.on('open-url', (e, url) => { e.preventDefault(); handleProtocol(url); });
function handleProtocol(url) {
  const normalized = extractProtocolUrls([url])[0];
  if (!normalized) return;
  if (wm.main) { wm.main.show(); wm.main.focus(); }
  if (!mainRendererReady) {
    if (!pendingProtocolUrls.includes(normalized)) pendingProtocolUrls.push(normalized);
    return;
  }
  wm.broadcast('protocol:open', { url: normalized });
}

// ---------- 关闭行为：退出 / 最小化到托盘（默认询问一次后记住）----------
wm.onCloseRequest = (win) => {
  const behavior = store.get('closeBehavior', 'ask');
  if (behavior === 'tray') { win.hide(); return 'prevent'; }
  if (behavior === 'quit') { wm.forceClose = true; return 'allow'; }
  // ask：询问一次，勾选记住后写入设置
  const r = dialog.showMessageBoxSync(win, {
    type: 'question', buttons: ['最小化到托盘', '退出', '取消'], defaultId: 0, cancelId: 2,
    title: '关闭 Mazz Editor', message: '关闭窗口后：',
    detail: '选择将记住，可在设置中更改。',
  });
  if (r === 2) return 'prevent';
  if (r === 0) { store.set('closeBehavior', 'tray'); win.hide(); return 'prevent'; }
  store.set('closeBehavior', 'quit'); wm.forceClose = true; return 'allow';
};

// ---------- 最近文件（Jump List / Dock 同步）----------
function addRecent(filePath) {
  const list = store.get('recentFiles', []).filter(f => f !== filePath);
  list.unshift(filePath);
  store.set('recentFiles', list.slice(0, 30));
  app.addRecentDocument(filePath);
  tray.refreshMenu();
}

// ---------- 白名单通道注册 ----------
function registerChannels() {
  const isTrustedLibraryShellSender = event => {
    const sender = event?.sender;
    const senderFrame = event?.senderFrame;
    if (!sender || !senderFrame || senderFrame !== sender.mainFrame) return false;
    const win = BrowserWindow.fromWebContents(sender);
    if (!win || (win !== wm.main && !wm.children.has(win))) return false;
    if (win !== wm.main && win.__handoffReady === false) return false;
    try {
      const senderUrl = new URL(String(senderFrame.url || sender.getURL?.() || ''));
      return senderUrl.protocol === 'mazz-res:'
        && senderUrl.hostname === 'app'
        && senderUrl.pathname === '/index.html'
        && !senderUrl.username && !senderUrl.password && !senderUrl.port;
    } catch {
      return false;
    }
  };
  registerLibraryAcquisitionIpc({
    bus,
    service: libraryAcquisitionService,
    currentWorkspace: () => store.get('workspace'),
    isStartupReady: () => libraryAcquisitionStartupReady,
    isTrustedSender: isTrustedLibraryShellSender,
  });
  registerLibraryResourceSurfaceIpc({
    bus,
    service: libraryResourceSurface,
    currentWorkspace: () => store.get('workspace'),
    isStartupReady: () => libraryAcquisitionStartupReady,
    isTrustedSender: isTrustedLibraryShellSender,
  });
  registerLibraryWorkspaceConvergenceIpc({
    bus,
    service: libraryWorkspaceConvergence,
    currentWorkspace: () => store.get('workspace'),
    isStartupReady: () => libraryAcquisitionStartupReady,
    isTrustedSender: isTrustedLibraryShellSender,
  });
  registerCapabilityExecutionIpc({
    bus,
    service: capabilityExecutionService,
    currentWorkspace: () => store.get('workspace'),
    isStartupReady: () => capabilityExecutionStartupReady,
    isTrustedSender: isTrustedLibraryShellSender,
  });
  registerCanvasDocumentIpc({
    bus,
    service: canvasDocumentService,
    currentWorkspace: () => store.get('workspace'),
    isStartupReady: () => capabilityExecutionStartupReady,
    isTrustedSender: isTrustedLibraryShellSender,
  });
  const bindFactoryOwner = sender => {
    if (!sender || factoryRuntimeOwners.has(sender)) return String(sender?.id || '');
    factoryRuntimeOwners.add(sender);
    const ownerId = String(sender.id || '');
    sender.on('render-process-gone', () => {
      factoryAiRequests.cancelOwner(ownerId, 'renderer-gone').catch(() => {});
      factoryRunOwners.releaseOwner(ownerId, 'renderer-gone');
    });
    sender.once('destroyed', () => {
      factoryAiRequests.cancelOwner(ownerId, 'renderer-destroyed').catch(() => {});
      factoryRunOwners.releaseOwner(ownerId, 'renderer-destroyed');
    });
    return ownerId;
  };
  // —— 文件系统 ——
  bus.handle('fs:readFile', async ({ path: p, encoding }) => fs.readFileSync(p, encoding || 'utf8'));
  bus.handle('fs:readFileBase64', async ({ path: p, maxBytes = 0 }) => {
    const limit = Math.max(0, Number(maxBytes) || 0);
    if (limit) {
      const stat = await fs.promises.stat(p);
      if (stat.size > limit) {
        const error = new Error(`File exceeds bounded read limit (${stat.size} > ${limit})`);
        error.code = 'FS_READ_LIMIT_EXCEEDED';
        error.size = stat.size;
        error.limit = limit;
        throw error;
      }
    }
    const data = await fs.promises.readFile(p);
    if (limit && data.byteLength > limit) {
      const error = new Error(`File exceeds bounded read limit (${data.byteLength} > ${limit})`);
      error.code = 'FS_READ_LIMIT_EXCEEDED';
      error.size = data.byteLength;
      error.limit = limit;
      throw error;
    }
    return data.toString('base64');
  });
  bus.handle('fs:probeFile', async ({ path: p }) => require('./file-probe').probeFileSync(p));
  bus.handle('evidence:scanWorkspace', async ({ force = false } = {}) => addressableEvidence.scan({ force: force === true }));
  bus.handle('evidence:fileRelations', async ({ path: p, force = false } = {}) => addressableEvidence.fileRelations({ path: p, force: force === true }));
  bus.handle('evidence:createAnchorForPath', async payload => addressableEvidence.createAnchorForPath(payload));
  bus.handle('evidence:invalidate', async ({ path: p = '' } = {}) => addressableEvidence.invalidate(p));
  bus.handle('context:snapshot', async () => contextRelations.read());
  bus.handle('context:addSubject', async payload => contextRelations.addSubject(payload));
  bus.handle('context:removePlacement', async ({ placementId } = {}) => contextRelations.removePlacement(placementId));
  bus.handle('context:updatePlacement', async ({ placementId, patch } = {}) => contextRelations.updatePlacement(placementId, patch));
  bus.handle('context:addShadowEdge', async ({ edge } = {}) => contextRelations.addShadowEdge(edge));
  bus.handle('context:dismissShadowEdge', async ({ edgeId } = {}) => contextRelations.dismissShadowEdge(edgeId));
  bus.handle('context:promoteEdge', async payload => contextRelations.promoteEdge(payload));
  bus.handle('context:importBookmarks', async payload => contextRelations.importBookmarks(payload));
  bus.handle('events:capture', async payload => workspaceEvents.capture(payload));
  bus.handle('events:snapshot', async () => workspaceEvents.snapshot());
  bus.handle('events:search', async ({ query } = {}) => workspaceEvents.search(query));
  bus.handle('events:lifecycle', async ({ ref } = {}) => workspaceEvents.lifecycle(ref));
  bus.handle('events:export', async () => workspaceEvents.export());
  bus.handle('events:setEnabled', async ({ enabled } = {}) => workspaceEvents.setEnabled(enabled));
  bus.handle('events:applyRetention', async payload => workspaceEvents.applyRetention(payload));
  bus.handle('events:clear', async payload => workspaceEvents.clear(payload));
  bus.handle('relation:query', async payload => relationRetrieval.query(payload));
  bus.handle('relation:snapshot', async () => relationRetrieval.snapshot());
  bus.handle('relation:rejectCandidate', async payload => relationRetrieval.rejectCandidate(payload));
  bus.handle('relation:reject-candidate', async payload => relationRetrieval.rejectCandidate(payload));
  bus.handle('relation:rebuild', async () => relationRetrieval.rebuild());
  bus.handle('branch:snapshot', async () => branchEffectiveState.snapshot());
  bus.handle('branch:create', async payload => branchEffectiveState.create(payload));
  bus.handle('branch:attachParent', async payload => branchEffectiveState.attachParent(payload));
  bus.handle('branch:attach-parent', async payload => branchEffectiveState.attachParent(payload));
  bus.handle('branch:setRevision', async payload => branchEffectiveState.setRevision(payload));
  bus.handle('branch:set-revision', async payload => branchEffectiveState.setRevision(payload));
  bus.handle('branch:resolveConflict', async payload => branchEffectiveState.resolveConflict(payload));
  bus.handle('branch:resolve-conflict', async payload => branchEffectiveState.resolveConflict(payload));
  bus.handle('branch:rebuild', async () => branchEffectiveState.rebuild());
  bus.handle('world:snapshot', async payload => worldRuntime.snapshot(payload || {}));
  bus.handle('world:create', async payload => worldRuntime.create(payload));
  bus.handle('world:fork', async payload => worldRuntime.fork(payload));
  bus.handle('world:proposeCanon', async payload => worldRuntime.propose(payload));
  bus.handle('world:reviewProposal', async payload => worldRuntime.review(payload));
  bus.handle('world:withdrawProposal', async payload => worldRuntime.withdraw(payload));
  bus.handle('world:mergeCanon', async payload => worldRuntime.merge(payload));
  bus.handle('world:rebuild', async payload => worldRuntime.rebuild(payload || {}));
  bus.handle('hub:preparePublication', async payload => worldHubPublication.prepare(payload));
  bus.handle('hub:publishPublication', async payload => worldHubPublication.publish(payload));
  bus.handle('hub:withdrawPublication', async payload => worldHubPublication.withdraw(payload));
  bus.handle('hub:syncPublication', async payload => worldHubPublication.sync(payload));
  bus.handle('hub:snapshot', async payload => worldHubPublication.snapshot(payload || {}));
  bus.handle('hub:rebuild', async payload => worldHubPublication.rebuild(payload || {}));
  bus.handle('hub:signPublication', async payload => publicationSigning.signPublication(payload));
  bus.handle('publicationBridge:snapshot', async () => localPublicationBridge.snapshot());
  bus.handle('publicationBridge:prepare', async payload => localPublicationBridge.prepare(payload));
  bus.handle('publicationBridge:publish', async payload => localPublicationBridge.publish(payload));
  bus.handle('publicationBridge:withdraw', async payload => localPublicationBridge.withdraw(payload));
  bus.handle('contextPackage:compile', async payload => contextCompiler.compile(payload));
  bus.handle('contextPackage:list', async () => contextCompiler.list());
  bus.handle('cognition:list', async () => cognitionService.list());
  bus.handle('cognition:create', async payload => cognitionService.create(payload));
  bus.handle('cognition:approve', async payload => cognitionService.approve(payload));
  bus.handle('cognition:supersede', async payload => cognitionService.supersede(payload));
  bus.handle('cognition:summary', async payload => cognitionService.summary(payload));
  bus.handle('civilization:simulate', async payload => civilizationModel.simulate(payload));
  bus.handle('civilization:filter', async payload => civilizationModel.filter(payload));
  bus.handle('civilization:reconcile', async payload => civilizationModel.reconcile(payload));
  bus.handle('companion:archive', async payload => accompanyService.archive(payload));
  bus.handle('companion:memory', async payload => accompanyService.memory(payload));
  // Windows 原子写：rename 遇 EPERM/EACCES/EBUSY（目标被外部程序占用/杀软扫描）退化为覆盖拷贝，重试两轮后仍败则报人话
  const writeAtomic = (p, data, encoding) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.mazztmp';
    fs.writeFileSync(tmp, data, encoding);
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try { fs.renameSync(tmp, p); return; }
      catch (e) {
        lastErr = e;
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
        try { fs.copyFileSync(tmp, p); try { fs.unlinkSync(tmp); } catch {} return; } catch (e2) { lastErr = e2; }
        // 短暂等待杀软/索引器释放
        const until = Date.now() + 200 * (i + 1); while (Date.now() < until) {}
      }
    }
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error(`写入失败：目标文件被占用（可能正被外部程序打开，请关闭后重试）。${lastErr?.code || ''}`);
  };
  bus.handle('fs:writeFileBase64', async ({ path: p, base64 }) => {
    writeAtomic(p, Buffer.from(base64, 'base64'));
    return true;
  });
  bus.handle('library:importMaterialize', async (payload, event) => {
    const receipt = await libraryImportService.materialize(payload, event?.sender?.id);
    return { ...receipt, path: toSlash(receipt.path) };
  });
  bus.handle('library:importFinalize', async (payload, event) => {
    const result = await libraryImportService.finalize(payload, event?.sender?.id);
    return result?.path ? { ...result, path: toSlash(result.path) } : result;
  });
  bus.handle('fs:writeFile', async ({ path: p, content, encoding }) => {
    writeAtomic(p, content, encoding || 'utf8');
    return true;
  });
  bus.handle('fs:listDir', async ({ path: p, includeDot = false }) => {
    // 目录不存在视同空目录（v33：factory-genres/创作产出/themes 未建时不再抛错刷屏）
    if (!fs.existsSync(p)) return [];
    const entries = fs.readdirSync(p, { withFileTypes: true });
    // includeDot（W44 媒体库递归专用）：.git 外全放（默认仍滤点——工作区树不泄 .git）
    return entries.filter(e => includeDot ? e.name !== '.git' : !e.name.startsWith('.'))
      .map(e => {
        // 附带时间戳（排序选单需要；stat 失败置 0 不影响主流程）
        let mtimeMs = 0, ctimeMs = 0;
        try { const st = fs.statSync(path.join(p, e.name)); mtimeMs = st.mtimeMs; ctimeMs = st.birthtimeMs || st.ctimeMs; } catch {}
        return { name: e.name, isDir: e.isDirectory(), path: toSlash(path.join(p, e.name)), mtimeMs, ctimeMs };
      })
      .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
  });
  bus.handle('fs:stat', async ({ path: p }) => {
    try { const s = fs.statSync(p); return { exists: true, isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs }; }
    catch (error) {
      // Keep the historical `exists:false` envelope for callers, but retain
      // the OS error code so reliability-sensitive features can distinguish
      // ENOENT from EACCES/EPERM instead of declaring a readable source gone.
      return { exists: false, code: String(error?.code || '') };
    }
  });
  bus.handle('fs:mkdir', async ({ path: p }) => { fs.mkdirSync(p, { recursive: true }); return true; });
  bus.handle('fs:rename', async ({ from, to }) => {
    await unlockWatch(from); // 被监视的目录在 Windows 下无法改名
    fs.renameSync(from, to);
    return true;
  });
  bus.handle('fs:delete', async ({ path: p }) => {
    await unlockWatch(p); // 被监视的目录在 Windows 下无法删除
    // Windows trashItem 要求本地反斜杠路径；渲染层统一正斜杠，直接传会静默失败（v33 实测）
    const norm = path.normalize(p);
    // 确定性广播：chokidar 对 trashItem 挪走的 unlink 可能哑火（Linux 实测），
    // 虚空标签清扫不能只靠监听器——主进程删完就官宣
    const announce = () => wm.broadcastShells('file:changed', { event: 'unlink', path: toSlash(p), at: Date.now() });
    // trashItem 串行重试：多层目录被 chokidar 句柄/杀软占用时会 Operation was aborted
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try { await shell.trashItem(norm); announce(); return { ok: true, trashed: true }; }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 300 * (i + 1))); }
    }
    // 回收站持续失败 → 全量卸监视释放句柄，永久删除兜底（用户已在界面确认过删除），事后恢复监视
    try { if (watcher?.suspend) await watcher.suspend(); } catch {}
    try {
      fs.rmSync(norm, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
    } finally {
      try { if (watcher?.resume) await watcher.resume(); } catch {}
    }
    announce();
    return { ok: true, trashed: false, reason: String(lastErr || '').slice(0, 160) };
  }); // 进回收站

  // —— 原生对话框 ——
  bus.handle('dialog:openFile', async ({ filters, multi }) => {
    const r = await dialog.showOpenDialog(wm.main, {
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: filters || [
        { name: 'Mazz 全部支持', extensions: ['md', 'markdown', 'txt', 'mazz', 'csv', 'tsv', 'mazzsheet', 'xlsx', 'docx', 'pptx', 'mazzslide', 'mindmap', 'mazzdraw', 'js', 'ts', 'py', 'css', 'html', 'json', 'sh', 'xml', 'yml', 'yaml', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf',
          'mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'mkv', 'mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus'] },
        { name: '文档', extensions: ['md', 'markdown', 'txt', 'mazz', 'docx'] },
        { name: '表格', extensions: ['csv', 'tsv', 'mazzsheet', 'xlsx'] },
        { name: '演示', extensions: ['mazzslide', 'pptx'] },
        { name: '代码', extensions: ['js', 'ts', 'py', 'css', 'html', 'json', 'sh', 'xml', 'yml', 'yaml'] },
        { name: '图片与PDF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf'] },
        { name: '音视频', extensions: ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled) return null;
    return multi ? r.filePaths.map(toSlash) : toSlash(r.filePaths[0]);
  });
  bus.handle('dialog:openImport', async () => {
    const r = await dialog.showOpenDialog(wm.main, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    });
    return r.canceled ? [] : r.filePaths.map(toSlash);
  });
  bus.handle('import:external', async ({ sources }) => {
    const ws = store.get('workspace');
    if (!ws) return { imported: [], skipped: sources || [], workspace: null, error: 'no-workspace' };
    return toSlashDeep(Importer.importExternal(toSlash(ws), sources || []));
  });
  bus.handle('apps:quickLaunch', async ({ refresh } = {}) => startMenuApps.quickLaunch({ refresh }));
  bus.handle('apps:launch', async ({ exe, args }) => startMenuApps.launch({ exe, args }));
  bus.handle('explorermenu:status', async () => Importer.explorerMenuStatus());
  bus.handle('explorermenu:register', async () =>
    Importer.registerExplorerMenu(process.execPath, { appPath: app.isPackaged ? null : app.getAppPath() }));
  bus.handle('explorermenu:unregister', async () => Importer.unregisterExplorerMenu());

  bus.handle('dialog:saveFile', async ({ defaultPath, filters }) => {
    const r = await dialog.showSaveDialog(wm.main, {
      defaultPath,
      filters: filters || [{ name: 'Markdown', extensions: ['md'] }, { name: '所有文件', extensions: ['*'] }],
    });
    return r.canceled ? null : toSlash(r.filePath);
  });
  bus.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(wm.main, { properties: ['openDirectory'] });
    return r.canceled ? null : toSlash(r.filePaths[0]);
  });
  bus.handle('dialog:confirm', async ({ title, message, detail, buttons }) => {
    const r = await dialog.showMessageBox(wm.main, {
      type: 'warning', title, message, detail, buttons: buttons || ['确定', '取消'],
      cancelId: (buttons || ['确定', '取消']).length - 1,
    });
    return r.response;
  });

  // —— 最近文件 ——
  bus.handle('recent:list', async () => (store.get('recentFiles', []) || []).map(toSlash));
  bus.handle('recent:add', async ({ path: p }) => { addRecent(p); return true; });
  bus.handle('recent:clear', async () => { store.set('recentFiles', []); app.clearRecentDocuments(); tray.refreshMenu(); return true; });

  // —— 工作区 / 设置 ——
  bus.handle('settings:get', async ({ key }) => store.get(key));
  bus.handle('settings:set', async ({ key, value }) => { store.set(key, value); return true; });
  bus.handle('settings:compareAndSet', async (payload = {}) => {
    const entries = settingsCasEntries(payload);
    // IPC normalizes an undefined handler result to null. Use the same missing
    // token inside the main-process CAS boundary; otherwise a renderer that
    // just read a missing setting as null can never create it because
    // `undefined !== null`, exhausting every retry on first Library launch.
    const current = entries.map(entry => ({ key: entry.key, value: store.get(entry.key, null) }));
    const conflict = entries.findIndex((entry, index) => !settingsCasEqual(current[index].value, entry.expected));
    if (conflict >= 0) {
      return { ok: false, key: entries[conflict].key, current: current[conflict].value, values: current };
    }
    store.merge(Object.fromEntries(entries.map(entry => [entry.key, entry.value])));
    return { ok: true, values: entries.map(entry => ({ key: entry.key, value: entry.value })) };
  });

  // —— 智能创作 · pandoc 通道（文风素材 docx 提取 + 连写产出多格式导出） ——
  // 设计：pandoc 未安装不报错轰炸，available=false 由渲染层静默降级
  const { spawn: spawnPandoc } = require('child_process');
  const pandocCache = { checked: false, path: null };
  const findPandoc = () => new Promise((resolve) => {
    if (pandocCache.checked) return resolve(pandocCache.path);
    const candidates = ['pandoc',
      'C:\\Program Files\\Pandoc\\pandoc.exe', 'C:\\Program Files (x86)\\Pandoc\\pandoc.exe',
      '/usr/bin/pandoc', '/usr/local/bin/pandoc', '/opt/homebrew/bin/pandoc'];
    const tryOne = (i) => {
      if (i >= candidates.length) { pandocCache.checked = true; pandocCache.path = null; return resolve(null); }
      const p = spawnPandoc(candidates[i], ['--version'], { windowsHide: true });
      p.on('error', () => tryOne(i + 1));
      p.on('close', (code) => {
        if (code === 0) { pandocCache.checked = true; pandocCache.path = candidates[i]; resolve(candidates[i]); }
        else tryOne(i + 1);
      });
    };
    tryOne(0);
  });
  const runPandoc = (args, inputText) => new Promise(async (resolve, reject) => {
    const bin = await findPandoc();
    if (!bin) return reject(new Error('未检测到 pandoc（安装 pandoc.org 后可用 docx/epub 等格式）'));
    const p = spawnPandoc(bin, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { err += d.toString('utf8'); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(err.slice(0, 300) || `pandoc 退出码 ${code}`)));
    if (inputText != null) { p.stdin.write(inputText, 'utf8'); }
    p.stdin.end();
  });
  // —— 智能创作 · AI 代理（渲染进程直连 DeepSeek/Kimi 会被浏览器 CORS 拦截，必须主进程转发） ——
  // 错误透传：HTTP 状态码 + 响应体摘要，让用户看到 401/404/模型名错误等真实原因而非笼统的 Failed to fetch
  const { net } = require('electron');
  const aiHeaders = (apiKey) => ({
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
  });
  const aiUrl = (baseURL) => joinFactoryAiEndpoint(baseURL, 'chat/completions');
  const aiModelsUrl = (baseURL) => joinFactoryAiEndpoint(baseURL, 'models');
  const aiReadError = async (resp) => {
    const text = await resp.text().catch(() => '');
    let msg = text.slice(0, 400);
    try { msg = JSON.parse(text).error?.message || msg; } catch {}
    return `HTTP ${resp.status}：${msg}`;
  };
  // 响应文本只接收 Provider 最终 content；reasoning_content 不是正式工件。
  const aiExtractText = extractFactoryContentText;
  const factoryMockEnabled = process.env.NODE_ENV === 'test' && process.env.MAZZ_E2E_FACTORY_MOCK === '1';
  const factoryTimeout = (envName, normalMs) => {
    if (process.env.NODE_ENV !== 'test' || !process.env[envName]) return normalMs;
    const value = Number(process.env[envName]);
    return Number.isFinite(value) ? Math.max(50, Math.min(normalMs, Math.round(value))) : normalMs;
  };
  const factoryMock = { blueprintAttempts: 0, unitNo: 0, w68Repair: 0, w68Point: 0 };
  const factoryMockBody = body => String(body || '').trim();
  const factoryMockReply = ({ system = '', user = '', stream = false }) => {
    if (!factoryMockEnabled) return null;
    // W62d：第一次故意破坏块守恒，逼出“解析失败只重试一次”；纠错轮再按原块 ID 全量回供。
    if (system.includes('MAZZ_MAP_DISTILL_V1')) {
      const ids = [...new Set([...String(user).matchAll(/"id"\s*:\s*"(B\d+)"/g)].map(match => match[1]))];
      if (!user.includes('上次输出不合格')) return JSON.stringify(ids.slice(0, Math.max(1, ids.length - 1)).map((id, index) => ({ id, depth: index ? 2 : 1 })));
      return JSON.stringify(ids.map((id, index) => ({ id, depth: index === 0 || index % 3 === 0 ? 1 : 2 })));
    }
    // W62a：E2E 专用的确定性 agent 路由台。按同一轮 transcript 推进，验证真工具循环而非假聊天。
    if (system.includes('MAZZ_AGENT_ROUTER_V1')) {
      const original = (/【原始交办】\s*([\s\S]*?)\s*【台账最近记录】/.exec(user) || [])[1] || '';
      const steps = (/【本次已执行步骤】\s*([\s\S]*?)\s*只回一个 JSON/.exec(user) || [])[1] || '';
      const untouched = !steps.trim() || steps.trim() === '无';
      if (original.includes('W62连续交办')) {
        if (untouched) return '{"command":"file.new","args":{}}';
        if (steps.includes('file.new(') && !steps.includes('file.newText(')) return '{"command":"file.newText","args":{}}';
        return '{"command":"agent.finish","args":{"message":"连续交办两步完成"}}';
      }
      if (original.includes('W62澄清任务')) {
        if (untouched) return '{"command":"agent.clarify","args":{"question":"请选择成品格式","options":[{"label":"Markdown","value":"A"},{"label":"纯文本","value":"B"}]}}';
        if (steps.includes('用户选择：B') && !steps.includes('file.newText(')) return '{"command":"file.newText","args":{}}';
        return '{"command":"agent.finish","args":{"message":"已按澄清选项完成"}}';
      }
      if (original.includes('W62危险删除')) return '{"command":"fileTree.delete","args":{}}';
      if (original.includes('W62打开新文档')) {
        if (untouched) return '{"command":"file.new","args":{}}';
        return '{"command":"agent.finish","args":{"message":"新文档已打开"}}';
      }
      return '{"command":"agent.finish","args":{"message":"模拟交办已收口"}}';
    }
    // W68a：六席确定性剧本。覆盖机检退回、请示先改骨架、撤回、两轮后开庭与终审。
    if (system.includes('MAZZ_W68_POLISH')) {
      const body = user.split('【正文】').at(-1)?.trim() || '';
      return body.replace(/(?:觉得|感到|意识到|心想)/g, '看见');
    }
    if (system.includes('MAZZ_W68_REPAIR')) {
      factoryMock.w68Repair++;
      const destination = factoryMock.w68Repair > 1 ? '星港' : '北闸港';
      return `林澈在黎明启航，旧船穿过${destination}外的雾带。${`潮声撞在舷板上，他核对罗盘刻度与值班簿，把每一次偏航都记在纸边；远处信标逐盏亮起，甲板上的人用动作交换判断，没有谁替证据发言。`.repeat(12)}终点的${destination}终于显出轮廓。`;
    }
    if (system.includes('MAZZ_W68_POINT')) {
      factoryMock.w68Point++;
      if (factoryMock.w68Point === 1) return JSON.stringify({ decision: 'adjust', findings: [{ message: '更优方向需先请示', artifactRef: 'draft:终点', ruleRef: 'W68-C1' }], consultation: { proposal: '把终点改为星港', reason: '与信标意象形成闭环', approved: true, skeletonPatch: '新增星港验收点', biblePatch: '终点＝星港' } });
      return JSON.stringify({ decision: 'pass', findings: [] });
    }
    if (system.includes('MAZZ_W68_CONSULTATION')) return '- [必达] port::抵达星港::星港\n- [锁定] destination::终点=星港::航海日志|信标记录::本次航程终点';
    if (system.includes('MAZZ_W68_REVIEW')) {
      if (system.includes('M4')) return JSON.stringify({ objections: [
        { id: 'O-WITHDRAW', severity: 'major', claim: '启航动作是否有正文证据', artifactRef: 'draft:首句', ruleRef: 'W68-E1' },
        { id: 'O-HEARING', severity: 'critical', claim: '终点口径是否与批准请示一致', artifactRef: 'skeleton:destination', ruleRef: 'W68-R4' },
      ] });
      return JSON.stringify({ objections: [] });
    }
    if (system.includes('MAZZ_W68_ANSWER')) {
      const id = user.includes('O-HEARING') ? 'O-HEARING' : 'O-WITHDRAW';
      return JSON.stringify({ answer: id === 'O-HEARING' ? '正文末句与圣经均登记星港' : '正文首句明确记录黎明启航', evidenceRef: id === 'O-HEARING' ? 'draft:末句+skeleton:destination' : 'draft:首句' });
    }
    if (system.includes('MAZZ_W68_RECONSIDER')) return JSON.stringify({ outcome: user.includes('O-WITHDRAW') ? 'withdraw' : 'hold', reason: user.includes('O-WITHDRAW') ? '证据充分，撤回' : '交终审席核验全局锁定' });
    if (system.includes('MAZZ_W68_HEARING')) return JSON.stringify({ decision: 'overrule', reason: '圣经、骨架、正文三处同值', ruleRef: 'W68-R4' });
    if (system.includes('MAZZ_W68_FINAL')) return JSON.stringify({ decision: 'pass', reason: '四闸全开，圣经无冲突' });
    if (stream && user.includes('W68双环实证')) {
      return `本文已通过所有校验。林澈在黎明启航。${'潮水托起旧船，信标在雾里明灭；他把读数写进值班簿，船员依次复核航向，所有判断都留下可追查的动作与记录。'.repeat(12)}船驶向北闸港。`;
    }
    if (stream && user.includes('META 蓝图生成要求')) {
      if (user.includes('META直过报告')) {
        return `# META直过报告结构蓝图\n\n## 任务目标\n验证说明类蓝图直过。\n\n## 目标读者\n验收人员。\n\n## 核心材料\n模拟台架记录。${'已确认材料用于支撑结构化写作。'.repeat(35)}\n\n## 结构大纲\n第1节：完成直过验收\n\n## 核心要点\n保持口径一致。\n\n## 论据数据\n模拟读数101。\n\n## 术语口径\n统一使用样本口径。\n\n## 质量校验\n完整性与可追溯性。\n\n## 创作启动指令\n按已确认材料写作。`;
      }
      factoryMock.blueprintAttempts++;
      return `# 残缺蓝图 ${factoryMock.blueprintAttempts}\n\n${'这是一份故意不含结构关键词的残缺材料。'.repeat(40)}`;
    }
    if (stream) {
      factoryMock.unitNo++;
      const body = `本节记录实验报告第 ${factoryMock.unitNo} 个结构单元。测量值 ${100 + factoryMock.unitNo}，术语口径沿用既定定义，论据来自模拟台架。${'这一段用于验证模型原生声明经过核验后才能可靠落盘。'.repeat(6)}`;
      return factoryMockBody(body);
    }
    if (system.includes('一致性校验员')) return '纠偏：下一节继续沿用统一单位与实验口径，补明论据来源；既有正文不重写。';
    if (system.includes('状态记录员')) {
      return `## 要点台账\n- 第 ${factoryMock.unitNo} 节测量完成\n\n## 术语与数据一致性\n- 单位与口径一致\n\n## 论据与引用台账\n- 模拟台架记录（已核）\n\n## 结构完成度\n- ${factoryMock.unitNo}/11；既有条目只增不减`;
    }
    return '测试响应';
  };
  bus.handle('factory:aiChat', async ({ requestId, providerId, role, baseURL, apiKey, model, system, user, messages, temperature = 0.7, detailed = false }, event) => {
    const req = factoryAiRequests.begin(requestId || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, {
      kind: 'chat', timeoutMs: factoryTimeout('MAZZ_E2E_FACTORY_CHAT_TIMEOUT_MS', 180000), model,
      ownerId: bindFactoryOwner(event?.sender),
    });
    let outcome = 'completed';
    try {
      const mocked = factoryMockReply({ system, user, stream: false });
      if (mocked != null) return detailed ? {
        text: String(mocked).trim(), finishReason: 'stop', completionKind: 'finish-reason',
        usage: null, safeToCommit: true,
      } : mocked;
      // messages 直通（多模态：content 数组含 image_url）；否则 system/user 组装
      const msgs = messages || [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }];
      const resp = await net.fetch(aiUrl(baseURL), {
        method: 'POST', headers: aiHeaders(apiKey),
        body: JSON.stringify({
          model, messages: msgs, temperature, stream: false,
          ...factoryProviderGenerationOptions({ providerId, baseURL, model, role }),
        }),
        signal: req.signal,
      });
      if (!resp.ok) throw new Error(await aiReadError(resp));
      const data = await resp.json();
      if (data.error) throw new Error('API 报错：' + String(data.error.message || JSON.stringify(data.error)).slice(0, 300));
      const choice = data.choices?.[0] || {};
      const text = aiExtractText(choice.message);
      if (!text || !text.trim()) {
        const fr = data.choices?.[0]?.finish_reason || '未知';
        // Never echo the provider payload here.  Some reasoning models return
        // private chain-of-thought in reasoning_content while final content is
        // empty; serialising the raw response would leak it into UI/logs.
        throw new Error(`AI 返回为空（finish_reason=${fr}；未收到可提交的最终 content）`);
      }
      const usage = data?.usage || {};
      const inputTokens = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens) || 0);
      const outputTokens = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens) || 0);
      const totalTokens = Math.max(0, Number(usage.total_tokens) || inputTokens + outputTokens);
      if (totalTokens && wm.main && !wm.main.isDestroyed()) {
        bus.send(wm.main, 'factory:aiUsage', {
          requestId: req.id, model: String(model || ''), inputTokens, outputTokens, totalTokens,
          observedAt: new Date().toISOString(), sourceRef: `provider-response:${req.id}`,
        });
      }
      if (!detailed) return text.trim();
      const hasFinishReason = Object.prototype.hasOwnProperty.call(choice, 'finish_reason');
      const finishReason = hasFinishReason && choice.finish_reason != null
        ? (String(choice.finish_reason).trim() || null)
        : null;
      const completionKind = hasFinishReason
        ? (finishReason == null ? 'null-finish-reason' : 'finish-reason')
        : 'response-without-finish-reason';
      return {
        text: text.trim(), finishReason, completionKind,
        usage: totalTokens ? { inputTokens, outputTokens, totalTokens } : null,
        safeToCommit: classifyFactoryCompletion({ finishReason, completionKind }).safeToCommit,
      };
    } catch (error) {
      outcome = req.cancelled ? req.cancelReason : 'failed';
      if (req.cancelled && req.cancelReason !== 'timeout') return detailed ? {
        text: '', finishReason: null, completionKind: 'interrupted', usage: null, safeToCommit: false,
      } : null;
      if (req.cancelled && req.cancelReason === 'timeout') throw new Error('AI 请求超时（180 秒）');
      throw error;
    } finally {
      await req.close({ reason: outcome });
    }
  });
  // 模型列表：GET /v1/models（渲染层拉取会被 CORS 拦，主进程代理）
  bus.handle('factory:aiModels', async ({ baseURL, apiKey }) => {
    const url = aiModelsUrl(baseURL);
    const resp = await net.fetch(url, { headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {} });
    if (!resp.ok) throw new Error(await aiReadError(resp));
    return normalizeFactoryModelsResponse(await resp.json());
  });
  bus.handle('factory:aiCancel', async ({ requestId, reason = 'renderer-cancel' }, event) => ({
    cancelled: await factoryAiRequests.cancel(requestId, reason, { ownerId: String(event?.sender?.id || '') }),
  }));
  bus.handle('factory:runAcquire', async ({ runId, taskId }, event) => factoryRunOwners.acquire({
    runId, taskId, ownerId: bindFactoryOwner(event?.sender),
  }));
  bus.handle('factory:runRelease', async ({ runId, leaseId, reason = 'renderer-release' }, event) => factoryRunOwners.release({
    runId, leaseId, reason, ownerId: String(event?.sender?.id || ''),
  }));
  bus.handle('ingestion:registerText', async payload => ingestionPipeline.register(payload));
  bus.handle('feed:scan', async payload => feedPipeline.scan(payload));
  bus.handle('feed:scanW65', async payload => {
    const request = normalizeW65FeedRequest(payload);
    if (!torrentSites && process.env.MAZZ_E2E_W74B_FEED_FIXTURE !== '1') throw new Error('W65 Adapter 尚未就绪');
    const fixtureHash = '0123456789abcdef0123456789abcdef01234567';
    const search = process.env.MAZZ_E2E_W74B_FEED_FIXTURE === '1'
      ? {
        perSite: Object.fromEntries(request.sites.map((siteId, index) => [siteId, {
          rows: [{
            title: index ? '[字幕组] 发布工程跨源样本 1080p' : '发布工程跨源样本',
            sourceSite: siteId,
            sourceUrl: `https://example.test/${siteId}/${fixtureHash}`,
            infoHash: fixtureHash,
            date: '2026-08-19 09:00',
            size: '1.2 GB',
            subgroup: index ? '样本站二' : '样本站一',
            seeders: 12 + index,
          }], error: '', sourceMode: 'e2e-fixture',
        }])),
      }
      : await torrentSites.searchMany({ sites: request.sites, kw: request.query, maxPages: request.maxPages });
    const sourceBatches = request.sites.map(sourceId => ({
      sourceId,
      sourceType: 'subscription',
      items: (search.perSite?.[sourceId]?.rows || []).map((row, index) => {
        const publishedMs = Date.parse(String(row.date || ''));
        return {
          itemId: String(row.infoHash || row.sourceUrl || `${sourceId}:${index}`),
          title: String(row.title || '未命名外部条目'),
          url: String(row.sourceUrl || ''),
          publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : request.observedAt,
          summary: [row.subgroup, row.size, Number.isInteger(row.seeders) ? `做种 ${row.seeders}` : ''].filter(Boolean).join(' · '),
          canonicalKey: row.infoHash ? `infohash:${String(row.infoHash).toLowerCase()}` : String(row.sourceUrl || ''),
        };
      }),
    }));
    const sourceStatus = request.sites.map(sourceId => ({
      sourceId,
      ok: !search.perSite?.[sourceId]?.error,
      mode: String(search.perSite?.[sourceId]?.sourceMode || ''),
      itemCount: sourceBatches.find(batch => batch.sourceId === sourceId)?.items.length || 0,
      error: String(search.perSite?.[sourceId]?.error || '').slice(0, 240),
    }));
    if (sourceStatus.every(status => !status.ok)) {
      const error = new Error(`W65 四站本轮均不可用：${sourceStatus.map(status => `${status.sourceId}=${status.error || 'unknown'}`).join('；')}`);
      error.code = 'W74B_ALL_SOURCES_UNAVAILABLE';
      throw error;
    }
    const result = await feedPipeline.scan({
      schema: 'mazz.feed-scan-request/v0',
      projectId: request.projectId,
      projectPath: request.projectPath,
      query: request.query,
      dimension: request.dimension,
      mode: request.mode,
      windowHours: request.windowHours,
      observedAt: request.observedAt,
      sourceBatches,
    });
    return { ...result, sourceStatus };
  });
  bus.handle('feed:decide', async payload => feedPipeline.decide(payload));
  bus.handle('feed:list', async ({ projectPath } = {}) => feedPipeline.list(projectPath));
  bus.handle('feedSource:register', async payload => {
    if (!continuousFeed) throw new Error('W62e 持续投喂服务尚未就绪');
    return continuousFeed.register(payload);
  });
  bus.handle('feedSource:remove', async payload => {
    if (!continuousFeed) throw new Error('W62e 持续投喂服务尚未就绪');
    return continuousFeed.remove(payload);
  });
  bus.handle('feedSource:list', async ({ projectPath } = {}) => {
    if (!continuousFeed) throw new Error('W62e 持续投喂服务尚未就绪');
    return continuousFeed.list(projectPath);
  });
  bus.handle('feedSource:run', async payload => {
    if (!continuousFeed) throw new Error('W62e 持续投喂服务尚未就绪');
    return continuousFeed.run(payload);
  });
  bus.handle('feedSource:startAll', async ({ projectPath } = {}) => {
    if (!continuousFeed) throw new Error('W62e 持续投喂服务尚未就绪');
    return continuousFeed.startAll(projectPath);
  });
  bus.handle('feedSource:health', async () => continuousFeed?.health() || { schema: 'mazz.continuous-feed-health/v0', scheduledSources: [], watchedSources: [], runningSources: [] });
  bus.handle('promotion:promoteConversation', async payload => promotionLedger.promoteConversation(payload, ingestionPipeline));
  bus.handle('promotion:reviewConversationCandidate', async payload => promotionLedger.reviewStructuredConversationCandidate(payload, ingestionPipeline));
  bus.handle('promotion:listManagement', async payload => promotionLedger.listManagement(payload));
  bus.handle('promotion:revoke', async payload => promotionLedger.revokePromotion(payload));
  bus.handle('promotion:manageEvidenceProjection', async payload => promotionLedger.manageEvidenceProjection(payload));
  // 流式：SSE 逐 delta 广播 factory:aiChunk {requestId, delta}，结束推 done，出错推 error
  bus.handle('factory:aiChatStream', async ({ requestId, providerId, role, baseURL, apiKey, model, system, user, temperature = 0.7 }, event) => {
    const req = factoryAiRequests.begin(requestId, {
      kind: 'stream', timeoutMs: factoryTimeout('MAZZ_E2E_FACTORY_STREAM_TIMEOUT_MS', 300000), model,
      ownerId: bindFactoryOwner(event?.sender),
    });
    const push = (payload) => { if (!req.cancelled && wm.main && !wm.main.isDestroyed()) bus.send(wm.main, 'factory:aiChunk', { requestId, ...payload }); };
    let outcome = 'completed';
    try {
      const mocked = factoryMockReply({ system, user, stream: true });
      if (mocked != null) {
        const mockDelay = Math.max(0, Math.min(1000, Number(process.env.MAZZ_E2E_FACTORY_DELAY_MS) || 0));
        for (let i = 0; i < mocked.length; i += 120) {
          if (req.cancelled) break;
          push({ delta: mocked.slice(i, i + 120) });
          if (mockDelay) await new Promise(resolve => setTimeout(resolve, mockDelay));
        }
        const completion = req.cancelled
          ? { finishReason: null, completionKind: 'interrupted', usage: null, safeToCommit: false }
          : { finishReason: 'stop', completionKind: 'mock-stop', usage: null, safeToCommit: true };
        if (!req.cancelled) push({ done: true, ...completion });
        return { ok: !req.cancelled, cancelled: req.cancelled, reason: req.cancelReason, ...completion };
      }
      const resp = await net.fetch(aiUrl(baseURL), {
        method: 'POST', headers: aiHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
          temperature, stream: true,
        }),
        signal: req.signal,
      });
      if (!resp.ok) throw new Error(await aiReadError(resp));
      const reader = resp.body.getReader();
      req.attachReader(reader);
      let reportedUsage = null;
      const sse = new FactorySseDecoder({ onDelta: delta => push({ delta }), onUsage: usage => { reportedUsage = usage; } });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse.push(value);
      }
      const completion = sse.finish();
      if (reportedUsage && wm.main && !wm.main.isDestroyed()) {
        bus.send(wm.main, 'factory:aiUsage', {
          requestId, model: String(model || ''), ...reportedUsage,
          observedAt: new Date().toISOString(), sourceRef: `provider-stream:${requestId}`,
        });
      }
      const classified = classifyFactoryCompletion(completion);
      const final = {
        finishReason: completion.finishReason,
        completionKind: completion.completionKind,
        usage: completion.usage,
        safeToCommit: completion.safeToCommit === true && classified.safeToCommit,
      };
      push({ done: true, ...final });
      return { ok: true, ...final, deltaCount: completion.deltaCount };
    } catch (e) {
      outcome = req.cancelled ? req.cancelReason : 'failed';
      if (!req.cancelled) push({ error: e.message || String(e) });
      return {
        ok: false,
        cancelled: req.cancelled,
        reason: req.cancelReason,
        finishReason: null,
        completionKind: req.cancelled ? 'interrupted' : 'error',
        usage: null,
        safeToCommit: false,
      };
    } finally {
      await req.close({ reason: outcome });
    }
  });

  // —— 系统集成：开机自启（默认关闭）+ 桌面快捷方式 ——
  // —— W58 工具链探测（全语言运行体系：运行前探测，缺失人话提示绝不静默） ——
  try { const Toolchain = require('./toolchain'); new Toolchain({ bus }); } catch (e) { console.error('[toolchain] 装配失败:', e.message); }

  bus.handle('app:getAutoLaunch', async () => app.getLoginItemSettings().openAtLogin);
  bus.handle('app:graphicsMode', async () => ({ ...GRAPHICS_MODE }));
  bus.handle('app:setAutoLaunch', async ({ enabled }) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return !!enabled;
  });
  bus.handle('app:createDesktopShortcut', async () => {
    if (process.platform !== 'win32') throw new Error('当前平台暂不支持（仅 Windows）');
    const desktop = app.getPath('desktop');
    const lnkPath = path.join(desktop, 'Mazz Editor.lnk');
    const target = process.execPath;
    const args = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}');$s.TargetPath='${target.replace(/'/g, "''")}';$s.Arguments='${args}';$s.WorkingDirectory='${path.dirname(target).replace(/'/g, "''")}';$s.IconLocation='${(app.isPackaged ? target : path.join(app.getAppPath(), 'resources', 'icons', 'app.ico')).replace(/'/g, "''")},0';$s.Description='Mazz Editor';$s.Save()`;
    await new Promise((resolve, reject) => {
      require('child_process').execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (e, so, se) =>
        e ? reject(new Error(String(se || e.message).slice(0, 200))) : resolve());
    });
    return fs.existsSync(lnkPath);
  });

  bus.handle('factory:pandocAvailable', async () => !!(await findPandoc()));
  // 提取文件纯文本（docx/odt/rtf/html/epub → plain；txt/md 渲染层自读）
  bus.handle('factory:extractText', async ({ path: srcPath }) => {
    if (!srcPath || typeof srcPath !== 'string') throw new Error('缺 path');
    return await runPandoc([toSlash(srcPath), '-t', 'plain', '--wrap=none']);
  });
  // markdown 文本 → 指定格式导出到目标路径（返回输出路径）
  bus.handle('factory:pandocExport', async ({ markdown, to, outPath, title }) => {
    if (!outPath || typeof outPath !== 'string') throw new Error('缺 outPath');
    const args = ['-f', 'markdown', '-t', to === 'docx' ? 'docx' : to, '-o', toSlash(outPath)];
    if (title) args.push('--metadata', `title=${title}`);
    if (to === 'epub') args.push('--metadata', 'lang=zh-CN');
    await runPandoc(args, String(markdown ?? ''));
    return toSlash(outPath);
  });

  // —— 密码管理器（safeStorage 系统级加密：Windows DPAPI / macOS Keychain / Linux keyring） ——
  // 红线：密文落盘，明文只在主进程内存中瞬时存在；渲染进程拿不到加密密钥
  const pwEncrypt = __pwEncrypt;
  const pwDecrypt = __pwDecrypt;
  bus.handle('pw:available', async () => safeStorage.isEncryptionAvailable());
  // —— 通用密钥存储（safeStorage 加密落盘，API Key 等通用机密专用）——
  bus.handle('secret:set', async ({ key, value }) => {
    const secrets = store.get('secrets', {});
    if (value == null || value === '') delete secrets[key];
    else secrets[key] = pwEncrypt(value);
    store.set('secrets', secrets);
    return true;
  });
  bus.handle('secret:get', async ({ key }) => {
    const secrets = store.get('secrets', {});
    if (!secrets[key]) return null;
    return pwDecrypt(secrets[key]);
  });
  bus.handle('pw:list', async () =>
    (store.get('passwords', [])).map(e => ({
      id: e.id, site: e.site, username: e.username, note: e.note,
      updatedAt: e.updatedAt, enc: !!e.password?.enc,
      password: pwDecrypt(e.password),
    })));
  bus.handle('pw:save', async ({ entry }) => {
    if (!entry || typeof entry !== 'object') return null;
    const list = store.get('passwords', []);
    const item = {
      id: entry.id || 'pw' + Date.now().toString(36),
      site: String(entry.site || '').trim(),
      username: String(entry.username || '').trim(),
      note: String(entry.note || ''),
      updatedAt: Date.now(),
      password: pwEncrypt(entry.password || ''),
    };
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) list[idx] = item; else list.push(item);
    store.set('passwords', list);
    return item.id;
  });
  bus.handle('pw:delete', async ({ id }) => {
    store.set('passwords', (store.get('passwords', [])).filter(x => x.id !== id));
    return true;
  });
  bus.handle('workspace:get', async () => {
    const ws = store.get('workspace');
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.join(ws, '\u6BCF\u65E5\u7B14\u8BB0'), { recursive: true });
    return toSlash(ws);
  });

  // —— 多工作区：列表 + 当前 + 增删 + 切换（思源笔记本制；切换时 watcher 跟随） ——
  const wsList = () => {
    const cur = store.get('workspace');
    const list = store.get('workspaces', []);
    if (!list.find(w => w.path === cur)) list.unshift({ path: cur, name: cur.split(/[\\/]/).pop() || '工作区' });
    return { current: toSlash(cur), list: list.map(w => ({ path: toSlash(w.path), name: w.name })) };
  };
  bus.handle('workspace:list', async () => wsList());
  bus.handle('workspace:add', async ({ path: p, name }) => {
    if (!p || !fs.existsSync(p)) throw new Error('目录不存在');
    const list = store.get('workspaces', []);
    if (!list.find(w => w.path === p)) list.push({ path: p, name: name?.trim() || p.split(/[\\/]/).pop() });
    store.set('workspaces', list);
    return wsList();
  });
  bus.handle('workspace:remove', async ({ path: p }) => {
    if (p === store.get('workspace')) throw new Error('不能移除当前工作区（先切换到别的）');
    store.set('workspaces', store.get('workspaces', []).filter(w => w.path !== p));
    return wsList();
  });
  bus.handle('workspace:rename', async ({ path: p, name }) => {
    const list = store.get('workspaces', []);
    const w = list.find(x => x.path === p);
    if (w) {
      w.name = name?.trim() || w.name;
    } else {
      // 当前工作区可能只是 wsList 临时 unshift 的“未登记”项——改名必须落登记簿，否则静默无效（E2E 实抓）
      list.push({ path: p, name: name?.trim() || p.split(/[\\/]/).pop() });
    }
    store.set('workspaces', list);
    // 广播刷新：侧栏下拉只在 workspace:changed 时重渲染（此前漏广播，改名后下拉不同步——E2E 边边角角批实抓）
    wm.broadcastShells('workspace:changed', { path: toSlash(store.get('workspace')) });
    return wsList();
  });
  bus.handle('workspace:setCurrent', async ({ path: p }) => {
    if (!p || !fs.existsSync(p)) throw new Error('目录不存在');
    if (pendingHandoffTransactions.size) {
      const error = new Error('标签跨窗口移交期间暂不能切换工作区');
      error.code = 'WORKSPACE_HANDOFF_IN_PROGRESS';
      throw error;
    }
    // Player durable sessions are Workspace-scoped.  Rebind the transport
    // daemon before publishing the new current Workspace so old jobs cannot
    // leak into the next library or restart under the wrong root.
    if (torrentDaemon?.switchWorkspace) await torrentDaemon.switchWorkspace(p);
    store.set('workspace', p);
    addressableEvidence.invalidate();
    // watcher 跟随：重挂全部监听（旧目录文件变化不再打扰）
    try { watcher.watcher?.close(); watcher.watcher = null; watcher.watched?.clear?.(); } catch {}
    wm.broadcastShells('workspace:changed', { path: toSlash(p) });
    return toSlash(p);
  });

  // —— 窗口 ——
  // W52③ 主窗杀手平反：窗控三句柄按调用者窗口落（fromWebContents——子窗/面板的 ✕ 不再灭主窗；
  // 此前硬编码 wm.main，面板 ✕ 一点主窗即死（E2E 级联实锤，真机同雷）
  const callerWin = (event) => BrowserWindow.fromWebContents(event?.sender) || wm.main;
  bus.handle('window:minimize', async (payload, event) => {
    const w = callerWin(event);
    if (w?.isFullScreen()) w.setFullScreen(false); // 全屏态先退出（系统覆盖层会吃自绘钮）
    w?.minimize();
  });
  bus.handle('window:toggleMaximize', async (payload, event) => {
    const w = callerWin(event);
    if (!w) return false;
    if (w.isFullScreen()) { w.setFullScreen(false); return true; } // 全屏下「最大化」= 退出全屏
    w.isMaximized() ? w.unmaximize() : w.maximize();
    return w.isMaximized();
  });
  bus.handle('window:isFullScreen', async (payload, event) => !!callerWin(event)?.isFullScreen());
  bus.handle('window:close', async (payload, event) => {
    const w = callerWin(event);
    if (w?.isFullScreen()) w.setFullScreen(false); // 先退全屏再关，避免覆盖层吃事件
    w?.close();
  });
  bus.handle('window:setTitle', async ({ title }, event) => callerWin(event)?.setTitle(title));
  bus.handle('window:isMaximized', async (payload, event) => !!callerWin(event)?.isMaximized());
  bus.handle('window:toggleFullScreen', async (payload, event) => {
    const w = callerWin(event);
    if (!w) return false;
    const next = !w.isFullScreen();
    w.setFullScreen(next);
    return next;
  });

  // 分窗交接必须由目标 renderer 明确收讫后，源窗才允许删除本地标签。
  // 这不是通用 Event Bus，只是一条有 timeout / owner 校验的单用途两阶段提交。
  const pendingHandoffs = new Map();
  const pendingHandoffTransactions = new Map();
  const deliverHandoff = (target, handoff, { afterLoad = false } = {}) => new Promise(resolve => {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) { resolve(false); return; }
    const transferId = require('crypto').randomUUID();
    let settled = false;
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      pendingHandoffs.delete(transferId);
      try { target.webContents.removeListener('destroyed', onGone); } catch {}
      try { target.webContents.removeListener('render-process-gone', onGone); } catch {}
    };
    const finish = ok => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(!!ok);
    };
    const onGone = () => finish(false);
    const send = () => {
      if (target.isDestroyed() || target.webContents.isDestroyed()) { finish(false); return; }
      target.webContents.send('mazz:event', {
        channel: 'window:handoff', payload: { ...handoff, __transferId: transferId },
      });
    };
    pendingHandoffs.set(transferId, { targetId: target.webContents.id, finish });
    target.webContents.once('destroyed', onGone);
    target.webContents.once('render-process-gone', onGone);
    timer = setTimeout(() => finish(false), 12000);
    if (afterLoad) target.webContents.once('did-finish-load', () => setTimeout(send, 600));
    else send();
  });
  const settleHandoffTransaction = (record, { closeOwned = false } = {}) => {
    if (!record || record.settled) return;
    record.settled = true;
    clearTimeout(record.expiry);
    record.awaiting?.finish(false);
    record.awaiting = null;
    pendingHandoffTransactions.delete(record.transferId);
    try { record.target.webContents.removeListener('destroyed', record.onTargetGone); } catch {}
    try { record.target.webContents.removeListener('render-process-gone', record.onTargetGone); } catch {}
    try { record.source?.removeListener('destroyed', record.onSourceGone); } catch {}
    try { record.source?.removeListener('render-process-gone', record.onSourceGone); } catch {}
    if (closeOwned && record.ownedTarget && !record.target.isDestroyed()) {
      try { record.target.close(); } catch {}
    }
  };

  const sendHandoffPhase = (record, phase) => new Promise(resolve => {
    if (!record || record.settled || record.target.isDestroyed()
        || record.target.webContents.isDestroyed() || record.awaiting) {
      resolve(false);
      return;
    }
    let settled = false;
    let timer = null;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (record.awaiting?.phase === phase) record.awaiting = null;
      resolve(!!ok);
    };
    record.awaiting = { phase, finish };
    record.lastPhaseTimeout = null;
    timer = setTimeout(() => {
      record.lastPhaseTimeout = phase;
      finish(false);
    }, 12000);
    record.target.webContents.send('mazz:event', {
      channel: 'window:handoff',
      payload: phase === 'prepare'
        ? { ...record.handoff, __transferId: record.transferId, __handoffPhase: phase }
        : { __transferId: record.transferId, __handoffPhase: phase },
    });
  });

  const rollbackHandoffTransaction = async (record, { closeOwned = true } = {}) => {
    if (!record || record.settled) return false;
    clearTimeout(record.expiry);
    // Cancel an outstanding prepare/commit wait before issuing rollback. The
    // target reserves the provisional record synchronously, so rollback can
    // safely overtake a slow parser without leaving a late-created ghost.
    record.awaiting?.finish(false);
    await Promise.resolve();
    if (!record.target.isDestroyed() && !record.target.webContents.isDestroyed()) {
      await sendHandoffPhase(record, 'rollback').catch(() => false);
    }
    if (record.targetTabId) {
      try {
        if (!crashRecovery?.clearOwnedSnapshot(record.targetTabId, record.targetId)) {
          throw new Error('target recovery owner could not be retired');
        }
      }
      catch (error) {
        console.error('[handoff] target rollback recovery retirement failed:', error?.message || error);
        return false;
      }
    }
    settleHandoffTransaction(record, { closeOwned });
    return true;
  };

  const prepareHandoffTransaction = async (target, handoff, {
    afterLoad = false, source = null, ownedTarget = false,
  } = {}) => {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return { ok: false };
    const transferId = require('crypto').randomUUID();
    const record = {
      transferId, target, targetId: target.webContents.id,
      source, sourceId: source?.id || null, handoff, ownedTarget,
      stage: 'preparing', awaiting: null, expiry: null, settled: false,
    };
    record.onTargetGone = () => settleHandoffTransaction(record, { closeOwned: false });
    record.onSourceGone = () => {
      if (record.sourceRecoveryRetired) return;
      void rollbackHandoffTransaction(record, { closeOwned: true });
    };
    pendingHandoffTransactions.set(transferId, record);
    target.webContents.once('destroyed', record.onTargetGone);
    target.webContents.once('render-process-gone', record.onTargetGone);
    source?.once('destroyed', record.onSourceGone);
    source?.once('render-process-gone', record.onSourceGone);
    if (afterLoad) {
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        target.webContents.once('did-finish-load', () => setTimeout(finish, 600));
        setTimeout(finish, 12000);
      });
      if (record.settled) return { ok: false };
    }
    const ok = await sendHandoffPhase(record, 'prepare');
    if (!ok) {
      await rollbackHandoffTransaction(record, { closeOwned: true });
      return { ok: false };
    }
    record.stage = 'prepared';
    // A vanished/frozen source may not strand an invisible provisional owner.
    record.expiry = setTimeout(() => { void rollbackHandoffTransaction(record, { closeOwned: true }); }, 30000);
    return { ok: true, transferId };
  };

  bus.handle('window:handoffAck', async ({ transferId, phase, ok, targetTabId } = {}, event) => {
    const transaction = pendingHandoffTransactions.get(transferId);
    if (transaction) {
      if (transaction.targetId !== event?.sender?.id) return false;
      if (targetTabId) transaction.targetTabId = String(targetTabId);
      const awaiting = transaction.awaiting;
      if (!awaiting || (phase && awaiting.phase !== phase)) return false;
      transaction.lastPhaseTimeout = null;
      awaiting.finish(ok);
      return true;
    }
    const pending = pendingHandoffs.get(transferId);
    if (!pending || pending.targetId !== event?.sender?.id) return false;
    pending.finish(ok);
    return true;
  });

  bus.handle('window:handoffCommit', async ({ transferId } = {}, event) => {
    const record = pendingHandoffTransactions.get(transferId);
    if (!record || record.settled || record.sourceId !== event?.sender?.id || record.stage !== 'prepared') return false;
    clearTimeout(record.expiry);
    record.stage = 'committing';
    const ok = await sendHandoffPhase(record, 'commit');
    if (!ok) {
      await rollbackHandoffTransaction(record, { closeOwned: true });
      return false;
    }
    // Target recovery is now strict and durable while still inert. Retire the
    // exact source-owner snapshot in main before publication; a renderer crash
    // can no longer resurrect both owners.
    try {
      if (!crashRecovery?.clearOwnedSnapshot(record.handoff?.sourceTabId, record.sourceId)) {
        throw new Error('source recovery owner could not be retired');
      }
      record.sourceRecoveryRetired = true;
    } catch (error) {
      console.error('[handoff] source recovery retirement failed:', error?.message || error);
      await rollbackHandoffTransaction(record, { closeOwned: true });
      return false;
    }
    record.stage = 'publish-ready';
    // Finalize is idempotent in the target. A timeout is ambiguous (the target
    // may have published and only lost its ACK), so retry until an explicit
    // response or target death instead of ever restoring a second live owner.
    const published = await publishIdempotently({
      record,
      send: () => sendHandoffPhase(record, 'finalize'),
      isAlive: () => !record.target.isDestroyed() && !record.target.webContents.isDestroyed(),
    });
    if (!published) {
      // Ownership became irreversible when the source recovery owner was
      // retired. The target's durable precommit is now the only recovery
      // material, so never resurrect a second source even if its renderer died
      // before acknowledging the idempotent publish.
      settleHandoffTransaction(record, { closeOwned: false });
      return true;
    }
    record.stage = 'committed';
    settleHandoffTransaction(record, { closeOwned: false });
    if (!record.target.isDestroyed()) {
      if (record.ownedTarget) {
        record.target.once('show', () => visualComposition.refreshHost?.(record.target, 'child-handoff-committed'));
        if (typeof record.target.__showAfterHandoff === 'function') record.target.__showAfterHandoff();
        else { record.target.show(); record.target.focus(); }
      } else {
        record.target.show();
        record.target.focus();
      }
    }
    return true;
  });

  bus.handle('window:handoffRollback', async ({ transferId } = {}, event) => {
    const record = pendingHandoffTransactions.get(transferId);
    if (!record || record.settled || record.sourceId !== event?.sender?.id) return false;
    return rollbackHandoffTransaction(record, { closeOwned: true });
  });

  // 分窗：开新窗口并交接标签快照
  bus.handle('window:openChild', async ({ handoff, transactional = false } = {}, event) => {
    // W53：lean 路线退役（七面板+坞浮动全走 panel-windows 全原生子窗格）——openChild 只服务模块分窗
    const child = wm.createChild({ deferShow: !!handoff?.moduleId });
    child.webContents.once('did-finish-load', () => {
      child.webContents.send('mazz:event', { channel: 'window:role', payload: { role: 'child' } });
    });
    // 兼容“只创建空工作台分窗”的既有调用；没有数据要提交时无需 ACK。
    if (!handoff?.moduleId) return true;
    if (transactional) {
      return prepareHandoffTransaction(child, handoff, {
        afterLoad: true,
        source: event?.sender || null,
        ownedTarget: true,
      });
    }
    const ok = await deliverHandoff(child, handoff, { afterLoad: true });
    if (ok && !child.isDestroyed()) {
      // ACK 表示目标 renderer 已恢复标签，并完成 Browser Surface 的宿主迁移。
      // ACK 与 ready-to-show 两边都满足后才允许显示，消灭“先裸壳、后原生视图”的白帧。
      child.once('show', () => visualComposition.refreshHost?.(child, 'child-handoff-ready'));
      if (typeof child.__showAfterHandoff === 'function') child.__showAfterHandoff();
      else { child.show(); child.focus(); }
    } else if (!child.isDestroyed()) child.close();
    return ok;
  });
  // 已存在子窗口清单（「移到已有外部窗格」选单用）
  bus.handle('window:listChildren', async () => {
    const out = [];
    for (const child of wm.children) {
      if (!child.isDestroyed()) out.push({ id: child.id, title: child.getTitle?.() || '' });
    }
    return out;
  });
  // 屏幕坐标命中的子窗口（拖标签进既有外部窗格的判定）
  bus.handle('window:childAt', async ({ x, y }) => {
    for (const child of wm.children) {
      if (child.isDestroyed()) continue;
      const b = child.getBounds();
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return { id: child.id };
    }
    return null;
  });
  // 标签快照转发到既有子窗口（不新建窗口）
  bus.handle('window:toChild', async ({ winId, handoff, transactional = false } = {}, event) => {
    for (const child of wm.children) {
      if (child.id === winId && !child.isDestroyed()) {
        if (transactional) {
          return prepareHandoffTransaction(child, handoff, {
            source: event?.sender || null,
            ownedTarget: false,
          });
        }
        child.show(); child.focus();
        return deliverHandoff(child, handoff);
      }
    }
    return false;
  });
  // 主题广播：主窗换主题 → 全部子窗口跟随（v33 外部窗格不同步根因）
  bus.handle('theme:broadcast', async ({ id, vars }) => {
    for (const child of wm.children) {
      if (!child.isDestroyed()) child.webContents.send('mazz:event', { channel: 'theme:changed', payload: { id, vars } });
    }
    PanelWindows.broadcastTheme(id, vars); // W47：面板窗（收藏/密码/工具坞）同跟随主界面主题；W58c：vars 快照随播——自定义/主题包下子窗不再透明裸奔
    if (wm.quickNote && !wm.quickNote.isDestroyed()) {
      wm.quickNote.webContents.send('mazz:event', { channel: 'theme:changed', payload: { id, vars } });
      try { wm.quickNote.setBackgroundColor(wm.themeBg()); } catch {}
    }
    for (const child of wm.children) { try { if (!child.isDestroyed()) child.setBackgroundColor(wm.themeBg()); } catch {} }
    for (const bvs of BrowserViews.all) bvs.rethemeAllDevTools(id); // W52④：开着 devtools 也实时换主题（静态注册表——局部 const 跨函数引用必 ReferenceError，真机实锤）
    // W52e：应用主题映射 nativeTheme（运行时，不落 store 不覆盖用户 themeSource 设置）——
    // devtools/原生件跟随的唯一活路：uiTheme localStorage 键 Chromium 已不读（探针实锤 body 纹丝不动）
    try {
      if (['ink', 'indigo', 'moss'].includes(id)) nativeTheme.themeSource = 'dark';
      else if (['paper', 'sand', 'construct'].includes(id)) nativeTheme.themeSource = 'light';
    } catch {}
    // W52：主窗底色实时跟随（setBackgroundColor 即时生效——拖拽闪主题色不闪刺白）
    try { wm.main?.setBackgroundColor(wm.themeBg()); } catch {}
    return true;
  });
  // 移回主窗口：子窗标签快照转发主窗
  bus.handle('window:toMain', async ({ handoff, transactional = false } = {}, event) => {
    if (wm.main && !wm.main.isDestroyed()) {
      if (transactional) {
        return prepareHandoffTransaction(wm.main, handoff, {
          source: event?.sender || null,
          ownedTarget: false,
        });
      }
      wm.main.show(); wm.main.focus();
      return deliverHandoff(wm.main, handoff);
    }
    return false;
  });

  // —— 主题跟随（nativeTheme）——
  bus.handle('theme:setSource', async ({ source }) => {
    nativeTheme.themeSource = source || 'system';
    store.set('themeSource', source);
    return nativeTheme.shouldUseDarkColors;
  });
  bus.handle('theme:isDark', async () => nativeTheme.shouldUseDarkColors);

  // —— 打印双路径 ——
  bus.handle('print:print', async () => {
    if (!wm.main) return false;
    return new Promise((resolve) => {
      wm.main.webContents.print({ printBackground: true, silent: false }, (ok, reason) => {
        if (!ok) console.warn('[print] failed:', reason);
        resolve(ok);
      });
    });
  });
  // —— 屏幕录制：源枚举 + getDisplayMedia 许可队列（模块级共享，hookDisplayMedia 消费）——
  // —— mazz-res:// 资源协议处理器：映射 renderer/dist 静态资产（worker/wasm/字体等，仅限该目录防穿越） ——
  mazzResHandler = async (req) => {
    try {
      // 自定义协议 URL 首段是 host 不是 path：mazz-res://lib/x → host=lib（丢段 404 实锤）——host+pathname 拼回全路径
      const u = new URL(req.url);
      if (u.host === 'artifact') {
        const token = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        const opened = await capabilityExecutionService.openArtifactGrant(token);
        if (req.method === 'HEAD') opened.stream.destroy();
        const body = req.method === 'HEAD' ? null : Readable.toWeb(opened.stream);
        return new Response(body, { status: 200, headers: {
          'Content-Type': opened.mediaType,
          'Content-Length': String(opened.size),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'same-origin',
        } });
      }
      if (u.host === 'canvas-artifact') {
        const token = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        const opened = await canvasDocumentService.openExportGrant(token);
        if (req.method === 'HEAD') opened.stream.destroy();
        const body = req.method === 'HEAD' ? null : Readable.toWeb(opened.stream);
        return new Response(body, { status: 200, headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Length': String(opened.size),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'same-origin',
        } });
      }
      if (u.host === 'audio-artwork') {
        const artworkPath = audioArtworkPathFromResourceUrl(u);
        return serveAudioArtwork(artworkPath, { method: req.method, signal: req.signal });
      }
      const rel = decodeURIComponent(u.host + u.pathname).replace(/^\/+/, '');
      if (rel === 'fonts/fallback') return serveFont();
      // Mikan catalog covers: native <img loading=lazy> owns request lifetime.
      // Every redirect is revalidated, bytes/MIME are bounded, and renderer
      // removal aborts net.fetch through the protocol Request signal.
      if (rel.startsWith('catalog/')) {
        let target = canonicalCatalogImageUrl(rel.slice('catalog/'.length));
        if (!target) return new Response('forbidden catalog image', { status: 403 });
        let resp = null;
        for (let hop = 0; hop < 4; hop += 1) {
          resp = await net.fetch(target.href, {
            redirect: 'manual',
            signal: req.signal,
            headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
          });
          if (![301, 302, 303, 307, 308].includes(resp.status)) break;
          const redirectTarget = resolvedCatalogImageRedirect(target, resp.headers.get('location'));
          try { await resp.body?.cancel?.(); } catch {}
          target = redirectTarget;
          if (!target) return new Response('forbidden catalog redirect', { status: 403 });
          resp = null;
        }
        if (!resp) return new Response('too many catalog redirects', { status: 508 });
        if (!resp.ok) {
          try { await resp.body?.cancel?.(); } catch {}
          return new Response('catalog image unavailable', { status: resp.status });
        }
        const mime = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['image/avif', 'image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(mime)) {
          try { await resp.body?.cancel?.(); } catch {}
          return new Response('unsupported catalog image', { status: 415 });
        }
        const announced = Number(resp.headers.get('content-length') || 0);
        if (announced > CATALOG_IMAGE_MAX_BYTES) {
          try { await resp.body?.cancel?.(); } catch {}
          return new Response('catalog image too large', { status: 413 });
        }
        const reader = resp.body?.getReader();
        if (!reader) return new Response('catalog image unavailable', { status: 502 });
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > CATALOG_IMAGE_MAX_BYTES) {
            await reader.cancel('catalog image byte limit').catch(() => {});
            return new Response('catalog image too large', { status: 413 });
          }
          chunks.push(Buffer.from(value));
        }
        const body = Buffer.concat(chunks, total);
        return new Response(body, { headers: {
          'Content-Type': mime,
          'Content-Length': String(body.length),
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        } });
      }
      // W94Fc：播放器媒体与字幕只拿短时 capability，不把 loopback/path
      // 暴露给 renderer。协议层复用 WebTorrent File 的 Range 流，保持大文件
      // 恒定内存并让 video 元素自行发起后续 seek 请求。
      if (u.host === 'tor-cap') {
        const token = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        if (!torrentDaemon) return new Response('transport unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
        try {
          const opened = await torrentDaemon.openFileCapability(token, {
            range: req.headers.get('range') || '', method: req.method,
          });
          if (req.method === 'HEAD') opened.stream.destroy();
          const body = req.method === 'HEAD' ? null : Readable.toWeb(opened.stream);
          return new Response(body, { status: opened.status, headers: {
            ...opened.headers,
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Resource-Policy': 'same-origin',
          } });
        } catch (error) {
          const code = String(error?.code || '');
          const status = code.includes('EXPIRED') ? 410
            : code.includes('RANGE') ? 416
              : code.includes('WORKSPACE') ? 409
                : code.includes('INVALID') || code.includes('FORBIDDEN') ? 403 : 404;
          return new Response(error?.message || 'transport capability unavailable', { status, headers: { 'Cache-Control': 'no-store' } });
        }
      }
      // P2P 流代理：mazz-res://tor/127.0.0.1:{port}/{path} → webtorrent range 流端点
      // （播放器 CSP 不用动——mazz-res 已在白名单，页面对本地 HTTP 流全走这一口）
      if (rel.startsWith('tor/')) {
        const target = 'http://' + rel.slice(4);
        try {
          new URL(target);
          const headers = {};
          if (req.headers.get('range')) headers.range = req.headers.get('range');
          const resp = await net.fetch(target, { headers });
          // media 元素使用必须 ACAO/CORP（页面 mazz-res 同源化后同源直过，双保险）
          const h = new Headers(resp.headers);
          h.set('Access-Control-Allow-Origin', '*');
          h.set('Cross-Origin-Resource-Policy', 'cross-origin');
          return new Response(resp.body, { status: resp.status, headers: h });
        } catch { return new Response('bad tor url', { status: 400 }); }
      }
      // —— app/ 分支：主页面同源化（file:// 页面对 http/custom 媒体的请求在 browser 侧 media loader 被 file-access 闸零请求掐死（实锤）——
      //    结构性根治=页面与媒体同走 mazz-res 一源；映射 renderer/ 根（index.html/quicknote/styles/lib/dist，防穿越） ——
      if (rel.startsWith('app/')) {
        const base = path.join(__dirname, '..', 'renderer');
        const full = path.join(base, rel.slice(4));
        if (!full.startsWith(base)) return new Response('forbidden', { status: 403 });
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return new Response('not found: ' + rel, { status: 404 });
        const buf = fs.readFileSync(full);
        const APP_MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.bmp': 'image/bmp', '.wasm': 'application/wasm', '.otf': 'font/otf', '.ttf': 'font/ttf', '.ttc': 'font/collection', '.woff2': 'font/woff2' };
        const mime = APP_MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
        return new Response(buf, { headers: { 'Content-Type': mime, 'Content-Length': String(buf.length), 'Access-Control-Allow-Origin': '*' } });
      }
      // W62b：剪藏图片用工作区相对协议，不把本机盘符写进 Markdown；同步到另一台机器仍能显示。
      if (rel.startsWith('workspace/')) {
        const base = path.resolve(store.get('workspace'));
        const full = path.resolve(base, rel.slice('workspace/'.length));
        if (full !== base && !full.startsWith(base + path.sep)) return new Response('forbidden', { status: 403 });
        let stat;
        try { stat = fs.statSync(full); } catch { return new Response('not found', { status: 404 }); }
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return new Response('not found', { status: 404 });
        const ext = path.extname(full).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif' }[ext];
        if (!mime) return new Response('unsupported', { status: 415 });
        const buf = fs.readFileSync(full);
        return new Response(buf, { headers: { 'Content-Type': mime, 'Content-Length': String(buf.length), 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' } });
      }
      // W93G: Library-owned PDF endpoint. Unlike media/, the renderer cannot
      // smuggle an arbitrary absolute path: URL creation is current-Workspace
      // scoped, and every request revalidates the Workspace token plus physical
      // relative-path containment before opening the stream.
      if (rel.startsWith('library/')) {
        const remainder = rel.slice('library/'.length);
        const separator = remainder.indexOf('/');
        if (separator <= 0) return new Response('invalid library asset', { status: 400 });
        const token = remainder.slice(0, separator);
        const relativePath = remainder.slice(separator + 1);
        const workspace = store.get('workspace');
        const native = fs.realpathSync?.native;
        const physicalWorkspace = path.resolve(typeof native === 'function'
          ? native(path.resolve(workspace)) : fs.realpathSync(path.resolve(workspace)));
        if (token !== libraryWorkspaceToken(physicalWorkspace)) {
          return new Response('stale library workspace', { status: 409 });
        }
        let asset;
        try { asset = libraryWorkspaceConvergence.openReadableAsset(physicalWorkspace, relativePath); }
        catch (error) {
          return new Response(error?.code === 'LIBRARY_CONVERGENCE_ASSET_MISSING' ? 'not found' : 'forbidden', {
            status: error?.code === 'LIBRARY_CONVERGENCE_ASSET_MISSING' ? 404 : 403,
          });
        }
        const result = asset.createResponse({ range: req.headers.get('range') || '', method: req.method });
        const headers = {
          ...result.headers,
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        };
        return new Response(result.body ? Readable.toWeb(result.body) : null, { status: result.status, headers });
      }
      // —— media/ 分支：本地媒体文件 range 流（页面同源化后 file:// 视频反被拦——媒体全走协议同源自洽，
      //    连带白拿：同源 video 画 canvas 不污染（截图/GIF 录制命门）；range 206 是 mp4 非 faststart/seek 的命脉；
      //    任意绝对路径=设计意图（播放用户磁盘任意媒体，只读不写） ——
      if (rel.startsWith('media/')) {
        const filePath = rel.slice(6);
        let st;
        try { st = fs.statSync(filePath); } catch { return new Response('not found', { status: 404 }); }
        if (!st.isFile()) return new Response('not found', { status: 404 });
        const size = st.size;
        const ext = filePath.split('.').pop().toLowerCase();
        const MEDIA_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', pdf: 'application/pdf',
          html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', xml: 'application/xml', txt: 'text/plain', md: 'text/plain' }; // W58 文档族（html 预览档命门——缺了就是 octet-stream 触发下载而不渲染）
        const mime = MEDIA_MIME[ext] || 'application/octet-stream';
        // W58 文档族 utf-8 明码：无 <meta charset> 的中文 html 预览被按 Latin-1 解码=乱码（截图实锤）——text/* 与 json/xml/javascript 全带 charset
        const ct = /^(text\/|application\/(json|xml|javascript))/.test(mime) ? mime + '; charset=utf-8' : mime;
        const cors = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Accept-Ranges': 'bytes' };
        const range = req.headers.get('range');
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          let start = m && m[1] ? parseInt(m[1], 10) : null;
          let end = m && m[2] ? parseInt(m[2], 10) : null;
          if (start == null && end != null) { start = Math.max(0, size - end); end = size - 1; } // suffix 尾段（mp4 moov 在尾时 Chromium 必发）
          if (start == null) start = 0;
          if (end == null || end >= size) end = size - 1;
          if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${size}` } });
          const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
          return new Response(body, { status: 206, headers: { ...cors, 'Content-Type': ct, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
        }
        // 无 range 全文件流式（GB 级恒定内存，不整读）
        const body = Readable.toWeb(fs.createReadStream(filePath));
        return new Response(body, { status: 200, headers: { ...cors, 'Content-Type': ct, 'Content-Length': String(size) } });
      }
      const base = path.join(__dirname, '..', 'renderer', 'dist');
      const full = path.join(base, rel);
      if (!full.startsWith(base)) return new Response('forbidden', { status: 403 });
      console.warn('[mazz-res]', rel, fs.existsSync(full) ? 'hit' : 'miss');
      if (!fs.existsSync(full)) return new Response('not found: ' + rel, { status: 404 });
      const buf = fs.readFileSync(full);
      const mime = rel.endsWith('.wasm') ? 'application/wasm' : rel.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      // 带 COOP/COEP 跨域隔离头：Octopus 依赖 SharedArrayBuffer 起 wasm 与通信——
      // 隔离头缺席时 SAB undefined，Octopus 挂起在 SharedArrayBuffer 检测上静默死亡（三波实锤）
      const csp = "script-src 'self' blob: mazz-res: 'wasm-unsafe-eval'; worker-src 'self' blob: mazz-res:";
      return new Response(buf, { headers: {
        'Content-Type': mime, 'Content-Length': String(buf.length), 'Access-Control-Allow-Origin': '*',
        'Content-Security-Policy': csp,
        'Cross-Origin-Opener-Policy': 'same-origin', // COOP/COEP 跨域隔离：SharedArrayBuffer 解锁钥匙（Octopus wasm 命脉）
        'Cross-Origin-Embedder-Policy': 'require-corp',
      } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  };
  protocol.handle('mazz-res', mazzResHandler);

  // —— OS CJK 回退字体（字幕组排版命门：无 CJK 回退字体中文全灭；按平台取第一个在的） ——
  const readFallbackFont = () => {
    const candidates = process.platform === 'win32'
      ? ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc', 'C:/Windows/Fonts/Deng.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc', '/Library/Fonts/Arial Unicode.ttf']
        : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
          '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf'];
    for (const p of candidates) {
      try { return { buf: fs.readFileSync(p), name: path.basename(p) }; } catch {}
    }
    return null;
  };
  // 字体经 mazz-res://fonts/fallback 供 worker 取（blob:file:// URL 在 worker 内 XHR 被 CORS 掐=sans-serif 装载失败实锤）
  const serveFont = () => {
    const f = readFallbackFont();
    if (!f) return new Response('no font', { status: 404 });
    const mime = f.name.endsWith('.ttc') ? 'font/collection' : f.name.endsWith('.otf') ? 'font/otf' : 'font/ttf';
    return new Response(f.buf, { headers: { 'Content-Type': mime, 'Content-Length': String(f.buf.length), 'Access-Control-Allow-Origin': '*' } });
  };

  // —— 播放器字幕资产：subtitles-octopus（libass wasm）worker/wasm 字节 + OS CJK 回退字体（一次取齐） ——
  bus.handle('player:subAssets', async () => {
    const jd = (...f) => path.join(__dirname, '..', 'renderer', 'dist', 'lib', 'octopus', ...f);
    const readB64 = (p) => { try { return fs.readFileSync(p).toString('base64'); } catch { return null; } };
    // CJK 回退字体候选（字幕组排版命门：无 CJK 回退字体中文全灭；按平台取第一个在的）
    const fontCandidates = process.platform === 'win32'
      ? ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc', 'C:/Windows/Fonts/Deng.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc', '/Library/Fonts/Arial Unicode.ttf']
        : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
          '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf'];
    let fallbackFont = null;
    for (const p of fontCandidates) {
      const b64 = readB64(p);
      if (b64) { fallbackFont = { name: path.basename(p), base64: b64 }; break; }
    }
    return {
      workerJs: readB64(jd('subtitles-octopus-worker.js')),
      wasm: readB64(jd('subtitles-octopus-worker.wasm')),
      legacyWorkerJs: readB64(jd('subtitles-octopus-worker-legacy.js')),
      fallbackFont,
    };
  });

  bus.handle('rec:sources', async () => {
    recQueueShared.length = 0; // 新一轮枚举=新一轮会话：清掉陈旧授权，防串源错录
    const list = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 200 } });
    const out = list.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }));
    // Chromium desktopCapturer 枚举排除本进程窗口（防递归自指）——自录走 capturePage 专用通道，
    // 虚拟源置顶注入，让「录自己」成为可选项（全局内录选不到本软件的总根）
    try {
      if (wm.main && !wm.main.isDestroyed()) {
        const img = await wm.main.webContents.capturePage();
        const size = img.getSize();
        out.unshift({ id: 'mazz:self', name: `◆ Mazz 本软件窗口（自录 ${size.width}×${size.height}）`, thumb: img.resize({ width: 320 }).toDataURL() });
      }
    } catch {}
    return out;
  });
  // 自录抓帧：capturePage 周期帧（渲染端合成进录制画布）
  bus.handle('rec:selfFrame', async () => {
    try {
      if (!wm.main || wm.main.isDestroyed()) return null;
      const img = await wm.main.webContents.capturePage();
      return img.toPNG().toString('base64');
    } catch { return null; }
  });
  bus.handle('rec:useSource', async ({ id, audio }) => { recQueueShared.push({ id, audio: audio !== false }); return true; });
  // getDisplayMedia 许可处理器挂到主窗会话（窗口创建后由 hookDisplayMedia 安装）

  // —— 打印预览输出：离屏窗体加载分页 HTML，按精确纸张/四边距打印或导 PDF ——
  bus.handle('print:html', async ({ html, setup = {}, toPdf, defaultPath }) => {
    const mm2in = (mm) => (mm || 0) / 25.4;
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    wm.trackWindow(win, 'print-worker');
    // 大文档必须走临时文件：data: URL 有长度上限（字多的 csv/长文档直接 ERR_FAILED 崩掉离屏窗=「报错再起不能」总根）
    let tmpHtml = null;
    try {
      try {
        const os = require('os');
        tmpHtml = path.join(os.tmpdir(), 'mazz-print-' + Date.now().toString(36) + '.html');
        fs.writeFileSync(tmpHtml, html || '<html></html>', 'utf8');
        await win.loadFile(tmpHtml);
      } catch {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html || '<html></html>'));
      }
      await new Promise(r => setTimeout(r, 400));
      const mg = setup.margins && typeof setup.margins === 'object' ? setup.margins : { top: setup.margin ?? 25, right: setup.margin ?? 25, bottom: setup.margin ?? 25, left: setup.margin ?? 25 };
      const opts = {
        printBackground: true,
        landscape: setup.orientation === 'landscape',
        pageSize: setup.size || 'A4',
        margins: { marginType: 'custom', top: mm2in(mg.top), bottom: mm2in(mg.bottom), left: mm2in(mg.left), right: mm2in(mg.right) },
      };
      if (toPdf) {
        const data = await win.webContents.printToPDF(opts);
        let p = defaultPath;
        if (!p) {
          const r = await dialog.showSaveDialog(wm.main, { defaultPath: '文档.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
          if (r.canceled) return null;
          p = r.filePath;
        }
        fs.writeFileSync(p, data);
        return toSlash(p);
      }
      return await new Promise((resolve) => win.webContents.print(opts, (ok, reason) => resolve({ ok, reason })));
    } finally {
      win.destroy();
      if (tmpHtml) { try { fs.rmSync(tmpHtml, { force: true }); } catch {} } // 临时打印文件随清理
    }
  });

  bus.handle('print:toPDF', async ({ savePath, pageSize }) => {
    if (!wm.main) return null;
    const data = await wm.main.webContents.printToPDF({ printBackground: true, pageSize: pageSize || 'A4' });
    let target = savePath;
    if (!target) {
      const r = await dialog.showSaveDialog(wm.main, {
        defaultPath: '未命名.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (r.canceled) return null;
      target = r.filePath;
    }
    fs.writeFileSync(target, data);
    shell.showItemInFolder(target);
    return toSlash(target);
  });

  // —— 多格式剪贴板 ——
  bus.handle('clipboard:write', async ({ text, html, imagePath }) => {
    const payload = {};
    if (text != null) payload.text = text;
    if (html != null) payload.html = html;
    if (imagePath) { try { payload.image = require('electron').nativeImage.createFromPath(imagePath); } catch {} }
    clipboard.write(payload);
    return true;
  });
  bus.handle('clipboard:read', async () => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    hasImage: !clipboard.readImage().isEmpty(),
    formats: clipboard.availableFormats(),
  }));
  bus.handle('clipboard:readImagePNG', async () => {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toPNG().toString('base64');
  });

  // —— 系统通知 ——
  bus.handle('notify:show', async ({ title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
    return true;
  });

  // —— shell ——
  bus.handle('shell:showItemInFolder', async ({ path: p }) => { shell.showItemInFolder(p); return true; });
  bus.handle('shell:openPath', async ({ path: p }) => {
    const r = await shell.openPath(p); // 系统默认程序打开（查看器降级用）
    return r === '' ? true : r; // 非空字符串 = 错误描述
  });
  bus.handle('shell:openExternal', async ({ url }) => { await shell.openExternal(url); return true; });

  // —— 拼写检查 ——
  bus.handle('spell:setLanguages', async ({ langs }) => {
    try { wm.main?.webContents.session.setSpellCheckerLanguages(langs); store.set('spellcheckLanguages', langs); } catch (e) { return e.message; }
    return true;
  });
  bus.handle('spell:setEnabled', async ({ enabled }) => {
    wm.main?.webContents.session.setSpellCheckerEnabled(enabled);
    store.set('spellcheckEnabled', enabled);
    return true;
  });

  // —— 快速笔记 ——
  bus.handle('quicknote:save', async ({ text }) => {
    const ws = store.get('workspace');
    const target = store.get('quickNoteTarget', 'daily');
    const file = target === 'daily'
      ? path.join(ws, '\u6BCF\u65E5\u7B14\u8BB0', new Date().toISOString().slice(0, 10) + '.md')
      : path.join(ws, 'inbox.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const stamp = new Date().toTimeString().slice(0, 5);
    fs.appendFileSync(file, `\n- ${stamp} ${String(text).replace(/\n/g, '\n  ')}\n`);
    wm.broadcastShells('file:changed', { event: 'change', path: toSlash(file), at: Date.now() });
    return toSlash(file);
  });
  bus.handle('quicknote:close', async () => { wm.quickNote?.hide(); return true; });

  // —— 系统字体库（主进程读本机字体，三件套字体选择器取数）——
  bus.handle('app:fonts', async () => {
    const families = new Set();
    try {
      if (process.platform === 'win32') {
        // 写临时 ps1 执行（避开引号/编码坑）：InstalledFontCollection 全量读取（系统+用户+OT/TTC）
        const { execSync } = require('child_process');
        const os = require('os');
        const ps1 = path.join(os.tmpdir(), 'mazz-fonts.ps1');
        fs.writeFileSync(ps1,
          "Add-Type -AssemblyName System.Drawing\r\n" +
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\r\n" +
          "(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }\r\n",
          'utf8');
        try {
          const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`,
            { encoding: 'utf8', timeout: 10000 });
          for (const line of out.split(/\r?\n/)) {
            const name = line.trim();
            if (name) families.add(name);
          }
        } catch (e1) {
          // 兜底：扫字体目录（文件名近似家族名）
          try {
            const windir = process.env.WINDIR || 'C:\\Windows';
            for (const dir of [path.join(windir, 'Fonts'), path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')]) {
              if (!fs.existsSync(dir)) continue;
              for (const f of fs.readdirSync(dir)) {
                if (/\.(ttf|otf|ttc)$/i.test(f)) {
                  families.add(f.replace(/\.(ttf|otf|ttc)$/i, '').replace(/[-_]/g, ' '));
                }
              }
            }
          } catch {}
        }
      } else {
        const { execSync } = require('child_process');
        const out = execSync('fc-list : family 2>/dev/null | sort -u', { encoding: 'utf8', timeout: 5000 });
        for (const line of out.split('\n')) {
          const fam = line.split(',')[0].trim();
          if (fam) families.add(fam);
        }
      }
    } catch (e) { console.warn('[fonts] 系统字体读取失败:', e.message); }
    const common = ['微软雅黑', '黑体', '宋体', '仿宋', '楷体', '等线', '苹方-简', 'PingFang SC',
      'Segoe UI', 'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Consolas', 'Courier New'];
    for (const c of common) families.add(c);
    return [...families].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  });

  // —— 电源管理 ——
  let powerBlockerId = null;
  bus.handle('power:block', async ({ block }) => {
    if (block && powerBlockerId == null) powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    if (!block && powerBlockerId != null) { powerSaveBlocker.stop(powerBlockerId); powerBlockerId = null; }
    return true;
  });
  powerMonitor.on('resume', () => wm.broadcast('power:resumed', {}));

  // —— 原生右键菜单（拼写建议由主进程置顶注入）——
  bus.handle('menu:context', async ({ items, context }) => {
    if (!wm.main) return null;
    return new Promise((resolve) => {
      const toNative = (it) => {
        if (it.type === 'separator') return { type: 'separator' };
        const base = {
          label: it.label, enabled: it.enabled !== false,
          submenu: it.submenu ? it.submenu.map(toNative) : undefined,
          click: () => resolve(it.id),
        };
        if (it.submenu) delete base.click;
        return base;
      };
      const menu = Menu.buildFromTemplate(items.map(toNative));
      menu.popup({ window: wm.main, callback: () => resolve(null) });
    });
  });

  // —— 应用菜单栏同步（渲染进程命令注册表 → 原生 Menu）——
  bus.handle('appmenu:sync', async ({ template }) => { buildAppMenu(template || []); return true; });

  // —— 编辑器上下文菜单模型（渲染进程从命令注册表解析后推送；主进程拼写菜单消费）——
  bus.handle('menu:setModel', async ({ items }) => { editorMenuModel.items = items || []; return true; });
}

// ---------- Browser 内容证书异常处理：默认验证；只允许用户对网页显式选择继续 ----------
function hookCertificateErrors() {
  const trusted = new Set(store.get('trustedHosts', []));
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    let host = '';
    try { host = new URL(url).host; } catch {}
    if (!host) { event.preventDefault(); callback(false); return; }
    if (trusted.has(host)) {
      event.preventDefault();
      callback(true);
      return;
    }
    const choice = dialog.showMessageBoxSync(wm.main, {
      type: 'warning',
      title: '证书验证失败',
      message: `「${host}」的证书无法验证（${error}）`,
      detail: '可能是网络代理/安全软件拦截了 HTTPS。你可以：信任此站点（记住选择）/ 仅本次继续 / 拒绝。',
      buttons: ['信任此站点', '仅本次继续', '拒绝'],
      defaultId: 0, cancelId: 2,
    });
    if (choice === 0) {
      trusted.add(host);
      store.set('trustedHosts', [...trusted]);
      event.preventDefault(); callback(true);
    } else if (choice === 1) {
      event.preventDefault(); callback(true);
    } else {
      callback(false);
    }
  });
}

// 屏幕录制许可：主窗创建后安装 getDisplayMedia 处理器（registerChannels 里的 recQueue 闭环在此消费）
let recQueueShared = [];
function hookDisplayMedia() {
  const ses = wm.main?.webContents?.session;
  if (!ses) return;
  ses.setDisplayMediaRequestHandler((req, cb) => {
    const entry = recQueueShared.shift();
    const id = typeof entry === 'string' ? entry : entry?.id; // 兼容历史字符串项
    const wantAudio = typeof entry === 'object' && entry ? entry.audio !== false : true;
    const grant = (video) => cb(wantAudio ? { video, audio: 'loopback' } : { video }); // 尊重渲染端音频偏好（降级无声重试）
    if (!id) return grant(true);
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then(list => {
      const src = list.find(s => s.id === id) || list[0];
      grant(src);
    }).catch(() => grant(true));
  });
}

// 编辑器右键原生菜单：拼写建议置顶（Electron 内置 spellchecker）+ 编辑角色 + 命令注册表模型
let editorMenuModel = { items: [] };
function hookEditorContextMenu() {
  const wc = wm.main.webContents;
  wc.on('context-menu', (_e, params) => {
    const template = [];
    if (params.misspelledWord && params.isEditable) {
      const sugg = params.dictionarySuggestions.slice(0, 5);
      if (sugg.length) sugg.forEach(w => template.push({ label: w, click: () => wc.replaceMisspelling(w) }));
      else template.push({ label: '无拼写建议', enabled: false });
      template.push({ label: `将“${params.misspelledWord}”加入词典`, click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      template.push({ type: 'separator' });
    }
    const ef = params.editFlags || {};
    template.push(
      { label: '剪切', role: 'cut', enabled: !!ef.canCut },
      { label: '复制', role: 'copy', enabled: !!ef.canCopy },
      { label: '粘贴', role: 'paste', enabled: !!ef.canPaste },
      { label: '全选', role: 'selectAll', enabled: !!ef.canSelectAll },
    );
    const model = editorMenuModel.items || [];
    if (model.length) {
      template.push({ type: 'separator' });
      for (const it of model) {
        if (it.type === 'separator') { template.push({ type: 'separator' }); continue; }
        template.push({
          label: it.label, enabled: it.enabled !== false,
          click: () => wm.broadcast('command:invoke', { id: it.id }),
        });
      }
    }
    Menu.buildFromTemplate(template).popup({ window: wm.main });
  });
}

// 应用菜单栏：macOS 专属应用菜单 / 角色键位适配
function buildAppMenu(template) {
  const items = template.map(group => ({
    label: group.label,
    submenu: group.items.map(it => it.type === 'separator'
      ? { type: 'separator' }
      : {
          label: it.label,
          accelerator: it.accelerator,
          enabled: it.enabled !== false,
          click: () => wm.broadcast('command:invoke', { id: it.id }),
        }),
  }));
  if (process.platform === 'darwin') {
    items.unshift({
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => wm.broadcast('command:invoke', { id: 'app.openSettings' }) },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    });
    items.push({ role: 'windowMenu' });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}

// ---------- 应用设置应用 ----------
function applySettings() {
  nativeTheme.themeSource = store.get('themeSource', 'system');
  const ses = wm.main?.webContents.session;
  if (ses) {
    ses.setSpellCheckerEnabled(store.get('spellcheckEnabled', true));
    try { ses.setSpellCheckerLanguages(store.get('spellcheckLanguages', ['en-US'])); } catch {}
  }
}

// ---------- 启动 ----------
// GPU 异常环境（远程桌面/老显卡/虚拟机）可用 --disable-gpu 兜底；虚拟显示默认走保留视频解码的兼容合成。
if (GRAPHICS_MODE.safe) console.log(`[mazz] 安全图形模式：${GRAPHICS_MODE.reason}；GPU 子进程/系统错误框已禁用`);
else if (GRAPHICS_MODE.mode === 'compatibility') console.log(`[mazz] 远程图形兼容模式：${GRAPHICS_MODE.reason}；保留硬件视频解码并禁用 DirectComposition 视频叠加层`);
app.whenReady().then(async () => {
  // Windows 辅助技术与自动化必须拿到 Chromium 的完整 UIA provider。
  // Electron 要求 ready 之后调用；同时必须早于首个 BrowserWindow 创建。
  if (process.platform === 'win32') app.setAccessibilitySupportEnabled(true);

  bus.start();
  registerChannels();
  crashRecovery = new CrashRecovery({ app, bus });
  watcher = new FileWatcher({ bus, windowManager: wm, resourceLedger });

  // External process supervisors and the Blender capability are created
  // before capability recovery so W94D participates in the same startup gate
  // as Calc, Chart and Canvas.  The executable is probed only; Blender is
  // never downloaded or installed by Mazz.
  const cliSupervisor = new CliSupervisor({ resourceLedger });
  const externalToolSupervisor = new CliSupervisor({
    resourceLedger,
    resourceType: 'external-tool-process',
    handleOwnerTool: 'external-tool-supervisor',
    forceKillTreeOnTerminate: true,
  });
  const blenderFixtureNode = process.env.NODE_ENV === 'test' ? String(process.env.MAZZ_E2E_BLENDER_NODE || '') : '';
  const blenderFixture = process.env.NODE_ENV === 'test' ? String(process.env.MAZZ_E2E_BLENDER_FIXTURE || '') : '';
  const blenderScriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'tools', 'blender', 'mazz_blender_capability.py')
    : path.join(app.getAppPath(), 'resources', 'tools', 'blender', 'mazz_blender_capability.py');
  const externalTools = new ExternalToolService({
    bus,
    adapters: [createBlenderHeadlessAdapter({
      supervisor: externalToolSupervisor,
      scriptPath: app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'tools', 'blender', 'mazz_render_frame.py')
        : path.join(app.getAppPath(), 'resources', 'tools', 'blender', 'mazz_render_frame.py'),
      allowedRootsProvider: () => [store.get('workspace', '')],
      ...(blenderFixtureNode && blenderFixture ? { executablePath: blenderFixtureNode, commandPrefix: [blenderFixture] } : {}),
    })],
  });
  capabilityExecutionService.register(createBlenderExternalCapabilityAdapter({
    supervisor: externalToolSupervisor,
    scriptPath: blenderScriptPath,
    allowedRootsProvider: () => [store.get('workspace', '')],
    ...(blenderFixtureNode && blenderFixture ? { executablePath: blenderFixtureNode, commandPrefix: [blenderFixture] } : {}),
  }));

  // Single-instance startup is the only authority that may repair dead
  // acquisition locks or turn interrupted active Jobs into durable paused
  // facts. This path is entirely local and must never start DNS/network I/O.
  try {
    await initializeCurrentLibraryAcquisition({
      service: libraryAcquisitionService,
      currentWorkspace: () => store.get('workspace'),
    });
    libraryAcquisitionStartupReady = true;
    libraryAcquisitionStartupError = null;
  } catch (error) {
    libraryAcquisitionStartupReady = false;
    libraryAcquisitionStartupError = error;
    console.warn('[library-acquisition] startup hold:', error?.code || 'LIBRARY_ACQUISITION_STARTUP_FAILED');
  }

  // W94A capability recovery shares the single-instance startup authority.
  // It is entirely local: interrupted Leases become durable paused facts and
  // are never automatically replayed before the first app shell exists.
  try {
    await initializeCurrentCapabilityExecution({
      service: capabilityExecutionService,
      currentWorkspace: () => store.get('workspace'),
    });
    capabilityExecutionStartupReady = true;
    capabilityExecutionStartupError = null;
  } catch (error) {
    capabilityExecutionStartupReady = false;
    capabilityExecutionStartupError = error;
    console.warn('[capability-execution] startup hold:', error?.code || 'CAPABILITY_STARTUP_FAILED');
  }
  libraryAcquisitionStartupSettled = true;

  wm.createMain();
  memoryGovernor.start();
  app.on('before-quit', () => memoryGovernor.stop());
  hookDisplayMedia(); // getDisplayMedia 许可（全局内录）
  hookCertificateErrors();
  tray.create();
  // before-quit still precedes the renderer durability veto.  Destroying the
  // tray there would leave a live app without its tray if a dirty/failed save
  // keeps the window open.  will-quit only runs after every window close gate
  // has committed.
  // Acquisition shutdown is a second-stage durability gate. It deliberately
  // runs in will-quit, after every renderer close transaction has committed;
  // unlike generic process cleanup it is never released by a timeout.
  let libraryAcquisitionQuitReady = false;
  let libraryAcquisitionQuitPending = null;
  app.on('will-quit', event => {
    if (libraryAcquisitionQuitReady) {
      tray.destroy();
      return;
    }
    event.preventDefault();
    if (libraryAcquisitionQuitPending) return;
    libraryAcquisitionQuitPending = (async () => {
      libraryResourceSurface.stopAccepting();
      await libraryBrowserAcquisition?.dispose?.();
      await libraryAcquisitionService.shutdown();
      await libraryResourceSurface.shutdown();
      await libraryTorrentTransport.shutdown();
      await canvasDocumentService.shutdown();
      await capabilityExecutionService.shutdown('app-quit');
      const bridgeState = libraryBrowserAcquisition?.snapshot?.() || {
        activeItemCount: 0, pendingCompletionCount: 0,
      };
      const serviceState = libraryAcquisitionService.snapshot();
      const resourceSurfaceState = libraryResourceSurface.snapshotResources();
      const torrentState = libraryTorrentTransport.snapshot();
      const capabilityState = capabilityExecutionService.snapshot();
      if (bridgeState.activeItemCount !== 0 || bridgeState.pendingCompletionCount !== 0
          || serviceState.activeCount !== 0
          || resourceSurfaceState.contextCount !== 0
          || resourceSurfaceState.operationCount !== 0
          || resourceSurfaceState.backgroundCount !== 0
          || resourceSurfaceState.controllerCount !== 0
          || torrentState.activeCount !== 0
          || capabilityState.activeCount !== 0
          || capabilityState.durabilityFailureCount !== 0) {
        const error = new Error('Library acquisition owners did not reach the durable quit boundary');
        error.code = 'LIBRARY_ACQUISITION_QUIT_BOUNDARY_FAILED';
        throw error;
      }
    })()
      .then(() => {
        libraryAcquisitionQuitReady = true;
        libraryAcquisitionQuitPending = null;
        // Do not re-enter Electron's quit sequence while the first will-quit
        // dispatch is still unwinding. A fast, already-idle acquisition close
        // can resolve in the same turn; Electron ignores that nested quit and
        // leaves the process alive until another caller happens to retry.
        setImmediate(() => app.quit());
      })
      .catch(error => {
        libraryAcquisitionQuitPending = null;
        console.error('[library-acquisition] quit hold:', error?.code || 'LIBRARY_ACQUISITION_QUIT_FAILED');
      });
  });
  globalShortcuts.registerAll();

  // —— 隐私浏览器：独立会话 + 搜索服务（主进程专属，实例凭据不出主进程）——
  const browserSess = session.fromPartition('persist:mazz-browser');
  // W58 预览档根治：浏览器独立会话同注册 mazz-res——html 运行预览/媒体页全走此源，默认会话独享=视图会话 about:blank（实锤）
  if (mazzResHandler) browserSess.protocol.handle('mazz-res', mazzResHandler);
  const searxService = new SearxService({ bus, store, session: browserSess, encryptSecret: __pwEncrypt, decryptSecret: __pwDecrypt });
  continuousFeed = new ContinuousFeedService({ feedPipeline, searxService, resourceLedger });
  try { continuousFeed.startAll(store.get('workspace')); } catch (error) { console.warn('[continuous-feed] restore failed:', error.message); }
  app.on('before-quit', () => continuousFeed?.dispose('app-quit'));
  new TranslateService({ bus, store });
  // —— 局域网同步 + 自动更新入口 ——
  const lanSync = new LanSync({
    bus,
    store,
    workspace: () => store.get('workspace'),
    notify: (channel, payload) => { if (wm.main && !wm.main.isDestroyed()) bus.send(wm.main, channel, payload); },
  });
  app.on('before-quit', () => { lanSync.stop().catch(() => {}); });
  // —— 演示手机遥控伺服（W40：单端口单页面+WS 指令道+心跳） ——
  const SlideRemote = require('./slide-remote');
  new SlideRemote({ bus, win: () => wm.main });
  // —— 衍生面板原生子窗（W43 并行进程：收藏管理/密码管理器独立合成，与 WebContentsView 永不相见——白屏病根除） ——
  const panelWindows = new PanelWindows({ bus, win: () => wm.main, resourceLedger, visualComposition });
  visualComposition.attachPanelWindows(panelWindows);
  // W58b 解压缩服务（魔数识别+JSZip 主力+7zip-bin 兜底+GBK 修复+打包+进度取消+2 并发）
  try {
    const ArchiveService = require('./archive');
    const archiveService = new ArchiveService({ bus, win: () => wm.main, resourceLedger });
    app.on('before-quit', () => archiveService.destroy('app-quit'));
  } catch (e) { console.error('[archive] 装配失败:', e.message); }
  new ShareService({ bus, store, startMenuApps });
  new Updater({ bus, store, version: require('../package.json').version });
  const bs = new BrowserSession({ session: browserSess, bus });
  bs.hookWindow(wm.main);
  // —— P2P 边下边播守护（webtorrent 主进程实例 + 127.0.0.1 range 流端点） ——
  const TorrentDaemon = require('./torrent-daemon');
  torrentDaemon = new TorrentDaemon({
    bus, workspace: () => store.get('workspace'), session: browserSess, resourceLedger,
    libraryResourceSurface,
  });
  if (process.env.NODE_ENV === 'test') globalThis.__MAZZ_E2E_TORRENT_DAEMON__ = torrentDaemon;
  app.on('before-quit', () => torrentDaemon.destroy().catch(e => console.warn('[torrent] quit cleanup:', e.message)));
  app.on('before-quit', () => factoryAiRequests.destroy('app-quit').catch(e => console.warn('[factory-ai] quit cleanup:', e.message)));
  app.on('before-quit', () => factoryRunOwners.destroy('app-quit'));
  const TorrentSites = require('./torrent-sites');
  torrentSites = new TorrentSites({ bus });

  // —— MKV 轻量解复用（自研 EBML-lite：多音轨枚举与全编码轨抽帧封装，输出缓存到 媒体库/.audcache） ——
  const { listTracks, extractFlacTrack, extractTrack } = require('./mkv-demux');
  bus.handle('mkv:tracks', async ({ path: p }) => {
    try { return listTracks(p); } catch (e) { return { tracks: [], err: String(e.message || e) }; }
  });
  bus.handle('mkv:extractFlac', async ({ path: p, trackNumber }) => {
    const key = require('crypto').createHash('sha1').update(p + '#' + trackNumber).digest('hex').slice(0, 12);
    const dir = path.join(store.get('workspace'), '媒体库', '.audcache');
    fs.mkdirSync(dir, { recursive: true });
    pruneDerivedCache(dir, AUDCACHE_POLICY);
    const dest = path.join(dir, `${key}-t${trackNumber}.flac`);
    if (fs.existsSync(dest)) return { path: dest, cached: true };
    const buf = extractFlacTrack(p, trackNumber);
    if (!buf) throw new Error('该音轨不可抽（非 FLAC 或抽帧失败）');
    fs.writeFileSync(dest, buf);
    pruneDerivedCache(dir, { ...AUDCACHE_POLICY, preserve: dest });
    return { path: dest, cached: false };
  });
  // 全编码版：FLAC/Vorbis/AAC/Opus 各自封装（.flac/.ogg/.aac）——后缀探测缓存（同轨落过盘即直用）
  bus.handle('mkv:extractTrack', async ({ path: p, trackNumber }) => {
    const key = require('crypto').createHash('sha1').update(p + '#' + trackNumber).digest('hex').slice(0, 12);
    const dir = path.join(store.get('workspace'), '媒体库', '.audcache');
    fs.mkdirSync(dir, { recursive: true });
    pruneDerivedCache(dir, AUDCACHE_POLICY);
    for (const ext of ['flac', 'ogg', 'aac']) {
      const c = path.join(dir, `${key}-t${trackNumber}.${ext}`);
      if (fs.existsSync(c)) return { path: c, cached: true, ext };
    }
    let r;
    try { r = extractTrack(p, trackNumber); }
    catch (e) { throw new Error('该文件 EBML 结构损坏或超出解析面（' + String(e.message || e).slice(0, 40) + '）'); } // 原始栈消息不穿给用户（明白话化实锤）
    if (!r) throw new Error('该音轨不可抽（编码不在支持表 FLAC/Vorbis/AAC/Opus 或抽帧失败）');
    const dest = path.join(dir, `${key}-t${trackNumber}.${r.ext}`);
    fs.writeFileSync(dest, r.buf);
    pruneDerivedCache(dir, { ...AUDCACHE_POLICY, preserve: dest });
    return { path: dest, cached: false, ext: r.ext };
  });
  // 浏览器视图注册表（WebContentsView 主进程持有——webview 标签结构性病根终结）
  // 类走模块级 require（顶部）：局部 const 会遮蔽且跨函数不可达（ReferenceError 病源）
  const browserViews = new BrowserViews({ bus, wm, session: browserSess,
    resourceLedger,
    visualComposition,
    themeId: () => store.get('theme'), // W52④ devtools 主题取数
    pwList: () => (store.get('passwords', [])).map(e => ({ id: e.id, site: e.site, username: e.username, password: __pwDecrypt(e.password) })) }); // W48 自动填充/修改识别取数
  visualComposition.attachBrowserViews(browserViews);

  // —— 投稿会话（persist:mazz-author）：普通下载保持 Electron 默认；只有
  // 已持久授权并预登记的 Library intent 才进入 Job staging → verify → Inbox。
  try {
    const authorSess = session.fromPartition('persist:mazz-author');
    if (libraryAcquisitionStartupReady) {
      libraryBrowserAcquisition = new LibraryBrowserAcquisitionBridge({
        acquisitionService: libraryAcquisitionService,
        session: authorSess,
        onWake: event => wm.broadcastShells('library:acquisitionInboxReady', event),
      });
    } else {
      console.warn('[author-sess] Library acquisition remains on startup hold:',
        libraryAcquisitionStartupError?.code || 'LIBRARY_ACQUISITION_STARTUP_FAILED');
    }
  } catch (e) { console.warn('[author-sess]', e.message); }

  // —— W71 资源账本 + W66 Agent Harness Foundation ——
  if (!store.get('agentRulePackPath', '') && !app.isPackaged) {
    const maintenanceRulePack = path.join(app.getPath('downloads'), '交付区', 'Mazz Editor 开发军规.md');
    if (fs.existsSync(maintenanceRulePack)) store.set('agentRulePackPath', maintenanceRulePack);
  }
  const doctrineRuntime = new AgentDoctrineRuntime({
    doctrineRoot: path.join(app.getPath('userData'), 'agent-doctrine'),
    doctrineAssetsRoot: path.join(app.getAppPath(), 'docs', 'engineering', 'doctrine'),
    sourcePathProvider: () => store.get('agentRulePackPath', ''),
  });
  try {
    const doctrineState = doctrineRuntime.status();
    if (doctrineState.configured && doctrineState.reason === 'DOCTRINE_NOT_COMPILED') doctrineRuntime.prepare();
  } catch (error) { console.warn('[harness] doctrine preparation:', error.code || error.message); }
  const agentFixtureNode = process.env.NODE_ENV === 'test' ? String(process.env.MAZZ_E2E_AGENT_NODE || '') : '';
  const agentFixture = name => process.env.NODE_ENV === 'test' ? String(process.env[`MAZZ_E2E_AGENT_${name}_FIXTURE`] || '') : '';
  const kimiFixture = agentFixture('KIMI');
  const streamFixture = agentFixture('STREAM');
  const adapters = [
    new KimiCodeAdapter({
      supervisor: cliSupervisor,
      ...(agentFixtureNode && kimiFixture ? { executablePath: agentFixtureNode, launchArgs: [kimiFixture] } : {}),
    }),
    new ClaudeCodeAdapter({
      supervisor: cliSupervisor,
      ...(agentFixtureNode && streamFixture ? { executablePath: agentFixtureNode, commandPrefix: [streamFixture, 'claude-fixture'] } : {}),
    }),
    new CodexAdapter({
      supervisor: cliSupervisor,
      ...(agentFixtureNode && streamFixture ? { executablePath: agentFixtureNode, commandPrefix: [streamFixture, 'codex-fixture'] } : {}),
    }),
  ];
  const harness = new AgentHarnessService({
    bus, windowManager: wm, resourceLedger, cliSupervisor, adapters,
    activationProvider: permissionProfileRef => doctrineRuntime.provide(permissionProfileRef),
    contextProvider: payload => contextCompiler.compileForHarness(payload),
  });
  bus.handle('harness:activationStatus', async () => doctrineRuntime.status());
  bus.handle('harness:chooseRulePack', async () => {
    const picked = await dialog.showOpenDialog(wm.main, { title: '选择 Project Rule Pack', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (picked.canceled || !picked.filePaths[0]) return doctrineRuntime.status();
    store.set('agentRulePackPath', picked.filePaths[0]);
    doctrineRuntime.prepare({ acceptDrift: true, authorityRef: 'human:mazz-maintainer' });
    return doctrineRuntime.status();
  });
  let harnessQuitReady = false;
  app.on('before-quit', (event) => {
    if (harnessQuitReady) return;
    event.preventDefault();
    let timeoutId;
    const timeout = new Promise(resolve => { timeoutId = setTimeout(() => resolve('timeout'), 5000); });
    Promise.race([Promise.all([
      harness.killAll(), externalTools.disposeAll('app-quit'),
    ]).then(() => 'done'), timeout])
      .then(status => { if (status === 'timeout') console.warn('[harness] quit cleanup timed out'); })
      .catch(e => console.warn('[harness] quit cleanup:', e.message))
      .finally(() => { clearTimeout(timeoutId); harnessQuitReady = true; app.quit(); });
  });

  // —— 集成终端：node-pty 终端池 ——
  const terminal = new TerminalService({ bus, windowManager: wm, resourceLedger });
  app.on('before-quit', () => terminal.killAll());

  // —— Python 计算内核（math.js 后端）——
  const PythonKernel = require('./python-kernel');
  const pyKernel = new PythonKernel({ bus, windowManager: wm, resourceLedger });
  app.on('before-quit', () => pyKernel.kill('app-quit'));

  // —— DAP 调试适配器池 ——
  const DebugService = require('./debug');
  const debugService = new DebugService({ bus, windowManager: wm, resourceLedger });
  app.on('before-quit', () => debugService.kill('app-quit'));
  wm.main.webContents.on('did-start-loading', () => { mainRendererReady = false; });
  wm.main.webContents.on('did-finish-load', () => {
    mainRendererReady = true;
    applySettings();
    hookEditorContextMenu();
    // 主实例就绪后回放待打开文件（文件关联双击冷启动）
    pendingOpenFiles.forEach(f => wm.broadcast('file:open', { path: f }));
    pendingOpenFiles = [];
    if (pendingImports.length) { wm.broadcast('file:import', { paths: pendingImports }); pendingImports = []; }
    pendingProtocolUrls.splice(0).forEach(handleProtocol);
    // 右键菜单陈旧自愈：老版本注册的命令缺 --import（文件变打开、文件夹无反应），静默重注册
    // 增强：未注册（被清理/从未装）也要注册——否则"导入到 Mazz 工作区"永远只能打开
    if (process.platform === 'win32') {
      (async () => {
        try {
          const appPath = app.isPackaged ? null : app.getAppPath();
          const st = await Importer.explorerMenuStatus({ appPath });
          const need = !st.registered || st.stale || (st.registered && appPath && !(st.raw || '').includes('--import'));
          if (need) {
            const r = await Importer.registerExplorerMenu(process.execPath, { appPath });
            console.log('[importer] 右键菜单自愈重注册:', r.ok ? 'ok' : r.reason, '（失败请在 设置→系统集成 手动注册）');
          }
        } catch (e) { console.warn('[importer] 自愈检测失败:', e.message); }
      })();
    }
    tray.refreshMenu();
  });

  app.on('before-quit', async () => { watcher.close(); });
  app.on('will-quit', () => globalShortcuts.unregisterAll());
  // “退出”必须真正退进程；旧逻辑无条件常驻托盘，导致窗口消失后 Electron 子进程永久残留。
  // tray 分支在 close 事件中 preventDefault，不会触发 window-all-closed，只有明确 quit 才到这里。
  app.on('window-all-closed', () => { if (wm.forceClose) app.quit(); });
  app.on('activate', () => { if (!wm.main) wm.createMain(); else wm.main.show(); });
});

// 文件关联双击（Windows/Linux 冷启动：参数带文件路径）
pendingOpenFiles = extractOpenFiles(process.argv);
pendingImports = Importer.extractImportPaths(process.argv);
pendingProtocolUrls.push(...extractProtocolUrls(process.argv));

// 未捕获异常不杀进程
process.on('uncaughtException', (e) => console.error('[main] uncaught:', e));
