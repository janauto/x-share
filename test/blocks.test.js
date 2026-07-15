'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const blocks = require('../src/shared/blocks.js');

test('blocksOf：有 d.blocks 时原样返回（保文档顺序）', () => {
  const d = { blocks: [{ type: 'text', segments: [] }, { type: 'photos', idx: [0] }] };
  assert.strictEqual(blocks.blocksOf(d), d.blocks);
});

test('blocksOf：无 blocks 回退旧顺序 文本→图→视频→引用', () => {
  const d = {
    segments: [{ type: 'text', text: 'hi' }],
    photosData: ['data:a', null],
    hasVideo: true,
    quote: { name: 'q' },
  };
  const b = blocks.blocksOf(d);
  assert.deepStrictEqual(b.map((x) => x.type), ['text', 'photos', 'video', 'quote']);
  assert.strictEqual(b[1].all, true);
});

test('blocksOf：回退时空字段被跳过', () => {
  assert.deepStrictEqual(blocks.blocksOf({}).map((x) => x.type), []);
  assert.deepStrictEqual(
    blocks.blocksOf({ photosData: [null, null] }).map((x) => x.type),
    [] // 全 null 的 photosData 不产出 photos 块
  );
});

test('blockPhotos：idx 块按下标解析并过滤失败位', () => {
  const d = { photosData: ['data:a', null, 'data:c'] };
  assert.deepStrictEqual(blocks.blockPhotos(d, { idx: [0, 1, 2] }), ['data:a', 'data:c']);
  assert.deepStrictEqual(blocks.blockPhotos(d, { idx: [1] }), []);
});

test('blockPhotos：all 块取全部 photosData（过滤 null）', () => {
  const d = { photosData: ['data:a', null, 'data:c'] };
  assert.deepStrictEqual(blocks.blockPhotos(d, { all: true }), ['data:a', 'data:c']);
});

test('blockPhotos：无 photosData 返回空', () => {
  assert.deepStrictEqual(blocks.blockPhotos({}, { idx: [0] }), []);
});

test('aggregateSegments：多文本块合并，相邻同类型段拼接', () => {
  const blks = [
    { type: 'text', segments: [{ type: 'text', text: 'A' }, { type: 'ent', text: '@x' }] },
    { type: 'photos', idx: [0] },
    { type: 'text', segments: [{ type: 'text', text: 'B' }] },
  ];
  const segs = blocks.aggregateSegments(blks);
  // 第一块末尾是 ent，第二个文本块开头是 text → 不合并，保持 3 段
  assert.deepStrictEqual(segs, [
    { type: 'text', text: 'A' },
    { type: 'ent', text: '@x' },
    { type: 'text', text: 'B' },
  ]);
});

test('aggregateSegments：跨块相邻同类型段会合并', () => {
  const blks = [
    { type: 'text', segments: [{ type: 'text', text: 'A' }] },
    { type: 'text', segments: [{ type: 'text', text: 'B' }] },
  ];
  assert.deepStrictEqual(blocks.aggregateSegments(blks), [{ type: 'text', text: 'AB' }]);
});

test('aggregateSegments：join 出的纯文本与逐段拼接一致', () => {
  const blks = [
    { type: 'text', segments: [{ type: 'text', text: 'Hello ' }, { type: 'ent', text: '@a' }] },
    { type: 'text', segments: [{ type: 'text', text: ' world' }] },
  ];
  const segs = blocks.aggregateSegments(blks);
  assert.strictEqual(blocks.plainTextOf(segs), 'Hello @a world');
});
