// 发射器：RenderIR → 内联样式 DOM（html2canvas 的输入）。
//
// 样式一律用「逐元素内联 cssText」，不用 class + <style>，原因有二：
//   1. html2canvas 渲染的是卡片的克隆副本，样式必须随节点树一起被 cloneNode 复制，
//      内联样式能做到，外部/adopted 样式表做不到（克隆后丢样式 → 导出白版）。
//   2. x.com 的 CSP(style-src) 会拦截注入的 <style> 和 setAttribute('style')，
//      但 element.style.cssText / 逐属性赋值 属 CSSOM 操作，CSP 不拦（已实测验证）。
//
// 语义（blocks 兜底、译文位置、图片下标解析、引用递归、视频封面）已由 shared/ir.js
// 一次性解决，本发射器只对 node.kind 做哑 switch，只管样式不管语义。
// main / quote / reply 三种上下文的字号行高、图片网格高度规则、译文块样式逐一保真。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  const CARD_WIDTH = 600;
  const FONT =
    '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';

  // 译文块与正文的公共样式，按场景（主/引用/回复）微调字号
  const TRANS_BASE =
    'box-sizing:border-box;color:#0f1419;background:#f5f8fa;border-left:3px solid #1d9bf0;white-space:pre-wrap;word-wrap:break-word;';
  const TEXT_BASE = 'white-space:pre-wrap;word-wrap:break-word;';

  const CTX = {
    main: {
      text: (t) => TEXT_BASE + `margin-top:14px;font-size:16.5px;line-height:1.6;color:${t ? '#536471' : '#0f1419'};`,
      trans: TRANS_BASE + 'margin-top:12px;font-size:17px;line-height:1.8;border-radius:0 10px 10px 0;padding:12px 14px;',
      photosMt: 14,
      imgH: (n, i) =>
        n === 1 ? 'height:auto;max-height:700px;'
        : n === 2 ? 'height:220px;'
        : n === 3 ? (i === 0 ? 'grid-row:span 2;height:304px;' : 'height:150px;')
        : 'height:170px;',
      containerExtra: '',
    },
    quote: {
      text: (t) => TEXT_BASE + `margin-top:8px;font-size:15px;line-height:1.6;color:${t ? '#536471' : '#0f1419'};`,
      trans: TRANS_BASE + 'margin-top:8px;font-size:15px;line-height:1.7;border-radius:0 10px 10px 0;padding:10px 12px;',
      photosMt: 10,
      imgH: (n, i) =>
        n === 1 ? 'height:auto;max-height:360px;'
        : n === 2 ? 'height:220px;'
        : n === 3 ? (i === 0 ? 'grid-row:span 2;height:304px;' : 'height:150px;')
        : 'height:170px;',
      containerExtra: '',
    },
    reply: {
      text: (t) => TEXT_BASE + `margin-top:4px;font-size:14.5px;line-height:1.55;color:${t ? '#536471' : '#0f1419'};`,
      trans: TRANS_BASE + 'margin-top:8px;font-size:14.5px;line-height:1.65;border-radius:0 8px 8px 0;padding:8px 10px;',
      photosMt: 8,
      imgH: (n) => (n === 1 ? 'height:auto;max-height:300px;' : 'height:140px;'),
      containerExtra: 'max-width:420px;',
    },
  };

  function avatarCss(size) {
    return `width:${size}px;height:${size}px;border-radius:50%;flex:none;background:#eff3f4;object-fit:cover;`;
  }

  // 有内联头像用 <img>；没有则渲染「字母头像」，避免空白灰圈（html2canvas 也能栅格化 div）
  function avatarNode(d, size) {
    if (d && d.avatarData) {
      const img = el('img', avatarCss(size));
      img.src = d.avatarData;
      return img;
    }
    const box = el(
      'div',
      avatarCss(size) +
        'display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;' +
        `font-size:${Math.round(size * 0.44)}px;background:${XS.avatarColor((d && (d.handle || d.name)) || '')};`
    );
    box.textContent = XS.avatarInitial(d && d.name, d && d.handle);
    return box;
  }

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function segmentsToNode(container, segments) {
    for (const s of segments) {
      if (s.type === 'ent') container.appendChild(el('span', 'color:#1d9bf0;', s.text));
      else container.appendChild(document.createTextNode(s.text));
    }
    return container;
  }

  function photoGrid(dataUrls, ctx) {
    const n = Math.min(dataUrls.length, 4);
    const cols = n === 1 ? '' : 'grid-template-columns:1fr 1fr;';
    const grid = el(
      'div',
      `margin-top:${ctx.photosMt}px;display:grid;gap:4px;border-radius:14px;overflow:hidden;${cols}${ctx.containerExtra}`
    );
    dataUrls.slice(0, 4).forEach((u, i) => {
      const img = el('img', `width:100%;display:block;object-fit:cover;background:#eff3f4;${ctx.imgH(n, i)}`);
      img.src = u;
      grid.appendChild(img);
    });
    return grid;
  }

  function appendVideoNode(parent, node) {
    if (node.poster) {
      const v = el('div', 'margin-top:14px;position:relative;border-radius:14px;overflow:hidden;');
      const img = el('img', 'width:100%;display:block;');
      img.src = node.poster;
      v.appendChild(img);
      const play = el('div', 'position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(0,0,0,0.55);');
      play.appendChild(el('div', 'position:absolute;left:24px;top:17px;width:0;height:0;border-left:22px solid #ffffff;border-top:14px solid transparent;border-bottom:14px solid transparent;'));
      v.appendChild(play);
      parent.appendChild(v);
      parent.appendChild(el('div', 'margin-top:6px;font-size:12.5px;color:#8b98a5;', '🎬 视频内容 · 观看请打开底部原文链接'));
    } else {
      parent.appendChild(el('div', 'box-sizing:border-box;margin-top:14px;border:1px solid #e1e8ed;border-radius:14px;padding:18px;font-size:14px;color:#536471;background:#f7f9f9;', '🎬 此推文包含视频，观看请打开底部原文链接'));
    }
  }

  // IR → DOM 的哑 switch。ctx 决定当前上下文（main/quote/reply）的字号/间距。
  function emitCardNodes(parent, ir, ctx) {
    const hasTrans = ir.some((n) => n.kind === 'translation'); // 等价于原 !!d.translation
    for (const node of ir) {
      if (node.kind === 'text') {
        const t = el('div', ctx.text(hasTrans));
        segmentsToNode(t, node.segments);
        parent.appendChild(t);
      } else if (node.kind === 'translation') {
        parent.appendChild(el('div', ctx.trans, node.text));
      } else if (node.kind === 'photos') {
        parent.appendChild(photoGrid(node.urls, ctx));
      } else if (node.kind === 'video') {
        appendVideoNode(parent, node);
      } else if (node.kind === 'quote') {
        parent.appendChild(quoteBox(node));
      }
    }
  }

  function quoteBox(node) {
    const q = node.tweet;
    const box = el('div', 'box-sizing:border-box;margin-top:14px;border:1px solid #e1e8ed;border-radius:14px;padding:12px 14px;');
    const head = el('div', 'display:flex;align-items:center;gap:8px;');
    head.appendChild(avatarNode(q, 20));
    head.appendChild(el('span', 'font-size:14px;font-weight:700;line-height:1.3;color:#0f1419;word-break:break-word;', q.name || ''));
    head.appendChild(el('span', 'font-size:12.5px;color:#536471;line-height:1.4;', q.handle || ''));
    box.appendChild(head);
    emitCardNodes(box, node.ir, CTX.quote);
    return box;
  }

  function replyRow(d) {
    const row = el('div', 'display:flex;gap:10px;padding:14px 0 12px;border-bottom:1px solid #f4f7f8;');
    row.appendChild(avatarNode(d, 32));
    const body = el('div', 'flex:1;min-width:0;');
    const line = el('div', 'font-size:14px;color:#0f1419;line-height:1.4;');
    line.appendChild(el('b', 'font-weight:700;', d.name || ''));
    line.appendChild(el('span', 'color:#536471;font-weight:400;font-size:12.5px;margin-left:6px;', d.handle || ''));
    body.appendChild(line);
    emitCardNodes(body, XS.buildIR(d), CTX.reply);
    row.appendChild(body);
    return row;
  }

  XS.buildCard = function (payload) {
    const { main, replies } = payload;
    const root = el(
      'div',
      `width:${CARD_WIDTH}px;box-sizing:border-box;background:#ffffff;color:#0f1419;padding:26px 26px 18px;font-family:${FONT};`
    );

    const head = el('div', 'display:flex;align-items:center;gap:12px;');
    head.appendChild(avatarNode(main, 46));
    const who = el('div', 'min-width:0;');
    who.appendChild(el('div', 'font-size:16px;font-weight:700;line-height:1.3;word-break:break-word;color:#0f1419;', main.name || ''));
    who.appendChild(el('div', 'font-size:13.5px;color:#536471;line-height:1.4;', main.handle || ''));
    head.appendChild(who);
    head.appendChild(el('div', 'margin-left:auto;font-size:24px;font-weight:800;color:#0f1419;font-family:Arial,sans-serif;align-self:flex-start;', '𝕏'));
    root.appendChild(head);

    emitCardNodes(root, XS.buildIR(main), CTX.main);

    if (replies && replies.length) {
      const sec = el('div', 'margin-top:22px;');
      sec.appendChild(el('div', 'font-size:13px;color:#8b98a5;padding-bottom:6px;border-bottom:1px solid #eff3f4;', `精选评论 · ${replies.length} 条`));
      replies.forEach((r) => sec.appendChild(replyRow(r)));
      root.appendChild(sec);
    }

    const foot = el('div', 'margin-top:18px;padding-top:12px;border-top:1px solid #eff3f4;display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#8b98a5;');
    const src = (main.permalink || '').replace(/^https?:\/\//, '');
    foot.appendChild(el('div', 'word-break:break-all;min-width:0;', src ? `原文：${src}` : ''));
    const dateStr = XS.fmtDate(main.datetime);
    foot.appendChild(el('div', 'flex:none;white-space:nowrap;', `${dateStr ? dateStr + ' · ' : ''}X 转发卡片`));
    root.appendChild(foot);

    return root;
  };
})();
