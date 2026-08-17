// W71 C3: prove the sealed Windows runtime does not distribute or activate FFmpeg core.
import { _electron as electron } from 'playwright';
import * as asar from '@electron/asar';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const executablePath = path.join(root, 'release', 'win-unpacked', 'Mazz Editor.exe');
const appAsarPath = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const evidenceDir = path.resolve(process.env.MAZZ_W71_EVIDENCE_DIR
  || path.join(root, 'docs', 'engineering', 'evidence'));
const evidencePath = path.join(evidenceDir, 'W71_FFMPEG_DISTRIBUTION_DECISION.json');
if (!fs.existsSync(executablePath)) throw new Error(`Packaged app is missing: ${executablePath}`);
if (!fs.existsSync(appAsarPath)) throw new Error(`Packaged app.asar is missing: ${appAsarPath}`);

const forbiddenCorePattern = /renderer[\\/]vendor[\\/]ffmpeg[\\/]ffmpeg-core\.(?:js|wasm)$/i;
const repoCoreArtifacts = [
  path.join(root, 'renderer', 'vendor', 'ffmpeg', 'ffmpeg-core.js'),
  path.join(root, 'renderer', 'vendor', 'ffmpeg', 'ffmpeg-core.wasm'),
].filter(file => fs.existsSync(file));
const packagedCoreArtifacts = asar.listPackage(appAsarPath).filter(entry => forbiddenCorePattern.test(entry));
if (repoCoreArtifacts.length || packagedCoreArtifacts.length) {
  throw new Error(`Sealed distribution still contains FFmpeg core: ${JSON.stringify({ repoCoreArtifacts, packagedCoreArtifacts })}`);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-ffmpeg-user-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w71-ffmpeg-ws-'));
let app;

try {
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MAZZ_E2E_USER_DATA: userData,
      MAZZ_E2E_WORKSPACE: workspace,
      MAZZ_GPU_MODE: 'safe',
      NODE_ENV: 'test',
    },
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 120000 });
  win.setDefaultTimeout(120000);
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.MazzShell && !!window.mazz, null, { timeout: 30000 });
  await win.evaluate(async () => {
    await window.mazz.invoke('settings:set', { key: 'closeBehavior', value: 'quit' });
    await window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true });
    await window.mazz.invoke('panel:close', { kind: 'agreement' }).catch(() => {});
  });

  const baseline = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  const runtime = await win.evaluate(async () => {
    const moduleUrl = new URL('lib/ffmpeg-transcode.js', document.baseURI).href;
    const mod = await import(moduleUrl);
    const capture = async operation => {
      try {
        await operation();
        return { rejected: false, message: '' };
      } catch (error) {
        return { rejected: true, message: String(error?.message || error) };
      }
    };
    const ensure = await capture(() => mod.ensureFFmpeg());
    const transcode = await capture(() => mod.transcode(new Uint8Array([0, 1, 2]), 'wav', { toAudio: true }));
    await mod.disposeFFmpeg();
    return { ensure, transcode };
  });
  const expectedMessage = /封板版未内置本地转码运行时.*源码分发闭环后重新启用/;
  if (!runtime.ensure.rejected || !runtime.transcode.rejected
    || !expectedMessage.test(runtime.ensure.message) || !expectedMessage.test(runtime.transcode.message)) {
    throw new Error(`Deferred runtime did not fail closed with an honest message: ${JSON.stringify(runtime)}`);
  }

  const finalResources = await win.evaluate(() => window.mazz.invoke('resources:snapshot'));
  if (finalResources.activeCount !== baseline.activeCount) {
    throw new Error(`FFmpeg activation attempt leaked resources: ${baseline.activeCount} -> ${finalResources.activeCount}`);
  }

  const evidence = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    executable: 'release/win-unpacked/Mazz Editor.exe',
    distribution: {
      mode: 'DEFERRED_NOT_BUNDLED',
      repoCoreArtifacts,
      packagedCoreArtifacts,
    },
    runtime: {
      ensureRejected: runtime.ensure.rejected,
      transcodeRejected: runtime.transcode.rejected,
      messageIsExplicit: expectedMessage.test(runtime.ensure.message),
      resourceLedger: { baseline: baseline.activeCount, final: finalResources.activeCount },
    },
    futureActivationGate: {
      exactCorrespondingSource: false,
      reproducibleBuildRecipe: false,
      noticesAndLicenseBundle: true,
      runtimeAndLifecycleRetestRequired: true,
    },
    conclusion: {
      currentReleaseLicenseGate: 'CLOSED_BY_NON_DISTRIBUTION',
      futureRuntimeGate: 'OPEN',
      optionalCapabilityPreserved: true,
    },
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, ...evidence.conclusion, resources: evidence.runtime.resourceLedger }));
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
