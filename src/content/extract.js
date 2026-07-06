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
      if (tid === 'tweetText') {
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

    // 有序内容块 + 派生的兼容字段（聚合文本 / 扁平图片 / 视频）
    const photos = [];
    const blocks = orderedBlocks(scope, quoteEl, photos);
    const segments = [];
    for (const b of blocks) if (b.type === 'text') for (const s of b.segments) pushSeg(segments, s.type, s.text);
    const plainText = segments.map((s) => s.text).join('');
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

    const d = {
      id, permalink, name, handle, avatar, avatarSrc, segments, plainText,
      photos, blocks, hasVideo, videoPoster, datetime,
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

  // 头像加载失败时的「字母头像」回退：取名字/账号首字 + 稳定配色
  XS.avatarInitial = function (name, handle) {
    const s = (name || handle || '').trim().replace(/^@+/, ''); // 账号形如 @bob，去掉前导 @ 再取首字
    const ch = s ? [...s][0] : '';
    return ch ? ch.toUpperCase() : '#';
  };
  XS.avatarColor = function (seed) {
    const palette = ['#1d9bf0', '#f4212e', '#00ba7c', '#ffad1f', '#7856ff', '#f91880', '#ff7a00'];
    let h = 0;
    const s = seed || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  };
})();
