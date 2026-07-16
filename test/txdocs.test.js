'use strict';
// txdocs.js 的两栖纯函数导出（node 下只导出纯函数，不跑浮层逻辑）。
// buildTitle 已收敛到 shared/fmt.js，此处验证委托后行为不变。
const { test } = require('node:test');
const assert = require('node:assert');
const tx = require('../src/content/txdocs.js');
const fmt = require('../src/shared/fmt.js');

test('buildTitle 委托 shared/fmt.js 唯一实现', () => {
  assert.strictEqual(tx.buildTitle, fmt.buildTitle);
  assert.strictEqual(tx.buildTitle('Bob', 'hello'), 'Bob：hello');
  assert.strictEqual(tx.buildTitle('', ''), '推文转发');
});

test('pickDocUrl：文档编辑页返回去 query 的干净 URL', () => {
  assert.strictEqual(tx.pickDocUrl('https://docs.qq.com/doc/ABC123?tab=x#h'), 'https://docs.qq.com/doc/ABC123');
  assert.strictEqual(tx.pickDocUrl('https://docs.qq.com/pad/XYZ'), 'https://docs.qq.com/pad/XYZ');
});

test('pickDocUrl：desktop / 非 docs 域 / 畸形输入返回 null', () => {
  assert.strictEqual(tx.pickDocUrl('https://docs.qq.com/desktop'), null);
  assert.strictEqual(tx.pickDocUrl('https://evil.com/doc/abc'), null);
  assert.strictEqual(tx.pickDocUrl('not a url'), null);
  assert.strictEqual(tx.pickDocUrl(null), null);
});

test('isPendingFresh：10 分钟有效期，畸形/时间倒流判不新鲜', () => {
  const now = 1000000000;
  assert.strictEqual(tx.isPendingFresh({ ts: now - 1 }, now), true);
  assert.strictEqual(tx.isPendingFresh({ ts: now - 11 * 60 * 1000 }, now), false);
  assert.strictEqual(tx.isPendingFresh({ ts: now + 1 }, now), false); // 时钟异常
  assert.strictEqual(tx.isPendingFresh(null, now), false);
  assert.strictEqual(tx.isPendingFresh({ ts: 'x' }, now), false);
});

test('isPendingFresh：v2 扩展字段（stage/docxB64）不影响判定，只看 ts', () => {
  const now = 1000000000;
  assert.strictEqual(tx.isPendingFresh({ ts: now - 1, stage: 'import-started', docxB64: 'AAAA' }, now), true);
  assert.strictEqual(tx.isPendingFresh({ ts: now - 1, stage: 'import-arrived' }, now), true);
  assert.strictEqual(tx.isPendingFresh({ ts: now - 1, stage: 'paste-fallback' }, now), true);
  // 过期照样过期，stage 不是免死金牌
  assert.strictEqual(tx.isPendingFresh({ ts: now - 11 * 60 * 1000, stage: 'import-started', docxB64: 'AAAA' }, now), false);
});

test('pickImportInput：accept 提到 doc/docx 的 input 优先', () => {
  const img = { accept: 'image/*' };
  const doc = { accept: '.doc,.docx' };
  const any = { accept: '' };
  assert.strictEqual(tx.pickImportInput([img, doc, any]), doc, 'doc 专用 input 应胜出');
  assert.strictEqual(tx.pickImportInput([img, any]), any, '无 accept（来者不拒）优于仅图片');
  assert.strictEqual(tx.pickImportInput([img]), img, '只有一个候选也返回（可见性/类型不苛求）');
});

test('pickImportInput：wordprocessingml MIME 同等视作 docx 专用', () => {
  const mime = { accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const any = { accept: '' };
  assert.strictEqual(tx.pickImportInput([any, mime]), mime);
});

test('pickImportInput：docx 专用 > 泛 doc；同分并列取先出现者；空/畸形返回 null', () => {
  const docx = { accept: '.docx' };
  const doc = { accept: '.doc' };
  assert.strictEqual(tx.pickImportInput([doc, docx]), docx, 'docx 专用应压过泛 doc');
  const first = { accept: '.docx' };
  const second = { accept: '.docx' };
  assert.strictEqual(tx.pickImportInput([first, second]), first, '同分并列取先出现者');
  assert.strictEqual(tx.pickImportInput([]), null);
  assert.strictEqual(tx.pickImportInput(null), null);
  assert.strictEqual(tx.pickImportInput(undefined), null);
});
