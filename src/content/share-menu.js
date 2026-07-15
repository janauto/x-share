// 分享菜单注入（设计 §03 主入口 / 排期 P3，best-effort）——
// 在 X 自己的分享下拉菜单（复制链接 / 通过私信分享…）里追加一行「以图片分享」。
// 这是伪装度最高的入口：新菜单项像 X 自己发布的功能。
//
// 实现策略（对 X 改版尽量鲁棒）：
//   1. 捕获阶段监听点击：用户点开某条推文的分享按钮时，立刻提取并缓存该推文数据
//      （菜单是 portal 渲染的，从菜单本身找不回是哪条推文；且虚拟滚动随时回收 DOM）。
//   2. MutationObserver 等分享菜单出现（含「复制链接」项的 role=menu），
//      **克隆现有菜单项**、替换文案与图标——样式/行高/hover 全部原样继承，零硬编码。
//   3. 点击注入项 → Escape 关菜单 → XS.quickShare(缓存推文)（零摩擦通道）。
// 任一步失败都静默放弃——FAB 与 Shift+S 始终可用，本模块只是锦上添花。
// 需真实浏览器校验（X 菜单 DOM 属易变面），失败症状 = 菜单里没有新项，无副作用。
//
// 加载顺序：位于 content.js 之后（依赖其挂出的 XS.quickShare）。

(() => {
  if (window.__XS_SHAREMENU_LOADED) return;
  window.__XS_SHAREMENU_LOADED = true;
  const XS = window.__XS;

  const ITEM_MARK = 'xsShareAsImage';
  let cachedTweet = null; // 最近一次点分享按钮时提取的推文数据
  let cachedAt = 0;

  // 图片图标（X 官方 photo 路径），替换克隆项里的原图标
  const IMG_ICON_PATH =
    'M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.784 7 8 7.784 8 8.75s.784 1.75 1.75 1.75 1.75-.784 1.75-1.75S10.716 7 9.75 7z';

  // 分享按钮识别：article 操作栏（role=group）里 aria-label 含 分享/Share 的按钮
  function isShareButton(el) {
    const btn = el.closest('button[aria-label], [role="button"][aria-label]');
    if (!btn) return null;
    const label = btn.getAttribute('aria-label') || '';
    if (!/分享|share/i.test(label)) return null;
    if (!btn.closest('[role="group"]')) return null;
    return btn;
  }

  // 点分享按钮的瞬间缓存推文数据（捕获阶段，先于菜单打开）
  document.addEventListener('click', (e) => {
    try {
      const btn = isShareButton(e.target);
      if (!btn) return;
      const article = btn.closest('article[data-testid="tweet"]');
      if (!article) return;
      const d = XS.extractTweet(article);
      if (d) { cachedTweet = d; cachedAt = Date.now(); }
    } catch (_) { /* 静默：本模块不许影响页面 */ }
  }, true);

  // 在出现的分享菜单里找「复制链接」类目作参照
  function findAnchorItem(menu) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    for (const it of items) {
      const t = (it.textContent || '').trim();
      if (/复制链接|Copy link/i.test(t)) return it;
    }
    return items.length ? items[items.length - 1] : null;
  }

  function injectItem(menu) {
    if (menu.querySelector(`[data-${ITEM_MARK}]`)) return; // 已注入
    if (!cachedTweet || Date.now() - cachedAt > 15000) return; // 无新鲜缓存：可能不是推文分享菜单
    const anchor = findAnchorItem(menu);
    if (!anchor) return;

    // 克隆参照项：样式/结构原样继承，替换文案与图标
    const clone = anchor.cloneNode(true);
    clone.setAttribute(`data-${ITEM_MARK}`, '1');
    // 替换文案：找最深的纯文本 span
    const spans = [...clone.querySelectorAll('span')].filter((s) => !s.children.length && (s.textContent || '').trim());
    const textEl = spans[spans.length - 1];
    if (!textEl) return;
    textEl.textContent = '以图片分享';
    // 替换图标 path（保留 svg 尺寸/viewBox）
    const path = clone.querySelector('svg path');
    if (path) path.setAttribute('d', IMG_ICON_PATH);

    const tweet = cachedTweet;
    clone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Escape 关掉 X 的菜单，再走零摩擦通道
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      setTimeout(() => { if (XS.quickShare) XS.quickShare(tweet); }, 80);
    }, true);

    anchor.parentNode.insertBefore(clone, anchor.nextSibling);
  }

  // 等菜单出现：X 的下拉菜单是动态 portal，加到 DOM 时注入
  new MutationObserver((muts) => {
    try {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const menu = n.matches && n.matches('[role="menu"]') ? n : n.querySelector && n.querySelector('[role="menu"]');
          if (menu) injectItem(menu);
        }
      }
    } catch (_) { /* 静默 */ }
  }).observe(document.body, { childList: true, subtree: true });
})();
