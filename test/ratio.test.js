'use strict';
// 比例引擎纯逻辑：补白计划（视觉重心略偏上）、超出回退、非法输入。
const { test } = require('node:test');
const assert = require('node:assert');
const ratio = require('../src/shared/ratio.js');

test('RATIOS：五个 key，smart 为 null', () => {
  assert.deepStrictEqual(ratio.RATIO_KEYS, ['smart', '4:5', '1:1', '3:4', '9:16']);
  assert.strictEqual(ratio.RATIOS.smart, null);
  assert.strictEqual(ratio.RATIOS['4:5'], 5 / 4);
  assert.strictEqual(ratio.RATIOS['9:16'], 16 / 9);
});

test('padPlan：smart / 未知 key / 非法尺寸 → natural', () => {
  assert.deepStrictEqual(ratio.padPlan(1200, 900, 'smart'), { mode: 'natural' });
  assert.deepStrictEqual(ratio.padPlan(1200, 900, 'bogus'), { mode: 'natural' });
  assert.deepStrictEqual(ratio.padPlan(0, 900, '1:1'), { mode: 'natural' });
  assert.deepStrictEqual(ratio.padPlan(1200, -1, '1:1'), { mode: 'natural' });
});

test('padPlan：内容不足 → 补白，视觉重心略偏上（top = extra*0.42）', () => {
  const p = ratio.padPlan(1200, 1000, '1:1'); // targetH 1200，extra 200
  assert.strictEqual(p.mode, 'pad');
  assert.strictEqual(p.targetH, 1200);
  assert.strictEqual(p.top, 84); // 200 * 0.42
  assert.strictEqual(p.bottom, 116);
  assert.strictEqual(p.top + p.bottom + 1000, p.targetH); // 不缩放，只补白
  assert.ok(p.top < p.bottom, '文字应略偏上');
});

test('padPlan：恰好等于目标比例 → pad 且零补白', () => {
  const p = ratio.padPlan(1200, 1500, '4:5'); // targetH = 1500
  assert.strictEqual(p.mode, 'pad');
  assert.strictEqual(p.top, 0);
  assert.strictEqual(p.bottom, 0);
});

test('padPlan：内容超出 → overflow（本期不裁，退智能）', () => {
  const p = ratio.padPlan(1200, 1600, '4:5'); // targetH 1500 < 1600
  assert.strictEqual(p.mode, 'overflow');
  assert.strictEqual(p.targetH, 1500);
});

test('padPlan：9:16 竖屏目标高取整', () => {
  const p = ratio.padPlan(1200, 1000, '9:16');
  assert.strictEqual(p.targetH, Math.round(1200 * 16 / 9)); // 2133
  assert.strictEqual(p.mode, 'pad');
});

test('CAP_LADDER：媒体缩放阶梯从大到小、首个为 1、末个最小、严格递减且都在 (0,1]', () => {
  const ladder = ratio.CAP_LADDER;
  assert.ok(Array.isArray(ladder) && ladder.length >= 3, '应是非空数组');
  assert.strictEqual(ladder[0], 1, '首级应为原始尺寸 1');
  assert.deepStrictEqual(ladder, [1, 0.7, 0.5, 0.35]);
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i] < ladder[i - 1], '应严格递减');
    assert.ok(ladder[i] > 0 && ladder[i] <= 1, '每级应落在 (0,1]');
  }
});
