// 有序块模型的共享逻辑，两栖模块。
//   - blocksOf(d)         优先 d.blocks（保文档顺序），无则回退旧顺序（文本→图→视频→引用）
//   - blockPhotos(d, b)   把 photos 块里的下标解析成实际 data URL（失败位过滤）
//   - aggregateSegments   把有序块里的文本块聚合成一条 segments（相邻同类合并）
//
// 原来 blocksOf / blockPhotos 在 card.js 与 webpage.js 里逐字重复；这里收敛为一份，
// 由 ir.js 消费。无 DOM 依赖，node 可测。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // 有序内容块：优先用 d.blocks（保留文档顺序，图片不再被甩到末尾），
  // 无 blocks 时回退旧顺序（文本→图→视频→引用）。
  function blocksOf(d) {
    if (d.blocks && d.blocks.length) return d.blocks;
    const b = [];
    if (d.segments && d.segments.length) b.push({ type: 'text', segments: d.segments });
    if (d.photosData && d.photosData.some(Boolean)) b.push({ type: 'photos', all: true });
    if (d.hasVideo) b.push({ type: 'video' });
    if (d.quote) b.push({ type: 'quote' });
    return b;
  }

  // 从块里取实际图片 data URL：all 块取全部，idx 块按下标取，过滤掉抓取失败的空位。
  function blockPhotos(d, b) {
    const arr = d.photosData || [];
    const picked = b.all ? arr : (b.idx || []).map((i) => arr[i]);
    return picked.filter(Boolean);
  }

  // 相邻同类型段合并（与 extract.js walkSegments 用的 pushSeg 同规则）
  function pushSeg(out, type, text) {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  }

  // 把有序块里所有文本块的 segments 聚合成一条（供派生 segments / plainText 兼容字段）。
  // 复刻 extract.js 原来内联的聚合循环，行为一致。
  function aggregateSegments(blocks) {
    const segments = [];
    for (const b of blocks || []) {
      if (b.type === 'text' && b.segments) {
        for (const s of b.segments) pushSeg(segments, s.type, s.text);
      }
    }
    return segments;
  }

  // segments → 纯文本
  function plainTextOf(segments) {
    return (segments || []).map((s) => s.text).join('');
  }

  XS.blocksOf = blocksOf;
  XS.blockPhotos = blockPhotos;
  XS.aggregateSegments = aggregateSegments;
  XS.plainTextOf = plainTextOf;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { blocksOf, blockPhotos, aggregateSegments, plainTextOf };
  }
})();
