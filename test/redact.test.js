'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const redact = require('../src/content/redact.js');

test('compileRedactTerms：普通词按字面编译成全局正则', () => {
  const terms = redact.compileRedactTerms('foo\nbar', false);
  assert.strictEqual(terms.length, 2);
  assert.ok(terms.every((re) => re.global));
});

test('compileRedactTerms：按换行/逗号/全角逗号分隔，剔除空项', () => {
  const terms = redact.compileRedactTerms('a, b，c\n\nd', false);
  assert.strictEqual(terms.length, 4);
});

test('compileRedactTerms：/pattern/flags 形式当正则处理', () => {
  const terms = redact.compileRedactTerms('/\\d{3}/i', false);
  assert.strictEqual(terms.length, 1);
  assert.ok(terms[0].flags.includes('g')); // 强制补 g
  assert.ok(terms[0].flags.includes('i'));
});

test('compileRedactTerms：字面词里的正则元字符被转义', () => {
  const terms = redact.compileRedactTerms('a.b', false);
  const { text } = redact.redactTextCount('a.b axb', terms);
  // 只命中字面 "a.b"，不把 . 当通配（否则 axb 也会中）
  assert.strictEqual(text, '███ axb');
});

test('compileRedactTerms：includePII 追加手机号/邮箱/长数字正则', () => {
  const withPII = redact.compileRedactTerms('', true);
  const without = redact.compileRedactTerms('', false);
  assert.strictEqual(without.length, 0);
  assert.strictEqual(withPII.length, 3);
});

test('redactTextCount：用等量 █ 覆盖命中的可见字符，返回命中数', () => {
  const terms = redact.compileRedactTerms('敏感词', false);
  const r = redact.redactTextCount('这是敏感词内容', terms);
  assert.strictEqual(r.text, '这是███内容');
  assert.strictEqual(r.hits, 1);
});

test('redactTextCount：多次命中累加 hits', () => {
  const terms = redact.compileRedactTerms('x', false);
  const r = redact.redactTextCount('x y x z x', terms);
  assert.strictEqual(r.hits, 3);
  assert.strictEqual(r.text, '█ y █ z █');
});

test('redactTextCount：空白不被覆盖（只盖可见字符）', () => {
  const terms = redact.compileRedactTerms('/a b/', false); // 含空格的正则
  const r = redact.redactTextCount('a b', terms);
  assert.strictEqual(r.text, '█ █'); // 空格保留
});

test('redactTextCount：无词表/空串安全', () => {
  assert.deepStrictEqual(redact.redactTextCount('hi', []), { text: 'hi', hits: 0 });
  assert.deepStrictEqual(redact.redactTextCount('', redact.compileRedactTerms('x')), { text: '', hits: 0 });
});

test('redactTextCount：PII 手机号被打码', () => {
  const terms = redact.compileRedactTerms('', true);
  const r = redact.redactTextCount('联系 13800138000 谢谢', terms);
  assert.ok(r.text.includes('█'));
  assert.ok(!r.text.includes('13800138000'));
});

test('compileRedactTerms：非法正则退回按内部模式字面匹配（不静默漏网）', () => {
  // /（/ 是非法正则（未闭合分组）；应退回字面匹配 "（"
  const terms = redact.compileRedactTerms('/（/', false);
  const r = redact.redactTextCount('a（b', terms);
  assert.strictEqual(r.hits, 1);
  assert.strictEqual(r.text, 'a█b');
});
