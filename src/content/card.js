// 双语卡片的构建与 PNG 导出。
// 渲染方式：构建自带 <style> 的独立 DOM → XMLSerializer 序列化 →
// SVG foreignObject → canvas（2x）→ PNG Blob。
// 所有图片必须先转成 data URL（由 content.js 通过后台完成），否则 canvas 会被污染。

(() => {
  const XS = (window.__XS = window.__XS || {});

  const CARD_WIDTH = 600;

  const CARD_CSS = `
.xs-card{width:${CARD_WIDTH}px;box-sizing:border-box;background:#ffffff;color:#0f1419;padding:26px 26px 18px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;}
.xs-card div,.xs-card img,.xs-card span,.xs-card b{box-sizing:border-box;margin:0;padding:0;border:0 none;}
.xs-head{display:flex;align-items:center;gap:12px;}
.xs-ava{width:46px;height:46px;border-radius:50%;flex:none;background:#eff3f4;object-fit:cover;}
.xs-ava.sm{width:32px;height:32px;}
.xs-ava.xs{width:20px;height:20px;}
.xs-who{min-width:0;}
.xs-name{font-size:16px;font-weight:700;line-height:1.3;word-break:break-word;color:#0f1419;}
.xs-handle{font-size:13.5px;color:#536471;line-height:1.4;}
.xs-xmark{margin-left:auto;font-size:24px;font-weight:800;color:#0f1419;font-family:Arial,sans-serif;align-self:flex-start;}
.xs-text{margin-top:14px;font-size:16.5px;line-height:1.6;color:#536471;white-space:pre-wrap;word-wrap:break-word;}
.xs-text.solo{color:#0f1419;}
.xs-ent{color:#1d9bf0;}
.xs-trans{margin-top:12px;font-size:17px;line-height:1.8;color:#0f1419;background:#f5f8fa;border-left:3px solid #1d9bf0;border-radius:0 10px 10px 0;padding:12px 14px;white-space:pre-wrap;word-wrap:break-word;}
.xs-photos{margin-top:14px;display:grid;gap:4px;border-radius:14px;overflow:hidden;}
.xs-photos img{width:100%;display:block;object-fit:cover;background:#eff3f4;}
.xs-photos.n1 img{height:auto;max-height:700px;}
.xs-photos.n2{grid-template-columns:1fr 1fr;}
.xs-photos.n2 img{height:220px;}
.xs-photos.n3{grid-template-columns:1fr 1fr;}
.xs-photos.n3 img{height:150px;}
.xs-photos.n3 img.big{grid-row:span 2;height:304px;}
.xs-photos.n4{grid-template-columns:1fr 1fr;}
.xs-photos.n4 img{height:170px;}
.xs-video{margin-top:14px;position:relative;border-radius:14px;overflow:hidden;}
.xs-video img{width:100%;display:block;}
.xs-play{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(0,0,0,0.55);}
.xs-play span{position:absolute;left:24px;top:17px;width:0;height:0;border-left:22px solid #ffffff;border-top:14px solid transparent;border-bottom:14px solid transparent;}
.xs-vnote{margin-top:6px;font-size:12.5px;color:#8b98a5;}
.xs-vbox{margin-top:14px;border:1px solid #e1e8ed;border-radius:14px;padding:18px;font-size:14px;color:#536471;background:#f7f9f9;}
.xs-quote{margin-top:14px;border:1px solid #e1e8ed;border-radius:14px;padding:12px 14px;}
.xs-qhead{display:flex;align-items:center;gap:8px;}
.xs-qhead .xs-name{font-size:14px;}
.xs-qhead .xs-handle{font-size:12.5px;}
.xs-quote .xs-text{font-size:15px;margin-top:8px;}
.xs-quote .xs-trans{font-size:15px;line-height:1.7;margin-top:8px;padding:10px 12px;}
.xs-quote .xs-photos{margin-top:10px;}
.xs-quote .xs-photos.n1 img{max-height:360px;}
.xs-replies{margin-top:22px;}
.xs-rtitle{font-size:13px;color:#8b98a5;padding-bottom:6px;border-bottom:1px solid #eff3f4;}
.xs-reply{display:flex;gap:10px;padding:14px 0 12px;border-bottom:1px solid #f4f7f8;}
.xs-rbody{flex:1;min-width:0;}
.xs-rline{font-size:14px;color:#0f1419;line-height:1.4;}
.xs-rline b{font-weight:700;}
.xs-rline span{color:#536471;font-weight:400;font-size:12.5px;margin-left:6px;}
.xs-reply .xs-text{font-size:14.5px;margin-top:4px;line-height:1.55;}
.xs-reply .xs-trans{font-size:14.5px;line-height:1.65;margin-top:8px;padding:8px 10px;border-radius:0 8px 8px 0;}
.xs-reply .xs-photos{margin-top:8px;max-width:420px;}
.xs-reply .xs-photos img{height:140px;}
.xs-reply .xs-photos.n1 img{height:auto;max-height:300px;}
.xs-foot{margin-top:18px;padding-top:12px;border-top:1px solid #eff3f4;display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#8b98a5;}
.xs-foot .src{word-break:break-all;min-width:0;}
.xs-foot .gen{flex:none;white-space:nowrap;}
`;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function segmentsToNode(container, segments) {
    for (const s of segments) {
      if (s.type === 'ent') container.appendChild(el('span', 'xs-ent', s.text));
      else container.appendChild(document.createTextNode(s.text));
    }
    return container;
  }

  function photoGrid(dataUrls) {
    const n = Math.min(dataUrls.length, 4);
    const grid = el('div', `xs-photos n${n}`);
    dataUrls.slice(0, 4).forEach((u, i) => {
      const img = el('img');
      if (n === 3 && i === 0) img.className = 'big';
      img.src = u;
      grid.appendChild(img);
    });
    return grid;
  }

  function textBlocks(parent, d, opts) {
    if (d.segments && d.segments.length) {
      const t = el('div', 'xs-text' + (d.translation ? '' : ' solo'));
      segmentsToNode(t, d.segments);
      parent.appendChild(t);
    }
    if (d.translation) parent.appendChild(el('div', 'xs-trans', d.translation));
    if (d.photosData && d.photosData.length) parent.appendChild(photoGrid(d.photosData));
    if (d.hasVideo) {
      if (d.videoPosterData) {
        const v = el('div', 'xs-video');
        const img = el('img');
        img.src = d.videoPosterData;
        v.appendChild(img);
        const play = el('div', 'xs-play');
        play.appendChild(el('span'));
        v.appendChild(play);
        parent.appendChild(v);
        parent.appendChild(el('div', 'xs-vnote', '🎬 视频内容 · 观看请打开底部原文链接'));
      } else {
        parent.appendChild(el('div', 'xs-vbox', '🎬 此推文包含视频，观看请打开底部原文链接'));
      }
    }
    if (d.quote && !(opts && opts.noQuote)) parent.appendChild(quoteBox(d.quote));
  }

  function quoteBox(q) {
    const box = el('div', 'xs-quote');
    const head = el('div', 'xs-qhead');
    if (q.avatarData) {
      const img = el('img', 'xs-ava xs');
      img.src = q.avatarData;
      head.appendChild(img);
    }
    head.appendChild(el('span', 'xs-name', q.name || ''));
    head.appendChild(el('span', 'xs-handle', q.handle || ''));
    box.appendChild(head);
    textBlocks(box, q, { noQuote: true });
    return box;
  }

  function replyRow(d) {
    const row = el('div', 'xs-reply');
    const img = el('img', 'xs-ava sm');
    if (d.avatarData) img.src = d.avatarData;
    row.appendChild(img);
    const body = el('div', 'xs-rbody');
    const line = el('div', 'xs-rline');
    line.appendChild(el('b', null, d.name || ''));
    line.appendChild(el('span', null, d.handle || ''));
    body.appendChild(line);
    textBlocks(body, d);
    row.appendChild(body);
    return row;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  XS.buildCard = function (payload) {
    const { main, replies } = payload;
    const root = el('div', 'xs-card');

    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    root.appendChild(style);

    const head = el('div', 'xs-head');
    const ava = el('img', 'xs-ava');
    if (main.avatarData) ava.src = main.avatarData;
    head.appendChild(ava);
    const who = el('div', 'xs-who');
    who.appendChild(el('div', 'xs-name', main.name || ''));
    who.appendChild(el('div', 'xs-handle', main.handle || ''));
    head.appendChild(who);
    head.appendChild(el('div', 'xs-xmark', '𝕏'));
    root.appendChild(head);

    textBlocks(root, main);

    if (replies && replies.length) {
      const sec = el('div', 'xs-replies');
      sec.appendChild(el('div', 'xs-rtitle', `精选评论 · ${replies.length} 条`));
      replies.forEach((r) => sec.appendChild(replyRow(r)));
      root.appendChild(sec);
    }

    const foot = el('div', 'xs-foot');
    const src = (main.permalink || '').replace(/^https?:\/\//, '');
    foot.appendChild(el('div', 'src', src ? `原文：${src}` : ''));
    const dateStr = fmtDate(main.datetime);
    foot.appendChild(el('div', 'gen', `${dateStr ? dateStr + ' · ' : ''}X 转发卡片`));
    root.appendChild(foot);

    return root;
  };

  function waitForImages(rootEl) {
    const jobs = [...rootEl.querySelectorAll('img')].map((img) =>
      img.decode ? img.decode().catch(() => {}) : Promise.resolve()
    );
    return Promise.all(jobs);
  }

  XS.renderCardToPng = async function (card) {
    // all:initial 隔离页面样式，保证测量高度与 foreignObject 渲染一致
    const holder = document.createElement('div');
    holder.style.cssText = 'all:initial;position:fixed;left:-99999px;top:0;z-index:-1;';
    holder.appendChild(card);
    document.body.appendChild(holder);

    try {
      await waitForImages(card);
      const w = CARD_WIDTH;
      const h = Math.ceil(card.getBoundingClientRect().height);
      if (!h) throw new Error('卡片高度测量失败');

      const xml = new XMLSerializer().serializeToString(card);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

      try {
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error('SVG 渲染失败'));
          im.src = url;
        });

        let scale = 2;
        const MAX_DIM = 16000; // 留出 canvas 上限余量
        if (h * scale > MAX_DIM) scale = Math.max(1, MAX_DIM / h);

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 导出失败'))), 'image/png');
        });
        return blob;
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      holder.remove();
    }
  };
})();
