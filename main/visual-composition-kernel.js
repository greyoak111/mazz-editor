'use strict';

const VALID_KINDS = new Set(['window', 'panel-window', 'web-contents-view', 'dom-overlay']);
const VALID_LAYERS = new Set(['workspace', 'native-content', 'transient', 'system']);

function cleanText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text.slice(0, 160);
}

function normalizeBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const raw = ['x', 'y', 'width', 'height'].map(key => Number(value[key]));
  if (raw.some(number => !Number.isFinite(number))) return null;
  return {
    x: Math.round(raw[0]),
    y: Math.round(raw[1]),
    width: Math.max(0, Math.round(raw[2])),
    height: Math.max(0, Math.round(raw[3])),
  };
}

class VisualCompositionKernel {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.surfaces = new Map();
    this.overlays = new Map();
    this.hostOcclusion = new Map();
    this.generation = 0;
  }

  registerSurface(input = {}) {
    const id = cleanText(input.id);
    const kind = cleanText(input.kind);
    if (!id) throw new Error('visual surface id required');
    if (!VALID_KINDS.has(kind)) throw new Error(`unsupported visual surface kind: ${kind}`);
    const previous = this.surfaces.get(id);
    const surface = {
      id,
      kind,
      layer: VALID_LAYERS.has(input.layer) ? input.layer : (kind === 'dom-overlay' ? 'transient' : 'workspace'),
      owner: cleanText(input.owner, 'unknown'),
      hostWindowId: Number.isInteger(Number(input.hostWindowId)) ? Number(input.hostWindowId) : null,
      sourceWebContentsId: Number.isInteger(Number(input.sourceWebContentsId)) ? Number(input.sourceWebContentsId) : null,
      visible: input.visible !== false,
      desiredVisible: input.desiredVisible !== false,
      occluded: input.occluded === true,
      focused: input.focused === true,
      bounds: normalizeBounds(input.bounds),
      createdAt: previous?.createdAt || this.now(),
      updatedAt: this.now(),
      generation: ++this.generation,
      metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    };
    this.surfaces.set(id, surface);
    return { ...surface, metadata: { ...surface.metadata } };
  }

  updateSurface(id, patch = {}) {
    const key = cleanText(id);
    const current = this.surfaces.get(key);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      id: current.id,
      kind: current.kind,
      layer: VALID_LAYERS.has(patch.layer) ? patch.layer : current.layer,
      owner: patch.owner == null ? current.owner : cleanText(patch.owner, current.owner),
      hostWindowId: patch.hostWindowId == null ? current.hostWindowId : Number(patch.hostWindowId),
      sourceWebContentsId: patch.sourceWebContentsId == null ? current.sourceWebContentsId : Number(patch.sourceWebContentsId),
      bounds: patch.bounds === undefined ? current.bounds : normalizeBounds(patch.bounds),
      metadata: patch.metadata ? { ...current.metadata, ...patch.metadata } : current.metadata,
      updatedAt: this.now(),
      generation: ++this.generation,
    };
    this.surfaces.set(key, next);
    return { ...next, metadata: { ...next.metadata } };
  }

  unregisterSurface(id) {
    const key = cleanText(id);
    const surface = this.surfaces.get(key);
    if (!surface) return false;
    if (surface.kind === 'dom-overlay') {
      const token = surface.metadata?.token;
      if (token) return !!this.endOverlay(token);
    }
    this.surfaces.delete(key);
    this.generation += 1;
    return true;
  }

  beginOverlay(input = {}) {
    const token = cleanText(input.token);
    const hostWindowId = Number(input.hostWindowId);
    const sourceWebContentsId = Number(input.sourceWebContentsId);
    if (!token || !Number.isInteger(hostWindowId) || hostWindowId <= 0) throw new Error('overlay token and host window required');
    const id = `overlay:${token}`;
    this.registerSurface({
      id,
      kind: 'dom-overlay',
      layer: 'transient',
      owner: cleanText(input.kind, 'overlay'),
      hostWindowId,
      sourceWebContentsId: Number.isInteger(sourceWebContentsId) ? sourceWebContentsId : null,
      bounds: input.bounds,
      visible: true,
      desiredVisible: true,
      metadata: { token, dismissible: input.dismissible !== false },
    });
    this.overlays.set(token, { token, id, hostWindowId, sourceWebContentsId, createdAt: this.now() });
    if (!this.hostOcclusion.has(hostWindowId)) this.hostOcclusion.set(hostWindowId, new Set());
    this.hostOcclusion.get(hostWindowId).add(token);
    return this.occlusionState(hostWindowId);
  }

  updateOverlay(token, patch = {}) {
    const rec = this.overlays.get(cleanText(token));
    if (!rec) return null;
    return this.updateSurface(rec.id, patch);
  }

  endOverlay(token) {
    const key = cleanText(token);
    const rec = this.overlays.get(key);
    if (!rec) return null;
    this.overlays.delete(key);
    this.surfaces.delete(rec.id);
    const set = this.hostOcclusion.get(rec.hostWindowId);
    set?.delete(key);
    if (set && !set.size) this.hostOcclusion.delete(rec.hostWindowId);
    this.generation += 1;
    return this.occlusionState(rec.hostWindowId);
  }

  endOverlaysBySource(sourceWebContentsId) {
    const source = Number(sourceWebContentsId);
    const affected = new Set();
    for (const [token, rec] of [...this.overlays]) {
      if (rec.sourceWebContentsId !== source) continue;
      affected.add(rec.hostWindowId);
      this.endOverlay(token);
    }
    return [...affected].map(hostWindowId => this.occlusionState(hostWindowId));
  }

  occlusionState(hostWindowId) {
    const host = Number(hostWindowId);
    const tokens = [...(this.hostOcclusion.get(host) || [])];
    return { hostWindowId: host, occluded: tokens.length > 0, tokens };
  }

  snapshot() {
    const surfaces = [...this.surfaces.values()]
      .map(surface => ({ ...surface, metadata: { ...surface.metadata }, bounds: surface.bounds ? { ...surface.bounds } : null }))
      .sort((a, b) => a.layer.localeCompare(b.layer) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return {
      protocol: 'mazz.visual-composition/v1',
      generation: this.generation,
      surfaceCount: surfaces.length,
      overlayCount: this.overlays.size,
      occludedHostCount: this.hostOcclusion.size,
      surfaces,
      hosts: [...this.hostOcclusion.keys()].map(hostWindowId => this.occlusionState(hostWindowId)),
    };
  }
}

module.exports = { VisualCompositionKernel, normalizeBounds };
