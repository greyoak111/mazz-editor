'use strict';

const { normalizeDocument } = require('./canvas-document-contract');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}
function num(value) { return Number(value).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1'); }
function attrs(node) {
  return `opacity="${num(node.opacity)}"${node.rotation ? ` transform="rotate(${num(node.rotation)} ${num(node.x + node.width / 2)} ${num(node.y + node.height / 2)})"` : ''}`;
}

function renderNode(node) {
  const a = attrs(node);
  if (node.kind === 'rect') return `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${num(node.strokeWidth)}" ${a}/>`;
  if (node.kind === 'ellipse') return `<ellipse cx="${num(node.x + node.width / 2)}" cy="${num(node.y + node.height / 2)}" rx="${num(Math.abs(node.width / 2))}" ry="${num(Math.abs(node.height / 2))}" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${num(node.strokeWidth)}" ${a}/>`;
  if (node.kind === 'text') return `<text x="${num(node.x)}" y="${num(node.y + Math.max(node.height, 16))}" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${num(node.strokeWidth)}" ${a}>${esc(node.text)}</text>`;
  if (node.kind === 'path') {
    const d = node.points.map((point, index) => `${index ? 'L' : 'M'}${num(point.x)} ${num(point.y)}`).join(' ');
    return `<path d="${d}" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${num(node.strokeWidth)}" ${a}/>`;
  }
  if (node.kind === 'image') return `<g data-artifact-ref="${esc(node.assetRef || '')}" ${a}><rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${num(node.strokeWidth)}"/></g>`;
  if (node.kind === 'group') return `<g ${a}>${node.children.map(id => `<use href="#node-${esc(id)}"/>`).join('')}</g>`;
  throw new Error(`unsupported node kind: ${node.kind}`);
}

function renderCanvasSvg(input) {
  const doc = normalizeDocument(input);
  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" width="${num(doc.width)}" height="${num(doc.height)}" viewBox="0 0 ${num(doc.width)} ${num(doc.height)}" data-schema="mazz.canvas-svg/v1">`, `<rect width="100%" height="100%" fill="${doc.background}"/>`];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    chunks.push(`<g id="layer-${esc(layer.layerId)}" opacity="${num(layer.opacity)}">`);
    for (const nodeId of layer.nodeIds) {
      const node = doc.nodes[nodeId];
      if (!node.visible || node.opacity === 0) continue;
      chunks.push(`<g id="node-${esc(node.nodeId)}">${renderNode(node)}</g>`);
    }
    chunks.push('</g>');
  }
  chunks.push('</svg>');
  const svg = chunks.join('');
  if (/<script|foreignObject|(?:href|src)="(?:https?:|data:|file:)/i.test(svg) || /\son[a-z]+=/i.test(svg)) throw new Error('CANVAS_SVG_UNSAFE');
  return svg;
}

module.exports = { renderCanvasSvg };
