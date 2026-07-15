'use strict';
// 主题 token 系统的纯逻辑：token 值、rgb 解析、就近主题判定、偏好解析。
const { test } = require('node:test');
const assert = require('node:assert');
const theme = require('../src/shared/theme.js');

test('THEMES：三主题 token 值对齐设计令牌', () => {
  assert.strictEqual(theme.THEMES.light.bg, '#FFFFFF');
  assert.strictEqual(theme.THEMES.light.text, '#0F1419');
  assert.strictEqual(theme.THEMES.light.text2, '#536471');
  assert.strictEqual(theme.THEMES.dim.bg, '#15202B');
  assert.strictEqual(theme.THEMES.dim.text, '#F7F9F9');
  assert.strictEqual(theme.THEMES.lightsout.bg, '#000000');
  assert.strictEqual(theme.THEMES.lightsout.text, '#E7E9EA');
  assert.strictEqual(theme.THEMES.lightsout.border, '#2F3336');
  // accent 三主题共用
  assert.strictEqual(theme.THEMES.light.accent, '#1D9BF0');
  assert.strictEqual(theme.THEMES.dim.accent, '#1D9BF0');
  assert.strictEqual(theme.THEMES.lightsout.accent, '#1D9BF0');
});

test('parseRgb：rgb()/rgba()/#hex → [r,g,b]', () => {
  assert.deepStrictEqual(theme.parseRgb('rgb(21, 32, 43)'), [21, 32, 43]);
  assert.deepStrictEqual(theme.parseRgb('rgba(0, 0, 0, 1)'), [0, 0, 0]);
  assert.deepStrictEqual(theme.parseRgb('#15202B'), [21, 32, 43]);
  assert.deepStrictEqual(theme.parseRgb('#ffffff'), [255, 255, 255]);
});

test('parseRgb：空/非法 → null', () => {
  assert.strictEqual(theme.parseRgb(''), null);
  assert.strictEqual(theme.parseRgb('garbage'), null);
  assert.strictEqual(theme.parseRgb(null), null);
});

test('pickThemeByBg：三锚点精确 + 就近 + 解析失败退 light', () => {
  assert.strictEqual(theme.pickThemeByBg('rgb(255,255,255)'), 'light');
  assert.strictEqual(theme.pickThemeByBg('rgb(21,32,43)'), 'dim');
  assert.strictEqual(theme.pickThemeByBg('rgb(0,0,0)'), 'lightsout');
  // 就近：接近纯白 → light；接近暗蓝 → dim
  assert.strictEqual(theme.pickThemeByBg('rgb(250,250,250)'), 'light');
  assert.strictEqual(theme.pickThemeByBg('rgb(24,35,46)'), 'dim');
  // 解析失败 → light
  assert.strictEqual(theme.pickThemeByBg('garbage'), 'light');
});

test('resolveTheme：固定项直选，follow 用 pageBg 判定', () => {
  assert.strictEqual(theme.resolveTheme('light').key, 'light');
  assert.strictEqual(theme.resolveTheme('dim').key, 'dim');
  assert.strictEqual(theme.resolveTheme('lightsout').key, 'lightsout');
  assert.strictEqual(theme.resolveTheme('follow', 'rgb(0,0,0)').key, 'lightsout');
  assert.strictEqual(theme.resolveTheme('follow', 'rgb(21,32,43)').key, 'dim');
  // follow 无 pageBg → light；非法 pref 当 follow → light
  assert.strictEqual(theme.resolveTheme('follow', null).key, 'light');
  assert.strictEqual(theme.resolveTheme('bogus', null).key, 'light');
});

test('detectPageBg：node（无 document）返回 null', () => {
  assert.strictEqual(theme.detectPageBg(), null);
});

test('themeFor：node 下固定项仍生效，follow 退 light', () => {
  assert.strictEqual(theme.themeFor('dim').key, 'dim');
  assert.strictEqual(theme.themeFor('lightsout').key, 'lightsout');
  assert.strictEqual(theme.themeFor('follow').key, 'light'); // 无 DOM → detectPageBg null
});
