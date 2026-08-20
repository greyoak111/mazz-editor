// scripts/dev.js —— development launcher; owns the console encoding and process chain.
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

if (process.argv.includes('--encoding-probe-child')) {
  console.log('[mazz-dev-encoding-probe] 中文日志可读');
  process.exit(0);
}

const quoteCmd = value => `"${String(value).replace(/"/g, '""')}"`;
const node = quoteCmd(process.execPath);
const script = rel => quoteCmd(path.join(root, rel));
const isProbe = process.argv.includes('--encoding-probe');

let command;
let shell;

if (process.platform === 'win32') {
  // chcp must execute in the same cmd.exe that launches Electron. Running
  // chcp.com from build.js creates an isolated child and leaves Electron on CP936.
  const steps = ['chcp 65001>nul'];
  if (isProbe) {
    steps.push(`${node} ${quoteCmd(__filename)} --encoding-probe-child`, 'chcp');
  } else {
    const electronCli = quoteCmd(require.resolve('electron/cli.js'));
    steps.push(
      `${node} ${script('scripts/build.js')}`,
      `${node} ${script('scripts/build-sample-plugins.js')}`,
      `${node} ${electronCli} . --inspect=9229`,
    );
  }
  shell = process.env.ComSpec || 'cmd.exe';
  command = steps.join(' && ');
} else {
  const q = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  if (isProbe) {
    command = `${q(process.execPath)} ${q(__filename)} --encoding-probe-child`;
  } else {
    command = [
      `${q(process.execPath)} ${q(path.join(root, 'scripts/build.js'))}`,
      `${q(process.execPath)} ${q(path.join(root, 'scripts/build-sample-plugins.js'))}`,
      `${q(process.execPath)} ${q(require.resolve('electron/cli.js'))} . --inspect=9229`,
    ].join(' && ');
  }
  shell = process.env.SHELL || '/bin/sh';
}

const child = spawn(command, {
  cwd: root,
  env: { ...process.env, npm_lifecycle_event: 'dev' },
  stdio: 'inherit',
  windowsHide: false,
  shell,
});

child.on('error', error => {
  console.error('[dev] 无法启动开发进程：', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[dev] 开发进程被 ${signal} 终止`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = Number.isInteger(code) ? code : 1;
});
