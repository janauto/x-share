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

  XS.renderCardToPng = async function (card) {
    // html2canvas 逐元素栅格化，避免 SVG foreignObject 方案在 Chromium 下污染画布
    // （toBlob 抛 "Tainted canvases may not be exported"）。卡片图片均为内联 data URL，不污染。
    if (typeof window.html2canvas !== 'function') throw new Error('html2canvas 未加载');

    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;background:#ffffff;';
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
        backgroundColor: '#ffffff',
        scale,
        width: CARD_WIDTH,
        useCORS: true,
        logging: false,
        imageTimeout: 0,
      });

      return await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 导出失败'))), 'image/png');
      });
    } finally {
      holder.remove();
    }
  };
})();
