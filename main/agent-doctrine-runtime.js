// main/agent-doctrine-runtime.js —— W66-R6 产品态 Project Rule Pack 配置与编译
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  sha256, snapshotR0aFoundation, resolveDoctrineProfiles, createToolCapabilitySnapshot,
  compileDoctrineAttempt, currentAttemptManifest,
} = require('./agent-doctrine');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

class AgentDoctrineRuntime {
  constructor({ doctrineRoot, doctrineAssetsRoot, sourcePathProvider, headProvider = null, clock = () => new Date() } = {}) {
    this.doctrineRoot = path.resolve(String(doctrineRoot || ''));
    this.doctrineAssetsRoot = path.resolve(String(doctrineAssetsRoot || ''));
    this.sourcePathProvider = sourcePathProvider;
    this.headProvider = headProvider;
    this.clock = clock;
  }

  sourcePath() {
    const configured = String(this.sourcePathProvider?.() || '').trim();
    return configured ? path.resolve(configured) : '';
  }

  head() {
    if (this.headProvider) return String(this.headProvider());
    try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: path.dirname(this.doctrineAssetsRoot), encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim(); }
    catch { return sha256(Buffer.from('mazz-editor-0.2.0')).slice(0, 12); }
  }

  status() {
    const sourcePath = this.sourcePath();
    if (!sourcePath || sourcePath === path.parse(sourcePath).root || !fs.existsSync(sourcePath)) return { configured: false, ready: false, reason: 'RULE_PACK_REQUIRED', sourcePath: '' };
    const sourceBytes = fs.readFileSync(sourcePath);
    const sourceHash = sha256(sourceBytes);
    const current = currentAttemptManifest(this.doctrineRoot);
    if (!current) return { configured: true, ready: false, reason: 'DOCTRINE_NOT_COMPILED', sourcePath, sourceHash };
    if (current.canonicalSource.sha256 !== sourceHash) return { configured: true, ready: false, reason: 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE', sourcePath, sourceHash, currentRulePackHash: current.canonicalSource.sha256, attemptId: current.attemptId };
    try {
      const currentSsot = readJson(path.join(this.doctrineRoot, 'attempts', current.attemptId, 'current-ssot.json'));
      if (currentSsot.head !== this.head()) return { configured: true, ready: false, reason: 'DOCTRINE_CONTEXT_RECOMPILE_REQUIRED', sourcePath, sourceHash, attemptId: current.attemptId };
    } catch { return { configured: true, ready: false, reason: 'COMPILED_MANIFEST_INVALID', sourcePath, sourceHash, attemptId: current.attemptId }; }
    return { configured: true, ready: true, reason: '', sourcePath, sourceHash, attemptId: current.attemptId, compiledRulePackHash: current.compiledRulePackHash };
  }

  prepare({ acceptDrift = false, authorityRef = 'human:mazz-maintainer' } = {}) {
    const sourcePath = this.sourcePath();
    if (!sourcePath || !fs.existsSync(sourcePath)) throw Object.assign(new Error('必须先配置 Project Rule Pack'), { code: 'RULE_PACK_REQUIRED' });
    const current = currentAttemptManifest(this.doctrineRoot);
    const sourceBytes = fs.readFileSync(sourcePath);
    const sourceHash = sha256(sourceBytes);
    if (current?.canonicalSource?.sha256 === sourceHash) {
      try {
        const currentSsot = readJson(path.join(this.doctrineRoot, 'attempts', current.attemptId, 'current-ssot.json'));
        if (currentSsot.head === this.head()) return this.activation(current, 'restricted');
      } catch {}
    }
    if (current && current.canonicalSource.sha256 !== sourceHash && !acceptDrift) throw Object.assign(new Error('Project Rule Pack 已变化，必须人工重新接受'), { code: 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE' });
    const ruleRegistry = readJson(path.join(this.doctrineAssetsRoot, 'MAZZ_STABLE_RULE_REGISTRY.v0.json'));
    const incidentLineage = readJson(path.join(this.doctrineAssetsRoot, 'MAZZ_INCIDENT_LINEAGE.v0.json'));
    const foundation = snapshotR0aFoundation({ sourcePath, doctrineRoot: this.doctrineRoot, authorityRef, ruleRegistry, incidentLineage, clock: this.clock });
    const capturedAt = this.clock().toISOString();
    const hostFacts = {
      schemaVersion: 'mazz.host-facts/v0', factId: `host-${process.platform}-${process.arch}`, capturedAt,
      os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux',
      shell: process.platform === 'win32' ? 'powershell' : 'bash', executionMode: 'local', workspacePersistence: 'durable',
      sandbox: false, packagedRuntime: 'electron', electron: true, network: true, remoteTarget: false,
    };
    const profileIndex = resolveDoctrineProfiles(hostFacts, { projectId: 'mazz-editor', domainProfiles: ['software-testing', 'electron-desktop', 'async-runtime'] });
    const head = this.head();
    const currentSsot = {
      schemaVersion: 'mazz.current-ssot/v0', taskId: 'w66-real-agent-adapters', wave: 'W66-R6', status: 'in-progress',
      branch: 'main', head, remoteHead: '', openItems: ['adapter activation gates'],
      stopLine: 'No adapter is formal before real CLI/auth/model/packaged acceptance', authorityRef,
      capturedAt, sourceRefs: [sourcePath, 'docs/plans/W66_REAL_AGENT_ADAPTER_ACTIVATION.md'],
    };
    const toolCapability = createToolCapabilitySnapshot({
      adapterId: 'mazz-agent-harness', adapterVersion: '0.2.0', capturedAt,
      tools: [{ name: 'agent-session', argsSchemaHash: sha256(Buffer.from('adapter-v2')), limits: { shell: false, secrets: 'vendor-login-state-only' }, resultEnvelope: 'mazz.result-envelope/v0', handleKinds: ['AgentSessionHandle', 'ProcessSessionHandle'], continuationApis: ['send', 'interrupt', 'dispose', 'events'] }],
    });
    const attemptId = `runtime-${sourceHash.slice(0, 12)}-${head.slice(0, 8)}`;
    const changeAcceptance = current && current.canonicalSource.sha256 !== sourceHash ? { authorityRef, reason: '用户在 Agent 执行器设置中重新选择并接受 Project Rule Pack', acceptedAt: capturedAt, supersedesAttemptId: current.attemptId } : null;
    const manifest = compileDoctrineAttempt({
      doctrineRoot: this.doctrineRoot, attemptId, authorityRef, sourceReceipt: foundation.sourceReceipt,
      ruleRegistry, incidentLineage, hostFacts, profileIndex, currentSsot, toolCapability,
      projectId: 'mazz-editor', previousAttemptId: current?.attemptId || null, changeAcceptance, clock: this.clock,
    });
    return this.activation(manifest, 'restricted');
  }

  activation(manifest, permissionProfileRef = 'restricted') {
    return { doctrineRoot: this.doctrineRoot, attemptId: manifest.attemptId, permissionPreview: { status: permissionProfileRef === 'approved' ? 'approved' : 'restricted', profileRef: permissionProfileRef } };
  }

  provide(permissionProfileRef = 'restricted') {
    const state = this.status();
    if (!state.ready) throw Object.assign(new Error(state.reason === 'RULE_PACK_CHANGED_WITHOUT_ACCEPTANCE' ? 'Project Rule Pack 已变化，需重新接受' : 'Project Rule Pack 尚未完成编译'), { code: state.reason });
    return this.activation(currentAttemptManifest(this.doctrineRoot), permissionProfileRef);
  }
}

module.exports = { AgentDoctrineRuntime };
