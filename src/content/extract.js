// 从 x.com 已渲染的 DOM 里提取推文数据。
// 依赖 X 相对稳定的 data-testid 锚点（tweet / tweetText / tweetPhoto / User-Name）。
// 长文/Articles 偶尔不会暴露 tweetText，需退回到 X Article 或可见正文节点提取。
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
    return inlineText(el).replace(/\u00a0/g, ' ').trim();
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
    return (el.innerText || normalizedText(el)).replace(/\u00a0/g, ' ').trim();
  }

  function pushTextBlock(out, text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (out.length) pushSeg(out, 'text', '\n\n');
    pushSeg(out, 'text', t);
  }

  // X Articles / longform：正文不在 tweetText，而在 twitterArticleRichTextView。
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

  // X 长文/Articles 有时不再给正文容器打 data-testid="tweetText"。
  // 退回到带 lang 的可见正文节点，并排除用户名、媒体、按钮、引用推文等区域。
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

  // 把 "1.2K" / "3.4M" / "1.2万" / "5,432" 解析成数字
  function parseCount(s) {
    if (!s) return 0;
    const t = String(s).trim().replace(/[,，\s]/g, '');
    const m = t.match(/^([\d.]+)\s*([KMkm万萬])?/);
    if (!m) return 0;
    let n = parseFloat(m[1]) || 0;
    const u = m[2];
    if (u === 'K' || u === 'k') n *= 1e3;
    else if (u === 'M' || u === 'm') n *= 1e6;
    else if (u === '万' || u === '萬') n *= 1e4;
    return Math.round(n);
  }

  function metric(article, testids) {
    for (const id of testids) {
      const btn = article.querySelector(`[data-testid="${id}"]`);
      if (btn) {
        // 优先用 aria-label 里的数字（更稳），退回可见文本
        const aria = btn.getAttribute('aria-label') || '';
        const am = aria.match(/([\d.,]+\s*[KMkm万萬]?)/);
        return parseCount(am ? am[1] : btn.textContent);
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

  function extractFrom(scope, isQuote) {
    const quoteEl = isQuote ? null : findQuote(scope);

    let textEl = null;
    for (const el of scope.querySelectorAll('[data-testid="tweetText"], [data-testid="noteTweetText"], [data-testid="articleText"]')) {
      if (!quoteEl || !quoteEl.contains(el)) { textEl = el; break; }
    }
    let segments = [];
    if (textEl) walkSegments(textEl, segments);
    if (!segments.length) segments = articleTextSegments(scope, quoteEl);
    if (!segments.length) segments = fallbackTextSegments(scope, quoteEl);
    const plainText = segments.map((s) => s.text).join('');

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

    let avatar = null;
    for (const img of scope.querySelectorAll('img[src*="profile_images"]')) {
      if (quoteEl && quoteEl.contains(img)) continue;
      avatar = upgradeAvatar(img.src);
      break;
    }

    const photos = [];
    for (const img of scope.querySelectorAll('[data-testid="tweetPhoto"] img')) {
      if (quoteEl && quoteEl.contains(img)) continue;
      if (img.src) photos.push(upgradePhoto(img.src));
    }

    let hasVideo = false, videoPoster = null;
    for (const v of scope.querySelectorAll('video')) {
      if (quoteEl && quoteEl.contains(v)) continue;
      hasVideo = true;
      if (v.poster && /^https?:/.test(v.poster)) videoPoster = v.poster;
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

    const d = {
      id, permalink, name, handle, avatar, segments, plainText,
      photos, hasVideo, videoPoster, datetime,
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

  // 去掉链接和 @/# 后，中文占比低于 25% 才需要翻译
  XS.needsTranslation = function (text) {
    const t = (text || '').replace(/https?:\/\/\S+|[@#]\S+/g, '').trim();
    if (!t) return false;
    const cjk = (t.match(/[一-鿿㐀-䶿]/g) || []).length;
    return cjk / t.length < 0.25;
  };
})();
