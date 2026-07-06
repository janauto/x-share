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
    for (const el of scope.querySelectorAll('[data-testid="tweetText"]')) {
      if (!quoteEl || !quoteEl.contains(el)) { textEl = el; break; }
    }
    const segments = [];
    if (textEl) walkSegments(textEl, segments);
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
