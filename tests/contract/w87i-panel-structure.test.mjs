// W87i —— PanelWindow structure token, hot theme propagation and semantic hard edges.
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const themes = read('renderer/styles/themes.css');
const shell = read('renderer/shell/shell.js');
const shared = read('renderer/panels/panel-shared.css');
const store = read('renderer/lib/theme-store.js');

describe('W87i Panel structure propagation', () => {
  test('computed theme snapshot carries a hard-edge token for built-in and custom structures', () => {
    assert.match(themes, /:root\s*\{[\s\S]*--panel-hard-edge:\s*0/);
    assert.match(themes, /\[data-theme="construct"\]\s*\{[\s\S]*--panel-hard-edge:\s*1/);
    assert.match(themes, /\[data-theme="custom"\]\s*\{[\s\S]*--panel-hard-edge:\s*1/);
    assert.match(shell, /'panel-hard-edge'/);
    assert.match(shell, /structure:\s*vars\['panel-hard-edge'\]\s*===\s*'1'\s*\?\s*'hard-edge'\s*:\s*'soft'/);
    assert.match(shell, /dataset\.themeStructure\s*=\s*\(id\s*===\s*'construct'\s*\|\|\s*id\s*===\s*'custom'\)\s*\?\s*'hard-edge'\s*:\s*'soft'/);
    assert.match(store, /dataset\.themeStructure\s*=\s*hardEdge\s*\?\s*'hard-edge'\s*:\s*'soft'/);
  });

  test('Panel Runtime updates structure on initial snapshot and every live theme change', async () => {
    const listeners = new Map();
    window.mazz = { on: (channel, listener) => listeners.set(channel, listener) };
    globalThis.location = window.location;
    globalThis.innerWidth = 800;
    globalThis.Element = window.Element;
    globalThis.Node = window.Node;
    await import('../../renderer/panels/panel-runtime.js?w87i-panel-structure');

    listeners.get('panel:push')?.({ type: 'themeInit', id: 'pack:poster', vars: { 'panel-hard-edge': '1' } });
    assert.equal(document.documentElement.dataset.themeStructure, 'hard-edge');

    listeners.get('theme:changed')?.({ id: 'paper', vars: { 'panel-hard-edge': '0' } });
    assert.equal(document.documentElement.dataset.themeStructure, 'soft');

    listeners.get('theme:changed')?.({ id: 'custom', vars: {} });
    assert.equal(document.documentElement.dataset.themeStructure, 'hard-edge');
  });

  test('hard-edge grammar is bounded to rectangular components and preserves round semantics', () => {
    assert.match(shared, /html\[data-theme-structure="hard-edge"\][\s\S]*\.project-card[\s\S]*\[role="dialog"\][\s\S]*border-radius:\s*0\s*!important/);
    assert.match(shared, /\.choice-chip[\s\S]*\.status-pill[\s\S]*\.word-chips\s*>\s*button[\s\S]*border-radius:\s*999px\s*!important/);
    assert.match(shared, /\.dot[\s\S]*\.key-dot[\s\S]*\.avatar[\s\S]*border-radius:\s*50%\s*!important/);
    assert.doesNotMatch(shared, /data-theme-structure="hard-edge"\]\s+\*\s*\{[^}]*border-radius:\s*0/, 'must not erase circular semantics with a universal radius reset');

    const style = document.createElement('style');
    style.textContent = shared;
    document.head.appendChild(style);
    document.documentElement.dataset.themeStructure = 'hard-edge';
    document.body.innerHTML = '<button id="rect" class="btn">Run</button><span id="pill" class="status-pill">Ready</span><i id="dot" class="dot"></i>';
    assert.match(getComputedStyle(document.querySelector('#rect')).borderRadius, /^0(?:px)?$/);
    assert.equal(getComputedStyle(document.querySelector('#pill')).borderRadius, '999px');
    assert.equal(getComputedStyle(document.querySelector('#dot')).borderRadius, '50%');
  });
});
