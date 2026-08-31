// tests/contract/sheet-external-roundtrip.test.mjs —— 外部 Excel 回传必须恢复完整合法 Workbook
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';

const external = await import('../../renderer/lib/extern-convert.js');
const { Workbook } = await import('../../renderer/modules/sheet/model.js');
const { default: sheetModule } = await import('../../renderer/modules/sheet/index.js');
window.MazzHost = { notifyChange: () => {}, toast: () => {} };

function base64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

describe('Sheet 外部 Excel 回传', () => {
  test('模块整体替换 Workbook 后，控制器与网格闭包指向同一 owner', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = sheetModule.create(container);
    const ctl = sheetModule._forTests.instances.get(container);
    const initial = ctl.wb;
    const replacement = new Workbook();
    replacement.sheets[0].name = '旧页';
    const active = replacement.addSheet('外部页');
    active.setRaw(1, 1, '新 Workbook 生效');
    const content = JSON.stringify({ mark: 'mazz-sheet-v1', ...replacement.serialize() });

    sheetModule.setContent(content, state);
    assert.notEqual(ctl.wb, initial);
    assert.equal(ctl.sheet.name, '外部页');
    assert.equal(ctl.sheet.get(1, 1).v, '新 Workbook 生效');
    const csv = await sheetModule.exportAs('.csv', state);
    assert.equal(csv.text, '新 Workbook 生效');
    container.remove();
  });

  test('采用 importXlsx 返回的新 Workbook，并写回带 mark 的全部工作表', async () => {
    const XLSX = await import('xlsx');
    const edited = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(edited, XLSX.utils.aoa_to_sheet([['第一张', 11]]), '外部一');
    XLSX.utils.book_append_sheet(edited, XLSX.utils.aoa_to_sheet([['第二张', 22]]), '外部二');
    const editedBytes = new Uint8Array(XLSX.write(edited, { type: 'array', bookType: 'xlsx' }));

    const files = new Map();
    let reloaded = null;
    window.mazz = {
      invoke: async (channel, payload = {}) => {
        if (channel === 'workspace:get') return '/workspace';
        if (channel === 'fs:mkdir') return true;
        if (channel === 'fs:writeFileBase64') { files.set(payload.path, payload.base64); return true; }
        if (channel === 'fs:readFileBase64') return base64(editedBytes);
        if (channel === 'fs:writeFile') { files.set(payload.path, payload.content); return true; }
        return null;
      },
    };
    const inst = {
      state: { owner: '目标表格标签' },
      def: {
        exportAs: async () => ({ base64: Buffer.from('initial').toString('base64') }),
        setContent: async (content, state) => { reloaded = { content, state }; },
      },
    };
    const originalPath = '/workspace/预算.mazzsheet';
    const prepared = await external.prepareForExternalOpen(
      { filePath: originalPath, title: '预算.mazzsheet' }, inst, { name: 'Excel' },
    );
    assert.equal(prepared.outExt, 'xlsx');
    assert.equal(await external.handleExternalSave(prepared.launchPath), true);

    const saved = JSON.parse(files.get(originalPath));
    assert.equal(saved.mark, 'mazz-sheet-v1', '回写必须带原生文件标识');
    assert.equal(saved.sheets.length, 2, '不得只保存 active Sheet');
    assert.deepEqual(saved.sheets.map(sheet => sheet.name), ['外部一', '外部二']);
    assert.equal(saved.sheets[1].cells['1,1'].v, '第二张');
    assert.equal(reloaded?.content, files.get(originalPath), '原标签必须通过既有模块 setContent 契约加载同一份 Workbook');
    assert.equal(reloaded?.state, inst.state);
  });
});
