'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { DEFAULTS, normalizeConfig } = require('../src/shared/config-schema.js');

test('DEFAULTS 合并了两份来源（含 background 独有的 updateCheckIntervalHours）', () => {
  assert.strictEqual(DEFAULTS.updateCheckIntervalHours, 6);
  assert.strictEqual(DEFAULTS.apiBase, 'https://api.deepseek.com');
  assert.strictEqual(DEFAULTS.publishTarget, 'none');
  // options 版关心的键也在
  assert.strictEqual(DEFAULTS.autoHotN, 10);
  assert.strictEqual(DEFAULTS.redactMode, 'rules');
});

test('normalizeConfig 归一化空/缺省输入', () => {
  const c = normalizeConfig({});
  assert.strictEqual(c.hasKey, false);
  assert.strictEqual(c.translateDefault, true); // 缺省视为开
  assert.strictEqual(c.autoHotDefault, true);
  assert.strictEqual(c.autoHotN, 10);
  assert.strictEqual(c.redactMode, 'rules');
  assert.strictEqual(c.publishTarget, 'none');
  assert.strictEqual(c.publishConfigured, false);
});

test('normalizeConfig：hasKey 由 apiKey 派生', () => {
  assert.strictEqual(normalizeConfig({ apiKey: 'sk-x' }).hasKey, true);
  assert.strictEqual(normalizeConfig({ apiKey: '' }).hasKey, false);
});

test('normalizeConfig：translateDefault !== false 语义', () => {
  assert.strictEqual(normalizeConfig({ translateDefault: false }).translateDefault, false);
  assert.strictEqual(normalizeConfig({ translateDefault: undefined }).translateDefault, true);
  assert.strictEqual(normalizeConfig({ translateDefault: true }).translateDefault, true);
});

test('normalizeConfig：autoHotN 用 || 10 兜底', () => {
  assert.strictEqual(normalizeConfig({ autoHotN: 7 }).autoHotN, 7);
  assert.strictEqual(normalizeConfig({ autoHotN: 0 }).autoHotN, 10); // 0 视为缺省
});

test('publishConfigured：gist 需要 gistToken', () => {
  assert.strictEqual(normalizeConfig({ publishTarget: 'gist', gistToken: '' }).publishConfigured, false);
  assert.strictEqual(normalizeConfig({ publishTarget: 'gist', gistToken: 'ghp_x' }).publishConfigured, true);
});

test('publishConfigured：custom 与 cloudbase 都看 publishEndpoint', () => {
  assert.strictEqual(normalizeConfig({ publishTarget: 'custom', publishEndpoint: 'https://x' }).publishConfigured, true);
  assert.strictEqual(normalizeConfig({ publishTarget: 'custom', publishEndpoint: '' }).publishConfigured, false);
  assert.strictEqual(normalizeConfig({ publishTarget: 'cloudbase', publishEndpoint: 'https://x' }).publishConfigured, true);
  assert.strictEqual(normalizeConfig({ publishTarget: 'cloudbase', publishEndpoint: '' }).publishConfigured, false);
});

test('publishConfigured：none 恒 false', () => {
  assert.strictEqual(normalizeConfig({ publishTarget: 'none', gistToken: 'x', publishEndpoint: 'y' }).publishConfigured, false);
});

test('normalizeConfig：布尔字段用 !! 归一', () => {
  const c = normalizeConfig({ redactEnabled: 1, redactPII: 'yes', redactImages: 0 });
  assert.strictEqual(c.redactEnabled, true);
  assert.strictEqual(c.redactPII, true);
  assert.strictEqual(c.redactImages, false);
});
