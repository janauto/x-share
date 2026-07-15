// RenderIR：payload → 中间表示的「唯一一次语义遍历」。
//
// 背景：长图卡片 / 自包含网页 / 富文本 / 纯文本 四套渲染器原本各自把 payload 遍历一遍，
// 「译文紧跟第一段正文」的 emitTrans 状态机、blocks 兜底、blockPhotos 下标解析、引用递归
// 各重复三四遍，改一处漏一处就出不一致。这里把所有语义一次性解决，产出有序节点树，
// 四个发射器退化成对 node.kind 的哑 switch。
//
// IR 节点：
//   { kind: 'text',        segments: [{type,text}...] }   // 只有非空文本块才产出
//   { kind: 'translation', text }                          // d.translation（存在时）
//   { kind: 'photos',      urls: [dataUrl...] }            // 已解析、已过滤失败位
//   { kind: 'video',       poster: dataUrl|null, permalink: string|null }
//   { kind: 'quote',       tweet: <quote d>, ir: RenderIR } // tweet 供发射器渲染引用头部
//
// 纯函数、无 DOM，node 可直接单测。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // node 里 require 兄弟模块；浏览器/SW 里从已加载的 __XS 取。
  let blocks = XS;
  if ((!blocks.blocksOf || !blocks.blockPhotos) && typeof require !== 'undefined') {
    try { blocks = require('./blocks.js'); } catch (_) { /* 浏览器环境走 XS */ }
  }

  // payload（单条推文 d）→ 有序 IR 节点数组。
  // emitTrans 语义完整复刻旧三处渲染器：
  //   译文在「第一个文本块之后」发射（哪怕该文本块为空也算，只发射一次）；
  //   若整条没有任何文本块（纯图/纯视频推文），译文在末尾垫底发射。
  function buildIR(d) {
    const nodes = [];
    if (!d) return nodes;

    let transEmitted = false;
    const emitTrans = () => {
      if (!transEmitted && d.translation) {
        nodes.push({ kind: 'translation', text: d.translation });
        transEmitted = true;
      }
    };

    for (const b of blocks.blocksOf(d)) {
      if (b.type === 'text') {
        if (b.segments && b.segments.length) nodes.push({ kind: 'text', segments: b.segments });
        emitTrans(); // 译文紧跟第一段正文（首个文本块，空块也触发）
      } else if (b.type === 'photos') {
        const urls = blocks.blockPhotos(d, b);
        if (urls.length) nodes.push({ kind: 'photos', urls });
      } else if (b.type === 'video') {
        // 每个视频块渲染同一封面（d 级 videoPosterData）；permalink 供网页「打开原文观看」链接
        nodes.push({ kind: 'video', poster: d.videoPosterData || null, permalink: d.permalink || null });
      } else if (b.type === 'quote') {
        if (d.quote) nodes.push({ kind: 'quote', tweet: d.quote, ir: buildIR(d.quote) });
      }
    }
    emitTrans(); // 无正文块时（纯图推文）也要出译文

    return nodes;
  }

  XS.buildIR = buildIR;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildIR };
  }
})();
