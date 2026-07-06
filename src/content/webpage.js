// 生成「可打开的网页」——一个自包含的单文件 HTML 字符串。
// 图片全部内联为 data URL，无外部依赖，可直接下载打开、或上传到任意静态托管。
// 与长图共用同一份 payload（主推文 + 引用 + 勾选评论 + 译文）。
// 相比长图：文字可复制、可点链接、带原文/译文切换、移动端自适应（微信内置浏览器友好）。

(() => {
  const XS = (window.__XS = window.__XS || {});

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function segHtml(segments) {
    if (!segments || !segments.length) return '';
    return segments
      .map((s) => (s.type === 'ent' ? `<span class="ent">${esc(s.text)}</span>` : esc(s.text)))
      .join('')
      .replace(/\n/g, '<br>');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function photosHtml(photosData) {
    if (!photosData || !photosData.length) return '';
    const imgs = photosData.slice(0, 4).map((u) => `<img loading="lazy" src="${u}">`).join('');
    return `<div class="photos n${Math.min(photosData.length, 4)}">${imgs}</div>`;
  }

  function videoHtml(d) {
    if (!d.hasVideo) return '';
    const poster = d.videoPosterData ? `<img src="${d.videoPosterData}">` : '';
    const link = d.permalink ? ` <a href="${esc(d.permalink)}" target="_blank" rel="noopener">打开原文观看</a>` : '';
    return `<div class="video">${poster}<div class="vtag">🎬 视频内容 ·${link}</div></div>`;
  }

  function transHtml(d) {
    if (!d.translation) return '';
    return `<div class="trans">${segHtml([{ type: 'text', text: d.translation }])}</div>`;
  }

  function bodyHtml(d) {
    let h = '';
    if (d.segments && d.segments.length) h += `<div class="text">${segHtml(d.segments)}</div>`;
    h += transHtml(d);
    h += photosHtml(d.photosData);
    h += videoHtml(d);
    if (d.quote) h += quoteHtml(d.quote);
    return h;
  }

  function avatar(d, cls) {
    return d.avatarData ? `<img class="ava ${cls || ''}" src="${d.avatarData}">` : `<span class="ava ${cls || ''}"></span>`;
  }

  function quoteHtml(q) {
    return `<div class="quote"><div class="qhead">${avatar(q, 'xs')}<b>${esc(q.name)}</b><span class="handle">${esc(q.handle)}</span></div>${bodyHtml(q)}</div>`;
  }

  function replyHtml(d) {
    const eng = d.engagement && d.engagement.score
      ? `<div class="eng">❤ ${d.engagement.likes} · 🔁 ${d.engagement.retweets} · 💬 ${d.engagement.replies}</div>`
      : '';
    return `<div class="reply">${avatar(d, 'sm')}<div class="rbody"><div class="rline"><b>${esc(d.name)}</b><span class="handle">${esc(d.handle)}</span></div>${bodyHtml(d)}${eng}</div></div>`;
  }

  const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f9f9;color:#0f1419;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;background:#fff;min-height:100vh}
.bar{position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fff;border-bottom:1px solid #eff3f4}
.bar .t{font-weight:700;font-size:15px}
.toggle{margin-left:auto;font-size:13px;border:1px solid #cfd9de;border-radius:999px;padding:5px 12px;background:#fff;cursor:pointer;color:#0f1419}
.toggle.on{background:#1d9bf0;border-color:#1d9bf0;color:#fff}
.main{padding:16px}
.head{display:flex;align-items:center;gap:12px}
.ava{width:46px;height:46px;border-radius:50%;background:#eff3f4;object-fit:cover;flex:none;display:inline-block}
.ava.sm{width:32px;height:32px}.ava.xs{width:20px;height:20px}
.name{font-weight:700;font-size:16px}
.handle{color:#536471;font-size:13px;font-weight:400;margin-left:6px}
.text{margin-top:12px;font-size:16.5px;white-space:pre-wrap;word-wrap:break-word}
.ent{color:#1d9bf0}
.trans{margin-top:10px;font-size:16px;background:#f5f8fa;border-left:3px solid #1d9bf0;border-radius:0 10px 10px 0;padding:10px 14px;white-space:pre-wrap;word-wrap:break-word}
.photos{margin-top:12px;display:grid;gap:4px;border-radius:14px;overflow:hidden}
.photos img{width:100%;display:block;object-fit:cover;background:#eff3f4}
.photos.n1 img{max-height:70vh}
.photos.n2,.photos.n3,.photos.n4{grid-template-columns:1fr 1fr}
.photos.n2 img,.photos.n4 img{height:200px}.photos.n3 img{height:150px}
.video{margin-top:12px;position:relative;border-radius:14px;overflow:hidden;background:#000}
.video img{width:100%;display:block;opacity:.85}
.vtag{padding:8px 12px;font-size:13px;color:#536471;background:#f7f9f9}
.vtag a{color:#1d9bf0}
.quote{margin-top:12px;border:1px solid #e1e8ed;border-radius:14px;padding:12px}
.qhead{display:flex;align-items:center;gap:8px;font-size:14px}
.replies{border-top:10px solid #eff3f4}
.rtitle{padding:14px 16px 4px;color:#536471;font-size:13px;font-weight:700}
.reply{display:flex;gap:10px;padding:14px 16px;border-bottom:1px solid #f4f7f8}
.rbody{flex:1;min-width:0}
.rline{font-size:14px}
.reply .text{font-size:15px;margin-top:4px}
.eng{margin-top:8px;color:#8b98a5;font-size:12.5px}
.foot{padding:16px;color:#8b98a5;font-size:12px;border-top:1px solid #eff3f4;word-break:break-all}
.foot a{color:#8b98a5}
body.hide-trans .trans{display:none}
`;

  const TOGGLE_JS =
    "var b=document.getElementById('tg');b&&b.addEventListener('click',function(){document.body.classList.toggle('hide-trans');var on=!document.body.classList.contains('hide-trans');b.classList.toggle('on',on);b.textContent=on?'译文 开':'译文 关';});";

  XS.buildWebpageHtml = function (payload) {
    const { main, replies } = payload;
    const hasTrans =
      !!(main && main.translation) || (replies || []).some((r) => r && r.translation);

    const repliesHtml = replies && replies.length
      ? `<div class="replies"><div class="rtitle">精选评论 · ${replies.length} 条</div>${replies.map(replyHtml).join('')}</div>`
      : '';

    const src = main.permalink
      ? `原文：<a href="${esc(main.permalink)}" target="_blank" rel="noopener">${esc(main.permalink)}</a>`
      : '';
    const toggle = hasTrans ? `<button id="tg" class="toggle on">译文 开</button>` : '';

    return `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(main.name)} 的推文 · X 转发</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">
  <div class="bar"><span class="t">𝕏 转发</span>${toggle}</div>
  <div class="main">
    <div class="head">${avatar(main)}<div><div class="name">${esc(main.name)}</div><div class="handle" style="margin:0">${esc(main.handle)}</div></div></div>
    ${bodyHtml(main)}
  </div>
  ${repliesHtml}
  <div class="foot">${fmtDate(main.datetime) ? fmtDate(main.datetime) + ' · ' : ''}${src}</div>
</div>
<script>${TOGGLE_JS}</script>
</body></html>`;
  };
})();
