'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const blocks = require('../src/shared/blocks.js');
const { buildIR } = require('../src/shared/ir.js');

const seg = (text, type) => ({ type: type || 'text', text });
const kinds = (ir) => ir.map((n) => n.kind);

test('译文紧跟第一段正文：text → translation → photos', () => {
  const d = {
    blocks: [{ type: 'text', segments: [seg('hi')] }, { type: 'photos', idx: [0] }],
    photosData: ['data:a'],
    translation: '译',
  };
  assert.deepStrictEqual(kinds(buildIR(d)), ['text', 'translation', 'photos']);
});

test('纯图推文的译文位置：无文本块时译文垫底', () => {
  const d = { blocks: [{ type: 'photos', idx: [0, 1] }], photosData: ['data:a', 'data:b'], translation: '译' };
  assert.deepStrictEqual(kinds(buildIR(d)), ['photos', 'translation']);
});

test('译文锚定「第一个文本块」——空文本块也触发（不产出 text 节点但发射译文）', () => {
  const d = {
    blocks: [{ type: 'text', segments: [] }, { type: 'photos', idx: [0] }],
    photosData: ['data:a'],
    translation: '译',
  };
  // 空文本块不产出 text 节点，但译文仍在其位（photos 之前）
  assert.deepStrictEqual(kinds(buildIR(d)), ['translation', 'photos']);
});

test('无译文时不产出 translation 节点', () => {
  const d = { blocks: [{ type: 'text', segments: [seg('hi')] }], translation: null };
  assert.deepStrictEqual(kinds(buildIR(d)), ['text']);
});

test('blocks 与旧字段两种输入等价', () => {
  const withBlocks = {
    blocks: [{ type: 'text', segments: [seg('hi')] }, { type: 'photos', all: true }],
    segments: [seg('hi')],
    photosData: ['data:a', 'data:b'],
    translation: null,
  };
  const withoutBlocks = {
    segments: [seg('hi')],
    photosData: ['data:a', 'data:b'],
    translation: null,
  };
  assert.deepStrictEqual(buildIR(withBlocks), buildIR(withoutBlocks));
});

test('photos 节点：idx 下标解析 + 过滤抓取失败位', () => {
  const d = { blocks: [{ type: 'photos', idx: [0, 1, 2] }], photosData: ['data:a', null, 'data:c'] };
  const ir = buildIR(d);
  assert.strictEqual(ir.length, 1);
  assert.strictEqual(ir[0].kind, 'photos');
  assert.deepStrictEqual(ir[0].urls, ['data:a', 'data:c']);
});

test('photos 节点：全 null 则整个块被丢弃', () => {
  const d = { blocks: [{ type: 'photos', idx: [0, 1] }, { type: 'text', segments: [seg('x')] }], photosData: [null, null] };
  assert.deepStrictEqual(kinds(buildIR(d)), ['text']);
});

test('video 节点：携带 poster 与 permalink', () => {
  const d = { blocks: [{ type: 'video' }], videoPosterData: 'data:p', permalink: 'https://x.com/a/status/1' };
  const ir = buildIR(d);
  assert.deepStrictEqual(ir, [{ kind: 'video', poster: 'data:p', permalink: 'https://x.com/a/status/1' }]);
});

test('video 节点：无封面 poster 为 null', () => {
  const d = { blocks: [{ type: 'video' }], hasVideo: true };
  assert.deepStrictEqual(buildIR(d), [{ kind: 'video', poster: null, permalink: null }]);
});

test('引用递归：quote 节点携带 tweet 与嵌套 ir', () => {
  const quote = { blocks: [{ type: 'text', segments: [seg('quoted')] }], translation: '引用译文' };
  const d = { blocks: [{ type: 'text', segments: [seg('main')] }, { type: 'quote' }], quote, translation: null };
  const ir = buildIR(d);
  assert.deepStrictEqual(kinds(ir), ['text', 'quote']);
  const q = ir[1];
  assert.strictEqual(q.tweet, quote);
  assert.deepStrictEqual(kinds(q.ir), ['text', 'translation']);
});

test('打码后 blocks/segments 一致性：IR 文本聚合 === aggregateSegments(blocks) 的纯文本', () => {
  // 模拟规则打码后的状态：blocks 里的文本块与 d.segments 同步被 █ 覆盖
  const masked = [seg('这是██内容')];
  const d = {
    blocks: [{ type: 'text', segments: masked }, { type: 'photos', idx: [0] }],
    segments: masked,
    photosData: ['data:a'],
    translation: '译文也██了',
  };
  const ir = buildIR(d);
  const irText = ir.filter((n) => n.kind === 'text').map((n) => n.segments.map((s) => s.text).join('')).join('');
  const aggText = blocks.plainTextOf(blocks.aggregateSegments(d.blocks));
  assert.strictEqual(irText, aggText);
  assert.strictEqual(irText, '这是██内容');
  // 译文节点也带上打码后的文本
  assert.strictEqual(ir.find((n) => n.kind === 'translation').text, '译文也██了');
});

test('穿插图文：text → photos → text，译文只在第一段文本后出现一次', () => {
  const d = {
    blocks: [
      { type: 'text', segments: [seg('A')] },
      { type: 'photos', idx: [0] },
      { type: 'text', segments: [seg('B')] },
    ],
    photosData: ['data:a'],
    translation: '译',
  };
  assert.deepStrictEqual(kinds(buildIR(d)), ['text', 'translation', 'photos', 'text']);
});
