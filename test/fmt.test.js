'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fmt = require('../src/shared/fmt.js');

test('esc 转义完备性：& < > " 全覆盖，顺序正确', () => {
  assert.strictEqual(fmt.esc('<a href="x">&y</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;');
  // & 必须先转，避免二次转义
  assert.strictEqual(fmt.esc('&amp;'), '&amp;amp;');
  assert.strictEqual(fmt.esc(null), '');
  assert.strictEqual(fmt.esc(undefined), '');
  assert.strictEqual(fmt.esc(123), '123');
  // 单引号不转义（与原 webpage.js 行为一致）
  assert.strictEqual(fmt.esc("it's"), "it's");
});

test('fmtDate：合法 ISO → YYYY-MM-DD HH:mm，补零', () => {
  const s = fmt.fmtDate('2026-03-05T08:07:00');
  assert.strictEqual(s, '2026-03-05 08:07');
});

test('fmtDate：空/非法返回空串', () => {
  assert.strictEqual(fmt.fmtDate(''), '');
  assert.strictEqual(fmt.fmtDate(null), '');
  assert.strictEqual(fmt.fmtDate('not-a-date'), '');
});

test('parseCount：K/M 后缀', () => {
  assert.strictEqual(fmt.parseCount('1.2K'), 1200);
  assert.strictEqual(fmt.parseCount('3.4M'), 3400000);
  assert.strictEqual(fmt.parseCount('5k'), 5000);
  assert.strictEqual(fmt.parseCount('2m'), 2000000);
});

test('parseCount：万/萬 后缀', () => {
  assert.strictEqual(fmt.parseCount('1.2万'), 12000);
  assert.strictEqual(fmt.parseCount('3萬'), 30000);
});

test('parseCount：逗号/全角逗号/空白剥离', () => {
  assert.strictEqual(fmt.parseCount('5,432'), 5432);
  assert.strictEqual(fmt.parseCount('1，234'), 1234);
  assert.strictEqual(fmt.parseCount(' 12 '), 12);
});

test('parseCount：空/非数字 → 0', () => {
  assert.strictEqual(fmt.parseCount(''), 0);
  assert.strictEqual(fmt.parseCount(null), 0);
  assert.strictEqual(fmt.parseCount('abc'), 0);
});

test('needsTranslation：全中文 → 不需要', () => {
  assert.strictEqual(fmt.needsTranslation('这是一条完全中文的推文内容'), false);
});

test('needsTranslation：全英文 → 需要', () => {
  assert.strictEqual(fmt.needsTranslation('This is an English tweet about something'), true);
});

test('needsTranslation：去掉链接和 @/# 后判断中文占比', () => {
  // 正文除了链接和 @ 全是英文 → 需要翻译
  assert.strictEqual(fmt.needsTranslation('Check https://t.co/abc @someone this is english'), true);
  // 只有链接/提及，剥离后为空 → 不需要
  assert.strictEqual(fmt.needsTranslation('https://t.co/abc @someone #tag'), false);
});

test('needsTranslation：中文占比 25% 边界', () => {
  // 阈值是 < 0.25。构造刚好 25% 中文（不小于阈值）→ 不需要
  // 3 个中文 + 9 个英文字母 = 12 字，25% 恰好，不 < 0.25 → false
  assert.strictEqual(fmt.needsTranslation('中文字abcdefghi'), false);
  // 2 个中文 + 10 个英文 = 12 字，约 16.7% < 25% → true
  assert.strictEqual(fmt.needsTranslation('中文abcdefghij'), true);
});

test('avatarInitial：取首字并大写，去前导 @', () => {
  assert.strictEqual(fmt.avatarInitial('Bob', '@bob'), 'B');
  assert.strictEqual(fmt.avatarInitial('', '@alice'), 'A');
  assert.strictEqual(fmt.avatarInitial('张三', ''), '张');
  assert.strictEqual(fmt.avatarInitial('', ''), '#');
});

test('avatarColor：确定性、落在调色板内', () => {
  const palette = ['#1d9bf0', '#f4212e', '#00ba7c', '#ffad1f', '#7856ff', '#f91880', '#ff7a00'];
  const c1 = fmt.avatarColor('alice');
  const c2 = fmt.avatarColor('alice');
  assert.strictEqual(c1, c2); // 稳定
  assert.ok(palette.includes(c1));
  assert.ok(palette.includes(fmt.avatarColor('')));
});

test('buildTitle：名字+摘要，用全角冒号连接', () => {
  assert.strictEqual(fmt.buildTitle('Bob', 'hello world'), 'Bob：hello world');
});

test('buildTitle：空值安全，回退「推文转发」', () => {
  assert.strictEqual(fmt.buildTitle('', ''), '推文转发');
  assert.strictEqual(fmt.buildTitle(null, null), '推文转发');
  assert.strictEqual(fmt.buildTitle('Bob', ''), 'Bob');
  assert.strictEqual(fmt.buildTitle('', 'text'), 'text');
});

test('buildTitle：超长截断到 max-1 + 省略号', () => {
  const long = fmt.buildTitle('n', 'x'.repeat(100), 10);
  assert.strictEqual(long.length, 10);
  assert.ok(long.endsWith('…'));
});

test('buildTitle：多余空白折叠成单空格', () => {
  assert.strictEqual(fmt.buildTitle('Bob', 'a\n\n  b'), 'Bob：a b');
});
