const NATIVE_LABELS = {
  mazzsheet: 'Mazz 表格',
  mazzdraw: 'Mazz 画板',
};

const OFFICE_LABELS = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };

export function assertOfficeContainer(ext, data) {
  if (!Object.hasOwn(OFFICE_LABELS, ext)) return true;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || 0);
  const zipSignature = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
  if (!zipSignature) throw new Error(`${OFFICE_LABELS[ext]} 文件不是有效的 Open XML 文档或已经损坏`);
  return true;
}

/** 严格校验拥有专用扩展名且不应回退成普通文本的本地格式。 */
export function assertNativeOpenContent(ext, content) {
  if (!Object.hasOwn(NATIVE_LABELS, ext)) return true;
  let value;
  try { value = JSON.parse(String(content || '')); }
  catch { throw new Error(`${NATIVE_LABELS[ext]}文件已损坏或内容不完整`); }

  if (ext === 'mazzsheet' && (value?.mark !== 'mazz-sheet-v1' || !Array.isArray(value.sheets) || !value.sheets.length)) {
    throw new Error('Mazz 表格文件标识或工作表结构无效');
  }
  // 早期画板文件允许没有 mark，但必须至少保有一帧；兼容历史资产而不接受空壳 JSON。
  if (ext === 'mazzdraw' && (!Array.isArray(value?.frames) || !value.frames.length)) {
    throw new Error('Mazz 画板文件缺少画帧结构');
  }
  return true;
}
