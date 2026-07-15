// 从 x.com 已渲染的 DOM 里提取推文数据。
// 依赖 X 相对稳定的 data-testid 锚点（tweet / tweetText / tweetPhoto / User-Name）。
// X 改版导致失效时，优先检查这里的选择器。

(() => {
  const XS = (window.__XS = window.__XS || {});

  const ID_RE = /\/status\/(\d+)/;

  XS.isStatusPage = () => ID_RE.test(location.pathname);

  XS.locationTweetId = () => {
    const m = location.pathname.match(ID_RE);
    return m ? m[1] : null;
  };

  function canonicalLocationUrl() {
    const m = location.pathname.match(/^\/[^/]+\/status\/\d+/);
    return m ? location.origin + m[0] : location.href.split('?')[0];
  }

  // 取元素内的纯文本，emoji 图片用 alt 还原成 unicode
  function inlineText(el) {
    let out = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
      else if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === 'IMG') out += n.getAttribute('alt') || '';
        else if (n.tagName === 'BR') out += '\n';
        else out += inlineText(n);
      }
    });
    return out;
  }

  // 把 tweetText 解析成分段：普通文本 / 实体（@提及、#标签、链接）
  function walkSegments(el, out) {
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) pushSeg(out, 'text', n.nodeValue);
      else if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === 'IMG') pushSeg(out, 'text', n.getAttribute('alt') || '');
        else if (n.tagName === 'BR') pushSeg(out, 'text', '\n');
        else if (n.tagName === 'A') pushSeg(out, 'ent', inlineText(n));
        else walkSegments(n, out);
      }
    });
  }

  function pushSeg(out, type, text) {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  }

  // ---------- X 长文（Article）正文兜底 ----------
  // X 长文不用 tweetText 装正文，而是标题+富文本单独的容器；
  // 常规 DOM 走查找不到任何 'text' 块时，退到这里找正文，
  // 找不到再退到「有 lang 属性的可见文本节点」这个更泛的兜底。
  function isInsideQuote(el, quoteEl) {
    return !!(quoteEl && quoteEl.contains(el));
  }

  function isTextNoise(el, quoteEl) {
    if (isInsideQuote(el, quoteEl)) return true;
    if (el.closest('[data-testid="User-Name"], [data-testid="tweetPhoto"], video')) return true;
    if (el.closest('button, [role="button"], [role="menu"], [data-testid="caret"]')) return true;
    if (el.querySelector('time')) return true;
    return false;
  }

  function normalizedText(el) {
    return inlineText(el).replace(/ /g, ' ').trim();
  }

  function meaningfulText(el) {
    const t = normalizedText(el);
    if (!t) return '';
    if (/^(show more|显示更多|查看更多|展开|更多)$/i.test(t)) return '';
    return t;
  }

  function findFirstOutside(scope, selector, quoteEl) {
    for (const el of scope.querySelectorAll(selector)) {
      if (!isInsideQuote(el, quoteEl)) return el;
    }
    return null;
  }

  function visibleText(el) {
    return (el.innerText || normalizedText(el)).replace(/ /g, ' ').trim();
  }

  function pushTextBlock(out, text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (out.length) pushSeg(out, 'text', '\n\n');
    pushSeg(out, 'text', t);
  }

  // 长文：标题 + 正文富文本，在 twitterArticleReadView 容器里
  function articleTextSegments(scope, quoteEl) {
    const articleRoot = findFirstOutside(scope, '[data-testid="twitterArticleReadView"]', quoteEl);
    if (!articleRoot) return [];

    const out = [];
    const title = findFirstOutside(articleRoot, '[data-testid="twitter-article-title"]', quoteEl);
    const body = findFirstOutside(
      articleRoot,
      '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]',
      quoteEl
    );

    pushTextBlock(out, title && visibleText(title));
    pushTextBlock(out, body && visibleText(body));
    return out;
  }

  // 再退一步：找带 lang 属性的可见正文节点，排除用户名/媒体/按钮/引用等噪声区域
  function fallbackTextSegments(scope, quoteEl) {
    const raw = [...scope.querySelectorAll('div[lang], span[lang]')]
      .filter((el) => !isTextNoise(el, quoteEl))
      .filter((el) => meaningfulText(el));

    const blocks = raw.filter((el) => !raw.some((other) => other !== el && other.contains(el)));
    const out = [];
    blocks.forEach((el) => {
      if (out.length) pushSeg(out, 'text', '\n\n');
      walkSegments(el, out);
    });
    return out;
  }

  // 按文档顺序把推文内容切成有序块：文本 / 图片组 / 视频 / 引用。
  // 关键：X 的图文本可以「文字→图→文字」穿插（长推文/展开后），
  // 旧做法把「所有文字」和「所有图片」拆成两个平铺数组，渲染时图片一律甩到末尾，
  // 位置就错了。这里保留原始文档顺序，渲染端按块顺序输出即可归位。
  // photos 数组同时被填充（扁平，供 inlineImages 抓图），块里存的是它的下标。
  function orderedBlocks(scope, quoteEl, photos) {
    const blocks = [];
    let group = null;
    const flush = () => { if (group && group.length) blocks.push({ type: 'photos', idx: group }); group = null; };
    const visit = (node) => {
      if (node.nodeType !== 1) return;
      if (quoteEl && node === quoteEl) { flush(); blocks.push({ type: 'quote' }); return; } // 不下钻引用内部
      const tid = node.getAttribute && node.getAttribute('data-testid');
      // noteTweetText/articleText：长推文/长文偶尔用这两个变体装正文，而非 tweetText
      if (tid === 'tweetText' || tid === 'noteTweetText' || tid === 'articleText') {
        flush();
        const segs = [];
        walkSegments(node, segs);
        blocks.push({ type: 'text', segments: segs });
        return;
      }
      if (tid === 'tweetPhoto') {
        const img = node.querySelector('img');
        if (img && img.src && photos.length < 4) { // X 单条最多 4 图
          const i = photos.length;
          photos.push(upgradePhoto(img.src));
          (group = group || []).push(i);
        }
        return; // 不再下钻，避免重复
      }
      if (node.tagName === 'VIDEO') {
        flush();
        blocks.push({ type: 'video', poster: (node.poster && /^https?:/.test(node.poster)) ? node.poster : null });
        return;
      }
      for (const c of node.childNodes) visit(c);
    };
    for (const c of scope.childNodes) visit(c);
    flush();

    // 常规 tweetText 走查没找到任何正文（典型是 X 长文/Article）：
    // 退到长文专用容器，再退到「可见 lang 节点」兜底。找到就整段前插为一个
    // text 块——长文本身不追求与图片精确穿插，「先给正文再给配图」已是很大改善
    // （原来是正文完全消失，只剩作者和几张毫无上下文的图）。
    if (!blocks.some((b) => b.type === 'text')) {
      let segs = articleTextSegments(scope, quoteEl);
      if (!segs.length) segs = fallbackTextSegments(scope, quoteEl);
      if (segs.length) blocks.unshift({ type: 'text', segments: segs });
    }
    return blocks;
  }

  // 引用推文容器：article 内可导航的 div[role="link"]，且里面有推文内容
  function findQuote(article) {
    for (const c of article.querySelectorAll('div[role="link"]')) {
      if (c.querySelector('[data-testid="tweetText"], [data-testid="User-Name"]')) return c;
    }
    return null;
  }

  function timeElOf(scope, excludeEl) {
    for (const t of scope.querySelectorAll('time')) {
      if (!excludeEl || !excludeEl.contains(t)) return t;
    }
    return null;
  }

  function upgradePhoto(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'pbs.twimg.com' && u.searchParams.has('name')) {
        u.searchParams.set('name', 'large');
      }
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  function upgradeAvatar(url) {
    return url ? url.replace('_normal.', '_200x200.') : null;
  }

  // parseCount（"1.2K" / "1.2万" / "5,432" → 数字）已收敛到 shared/fmt.js（XS.parseCount）。

  function metric(article, testids) {
    for (const id of testids) {
      const btn = article.querySelector(`[data-testid="${id}"]`);
      if (btn) {
        // 优先用 aria-label 里的数字（更稳），退回可见文本
        const aria = btn.getAttribute('aria-label') || '';
        const am = aria.match(/([\d.,]+\s*[KMkm万萬]?)/);
        return XS.parseCount(am ? am[1] : btn.textContent);
      }
    }
    return 0;
  }

  // 从回复/推文的操作栏解析互动量。引用推文没有操作栏，故只对 article 顶层有意义。
  // 热度分：点赞 + 转推×2 + 回复（转推更稀缺，权重更高）。
  XS.extractEngagement = function (article) {
    const likes = metric(article, ['like', 'unlike']);
    const retweets = metric(article, ['retweet', 'unretweet']);
    const replies = metric(article, ['reply']);
    return { likes, retweets, replies, score: likes + retweets * 2 + replies };
  };

  // 快速拿推文 ID（选择模式下频繁调用，保持轻量）
  XS.quickTweetId = function (article) {
    const quote = findQuote(article);
    const t = timeElOf(article, quote);
    const a = t && t.closest('a');
    if (a) {
      const m = (a.getAttribute('href') || '').match(ID_RE);
      if (m) return m[1];
    }
    // 详情页主推文的时间通常不带链接，用 URL 里的 ID
    if (article.getAttribute('tabindex') === '-1') return XS.locationTweetId();
    return null;
  };

  // 认证徽章：X 在 User-Name 里放 svg[data-testid="icon-verified"]（或带 Verified aria-label）。
  // kind 用于选蓝/金/灰路径：默认蓝；aria-label / 类名含机构/政府线索时升级。
  // 注意：kind 的精确判定依赖 X 当前 DOM，属需浏览器校验项（见 README 回归清单）。
  function extractVerified(scope, quoteEl) {
    for (const un of scope.querySelectorAll('[data-testid="User-Name"]')) {
      if (quoteEl && quoteEl.contains(un)) continue;
      const svg = un.querySelector('svg[data-testid="icon-verified"], svg[aria-label*="Verified"], svg[aria-label*="认证"]');
      if (!svg) return { verified: false, verifiedKind: null };
      const hint = ((svg.getAttribute('aria-label') || '') + ' ' + (un.className || '')).toLowerCase();
      let kind = 'blue';
      if (/gov|government|政府/.test(hint)) kind = 'gray';
      else if (/business|organization|机构|企业|gold/.test(hint)) kind = 'gold';
      return { verified: true, verifiedKind: kind };
    }
    return { verified: false, verifiedKind: null };
  }

  function extractFrom(scope, isQuote) {
    const quoteEl = isQuote ? null : findQuote(scope);

    // 有序内容块 + 派生的兼容字段（聚合文本 / 扁平图片 / 视频）
    const photos = [];
    const blocks = orderedBlocks(scope, quoteEl, photos);
    const segments = XS.aggregateSegments(blocks); // 相邻同类型段合并，与旧内联聚合一致
    const plainText = XS.plainTextOf(segments);
    let hasVideo = false, videoPoster = null;
    for (const b of blocks) if (b.type === 'video') { hasVideo = true; if (b.poster) videoPoster = b.poster; break; }

    let name = '', handle = '';
    for (const un of scope.querySelectorAll('[data-testid="User-Name"]')) {
      if (quoteEl && quoteEl.contains(un)) continue;
      const firstLink = un.querySelector('a');
      if (firstLink) name = inlineText(firstLink).trim();
      if (!name) name = (inlineText(un).trim().split('\n')[0] || '').trim();
      for (const el of un.querySelectorAll('a, span')) {
        const t = (el.textContent || '').trim();
        if (t.startsWith('@')) { handle = t; break; }
      }
      break;
    }

    let avatar = null, avatarSrc = null;
    for (const img of scope.querySelectorAll('img[src*="profile_images"]')) {
      if (quoteEl && quoteEl.contains(img)) continue;
      avatarSrc = img.src;             // 原始 DOM 尺寸，作升级失败时的回退
      avatar = upgradeAvatar(img.src); // 升级到 _200x200；部分头像无此变体，故保留原始 src 兜底
      break;
    }

    const tEl = timeElOf(scope, quoteEl);
    const datetime = tEl ? tEl.getAttribute('datetime') : null;
    let permalink = null, id = null;
    const ta = tEl && tEl.closest('a');
    if (ta && ID_RE.test(ta.href)) {
      permalink = ta.href.split('?')[0];
      id = permalink.match(ID_RE)[1];
    }

    const { verified, verifiedKind } = extractVerified(scope, quoteEl);

    const d = {
      id, permalink, name, handle, avatar, avatarSrc, segments, plainText,
      photos, blocks, hasVideo, videoPoster, datetime, verified, verifiedKind,
      quote: null, translation: null,
    };
    if (quoteEl) d.quote = extractFrom(quoteEl, true);
    return d;
  }

  XS.extractTweet = function (article) {
    const d = extractFrom(article, false);
    if (!d.id && article.getAttribute('tabindex') === '-1') {
      d.id = XS.locationTweetId();
      d.permalink = canonicalLocationUrl();
    }
    if (!d.permalink) d.permalink = canonicalLocationUrl();
    if (!d.name && !d.plainText && !d.photos.length) return null; // 解析失败
    d.engagement = XS.extractEngagement(article);
    return d;
  };

  // 详情页主推文：优先 tabindex=-1（X 给聚焦推文的标记），退回第一条
  XS.findMainArticle = function () {
    const arts = document.querySelectorAll('article[data-testid="tweet"]');
    if (!arts.length) return null;
    for (const a of arts) {
      if (a.getAttribute('tabindex') === '-1') return a;
    }
    return arts[0];
  };

  // needsTranslation / avatarInitial / avatarColor 已收敛到 shared/fmt.js
  // （XS.needsTranslation / XS.avatarInitial / XS.avatarColor），fmt.js 在 manifest 里先于本脚本加载。
})();
