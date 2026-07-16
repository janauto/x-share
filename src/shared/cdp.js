// CDP 受信输入序列（两栖模块）——「腾讯文档全自动粘贴」的按键参数构造。
//
// 背景：docs.qq.com 是 canvas 自绘编辑器，会用 isTrusted 过滤扩展合成的 paste
// 事件；唯一能产生 isTrusted=true 真实按键的通道是 chrome.debugger（CDP）的
// Input.dispatchKeyEvent。本模块只负责「按平台构造事件参数数组」这层纯逻辑，
// 不碰 chrome.*，node 可直接单测；attach/sendCommand/detach 的编排在
// background.js 的 txdocsTrustedPaste handler 里。
//
// 平台差异：
//   - mac：修饰键是 Meta（modifiers=4），且 CDP 在 mac 上不会自动把 ⌘V 映射成
//     编辑命令，需显式带 commands:['paste']；
//   - win/linux：修饰键是 Ctrl（modifiers=2），Ctrl+V 由浏览器自身翻译成粘贴。
//
// service worker 无 window，统一挂 globalThis；node 单测走 module.exports。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // userAgent → Input.dispatchKeyEvent 参数数组（rawKeyDown + keyUp 同参）。
  // 返回值直接逐个作为 chrome.debugger.sendCommand('Input.dispatchKeyEvent') 的
  // commandParams 使用。
  function txdocsPasteKeySequence(userAgent) {
    const isMac = String(userAgent || '').includes('Mac');
    const base = {
      modifiers: isMac ? 4 : 2, // 4=Meta(⌘)，2=Ctrl
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
    };
    if (isMac) base.commands = ['paste'];
    return [
      { type: 'rawKeyDown', ...base },
      { type: 'keyUp', ...base },
    ];
  }

  XS.txdocsPasteKeySequence = txdocsPasteKeySequence;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { txdocsPasteKeySequence };
  }
})();
