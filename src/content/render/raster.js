// 栅格化：卡片 DOM（内联样式）→ html2canvas 逐元素栅格化 → canvas(2x) → PNG Blob。
// 图片须先内联为 data URL（pipeline 经后台完成），html2canvas 才能直接 drawImage。
//
// 从 emit-card.js 拆出：发射器只管产出 DOM，栅格化是独立关注点，便于二期换实现
// （如 chrome.offscreen 离屏文档替代页内 html2canvas）。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  const CARD_WIDTH = 600; // 必须与 emit-card.js 的卡片根宽度一致

  function waitForImages(rootEl) {
    const jobs = [...rootEl.querySelectorAll('img')].map((img) =>
      img.decode ? img.decode().catch(() => {}) : Promise.resolve()
    );
    return Promise.all(jobs);
  }

  // 纯测量：把卡片挂进离屏 holder、等图片 decode、量 CSS 高度、拆除。不跑 html2canvas，
  // 供 content 的 media-cap 阶梯循环快速探高（裁图不裁文）——比一次真栅格化便宜得多。
  // 返回 CSS 像素高度（卡片宽固定 CARD_WIDTH，故可直接与 CARD_WIDTH*aspect 比较）。
  XS.measureCardHeight = async function (card) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;';
    holder.appendChild(card);
    document.body.appendChild(holder);
    try {
      await waitForImages(card);
      return Math.ceil(card.getBoundingClientRect().height);
    } finally {
      holder.remove();
    }
  };

  // 固定比例补白（设计 §06 规则 3「补白不缩放」）：内容不足目标比例时按视觉重心
  // （略偏上）上下补背景色；内容超出时不裁（分页属二期），原样返回并附原因。
  // 计划纯逻辑在 shared/ratio.js（可单测），这里只做 canvas 搬运。
  function padCanvasToRatio(canvas, ratioKey, bg) {
    const plan = XS.ratio.padPlan(canvas.width, canvas.height, ratioKey);
    if (plan.mode === 'natural') return { canvas, note: null };
    if (plan.mode === 'overflow') {
      return { canvas, note: `内容超出 ${ratioKey} 比例，已压缩图片后仍超出，按智能长图导出` };
    }
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = plan.targetH;
    const ctx = out.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, plan.top);
    return { canvas: out, note: null };
  }

  // opts.ratio：'smart'（默认）| '4:5' | '1:1' | '3:4' | '9:16'
  // 返回 { blob, note }：note 是比例回退等提示（无则 null）。
  XS.renderCardToPng = async function (card, opts) {
    // html2canvas 逐元素栅格化，避免 SVG foreignObject 方案在 Chromium 下污染画布
    // （toBlob 抛 "Tainted canvases may not be exported"）。卡片图片均为内联 data URL，不污染。
    if (typeof window.html2canvas !== 'function') throw new Error('html2canvas 未加载');

    // 背景取卡片自身主题背景（跟随主题后卡片可能是暗蓝/纯黑）——
    // 否则 html2canvas 用固定白底填充，深色卡片会露白边/白角。
    const bg = (card.style && card.style.backgroundColor) || '#ffffff';

    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-99999px;top:0;z-index:-1;background:${bg};`;
    holder.appendChild(card);
    document.body.appendChild(holder);

    try {
      await waitForImages(card);
      const h = Math.ceil(card.getBoundingClientRect().height);
      if (!h) throw new Error('卡片高度测量失败');

      let scale = 2;
      const MAX_DIM = 16000; // canvas 尺寸上限余量
      if (h * scale > MAX_DIM) scale = Math.max(1, MAX_DIM / h);

      const canvas = await window.html2canvas(card, {
        backgroundColor: bg,
        scale,
        width: CARD_WIDTH,
        useCORS: true,
        logging: false,
        imageTimeout: 0,
      });

      const ratioKey = (opts && opts.ratio) || 'smart';
      const padded = padCanvasToRatio(canvas, ratioKey, bg);

      const blob = await new Promise((resolve, reject) => {
        padded.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 导出失败'))), 'image/png');
      });
      return { blob, note: padded.note || null };
    } finally {
      holder.remove();
    }
  };
})();
