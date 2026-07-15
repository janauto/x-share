// 发射器：RenderIR →「复制图文」的富文本片段（扁平块级、全内联 style）。
//
// 为什么是「扁平块级」而不是嵌套 div：腾讯文档是 canvas 自绘富文本编辑器，粘贴时会把
// 嵌套 <div> 压平、剥掉 border-radius / border / background / display:flex / vertical-align，
// 也会把圆头像 <img> 当作行内大方块图——旧版的头像图 + 译文条 + 引用卡因此在腾讯文档里碎版。
// 于是只用编辑器最安全的块级标签：<p> <strong> <span style="color"> <blockquote> <img> <hr>，
// 禁用头像图 / border-radius / border-left / display / vertical-align / flex / 嵌套 div。
// 这套结构对公众号 / 语雀 / 飞书 / 印象笔记 粘贴同样更稳。
//
// 图片仍是内联 data URL：语雀/飞书/腾讯文档/印象笔记 粘贴时会自动重传托管；
// 公众号编辑器可能丢弃 data URL 图片（其图片需上传到自家服务器），属已知取舍。
//
// 语义已由 shared/ir.js 解决，本发射器只对 node.kind 做哑 switch（nodesToRichHtml）。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});
  const esc = XS.esc;

  // 实体（@handle / #tag / 链接）仍用蓝色 span 标出；段内换行 \n → <br>。
  function richSeg(segments) {
    if (!segments || !segments.length) return '';
    return segments
      .map((s) => (s.type === 'ent' ? `<span style="color:#1d9bf0">${esc(s.text)}</span>` : esc(s.text)))
      .join('')
      .replace(/\n/g, '<br>');
  }

  // 每张图独占一个 <p>，不加 border-radius（腾讯文档会剥）。
  function richImgs(urls) {
    if (!urls || !urls.length) return '';
    return urls
      .slice(0, 4)
      .map((u) => `<p><img src="${esc(u)}" style="max-width:100%"></p>`)
      .join('');
  }

  // 名字行：<strong>名字</strong> <span 灰>@handle</span>，无头像图。
  function richNameLine(d) {
    return `<p><strong>${esc(d.name || '')}</strong> <span style="color:#536471">${esc(d.handle || '')}</span></p>`;
  }

  // IR → 扁平富文本 HTML 的哑 switch。引用整体包 <blockquote>，内部同样扁平。
  function nodesToRichHtml(ir) {
    let h = '';
    for (const node of ir) {
      if (node.kind === 'text') {
        h += `<p style="font-size:15px;line-height:1.7">${richSeg(node.segments)}</p>`;
      } else if (node.kind === 'translation') {
        // 译文用蓝色正文段，保留【译】前缀更稳（编辑器剥背景色时仍能一眼区分）。
        h += `<p style="color:#1d9bf0">【译】${esc(node.text).replace(/\n/g, '<br>')}</p>`;
      } else if (node.kind === 'photos') {
        h += richImgs(node.urls);
      } else if (node.kind === 'video') {
        if (node.poster) h += `<p><img src="${esc(node.poster)}" style="max-width:100%"></p>`;
      } else if (node.kind === 'quote') {
        h += `<blockquote>${richNameLine(node.tweet)}${nodesToRichHtml(node.ir)}</blockquote>`;
      }
    }
    return h;
  }

  XS.buildRichHtml = function (payload) {
    const { main, replies } = payload;
    let h = '';
    h += richNameLine(main);
    h += nodesToRichHtml(XS.buildIR(main));
    if (replies && replies.length) {
      // 评论区：<hr> 分隔 + 小标题；每条评论 = 名字行 + 正文 + 图，评论间再用 <hr> 分隔。
      h += '<hr>';
      h += `<p style="color:#536471">精选评论 · ${replies.length} 条</p>`;
      replies.forEach((r, i) => {
        if (i > 0) h += '<hr>';
        h += richNameLine(r);
        h += nodesToRichHtml(XS.buildIR(r));
      });
    }
    // 末尾：时间 · 原文链接（纯文本，不用 <a>——编辑器会自动识别 URL 成链接）。
    const t = XS.fmtDate(main.datetime);
    const link = main.permalink ? `原文：${esc(main.permalink)}` : '';
    h += `<p style="color:#8b98a5;font-size:12px">${t ? t + ' · ' : ''}${link}</p>`;
    return h;
  };
})();
