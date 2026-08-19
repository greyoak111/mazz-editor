// renderer/core/product-maturity.js —— W71 正式入口成熟度单源
// 这里只决定产品表达，不代表删除实现；Hidden 能力保留代码，直到自身 Activation Gate 通过。

export const MATURITY = Object.freeze({
  FORMAL: 'formal',
  PREVIEW: 'preview',
  HIDDEN: 'hidden',
});

// C1 产品级状态表：三态必须覆盖所有历史 PARTIAL 与低水位正式候选。
export const PRODUCT_CAPABILITIES = Object.freeze({
  mobile: Object.freeze({ maturity: MATURITY.HIDDEN, label: '移动壳', gate: 'CONDITIONAL_PLATFORM_BUILD', boundary: 'android-ios-signing-and-device-matrix' }),
  updater: Object.freeze({ maturity: MATURITY.HIDDEN, label: '自动更新', gate: 'CONDITIONAL_RELEASE_INFRASTRUCTURE', boundary: 'signed-old-new-artifacts-and-rollback' }),
  // W74b 已开放 W65 -> Feed -> W74a -> Factory 的人工核准薄竖切；
  // W62e 的通用来源、后台调度和全自动预算治理仍是独立历史欠账。
  feed: Object.freeze({ maturity: MATURITY.FORMAL, label: '素材订阅' }),
  agent: Object.freeze({ maturity: MATURITY.HIDDEN, label: 'Agent 执行器整合', foundation: 'internal' }),
  dmhy: Object.freeze({ maturity: MATURITY.FORMAL, label: '四站聚合检索与下载' }),
  recorder: Object.freeze({ maturity: MATURITY.PREVIEW, label: '全局内录', gate: 'PREVIEW_SETTLED', boundary: 'device-and-display-matrix' }),
  plugins: Object.freeze({ maturity: MATURITY.PREVIEW, label: '插件系统', gate: 'PREVIEW_SETTLED', boundary: 'trusted-renderer-code', permissionsEnforced: false }),
  ocr: Object.freeze({ maturity: MATURITY.FORMAL, label: '图片文字识别' }),
  archive: Object.freeze({ maturity: MATURITY.FORMAL, label: '压缩包' }),
  // GPL core 的完整 corresponding-source 尚未恢复。封板发行物不携带 core，
  // 转码/GIF/mp4 子能力保持 Hidden；代码保留，日后通过 Activation Gate 再启用。
  ffmpegRuntime: Object.freeze({ maturity: MATURITY.HIDDEN, label: '本地媒体转码', foundation: 'deferred' }),
});

const EXACT_COMMANDS = Object.freeze({
  'update.check': MATURITY.HIDDEN,
  'ocr.image': MATURITY.FORMAL,
  'rec.screen': MATURITY.PREVIEW,
  'plugin.manage': MATURITY.PREVIEW,
  'plugin.reload': MATURITY.PREVIEW,
});

const PREFIX_COMMANDS = Object.freeze([
  ['archive.', MATURITY.FORMAL],
]);

export function resolveCommandMaturity(id) {
  if (EXACT_COMMANDS[id]) return EXACT_COMMANDS[id];
  return PREFIX_COMMANDS.find(([prefix]) => String(id).startsWith(prefix))?.[1] || MATURITY.FORMAL;
}

export function maturityLabel(title, maturity) {
  const text = String(title || '');
  return maturity === MATURITY.PREVIEW && !text.includes('（预览）') ? `${text}（预览）` : text;
}

const HIDDEN_HELP_SECTIONS = new Set(['mobile']);

export function visibleHelpSections(sections) {
  return (sections || []).filter(section => !HIDDEN_HELP_SECTIONS.has(section.id));
}
