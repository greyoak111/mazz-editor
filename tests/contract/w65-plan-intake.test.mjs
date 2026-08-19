// W65 历史方案来源契约：方案字段与停机边界保留，状态以后续正式施工事实为准。
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const planPath = path.resolve('docs/plans/四站爬取方案（移交版）.md');
const plan = fs.readFileSync(planPath, 'utf8');
const index = fs.readFileSync(path.resolve('docs/plans/README.md'), 'utf8');

describe('W65 四站方案入库', () => {
  test('四入两哨与统一 13 字段契约在位', () => {
    for (const site of ['DMHY', 'Mikan', 'kisssub', 'comicat']) assert.ok(plan.includes(site), '缺主线站：' + site);
    for (const sentry of ['MioBT', 'ACG.RIP']) assert.ok(plan.includes(sentry), '缺观察哨：' + sentry);
    for (const field of ['title', 'date', 'size', 'seeders', 'leechers', 'completed', 'magnet', 'torrentUrl', 'sourceSite', 'sourceUrl', 'subgroup', 'resolution', 'infoHash']) {
      assert.ok(plan.includes(field), '统一行缺字段：' + field);
    }
  });

  test('礼貌限速、缓存增量与验证码停机边界在位', () => {
    assert.ok(plan.includes('单站默认 1 并发、间隔 ≥2s'));
    assert.ok(plan.includes('列表页缓存 5 分钟，详情页缓存 30 分钟'));
    assert.ok(plan.includes('真验证码/行为验证出现即停并报告'));
    assert.ok(index.includes('**COMPLETE / FORMAL**'), 'W65 后续正式施工完成后，历史方案合同不得把现状降回未施工');
    assert.ok(index.includes('出现真实验证码或行为验证仍必须停止并报告'), '正式化不得删除验证码停机边界');
  });
});
