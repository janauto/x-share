// 发射器：RenderIR → 自包含单文件网页 HTML（class + <style>）。
// 图片全部内联为 data URL，无外部依赖，可直接下载打开、或上传到任意静态托管。
// 相比长图：文字可复制、可点链接、带原文/译文切换、移动端自适应（微信内置浏览器友好）。
//
// 「无痕 Seamless」新版：网页也跟随主题——CSS 用变量，:root 由 payload.theme 注入，
// 三主题（浅色/暗蓝/纯黑）一致。自包含网页不在 x.com 页内，注入 <style> 不受 CSP 约束。
//
// 语义已由 shared/ir.js 解决，本发射器只对 node.kind 做哑 switch。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});
  const esc = XS.esc;

  const FALLBACK_LIGHT = {
    key: 'light', bg: '#FFFFFF', text: '#0F1419', text2: '#536471',
    border: '#EFF3F4', elev: '#F7F9F9', accent: '#1D9BF0',
  };
  function resolvePageTheme(theme) {
    if (theme && typeof theme === 'object') return theme;
    if (XS.theme && XS.theme.resolveTheme) return XS.theme.resolveTheme(typeof theme === 'string' ? theme : 'light', null);
    return FALLBACK_LIGHT;
  }

  // payload.theme → :root CSS 变量。深色主题声明 color-scheme:dark，页面背景比卡片略深一档。
  function themeVars(theme) {
    const t = resolvePageTheme(theme);
    const dark = t.key !== 'light';
    const backdrop = dark ? t.bg : (t.elev || '#F7F9F9');
    return `:root{color-scheme:${dark ? 'dark' : 'light'};` +
      `--surface:${t.bg};--backdrop:${backdrop};--text:${t.text};--text2:${t.text2};` +
      `--border:${t.border};--accent:${t.accent};--elev:${t.elev || backdrop}}`;
  }

  function segHtml(segments) {
    if (!segments || !segments.length) return '';
    return segments
      .map((s) => (s.type === 'ent' ? `<span class="ent">${esc(s.text)}</span>` : esc(s.text)))
      .join('')
      .replace(/\n/g, '<br>');
  }

  function photosHtml(urls) {
    if (!urls || !urls.length) return '';
    const imgs = urls.slice(0, 4).map((u) => `<img loading="lazy" src="${esc(u)}">`).join('');
    return `<div class="photos n${Math.min(urls.length, 4)}">${imgs}</div>`;
  }

  function videoHtml(node) {
    const poster = node.poster ? `<img src="${esc(node.poster)}">` : '';
    const link = node.permalink ? ` <a href="${esc(node.permalink)}" target="_blank" rel="noopener">打开原文观看</a>` : '';
    return `<div class="video">${poster}<div class="vtag">🎬 视频内容 ·${link}</div></div>`;
  }

  // IR → HTML 的哑 switch
  function nodesToPageHtml(ir) {
    let h = '';
    for (const node of ir) {
      if (node.kind === 'text') h += `<div class="text">${segHtml(node.segments)}</div>`;
      else if (node.kind === 'translation') h += `<div class="trans">${segHtml([{ type: 'text', text: node.text }])}</div>`;
      else if (node.kind === 'photos') h += photosHtml(node.urls);
      else if (node.kind === 'video') h += videoHtml(node);
      else if (node.kind === 'quote') h += quoteHtml(node);
    }
    return h;
  }

  function avatar(d, cls) {
    if (d.avatarData) return `<img class="ava ${cls || ''}" src="${esc(d.avatarData)}">`;
    const bg = XS.avatarColor(d.handle || d.name);
    return `<span class="ava ini ${cls || ''}" style="background:${bg}">${esc(XS.avatarInitial(d.name, d.handle))}</span>`;
  }

  function quoteHtml(node) {
    const q = node.tweet;
    return `<div class="quote"><div class="qhead">${avatar(q, 'xs')}<b>${esc(q.name)}</b><span class="handle">${esc(q.handle)}</span></div>${nodesToPageHtml(node.ir)}</div>`;
  }

  function replyHtml(d) {
    const eng = d.engagement && d.engagement.score
      ? `<div class="eng">❤ ${d.engagement.likes} · 🔁 ${d.engagement.retweets} · 💬 ${d.engagement.replies}</div>`
      : '';
    return `<div class="reply">${avatar(d, 'sm')}<div class="rbody"><div class="rline"><b>${esc(d.name)}</b><span class="handle">${esc(d.handle)}</span></div>${nodesToPageHtml(XS.buildIR(d))}${eng}</div></div>`;
  }

  // 颜色一律走 CSS 变量（由 themeVars 注入 :root），故三主题共用这一份结构。
  const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--backdrop);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;background:var(--surface);min-height:100vh}
.bar{position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--border)}
.bar .t{font-weight:700;font-size:15px}
.toggle{margin-left:auto;font-size:13px;border:1px solid var(--border);border-radius:999px;padding:5px 12px;background:var(--surface);cursor:pointer;color:var(--text)}
.toggle.on{background:var(--accent);border-color:var(--accent);color:#fff}
.main{padding:16px}
.head{display:flex;align-items:center;gap:12px}
.ava{width:46px;height:46px;border-radius:50%;background:var(--elev);object-fit:cover;flex:none;display:inline-block}
.ava.sm{width:32px;height:32px}.ava.xs{width:20px;height:20px}
.ava.ini{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:20px}
.ava.sm.ini{font-size:14px}.ava.xs.ini{font-size:11px}
.name{font-weight:700;font-size:16px}
.handle{color:var(--text2);font-size:13px;font-weight:400;margin-left:6px}
.text{margin-top:12px;font-size:16.5px;white-space:pre-wrap;word-wrap:break-word}
.ent{color:var(--accent)}
.trans{margin-top:10px;font-size:16px;background:var(--elev);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding:10px 14px;white-space:pre-wrap;word-wrap:break-word}
.photos{margin-top:12px;display:grid;gap:4px;border-radius:14px;overflow:hidden}
.photos img{width:100%;display:block;object-fit:cover;background:var(--elev)}
.photos.n1 img{max-height:70vh}
.photos.n2,.photos.n3,.photos.n4{grid-template-columns:1fr 1fr}
.photos.n2 img,.photos.n4 img{height:200px}.photos.n3 img{height:150px}
.video{margin-top:12px;position:relative;border-radius:14px;overflow:hidden;background:#000}
.video img{width:100%;display:block;opacity:.85}
.vtag{padding:8px 12px;font-size:13px;color:var(--text2);background:var(--backdrop)}
.vtag a{color:var(--accent)}
.quote{margin-top:12px;border:1px solid var(--border);border-radius:14px;padding:12px}
.qhead{display:flex;align-items:center;gap:8px;font-size:14px}
.replies{border-top:10px solid var(--border)}
.rtitle{padding:14px 16px 4px;color:var(--text2);font-size:13px;font-weight:700}
.reply{display:flex;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)}
.rbody{flex:1;min-width:0}
.rline{font-size:14px}
.reply .text{font-size:15px;margin-top:4px}
.eng{margin-top:8px;color:var(--text2);font-size:12.5px}
.foot{padding:16px;color:var(--text2);font-size:12px;border-top:1px solid var(--border);word-break:break-all}
.foot a{color:var(--text2)}
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
<style>${themeVars(payload.theme)}${CSS}</style>
</head><body>
<div class="wrap">
  <div class="bar"><span class="t">𝕏 转发</span>${toggle}</div>
  <div class="main">
    <div class="head">${avatar(main)}<div><div class="name">${esc(main.name)}</div><div class="handle" style="margin:0">${esc(main.handle)}</div></div></div>
    ${nodesToPageHtml(XS.buildIR(main))}
  </div>
  ${repliesHtml}
  <div class="foot">${XS.fmtDate(main.datetime) ? XS.fmtDate(main.datetime) + ' · ' : ''}${src}</div>
</div>
<script>${TOGGLE_JS}</script>
</body></html>`;
  };
})();
