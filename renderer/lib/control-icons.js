import { SVG_ICONS, iconHtml, normalizeIconToken } from './svg-icons.js';

const ICON_CONTAINER_SELECTOR = [
  'button', '[role="button"]', '[role="menuitem"]', '[role="tab"]', '[data-a]', '[data-act]',
  '.mazz-menu-item', '.ico', '.pi-icon', '.appwin-btn', '.p-winbtns button',
  '.tb-btn', '.win-btn', '.icon-btn', '[data-ui-icon]', '[data-icon-only]',
].join(',');

const ICON_KEYS = Object.keys(SVG_ICONS).sort((a, b) => b.length - a.length);
const ICON_ONLY = new RegExp(`^\\s*(${ICON_KEYS.map(escapeRegex).join('|')})\\s*$`, 'u');
const ICON_PREFIX = new RegExp(`^(\\s*)(${ICON_KEYS.map(escapeRegex).join('|')})(?=\\s|$)`, 'u');
const RAW_ICON_ONLY = /^\s*((?:\p{Extended_Pictographic}|[\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF])(?:[\uFE0E\uFE0F\u200D]|\p{Extended_Pictographic}|[\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF])*)\s*$/u;
const RAW_ICON_PREFIX = /^(\s*)((?:\p{Extended_Pictographic}|[\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF])(?:[\uFE0E\uFE0F\u200D]|\p{Extended_Pictographic}|[\u2190-\u21FF\u2300-\u23FF\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF])*)(?=\s|$)/u;
const SKIP_TEXT_ANCESTOR = 'svg,script,style,textarea,input,option,[data-ui-icon-text]';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function svgNode(icon, documentRef) {
  const template = documentRef.createElement('template');
  template.innerHTML = iconHtml(icon);
  return template.content.firstElementChild;
}

function replaceTextNode(textNode, documentRef) {
  const value = textNode.nodeValue || '';
  const knownExact = ICON_ONLY.exec(value);
  const knownPrefix = knownExact ? null : ICON_PREFIX.exec(value);
  const rawExact = knownExact || knownPrefix ? null : RAW_ICON_ONLY.exec(value);
  const rawPrefix = knownExact || knownPrefix || rawExact ? null : RAW_ICON_PREFIX.exec(value);
  const match = knownExact || knownPrefix || rawExact || rawPrefix;
  if (!match) return false;
  const isExact = Boolean(knownExact || rawExact);
  const icon = normalizeIconToken(isExact ? match[1] : match[2]);
  const svg = svgNode(icon, documentRef);
  if (!svg) return false;
  const rawIcon = isExact ? match[1] : match[2];
  const before = isExact ? value.slice(0, value.indexOf(rawIcon)) : match[1];
  const after = value.slice(value.indexOf(rawIcon) + rawIcon.length);
  const fragment = documentRef.createDocumentFragment();
  if (before) fragment.append(documentRef.createTextNode(before));
  fragment.append(svg);
  if (after) fragment.append(documentRef.createTextNode(after));
  textNode.replaceWith(fragment);
  return true;
}

function descendantTextNodes(element) {
  const documentRef = element.ownerDocument;
  const filter = documentRef.defaultView?.NodeFilter || globalThis.NodeFilter;
  if (!filter || !documentRef.createTreeWalker) return [...element.childNodes].filter(node => node.nodeType === 3);
  const walker = documentRef.createTreeWalker(element, filter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest?.(SKIP_TEXT_ANCESTOR)
        ? filter.FILTER_REJECT
        : filter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function normalizeOne(element) {
  if (!(element instanceof Element) || element.dataset.uiIconNormalized === '1') return 0;
  const originalLabel = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim() || '';
  let changed = 0;
  for (const node of descendantTextNodes(element)) {
    if (node.nodeType === Node.TEXT_NODE && replaceTextNode(node, element.ownerDocument)) changed += 1;
  }
  if (changed) {
    element.dataset.uiIconNormalized = '1';
    if (element.matches('button,[role="button"]') && !element.getAttribute('aria-label')) {
      const label = originalLabel;
      if (label) element.setAttribute('aria-label', label);
    }
  }
  return changed;
}

export function normalizeControlIcons(root = document) {
  const targets = [];
  if (root instanceof Element && root.matches(ICON_CONTAINER_SELECTOR)) targets.push(root);
  targets.push(...(root.querySelectorAll?.(ICON_CONTAINER_SELECTOR) || []));
  return targets.reduce((count, element) => count + normalizeOne(element), 0);
}

export function installControlIconRuntime(documentRef = document) {
  normalizeControlIcons(documentRef);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const parent = record.target.parentElement?.closest?.(ICON_CONTAINER_SELECTOR);
        if (parent) { delete parent.dataset.uiIconNormalized; normalizeOne(parent); }
        continue;
      }
      const owner = record.target instanceof Element ? record.target.closest(ICON_CONTAINER_SELECTOR) : null;
      if (owner) { delete owner.dataset.uiIconNormalized; normalizeOne(owner); }
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) normalizeControlIcons(node);
    }
  });
  observer.observe(documentRef.documentElement, { childList: true, subtree: true, characterData: true });
  documentRef.documentElement.dataset.controlIconRuntime = 'v1';
  return () => observer.disconnect();
}

export function findRawControlIcons(root = document) {
  const findings = [];
  for (const element of root.querySelectorAll?.(ICON_CONTAINER_SELECTOR) || []) {
    const text = descendantTextNodes(element).map(node => node.nodeValue || '').join(' ').trim();
    if (ICON_ONLY.test(text) || ICON_PREFIX.test(text) || RAW_ICON_ONLY.test(text) || RAW_ICON_PREFIX.test(text)) {
      findings.push({ tag: element.tagName, text, title: element.getAttribute('title') || '' });
    }
  }
  return findings;
}
