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
