'use strict';
// CDP 受信输入管道的纯逻辑部分：按平台构造 ⌘V / Ctrl+V 按键事件序列。
// attach/sendCommand/detach 的编排依赖 chrome.debugger，只能真浏览器回归。
const { test } = require('node:test');
const assert = require('node:assert');
const { txdocsPasteKeySequence } = require('../src/shared/cdp.js');

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 两平台共有的字段完整性：rawKeyDown + keyUp 同参，v/KeyV/86 齐全
function assertCommonShape(seq) {
  assert.strictEqual(seq.length, 2);
  assert.strictEqual(seq[0].type, 'rawKeyDown');
  assert.strictEqual(seq[1].type, 'keyUp');
  for (const ev of seq) {
    assert.strictEqual(ev.key, 'v');
    assert.strictEqual(ev.code, 'KeyV');
    assert.strictEqual(ev.windowsVirtualKeyCode, 86);
    assert.strictEqual(ev.nativeVirtualKeyCode, 86);
  }
  // keyUp 与 rawKeyDown 除 type 外同参
  const { type: _t0, ...down } = seq[0];
  const { type: _t1, ...up } = seq[1];
  assert.deepStrictEqual(up, down);
}

test('txdocsPasteKeySequence：mac → Meta(4) + commands:[paste]', () => {
  const seq = txdocsPasteKeySequence(MAC_UA);
  assertCommonShape(seq);
  for (const ev of seq) {
    assert.strictEqual(ev.modifiers, 4); // Meta（⌘）
    assert.deepStrictEqual(ev.commands, ['paste']); // mac 需显式编辑命令
  }
});

test('txdocsPasteKeySequence：win → Ctrl(2)，不带 commands', () => {
  const seq = txdocsPasteKeySequence(WIN_UA);
  assertCommonShape(seq);
  for (const ev of seq) {
    assert.strictEqual(ev.modifiers, 2); // Ctrl
    assert.ok(!('commands' in ev), 'commands 仅 mac 需要');
  }
});

test('txdocsPasteKeySequence：UA 缺失/异常 → 按非 mac 处理', () => {
  for (const ua of ['', null, undefined]) {
    const seq = txdocsPasteKeySequence(ua);
    assertCommonShape(seq);
    assert.strictEqual(seq[0].modifiers, 2);
    assert.ok(!('commands' in seq[0]));
  }
});
