// 发射器：RenderIR → 内联样式 DOM（html2canvas 的输入）。
//
// 「无痕 Seamless」新版：本发射器提供两套皮肤，均由 theme token 驱动着色——
//   · native  「X 原生截图风」（新默认，重头戏）：X 详情页布局、蓝勾徽章、X logo SVG、
//              原生翻译标签「已翻译自 英语」+ 纯文本译文、原生中文时间行、互动行(SVG+计数+1px 分隔)。
//              产出图力求「就是一张 X 详情页截图」，零工具痕迹。
//   · reading 「阅读排版风」（保留的第二样式）：蓝边译文块、更大字号、宽留白，
//              供长文/公众号插图等不追求伪装、追求可读性的场景。
//
// 样式一律用「逐元素内联 cssText / CSSOM」，不用 class + <style>——html2canvas 克隆副本
// 需样式随节点树复制，且 x.com 的 CSP(style-src) 拦 <style> 与 setAttribute('style')，
// 但 element.style.cssText / createElementNS + 属性赋值 属 CSSOM，CSP 不拦（已实测）。
//
// 语义（blocks 兜底、译文位置、图片下标解析、引用递归、视频封面）已由 shared/ir.js
// 一次性解决，本发射器只对 node.kind 做哑 switch（walkIR）；两套皮肤共用低层 helper，
// 仅在 ctx 里注入各自的 textCss / transNode / quoteBox，honor「IR + 皮肤化发射器」架构。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  const CARD_WIDTH = 600;
  // native：优先 x.com 已加载的 Chirp（页面内渲染直接可用），回退系统栈 + 中文
  const FONT_NATIVE =
    '"TwitterChirp","Chirp",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,Helvetica,Arial,sans-serif';
  const FONT_READING =
    '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';

  // XS.theme 未加载时的兜底（旧调用/裸测试），值同 light 主题
  const FALLBACK_LIGHT = {
    key: 'light', bg: '#FFFFFF', text: '#0F1419', text2: '#536471',
    border: '#EFF3F4', inputBorder: '#CFD9DE', elev: '#F7F9F9',
    accent: '#1D9BF0', accentHover: '#1A8CD8', like: '#F91880', retweet: '#00BA7C',
  };
  const lightTheme = () => (XS.theme && XS.theme.THEMES && XS.theme.THEMES.light) || FALLBACK_LIGHT;

  // X 官方 24×24 图标路径（与 design/设计呈现 §04 同源）
  const PATHS = {
    xlogo: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
    verified: 'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z',
    translate: 'M12.87 15.07l-2.54-2.51.03-.03A17.5 17.5 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
    reply: 'M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z',
    retweet: 'M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z',
    like: 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z',
    bookmark: 'M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z',
  };
  const BADGE_FILL = { blue: '#1d9bf0', gold: '#ffd400', gray: '#829aab' };

  // ---------- 低层 helper（两套皮肤共用）----------

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  // 内联 SVG 图标：createElementNS + 属性赋值（CSP 安全），path 上显式 fill 供 html2canvas 栅格化
  function svgIcon(pathD, size, fill, extraCss) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `display:inline-block;vertical-align:middle;flex:none;fill:${fill};${extraCss || ''}`;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', pathD);
    p.setAttribute('fill', fill);
    svg.appendChild(p);
    return svg;
  }

  function avatarCss(size, theme) {
    return `width:${size}px;height:${size}px;border-radius:50%;flex:none;background:${theme.elev};object-fit:cover;`;
  }

  // 有内联头像用 <img>；没有则渲染「字母头像」（html2canvas 也能栅格化 div）
  function avatarNode(d, size, theme) {
    if (d && d.avatarData) {
      const img = el('img', avatarCss(size, theme));
      img.src = d.avatarData;
      return img;
    }
    const box = el(
      'div',
      avatarCss(size, theme) +
        'display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;' +
        `font-size:${Math.round(size * 0.44)}px;background:${XS.avatarColor((d && (d.handle || d.name)) || '')};`
    );
    box.textContent = XS.avatarInitial(d && d.name, d && d.handle);
    return box;
  }

  function segmentsToNode(container, segments, theme) {
    for (const s of segments) {
      if (s.type === 'ent') container.appendChild(el('span', `color:${theme.accent};`, s.text));
      else container.appendChild(document.createTextNode(s.text));
    }
    return container;
  }

  function photoGrid(dataUrls, ctx) {
    const theme = ctx.theme;
    const n = Math.min(dataUrls.length, 4);
    const cols = n === 1 ? '' : 'grid-template-columns:1fr 1fr;';
    const grid = el(
      'div',
      `margin-top:${ctx.photosMt}px;display:grid;gap:4px;border-radius:16px;overflow:hidden;` +
        `border:1px solid ${theme.border};${cols}${ctx.containerExtra}`
    );
    dataUrls.slice(0, 4).forEach((u, i) => {
      const img = el('img', `width:100%;display:block;object-fit:cover;background:${theme.elev};${ctx.imgH(n, i)}`);
      img.src = u;
      grid.appendChild(img);
    });
    return grid;
  }

  function appendVideoNode(parent, node, ctx) {
    const theme = ctx.theme;
    if (node.poster) {
      const v = el('div', `margin-top:14px;position:relative;border-radius:16px;overflow:hidden;border:1px solid ${theme.border};`);
      const img = el('img', 'width:100%;display:block;');
      img.src = node.poster;
      v.appendChild(img);
      const play = el('div', 'position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(0,0,0,0.55);');
      play.appendChild(el('div', 'position:absolute;left:24px;top:17px;width:0;height:0;border-left:22px solid #ffffff;border-top:14px solid transparent;border-bottom:14px solid transparent;'));
      v.appendChild(play);
      parent.appendChild(v);
      parent.appendChild(el('div', `margin-top:6px;font-size:13px;color:${theme.text2};`, '视频内容 · 观看请打开底部原文链接'));
    } else {
      parent.appendChild(el('div', `box-sizing:border-box;margin-top:14px;border:1px solid ${theme.border};border-radius:16px;padding:18px;font-size:14px;color:${theme.text2};background:${theme.elev};`, '此推文包含视频，观看请打开底部原文链接'));
    }
  }

  // IR → DOM 的哑 switch。ctx 提供当前皮肤/上下文的样式与 translation/quote 渲染。
  function walkIR(parent, ir, ctx) {
    const hasTrans = ir.some((n) => n.kind === 'translation');
    for (const node of ir) {
      if (node.kind === 'text') {
        const t = el('div', ctx.textCss(hasTrans));
        segmentsToNode(t, node.segments, ctx.theme);
        parent.appendChild(t);
        if (ctx.afterFirstText) ctx.afterFirstText(parent);
      } else if (node.kind === 'translation') {
        ctx.appendTranslation(parent, node);
      } else if (node.kind === 'photos') {
        parent.appendChild(photoGrid(node.urls, ctx));
      } else if (node.kind === 'video') {
        appendVideoNode(parent, node, ctx);
      } else if (node.kind === 'quote') {
        parent.appendChild(ctx.quoteBox(node));
      }
    }
  }

  // ============ native 皮肤：X 原生截图风 ============

  const NATIVE_LEVEL = {
    main: { fs: 17, lh: 1.45, mt: 12 },
    quote: { fs: 15, lh: 1.4, mt: 8 },
    reply: { fs: 15, lh: 1.4, mt: 4 },
  };

  function nativeCtx(theme, level) {
    const L = NATIVE_LEVEL[level];
    return {
      theme,
      photosMt: level === 'main' ? 12 : 10,
      containerExtra: level === 'reply' ? 'max-width:440px;' : '',
      imgH: (n, i) =>
        n === 1 ? (level === 'reply' ? 'height:auto;max-height:300px;' : 'height:auto;max-height:510px;')
        : n === 2 ? 'height:220px;'
        : n === 3 ? (i === 0 ? 'grid-row:span 2;height:304px;' : 'height:150px;')
        : 'height:170px;',
      textCss: () => `white-space:pre-wrap;word-wrap:break-word;margin-top:${L.mt}px;font-size:${L.fs}px;line-height:${L.lh};color:${theme.text};`,
      // 原生翻译：细分隔上方 + 「已翻译自 英语」小标签 + 纯文本译文（关键保真：非蓝框块）
      appendTranslation: (parent, node) => {
        const lbl = el('div', `margin-top:12px;display:flex;align-items:center;gap:4px;font-size:13px;color:${theme.text2};`);
        lbl.appendChild(svgIcon(PATHS.translate, 16, theme.text2));
        lbl.appendChild(document.createTextNode('已翻译自 英语'));
        parent.appendChild(lbl);
        parent.appendChild(el('div', `margin-top:2px;font-size:${L.fs}px;line-height:${L.lh};color:${theme.text};white-space:pre-wrap;word-wrap:break-word;`, node.text));
      },
      quoteBox: (node) => nativeQuoteBox(node, theme),
    };
  }

  function nativeQuoteBox(node, theme) {
    const q = node.tweet;
    const box = el('div', `box-sizing:border-box;margin-top:12px;border:1px solid ${theme.border};border-radius:16px;padding:12px 14px;`);
    const head = el('div', 'display:flex;align-items:center;gap:6px;');
    head.appendChild(avatarNode(q, 20, theme));
    head.appendChild(el('span', `font-size:14px;font-weight:700;line-height:1.3;color:${theme.text};word-break:break-word;`, q.name || ''));
    if (q.verified) head.appendChild(svgIcon(PATHS.verified, 15, BADGE_FILL[q.verifiedKind] || BADGE_FILL.blue));
    head.appendChild(el('span', `font-size:13px;color:${theme.text2};line-height:1.4;`, q.handle || ''));
    box.appendChild(head);
    walkIR(box, XS.buildIR(q), nativeCtx(theme, 'quote'));
    return box;
  }

  // 互动图标 + 计数（计数>0 才显示，0 时 X 不显示数字）
  function actionItem(theme, pathD, count) {
    const wrap = el('div', `display:flex;align-items:center;gap:6px;color:${theme.text2};font-size:13px;`);
    wrap.appendChild(svgIcon(pathD, 18.75, theme.text2));
    if (count > 0) wrap.appendChild(document.createTextNode(XS.formatCountCN(count)));
    return wrap;
  }

  function nativeActions(theme, eng) {
    const row = el('div', 'margin-top:12px;display:flex;align-items:center;justify-content:space-between;max-width:440px;');
    const e = eng || {};
    row.appendChild(actionItem(theme, PATHS.reply, e.replies || 0));
    row.appendChild(actionItem(theme, PATHS.retweet, e.retweets || 0));
    row.appendChild(actionItem(theme, PATHS.like, e.likes || 0));
    row.appendChild(actionItem(theme, PATHS.bookmark, 0));
    return row;
  }

  function nativeReply(d, theme) {
    const row = el('div', `display:flex;gap:10px;padding:14px 0 12px;border-bottom:1px solid ${theme.border};`);
    row.appendChild(avatarNode(d, 32, theme));
    const body = el('div', 'flex:1;min-width:0;');
    const line = el('div', 'display:flex;align-items:center;gap:4px;');
    line.appendChild(el('b', `font-weight:700;font-size:14px;color:${theme.text};`, d.name || ''));
    if (d.verified) line.appendChild(svgIcon(PATHS.verified, 14, BADGE_FILL[d.verifiedKind] || BADGE_FILL.blue));
    line.appendChild(el('span', `color:${theme.text2};font-weight:400;font-size:13px;`, d.handle || ''));
    body.appendChild(line);
    walkIR(body, XS.buildIR(d), nativeCtx(theme, 'reply'));
    // 评论的迷你互动行（回复/喜欢），有数字才出
    const e = d.engagement;
    if (e && (e.replies || e.likes)) {
      const acts = el('div', 'margin-top:8px;display:flex;gap:24px;');
      acts.appendChild(actionItem(theme, PATHS.reply, e.replies || 0));
      acts.appendChild(actionItem(theme, PATHS.like, e.likes || 0));
      body.appendChild(acts);
    }
    row.appendChild(body);
    return row;
  }

  function buildNative(payload, theme) {
    const { main, replies } = payload;
    // 深色主题默认加 1px 描边，防在微信白底聊天里边界消融（design §04「深色描边」）
    const outline = theme.key === 'light' ? '' : `border:1px solid ${theme.border};`;
    // 外层方角（真实截图外沿是方的；圆角只留给内部媒体/引用）。深色主题的 outline
    // 是防微信白底消融的 1px 描边，落在成图最外沿。
    const root = el(
      'div',
      `width:${CARD_WIDTH}px;box-sizing:border-box;background:${theme.bg};color:${theme.text};` +
        `padding:16px;${outline}font-family:${FONT_NATIVE};`
    );

    // 头部：头像 + (名字+蓝勾 / 账号) + X logo
    const head = el('div', 'display:flex;align-items:flex-start;gap:12px;');
    head.appendChild(avatarNode(main, 40, theme));
    const who = el('div', 'flex:1;min-width:0;');
    const nameLine = el('div', 'display:flex;align-items:center;gap:4px;');
    nameLine.appendChild(el('span', `font-size:15px;font-weight:700;line-height:1.3;word-break:break-word;color:${theme.text};`, main.name || ''));
    if (main.verified) nameLine.appendChild(svgIcon(PATHS.verified, 16, BADGE_FILL[main.verifiedKind] || BADGE_FILL.blue));
    who.appendChild(nameLine);
    who.appendChild(el('div', `font-size:15px;color:${theme.text2};line-height:1.4;`, main.handle || ''));
    head.appendChild(who);
    head.appendChild(svgIcon(PATHS.xlogo, 22, theme.text, 'margin-left:auto;'));
    root.appendChild(head);

    // 正文（间距略收，贴详情页）
    const bodyWrap = el('div', 'margin-top:4px;');
    walkIR(bodyWrap, XS.buildIR(main), nativeCtx(theme, 'main'));
    root.appendChild(bodyWrap);

    // 原生时间行
    const t = XS.fmtTimeNative(main.datetime);
    if (t) root.appendChild(el('div', `margin-top:12px;font-size:15px;color:${theme.text2};`, t));

    // 互动行：上下 1px 分隔
    root.appendChild(el('div', `margin-top:12px;border-top:1px solid ${theme.border};`));
    root.appendChild(nativeActions(theme, main.engagement));
    root.appendChild(el('div', `margin-top:12px;border-top:1px solid ${theme.border};`));

    if (replies && replies.length) {
      const sec = el('div', 'margin-top:4px;');
      replies.forEach((r) => sec.appendChild(nativeReply(r, theme)));
      root.appendChild(sec);
    }

    // 页脚：仅原文链接（无「转发卡片」等工具痕迹），等宽数字更像地址栏
    const src = (main.permalink || '').replace(/^https?:\/\//, '');
    if (src) {
      root.appendChild(el(
        'div',
        `margin-top:14px;font-size:13px;color:${theme.text2};word-break:break-all;` +
          'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
        src
      ));
    }

    return root;
  }

  // ============ reading 皮肤：阅读排版风（保留的第二样式，主题化）============

  const READING_LEVEL = {
    main: { fs: 16.5, lh: 1.6, mt: 14, transFs: 17, transLh: 1.8, transRad: '0 10px 10px 0', transPad: '12px 14px', transMt: 12 },
    quote: { fs: 15, lh: 1.6, mt: 8, transFs: 15, transLh: 1.7, transRad: '0 10px 10px 0', transPad: '10px 12px', transMt: 8 },
    reply: { fs: 14.5, lh: 1.55, mt: 4, transFs: 14.5, transLh: 1.65, transRad: '0 8px 8px 0', transPad: '8px 10px', transMt: 8 },
  };

  function readingCtx(theme, level) {
    const L = READING_LEVEL[level];
    return {
      theme,
      photosMt: level === 'main' ? 14 : level === 'quote' ? 10 : 8,
      containerExtra: level === 'reply' ? 'max-width:420px;' : '',
      imgH: (n, i) =>
        level === 'reply'
          ? (n === 1 ? 'height:auto;max-height:300px;' : 'height:140px;')
          : n === 1 ? `height:auto;max-height:${level === 'quote' ? 360 : 700}px;`
          : n === 2 ? 'height:220px;'
          : n === 3 ? (i === 0 ? 'grid-row:span 2;height:304px;' : 'height:150px;')
          : 'height:170px;',
      // 有译文时正文压暗（text2），复刻原阅读风
      textCss: (hasTrans) => `white-space:pre-wrap;word-wrap:break-word;margin-top:${L.mt}px;font-size:${L.fs}px;line-height:${L.lh};color:${hasTrans ? theme.text2 : theme.text};`,
      appendTranslation: (parent, node) => {
        parent.appendChild(el(
          'div',
          `box-sizing:border-box;color:${theme.text};background:${theme.elev};border-left:3px solid ${theme.accent};` +
            `white-space:pre-wrap;word-wrap:break-word;margin-top:${L.transMt}px;font-size:${L.transFs}px;` +
            `line-height:${L.transLh};border-radius:${L.transRad};padding:${L.transPad};`,
          node.text
        ));
      },
      quoteBox: (node) => readingQuoteBox(node, theme),
    };
  }

  function readingQuoteBox(node, theme) {
    const q = node.tweet;
    const box = el('div', `box-sizing:border-box;margin-top:14px;border:1px solid ${theme.border};border-radius:14px;padding:12px 14px;`);
    const head = el('div', 'display:flex;align-items:center;gap:8px;');
    head.appendChild(avatarNode(q, 20, theme));
    head.appendChild(el('span', `font-size:14px;font-weight:700;line-height:1.3;color:${theme.text};word-break:break-word;`, q.name || ''));
    head.appendChild(el('span', `font-size:12.5px;color:${theme.text2};line-height:1.4;`, q.handle || ''));
    box.appendChild(head);
    walkIR(box, XS.buildIR(q), readingCtx(theme, 'quote'));
    return box;
  }

  function readingReply(d, theme) {
    const row = el('div', `display:flex;gap:10px;padding:14px 0 12px;border-bottom:1px solid ${theme.border};`);
    row.appendChild(avatarNode(d, 32, theme));
    const body = el('div', 'flex:1;min-width:0;');
    const line = el('div', `font-size:14px;color:${theme.text};line-height:1.4;`);
    line.appendChild(el('b', 'font-weight:700;', d.name || ''));
    line.appendChild(el('span', `color:${theme.text2};font-weight:400;font-size:12.5px;margin-left:6px;`, d.handle || ''));
    body.appendChild(line);
    walkIR(body, XS.buildIR(d), readingCtx(theme, 'reply'));
    row.appendChild(body);
    return row;
  }

  function buildReading(payload, theme) {
    const { main, replies } = payload;
    const outline = theme.key === 'light' ? '' : `border:1px solid ${theme.border};`;
    const root = el(
      'div',
      `width:${CARD_WIDTH}px;box-sizing:border-box;background:${theme.bg};color:${theme.text};` +
        `padding:26px 26px 18px;${outline}font-family:${FONT_READING};`
    );

    const head = el('div', 'display:flex;align-items:center;gap:12px;');
    head.appendChild(avatarNode(main, 46, theme));
    const who = el('div', 'min-width:0;');
    const nameLine = el('div', 'display:flex;align-items:center;gap:4px;');
    nameLine.appendChild(el('span', `font-size:16px;font-weight:700;line-height:1.3;word-break:break-word;color:${theme.text};`, main.name || ''));
    if (main.verified) nameLine.appendChild(svgIcon(PATHS.verified, 16, BADGE_FILL[main.verifiedKind] || BADGE_FILL.blue));
    who.appendChild(nameLine);
    who.appendChild(el('div', `font-size:13.5px;color:${theme.text2};line-height:1.4;`, main.handle || ''));
    head.appendChild(who);
    head.appendChild(svgIcon(PATHS.xlogo, 24, theme.text, 'margin-left:auto;align-self:flex-start;'));
    root.appendChild(head);

    walkIR(root, XS.buildIR(main), readingCtx(theme, 'main'));

    if (replies && replies.length) {
      const sec = el('div', 'margin-top:22px;');
      sec.appendChild(el('div', `font-size:13px;color:${theme.text2};padding-bottom:6px;border-bottom:1px solid ${theme.border};`, `精选评论 · ${replies.length} 条`));
      replies.forEach((r) => sec.appendChild(readingReply(r, theme)));
      root.appendChild(sec);
    }

    const foot = el('div', `margin-top:18px;padding-top:12px;border-top:1px solid ${theme.border};display:flex;justify-content:space-between;gap:16px;font-size:12px;color:${theme.text2};`);
    const src = (main.permalink || '').replace(/^https?:\/\//, '');
    foot.appendChild(el('div', 'word-break:break-all;min-width:0;', src ? `原文：${src}` : ''));
    const dateStr = XS.fmtDate(main.datetime);
    foot.appendChild(el('div', 'flex:none;white-space:nowrap;', `${dateStr ? dateStr + ' · ' : ''}X 转发卡片`));
    root.appendChild(foot);

    return root;
  }

  // ---------- 出口：按 payload.cardStyle 选皮肤，payload.theme 决定主题 ----------
  // payload.theme 期望是 token 对象（pipeline 已 resolve）；缺失/字符串时兜底为 light。
  XS.buildCard = function (payload) {
    let theme = payload && payload.theme;
    if (!theme || typeof theme === 'string') {
      theme = (XS.theme && XS.theme.resolveTheme)
        ? XS.theme.resolveTheme(typeof theme === 'string' ? theme : 'light', null)
        : lightTheme();
    }
    const style = (payload && payload.cardStyle) === 'reading' ? buildReading : buildNative;
    return style(payload, theme);
  };
})();
