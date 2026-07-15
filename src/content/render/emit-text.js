// 发射器：RenderIR → 纯文本（text/html 不支持时的兜底）。
//
// 纯文本不逐块穿插排版：它把一条推文的正文整段聚合、再依次给名字/正文/译文/引用。
// 因此这里对 IR 的处理是「收集所有文本节点、忽略图片/视频节点、递归引用」，
// 聚合出的文本与原 d.segments.join('') 逐字一致（含 blocks 穿插图文场景）。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  XS.buildPlainText = function (payload) {
    const { main, replies } = payload;
    const lines = [];
    const one = (d, pad) => {
      const ir = XS.buildIR(d);
      const t = ir
        .filter((n) => n.kind === 'text')
        .map((n) => n.segments.map((s) => s.text).join(''))
        .join('');
      if (d.name) lines.push(`${pad}${d.name}${d.handle ? ' ' + d.handle : ''}`);
      if (t) lines.push(pad + t.replace(/\n/g, '\n' + pad));
      if (d.translation) lines.push(pad + '【译】' + d.translation.replace(/\n/g, '\n' + pad));
      const quoteNode = ir.find((n) => n.kind === 'quote');
      if (quoteNode) one(quoteNode.tweet, pad + '  ');
    };
    one(main, '');
    if (replies && replies.length) {
      lines.push('', '— 精选评论 —');
      replies.forEach((r) => { one(r, ''); lines.push(''); });
    }
    if (main.permalink) lines.push('原文：' + main.permalink);
    return lines.join('\n');
  };
})();
