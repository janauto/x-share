// 发射器：RenderIR →「复制图文」的富文本片段（全内联 style）。
// 用内联 style（不用 class + <style>），因为粘贴进富文本编辑器时外部样式表会被丢弃。
// 图片仍是内联 data URL：语雀/飞书/腾讯文档/印象笔记 粘贴时会自动重传托管；
// 公众号编辑器可能丢弃 data URL 图片（其图片需上传到自家服务器），属已知取舍。
//
// 语义已由 shared/ir.js 解决，本发射器只对 node.kind 做哑 switch。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});
  const esc = XS.esc;

  function richSeg(segments) {
    if (!segments || !segments.length) return '';
    return segments
      .map((s) => (s.type === 'ent' ? `<span style="color:#1d9bf0">${esc(s.text)}</span>` : esc(s.text)))
      .join('')
      .replace(/\n/g, '<br>');
  }

  function richImgs(urls) {
    if (!urls || !urls.length) return '';
    return urls
      .slice(0, 4)
      .map((u) => `<img src="${esc(u)}" style="max-width:100%;border-radius:12px;margin-top:8px;display:block">`)
      .join('');
  }

  function richAvatar(d, size) {
    if (d.avatarData)
      return `<img src="${esc(d.avatarData)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;vertical-align:middle">`;
    return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${XS.avatarColor(d.handle || d.name)};color:#fff;text-align:center;line-height:${size}px;font-weight:700;vertical-align:middle">${esc(XS.avatarInitial(d.name, d.handle))}</span>`;
  }

  function richHead(d, avaSize, nameSize) {
    return `<div style="margin-bottom:2px">${richAvatar(d, avaSize)} <b style="font-size:${nameSize}px;vertical-align:middle">${esc(d.name)}</b> <span style="color:#536471;font-size:13px;vertical-align:middle">${esc(d.handle)}</span></div>`;
  }

  // IR → 富文本 HTML 的哑 switch
  function nodesToRichHtml(ir) {
    let h = '';
    for (const node of ir) {
      if (node.kind === 'text') {
        h += `<div style="margin-top:8px;font-size:16px;line-height:1.7;white-space:pre-wrap;word-wrap:break-word">${richSeg(node.segments)}</div>`;
      } else if (node.kind === 'translation') {
        h += `<div style="margin-top:8px;font-size:15px;line-height:1.7;background:#f5f8fa;border-left:3px solid #1d9bf0;border-radius:0 8px 8px 0;padding:8px 12px;white-space:pre-wrap;word-wrap:break-word">${esc(node.text).replace(/\n/g, '<br>')}</div>`;
      } else if (node.kind === 'photos') {
        h += richImgs(node.urls);
      } else if (node.kind === 'video') {
        if (node.poster) h += `<img src="${esc(node.poster)}" style="max-width:100%;border-radius:12px;margin-top:8px;display:block">`;
      } else if (node.kind === 'quote') {
        h += `<div style="margin-top:10px;border:1px solid #e1e8ed;border-radius:12px;padding:10px 12px">${richHead(node.tweet, 20, 14)}${nodesToRichHtml(node.ir)}</div>`;
      }
    }
    return h;
  }

  XS.buildRichHtml = function (payload) {
    const { main, replies } = payload;
    let h = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#0f1419;max-width:600px">';
    h += richHead(main, 40, 16);
    h += nodesToRichHtml(XS.buildIR(main));
    if (replies && replies.length) {
      h += `<div style="margin-top:14px;padding-top:8px;border-top:1px solid #eff3f4;color:#8b98a5;font-size:13px">精选评论 · ${replies.length} 条</div>`;
      replies.forEach((r) => {
        h += `<div style="padding:10px 0;border-bottom:1px solid #f4f7f8">${richHead(r, 24, 14)}${nodesToRichHtml(XS.buildIR(r))}</div>`;
      });
    }
    const t = XS.fmtDate(main.datetime);
    const link = main.permalink ? `原文：<a href="${esc(main.permalink)}" style="color:#8b98a5">${esc(main.permalink)}</a>` : '';
    h += `<div style="margin-top:12px;color:#8b98a5;font-size:12px">${t ? t + ' · ' : ''}${link}</div>`;
    h += '</div>';
    return h;
  };
})();
